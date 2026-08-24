-- =============================================================================
-- PLANT ARENA · MIGRACIÓN 41
-- PROTOCOLO DE MOTOR auth-v2: HANDSHAKE TOTAL SERVER-SIDE Y RETROCOMPATIBILIDAD
-- =============================================================================
--
-- 1. Actualiza el valor por defecto de game_rooms.engine_version a 'auth-v2'.
-- 2. Agrega client_engine_version a public.matchmaking_queue con constraint check e índice.
-- 3. Actualiza public.ranked_async_opponents constraint para admitir 'auth-v1' y 'auth-v2'.
-- 4. Actualiza enter_matchmaking(..., p_engine_version) con gate fail-closed en TODOS los modos.
-- 5. Actualiza poll_matchmaking para detectar filas legacy searching y devolver client_update_required.
-- 6. Actualiza _emparejar_lote para exigir client_engine_version = 'auth-v2' en todos los modos.
-- 7. Actualiza public._create_room para asignar explícitamente 'auth-v2'.
-- 8. Actualiza public.capture_ranked_async_opponents_from_room para admitir 'auth-v1' y 'auth-v2'.
-- 9. Actualiza public.claim_ranked_async_opponent para validar client_engine_version = 'auth-v2' y admitir seeds v1/v2.
-- 10. Actualiza RPCs de liquidación y verificación para soportar salas 'auth-v1' y 'auth-v2'.
-- 11. Registra la auditoría en public._migration_audit.
--
-- =============================================================================

-- ── 1. ACTUALIZAR DEFAULT DE ENGINE_VERSION EN GAME_ROOMS ────────────────────
ALTER TABLE public.game_rooms ALTER COLUMN engine_version SET DEFAULT 'auth-v2';

-- ── 2. EXTENDER Y BLINDAR MATCHMAKING_QUEUE ─────────────────────────────────
ALTER TABLE public.matchmaking_queue
  ADD COLUMN IF NOT EXISTS client_engine_version TEXT;

ALTER TABLE public.matchmaking_queue 
  DROP CONSTRAINT IF EXISTS matchmaking_queue_client_engine_version_check;

ALTER TABLE public.matchmaking_queue 
  ADD CONSTRAINT matchmaking_queue_client_engine_version_check 
  CHECK (client_engine_version IS NULL OR client_engine_version IN ('auth-v1', 'auth-v2'));

CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_version_gate
  ON public.matchmaking_queue (mode, status, client_engine_version, created_at);

-- Revocar toda mutación directa de clientes (sólo RPCs SECURITY DEFINER pueden insertar/actualizar/borrar)
REVOKE ALL ON public.matchmaking_queue FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.matchmaking_queue TO authenticated;
GRANT ALL ON public.matchmaking_queue TO service_role;

-- RLS: sólo lectura de sus propias filas para Realtime
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "queue_insert_own" ON public.matchmaking_queue;
DROP POLICY IF EXISTS "queue_cancel_own" ON public.matchmaking_queue;
DROP POLICY IF EXISTS "queue_update_own" ON public.matchmaking_queue;
DROP POLICY IF EXISTS "queue_select_own" ON public.matchmaking_queue;

CREATE POLICY "queue_select_own" ON public.matchmaking_queue
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. ACTUALIZAR CONSTRAINT EN RANKED_ASYNC_OPPONENTS ───────────────────────
ALTER TABLE public.ranked_async_opponents 
  DROP CONSTRAINT IF EXISTS ranked_async_opponents_source_engine_version_check;

ALTER TABLE public.ranked_async_opponents 
  ADD CONSTRAINT ranked_async_opponents_source_engine_version_check 
  CHECK (source_engine_version IN ('auth-v1', 'auth-v2'));

-- ── 4. ACTUALIZAR ENTER_MATCHMAKING CON HANDSHAKE ESTRICTO EN TODOS LOS MODOS ─
DROP FUNCTION IF EXISTS public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.enter_matchmaking(
  p_mode           TEXT,
  p_bet            NUMERIC DEFAULT 0,
  p_use_ticket     BOOLEAN DEFAULT FALSE,
  p_room_code      TEXT    DEFAULT NULL,
  p_engine_version TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_elo     INTEGER;
  v_deck    JSONB;
  v_plazo   INTEGER;
  v_room    UUID;
  v_escrow  UUID;
  v_apuesta JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_mode NOT IN ('ranked', 'friendly', 'colosseum', 'tournament') THEN
    RAISE EXCEPTION 'Modo desconocido: %', p_mode;
  END IF;

  -- ── SERVER-SIDE GATE ESTRICTO: CERO FALLBACKS / CLIENTES VIEJOS RECHAZADOS ─
  IF p_engine_version IS NULL OR p_engine_version <> 'auth-v2' THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'searching', FALSE,
      'error', 'client_update_required',
      'message', 'Se requiere actualizar el juego a la versión actual para jugar partidas multijugador.'
    );
  END IF;

  IF p_mode = 'colosseum' AND (p_bet IS NULL OR p_bet <= 0) THEN
    RAISE EXCEPTION 'Elige la cantidad de la apuesta antes de entrar al Coliseo';
  END IF;

  IF p_mode <> 'colosseum' AND COALESCE(p_use_ticket, FALSE) THEN
    RAISE EXCEPTION 'Los tickets sólo valen para el Coliseo';
  END IF;

  IF p_mode NOT IN ('colosseum', 'friendly') AND COALESCE(p_bet, 0) > 0 THEN
    RAISE EXCEPTION 'En este modo no se apuesta';
  END IF;

  -- Quitar una búsqueda anterior propia que se hubiera quedado colgada.
  IF EXISTS (SELECT 1 FROM public.matchmaking_queue
              WHERE user_id = v_uid AND status = 'searching') THEN
    PERFORM public.cancel_matchmaking();
  END IF;

  -- ── ¿HAY UNA PARTIDA MÍA DE VERDAD EN CURSO? ──────────────────────────────
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  FOR v_room IN
    SELECT id FROM public.game_rooms
     WHERE (player1_id = v_uid OR player2_id = v_uid)
       AND settled_at IS NULL
       AND status = 'playing'
  LOOP
    PERFORM public._settle_if_abandoned(v_room);
  END LOOP;

  SELECT r.id INTO v_room
    FROM public.game_rooms r
   WHERE (r.player1_id = v_uid OR r.player2_id = v_uid)
     AND r.settled_at IS NULL
     AND r.status = 'playing'
     AND GREATEST(
           r.created_at,
           COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                      WHERE a.room_id = r.id), r.created_at)
         ) > NOW() - make_interval(secs => v_plazo)
   ORDER BY r.created_at DESC
   LIMIT 1;

  IF v_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE, 'roomId', v_room, 'resumed', TRUE,
      'message', 'Ya tienes una partida en curso'
    );
  END IF;

  -- El mazo lo pone el servidor. Sin cartas no se puede jugar.
  v_deck := public._active_deck(v_uid);
  IF jsonb_array_length(v_deck) = 0 THEN
    RAISE EXCEPTION 'No tienes cartas en el mazo. Elige tu mazo antes de buscar partida.';
  END IF;

  SELECT elo_rating INTO v_elo FROM public.profiles WHERE id = v_uid;
  IF v_elo IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  IF p_mode = 'colosseum' THEN
    v_apuesta := public.place_colosseum_wager(p_bet, p_use_ticket);
    v_escrow  := (v_apuesta->>'escrowId')::UUID;
  ELSIF p_mode = 'friendly' AND COALESCE(p_bet, 0) > 0 THEN
    v_escrow := public._apostar_en_amistoso(v_uid, p_bet);
  END IF;

  INSERT INTO public.matchmaking_queue (
    user_id,
    mode,
    colosseum_bet,
    user_elo,
    room_code,
    status,
    escrow_id,
    client_engine_version,
    last_seen_at
  ) VALUES (
    v_uid,
    p_mode,
    CASE WHEN p_mode IN ('colosseum', 'friendly') THEN COALESCE(p_bet, 0) ELSE NULL END,
    v_elo,
    p_room_code,
    'searching',
    v_escrow,
    'auth-v2',
    NOW()
  );

  v_room := public._try_match(v_uid);

  IF v_room IS NOT NULL THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_room);
  END IF;

  RETURN jsonb_build_object('matched', FALSE, 'searching', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT, TEXT) TO authenticated;

-- ── 5. ACTUALIZAR POLL_MATCHMAKING CON DETECCIÓN DE FILAS LEGACY ────────────
CREATE OR REPLACE FUNCTION public.poll_matchmaking()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_fila     RECORD;
  v_room     UUID;
  v_esperado INTEGER;
  v_timeout  INTEGER;
  v_ghost    INTEGER;
  v_espera   INTEGER;
  v_cancel   JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_fila FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status IN ('searching', 'matched')
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('searching', FALSE, 'matched', FALSE);
  END IF;

  IF v_fila.status = 'matched' THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_fila.matched_room_id);
  END IF;

  -- ── DETECCIÓN DE FILAS LEGACY SEARCHING: EVITAR COLA INFINITA ─────────────
  IF v_fila.status = 'searching' AND (v_fila.client_engine_version IS NULL OR v_fila.client_engine_version <> 'auth-v2') THEN
    RETURN jsonb_build_object(
      'searching', FALSE,
      'matched', FALSE,
      'error', 'client_update_required',
      'message', 'Se requiere actualizar el juego para continuar buscando partida.'
    );
  END IF;

  -- Señal de vida.
  UPDATE public.matchmaking_queue SET last_seen_at = NOW() WHERE id = v_fila.id;

  v_room := public._try_match(v_uid);
  IF v_room IS NOT NULL THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_room);
  END IF;

  v_esperado := EXTRACT(EPOCH FROM (NOW() - v_fila.created_at))::INTEGER;

  SELECT COALESCE(MAX(CASE WHEN key = 'colosseum_queue_timeout_seconds' THEN value::INTEGER END), 240),
         COALESCE(MAX(CASE WHEN key = 'mm_ranked_ghost_after_seconds'   THEN value::INTEGER END), 30),
         COALESCE(MAX(CASE WHEN key = 'mm_espera_de_lote_segundos'      THEN value::INTEGER END), 4)
    INTO v_timeout, v_ghost, v_espera
    FROM public.shop_config;

  IF v_fila.mode = 'colosseum' AND v_esperado >= v_timeout THEN
    v_cancel := public.cancel_matchmaking();
    RETURN jsonb_build_object(
      'searching', FALSE, 'matched', FALSE, 'timedOut', TRUE,
      'refund', v_cancel->'refund',
      'message', 'No apareció rival. Se te devolvió la entrada.'
    );
  END IF;

  RETURN jsonb_build_object(
    'searching',        TRUE,
    'matched',          FALSE,
    'waitedSeconds',    v_esperado,
    'mode',             v_fila.mode,
    'sorteoEnSegundos', GREATEST(0, v_espera - v_esperado),
    'timeoutSeconds',   CASE WHEN v_fila.mode = 'colosseum' THEN v_timeout ELSE NULL END,
    'ghostAvailable',   (v_fila.mode = 'ranked' AND v_esperado >= v_ghost)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.poll_matchmaking() TO authenticated;

-- ── 6. ACTUALIZAR _EMPAREJAR_LOTE CON GATE DE VERSIÓN EN TODOS LOS MODOS ────
CREATE OR REPLACE FUNCTION public._emparejar_lote(
  p_mode      TEXT,
  p_bet       NUMERIC,
  p_room_code TEXT,
  p_torneo    UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_espera  INTEGER;
  v_inicio  INTEGER;
  v_paso    INTEGER;
  v_cada    INTEGER;
  v_tope    INTEGER;
  v_norepe  INTEGER;
  v_fila    RECORD;
  v_cand    RECORD;
  v_lote    UUID[] := '{}';
  v_hechos  INTEGER := 0;
  v_room    UUID;
  v_pasada  INTEGER;
BEGIN
  SELECT COALESCE(value::INTEGER, 4) INTO v_espera
    FROM public.shop_config WHERE key = 'mm_espera_de_lote_segundos';
  v_espera := GREATEST(0, COALESCE(v_espera, 4));

  SELECT COALESCE(MAX(CASE WHEN key = 'mm_elo_band_start'        THEN value::INTEGER END), 150),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_step'         THEN value::INTEGER END), 75),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_step_seconds' THEN value::INTEGER END), 15),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_max'          THEN value::INTEGER END), 1200),
         COALESCE(MAX(CASE WHEN key = 'mm_no_repetir_minutos'    THEN value::INTEGER END), 10)
    INTO v_inicio, v_paso, v_cada, v_tope, v_norepe
    FROM public.shop_config;

  FOR v_pasada IN 1..2 LOOP

  FOR v_fila IN
    SELECT q.*,
           LEAST(v_tope, v_inicio + v_paso *
             (EXTRACT(EPOCH FROM (NOW() - q.created_at))::INTEGER / GREATEST(1, v_cada))
           ) AS banda
      FROM public.matchmaking_queue q
     WHERE q.status = 'searching'
       AND q.mode = p_mode
       AND q.client_engine_version = 'auth-v2'
       AND COALESCE(q.colosseum_bet, 0) = COALESCE(p_bet, 0)
       AND q.room_code IS NOT DISTINCT FROM p_room_code
       AND q.tournament_id IS NOT DISTINCT FROM p_torneo
       AND q.created_at <= NOW() - make_interval(secs => v_espera)
       AND q.last_seen_at > NOW() - INTERVAL '45 seconds'
     ORDER BY
       EXISTS (
         SELECT 1
           FROM public.matchmaking_queue q2
           JOIN public.game_rooms r
             ON ((r.player1_id = q.user_id AND r.player2_id = q2.user_id)
              OR (r.player2_id = q.user_id AND r.player1_id = q2.user_id))
          WHERE q2.status = 'searching'
            AND q2.mode = p_mode
            AND q2.client_engine_version = 'auth-v2'
            AND q2.user_id <> q.user_id
            AND r.created_at > NOW() - make_interval(mins => v_norepe)
       ) DESC,
       q.user_elo,
       random()
     FOR UPDATE SKIP LOCKED
  LOOP
    CONTINUE WHEN v_fila.user_id = ANY(v_lote);

    SELECT q.* INTO v_cand
      FROM public.matchmaking_queue q
     WHERE q.status = 'searching'
       AND q.mode = p_mode
       AND q.client_engine_version = 'auth-v2'
       AND q.user_id <> v_fila.user_id
       AND NOT (q.user_id = ANY(v_lote))
       AND COALESCE(q.colosseum_bet, 0) = COALESCE(p_bet, 0)
       AND q.room_code IS NOT DISTINCT FROM p_room_code
       AND q.tournament_id IS NOT DISTINCT FROM p_torneo
       AND q.created_at <= NOW() - make_interval(secs => v_espera)
       AND q.last_seen_at > NOW() - INTERVAL '45 seconds'
       AND ABS(q.user_elo - v_fila.user_elo) <= GREATEST(
             v_fila.banda,
             LEAST(v_tope, v_inicio + v_paso *
               (EXTRACT(EPOCH FROM (NOW() - q.created_at))::INTEGER / GREATEST(1, v_cada)))
           )
       AND (v_pasada = 2 OR NOT EXISTS (
             SELECT 1 FROM public.game_rooms r
              WHERE r.created_at > NOW() - make_interval(mins => v_norepe)
                AND ((r.player1_id = v_fila.user_id AND r.player2_id = q.user_id)
                  OR (r.player2_id = v_fila.user_id AND r.player1_id = q.user_id))
           ))
     ORDER BY
       (EXISTS (
          SELECT 1 FROM public.game_rooms r
           WHERE r.created_at > NOW() - make_interval(mins => v_norepe)
             AND ((r.player1_id = v_fila.user_id AND r.player2_id = q.user_id)
               OR (r.player2_id = v_fila.user_id AND r.player1_id = q.user_id))
        ))::INTEGER,
       ABS(q.user_elo - v_fila.user_elo),
       random()
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    CONTINUE WHEN NOT FOUND;

    IF v_cand.created_at <= v_fila.created_at THEN
      v_room := public._create_room(p_mode, v_cand.user_id, v_fila.user_id, p_bet);
    ELSE
      v_room := public._create_room(p_mode, v_fila.user_id, v_cand.user_id, p_bet);
    END IF;

    UPDATE public.matchmaking_queue
       SET status = 'matched', matched_room_id = v_room
     WHERE id IN (v_fila.id, v_cand.id);

    v_lote := v_lote || ARRAY[v_fila.user_id, v_cand.user_id];
    v_hechos := v_hechos + 1;
  END LOOP;

  END LOOP;

  RETURN v_hechos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._emparejar_lote(TEXT, NUMERIC, TEXT, UUID) FROM anon, authenticated, PUBLIC;

-- ── 7. ACTUALIZAR _CREATE_ROOM PARA ASIGNAR EXPLÍCITAMENTE auth-v2 ──────────
CREATE OR REPLACE FUNCTION public._create_room(
  p_mode TEXT,
  p_p1   UUID,
  p_p2   UUID,
  p_bet  NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room   UUID;
  v_seed   BIGINT;
  v_cuenta INTEGER;
BEGIN
  v_seed := 1 + floor(random() * 2147483646)::BIGINT;

  SELECT COALESCE(value::INTEGER, 3) INTO v_cuenta
    FROM public.shop_config WHERE key = 'mm_cuenta_atras_segundos';
  v_cuenta := GREATEST(1, COALESCE(v_cuenta, 3));

  INSERT INTO public.game_rooms (
    mode, player1_id, player2_id, seed, p1_deck, p2_deck, colosseum_bet, status,
    engine_version, started_at
  ) VALUES (
    p_mode, p_p1, p_p2, v_seed,
    public._active_deck(p_p1), public._active_deck(p_p2),
    COALESCE(p_bet, 0), 'playing',
    'auth-v2',
    NOW() + make_interval(secs => v_cuenta)
  ) RETURNING id INTO v_room;

  UPDATE public.colosseum_escrow
     SET room_id = v_room
   WHERE user_id IN (p_p1, p_p2)
     AND status = 'held'
     AND room_id IS NULL;

  UPDATE public.game_rooms
     SET escrow_gems = COALESCE((
       SELECT SUM(bet_gems) FROM public.colosseum_escrow
        WHERE room_id = v_room AND status = 'held'
     ), 0)
   WHERE id = v_room;

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._create_room(TEXT, UUID, UUID, NUMERIC) FROM anon, authenticated, PUBLIC;

-- ── 8. ACTUALIZAR CAPTURA DE OPONENTES ASÍNCRONOS PARA ADMITIR auth-v2 ────────
CREATE OR REPLACE FUNCTION public.capture_ranked_async_opponents_from_room(
  p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room              RECORD;
  v_duration          INTEGER;
  v_resolution_source TEXT;

  v_p1_plant_count    INTEGER;
  v_p1_missing_issued INTEGER;
  v_p1_invalid_seq    INTEGER;
  v_p1_deck_val       JSONB;
  v_p1_actions        JSONB;
  v_p1_plan_val       JSONB;
  v_p1_rating         INTEGER;
  v_existing_opp1     RECORD;
  v_p1_status         TEXT := 'NOT_ELIGIBLE';

  v_p2_plant_count    INTEGER;
  v_p2_missing_issued INTEGER;
  v_p2_invalid_seq    INTEGER;
  v_p2_deck_val       JSONB;
  v_p2_actions        JSONB;
  v_p2_plan_val       JSONB;
  v_p2_rating         INTEGER;
  v_existing_opp2     RECORD;
  v_p2_status         TEXT := 'NOT_ELIGIBLE';

  v_captured_count    INTEGER := 0;
  v_existing_count    INTEGER := 0;
  v_not_eligible_count INTEGER := 0;
BEGIN
  SELECT *
    INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'room_not_found');
  END IF;

  IF v_room.mode <> 'ranked' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'mode_not_ranked');
  END IF;

  IF COALESCE(v_room.is_async_match, FALSE) = TRUE THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_async_match');
  END IF;

  IF v_room.engine_version IS NULL OR v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'engine_version_not_supported');
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

  IF v_room.verification_payload IS NULL OR jsonb_typeof(v_room.verification_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_verification_payload');
  END IF;

  v_resolution_source := v_room.verification_payload->>'resolutionSource';
  IF v_resolution_source IS NULL OR v_resolution_source <> 'authoritative_replay' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'reason', 'INVALID_SOURCE_VERIFICATION',
      'details', 'resolutionSource debe ser authoritative_replay'
    );
  END IF;

  IF v_room.verification_payload->>'consistent' IS NULL
     OR v_room.verification_payload->>'consistent' <> 'true' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'simulation_not_consistent');
  END IF;

  IF v_room.verification_payload->>'illegalCount' IS NULL
     OR (v_room.verification_payload->>'illegalCount') !~ '^\d+$'
     OR (v_room.verification_payload->>'illegalCount')::INTEGER <> 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'replay_has_illegal_actions');
  END IF;

  IF v_room.verification_payload->>'ticks' IS NULL
     OR (v_room.verification_payload->>'ticks') !~ '^\d+$'
     OR (v_room.verification_payload->>'ticks')::INTEGER < 300 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'duration_too_short');
  END IF;
  v_duration := (v_room.verification_payload->>'ticks')::INTEGER;

  -- ── Evaluación Lado 1 (player1_id) ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_p1_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind = 'plant';

  SELECT COUNT(*) INTO v_p1_missing_issued
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND (issued_tick IS NULL OR issued_tick < 0);

  SELECT COUNT(*) INTO v_p1_invalid_seq
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND (seq IS NULL OR seq < 0);

  IF v_p1_plant_count >= 3 AND v_p1_missing_issued = 0 AND v_p1_invalid_seq = 0 THEN
    v_p1_deck_val := public._validate_ranked_async_deck(v_room.p1_deck);
    IF (v_p1_deck_val->>'ok')::BOOLEAN = TRUE THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'seq', seq,
          'tick', tick,
          'issuedTick', issued_tick,
          'kind', kind,
          'plantId', plant_id,
          'slot', slot,
          'lane', lane,
          'col', col
        ) ORDER BY issued_tick ASC, seq ASC
      ), '[]'::JSONB)
      INTO v_p1_actions
      FROM public.match_actions
      WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind IN ('plant', 'dig');

      v_p1_plan_val := public._validate_ranked_async_plan(v_p1_actions);
      IF (v_p1_plan_val->>'ok')::BOOLEAN = TRUE THEN
        SELECT COALESCE(elo_rating, 1000) INTO v_p1_rating
          FROM public.profiles WHERE id = v_room.player1_id;

        SELECT * INTO v_existing_opp1
          FROM public.ranked_async_opponents
         WHERE source_room_id = p_room_id AND source_side = 1;

        IF FOUND THEN
          IF v_existing_opp1.deck_snapshot = v_room.p1_deck
             AND v_existing_opp1.actions_snapshot = v_p1_actions
             AND v_existing_opp1.source_engine_version = v_room.engine_version
             AND v_existing_opp1.protocol_version = 'ranked-async-v1'
             AND v_existing_opp1.source_duration_ticks = v_duration
             AND v_existing_opp1.rating_snapshot = v_p1_rating
          THEN
            v_p1_status := 'IDENTICAL_EXISTING';
          ELSE
            v_p1_status := 'CONFLICT';
          END IF;
        ELSE
          v_p1_status := 'NEW';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Evaluación Lado 2 (player2_id) ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_p2_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind = 'plant';

  SELECT COUNT(*) INTO v_p2_missing_issued
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND (issued_tick IS NULL OR issued_tick < 0);

  SELECT COUNT(*) INTO v_p2_invalid_seq
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND (seq IS NULL OR seq < 0);

  IF v_p2_plant_count >= 3 AND v_p2_missing_issued = 0 AND v_p2_invalid_seq = 0 THEN
    v_p2_deck_val := public._validate_ranked_async_deck(v_room.p2_deck);
    IF (v_p2_deck_val->>'ok')::BOOLEAN = TRUE THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'seq', seq,
          'tick', tick,
          'issuedTick', issued_tick,
          'kind', kind,
          'plantId', plant_id,
          'slot', slot,
          'lane', lane,
          'col', col
        ) ORDER BY issued_tick ASC, seq ASC
      ), '[]'::JSONB)
      INTO v_p2_actions
      FROM public.match_actions
      WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind IN ('plant', 'dig');

      v_p2_plan_val := public._validate_ranked_async_plan(v_p2_actions);
      IF (v_p2_plan_val->>'ok')::BOOLEAN = TRUE THEN
        SELECT COALESCE(elo_rating, 1000) INTO v_p2_rating
          FROM public.profiles WHERE id = v_room.player2_id;

        SELECT * INTO v_existing_opp2
          FROM public.ranked_async_opponents
         WHERE source_room_id = p_room_id AND source_side = 2;

        IF FOUND THEN
          IF v_existing_opp2.deck_snapshot = v_room.p2_deck
             AND v_existing_opp2.actions_snapshot = v_p2_actions
             AND v_existing_opp2.source_engine_version = v_room.engine_version
             AND v_existing_opp2.protocol_version = 'ranked-async-v1'
             AND v_existing_opp2.source_duration_ticks = v_duration
             AND v_existing_opp2.rating_snapshot = v_p2_rating
          THEN
            v_p2_status := 'IDENTICAL_EXISTING';
          ELSE
            v_p2_status := 'CONFLICT';
          END IF;
        ELSE
          v_p2_status := 'NEW';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── COMPROBACIÓN DE CONFLICTOS: All-or-nothing (0 escrituras si hay conflicto) ───
  IF v_p1_status = 'CONFLICT' OR v_p2_status = 'CONFLICT' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'reason', 'SOURCE_SNAPSHOT_CONFLICT',
      'capturedSides', 0,
      'alreadyExistingSides', 0,
      'notEligibleSides', 0,
      'conflictedSides', (CASE WHEN v_p1_status = 'CONFLICT' THEN 1 ELSE 0 END) + (CASE WHEN v_p2_status = 'CONFLICT' THEN 1 ELSE 0 END),
      'details', 'Conflicto detectado en snapshot existente para la sala fuente. No se realizaron cambios.'
    );
  END IF;

  -- ── FASE 2: ESCRITURA ATÓMICA ──────────────────────────────────────────────
  IF v_p1_status = 'NEW' THEN
    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      protocol_version,
      source_duration_ticks,
      active
    ) VALUES (
      p_room_id,
      1,
      v_p1_rating,
      v_room.p1_deck,
      v_p1_actions,
      v_room.engine_version,
      'ranked-async-v1',
      v_duration,
      TRUE
    );
    v_captured_count := v_captured_count + 1;
  ELSIF v_p1_status = 'IDENTICAL_EXISTING' THEN
    v_existing_count := v_existing_count + 1;
  ELSE
    v_not_eligible_count := v_not_eligible_count + 1;
  END IF;

  IF v_p2_status = 'NEW' THEN
    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      protocol_version,
      source_duration_ticks,
      active
    ) VALUES (
      p_room_id,
      2,
      v_p2_rating,
      v_room.p2_deck,
      v_p2_actions,
      v_room.engine_version,
      'ranked-async-v1',
      v_duration,
      TRUE
    );
    v_captured_count := v_captured_count + 1;
  ELSIF v_p2_status = 'IDENTICAL_EXISTING' THEN
    v_existing_count := v_existing_count + 1;
  ELSE
    v_not_eligible_count := v_not_eligible_count + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'capturedSides', v_captured_count,
    'alreadyExistingSides', v_existing_count,
    'notEligibleSides', v_not_eligible_count,
    'conflictedSides', 0
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) TO service_role;

-- ── 9. ACTUALIZAR CLAIM_RANKED_ASYNC_OPPONENT CON GATE ESTRICTO Y SOPORTE V1/V2 ─
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
  v_existing_is_async BOOLEAN;
  v_waited         INTEGER;
  v_human_room     UUID;
  v_player_elo     INTEGER := 1000;
  v_player_deck    JSONB;
  v_deck_val       JSONB;
  v_candidate      RECORD;
  v_cand_deck_val  JSONB;
  v_cand_plan_val  JSONB;
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

  -- 1. Verificar si el usuario está en cola Ranked activa
  SELECT *
    INTO v_queue
    FROM public.matchmaking_queue
   WHERE user_id = v_uid
     AND mode = 'ranked'
     AND status IN ('waiting', 'searching', 'matched')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_en_cola');
  END IF;

  -- En caso de que ya tenga status='matched', resolver de forma canónica
  IF v_queue.status = 'matched' AND v_queue.matched_room_id IS NOT NULL THEN
    SELECT is_async_match INTO v_existing_is_async
      FROM public.game_rooms
     WHERE id = v_queue.matched_room_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'matched', FALSE,
        'error', 'matched_room_missing',
        'details', 'La sala emparejada no existe en game_rooms'
      );
    END IF;

    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_queue.matched_room_id,
      'isAsyncMatch', v_existing_is_async
    );
  END IF;

  -- ── SERVER-SIDE GATE: RECHAZAR FILAS SIN CAPACIDAD auth-v2 ─────────────────
  IF v_queue.client_engine_version IS NULL OR v_queue.client_engine_version <> 'auth-v2' THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'client_update_required',
      'message', 'Se requiere actualizar el juego para emparejar con un Rival Semilla.'
    );
  END IF;

  v_waited := EXTRACT(EPOCH FROM (NOW() - v_queue.created_at))::INTEGER;
  IF v_waited < 60 THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'tiempo_insuficiente',
      'segundos_restantes', 60 - v_waited
    );
  END IF;

  -- 2. Prioridad humana absoluta: intentar emparejar con humano primero
  v_human_room := public._try_match(v_uid);
  IF v_human_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_human_room,
      'isAsyncMatch', FALSE
    );
  END IF;

  -- 3. Cargar mazo activo y ELO del jugador
  v_player_deck := public._active_deck(v_uid);
  v_deck_val := public._validate_ranked_async_deck(v_player_deck);
  IF (v_deck_val->>'ok')::BOOLEAN <> TRUE THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'invalid_player_deck', 'details', v_deck_val);
  END IF;

  SELECT COALESCE(elo_rating, 1000) INTO v_player_elo
    FROM public.profiles
   WHERE id = v_uid;

  SELECT ARRAY_AGG(async_opponent_id) INTO v_recent
    FROM (
      SELECT async_opponent_id
        FROM public.game_rooms
       WHERE player1_id = v_uid
         AND is_async_match = TRUE
         AND async_opponent_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5
    ) r;
  v_recent := COALESCE(v_recent, '{}'::UUID[]);

  -- 4. Selección del mejor candidato activo en pool (admite auth-v1 y auth-v2)
  LOOP
    -- Tier 1: ±200 ELO (sin recientes)
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND source_engine_version IN ('auth-v1', 'auth-v2')
       AND protocol_version = 'ranked-async-v1'
       AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       AND id <> ALL(v_recent)
     ORDER BY random()
     LIMIT 1;

    IF NOT FOUND THEN
      -- Tier 1 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version IN ('auth-v1', 'auth-v2')
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2: ±400 ELO (sin recientes)
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version IN ('auth-v1', 'auth-v2')
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version IN ('auth-v1', 'auth-v2')
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3: Cualquier candidato activo
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version IN ('auth-v1', 'auth-v2')
         AND protocol_version = 'ranked-async-v1'
         AND id <> ALL(v_recent)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version IN ('auth-v1', 'auth-v2')
         AND protocol_version = 'ranked-async-v1'
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('matched', FALSE, 'error', 'no_hay_candidato_semilla');
    END IF;

    v_cand_deck_val := public._validate_ranked_async_deck(v_candidate.deck_snapshot);
    v_cand_plan_val := public._validate_ranked_async_plan(v_candidate.actions_snapshot);

    IF (v_cand_deck_val->>'ok')::BOOLEAN = TRUE AND (v_cand_plan_val->>'ok')::BOOLEAN = TRUE THEN
      EXIT;
    ELSE
      UPDATE public.ranked_async_opponents SET active = FALSE WHERE id = v_candidate.id;
    END IF;
  END LOOP;

  -- ── GENERAR METADATOS Y SEMILLA RNG NUEVA GARANTIZADA ────────────────────
  v_random_name := v_names[1 + floor(random() * array_length(v_names, 1))::INTEGER];
  v_random_avatar := v_avatars[1 + floor(random() * array_length(v_avatars, 1))::INTEGER];

  DECLARE
    v_source_seed INTEGER;
    v_seed_attempts INTEGER := 0;
  BEGIN
    SELECT seed INTO v_source_seed FROM public.game_rooms WHERE id = v_candidate.source_room_id;
    LOOP
      v_new_seed := FLOOR(100000 + random() * 899999)::INTEGER;
      v_seed_attempts := v_seed_attempts + 1;
      EXIT WHEN (v_source_seed IS NULL OR v_new_seed <> v_source_seed)
        AND NOT EXISTS (
          SELECT 1 FROM public.game_rooms
           WHERE async_opponent_id = v_candidate.id
             AND seed = v_new_seed
        );
      IF v_seed_attempts > 100 THEN
        RAISE EXCEPTION 'No se pudo generar una seed única para el Rival Semilla tras 100 intentos';
      END IF;
    END LOOP;
  END;

  -- ── CREACIÓN ATÓMICA DE SALA Y PLAN PRIVADO (CON engine_version = 'auth-v2') ───
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
    'auth-v2',
    NOW()
  ) RETURNING id INTO v_new_room_id;

  INSERT INTO public.ranked_async_room_plans (
    room_id,
    async_opponent_id,
    protocol_version,
    actions_snapshot,
    created_at
  ) VALUES (
    v_new_room_id,
    v_candidate.id,
    'ranked-async-v1',
    v_candidate.actions_snapshot,
    NOW()
  );

  UPDATE public.matchmaking_queue
     SET status = 'matched',
         matched_room_id = v_new_room_id
   WHERE id = v_queue.id;

  RETURN jsonb_build_object(
    'matched', TRUE,
    'roomId', v_new_room_id,
    'isAsyncMatch', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_ranked_async_opponent() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_ranked_async_opponent() TO authenticated, service_role;

-- ── 10. ACTUALIZAR RPCS DE LIQUIDACIÓN Y VERIFICACIÓN PARA ADMITIR V1 Y V2 ────
CREATE OR REPLACE FUNCTION public.settle_verified_async_ranked_match(
  p_room_id UUID,
  p_winner_side SMALLINT,
  p_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room             RECORD;
  v_elo_p1_before    INTEGER;
  v_opponent_rating  INTEGER;
  v_delta_p1         INTEGER;
  v_elo_p1_after     INTEGER;
  v_cofre            JSONB := NULL;
  v_recent_wins      INTEGER;
  v_audit_elo        JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;
  IF NOT v_room.is_async_match THEN RAISE EXCEPTION 'Esta función es exclusiva para partidas asíncronas'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'ya_liquidada',
      'winner', v_room.server_winner_id,
      'winnerSide', CASE WHEN v_room.status = 'p1_won' THEN 1 WHEN v_room.status = 'p2_won' THEN 2 ELSE NULL END,
      'isAsyncMatch', TRUE
    );
  END IF;

  IF p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winner_side debe ser 1 (p1) o 2 (p2/rival)';
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  -- ── COMPROBACIÓN INDEPENDIENTE DEL PLAN PRIVADO Y DECK SNAPSHOT ────────────
  DECLARE
    v_plan RECORD;
    v_opp RECORD;
    v_cand_deck_val JSONB;
  BEGIN
    SELECT * INTO v_plan FROM public.ranked_async_room_plans WHERE room_id = p_room_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASYNC_PLAN_MISSING'; END IF;
    IF v_plan.protocol_version <> 'ranked-async-v1' THEN RAISE EXCEPTION 'PROTOCOL_VERSION_MISMATCH'; END IF;
    IF v_plan.async_opponent_id <> v_room.async_opponent_id THEN RAISE EXCEPTION 'ASYNC_OPPONENT_MISMATCH'; END IF;

    SELECT * INTO v_opp FROM public.ranked_async_opponents WHERE id = v_room.async_opponent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASYNC_OPPONENT_NOT_FOUND'; END IF;
    IF v_opp.source_engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'SOURCE_ENGINE_VERSION_MISMATCH'; END IF;
    IF v_opp.protocol_version <> 'ranked-async-v1' THEN RAISE EXCEPTION 'OPPONENT_PROTOCOL_MISMATCH'; END IF;
    IF v_room.async_deck_snapshot <> v_opp.deck_snapshot THEN RAISE EXCEPTION 'ASYNC_DECK_SNAPSHOT_MISMATCH'; END IF;
  END;

  SELECT elo_rating INTO v_elo_p1_before
    FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;

  v_opponent_rating := COALESCE(v_room.async_rating_snapshot, 1000);

  IF p_winner_side = 1 THEN
    v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_opponent_rating, 1.0);
    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);

    SELECT COUNT(*) INTO v_recent_wins
      FROM public.game_rooms
     WHERE player1_id = v_room.player1_id
       AND async_opponent_id = v_room.async_opponent_id
       AND status = 'p1_won'
       AND settled_at > NOW() - INTERVAL '1 hour';

    IF v_recent_wins < 3 THEN
      v_cofre := public._award_victory_chest_for(v_room.player1_id);
    END IF;

    UPDATE public.profiles
       SET elo_rating = v_elo_p1_after
     WHERE id = v_room.player1_id;

    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_room.player1_id, 1, 0, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET wins = ranked_player_stats.wins + 1,
          updated_at = NOW();

    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
      'playerBefore', v_elo_p1_before,
      'opponentBefore', v_opponent_rating,
      'delta', v_delta_p1,
      'playerAfter', v_elo_p1_after,
      'isAsyncMatch', true
    );

    UPDATE public.game_rooms
       SET status = 'p1_won',
            settled_at = NOW(),
            verification_status = 'verified',
            verified_at = NOW(),
            server_winner_id = v_room.player1_id,
            verification_note = 'server_verified_async',
            verification_payload = COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'authoritative', TRUE,
      'status', 'liquidada',
      'winner', v_room.player1_id,
      'winnerSide', 1,
      'mode', 'ranked',
      'eloBefore', v_elo_p1_before,
      'opponentElo', v_opponent_rating,
      'eloDelta', v_delta_p1,
      'eloAfter', v_elo_p1_after,
      'eloGained', v_delta_p1,
      'eloLost', 0,
      'chest', v_cofre,
      'isAsyncMatch', TRUE
    );
  ELSE
    v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_opponent_rating, 0.0);
    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);

    UPDATE public.profiles
       SET elo_rating = v_elo_p1_after
     WHERE id = v_room.player1_id;

    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_room.player1_id, 0, 1, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET losses = ranked_player_stats.losses + 1,
          updated_at = NOW();

    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
      'playerBefore', v_elo_p1_before,
      'opponentBefore', v_opponent_rating,
      'delta', v_delta_p1,
      'playerAfter', v_elo_p1_after,
      'isAsyncMatch', true
    );

    UPDATE public.game_rooms
       SET status = 'p2_won',
            settled_at = NOW(),
            verification_status = 'verified',
            verified_at = NOW(),
            server_winner_id = NULL,
            verification_note = 'server_verified_async',
            verification_payload = COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'authoritative', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'winnerSide', 2,
      'mode', 'ranked',
      'eloBefore', v_elo_p1_before,
      'opponentElo', v_opponent_rating,
      'eloDelta', v_delta_p1,
      'eloAfter', v_elo_p1_after,
      'eloGained', 0,
      'eloLost', ABS(v_delta_p1),
      'isAsyncMatch', TRUE
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) TO service_role;

-- Actualizar settle_verified_match_authoritative
CREATE OR REPLACE FUNCTION public.settle_verified_match_authoritative(
  p_room_id UUID,
  p_winner_id UUID,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_res  JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

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

  UPDATE public.game_rooms
     SET verification_status  = 'verified',
         verified_at          = NOW(),
         server_winner_id     = p_winner_id,
         verification_note    = 'server_verified',
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  v_res := public._settle_room(p_room_id, p_winner_id);

  RETURN v_res || jsonb_build_object('authoritative', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_match_authoritative(UUID, UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_verified_match_authoritative(UUID, UUID, JSONB) TO service_role;

-- Actualizar settle_verified_match
CREATE OR REPLACE FUNCTION public.settle_verified_match(
  p_room_id UUID,
  p_winner_id UUID,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'ya_liquidada',
      'winner', v_room.server_winner_id
    );
  END IF;

  IF p_winner_id NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'Ganador inválido';
  END IF;
  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  v_result := public._settle_room(p_room_id, p_winner_id);

  UPDATE public.game_rooms
     SET verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = p_winner_id,
         verification_note = 'server_verified',
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  RETURN v_result || jsonb_build_object(
    'authoritative', TRUE,
    'verificationStatus', 'verified'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_match(UUID, UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_verified_match(UUID, UUID, JSONB) TO service_role;

-- Actualizar settle_verified_draw
CREATE OR REPLACE FUNCTION public.settle_verified_draw(
  p_room_id UUID,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  v_result := public._settle_room(p_room_id, NULL);

  UPDATE public.game_rooms
     SET verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = NULL,
         verification_note = 'server_verified_draw',
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  RETURN v_result || jsonb_build_object(
    'authoritative', TRUE,
    'verificationStatus', 'verified'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) TO service_role;

-- Actualizar cancel_match_authoritative
CREATE OR REPLACE FUNCTION public.cancel_match_authoritative(
  p_room_id UUID,
  p_reason  TEXT DEFAULT 'verification_failed',
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  UPDATE public.game_rooms
     SET verification_status  = 'failed',
         verification_note    = p_reason,
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  RETURN jsonb_build_object('success', TRUE, 'status', 'cancelada', 'reason', p_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_match_authoritative(UUID, TEXT, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_match_authoritative(UUID, TEXT, JSONB) TO service_role;

-- Actualizar submit_match_action
CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_room_id     UUID,
  p_seq         INTEGER,
  p_tick        INTEGER,
  p_issued_tick INTEGER,
  p_kind        TEXT,
  p_plant_id    TEXT DEFAULT NULL,
  p_lane        INTEGER DEFAULT NULL,
  p_col         INTEGER DEFAULT NULL,
  p_slot        INTEGER DEFAULT NULL,
  p_target_id   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.player1_id <> v_uid AND v_room.player2_id <> v_uid THEN
    RAISE EXCEPTION 'No perteneces a esta sala';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'room_settled');
  END IF;

  INSERT INTO public.match_actions (
    room_id, user_id, seq, tick, issued_tick, kind, plant_id, lane, col, slot, target_id, created_at
  ) VALUES (
    p_room_id, v_uid, p_seq, p_tick, p_issued_tick, p_kind, p_plant_id, p_lane, p_col, p_slot, p_target_id, NOW()
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated;

-- ── 10.1 ACTUALIZAR GAME_ROOM_INFO PARA EXPONER ENGINE_VERSION ─────────────
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
    'id',           v_room.id,
    'mode',         v_room.mode,
    'seed',         v_room.seed,
    'status',       v_room.status,
    'engineVersion', v_room.engine_version,
    'colosseumBet', v_room.colosseum_bet,
    'p1Deck',       v_room.p1_deck,
    'p2Deck',       CASE WHEN v_room.is_async_match THEN v_room.async_deck_snapshot ELSE v_room.p2_deck END,
    'player1',      jsonb_build_object(
                      'id', v_room.player1_id,
                      'username', v_room.p1_nombre,
                      'avatarId', v_room.p1_avatar,
                      'elo', v_room.p1_elo
                    ),
    'player2',      CASE
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
    'iAm',          CASE WHEN v_uid = v_room.player1_id THEN 'p1' ELSE 'p2' END,
    'isAsyncMatch', COALESCE(v_room.is_async_match, FALSE),
    'startedAt',    v_room.started_at,
    'serverNow',    NOW()
  );
END;
$$;

-- Actualizar begin_match_verification
CREATE OR REPLACE FUNCTION public.begin_match_verification(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT *
    INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala no encontrada';
  END IF;

  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN
    RAISE EXCEPTION 'Sala no autoritativa';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'alreadySettled', TRUE,
      'winner', v_room.server_winner_id,
      'status', v_room.status
    );
  END IF;

  IF v_room.verification_status = 'failed' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'locked', TRUE,
      'status', 'failed',
      'note', v_room.verification_note
    );
  END IF;

  IF v_room.verification_status = 'verified' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'alreadySettled', v_room.settled_at IS NOT NULL,
      'locked', TRUE,
      'status', 'verified'
    );
  END IF;

  IF v_room.verification_status = 'verifying' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'busy', TRUE,
      'status', 'verifying',
      'startedAt', v_room.verification_started_at
    );
  END IF;

  UPDATE public.game_rooms
     SET verification_status = 'verifying',
         verification_requested_at = COALESCE(verification_requested_at, NOW()),
         verification_started_at = NOW(),
         verification_note = NULL,
         verification_next_at = NULL,
         verification_last_error = NULL,
         verification_attempts = verification_attempts + 1
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'alreadySettled', FALSE,
    'busy', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_match_verification(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_match_verification(UUID) TO service_role;

-- Actualizar claim_pending_match_verifications
CREATE OR REPLACE FUNCTION public.claim_pending_match_verifications(
  p_limit INTEGER DEFAULT 8
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  WITH candidatas AS (
    SELECT r.id
      FROM public.game_rooms r
     WHERE r.engine_version IN ('auth-v1', 'auth-v2')
       AND r.settled_at IS NULL
       AND r.verification_status = 'pending'
       AND r.verification_requested_at IS NOT NULL
       AND (
         r.verification_next_at IS NULL
         OR r.verification_next_at <= NOW()
       )
     ORDER BY r.verification_requested_at ASC, r.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  reclamadas AS (
    UPDATE public.game_rooms r
       SET verification_next_at = NOW() + INTERVAL '30 seconds'
      FROM candidatas c
     WHERE r.id = c.id
    RETURNING r.id
  )
  SELECT jsonb_agg(id) INTO v_result FROM reclamadas;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_match_verifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_match_verifications(INTEGER) TO service_role;

-- Actualizar mark_stuck_match_verifications
CREATE OR REPLACE FUNCTION public.mark_stuck_match_verifications(
  p_age_seconds INTEGER DEFAULT 180
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_age INTEGER := LEAST(GREATEST(COALESCE(p_age_seconds, 180), 60), 3600);
  v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  WITH marcadas AS (
    UPDATE public.game_rooms
       SET verification_status = 'failed',
           verification_note = 'worker_stuck_after_verification_lock',
           verification_last_error = 'verifying excedió el tiempo máximo del worker',
           verification_payload =
             COALESCE(verification_payload, '{}'::JSONB)
             || jsonb_build_object(
                  'workerRecovery', TRUE,
                  'failedAt', NOW(),
                  'reason', 'worker_stuck_after_verification_lock'
                )
     WHERE engine_version IN ('auth-v1', 'auth-v2')
       AND settled_at IS NULL
       AND verification_status = 'verifying'
       AND verification_started_at IS NOT NULL
       AND verification_started_at < NOW() - make_interval(secs => v_age)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM marcadas;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'markedForReview', v_count,
    'escrowReleased', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_stuck_match_verifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stuck_match_verifications(INTEGER) TO service_role;

-- ── 11. REGISTRO DE AUDITORÍA ───────────────────────────────────────────────
INSERT INTO public._migration_audit (fase, detalle, ejecutado_en)
VALUES (
  '41_engine_auth_v2_protocol',
  jsonb_build_object(
    'descripcion', 'Protocolo auth-v2 con handshake total server-side obligatorio en matchmaking_queue (Ranked, Colosseum, Friendly), gates en enter/poll_matchmaking y _emparejar_lote, liquidación dual v1/v2 y compatibilidad de seeds',
    'default_engine_version', 'auth-v2',
    'supported_engine_versions', jsonb_build_array('auth-v1', 'auth-v2'),
    'sin_cambios_elo', true,
    'sin_cambios_historicos', true
  ),
  NOW()
);
