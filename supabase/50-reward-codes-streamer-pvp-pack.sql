-- =============================================================================
-- MIGRACIÓN 50: SISTEMA DE CÓDIGOS DE RECOMPENSA STREAMER (PACK PvP TEMPORIZADO)
--
-- REGLAS DE SEGURIDAD Y ARQUITECTURA:
-- 1. Server-Authoritative: toda validación en PostgreSQL SECURITY DEFINER.
-- 2. No modifica ELO, ni gemas/tokens, ni entrega cartas o sobres abiertos.
-- 3. Genera un pack PvP en un hueco de pack_slots con status='locked', duración
--    aleatoria (2, 4, 8 o 12 horas) y arena_level correspondiente al ELO.
-- 4. Bloqueo transaccional FOR UPDATE sobre reward_codes y unicidad estricta
--    UNIQUE(reward_code_id, user_id) en reward_code_claims para evitar doble canje.
-- 5. Si los 4 huecos están llenos, la RPC falla con SLOTS_FULL y NO consume el código.
-- =============================================================================

BEGIN;

-- ── 1. TABLA DE CÓDIGOS DE RECOMPENSA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  normalized_code TEXT NOT NULL,
  reward_type     TEXT NOT NULL DEFAULT 'pvp_pack' CHECK (reward_type IN ('pvp_pack')),
  reward_value    INTEGER NOT NULL DEFAULT 1 CHECK (reward_value > 0),
  max_uses        INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count      INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  CONSTRAINT uq_reward_codes_normalized UNIQUE (normalized_code)
);

CREATE INDEX IF NOT EXISTS idx_reward_codes_lookup 
  ON public.reward_codes (normalized_code) 
  WHERE active = TRUE;

-- RLS: Tabla restringida para el cliente (sólo modificable/consultable vía RPCs)
ALTER TABLE public.reward_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reward_codes FROM anon, authenticated, PUBLIC;


-- ── 2. TABLA DE USOS / CANJES DE CÓDIGOS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_code_claims (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_code_id         UUID NOT NULL REFERENCES public.reward_codes(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  claimed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_pack_slot_id INTEGER NOT NULL CHECK (generated_pack_slot_id BETWEEN 0 AND 3),
  CONSTRAINT uq_reward_code_user_claim UNIQUE (reward_code_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_code_claims_user 
  ON public.reward_code_claims (user_id, claimed_at DESC);

ALTER TABLE public.reward_code_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reward_code_claims_select_own" ON public.reward_code_claims;
CREATE POLICY "reward_code_claims_select_own" ON public.reward_code_claims
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.reward_code_claims FROM anon, authenticated, PUBLIC;


-- ── 3. FUNCIÓN AUXILIAR INTERNA DE CREACIÓN DE PACK SLOT ──────────────────────
-- Reutiliza la misma lógica autoritativa que _award_victory_chest_for (17-emparejamiento.sql)
CREATE OR REPLACE FUNCTION public._award_reward_pack_slot_for(p_uid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elo    INTEGER;
  v_arena  INTEGER;
  v_libre  INTEGER;
  v_dur    INTEGER;
BEGIN
  IF p_uid IS NULL THEN 
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'sin_usuario'); 
  END IF;

  SELECT elo_rating INTO v_elo FROM public.profiles WHERE id = p_uid;

  -- Nivel de arena según ELO (mismos tramos que arenaManager.ts y _award_victory_chest_for)
  v_arena := CASE
    WHEN COALESCE(v_elo, 1000) >= 3100 THEN 5
    WHEN COALESCE(v_elo, 1000) >= 2050 THEN 4
    WHEN COALESCE(v_elo, 1000) >= 1750 THEN 3
    WHEN COALESCE(v_elo, 1000) >= 1600 THEN 2
    ELSE 1
  END;

  -- Buscar primer hueco libre en 0..3
  SELECT i INTO v_libre FROM generate_series(0,3) AS i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pack_slots ps
      WHERE ps.user_id = p_uid AND ps.slot_index = i AND ps.status <> 'empty'
   )
   ORDER BY i LIMIT 1;

  IF v_libre IS NULL THEN
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'huecos_llenos');
  END IF;

  -- Duración aleatoria estricta: 2, 4, 8 o 12 horas
  v_dur := (ARRAY[2,4,8,12])[1 + floor(random() * 4)::INTEGER];

  -- Insertar o actualizar el hueco con status='locked' y reloj sin arrancar
  INSERT INTO public.pack_slots
    (user_id, slot_index, status, duration_hours, arena_level, unlock_started_at, awarded_at)
  VALUES (p_uid, v_libre, 'locked', v_dur, v_arena, NULL, NOW())
  ON CONFLICT (user_id, slot_index) DO UPDATE
    SET status = 'locked',
        duration_hours = EXCLUDED.duration_hours,
        arena_level = EXCLUDED.arena_level,
        unlock_started_at = NULL,
        awarded_at = NOW();

  RETURN jsonb_build_object(
    'awarded', TRUE,
    'slotId', v_libre,
    'durationHours', v_dur,
    'arenaLevel', v_arena
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._award_reward_pack_slot_for(UUID) FROM anon, authenticated, PUBLIC;


-- ── 4. RPC PÚBLICA SEGURA: claim_reward_code ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_reward_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clean_code  TEXT;
  v_code_row    RECORD;
  v_pack_result JSONB;
  v_slot_id     INTEGER;
  v_dur_hours   INTEGER;
  v_arena_lvl   INTEGER;
BEGIN
  -- 1. Obtener usuario autenticado
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Normalizar código (trim y uppercase)
  v_clean_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'CODE_EMPTY';
  END IF;

  -- 3 & 4. Buscar y bloquear fila con SELECT FOR UPDATE (previene condiciones de carrera)
  SELECT * INTO v_code_row
    FROM public.reward_codes
   WHERE normalized_code = v_clean_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CODE_NOT_FOUND';
  END IF;

  IF v_code_row.active = FALSE THEN
    RAISE EXCEPTION 'CODE_DISABLED';
  END IF;

  IF v_code_row.expires_at IS NOT NULL AND NOW() > v_code_row.expires_at THEN
    RAISE EXCEPTION 'CODE_EXPIRED';
  END IF;

  -- Verificar si este usuario ya canjeó este código (prioridad sobre límite global)
  IF EXISTS (
    SELECT 1 FROM public.reward_code_claims
     WHERE reward_code_id = v_code_row.id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'CODE_ALREADY_CLAIMED';
  END IF;

  IF v_code_row.used_count >= v_code_row.max_uses THEN
    RAISE EXCEPTION 'CODE_LIMIT_REACHED';
  END IF;

  -- 5. Crear pack PvP reutilizando la lógica de pack_slots
  v_pack_result := public._award_reward_pack_slot_for(v_uid);

  IF NOT COALESCE((v_pack_result->>'awarded')::BOOLEAN, FALSE) THEN
    IF (v_pack_result->>'reason') = 'huecos_llenos' THEN
      RAISE EXCEPTION 'SLOTS_FULL';
    ELSE
      RAISE EXCEPTION 'COULD_NOT_AWARD_PACK: %', (v_pack_result->>'reason');
    END IF;
  END IF;

  v_slot_id   := (v_pack_result->>'slotId')::INTEGER;
  v_dur_hours := (v_pack_result->>'durationHours')::INTEGER;
  v_arena_lvl := (v_pack_result->>'arenaLevel')::INTEGER;

  -- 6. Registrar claim en reward_code_claims
  INSERT INTO public.reward_code_claims
    (reward_code_id, user_id, claimed_at, generated_pack_slot_id)
  VALUES
    (v_code_row.id, v_uid, NOW(), v_slot_id);

  -- 7. Incrementar used_count
  UPDATE public.reward_codes
     SET used_count = used_count + 1
   WHERE id = v_code_row.id;

  -- Retornar resultado
  RETURN jsonb_build_object(
    'success', TRUE,
    'code', v_clean_code,
    'slotId', v_slot_id,
    'durationHours', v_dur_hours,
    'arenaLevel', v_arena_lvl
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_reward_code(TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_reward_code(TEXT) TO authenticated;


-- ── 5. CÓDIGOS INICIALES (39 CÓDIGOS) ──────────────────────────────────────────
INSERT INTO public.reward_codes (code, normalized_code, reward_type, reward_value, max_uses, used_count, active)
VALUES
  -- 10 VARIANTES DE TKSITO (STREAMER)
  ('TKSITO',          'TKSITO',          'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOPVP',       'TKSITOPVP',       'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOPLANT',     'TKSITOPLANT',     'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOKING',      'TKSITOKING',      'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOARENA',     'TKSITOARENA',     'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOPRO',       'TKSITOPRO',       'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOGOD',       'TKSITOGOD',       'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOFAMILY',    'TKSITOFAMILY',    'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOPACK',      'TKSITOPACK',      'pvp_pack', 1, 1, 0, TRUE),
  ('TKSITOSTREAM',    'TKSITOSTREAM',    'pvp_pack', 1, 1, 0, TRUE),

  -- 10 VARIANTES DE FLAME (STREAMER)
  ('FLAME',           'FLAME',           'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEPVP',        'FLAMEPVP',        'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEPLANT',      'FLAMEPLANT',      'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEKING',       'FLAMEKING',       'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEARENA',      'FLAMEARENA',      'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEPRO',        'FLAMEPRO',        'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEGOD',        'FLAMEGOD',        'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEFAMILY',     'FLAMEFAMILY',     'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMEPACK',       'FLAMEPACK',       'pvp_pack', 1, 1, 0, TRUE),
  ('FLAMESTREAM',     'FLAMESTREAM',     'pvp_pack', 1, 1, 0, TRUE),

  -- 10 CÓDIGOS DE EVENTOS Y ARENA
  ('ARENA2026',       'ARENA2026',       'pvp_pack', 1, 1, 0, TRUE),
  ('BATTLEARENA',     'BATTLEARENA',     'pvp_pack', 1, 1, 0, TRUE),
  ('ARENACHAMPION',   'ARENACHAMPION',   'pvp_pack', 1, 1, 0, TRUE),
  ('HYPERBATTLE',     'HYPERBATTLE',     'pvp_pack', 1, 1, 0, TRUE),
  ('VICTORYCHEST',    'VICTORYCHEST',    'pvp_pack', 1, 1, 0, TRUE),
  ('COLOSSEUMKING',   'COLOSSEUMKING',   'pvp_pack', 1, 1, 0, TRUE),
  ('TOURNAMENTPACK',  'TOURNAMENTPACK',  'pvp_pack', 1, 1, 0, TRUE),
  ('ARENAMASTER',     'ARENAMASTER',     'pvp_pack', 1, 1, 0, TRUE),
  ('BATTLECHEST',     'BATTLECHEST',     'pvp_pack', 1, 1, 0, TRUE),
  ('ROYALVICTORY',    'ROYALVICTORY',    'pvp_pack', 1, 1, 0, TRUE),

  -- 9 CÓDIGOS GENERALES
  ('PLANTKING',       'PLANTKING',       'pvp_pack', 1, 1, 0, TRUE),
  ('GREENPOWER',      'GREENPOWER',      'pvp_pack', 1, 1, 0, TRUE),
  ('SUNMASTER',       'SUNMASTER',       'pvp_pack', 1, 1, 0, TRUE),
  ('LEGENDARYGARDEN', 'LEGENDARYGARDEN', 'pvp_pack', 1, 1, 0, TRUE),
  ('SOLARFLARE',      'SOLARFLARE',      'pvp_pack', 1, 1, 0, TRUE),
  ('CHOMPERPRO',      'CHOMPERPRO',      'pvp_pack', 1, 1, 0, TRUE),
  ('PEASHOOTER99',    'PEASHOOTER99',    'pvp_pack', 1, 1, 0, TRUE),
  ('WALLNUTSHIELD',   'WALLNUTSHIELD',   'pvp_pack', 1, 1, 0, TRUE),
  ('PLANTMASTER',     'PLANTMASTER',     'pvp_pack', 1, 1, 0, TRUE)
ON CONFLICT (normalized_code) DO NOTHING;

COMMIT;
