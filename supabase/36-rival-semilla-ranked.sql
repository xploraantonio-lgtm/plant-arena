-- =============================================================================
-- PLANTS ARENA · MIGRACIÓN 36
-- RIVAL SEMILLA RANKED V1 (ASYNC OPPONENTS)
--
-- Implementa el sistema de Rivales Semilla exclusivamente para Ranked.
-- Cuando un jugador espera >= 60 segundos en cola sin encontrar un rival humano,
-- el servidor comprueba primero la prioridad humana y, si sigue sin haber humano,
-- crea una partida asíncrona contra un snapshot histórico verificado con nueva
-- semilla RNG, nombre/avatar inventados y liquidación autoritativa.
--
-- Principios de seguridad:
--   1. player1_id = usuario_real, player2_id = NULL, is_async_match = TRUE.
--   2. La cuenta fuente NUNCA se modifica.
--   3. Coliseo, Amistoso y Torneo quedan completamente aislados (sólo humanos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLA INTERNA ranked_async_opponents
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ranked_async_opponents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_room_id UUID NOT NULL,
  source_side SMALLINT NOT NULL CHECK (source_side IN (1, 2)),
  rating_snapshot INTEGER NOT NULL,
  deck_snapshot JSONB NOT NULL,
  actions_snapshot JSONB NOT NULL,
  source_engine_version TEXT NOT NULL,
  source_duration_ticks INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ranked_async_opponents_source UNIQUE(source_room_id, source_side)
);

CREATE INDEX IF NOT EXISTS idx_ranked_async_opponents_active_rating
  ON public.ranked_async_opponents (active, rating_snapshot);

-- Server-only: ningún cliente anon o authenticated puede acceder directamente.
ALTER TABLE public.ranked_async_opponents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranked_async_opponents FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.ranked_async_opponents TO service_role;


-- -----------------------------------------------------------------------------
-- 2. EXTENDER game_rooms PARA PARTIDAS ASÍNCRONAS
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ALTER COLUMN player2_id DROP NOT NULL;

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS is_async_match BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS async_opponent_id UUID REFERENCES public.ranked_async_opponents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS async_display_name TEXT,
  ADD COLUMN IF NOT EXISTS async_avatar_id TEXT,
  ADD COLUMN IF NOT EXISTS async_rating_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS async_deck_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS async_actions_snapshot JSONB;

-- Actualizar política de lectura de salas para permitir player2_id nulo
DROP POLICY IF EXISTS "rooms_select_own" ON public.game_rooms;
CREATE POLICY "rooms_select_own" ON public.game_rooms
  FOR SELECT TO authenticated
  USING (
    auth.uid() = player1_id
    OR (player2_id IS NOT NULL AND auth.uid() = player2_id)
  );


-- -----------------------------------------------------------------------------
-- 3. CAPTURA DEL POOL DE RIVALES SEMILLA DESDE PARTIDAS VERIFICADAS
-- -----------------------------------------------------------------------------
/**
 * Captura snapshots de intenciones y mazo a partir de una partida Ranked humana
 * verificada con éxito.
 */
CREATE OR REPLACE FUNCTION public.capture_ranked_async_opponents_from_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_duration INTEGER;
  v_illegal_count INTEGER;
  v_p1_rating INTEGER;
  v_p2_rating INTEGER;
  v_p1_actions JSONB;
  v_p2_actions JSONB;
  v_p1_plant_count INTEGER;
  v_p2_plant_count INTEGER;
  v_captured_sides INTEGER := 0;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'room_not_found');
  END IF;

  -- Criterios estrictos de elegibilidad
  IF v_room.mode <> 'ranked' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'mode_not_ranked');
  END IF;

  IF COALESCE(v_room.is_async_match, FALSE) = TRUE THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_async_match');
  END IF;

  IF v_room.settled_at IS NULL OR v_room.verification_status <> 'verified' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_settled_or_not_verified');
  END IF;

  IF v_room.player1_id IS NULL OR v_room.player2_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_human_players');
  END IF;

  IF v_room.p1_deck IS NULL OR v_room.p2_deck IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_deck_snapshots');
  END IF;

  -- Comprobar que no hubo acciones ilegales en la verificación
  v_illegal_count := COALESCE((v_room.verification_payload->>'illegalCount')::INTEGER, 0);
  IF v_illegal_count > 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'had_illegal_actions');
  END IF;

  v_duration := COALESCE((v_room.verification_payload->>'ticks')::INTEGER, 0);
  IF v_duration < 300 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'duration_too_short');
  END IF;

  -- Lado 1 (player1_id)
  SELECT COALESCE(elo_rating, 1000) INTO v_p1_rating
    FROM public.profiles WHERE id = v_room.player1_id;

  SELECT COUNT(*) INTO v_p1_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind = 'plant';

  IF v_p1_plant_count >= 3 THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'seq', seq,
        'tick', tick,
        'issuedTick', COALESCE(issued_tick, GREATEST(0, tick - 6)),
        'kind', kind,
        'plantId', plant_id,
        'slot', slot,
        'lane', lane,
        'col', col
      ) ORDER BY COALESCE(issued_tick, tick) ASC, id ASC
    ), '[]'::JSONB)
    INTO v_p1_actions
    FROM public.match_actions
    WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind IN ('plant', 'dig');

    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      source_duration_ticks,
      active,
      created_at
    ) VALUES (
      p_room_id,
      1,
      v_p1_rating,
      v_room.p1_deck,
      v_p1_actions,
      COALESCE(v_room.engine_version, 'auth-v1'),
      v_duration,
      TRUE,
      NOW()
    ) ON CONFLICT (source_room_id, source_side) DO UPDATE
      SET rating_snapshot = EXCLUDED.rating_snapshot,
          deck_snapshot = EXCLUDED.deck_snapshot,
          actions_snapshot = EXCLUDED.actions_snapshot,
          source_duration_ticks = EXCLUDED.source_duration_ticks,
          active = TRUE;

    v_captured_sides := v_captured_sides + 1;
  END IF;

  -- Lado 2 (player2_id)
  SELECT COALESCE(elo_rating, 1000) INTO v_p2_rating
    FROM public.profiles WHERE id = v_room.player2_id;

  SELECT COUNT(*) INTO v_p2_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind = 'plant';

  IF v_p2_plant_count >= 3 THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'seq', seq,
        'tick', tick,
        'issuedTick', COALESCE(issued_tick, GREATEST(0, tick - 6)),
        'kind', kind,
        'plantId', plant_id,
        'slot', slot,
        'lane', lane,
        'col', col
      ) ORDER BY COALESCE(issued_tick, tick) ASC, id ASC
    ), '[]'::JSONB)
    INTO v_p2_actions
    FROM public.match_actions
    WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind IN ('plant', 'dig');

    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      source_duration_ticks,
      active,
      created_at
    ) VALUES (
      p_room_id,
      2,
      v_p2_rating,
      v_room.p2_deck,
      v_p2_actions,
      COALESCE(v_room.engine_version, 'auth-v1'),
      v_duration,
      TRUE,
      NOW()
    ) ON CONFLICT (source_room_id, source_side) DO UPDATE
      SET rating_snapshot = EXCLUDED.rating_snapshot,
          deck_snapshot = EXCLUDED.deck_snapshot,
          actions_snapshot = EXCLUDED.actions_snapshot,
          source_duration_ticks = EXCLUDED.source_duration_ticks,
          active = TRUE;

    v_captured_sides := v_captured_sides + 1;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'capturedSides', v_captured_sides);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- 4. SELECCIÓN DE RIVAL SEMILLA (RPC claim_ranked_async_opponent)
-- -----------------------------------------------------------------------------
/**
 * Solicita emparejamiento con un Rival Semilla tras >= 60 segundos en Ranked.
 * Garantiza PRIORIDAD HUMANA ABSOLUTA reintentando emparejamiento humano antes
 * de generar la sala asíncrona.
 */
CREATE OR REPLACE FUNCTION public.claim_ranked_async_opponent()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_queue          RECORD;
  v_matched_q      RECORD;
  v_waited         INTEGER;
  v_human_room     UUID;
  v_player_elo     INTEGER := 1000;
  v_player_deck    JSONB;
  v_candidate      RECORD;
  v_recent         UUID[];
  v_random_name    TEXT;
  v_random_avatar  TEXT;
  v_new_seed       INTEGER;
  v_new_room_id    UUID;
  v_names          TEXT[] := ARRAY[
    'LeafStorm', 'SolarFox', 'PeaKnight', 'GreenNova', 'GardenWolf',
    'BloomRush', 'NightLeaf', 'SunRider', 'FloraGuard', 'SporeStrike',
    'BrambleFang', 'MossRanger', 'ThornBlade', 'RootWalker', 'VineVanguard',
    'PetalFury', 'BarkTitan', 'FernStriker', 'ShadowSprout', 'TimberWolf'
  ];
  v_avatars        TEXT[] := ARRAY['1', '2', '3', '4', '5', '6', '7', '8'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Bloquear fila de cola del usuario para evitar carreras
  SELECT * INTO v_queue
    FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status = 'searching'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Si ya fue emparejado en paralelo mientras entraba la llamada
    SELECT * INTO v_matched_q
      FROM public.matchmaking_queue
     WHERE user_id = v_uid AND status = 'matched'
     ORDER BY created_at DESC LIMIT 1;

    IF FOUND AND v_matched_q.matched_room_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'matched', TRUE,
        'roomId', v_matched_q.matched_room_id,
        'isAsyncMatch', FALSE
      );
    END IF;

    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_en_cola');
  END IF;

  -- Modo exclusivo Ranked
  IF v_queue.mode <> 'ranked' THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'modo_no_permitido');
  END IF;

  -- Comprobar tiempo esperado (mínimo 60 segundos)
  v_waited := EXTRACT(EPOCH FROM (NOW() - v_queue.created_at))::INTEGER;
  IF v_waited < 60 THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'tiempo_insuficiente',
      'waitedSeconds', v_waited
    );
  END IF;

  -- ── PRIORIDAD HUMANA ABSOLUTA ─────────────────────────────────────────────
  -- Comprobar de nuevo si existe un rival humano elegible en este instante
  v_human_room := public._try_match(v_uid);
  IF v_human_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_human_room,
      'isAsyncMatch', FALSE
    );
  END IF;

  -- ── SELECCIÓN DEL CANDIDATO SEMILLA ───────────────────────────────────────
  SELECT COALESCE(elo_rating, 1000) INTO v_player_elo
    FROM public.profiles WHERE id = v_uid;

  v_player_deck := public._active_deck_for(v_uid);

  -- Lista de los últimos 10 Rivales Semilla usados por este jugador para anti-repetición
  SELECT COALESCE(array_agg(async_opponent_id), ARRAY[]::UUID[])
    INTO v_recent
    FROM (
      SELECT async_opponent_id
        FROM public.game_rooms
       WHERE player1_id = v_uid
         AND is_async_match = TRUE
         AND async_opponent_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10
    ) s;

  -- Rango Tier 1: ±200 ELO (excluyendo recientes si hay alternativa)
  SELECT * INTO v_candidate
    FROM public.ranked_async_opponents
   WHERE active = TRUE
     AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
     AND id <> ALL(v_recent)
   ORDER BY random()
   LIMIT 1;

  IF NOT FOUND THEN
    -- Tier 1 sin exclusión de recientes
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Rango Tier 2: ±400 ELO (excluyendo recientes)
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
       AND id <> ALL(v_recent)
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Tier 2 sin exclusión de recientes
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Rango Tier 3: Cualquier candidato activo
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND id <> ALL(v_recent)
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Tier 3 sin exclusión
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_hay_candidato_semilla');
  END IF;

  -- ── GENERAR METADATOS INVENTADOS Y SEMILLA RNG NUEVA ──────────────────────
  v_random_name := v_names[1 + floor(random() * array_length(v_names, 1))::INTEGER];
  v_random_avatar := v_avatars[1 + floor(random() * array_length(v_avatars, 1))::INTEGER];
  -- Semilla RNG completamente NUEVA e independiente
  v_new_seed := FLOOR(100000 + random() * 899999)::INTEGER;

  -- ── CREAR LA SALA ASÍNCRONA ───────────────────────────────────────────────
  INSERT INTO public.game_rooms (
    mode,
    player1_id,
    player2_id,
    seed,
    p1_deck,
    p2_deck,
    status,
    is_async_match,
    async_opponent_id,
    async_display_name,
    async_avatar_id,
    async_rating_snapshot,
    async_deck_snapshot,
    async_actions_snapshot,
    engine_version,
    created_at
  ) VALUES (
    'ranked',
    v_uid,
    NULL,
    v_new_seed,
    v_player_deck,
    v_candidate.deck_snapshot,
    'playing',
    TRUE,
    v_candidate.id,
    v_random_name,
    v_random_avatar,
    v_candidate.rating_snapshot,
    v_candidate.deck_snapshot,
    v_candidate.actions_snapshot,
    'auth-v1',
    NOW()
  ) RETURNING id INTO v_new_room_id;

  -- Actualizar cola
  UPDATE public.matchmaking_queue
     SET status = 'matched',
         matched_room_id = v_new_room_id,
         matched_at = NOW()
   WHERE id = v_queue.id;

  RETURN jsonb_build_object(
    'matched', TRUE,
    'roomId', v_new_room_id,
    'isAsyncMatch', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_ranked_async_opponent() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ranked_async_opponent() TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. LIQUIDACIÓN ELO ASÍNCRONA (RPC settle_verified_async_ranked_match)
-- -----------------------------------------------------------------------------
/**
 * Liquida una partida asíncrona de Ranked verificada por el árbitro autoritativo.
 * Actualiza ÚNICAMENTE el perfil del jugador real (player1_id).
 */
CREATE OR REPLACE FUNCTION public.settle_verified_async_ranked_match(
  p_room_id UUID,
  p_winner_side SMALLINT,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room        RECORD;
  v_elo_p1      INTEGER;
  v_mas         INTEGER := 0;
  v_menos       INTEGER := 0;
  v_cofre       JSONB := NULL;
  v_recent_wins INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  IF p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winner_side inválido (debe ser 1 o 2)';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF COALESCE(v_room.is_async_match, FALSE) <> TRUE THEN
    RAISE EXCEPTION 'No es una partida asíncrona';
  END IF;

  IF v_room.mode <> 'ranked' THEN
    RAISE EXCEPTION 'Sólo para partidas Ranked';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'ya_liquidada',
      'winner', v_room.server_winner_id
    );
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  SELECT elo_rating INTO v_elo_p1
    FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;

  IF p_winner_side = 1 THEN
    -- Victoria del jugador real
    v_mas := (public._elo_deltas(v_elo_p1)->>'win')::INTEGER;

    -- Anti-farming: no otorgar cofre si ya se ganó contra la misma Semilla en la última hora
    SELECT COUNT(*) INTO v_recent_wins
      FROM public.game_rooms
     WHERE player1_id = v_room.player1_id
       AND async_opponent_id = v_room.async_opponent_id
       AND status = 'p1_won'
       AND settled_at > NOW() - INTERVAL '1 hour'
       AND id <> p_room_id;

    IF v_recent_wins = 0 THEN
      v_cofre := public._award_victory_chest_for(v_room.player1_id);
    ELSE
      v_cofre := jsonb_build_object('awarded', FALSE, 'reason', 'anti_farming_same_opponent');
    END IF;

    UPDATE public.profiles
       SET elo_rating = elo_rating + v_mas
     WHERE id = v_room.player1_id;

    UPDATE public.game_rooms
       SET status = 'p1_won',
           settled_at = NOW(),
           verification_status = 'verified',
           verified_at = NOW(),
           server_winner_id = v_room.player1_id,
           verification_note = 'server_verified_async',
           verification_payload = COALESCE(p_payload, '{}'::JSONB)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', v_room.player1_id,
      'winnerSide', 1,
      'mode', 'ranked',
      'eloGained', v_mas,
      'eloLost', 0,
      'chest', v_cofre,
      'isAsyncMatch', TRUE
    );
  ELSE
    -- Derrota del jugador real
    v_menos := (public._elo_deltas(v_elo_p1)->>'lose')::INTEGER;

    UPDATE public.profiles
       SET elo_rating = GREATEST(0, elo_rating - v_menos)
     WHERE id = v_room.player1_id;

    UPDATE public.game_rooms
       SET status = 'p2_won',
           settled_at = NOW(),
           verification_status = 'verified',
           verified_at = NOW(),
           server_winner_id = NULL,
           verification_note = 'server_verified_async',
           verification_payload = COALESCE(p_payload, '{}'::JSONB)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'winnerSide', 2,
      'mode', 'ranked',
      'eloGained', 0,
      'eloLost', v_menos,
      'isAsyncMatch', TRUE
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) TO service_role;


-- -----------------------------------------------------------------------------
-- 6. ACTUALIZAR game_room_info PARA PARTIDAS ASÍNCRONAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_room_info(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT r.*,
         p1.username AS p1_nombre, p1.avatar_id AS p1_avatar, p1.elo_rating AS p1_elo,
         p2.username AS p2_nombre, p2.avatar_id AS p2_avatar, p2.elo_rating AS p2_elo
    INTO v_room
    FROM public.game_rooms r
    LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
    LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
   WHERE r.id = p_room_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  -- Comprobación de pertenencia segura con soporte para player2_id nulo en async
  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id',        v_room.id,
    'mode',      v_room.mode,
    'seed',      v_room.seed,
    'status',    v_room.status,
    'colosseumBet', v_room.colosseum_bet,
    'p1Deck',    v_room.p1_deck,
    'p2Deck',    CASE WHEN v_room.is_async_match THEN v_room.async_deck_snapshot ELSE v_room.p2_deck END,
    'player1',   jsonb_build_object(
                   'id', v_room.player1_id,
                   'username', v_room.p1_nombre,
                   'avatarId', v_room.p1_avatar,
                   'elo', v_room.p1_elo
                 ),
    'player2',   CASE
                   WHEN v_room.is_async_match THEN
                     jsonb_build_object(
                       'id', COALESCE(v_room.async_opponent_id, '00000000-0000-0000-0000-000000000000'::UUID),
                       'username', v_room.async_display_name,
                       'avatarId', v_room.async_avatar_id,
                       'elo', v_room.async_rating_snapshot
                     )
                   ELSE
                     jsonb_build_object(
                       'id', v_room.player2_id,
                       'username', v_room.p2_nombre,
                       'avatarId', v_room.p2_avatar,
                       'elo', v_room.p2_elo
                     )
                 END,
    'iAm',       CASE WHEN v_uid = v_room.player1_id THEN 'p1' ELSE 'p2' END,
    'isAsyncMatch', COALESCE(v_room.is_async_match, FALSE),
    'asyncActionsSnapshot', CASE WHEN v_room.is_async_match THEN v_room.async_actions_snapshot ELSE NULL END,
    'startedAt', v_room.started_at,
    'serverNow', NOW()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.game_room_info(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.game_room_info(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. ACTUALIZAR submit_match_action, report_match_result Y surrender_match
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_room_id     UUID,
  p_seq         INTEGER,
  p_tick        INTEGER,
  p_kind        TEXT,
  p_plant       TEXT DEFAULT NULL,
  p_lane        SMALLINT DEFAULT NULL,
  p_col         SMALLINT DEFAULT NULL,
  p_slot        SMALLINT DEFAULT NULL,
  p_issued_tick INTEGER DEFAULT NULL,
  p_target_id   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_room      RECORD;
  v_tic_ahora INTEGER;
  v_atras     INTEGER;
  v_adelante  INTEGER;
  v_tope      INTEGER;
  v_cuantas   INTEGER;
  v_id        BIGINT;
  v_inicio    TIMESTAMPTZ;
  v_existente RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_seq IS NULL OR p_seq <= 0 THEN RAISE EXCEPTION 'seq inválido'; END IF;
  IF p_tick IS NULL OR p_tick < 0 THEN RAISE EXCEPTION 'tick inválido'; END IF;
  IF p_kind NOT IN ('plant', 'dig', 'collect') THEN RAISE EXCEPTION 'tipo de acción inválido'; END IF;

  SELECT * INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Partida ya liquidada'; END IF;
  IF v_room.status <> 'playing' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  IF v_room.verification_status IN ('verifying', 'verified', 'failed') THEN
    RAISE EXCEPTION 'La partida ya está cerrada para verificación';
  END IF;

  -- Idempotencia fuerte por seq
  SELECT * INTO v_existente
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid AND seq = p_seq;

  IF FOUND THEN
    IF v_existente.tick = p_tick
       AND v_existente.kind = p_kind
       AND v_existente.plant_id IS NOT DISTINCT FROM p_plant
       AND v_existente.lane IS NOT DISTINCT FROM p_lane
       AND v_existente.col IS NOT DISTINCT FROM p_col
       AND v_existente.slot IS NOT DISTINCT FROM p_slot
       AND v_existente.issued_tick IS NOT DISTINCT FROM p_issued_tick
       AND v_existente.target_id IS NOT DISTINCT FROM p_target_id
    THEN
      RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'id', v_existente.id);
    END IF;
    RAISE EXCEPTION 'seq ya usado con otra acción';
  END IF;

  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_tolerancia_tics_atras'), 30)
    INTO v_atras;
  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_tolerancia_tics_adelante'), 90)
    INTO v_adelante;
  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_max_acciones_por_jugador'), 400)
    INTO v_tope;

  IF v_room.engine_version = 'auth-v1' THEN
    v_adelante := LEAST(v_adelante, 12);
    IF v_room.mode = 'colosseum' THEN
      v_atras := LEAST(v_atras, 30);
    ELSE
      v_atras := LEAST(v_atras, 36);
    END IF;
  END IF;

  v_inicio := COALESCE(v_room.started_at, v_room.created_at);
  v_tic_ahora := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - v_inicio)) * 1000.0 / 33.0)::INTEGER
  );

  IF p_tick < (v_tic_ahora - v_atras) THEN
    RAISE EXCEPTION 'tick en el pasado';
  END IF;

  IF p_tick > (v_tic_ahora + v_adelante) THEN
    RAISE EXCEPTION 'tick demasiado en el futuro';
  END IF;

  SELECT COUNT(*) INTO v_cuantas
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid;

  IF v_cuantas >= v_tope THEN
    RAISE EXCEPTION 'Límite de acciones alcanzado';
  END IF;

  INSERT INTO public.match_actions
    (room_id, user_id, seq, tick, issued_tick, kind, plant_id, lane, col, slot, target_id)
  VALUES
    (p_room_id, v_uid, p_seq, p_tick, p_issued_tick, p_kind, p_plant, p_lane, p_col, p_slot, p_target_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) TO authenticated;


CREATE OR REPLACE FUNCTION public.report_match_result(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_uid = v_room.player1_id THEN
    IF v_room.p1_reported_winner IS NOT NULL AND v_room.p1_reported_winner <> p_winner_id THEN
      RAISE EXCEPTION 'No puedes cambiar tu reporte';
    END IF;
    UPDATE public.game_rooms SET p1_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p1_reported_winner := p_winner_id;
  ELSE
    IF v_room.p2_reported_winner IS NOT NULL AND v_room.p2_reported_winner <> p_winner_id THEN
      RAISE EXCEPTION 'No puedes cambiar tu reporte';
    END IF;
    UPDATE public.game_rooms SET p2_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p2_reported_winner := p_winner_id;
  END IF;

  IF v_room.engine_version = 'auth-v1' THEN
    UPDATE public.game_rooms
       SET verification_requested_at = COALESCE(verification_requested_at, NOW())
     WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'verificacion_pendiente',
      'authoritative', TRUE
    );
  END IF;

  IF v_room.p1_reported_winner IS NULL OR v_room.p2_reported_winner IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'esperando_al_rival');
  END IF;

  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw', settled_at = NOW() WHERE id = p_room_id;
    RETURN jsonb_build_object('success', FALSE, 'status', 'resultado_en_disputa', 'refunded', TRUE);
  END IF;

  RETURN public._settle_room(p_room_id, v_room.p1_reported_winner);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.surrender_match(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
  v_rival UUID;
  v_elo_p1 INTEGER;
  v_menos INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status IN ('verifying', 'failed') THEN
    RAISE EXCEPTION 'La partida está cerrada para verificación';
  END IF;

  -- ── CASO ASÍNCRONO ────────────────────────────────────────────────────────
  IF v_room.is_async_match THEN
    SELECT elo_rating INTO v_elo_p1
      FROM public.profiles WHERE id = v_uid FOR UPDATE;

    v_menos := (public._elo_deltas(v_elo_p1)->>'lose')::INTEGER;

    UPDATE public.profiles
       SET elo_rating = GREATEST(0, elo_rating - v_menos)
     WHERE id = v_uid;

    UPDATE public.game_rooms
       SET status = 'p2_won',
           settled_at = NOW(),
           server_winner_id = NULL,
           p1_reported_winner = COALESCE(v_room.async_opponent_id, '00000000-0000-0000-0000-000000000000'::UUID),
           verification_status = 'verified',
           verified_at = NOW(),
           verification_note = 'server_verified_surrender',
           verification_payload = jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid
           )
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'mode', 'ranked',
      'eloGained', 0,
      'eloLost', v_menos,
      'authoritative', TRUE,
      'reason', 'surrender',
      'isAsyncMatch', TRUE
    );
  END IF;

  -- ── CASO HUMANO VS HUMANO ──────────────────────────────────────────────────
  v_rival := CASE WHEN v_uid = v_room.player1_id
                  THEN v_room.player2_id ELSE v_room.player1_id END;

  UPDATE public.game_rooms
     SET p1_reported_winner = v_rival,
         p2_reported_winner = v_rival
   WHERE id = p_room_id;

  v_result := public._settle_room(p_room_id, v_rival);

  IF v_room.engine_version = 'auth-v1' THEN
    UPDATE public.game_rooms
       SET verification_status = 'verified',
           verification_requested_at = COALESCE(verification_requested_at, NOW()),
           verification_started_at = COALESCE(verification_started_at, NOW()),
           verified_at = NOW(),
           server_winner_id = v_rival,
           verification_note = 'server_verified_surrender',
           verification_payload = jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid
           )
     WHERE id = p_room_id;
  END IF;

  RETURN v_result || jsonb_build_object(
    'authoritative', v_room.engine_version = 'auth-v1',
    'reason', 'surrender'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.surrender_match(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.surrender_match(UUID) TO authenticated;
