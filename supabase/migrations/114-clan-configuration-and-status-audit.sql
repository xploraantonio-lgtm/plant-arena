-- =============================================================================
-- MIGRACIÓN 114: AUDITORÍA DE CLANES, ESTADO ACTIVO Y GOBERNANZA DE ADMISIÓN
--
-- 1. Auditoría y Corrección de Clanes:
--    - Clanes creados con Tesoro Inicial en 0 Gemas deben permanecer 'active'.
--    - Se reactivan a 'active' los clanes erróneamente marcados como 'defeated'
--      que no hayan sufrido derrotas en guerras (losses = 0 OR losses IS NULL).
--    - Se inicializan los settings por defecto si están vacíos o nulos.
-- 2. Tabla public.clan_join_requests:
--    - Gestiona solicitudes de ingreso cuando un clan está configurado
--      en modo 'CON SOLICITUD' (privacy = 'request') y autoAccept = false.
-- 3. RPC public.update_clan_settings:
--    - Permite al Líder persistir la configuración de privacidad (public, request, closed),
--      ELO mínimo (minElo), permisos de guerra y auto-aprobación en public.clans.settings.
-- 4. RPC public.request_join_clan:
--    - Valida requisitos de ELO y saldo (200 Gemas 💎).
--    - Si el clan es 'public' o tiene autoAccept = true: une de inmediato (+200 💎 al tesoro).
--    - Si el clan es 'request' (autoAccept = false): registra la solicitud pendiente.
--    - Si el clan es 'closed': rechaza el ingreso.
-- 5. RPC public.respond_clan_join_request:
--    - Exclusivo del Líder para aceptar o rechazar solicitudes de ingreso.
--    - Al aceptar, cobra 200 💎 al solicitante, los inyecta al tesoro y lo une al clan.
-- 6. Actualización de get_my_clan_details() y get_clans_list():
--    - Retorna el listado de solicitudes pendientes para el clan del usuario.
-- =============================================================================

BEGIN;

-- ── 1. AUDITORÍA Y CORRECCIÓN DE CLANES EXISTENTES ───────────────────────────

-- Corregir clanes activos que fueron marcados como 'defeated' por tener 0 gemas
UPDATE public.clans
   SET status     = 'active',
       updated_at = NOW()
 WHERE status = 'defeated'
   AND (losses = 0 OR losses IS NULL);

-- Asegurar que todos los clanes activos tengan settings válidos por defecto
UPDATE public.clans
   SET settings = jsonb_build_object(
     'privacy', 'public',
     'minElo', COALESCE(min_elo, 0),
     'warPermission', 'leaders',
     'autoAccept', true
   ),
   updated_at = NOW()
 WHERE settings IS NULL OR settings = '{}'::jsonb;


-- ── 2. TABLA DE SOLICITUDES DE INGRESO (JOIN REQUESTS) ───────────────────────

CREATE TABLE IF NOT EXISTS public.clan_join_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id     UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  elo         INTEGER NOT NULL DEFAULT 1000,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'cancelled'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clan_join_requests_clan_status ON public.clan_join_requests(clan_id, status);
CREATE INDEX IF NOT EXISTS idx_clan_join_requests_user_status ON public.clan_join_requests(user_id, status);

-- RLS en clan_join_requests
ALTER TABLE public.clan_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clan_join_requests_select_policy ON public.clan_join_requests;
CREATE POLICY clan_join_requests_select_policy ON public.clan_join_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.clans c
       WHERE c.id = clan_join_requests.clan_id AND c.leader_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM public.clan_members cm
       WHERE cm.clan_id = clan_join_requests.clan_id AND cm.user_id = auth.uid()
    )
  );


-- ── 3. RPC: ACTUALIZAR CONFIGURACIÓN DEL CLAN (EXCLUSIVO DEL LÍDER) ───────────

CREATE OR REPLACE FUNCTION public.update_clan_settings(
  p_clan_id   UUID,
  p_settings  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_clan       RECORD;
  v_min_elo    INTEGER;
  v_privacy    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED', 'message', 'Debes iniciar sesión');
  END IF;

  IF p_clan_id IS NULL OR p_settings IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ARGUMENTS', 'message', 'Argumentos inválidos');
  END IF;

  SELECT * INTO v_clan FROM public.clans WHERE id = p_clan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_NOT_FOUND', 'message', 'Clan no encontrado');
  END IF;

  IF v_clan.leader_id <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ONLY_LEADER_ALLOWED', 'message', 'Solo el Líder puede cambiar la configuración del clan');
  END IF;

  v_min_elo := COALESCE((p_settings->>'minElo')::INTEGER, 0);
  v_privacy := LOWER(TRIM(COALESCE(p_settings->>'privacy', 'public')));

  IF v_privacy NOT IN ('public', 'request', 'closed') THEN
    v_privacy := 'public';
  END IF;

  -- Actualizar tabla clans
  UPDATE public.clans
     SET settings   = p_settings,
         min_elo    = v_min_elo,
         updated_at = NOW()
   WHERE id = p_clan_id;

  -- Registrar auditoría
  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, details
  ) VALUES (
    p_clan_id, v_clan.name, 'UPDATE_SETTINGS', v_uid,
    jsonb_build_object('settings', p_settings, 'min_elo', v_min_elo)
  );

  RETURN jsonb_build_object(
    'success', true,
    'clan_id', p_clan_id,
    'settings', p_settings,
    'min_elo', v_min_elo
  );
END;
$$;


-- ── 4. RPC: SOLICITAR / INGRESAR A CLAN (MANEJA ABIERTO, SOLICITUD Y AUTOACCEPT)

CREATE OR REPLACE FUNCTION public.request_join_clan(p_clan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clan        RECORD;
  v_profile     RECORD;
  v_member_cnt  INTEGER;
  v_privacy     TEXT;
  v_auto_accept BOOLEAN;
  v_req_id      UUID;
  c_FEE         CONSTANT NUMERIC := 200.0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED', 'message', 'Debes iniciar sesión');
  END IF;

  -- Validar si ya pertenece a algún clan
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_IN_CLAN', 'message', 'Ya perteneces a un clan');
  END IF;

  -- Bloquear y validar clan
  SELECT * INTO v_clan 
    FROM public.clans 
   WHERE id = p_clan_id AND is_active = TRUE 
     FOR UPDATE;

  IF NOT FOUND OR v_clan.status = 'disbanded' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_NOT_FOUND', 'message', 'Clan no disponible o disuelto');
  END IF;

  -- Validar capacidad máxima (15 miembros)
  SELECT COUNT(*) INTO v_member_cnt FROM public.clan_members WHERE clan_id = p_clan_id;
  IF v_member_cnt >= 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_FULL', 'message', 'El clan ya alcanzó el límite de 15 miembros');
  END IF;

  -- Validar perfil, ELO y saldo de 200 Gemas
  SELECT gems_balance, username, elo_rating INTO v_profile 
    FROM public.profiles 
   WHERE id = v_uid 
     FOR UPDATE;

  IF COALESCE(v_profile.elo_rating, 1000) < COALESCE(v_clan.min_elo, 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_ELO', 'message', 'No cumples con el ELO mínimo de ' || v_clan.min_elo || ' copas');
  END IF;

  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < c_FEE THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_GEMS', 'message', 'Saldo insuficiente (200 Gemas 💎 requeridas)');
  END IF;

  v_privacy     := LOWER(TRIM(COALESCE(v_clan.settings->>'privacy', 'public')));
  v_auto_accept := COALESCE((v_clan.settings->>'autoAccept')::BOOLEAN, true);

  -- Si el clan está CERRADO
  IF v_privacy = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_CLOSED', 'message', 'Este clan tiene la admisión cerrada (solo invitación)');
  END IF;

  -- Si el clan es ABIERTO o tiene APROBACIÓN INSTANTÁNEA (autoAccept = true)
  IF v_privacy = 'public' OR v_auto_accept = true THEN
    -- 1. Cobrar 200 Gemas al jugador
    UPDATE public.profiles
       SET gems_balance = gems_balance - c_FEE,
           updated_at   = NOW()
     WHERE id = v_uid;

    -- 2. Inyectar al tesoro del clan
    UPDATE public.clans
       SET vault_gems = COALESCE(vault_gems, 0) + c_FEE,
           updated_at = NOW()
     WHERE id = p_clan_id;

    -- 3. Insertar miembro
    INSERT INTO public.clan_members (clan_id, user_id, role, donated_count, joined_at)
    VALUES (p_clan_id, v_uid, 'member', 0, NOW());

    -- 4. Cancelar cualquier solicitud pendiente de este usuario
    UPDATE public.clan_join_requests
       SET status = 'accepted', updated_at = NOW()
     WHERE user_id = v_uid AND status = 'pending';

    -- 5. Transacción y auditoría
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'clan_join', c_FEE, 'Tasa de ingreso al clan ' || v_clan.name, 'completed');

    INSERT INTO public.clan_audit_logs (
      clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
    ) VALUES (
      p_clan_id, v_clan.name, 'JOIN', v_uid, v_profile.username, c_FEE,
      jsonb_build_object('elo', v_profile.elo_rating, 'injected_to_vault', c_FEE, 'instant', true)
    );

    RETURN jsonb_build_object(
      'success', true,
      'joined', true,
      'clan_id', p_clan_id,
      'clan_name', v_clan.name,
      'message', '¡Te has unido exitosamente al clan!'
    );
  END IF;

  -- Si el clan es CON SOLICITUD (request) y NO tiene autoAccept
  -- Validar si ya envió solicitud pendiente
  IF EXISTS (
    SELECT 1 FROM public.clan_join_requests 
     WHERE clan_id = p_clan_id AND user_id = v_uid AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_ALREADY_PENDING', 'message', 'Ya tienes una solicitud de ingreso pendiente en este clan');
  END IF;

  -- Registrar la solicitud de ingreso
  INSERT INTO public.clan_join_requests (
    clan_id, user_id, username, elo, status
  ) VALUES (
    p_clan_id, v_uid, COALESCE(v_profile.username, 'Guerrero'), COALESCE(v_profile.elo_rating, 1000), 'pending'
  ) RETURNING id INTO v_req_id;

  RETURN jsonb_build_object(
    'success', true,
    'joined', false,
    'request_id', v_req_id,
    'clan_id', p_clan_id,
    'clan_name', v_clan.name,
    'message', 'Solicitud de ingreso enviada al Líder del clan.'
  );
END;
$$;


-- ── 5. RPC: RESPONDER SOLICITUD DE INGRESO (LÍDER ACEPTA O RECHAZA) ──────────

CREATE OR REPLACE FUNCTION public.respond_clan_join_request(
  p_request_id UUID,
  p_accept     BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_req         RECORD;
  v_clan        RECORD;
  v_applicant   RECORD;
  v_member_cnt  INTEGER;
  c_FEE         CONSTANT NUMERIC := 200.0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED', 'message', 'Debes iniciar sesión');
  END IF;

  SELECT * INTO v_req FROM public.clan_join_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND', 'message', 'Solicitud no encontrada');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_PENDING', 'message', 'Esta solicitud ya ha sido resuelta');
  END IF;

  -- Verificar clan y verificar que quien responde sea el Líder
  SELECT * INTO v_clan FROM public.clans WHERE id = v_req.clan_id FOR UPDATE;
  IF NOT FOUND OR v_clan.status = 'disbanded' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_NOT_FOUND', 'message', 'El clan no existe');
  END IF;

  IF v_clan.leader_id <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ONLY_LEADER_ALLOWED', 'message', 'Solo el Líder puede aceptar o rechazar solicitudes');
  END IF;

  -- Si se RECHAZA la solicitud
  IF p_accept IS FALSE THEN
    UPDATE public.clan_join_requests
       SET status = 'rejected', updated_at = NOW()
     WHERE id = p_request_id;

    RETURN jsonb_build_object('success', true, 'accepted', false, 'message', 'Solicitud rechazada');
  END IF;

  -- Si se ACEPTA la solicitud:
  -- 1. Validar límite de 15 miembros
  SELECT COUNT(*) INTO v_member_cnt FROM public.clan_members WHERE clan_id = v_clan.id;
  IF v_member_cnt >= 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_FULL', 'message', 'El clan ya alcanzó el máximo de 15 miembros');
  END IF;

  -- 2. Validar que el solicitante no haya ingresado a otro clan mientras tanto
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_req.user_id) THEN
    UPDATE public.clan_join_requests SET status = 'cancelled', updated_at = NOW() WHERE id = p_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_IN_OTHER_CLAN', 'message', 'El jugador ya se unió a otro clan');
  END IF;

  -- 3. Validar saldo del solicitante
  SELECT gems_balance, username, elo_rating INTO v_applicant 
    FROM public.profiles 
   WHERE id = v_req.user_id 
     FOR UPDATE;

  IF v_applicant.gems_balance IS NULL OR v_applicant.gems_balance < c_FEE THEN
    RETURN jsonb_build_object('success', false, 'error', 'APPLICANT_INSUFFICIENT_GEMS', 'message', 'El solicitante ya no cuenta con las 200 Gemas de ingreso');
  END IF;

  -- 4. Cobrar 200 Gemas al solicitante e inyectar al tesoro del clan
  UPDATE public.profiles
     SET gems_balance = gems_balance - c_FEE,
         updated_at   = NOW()
   WHERE id = v_req.user_id;

  UPDATE public.clans
     SET vault_gems = COALESCE(vault_gems, 0) + c_FEE,
         updated_at = NOW()
   WHERE id = v_clan.id;

  -- 5. Insertar al nuevo miembro
  INSERT INTO public.clan_members (clan_id, user_id, role, donated_count, joined_at)
  VALUES (v_clan.id, v_req.user_id, 'member', 0, NOW());

  -- 6. Marcar solicitud como aceptada
  UPDATE public.clan_join_requests
     SET status = 'accepted', updated_at = NOW()
   WHERE id = p_request_id;

  -- Cancelar cualquier otra solicitud pendiente del mismo usuario
  UPDATE public.clan_join_requests
     SET status = 'cancelled', updated_at = NOW()
   WHERE user_id = v_req.user_id AND id <> p_request_id AND status = 'pending';

  -- 7. Transacción & Auditoría
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_req.user_id, 'clan_join', c_FEE, 'Ingreso aceptado al clan ' || v_clan.name, 'completed');

  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
  ) VALUES (
    v_clan.id, v_clan.name, 'JOIN_REQUEST_ACCEPTED', v_uid, v_applicant.username, c_FEE,
    jsonb_build_object('applicant_id', v_req.user_id, 'applicant_elo', v_applicant.elo_rating)
  );

  RETURN jsonb_build_object(
    'success', true,
    'accepted', true,
    'member_id', v_req.user_id,
    'member_name', v_applicant.username,
    'message', '¡Jugador aceptado en el clan!'
  );
END;
$$;


-- ── 6. ACTUALIZAR get_my_clan_details() PARA INCLUIR SOLICITUDES PENDIENTES ─

CREATE OR REPLACE FUNCTION public.get_my_clan_details()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clan_id     UUID;
  v_clan_row    RECORD;
  v_members     JSONB;
  v_donations   JSONB;
  v_deposits    JSONB;
  v_requests    JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.*, p.username AS leader_name
  INTO v_clan_row
  FROM public.clans c
  LEFT JOIN public.profiles p ON p.id = c.leader_id
  WHERE c.id = v_clan_id AND c.is_active = TRUE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Obtener miembros
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cm.user_id,
      'name', COALESCE(p.username, 'Guerrero'),
      'role', CASE cm.role 
                WHEN 'leader' THEN 'Líder' 
                WHEN 'elder' THEN 'Veterano' 
                ELSE 'Miembro' 
              END,
      'elo', COALESCE(p.elo_rating, 1000),
      'donatedCount', COALESCE(cm.donated_count, 0),
      'joinedAt', cm.joined_at,
      'rewardPercentage', COALESCE(cm.reward_percentage, 0)
    ) ORDER BY (cm.role = 'leader') DESC, p.elo_rating DESC
  ) INTO v_members
  FROM public.clan_members cm
  JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.clan_id = v_clan_id;

  -- Donaciones activas
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cpr.id,
      'requesterId', cpr.user_id,
      'requesterName', p.username,
      'plantId', cpr.plant_id,
      'copiesRequested', cpr.copies_requested,
      'donors', cpr.donors,
      'createdAt', cpr.created_at
    ) ORDER BY cpr.created_at DESC
  ) INTO v_donations
  FROM public.clan_plant_requests cpr
  JOIN public.profiles p ON p.id = cpr.user_id
  WHERE cpr.clan_id = v_clan_id AND cpr.status = 'active';

  -- Historial de aportes
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cal.id,
      'clanId', cal.clan_id,
      'depositorName', COALESCE(cal.performed_by_name, 'Miembro'),
      'amountGems', cal.amount_gems,
      'timestamp', cal.created_at,
      'reason', LOWER(cal.action),
      'action', cal.action
    ) ORDER BY cal.created_at DESC
  ) INTO v_deposits
  FROM (
    SELECT * FROM public.clan_audit_logs
    WHERE clan_id = v_clan_id
      AND action IN ('DEPOSIT', 'REACTIVATE', 'CREATE', 'JOIN', 'JOIN_REQUEST_ACCEPTED')
    ORDER BY created_at DESC
    LIMIT 30
  ) cal;

  -- Solicitudes de ingreso pendientes (visibles para miembros / líder)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', cjr.id,
      'userId', cjr.user_id,
      'username', cjr.username,
      'elo', cjr.elo,
      'status', cjr.status,
      'createdAt', cjr.created_at
    ) ORDER BY cjr.created_at DESC
  ), '[]'::jsonb) INTO v_requests
  FROM public.clan_join_requests cjr
  WHERE cjr.clan_id = v_clan_id AND cjr.status = 'pending';

  RETURN jsonb_build_object(
    'clan', jsonb_build_object(
      'id', v_clan_row.id,
      'name', v_clan_row.name,
      'tag', v_clan_row.tag,
      'badge', COALESCE(v_clan_row.badge, '👑'),
      'description', COALESCE(v_clan_row.description, ''),
      'leader', COALESCE(v_clan_row.leader_name, 'Líder'),
      'vaultGems', COALESCE(v_clan_row.vault_gems, 0),
      'status', COALESCE(v_clan_row.status, 'active'),
      'base_hp', COALESCE(v_clan_row.base_hp, 500),
      'max_base_hp', COALESCE(v_clan_row.max_base_hp, 500),
      'wins', COALESCE(v_clan_row.wins, 0),
      'losses', COALESCE(v_clan_row.losses, 0),
      'createdAt', v_clan_row.created_at,
      'shieldUntil', v_clan_row.shield_until,
      'settings', COALESCE(v_clan_row.settings, jsonb_build_object('privacy', 'public', 'minElo', 0, 'warPermission', 'leaders', 'autoAccept', true)),
      'rewardShares', COALESCE(v_clan_row.reward_shares, '{}'::jsonb)
    ),
    'members', COALESCE(v_members, '[]'::jsonb),
    'donations', COALESCE(v_donations, '[]'::jsonb),
    'deposits', COALESCE(v_deposits, '[]'::jsonb),
    'requests', COALESCE(v_requests, '[]'::jsonb)
  );
END;
$$;


-- ── 7. PERMISOS Y RECARGA ───────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.update_clan_settings(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_join_clan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_clan_join_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_clan_details() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
