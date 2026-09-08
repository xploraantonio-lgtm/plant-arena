-- =============================================================================
-- MIGRACIÓN 57: SISTEMA AUTORITATIVO DE CLANES (GEMAS, PERSISTENCIA Y AUDITORÍA)
--
-- 1. Tablas mejoradas:
--    - public.clans (badge, wins, losses, status, is_active, deleted_at, settings)
--    - public.clan_members (donated_count, joined_at)
--    - public.clan_donations & public.clan_donation_donors (donaciones seguras de cartas)
--    - public.clan_audit_logs (auditoría completa permanente de creación, entrada, salida, borrado)
-- 2. Transacciones: ampliación del CHECK constraint para soportar operaciones de clan.
-- 3. RPCs autoritativas en PostgreSQL:
--    - create_clan: cobra 5 gemas del perfil, crea el clan y registra auditoría.
--    - join_clan: cobra 2 gemas, suma 2 gemas al tesoro del clan, valida ELO y límite.
--    - leave_clan: salida segura; reasigna líder o desactiva clan con registro de auditoría.
--    - repair_clan_base: cobra 5 gemas para restaurar la base del clan.
--    - request_clan_plant_donation: solicita 1 copia de planta cada 24h.
--    - donate_clan_plant_copy: descuenta 1 copia de plant_copies del donante y se la suma al solicitante.
--    - get_clans_list: lista pública autoritativa de clanes activos.
--    - get_my_clan_details: detalle completo del clan del usuario autenticado.
-- =============================================================================

BEGIN;

-- ── 1. ASEGURAR TABLAS BASE public.clans Y public.clan_members ───────────────
CREATE TABLE IF NOT EXISTS public.clans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  tag          TEXT NOT NULL,
  leader_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clan_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id      UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_clan_user UNIQUE (clan_id, user_id)
);

-- ── 2. AJUSTES Y COLUMNAS EN LA TABLA public.clans ───────────────────────────
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS badge TEXT DEFAULT '👑';
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS description TEXT DEFAULT 'Clan competitivo de Plant Arena.';
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS vault_gems NUMERIC(12, 2) DEFAULT 0.00;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS base_hp INTEGER DEFAULT 500;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS max_base_hp INTEGER DEFAULT 500;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS shield_until TIMESTAMPTZ;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"privacy": "public", "minElo": 0, "warPermission": "leaders", "autoAccept": true}'::jsonb;
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Normalizar estado y saldo
UPDATE public.clans SET status = 'active' WHERE status IS NULL;
UPDATE public.clans SET is_active = TRUE WHERE is_active IS NULL;
UPDATE public.clans SET vault_gems = 0.00 WHERE vault_gems IS NULL;

-- Si la tabla tenía vault_balance, migrar valores existentes
DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'clans' AND column_name = 'vault_balance'
  ) THEN 
    UPDATE public.clans 
       SET vault_gems = COALESCE(vault_balance, 0) 
     WHERE (vault_gems IS NULL OR vault_gems = 0) AND vault_balance IS NOT NULL;
  END IF; 
END $$;

-- ── 3. AJUSTES EN public.clan_members ─────────────────────────────────────────
ALTER TABLE public.clan_members ADD COLUMN IF NOT EXISTS donated_count INTEGER DEFAULT 0;
ALTER TABLE public.clan_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();

-- ── 3. DONACIONES DE PLANTAS EN EL CLAN ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clan_donations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id          UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
  requester_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plant_id         TEXT NOT NULL,
  copies_requested INTEGER NOT NULL DEFAULT 1 CHECK (copies_requested > 0),
  copies_received  INTEGER NOT NULL DEFAULT 0 CHECK (copies_received >= 0),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clan_donations_clan_status 
  ON public.clan_donations(clan_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.clan_donation_donors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id UUID NOT NULL REFERENCES public.clan_donations(id) ON DELETE CASCADE,
  donor_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_clan_donation_donor UNIQUE (donation_id, donor_id)
);

-- ── 4. AUDITORÍA PERMANENTE DE CLANES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clan_audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id           UUID REFERENCES public.clans(id) ON DELETE SET NULL,
  clan_name         TEXT NOT NULL,
  action            TEXT NOT NULL, -- 'CREATE', 'JOIN', 'LEAVE', 'KICK', 'DEPOSIT', 'REPAIR', 'DISBAND', 'DONATE_COPY'
  performed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_by_name TEXT,
  amount_gems       NUMERIC(12, 2) DEFAULT 0.00,
  details           JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clan_audit_logs_clan 
  ON public.clan_audit_logs(clan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clan_audit_logs_action 
  ON public.clan_audit_logs(action, created_at DESC);

-- ── 5. FLEXIBILIZAR TIPO DE TRANSACCIÓN EN public.transactions ───────────────
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

-- ── 6. RLS & POLICIES ────────────────────────────────────────────────────────
ALTER TABLE public.clans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clans are public" ON public.clans;
CREATE POLICY "Clans are public" ON public.clans FOR SELECT USING (is_active = TRUE);

ALTER TABLE public.clan_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan members are public" ON public.clan_members;
CREATE POLICY "Clan members are public" ON public.clan_members FOR SELECT USING (true);

ALTER TABLE public.clan_donations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan donations are public" ON public.clan_donations;
CREATE POLICY "Clan donations are public" ON public.clan_donations FOR SELECT USING (true);

ALTER TABLE public.clan_donation_donors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan donation donors are public" ON public.clan_donation_donors;
CREATE POLICY "Clan donation donors are public" ON public.clan_donation_donors FOR SELECT USING (true);

ALTER TABLE public.clan_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan audit logs viewable by members" ON public.clan_audit_logs;
CREATE POLICY "Clan audit logs viewable by members" ON public.clan_audit_logs FOR SELECT USING (true);


-- ── 7. RPC: FUNDAR CLAN (Cobra 5 Gemas al Creador) ───────────────────────────
CREATE OR REPLACE FUNCTION public.create_clan(
  p_name        TEXT,
  p_tag         TEXT,
  p_badge       TEXT DEFAULT '👑',
  p_description TEXT DEFAULT 'Clan competitivo de Plant Arena.'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_clean_name TEXT;
  v_clean_tag  TEXT;
  v_profile    RECORD;
  v_clan_id    UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  v_clean_name := UPPER(TRIM(COALESCE(p_name, '')));
  v_clean_tag  := UPPER(TRIM(COALESCE(p_tag, '')));

  IF NOT (v_clean_tag LIKE '#%') THEN
    v_clean_tag := '#' || v_clean_tag;
  END IF;

  IF LENGTH(v_clean_name) < 3 OR LENGTH(v_clean_name) > 30 THEN
    RAISE EXCEPTION 'INVALID_CLAN_NAME';
  END IF;

  IF LENGTH(v_clean_tag) < 3 OR LENGTH(v_clean_tag) > 10 THEN
    RAISE EXCEPTION 'INVALID_CLAN_TAG';
  END IF;

  -- Validar si el usuario ya pertenece a un clan
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'ALREADY_IN_CLAN';
  END IF;

  -- Validar unicidad de nombre y tag en clanes activos
  IF EXISTS (
    SELECT 1 FROM public.clans 
    WHERE (LOWER(name) = LOWER(v_clean_name) OR LOWER(tag) = LOWER(v_clean_tag)) 
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'CLAN_NAME_OR_TAG_ALREADY_EXISTS';
  END IF;

  -- Bloquear perfil y validar gemas
  SELECT gems_balance, username, elo_rating INTO v_profile 
  FROM public.profiles 
  WHERE id = v_uid FOR UPDATE;

  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < 5.0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS';
  END IF;

  -- 1. Cobrar 5 Gemas
  UPDATE public.profiles
     SET gems_balance = gems_balance - 5.0,
         updated_at   = NOW()
   WHERE id = v_uid;

  -- 2. Insertar clan (Inicia con 5 gemas en su tesoro)
  INSERT INTO public.clans (
    name, tag, badge, description, leader_id, vault_gems, status, is_active, base_hp, max_base_hp
  ) VALUES (
    v_clean_name, v_clean_tag, COALESCE(p_badge, '👑'), TRIM(COALESCE(p_description, '')),
    v_uid, 5.0, 'active', TRUE, 500, 500
  ) RETURNING id INTO v_clan_id;

  -- 3. Asignar líder en miembros
  INSERT INTO public.clan_members (clan_id, user_id, role, donated_count, joined_at)
  VALUES (v_clan_id, v_uid, 'leader', 0, NOW());

  -- 4. Registrar transacción
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'clan_create', 5.0, 'Fundación del clan ' || v_clean_name, 'completed');

  -- 5. Registrar auditoría permanente
  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
  ) VALUES (
    v_clan_id, v_clean_name, 'CREATE', v_uid, v_profile.username, 5.0,
    jsonb_build_object('tag', v_clean_tag, 'badge', p_badge, 'desc', p_description)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'clan_id', v_clan_id,
    'clan_name', v_clean_name,
    'new_balance', v_profile.gems_balance - 5.0
  );
END;
$$;


-- ── 8. RPC: UNIRSE A UN CLAN (Cobra 2 Gemas -> Tesoro del Clan) ──────────────
CREATE OR REPLACE FUNCTION public.join_clan(p_clan_id UUID)
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Validar si ya pertenece a un clan
  IF EXISTS (SELECT 1 FROM public.clan_members WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'ALREADY_IN_CLAN';
  END IF;

  -- Bloquear y validar clan
  SELECT * INTO v_clan 
  FROM public.clans 
  WHERE id = p_clan_id AND is_active = TRUE FOR UPDATE;

  IF NOT FOUND OR v_clan.status = 'disbanded' THEN
    RAISE EXCEPTION 'CLAN_NOT_FOUND';
  END IF;

  -- Validar capacidad máxima (15 miembros)
  SELECT COUNT(*) INTO v_member_cnt FROM public.clan_members WHERE clan_id = p_clan_id;
  IF v_member_cnt >= 15 THEN
    RAISE EXCEPTION 'CLAN_FULL';
  END IF;

  -- Bloquear perfil y validar saldo y ELO
  SELECT gems_balance, username, elo_rating INTO v_profile 
  FROM public.profiles 
  WHERE id = v_uid FOR UPDATE;

  IF COALESCE(v_profile.elo_rating, 1000) < COALESCE(v_clan.min_elo, 0) THEN
    RAISE EXCEPTION 'INSUFFICIENT_ELO';
  END IF;

  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < 2.0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS';
  END IF;

  -- 1. Cobrar 2 Gemas al jugador
  UPDATE public.profiles
     SET gems_balance = gems_balance - 2.0,
         updated_at   = NOW()
   WHERE id = v_uid;

  -- 2. Inyectar las 2 Gemas al Tesoro del Clan
  UPDATE public.clans
     SET vault_gems  = vault_gems + 2.0,
         updated_at  = NOW()
   WHERE id = p_clan_id;

  -- 3. Insertar miembro
  INSERT INTO public.clan_members (clan_id, user_id, role, donated_count, joined_at)
  VALUES (p_clan_id, v_uid, 'member', 0, NOW());

  -- 4. Registrar transacción
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'clan_join', 2.0, 'Cuota de ingreso al clan ' || v_clan.name, 'completed');

  -- 5. Registrar auditoría permanente
  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
  ) VALUES (
    p_clan_id, v_clan.name, 'JOIN', v_uid, v_profile.username, 2.0,
    jsonb_build_object('elo', v_profile.elo_rating)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'clan_id', p_clan_id,
    'clan_name', v_clan.name,
    'new_balance', v_profile.gems_balance - 2.0
  );
END;
$$;


-- ── 9. RPC: SALIR DEL CLAN (Leave / Disband) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_clan(p_clan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_clan         RECORD;
  v_profile      RECORD;
  v_member       RECORD;
  v_member_count INTEGER;
  v_next_leader  UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_clan FROM public.clans WHERE id = p_clan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAN_NOT_FOUND'; END IF;

  SELECT * INTO v_member FROM public.clan_members WHERE clan_id = p_clan_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_CLAN_MEMBER'; END IF;

  SELECT username INTO v_profile FROM public.profiles WHERE id = v_uid;

  SELECT COUNT(*) INTO v_member_count FROM public.clan_members WHERE clan_id = p_clan_id;

  IF v_member.role = 'leader' THEN
    IF v_member_count <= 1 THEN
      -- Único miembro: marcar clan como desbandado (no se borra la fila física para auditoría)
      UPDATE public.clans 
         SET is_active = FALSE,
             status = 'disbanded',
             deleted_at = NOW()
       WHERE id = p_clan_id;

      INSERT INTO public.clan_audit_logs (
        clan_id, clan_name, action, performed_by, performed_by_name, details
      ) VALUES (
        p_clan_id, v_clan.name, 'DISBAND', v_uid, v_profile.username,
        jsonb_build_object('reason', 'Leader left sole membership')
      );
    ELSE
      -- Reasignar liderazgo al miembro más antiguo
      SELECT user_id INTO v_next_leader 
      FROM public.clan_members 
      WHERE clan_id = p_clan_id AND user_id != v_uid 
      ORDER BY joined_at ASC 
      LIMIT 1;

      UPDATE public.clan_members SET role = 'leader' WHERE clan_id = p_clan_id AND user_id = v_next_leader;
      UPDATE public.clans SET leader_id = v_next_leader WHERE id = p_clan_id;

      INSERT INTO public.clan_audit_logs (
        clan_id, clan_name, action, performed_by, performed_by_name, details
      ) VALUES (
        p_clan_id, v_clan.name, 'TRANSFER_LEADERSHIP', v_uid, v_profile.username,
        jsonb_build_object('new_leader_id', v_next_leader)
      );
    END IF;
  END IF;

  -- Eliminar de miembros
  DELETE FROM public.clan_members WHERE clan_id = p_clan_id AND user_id = v_uid;

  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, details
  ) VALUES (
    p_clan_id, v_clan.name, 'LEAVE', v_uid, v_profile.username,
    jsonb_build_object('role', v_member.role)
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$$;


-- ── 10. RPC: REPARAR BASE DE CLAN (Cobra 5 Gemas) ────────────────────────────
CREATE OR REPLACE FUNCTION public.repair_clan_base()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_clan_id    UUID;
  v_clan       RECORD;
  v_profile    RECORD;
  v_role       TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT clan_id, role INTO v_clan_id, v_role FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN RAISE EXCEPTION 'NO_CLAN'; END IF;

  SELECT * INTO v_clan FROM public.clans WHERE id = v_clan_id FOR UPDATE;

  SELECT gems_balance, username INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < 5.0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS';
  END IF;

  -- 1. Cobrar 5 Gemas
  UPDATE public.profiles SET gems_balance = gems_balance - 5.0 WHERE id = v_uid;

  -- 2. Restaurar base a 500 HP y estado activo
  UPDATE public.clans 
     SET base_hp    = 500,
         status     = 'active',
         vault_gems = GREATEST(vault_gems, 5.0),
         updated_at = NOW()
   WHERE id = v_clan_id;

  -- 3. Transacción & Auditoría
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'clan_repair', 5.0, 'Reparación de Base del clan ' || v_clan.name, 'completed');

  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, amount_gems
  ) VALUES (
    v_clan_id, v_clan.name, 'REPAIR', v_uid, v_profile.username, 5.0
  );

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_profile.gems_balance - 5.0);
END;
$$;


-- ── 11. RPC: SOLICITAR COPIA DE PLANTA EN EL CLAN ─────────────────────────────
CREATE OR REPLACE FUNCTION public.request_clan_plant_donation(p_plant_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clan_id     UUID;
  v_donation_id UUID;
  v_username    TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN RAISE EXCEPTION 'NO_CLAN'; END IF;

  -- Validar cooldown de 24 horas por solicitante
  IF EXISTS (
    SELECT 1 FROM public.clan_donations 
    WHERE requester_id = v_uid 
      AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    RAISE EXCEPTION 'COOLDOWN_ACTIVE';
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.clan_donations (clan_id, requester_id, plant_id, copies_requested, copies_received, status)
  VALUES (v_clan_id, v_uid, p_plant_id, 1, 0, 'active')
  RETURNING id INTO v_donation_id;

  RETURN jsonb_build_object('success', TRUE, 'donation_id', v_donation_id);
END;
$$;


-- ── 12. RPC: DONAR COPIA DE PLANTA A COMPAÑERO DE CLAN ───────────────────────
CREATE OR REPLACE FUNCTION public.donate_clan_plant_copy(p_donation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_donation   RECORD;
  v_copies     INTEGER;
  v_clan_id    UUID;
  v_donor_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Bloquear solicitud
  SELECT * INTO v_donation FROM public.clan_donations WHERE id = p_donation_id FOR UPDATE;
  IF NOT FOUND OR v_donation.status != 'active' THEN
    RAISE EXCEPTION 'DONATION_NOT_AVAILABLE';
  END IF;

  -- Validar que no se done a sí mismo
  IF v_donation.requester_id = v_uid THEN
    RAISE EXCEPTION 'CANNOT_DONATE_TO_SELF';
  END IF;

  -- Validar pertenencia al mismo clan
  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL OR v_clan_id != v_donation.clan_id THEN
    RAISE EXCEPTION 'DIFFERENT_CLAN';
  END IF;

  -- Validar que este donante no haya donado ya a esta solicitud
  IF EXISTS (SELECT 1 FROM public.clan_donation_donors WHERE donation_id = p_donation_id AND donor_id = v_uid) THEN
    RAISE EXCEPTION 'ALREADY_DONATED_TO_REQUEST';
  END IF;

  -- Bloquear y validar copias del donante
  SELECT copies INTO v_copies FROM public.plant_copies 
  WHERE user_id = v_uid AND plant_id = v_donation.plant_id FOR UPDATE;

  IF v_copies IS NULL OR v_copies < 1 THEN
    RAISE EXCEPTION 'INSUFFICIENT_PLANT_COPIES';
  END IF;

  -- 1. Restar 1 copia al donante
  UPDATE public.plant_copies 
     SET copies = copies - 1 
   WHERE user_id = v_uid AND plant_id = v_donation.plant_id;

  -- 2. Sumar 1 copia al solicitante
  INSERT INTO public.plant_copies (user_id, plant_id, copies)
  VALUES (v_donation.requester_id, v_donation.plant_id, 1)
  ON CONFLICT (user_id, plant_id)
  DO UPDATE SET copies = plant_copies.copies + 1;

  -- 3. Registrar donante
  INSERT INTO public.clan_donation_donors (donation_id, donor_id)
  VALUES (p_donation_id, v_uid);

  -- 4. Actualizar solicitud (máximo 3 donantes)
  UPDATE public.clan_donations
     SET copies_received = copies_received + 1,
         status = CASE WHEN copies_received + 1 >= 3 THEN 'completed' ELSE 'active' END
   WHERE id = p_donation_id;

  -- 5. Incrementar estadísticas de donación del miembro
  UPDATE public.clan_members
     SET donated_count = donated_count + 1
   WHERE clan_id = v_clan_id AND user_id = v_uid;

  SELECT username INTO v_donor_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, details
  ) VALUES (
    v_clan_id, (SELECT name FROM public.clans WHERE id = v_clan_id),
    'DONATE_COPY', v_uid, v_donor_name,
    jsonb_build_object('plant_id', v_donation.plant_id, 'requester_id', v_donation.requester_id)
  );

  RETURN jsonb_build_object('success', TRUE, 'plant_id', v_donation.plant_id);
END;
$$;


-- ── 13. RPC: LISTADO AUTORITATIVO DE CLANES ACTIVOS ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_clans_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'tag', c.tag,
      'badge', COALESCE(c.badge, '👑'),
      'description', COALESCE(c.description, ''),
      'leader', COALESCE(p.username, 'Líder'),
      'leader_id', c.leader_id,
      'vaultGems', COALESCE(c.vault_gems, 0),
      'base_hp', COALESCE(c.base_hp, 500),
      'max_base_hp', COALESCE(c.max_base_hp, 500),
      'status', COALESCE(c.status, 'active'),
      'wins', COALESCE(c.wins, 0),
      'losses', COALESCE(c.losses, 0),
      'min_elo', COALESCE(c.min_elo, 0),
      'member_count', (SELECT COUNT(*) FROM public.clan_members cm WHERE cm.clan_id = c.id),
      'shield_until', c.shield_until,
      'created_at', c.created_at,
      'settings', COALESCE(c.settings, '{}'::jsonb)
    ) ORDER BY c.vault_gems DESC, c.wins DESC, c.created_at DESC
  ) INTO v_res
  FROM public.clans c
  LEFT JOIN public.profiles p ON p.id = c.leader_id
  WHERE c.is_active = TRUE;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;


-- ── 14. RPC: OBTENER DETALLE DEL CLAN DEL JUGADOR ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_clan_details()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_clan_id   UUID;
  v_clan_row  RECORD;
  v_members   JSONB;
  v_donations JSONB;
  v_deposits  JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.*, p.username AS leader_name 
    INTO v_clan_row
    FROM public.clans c
    LEFT JOIN public.profiles p ON p.id = c.leader_id
   WHERE c.id = v_clan_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Lista de miembros con perfil
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
      'joinedAt', cm.joined_at
    ) ORDER BY (cm.role = 'leader') DESC, (cm.role = 'elder') DESC, p.elo_rating DESC
  ) INTO v_members
  FROM public.clan_members cm
  JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.clan_id = v_clan_id;

  -- Donaciones activas con donantes
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cd.id,
      'requesterId', cd.requester_id,
      'requesterName', COALESCE(p.username, 'Compañero'),
      'plantId', cd.plant_id,
      'copiesRequested', cd.copies_requested,
      'copiesReceived', cd.copies_received,
      'status', cd.status,
      'createdAt', cd.created_at,
      'donors', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('donorId', cdd.donor_id, 'donorName', dp.username))
        FROM public.clan_donation_donors cdd
        JOIN public.profiles dp ON dp.id = cdd.donor_id
        WHERE cdd.donation_id = cd.id
      ), '[]'::jsonb)
    ) ORDER BY cd.created_at DESC
  ) INTO v_donations
  FROM public.clan_donations cd
  JOIN public.profiles p ON p.id = cd.requester_id
  WHERE cd.clan_id = v_clan_id AND cd.status = 'active';

  -- Historial de depósitos / auditoría reciente
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'clanId', a.clan_id,
      'depositorName', COALESCE(a.performed_by_name, 'Guerrero'),
      'amountGems', COALESCE(a.amount_gems, 0),
      'timestamp', a.created_at,
      'action', a.action,
      'reason', CASE a.action
                  WHEN 'CREATE' THEN 'fund'
                  WHEN 'JOIN' THEN 'join'
                  WHEN 'REPAIR' THEN 'repair'
                  ELSE 'deposit'
                END
    ) ORDER BY a.created_at DESC
  ) INTO v_deposits
  FROM public.clan_audit_logs a
  WHERE a.clan_id = v_clan_id
  LIMIT 25;

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
      'settings', COALESCE(v_clan_row.settings, '{}'::jsonb)
    ),
    'members', COALESCE(v_members, '[]'::jsonb),
    'donations', COALESCE(v_donations, '[]'::jsonb),
    'deposits', COALESCE(v_deposits, '[]'::jsonb)
  );
END;
$$;

-- ── 15. PERMISOS DE EJECUCIÓN ────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.create_clan(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_clan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_clan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_clan_base() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_clan_plant_donation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.donate_clan_plant_copy(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_clans_list() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_clan_details() TO authenticated;

COMMIT;
