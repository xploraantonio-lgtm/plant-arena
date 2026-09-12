-- =============================================================================
-- MIGRACIÓN 116: SISTEMA DE INVITACIONES DIRECTAS A CLANES
--
-- 1. Tabla public.clan_invitations:
--    - Gestiona invitaciones enviadas directamente por el Líder a jugadores.
-- 2. RPC send_clan_invitation:
--    - Valida que el emisor sea el Líder del clan.
--    - Valida que el destinatario exista, no tenga clan y no tenga invitación pendiente.
-- 3. RPC respond_clan_invitation:
--    - Si acepta: valida y descuenta 200 Gemas, transfiere al tesoro e incorpora al clan.
--    - Si rechaza: descarta la invitación sin costo.
-- 4. RPC get_my_clan_invitations:
--    - Retorna invitaciones pendientes para el jugador en el Lobby.
-- =============================================================================

BEGIN;

-- ── 1. TABLA DE INVITACIONES DE CLAN ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clan_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id         UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inviter_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'cancelled'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clan_invitations_user_status ON public.clan_invitations(invited_user_id, status);
CREATE INDEX IF NOT EXISTS idx_clan_invitations_clan_status ON public.clan_invitations(clan_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_invitations_unique_pending 
  ON public.clan_invitations(clan_id, invited_user_id) 
  WHERE status = 'pending';

ALTER TABLE public.clan_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clan_invitations_select_policy ON public.clan_invitations;
CREATE POLICY clan_invitations_select_policy ON public.clan_invitations
  FOR SELECT TO authenticated
  USING (
    invited_user_id = auth.uid() OR
    inviter_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.clans c
       WHERE c.id = clan_invitations.clan_id AND c.leader_id = auth.uid()
    )
  );


-- ── 2. RPC: ENVIAR INVITACIÓN DE CLAN (Solo Líder) ───────────────────────────

CREATE OR REPLACE FUNCTION public.send_clan_invitation(
  p_clan_id         UUID,
  p_target_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clan        RECORD;
  v_target      RECORD;
  v_member_cnt  INTEGER;
  v_inv_id      UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED', 'message', 'Debes iniciar sesión.');
  END IF;

  IF p_clan_id IS NULL OR p_target_username IS NULL OR TRIM(p_target_username) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARAMS', 'message', 'Parámetros incompletos.');
  END IF;

  -- 1. Validar que el emisor sea el Líder del clan
  SELECT * INTO v_clan FROM public.clans WHERE id = p_clan_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_NOT_FOUND', 'message', 'Clan no encontrado.');
  END IF;

  IF v_clan.leader_id != v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_LEADER', 'message', 'Solo el Líder del clan puede enviar invitaciones.');
  END IF;

  -- 2. Validar cupo disponible (< 15 miembros)
  SELECT COUNT(*) INTO v_member_cnt FROM public.clan_members WHERE clan_id = p_clan_id;
  IF v_member_cnt >= 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_FULL', 'message', 'El clan ya alcanzó el límite de 15 miembros.');
  END IF;

  -- 3. Buscar perfil del destinatario
  SELECT id, username INTO v_target 
    FROM public.profiles 
   WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_target_username)) 
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAYER_NOT_FOUND', 'message', 'No se encontró a ningún jugador con ese nombre.');
  END IF;

  -- 4. No puede auto-invitarse
  IF v_target.id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_INVITE_SELF', 'message', 'No puedes invitarte a ti mismo.');
  END IF;

  -- 5. Validar que el jugador no pertenezca ya a un clan
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_target.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_IN_CLAN', 'message', 'Este jugador ya pertenece a un clan.');
  END IF;

  -- 6. Validar que no tenga ya una invitación pendiente de este clan
  IF EXISTS (
    SELECT 1 FROM public.clan_invitations 
     WHERE clan_id = p_clan_id AND invited_user_id = v_target.id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITATION_ALREADY_SENT', 'message', 'Ya enviaste una invitación a este jugador.');
  END IF;

  -- 7. Insertar invitación
  INSERT INTO public.clan_invitations (clan_id, invited_user_id, inviter_id, status)
  VALUES (p_clan_id, v_target.id, v_uid, 'pending')
  RETURNING id INTO v_inv_id;

  -- 8. Auditoría
  IF to_regclass('public.clan_audit_logs') IS NOT NULL THEN
    INSERT INTO public.clan_audit_logs (
      clan_id, clan_name, action, performed_by, performed_by_name, details
    ) VALUES (
      p_clan_id, v_clan.name, 'INVITE_SENT', v_uid, 
      (SELECT username FROM public.profiles WHERE id = v_uid),
      jsonb_build_object('invited_username', v_target.username, 'invitation_id', v_inv_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', '¡Invitación enviada con éxito a ' || v_target.username || '!',
    'invitation_id', v_inv_id,
    'target_username', v_target.username
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_clan_invitation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_clan_invitation(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_clan_invitation(UUID, TEXT) TO authenticated;


-- ── 3. RPC: RESPONDER INVITACIÓN DE CLAN (Aceptar / Rechazar) ─────────────────

CREATE OR REPLACE FUNCTION public.respond_clan_invitation(
  p_invitation_id UUID,
  p_accept        BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_inv         RECORD;
  v_clan        RECORD;
  v_profile     RECORD;
  v_member_cnt  INTEGER;
  c_FEE         CONSTANT NUMERIC := 200.0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED', 'message', 'Debes iniciar sesión.');
  END IF;

  -- 1. Obtener la invitación
  SELECT * INTO v_inv 
    FROM public.clan_invitations 
   WHERE id = p_invitation_id 
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITATION_NOT_FOUND', 'message', 'Invitación no encontrada.');
  END IF;

  IF v_inv.invited_user_id != v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Esta invitación no te pertenece.');
  END IF;

  IF v_inv.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITATION_RESOLVED', 'message', 'Esta invitación ya fue procesada anteriormente.');
  END IF;

  -- 2. Si el jugador RECHAZA
  IF p_accept IS FALSE THEN
    UPDATE public.clan_invitations
       SET status     = 'rejected',
           updated_at = NOW()
     WHERE id = p_invitation_id;

    RETURN jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Invitación rechazada.');
  END IF;

  -- 3. Si el jugador ACEPTA
  -- 3a. Validar que el jugador no pertenezca a ningún clan
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_IN_CLAN', 'message', 'Ya perteneces a un clan.');
  END IF;

  -- 3b. Validar que el clan exista y tenga cupo
  SELECT * INTO v_clan FROM public.clans WHERE id = v_inv.clan_id FOR UPDATE;
  IF NOT FOUND OR v_clan.is_active IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_NOT_ACTIVE', 'message', 'El clan ya no se encuentra activo.');
  END IF;

  SELECT COUNT(*) INTO v_member_cnt FROM public.clan_members WHERE clan_id = v_inv.clan_id;
  IF v_member_cnt >= 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAN_FULL', 'message', 'El clan ya alcanzó el cupo máximo de 15 miembros.');
  END IF;

  -- 3c. Validar y bloquear saldo del jugador (200 Gemas 💎)
  SELECT gems_balance, username, elo_rating INTO v_profile 
    FROM public.profiles 
   WHERE id = v_uid 
     FOR UPDATE;

  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < c_FEE THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'INSUFFICIENT_GEMS', 
      'message', 'Saldo insuficiente. Se requieren 200 Gemas 💎 para ingresar al clan.'
    );
  END IF;

  -- 3d. Descontar 200 Gemas al usuario
  UPDATE public.profiles
     SET gems_balance = gems_balance - c_FEE,
         updated_at   = NOW()
   WHERE id = v_uid;

  -- 3e. Inyectar 200 Gemas al Tesoro del Clan y reactivar si estaba derrotado
  UPDATE public.clans
     SET vault_gems = COALESCE(vault_gems, 0) + c_FEE,
         status     = 'active',
         updated_at = NOW()
   WHERE id = v_inv.clan_id;

  -- 3f. Incorporar al clan
  INSERT INTO public.clan_members (clan_id, user_id, role, donated_count, joined_at)
  VALUES (v_inv.clan_id, v_uid, 'member', 0, NOW());

  -- 3g. Marcar invitación como aceptada y cancelar cualquier otra solicitud
  UPDATE public.clan_invitations
     SET status     = 'accepted',
         updated_at = NOW()
   WHERE id = p_invitation_id;

  IF to_regclass('public.clan_join_requests') IS NOT NULL THEN
    EXECUTE 'UPDATE public.clan_join_requests SET status = ''cancelled'', updated_at = NOW() WHERE user_id = $1 AND status = ''pending''' USING v_uid;
  END IF;

  -- 3h. Transacciones y auditoría
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (
    v_uid,
    'clan_join',
    c_FEE,
    'Cuota de ingreso por invitación al Clan ' || v_clan.name,
    'completed'
  );

  IF to_regclass('public.clan_audit_logs') IS NOT NULL THEN
    INSERT INTO public.clan_audit_logs (
      clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
    ) VALUES (
      v_inv.clan_id, v_clan.name, 'INVITE_ACCEPTED', v_uid, v_profile.username, c_FEE,
      jsonb_build_object(
        'invitation_id', p_invitation_id,
        'inviter_id', v_inv.inviter_id,
        'vault_gems', COALESCE(v_clan.vault_gems, 0) + c_FEE
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'accepted',
    'clan_id', v_inv.clan_id,
    'clan_name', v_clan.name,
    'message', '¡Te has unido exitosamente al clan ' || v_clan.name || '!'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_clan_invitation(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_clan_invitation(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.respond_clan_invitation(UUID, BOOLEAN) TO authenticated;


-- ── 4. RPC: OBTENER MIS INVITACIONES PENDIENTES (Para el Lobby) ───────────────

CREATE OR REPLACE FUNCTION public.get_my_clan_invitations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_res       JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Si el usuario ya está en un clan, no mostrar invitaciones
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ci.id,
        'clanId', c.id,
        'clanName', c.name,
        'clanTag', c.tag,
        'clanBadge', c.badge,
        'clanDescription', c.description,
        'leaderName', lp.username,
        'createdAt', ci.created_at
      ) ORDER BY ci.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_res
  FROM public.clan_invitations ci
  JOIN public.clans c ON c.id = ci.clan_id
  JOIN public.profiles lp ON lp.id = c.leader_id
  WHERE ci.invited_user_id = v_uid
    AND ci.status = 'pending'
    AND c.is_active = TRUE;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_clan_invitations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_clan_invitations() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_clan_invitations() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
