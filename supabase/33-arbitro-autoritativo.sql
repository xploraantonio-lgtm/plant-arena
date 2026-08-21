-- =============================================================================
-- PLANT ARENA · 33 · ÁRBITRO AUTORITATIVO (auth-v1)
--
-- Ejecutar DESPUÉS de la 32.
--
-- OBJETIVO
--   · Los reportes de los navegadores dejan de liquidar partidas auth-v1.
--   · Cada acción registra el tic del clic, slot exacto y recogidas de sol.
--   · Sólo service_role puede confirmar un ganador verificado y llamar al reparto.
--   · Una partida con verificación fallida NO devuelve automáticamente el escrow:
--     queda retenida para revisión, evitando el exploit "voy perdiendo -> fuerzo
--     disputa -> recupero mi apuesta".
--   · Los empates PERFECTOS sí pueden ser liquidados como draw verificado.
--
-- IMPORTANTE
--   Esta migración cambia la firma de submit_match_action. Despliega junto con el
--   frontend auth-v1 y la Edge Function verify-match.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public._settle_room(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta _settle_room(uuid,uuid). Ejecuta las migraciones anteriores.';
  END IF;
  IF to_regclass('public.match_actions') IS NULL THEN
    RAISE EXCEPTION 'Falta public.match_actions. Ejecuta la migración 19.';
  END IF;
  IF to_regclass('public.game_rooms') IS NULL THEN
    RAISE EXCEPTION 'Falta public.game_rooms.';
  END IF;
END
$preflight$;

-- -----------------------------------------------------------------------------
-- 1. VERSIONADO Y ESTADO DE VERIFICACIÓN
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS engine_version TEXT;
UPDATE public.game_rooms
   SET engine_version = 'legacy-v1'
 WHERE engine_version IS NULL;
ALTER TABLE public.game_rooms ALTER COLUMN engine_version SET DEFAULT 'auth-v1';
ALTER TABLE public.game_rooms ALTER COLUMN engine_version SET NOT NULL;

ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS verification_status TEXT;
UPDATE public.game_rooms
   SET verification_status = 'legacy'
 WHERE verification_status IS NULL;
ALTER TABLE public.game_rooms ALTER COLUMN verification_status SET DEFAULT 'pending';
ALTER TABLE public.game_rooms ALTER COLUMN verification_status SET NOT NULL;
ALTER TABLE public.game_rooms DROP CONSTRAINT IF EXISTS game_rooms_verification_status_check;
ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_verification_status_check
  CHECK (verification_status IN ('legacy', 'pending', 'verifying', 'verified', 'failed'));

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_winner_id          UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verification_note         TEXT,
  ADD COLUMN IF NOT EXISTS verification_payload      JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_game_rooms_verification_pending
  ON public.game_rooms (verification_status, verification_requested_at)
  WHERE settled_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. EL REGISTRO DE ACCIONES YA PUEDE DEMOSTRAR ECONOMÍA Y SLOT
-- -----------------------------------------------------------------------------
ALTER TABLE public.match_actions
  ADD COLUMN IF NOT EXISTS slot        SMALLINT,
  ADD COLUMN IF NOT EXISTS issued_tick INTEGER,
  ADD COLUMN IF NOT EXISTS server_tick INTEGER,
  ADD COLUMN IF NOT EXISTS target_id   TEXT;

-- collect no tiene lane/col. Los checks antiguos aceptan NULL, sólo quitamos NOT NULL.
ALTER TABLE public.match_actions ALTER COLUMN lane DROP NOT NULL;

ALTER TABLE public.match_actions DROP CONSTRAINT IF EXISTS match_actions_kind_check;
ALTER TABLE public.match_actions
  ADD CONSTRAINT match_actions_kind_check
  CHECK (kind IN ('plant', 'dig', 'collect'));

ALTER TABLE public.match_actions DROP CONSTRAINT IF EXISTS match_actions_slot_check;
ALTER TABLE public.match_actions
  ADD CONSTRAINT match_actions_slot_check
  CHECK (slot IS NULL OR slot BETWEEN 0 AND 5);

ALTER TABLE public.match_actions DROP CONSTRAINT IF EXISTS match_actions_issued_tick_check;
ALTER TABLE public.match_actions
  ADD CONSTRAINT match_actions_issued_tick_check
  CHECK (issued_tick IS NULL OR issued_tick >= 0);

ALTER TABLE public.match_actions DROP CONSTRAINT IF EXISTS match_actions_server_tick_check;
ALTER TABLE public.match_actions
  ADD CONSTRAINT match_actions_server_tick_check
  CHECK (server_tick IS NULL OR server_tick >= 0);

ALTER TABLE public.match_actions DROP CONSTRAINT IF EXISTS match_actions_target_id_check;
ALTER TABLE public.match_actions
  ADD CONSTRAINT match_actions_target_id_check
  CHECK (target_id IS NULL OR char_length(target_id) BETWEEN 1 AND 160);

CREATE INDEX IF NOT EXISTS idx_match_actions_sala_emitidas
  ON public.match_actions (room_id, issued_tick, user_id, seq);

-- -----------------------------------------------------------------------------
-- 3. ¿EL SLOT EXACTO PERTENECE AL MAZO DEL JUGADOR?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._carta_en_slot(
  p_room_id UUID,
  p_uid     UUID,
  p_slot    SMALLINT,
  p_plant   TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.game_rooms r
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN r.player1_id = p_uid THEN r.p1_deck ELSE r.p2_deck END
      ) WITH ORDINALITY AS x(carta, ord)
     WHERE r.id = p_room_id
       AND p_uid IN (r.player1_id, r.player2_id)
       AND x.carta->>'plantId' = p_plant
       AND COALESCE(
             CASE
               WHEN (x.carta->>'slot') ~ '^[0-9]+$' THEN (x.carta->>'slot')::INTEGER
               ELSE NULL
             END,
             (x.ord - 1)::INTEGER
           ) = p_slot
  );
$$;
REVOKE EXECUTE ON FUNCTION public._carta_en_slot(UUID, UUID, SMALLINT, TEXT)
  FROM anon, authenticated, PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. submit_match_action auth-v1
--
-- Se elimina la firma vieja para que un cliente modificado no pueda saltarse
-- issued_tick/slot llamando al overload antiguo.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT
);

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
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF v_room.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Partida ya liquidada'; END IF;
  IF v_room.status <> 'playing' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  IF v_room.verification_status IN ('verifying', 'verified', 'failed') THEN
    RAISE EXCEPTION 'La partida ya está cerrada para verificación';
  END IF;

  -- Idempotencia fuerte: repetir el MISMO seq con los mismos datos es OK; intentar
  -- reutilizarlo para otra acción es manipulación.
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

  -- auth-v1 estrecha la ventana futura. Un navegador normal puede llegar tarde
  -- por red, pero no necesita programar intenciones varios segundos por delante.
  -- En Coliseo limitamos además el backdating a ~1 s. Esto no sustituye un
  -- servidor de simulación en vivo, pero reduce mucho la superficie de timing.
  IF v_room.engine_version = 'auth-v1' THEN
    v_adelante := LEAST(v_adelante, 12); -- 396 ms
    IF v_room.mode = 'colosseum' THEN
      v_atras := LEAST(v_atras, 30);      -- 990 ms
    ELSE
      v_atras := LEAST(v_atras, 36);      -- 1.188 s
    END IF;
  END IF;

  v_inicio := COALESCE(v_room.started_at, v_room.created_at);
  v_tic_ahora := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - v_inicio)) * 1000.0 / 33.0)::INTEGER
  );

  -- auth-v1 exige suficiente información para volver a validar la intención.
  IF v_room.engine_version = 'auth-v1' THEN
    IF p_issued_tick IS NULL THEN RAISE EXCEPTION 'issued_tick obligatorio'; END IF;

    IF p_issued_tick < v_tic_ahora - v_atras
       OR p_issued_tick > v_tic_ahora + v_adelante THEN
      RAISE EXCEPTION 'issued_tick fuera de ventana (cliente %, servidor %)',
        p_issued_tick, v_tic_ahora;
    END IF;

    IF p_kind IN ('plant', 'dig') THEN
      IF p_tick <> p_issued_tick + 6 THEN
        RAISE EXCEPTION 'margen de red inválido';
      END IF;
      IF p_lane IS NULL OR p_lane NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'lane inválido'; END IF;
      IF p_col IS NULL OR p_col NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'col fuera de tu mitad'; END IF;
    ELSE
      IF p_tick <> p_issued_tick THEN RAISE EXCEPTION 'collect debe ocurrir en issued_tick'; END IF;
    END IF;

    IF p_kind = 'plant' THEN
      IF p_plant IS NULL THEN RAISE EXCEPTION 'plant_id obligatorio'; END IF;
      IF p_slot IS NULL OR p_slot NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'slot obligatorio'; END IF;
      IF NOT public._carta_en_slot(p_room_id, v_uid, p_slot, p_plant) THEN
        RAISE EXCEPTION 'esa carta no pertenece a ese slot de tu mazo';
      END IF;
      IF p_target_id IS NOT NULL THEN RAISE EXCEPTION 'plant no usa target_id'; END IF;
    ELSIF p_kind = 'dig' THEN
      IF p_plant IS NOT NULL OR p_slot IS NOT NULL OR p_target_id IS NOT NULL THEN
        RAISE EXCEPTION 'dig tiene campos incompatibles';
      END IF;
    ELSIF p_kind = 'collect' THEN
      IF p_target_id IS NULL OR char_length(p_target_id) > 160 THEN
        RAISE EXCEPTION 'target_id de sol obligatorio';
      END IF;
      IF p_plant IS NOT NULL OR p_lane IS NOT NULL OR p_col IS NOT NULL OR p_slot IS NOT NULL THEN
        RAISE EXCEPTION 'collect tiene campos incompatibles';
      END IF;
    END IF;
  ELSE
    -- Compatibilidad legacy durante despliegue. No se usará para liquidar auth-v1.
    IF p_kind = 'plant' AND (p_plant IS NULL OR NOT public._carta_en_mazo(p_room_id, v_uid, p_plant)) THEN
      RAISE EXCEPTION 'esa carta no está en tu mazo';
    END IF;
  END IF;

  IF p_tick < v_tic_ahora - v_atras
     OR p_tick > v_tic_ahora + v_adelante + 6 THEN
    RAISE EXCEPTION 'tick fuera de ventana (cliente %, servidor %)', p_tick, v_tic_ahora;
  END IF;

  SELECT COUNT(*) INTO v_cuantas
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid;
  IF v_cuantas >= v_tope THEN RAISE EXCEPTION 'demasiadas acciones en la partida'; END IF;

  INSERT INTO public.match_actions(
    room_id, user_id, seq, tick, issued_tick, server_tick, kind,
    plant_id, lane, col, slot, target_id
  ) VALUES (
    p_room_id, v_uid, p_seq, p_tick, p_issued_tick, v_tic_ahora, p_kind,
    p_plant, p_lane, p_col, p_slot, p_target_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id, 'serverTick', v_tic_ahora);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. RECUPERACIÓN V2 PARA EL CLIENTE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_actions_since_v2(
  p_room_id UUID,
  p_desde_id BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT player1_id, player2_id INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'userId', a.user_id,
      'seq', a.seq,
      'tick', a.tick,
      'issuedTick', a.issued_tick,
      'kind', a.kind,
      'plantId', a.plant_id,
      'lane', a.lane,
      'col', a.col,
      'slot', a.slot,
      'targetId', a.target_id
    ) ORDER BY a.id)
      FROM public.match_actions a
     WHERE a.room_id = p_room_id AND a.id > p_desde_id
  ), '[]'::JSONB);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.match_actions_since_v2(UUID, BIGINT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.match_actions_since_v2(UUID, BIGINT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. REPETICIONES CON TODA LA INFORMACIÓN DE auth-v1
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_replay(
  p_room_id UUID DEFAULT NULL,
  p_token   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF p_room_id IS NULL AND p_token IS NULL THEN
    RAISE EXCEPTION 'Hace falta la sala o el código';
  END IF;

  SELECT r.*, p1.username AS n1, p1.avatar_id AS a1,
              p2.username AS n2, p2.avatar_id AS a2
    INTO v_room
    FROM public.game_rooms r
    LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
    LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
   WHERE (p_token IS NOT NULL AND r.share_token = p_token)
      OR (p_token IS NULL AND r.id = p_room_id);

  IF NOT FOUND THEN RAISE EXCEPTION 'Repetición no encontrada'; END IF;
  IF p_token IS NULL THEN
    IF v_uid IS NULL OR v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participaste en esta partida';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'roomId', v_room.id,
    'mode', v_room.mode,
    'seed', v_room.seed,
    'engineVersion', v_room.engine_version,
    'estado', v_room.status,
    'jugadaEn', COALESCE(v_room.started_at, v_room.created_at),
    'jugador1', jsonb_build_object('nombre', v_room.n1, 'avatar', v_room.a1, 'mazo', v_room.p1_deck),
    'jugador2', jsonb_build_object('nombre', v_room.n2, 'avatar', v_room.a2, 'mazo', v_room.p2_deck),
    'ganador', CASE v_room.status WHEN 'p1_won' THEN 1 WHEN 'p2_won' THEN 2 ELSE NULL END,
    'yoSoy', CASE WHEN v_uid = v_room.player1_id THEN 1
                  WHEN v_uid = v_room.player2_id THEN 2 ELSE NULL END,
    'jugadas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'seq', a.seq,
        'de', CASE WHEN a.user_id = v_room.player1_id THEN 1 ELSE 2 END,
        'tick', a.tick,
        'issuedTick', a.issued_tick,
        'serverTick', a.server_tick,
        'kind', a.kind,
        'plantId', a.plant_id,
        'lane', a.lane,
        'col', a.col,
        'slot', a.slot,
        'targetId', a.target_id
      ) ORDER BY COALESCE(a.issued_tick, a.tick),
                 CASE WHEN a.user_id = v_room.player1_id THEN 1 ELSE 2 END,
                 a.seq, a.id)
        FROM public.match_actions a
       WHERE a.room_id = v_room.id
    ), '[]'::JSONB)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.match_replay(UUID, TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. LOS REPORTES DEL CLIENTE SON DIAGNÓSTICO, NO AUTORIDAD
-- -----------------------------------------------------------------------------
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
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF p_winner_id NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'El ganador declarado no participa en esta partida';
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

  -- Camino legacy: se conserva sólo para partidas creadas ANTES de la 33.
  IF v_room.p1_reported_winner IS NULL OR v_room.p2_reported_winner IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'esperando_al_rival');
  END IF;

  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw', settled_at = NOW() WHERE id = p_room_id;

    UPDATE public.profiles p
       SET gems_balance = p.gems_balance + e.bet_gems
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held'
       AND e.paid_with = 'gems' AND p.id = e.user_id;

    UPDATE public.profiles p
       SET colosseum_tickets = p.colosseum_tickets + 1
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held'
       AND e.paid_with = 'ticket' AND p.id = e.user_id;

    INSERT INTO public.transactions(user_id, type, amount_gems, description, status)
    SELECT e.user_id, 'colosseum_refund',
           CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
           'Devolución legacy: partida en disputa', 'completed'
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held';

    UPDATE public.colosseum_escrow
       SET status = 'refunded', refunded_at = NOW()
     WHERE room_id = p_room_id AND status = 'held';

    RETURN jsonb_build_object('success', FALSE, 'status', 'resultado_en_disputa', 'refunded', TRUE);
  END IF;

  RETURN public._settle_room(p_room_id, v_room.p1_reported_winner);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPCs INTERNAS: SÓLO LA EDGE FUNCTION PUEDE LIQUIDAR auth-v1
-- -----------------------------------------------------------------------------
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

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version <> 'auth-v1' THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

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

  UPDATE public.game_rooms
     SET verification_status = 'verifying',
         verification_requested_at = COALESCE(verification_requested_at, NOW()),
         verification_started_at = NOW(),
         verification_note = NULL
   WHERE id = p_room_id;

  RETURN jsonb_build_object('ok', TRUE, 'alreadySettled', FALSE);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.begin_match_verification(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_match_verification(UUID) TO service_role;

-- Si la primera pasada se hizo justo cuando el cliente vio "fin" pero una acción
-- válida llegó durante la pequeña ventana de gracia y cambió el futuro de la
-- simulación, la Edge Function puede abrir otra vez la sala. Sólo service_role.
CREATE OR REPLACE FUNCTION public.release_match_verification(
  p_room_id UUID,
  p_note TEXT DEFAULT 'verification_released'
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

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'alreadySettled', TRUE);
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RETURN jsonb_build_object('ok', TRUE, 'released', FALSE, 'status', v_room.verification_status);
  END IF;

  UPDATE public.game_rooms
     SET verification_status = 'pending',
         verification_started_at = NULL,
         verification_note = LEFT(COALESCE(p_note, 'verification_released'), 500)
   WHERE id = p_room_id;

  RETURN jsonb_build_object('ok', TRUE, 'released', TRUE);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_match_verification(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_match_verification(UUID, TEXT) TO service_role;

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
  IF v_room.engine_version <> 'auth-v1' THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

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
REVOKE EXECUTE ON FUNCTION public.settle_verified_match(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_match(UUID, UUID, JSONB) TO service_role;

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
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version <> 'auth-v1' THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;
  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  -- Sólo esta RPC service-only puede devolver por un empate que el MOTOR verificó.
  UPDATE public.profiles p
     SET gems_balance = p.gems_balance + e.bet_gems
    FROM public.colosseum_escrow e
   WHERE e.room_id = p_room_id AND e.status = 'held'
     AND e.paid_with = 'gems' AND p.id = e.user_id;

  UPDATE public.profiles p
     SET colosseum_tickets = p.colosseum_tickets + 1
    FROM public.colosseum_escrow e
   WHERE e.room_id = p_room_id AND e.status = 'held'
     AND e.paid_with = 'ticket' AND p.id = e.user_id;

  INSERT INTO public.transactions(user_id, type, amount_gems, description, status)
  SELECT e.user_id, 'colosseum_refund',
         CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
         'Devolución: empate perfecto verificado por servidor', 'completed'
    FROM public.colosseum_escrow e
   WHERE e.room_id = p_room_id AND e.status = 'held';

  UPDATE public.colosseum_escrow
     SET status = 'refunded', refunded_at = NOW()
   WHERE room_id = p_room_id AND status = 'held';

  UPDATE public.game_rooms
     SET status = 'draw',
         settled_at = NOW(),
         verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = NULL,
         verification_note = 'server_verified_true_draw',
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'draw',
    'authoritative', TRUE,
    'refunded', v_room.mode = 'colosseum'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_match_verification_failed(
  p_room_id UUID,
  p_note TEXT,
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
  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'alreadySettled', TRUE);
  END IF;

  UPDATE public.game_rooms
     SET verification_status = 'failed',
         verification_note = LEFT(COALESCE(p_note, 'verification_failed'), 500),
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  -- A PROPÓSITO: no settled_at, no refund, no ELO y no payout.
  RETURN jsonb_build_object('ok', TRUE, 'status', 'failed', 'escrowStillHeld', TRUE);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_match_verification_failed(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_match_verification_failed(UUID, TEXT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 9. RENDIRSE = FORFEIT AUTORITATIVO
--
-- Rendirse sí puede liquidar sin replay: el usuario autenticado sólo puede
-- declararse perdedor a sí mismo. Nunca puede elegir al ganador ni rendir al rival.
-- -----------------------------------------------------------------------------
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
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;
  IF v_room.verification_status IN ('verifying', 'failed') THEN
    RAISE EXCEPTION 'La partida está cerrada para verificación';
  END IF;

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

-- -----------------------------------------------------------------------------
-- 10. ABANDONO: auth-v1 NUNCA HONRA UN REPORTE CLIENTE
--
-- El barrido legacy se conserva. Para auth-v1 sólo solicita verificación. Si una
-- Edge Function falla, el escrow queda held: es preferible revisión manual a que
-- un perdedor pueda fabricar una devolución cerrando la pestaña.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_abandoned_rooms()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo INTEGER;
  v_sala RECORD;
  v_liquidadas INTEGER := 0;
  v_abandonadas INTEGER := 0;
  v_por_verificar INTEGER := 0;
BEGIN
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  FOR v_sala IN
    SELECT r.*
      FROM public.game_rooms r
     WHERE r.status = 'playing'
       AND r.settled_at IS NULL
       AND GREATEST(
             COALESCE(r.started_at, r.created_at),
             COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                        WHERE a.room_id = r.id), r.created_at)
           ) < NOW() - make_interval(secs => v_plazo)
       AND (r.engine_version <> 'auth-v1' OR r.verification_requested_at IS NULL)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_sala.engine_version = 'auth-v1' THEN
      UPDATE public.game_rooms
         SET verification_requested_at = NOW(),
             verification_status = CASE
               WHEN verification_status = 'legacy' THEN 'pending'
               ELSE verification_status
             END,
             verification_note = 'stale_room_needs_server_verification'
       WHERE id = v_sala.id;
      v_por_verificar := v_por_verificar + 1;
      CONTINUE;
    END IF;

    IF v_sala.p1_reported_winner IS NOT NULL AND v_sala.p2_reported_winner IS NULL THEN
      PERFORM public._settle_room(v_sala.id, v_sala.p1_reported_winner);
      v_liquidadas := v_liquidadas + 1;
    ELSIF v_sala.p2_reported_winner IS NOT NULL AND v_sala.p1_reported_winner IS NULL THEN
      PERFORM public._settle_room(v_sala.id, v_sala.p2_reported_winner);
      v_liquidadas := v_liquidadas + 1;
    ELSE
      UPDATE public.game_rooms SET status = 'abandoned', settled_at = NOW() WHERE id = v_sala.id;

      UPDATE public.profiles p
         SET gems_balance = p.gems_balance + e.bet_gems
        FROM public.colosseum_escrow e
       WHERE e.room_id = v_sala.id AND e.status = 'held'
         AND e.paid_with = 'gems' AND p.id = e.user_id;

      UPDATE public.profiles p
         SET colosseum_tickets = p.colosseum_tickets + 1
        FROM public.colosseum_escrow e
       WHERE e.room_id = v_sala.id AND e.status = 'held'
         AND e.paid_with = 'ticket' AND p.id = e.user_id;

      INSERT INTO public.transactions(user_id, type, amount_gems, description, status)
      SELECT e.user_id, 'colosseum_refund',
             CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
             'Devolución legacy: partida abandonada', 'completed'
        FROM public.colosseum_escrow e
       WHERE e.room_id = v_sala.id AND e.status = 'held';

      UPDATE public.colosseum_escrow
         SET status = 'refunded', refunded_at = NOW()
       WHERE room_id = v_sala.id AND status = 'held';

      v_abandonadas := v_abandonadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'settledLegacy', v_liquidadas,
    'abandonedLegacy', v_abandonadas,
    'needsServerVerification', v_por_verificar
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.settle_abandoned_rooms() FROM anon, authenticated, PUBLIC;

-- -----------------------------------------------------------------------------
-- 11. room_result muestra también la verificación
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_result(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
  v_ganador UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  IF v_room.settled_at IS NULL THEN
    RETURN jsonb_build_object(
      'ended', FALSE,
      'status', v_room.status,
      'verificationStatus', v_room.verification_status,
      'verificationNote', v_room.verification_note
    );
  END IF;

  v_ganador := COALESCE(
    v_room.server_winner_id,
    CASE v_room.status
      WHEN 'p1_won' THEN v_room.player1_id
      WHEN 'p2_won' THEN v_room.player2_id
      ELSE NULL
    END
  );

  RETURN jsonb_build_object(
    'ended', TRUE,
    'status', v_room.status,
    'winner', v_ganador,
    'iWon', v_ganador IS NOT NULL AND v_ganador = v_uid,
    'noWinner', v_ganador IS NULL,
    'verificationStatus', v_room.verification_status,
    'authoritative', v_room.engine_version = 'auth-v1'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.room_result(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.room_result(UUID) TO authenticated;

INSERT INTO public._migration_audit(fase, detalle)
VALUES ('arbitro_autoritativo_33', jsonb_build_object(
  'engine', 'auth-v1',
  'acciones', ARRAY['plant', 'dig', 'collect'],
  'reportes_cliente_liquidan', FALSE
));

COMMIT;

-- =============================================================================
-- COMPROBACIONES DESPUÉS DE EJECUTAR
-- =============================================================================
-- 1) Nuevas columnas:
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'game_rooms'
   AND column_name IN (
     'engine_version','verification_status','verification_requested_at',
     'verification_started_at','verified_at','server_winner_id','verification_payload'
   )
 ORDER BY ordinal_position;

-- 2) Sólo la firma nueva de submit_match_action debe quedar:
SELECT oid::regprocedure
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname = 'submit_match_action';

-- 3) authenticated NO debe poder liquidar por estas RPC:
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN (
     'begin_match_verification',
     'release_match_verification',
     'settle_verified_match',
     'settle_verified_draw',
     'mark_match_verification_failed'
   )
 ORDER BY p.proname;
