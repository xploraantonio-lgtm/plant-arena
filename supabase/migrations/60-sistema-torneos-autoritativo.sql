-- =============================================================================
-- MIGRACIÓN 60: SISTEMA AUTORITATIVO DE TORNEOS (LOBBY, PREMIOS, MAZO Y 3 DERROTAS)
--
-- 1. Tablas:
--    - public.tournaments (id, title, description, creator_id, prize_pool_gems,
--                          prize_distribution, status, start_time, end_time,
--                          duration_minutes, max_losses, prizes_distributed)
--    - public.tournament_participants (id, tournament_id, user_id, username,
--                                      deck, wins, losses, is_eliminated, prize_awarded_gems)
--    - public.tournament_matches (id, tournament_id, player_id, opponent_name,
--                                 result, player_deck, created_at)
-- 2. RPCs autoritativas en PostgreSQL:
--    - create_tournament: valida hora, descuenta pozo de gemas al creador y programa el torneo.
--    - register_tournament_participant: registra jugador con entrada gratuita y mazo inicial.
--    - update_tournament_deck: valida que el mazo tenga 5 plantas válidas del catálogo libre.
--    - submit_tournament_match_result: registra victoria o derrota; elimina al participante
--      al llegar a 3 derrotas (is_eliminated = TRUE) y rechaza si ya está eliminado.
--    - get_tournaments_list: lista torneos activos, próximos y finalizados con auto-transición.
--    - get_tournament_details: devuelve torneo, ranking en tiempo real y estado del usuario.
--    - finalize_tournament_and_distribute_prizes: reparte las gemas autoritativamente a los ganadores.
-- =============================================================================

BEGIN;

-- ── 1. TABLA public.tournaments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournaments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  description         TEXT DEFAULT 'Torneo oficial abierto de Plant Arena. Entrada libre. Todos contra todos con eliminación a las 3 derrotas.',
  creator_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creator_name        TEXT NOT NULL DEFAULT 'Plant Arena',
  prize_pool_gems     NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  prize_distribution  JSONB NOT NULL DEFAULT '{"top1": 50, "top2": 30, "top3": 20}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'scheduled',
  entry_fee_gems      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  start_time          TIMESTAMPTZ,
  end_time            TIMESTAMPTZ,
  duration_minutes    INTEGER NOT NULL DEFAULT 60,
  max_losses          INTEGER NOT NULL DEFAULT 3,
  prizes_distributed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Si la tabla ya existía de migraciones anteriores (p.ej. schema.sql), añadir columnas que falten
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS description TEXT DEFAULT 'Torneo oficial abierto de Plant Arena. Entrada libre. Todos contra todos con eliminación a las 3 derrotas.';
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS creator_name TEXT NOT NULL DEFAULT 'Plant Arena';
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS prize_pool_gems NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS prize_distribution JSONB NOT NULL DEFAULT '{"top1": 50, "top2": 30, "top3": 20}'::jsonb;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS entry_fee_gems NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS max_losses INTEGER NOT NULL DEFAULT 3;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS prizes_distributed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Migrar columnas heredadas si existían (starts_at / ends_at / type de schema.sql temprano)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'starts_at'
  ) THEN
    UPDATE public.tournaments
       SET start_time = COALESCE(start_time, starts_at)
     WHERE start_time IS NULL;
    ALTER TABLE public.tournaments ALTER COLUMN starts_at DROP NOT NULL;
    ALTER TABLE public.tournaments ALTER COLUMN starts_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'ends_at'
  ) THEN
    UPDATE public.tournaments
       SET end_time = COALESCE(end_time, ends_at)
     WHERE end_time IS NULL;
    ALTER TABLE public.tournaments ALTER COLUMN ends_at DROP NOT NULL;
    ALTER TABLE public.tournaments ALTER COLUMN ends_at SET DEFAULT NOW() + INTERVAL '1 hour';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.tournaments ALTER COLUMN type DROP NOT NULL;
    ALTER TABLE public.tournaments ALTER COLUMN type SET DEFAULT 'free_code';
    ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_type_check;
  END IF;
END $$;

-- Garantizar valores para start_time y end_time antes de aplicar NOT NULL
UPDATE public.tournaments SET start_time = NOW() WHERE start_time IS NULL;
UPDATE public.tournaments SET end_time = NOW() + INTERVAL '1 hour' WHERE end_time IS NULL;
ALTER TABLE public.tournaments ALTER COLUMN start_time SET NOT NULL;
ALTER TABLE public.tournaments ALTER COLUMN end_time SET NOT NULL;

-- Normalizar estados y constraints
UPDATE public.tournaments SET status = 'ended' WHERE status = 'finished';
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check 
  CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled'));

ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_prize_pool_gems_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_prize_pool_gems_check 
  CHECK (prize_pool_gems >= 0);

CREATE INDEX IF NOT EXISTS idx_tournaments_status_start
  ON public.tournaments(status, start_time);

-- ── 2. TABLA public.tournament_participants ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id                  UUID DEFAULT gen_random_uuid(),
  tournament_id       UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username            TEXT NOT NULL DEFAULT 'Gladiador',
  deck                JSONB NOT NULL DEFAULT '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb,
  wins                INTEGER NOT NULL DEFAULT 0,
  losses              INTEGER NOT NULL DEFAULT 0,
  is_eliminated       BOOLEAN NOT NULL DEFAULT FALSE,
  final_rank          INTEGER DEFAULT NULL,
  prize_awarded_gems  NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asegurar columnas si la tabla ya existía de migraciones anteriores
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT 'Gladiador';
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS deck JSONB NOT NULL DEFAULT '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS is_eliminated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS final_rank INTEGER DEFAULT NULL;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS prize_awarded_gems NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tournament_participants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.tournament_participants SET id = gen_random_uuid() WHERE id IS NULL;

-- Poblar nombres de usuario reales en filas que no lo tengan
UPDATE public.tournament_participants tp
   SET username = COALESCE(p.username, 'Gladiador')
  FROM public.profiles p
 WHERE tp.user_id = p.id AND (tp.username IS NULL OR tp.username = '' OR tp.username = 'Gladiador');

-- Asegurar constraint único (tournament_id, user_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_tournament_participant'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.tournament_participants'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.tournament_participants 
      ADD CONSTRAINT uq_tournament_participant UNIQUE (tournament_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tournament_participants_ranking
  ON public.tournament_participants(tournament_id, wins DESC, losses ASC, created_at ASC);

-- ── 3. TABLA public.tournament_matches ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opponent_name  TEXT NOT NULL,
  result         TEXT NOT NULL CHECK (result IN ('victory', 'defeat')),
  player_deck    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_player
  ON public.tournament_matches(tournament_id, player_id, created_at DESC);

-- ── 4. RLS POLICIES ──────────────────────────────────────────────────────────
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tournaments viewable by everyone" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments are public" ON public.tournaments;
CREATE POLICY "Tournaments viewable by everyone" ON public.tournaments FOR SELECT USING (true);

ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants viewable by everyone" ON public.tournament_participants;
DROP POLICY IF EXISTS "Tournament participants are public" ON public.tournament_participants;
CREATE POLICY "Participants viewable by everyone" ON public.tournament_participants FOR SELECT USING (true);

ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Matches viewable by participant" ON public.tournament_matches;
CREATE POLICY "Matches viewable by participant" ON public.tournament_matches
  FOR SELECT USING (auth.uid() = player_id);

-- ── 5. TRANSACCIONES ─────────────────────────────────────────────────────────
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

-- ── 6. LISTA VÁLIDA DE LAS 15 PLANTAS DEL JUEGO ──────────────────────────────
CREATE OR REPLACE FUNCTION public._validate_tournament_deck(p_deck JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_valid_plants TEXT[] := ARRAY[
    'sunflower', 'peashooter', 'repeater', 'wallnut', 'melonpult',
    'chomper', 'bonkchoy', 'garlic', 'squash', 'twinsunflower',
    'threepeater', 'tallnut', 'jalapeno', 'iceberglettuce', 'aloe'
  ];
  v_card TEXT;
  v_count INTEGER := 0;
BEGIN
  IF p_deck IS NULL OR jsonb_typeof(p_deck) <> 'array' THEN
    RETURN FALSE;
  END IF;

  v_count := jsonb_array_length(p_deck);
  IF v_count < 5 OR v_count > 6 THEN
    RETURN FALSE;
  END IF;

  FOR v_card IN SELECT jsonb_array_elements_text(p_deck)
  LOOP
    IF NOT (v_card = ANY(v_valid_plants)) THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ── 7. RPC: CREAR TORNEO (Con Pozo de Gemas, Entrada Free/Gemas y Hora Programada) ─
CREATE OR REPLACE FUNCTION public.create_tournament(
  p_title               TEXT,
  p_description         TEXT,
  p_prize_pool_gems     NUMERIC(12, 2) DEFAULT 0.00,
  p_start_time          TIMESTAMPTZ DEFAULT NOW(),
  p_duration_minutes    INTEGER DEFAULT 60,
  p_prize_distribution JSONB DEFAULT '{"top1": 50, "top2": 30, "top3": 20}'::jsonb,
  p_entry_fee_gems      NUMERIC(12, 2) DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_user       RECORD;
  v_clean_name TEXT;
  v_clean_desc TEXT;
  v_tourn_id   UUID;
  v_end_time   TIMESTAMPTZ;
  v_pool       NUMERIC(12, 2) := COALESCE(p_prize_pool_gems, 0.00);
  v_entry_fee  NUMERIC(12, 2) := COALESCE(p_entry_fee_gems, 0.00);
  v_duration   INTEGER := COALESCE(p_duration_minutes, 60);
  v_start_time TIMESTAMPTZ := COALESCE(p_start_time, NOW());
  v_status     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_clean_name := TRIM(COALESCE(p_title, ''));
  v_clean_desc := TRIM(COALESCE(p_description, ''));

  IF LENGTH(v_clean_name) < 3 OR LENGTH(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_TITLE_LENGTH';
  END IF;

  IF v_duration < 5 OR v_duration > 1440 THEN
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;

  IF v_pool < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_PRIZE_POOL';
  END IF;

  IF v_entry_fee < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_ENTRY_FEE';
  END IF;

  SELECT username, is_admin, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  -- Solo administradores pueden crear torneos oficiales
  IF v_user.is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'ONLY_ADMIN_CAN_CREATE_TOURNAMENTS';
  END IF;

  -- Si el creador aporta gemas al pozo, validar y descontar
  IF v_pool > 0 THEN
    IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_pool THEN
      RAISE EXCEPTION 'INSUFFICIENT_GEMS';
    END IF;

    UPDATE public.profiles
       SET gems_balance = gems_balance - v_pool,
           updated_at   = NOW()
     WHERE id = v_uid;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'tournament_create_fund', v_pool, 'Fondeo de pozo de torneo: ' || v_clean_name, 'completed');
  END IF;

  -- Calcular fin del torneo
  v_end_time := v_start_time + (v_duration || ' minutes')::INTERVAL;

  IF NOW() >= v_start_time AND NOW() < v_end_time THEN
    v_status := 'live';
  ELSIF NOW() >= v_end_time THEN
    v_status := 'ended';
  ELSE
    v_status := 'scheduled';
  END IF;

  INSERT INTO public.tournaments (
    title, description, creator_id, creator_name, prize_pool_gems,
    prize_distribution, status, entry_fee_gems, start_time, end_time,
    duration_minutes, max_losses, prizes_distributed
  ) VALUES (
    v_clean_name, v_clean_desc, v_uid, COALESCE(v_user.username, 'Organizador'),
    v_pool, COALESCE(p_prize_distribution, '{"top1": 50, "top2": 30, "top3": 20}'::jsonb),
    v_status, v_entry_fee, v_start_time, v_end_time, v_duration, 3, FALSE
  ) RETURNING id INTO v_tourn_id;

  -- Inscribir automáticamente al creador con mazo inicial
  INSERT INTO public.tournament_participants (
    tournament_id, user_id, username, deck, wins, losses, is_eliminated
  ) VALUES (
    v_tourn_id, v_uid, COALESCE(v_user.username, 'Organizador'),
    '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb,
    0, 0, FALSE
  ) ON CONFLICT (tournament_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', v_tourn_id,
    'title', v_clean_name,
    'prize_pool_gems', v_pool,
    'entry_fee_gems', v_entry_fee,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'status', v_status
  );
END;
$$;

-- ── 8. RPC: REGISTRARSE AL TORNEO (Entrada Free/Gemas y Mazo Inicial) ─────────
CREATE OR REPLACE FUNCTION public.register_tournament_participant(
  p_tournament_id UUID,
  p_deck          JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_user      RECORD;
  v_tourn     RECORD;
  v_deck      JSONB;
  v_part_id   UUID;
  v_fee       NUMERIC(12, 2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  IF v_tourn.status = 'ended' OR v_tourn.status = 'cancelled' OR NOW() >= v_tourn.end_time THEN
    RAISE EXCEPTION 'TOURNAMENT_CLOSED';
  END IF;

  -- Si ya estaba registrado, no cobrar nuevamente
  IF EXISTS (
    SELECT 1 FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'ALREADY_REGISTERED',
      'tournament_id', p_tournament_id
    );
  END IF;

  v_fee := COALESCE(v_tourn.entry_fee_gems, 0.00);

  SELECT username, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  -- Si la entrada requiere gemas, validar y cobrar autoritativamente
  IF v_fee > 0 THEN
    IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_fee THEN
      RAISE EXCEPTION 'INSUFFICIENT_GEMS_FOR_ENTRY';
    END IF;

    UPDATE public.profiles
       SET gems_balance = gems_balance - v_fee,
           updated_at   = NOW()
     WHERE id = v_uid;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_uid, 'tournament_entry_fee', v_fee,
      'Entrada a torneo: ' || v_tourn.title, 'completed'
    );

    -- Sumar la entrada al pozo del torneo para alimentar los premios
    UPDATE public.tournaments
       SET prize_pool_gems = prize_pool_gems + v_fee,
           updated_at      = NOW()
     WHERE id = p_tournament_id;
  END IF;

  -- Si se pasa un mazo personalizado, validarlo
  IF p_deck IS NOT NULL THEN
    IF NOT public._validate_tournament_deck(p_deck) THEN
      RAISE EXCEPTION 'INVALID_TOURNAMENT_DECK';
    END IF;
    v_deck := p_deck;
  ELSE
    v_deck := '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb;
  END IF;

  INSERT INTO public.tournament_participants (
    tournament_id, user_id, username, deck, wins, losses, is_eliminated
  ) VALUES (
    p_tournament_id, v_uid, COALESCE(v_user.username, 'Jugador'),
    v_deck, 0, 0, FALSE
  )
  ON CONFLICT (tournament_id, user_id) DO UPDATE
    SET username = EXCLUDED.username
  RETURNING id INTO v_part_id;

  RETURN jsonb_build_object(
    'success', true,
    'participant_id', v_part_id,
    'tournament_id', p_tournament_id,
    'deck', v_deck,
    'wins', 0,
    'losses', 0,
    'is_eliminated', false,
    'fee_paid_gems', v_fee
  );
END;
$$;

-- ── 9. RPC: GUARDAR MAZO EXCLUSIVO DEL TORNEO (Todas las Cartas Desbloqueadas) ─
CREATE OR REPLACE FUNCTION public.update_tournament_deck(
  p_tournament_id UUID,
  p_deck          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_part RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public._validate_tournament_deck(p_deck) THEN
    RAISE EXCEPTION 'INVALID_TOURNAMENT_DECK';
  END IF;

  SELECT * INTO v_part
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_REGISTERED';
  END IF;

  IF v_part.is_eliminated THEN
    RAISE EXCEPTION 'PLAYER_ALREADY_ELIMINATED';
  END IF;

  UPDATE public.tournament_participants
     SET deck       = p_deck,
         updated_at = NOW()
   WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'deck', p_deck
  );
END;
$$;

-- ── 10. RPC: REPORTAR RESULTADO DE COMBATE DE TORNEO (Regla de 3 Derrotas) ────
CREATE OR REPLACE FUNCTION public.submit_tournament_match_result(
  p_tournament_id UUID,
  p_result        TEXT,
  p_opponent_name TEXT DEFAULT 'Rival de Torneo'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_tourn        RECORD;
  v_part         RECORD;
  v_new_wins     INTEGER;
  v_new_losses   INTEGER;
  v_eliminated   BOOLEAN;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_result NOT IN ('victory', 'defeat') THEN
    RAISE EXCEPTION 'INVALID_MATCH_RESULT';
  END IF;

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  -- Comprobar si el torneo ya terminó
  IF v_now >= v_tourn.end_time OR v_tourn.status = 'ended' THEN
    IF v_tourn.status <> 'ended' THEN
      UPDATE public.tournaments SET status = 'ended', updated_at = v_now WHERE id = p_tournament_id;
    END IF;
    RAISE EXCEPTION 'TOURNAMENT_ENDED';
  END IF;

  -- Comprobar si aún no ha comenzado
  IF v_now < v_tourn.start_time THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_STARTED';
  END IF;

  -- Si estaba 'scheduled' y ya pasó la hora de inicio, actualizar a 'live'
  IF v_tourn.status = 'scheduled' AND v_now >= v_tourn.start_time THEN
    UPDATE public.tournaments SET status = 'live', updated_at = v_now WHERE id = p_tournament_id;
  END IF;

  SELECT * INTO v_part
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_REGISTERED';
  END IF;

  -- VALIDACIÓN ESTRICTA DE 3 DERROTAS
  IF v_part.is_eliminated OR v_part.losses >= v_tourn.max_losses THEN
    RAISE EXCEPTION 'PLAYER_ALREADY_ELIMINATED';
  END IF;

  IF p_result = 'victory' THEN
    v_new_wins := v_part.wins + 1;
    v_new_losses := v_part.losses;
    v_eliminated := FALSE;
  ELSE
    v_new_wins := v_part.wins;
    v_new_losses := v_part.losses + 1;
    v_eliminated := (v_new_losses >= v_tourn.max_losses);
  END IF;

  UPDATE public.tournament_participants
     SET wins          = v_new_wins,
         losses        = v_new_losses,
         is_eliminated = v_eliminated,
         updated_at    = v_now
   WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  INSERT INTO public.tournament_matches (
    tournament_id, player_id, opponent_name, result, player_deck
  ) VALUES (
    p_tournament_id, v_uid, COALESCE(p_opponent_name, 'Rival de Torneo'), p_result, v_part.deck
  );

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'wins', v_new_wins,
    'losses', v_new_losses,
    'max_losses', v_tourn.max_losses,
    'is_eliminated', v_eliminated
  );
END;
$$;

-- ── 11. RPC: LISTA PÚBLICA DE TORNEOS CON AUTO-ACTUALIZACIÓN DE ESTADO ───────
CREATE OR REPLACE FUNCTION public.get_tournaments_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_res JSONB;
BEGIN
  -- Auto-transición en caliente de estados de torneos
  UPDATE public.tournaments
     SET status = 'live', updated_at = v_now
   WHERE status = 'scheduled' AND v_now >= start_time AND v_now < end_time;

  UPDATE public.tournaments
     SET status = 'ended', updated_at = v_now
   WHERE status IN ('scheduled', 'live') AND v_now >= end_time;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'description', t.description,
      'creator_id', t.creator_id,
      'creator_name', t.creator_name,
      'prize_pool_gems', t.prize_pool_gems,
      'prize_distribution', t.prize_distribution,
      'status', t.status,
      'entry_fee_gems', t.entry_fee_gems,
      'start_time', t.start_time,
      'end_time', t.end_time,
      'duration_minutes', t.duration_minutes,
      'max_losses', t.max_losses,
      'prizes_distributed', t.prizes_distributed,
      'participants_count', (
        SELECT COUNT(*) FROM public.tournament_participants tp WHERE tp.tournament_id = t.id
      ),
      'active_participants_count', (
        SELECT COUNT(*) FROM public.tournament_participants tp WHERE tp.tournament_id = t.id AND tp.is_eliminated = FALSE
      )
    ) ORDER BY
      CASE t.status
        WHEN 'live' THEN 1
        WHEN 'scheduled' THEN 2
        ELSE 3
      END,
      t.start_time ASC
  ) INTO v_res
  FROM public.tournaments t;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

-- ── 12. RPC: DETALLE DE TORNEO CON LEADERBOARD Y ESTADO DEL JUGADOR ──────────
CREATE OR REPLACE FUNCTION public.get_tournament_details(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tourn     RECORD;
  v_my_part   RECORD;
  v_lb        JSONB;
  v_now       TIMESTAMPTZ := NOW();
BEGIN
  -- Auto-transición si procede
  UPDATE public.tournaments
     SET status = CASE
           WHEN v_now >= end_time THEN 'ended'
           WHEN v_now >= start_time AND v_now < end_time THEN 'live'
           ELSE status
         END,
         updated_at = v_now
   WHERE id = p_tournament_id
     AND ((status = 'scheduled' AND v_now >= start_time) OR (status <> 'ended' AND v_now >= end_time));

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  -- Leaderboard
  SELECT jsonb_agg(
    jsonb_build_object(
      'rank', sub.row_num,
      'user_id', sub.user_id,
      'username', sub.username,
      'wins', sub.wins,
      'losses', sub.losses,
      'is_eliminated', sub.is_eliminated,
      'is_me', (v_uid IS NOT NULL AND sub.user_id = v_uid),
      'prize_awarded_gems', sub.prize_awarded_gems
    )
  ) INTO v_lb
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY tp.wins DESC, tp.losses ASC, tp.created_at ASC) AS row_num,
      tp.user_id,
      tp.username,
      tp.wins,
      tp.losses,
      tp.is_eliminated,
      tp.prize_awarded_gems
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = p_tournament_id
  ) sub;

  -- Mi participación
  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_my_part
    FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', v_tourn.id,
      'title', v_tourn.title,
      'description', v_tourn.description,
      'creator_id', v_tourn.creator_id,
      'creator_name', v_tourn.creator_name,
      'prize_pool_gems', v_tourn.prize_pool_gems,
      'prize_distribution', v_tourn.prize_distribution,
      'status', v_tourn.status,
      'entry_fee_gems', v_tourn.entry_fee_gems,
      'start_time', v_tourn.start_time,
      'end_time', v_tourn.end_time,
      'duration_minutes', v_tourn.duration_minutes,
      'max_losses', v_tourn.max_losses,
      'prizes_distributed', v_tourn.prizes_distributed
    ),
    'leaderboard', COALESCE(v_lb, '[]'::jsonb),
    'my_participation', CASE
      WHEN v_my_part.id IS NOT NULL THEN jsonb_build_object(
        'registered', true,
        'deck', v_my_part.deck,
        'wins', v_my_part.wins,
        'losses', v_my_part.losses,
        'is_eliminated', v_my_part.is_eliminated,
        'prize_awarded_gems', v_my_part.prize_awarded_gems
      )
      ELSE jsonb_build_object('registered', false)
    END
  );
END;
$$;

-- ── 13. RPC: FINALIZAR TORNEO Y REPARTIR GEMAS A LOS GANADORES ───────────────
CREATE OR REPLACE FUNCTION public.finalize_tournament_and_distribute_prizes(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tourn     RECORD;
  v_pool      NUMERIC(12, 2);
  v_top1_pct  NUMERIC;
  v_top2_pct  NUMERIC;
  v_top3_pct  NUMERIC;
  v_part      RECORD;
  v_rank      INTEGER := 0;
  v_prize     NUMERIC(12, 2);
  v_payouts   JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  IF v_tourn.prizes_distributed THEN
    RETURN jsonb_build_object('success', true, 'message', 'PRIZES_ALREADY_DISTRIBUTED');
  END IF;

  v_pool := v_tourn.prize_pool_gems;

  UPDATE public.tournaments
     SET status = 'ended', prizes_distributed = TRUE, updated_at = NOW()
   WHERE id = p_tournament_id;

  IF v_pool <= 0 THEN
    RETURN jsonb_build_object('success', true, 'message', 'NO_PRIZE_POOL_TO_DISTRIBUTE');
  END IF;

  v_top1_pct := COALESCE((v_tourn.prize_distribution->>'top1')::NUMERIC, 50.0);
  v_top2_pct := COALESCE((v_tourn.prize_distribution->>'top2')::NUMERIC, 30.0);
  v_top3_pct := COALESCE((v_tourn.prize_distribution->>'top3')::NUMERIC, 20.0);

  FOR v_part IN
    SELECT tp.id, tp.user_id, tp.username, tp.wins, tp.losses
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = p_tournament_id AND tp.wins > 0
    ORDER BY tp.wins DESC, tp.losses ASC, tp.created_at ASC
    LIMIT 3
  LOOP
    v_rank := v_rank + 1;
    IF v_rank = 1 THEN
      v_prize := ROUND(v_pool * (v_top1_pct / 100.0), 2);
    ELSIF v_rank = 2 THEN
      v_prize := ROUND(v_pool * (v_top2_pct / 100.0), 2);
    ELSIF v_rank = 3 THEN
      v_prize := ROUND(v_pool * (v_top3_pct / 100.0), 2);
    END IF;

    IF v_prize > 0 THEN
      -- Otorgar gemas en profiles
      UPDATE public.profiles
         SET gems_balance = gems_balance + v_prize,
             updated_at   = NOW()
       WHERE id = v_part.user_id;

      -- Actualizar participante
      UPDATE public.tournament_participants
         SET final_rank = v_rank, prize_awarded_gems = v_prize, updated_at = NOW()
       WHERE tournament_id = p_tournament_id AND user_id = v_part.user_id;

      -- Registrar transacción
      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      VALUES (
        v_part.user_id, 'tournament_prize_payout', v_prize,
        'Premio Torneo #' || v_rank || ' en: ' || v_tourn.title, 'completed'
      );

      v_payouts := v_payouts || jsonb_build_object(
        'rank', v_rank,
        'user_id', v_part.user_id,
        'username', v_part.username,
        'prize_gems', v_prize
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'payouts', v_payouts
  );
END;
$$;

-- ── 14. RPC: REENTRADA AL TORNEO (3 Gemas por 2 Vidas) ────────────────────────
CREATE OR REPLACE FUNCTION public.reenter_tournament(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_tourn        RECORD;
  v_user         RECORD;
  v_part         RECORD;
  v_reentry_cost NUMERIC(12, 2) := 3.00;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  -- Solo se puede reentrar en torneos activos / en vivo
  IF v_tourn.status = 'ended' OR v_tourn.status = 'cancelled' OR v_now >= v_tourn.end_time THEN
    RAISE EXCEPTION 'TOURNAMENT_CLOSED';
  END IF;

  -- Buscar al participante
  SELECT * INTO v_part
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_REGISTERED';
  END IF;

  -- Debe estar eliminado para reentrar
  IF NOT v_part.is_eliminated AND v_part.losses < v_tourn.max_losses THEN
    RAISE EXCEPTION 'PLAYER_NOT_ELIMINATED';
  END IF;

  -- Validar saldo del jugador
  SELECT username, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_reentry_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS_FOR_REENTRY';
  END IF;

  -- Descontar las 3 gemas de reentrada
  UPDATE public.profiles
     SET gems_balance = gems_balance - v_reentry_cost,
         updated_at   = v_now
   WHERE id = v_uid;

  -- Registrar transacción (ingreso para el pool general del juego)
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (
    v_uid, 'tournament_reentry', v_reentry_cost,
    'Reentrada (2 vidas) en torneo: ' || v_tourn.title, 'completed'
  );

  -- Otorgar 2 vidas: con max_losses = 3, tener 2 vidas equivale a 1 derrota (3 - 2 = 1)
  -- El jugador conserva todas sus victorias previas para la tabla de clasificación
  UPDATE public.tournament_participants
     SET is_eliminated = FALSE,
         losses        = 1,
         updated_at    = v_now
   WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'wins', v_part.wins,
    'losses', 1,
    'lives', 2,
    'is_eliminated', false,
    'cost_gems', v_reentry_cost
  );
END;
$$;

COMMIT;
