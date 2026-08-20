-- =============================================================================
-- PLANT ARENA · UN RELOJ COMÚN PARA LOS DOS
--
-- Idempotente. Ejecutar después de la 22.
--
-- EL FALLO, VISTO JUGANDO
--   Con dos navegadores en la misma sala, los soles del cielo aparecían en
--   momentos distintos en cada pantalla. Con la misma semilla eso sólo puede
--   significar una cosa: los dos relojes de partida no estaban alineados.
--
--   El tic 0 de cada cliente era el instante en que ÉL arrancó la batalla. Y eso
--   no coincide: entre que el servidor empareja y que cada uno entra al campo
--   pasan un par de segundos distintos por cabeza (responder al sondeo, leer la
--   sala, cambiar de pantalla, cargar). Así, el tic 183 de uno era dos segundos
--   antes que el 183 del otro.
--
--   Y de ahí salía el síntoma peor. Quien iba ADELANTADO plantaba en el tic 206;
--   el servidor guardaba 206 como "por aquí va la partida". Quien iba ATRASADO
--   plantaba en el tic 150 y se le rechazaba por antiguo — así que uno de los dos
--   no podía plantar nada y el otro no veía nada.
--
-- LA CORRECCIÓN
--   El tic 0 pasa a ser un instante que dice el SERVIDOR, igual para los dos:
--   game_rooms.started_at. Cada cliente calcula por qué tic va con
--       tic = (ahora − started_at) / 33 ms
--   así que los dos coinciden aunque uno haya entrado más tarde — el que llega
--   tarde se pone al día simulando los tics que se perdió, que es exactamente
--   para lo que sirve que el motor sea reproducible.
--
--   No hace falta socket.io ni cambiar de transporte: Realtime ya entregaba bien.
--   Lo que faltaba era el origen de tiempo común.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.game_room_info(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 20: no existe game_room_info(uuid)';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. CUÁNDO EMPIEZA LA PARTIDA
--
--    Columna propia y no created_at porque son dos cosas distintas: la sala se
--    crea al emparejar, y la partida empieza cuando el primero de los dos entra
--    al campo. Usar created_at haría que el que entra tarde se pierda unos
--    segundos de partida ya jugada.
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Las salas que ya existen: se toma su creación, que es lo más cercano.
UPDATE public.game_rooms SET started_at = created_at WHERE started_at IS NULL;


-- -----------------------------------------------------------------------------
-- 2. EL PRIMERO QUE ENTRA ARRANCA EL RELOJ
--
--    Lo llama el cliente al entrar al campo. El primero lo fija; el segundo
--    recibe el mismo valor y se pone al día. Que lo fije el servidor y no el
--    cliente es lo importante: si cada uno mandara su hora, volveríamos a tener
--    dos relojes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_match_clock(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_room  RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  -- Sólo se fija una vez. El segundo en llegar recibe el que puso el primero, y
  -- por eso los dos acaban con el mismo tic 0.
  IF v_room.started_at IS NULL THEN
    UPDATE public.game_rooms SET started_at = NOW() WHERE id = p_room_id
    RETURNING started_at INTO v_room.started_at;
  END IF;

  RETURN jsonb_build_object(
    'startedAt', v_room.started_at,
    -- El reloj del SERVIDOR en este momento. El cliente lo usa para corregir la
    -- diferencia con el suyo: los relojes de dos ordenadores no coinciden, y sin
    -- esta corrección un desfase de un segundo volvería a desalinear la partida.
    'serverNow', NOW(),
    -- Por qué tic va la partida ahora mismo. Un tic son 33 ms (engine/time.ts).
    'currentTick', GREATEST(0,
      (EXTRACT(EPOCH FROM (NOW() - v_room.started_at)) * 1000 / 33)::INTEGER)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_match_clock(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_match_clock(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. game_room_info DEVUELVE EL RELOJ
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

  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  RETURN jsonb_build_object(
    'id',        v_room.id,
    'mode',      v_room.mode,
    'seed',      v_room.seed,
    'status',    v_room.status,
    'colosseumBet', v_room.colosseum_bet,
    'p1Deck',    v_room.p1_deck,
    'p2Deck',    v_room.p2_deck,
    'player1',   jsonb_build_object('id', v_room.player1_id, 'username', v_room.p1_nombre,
                                    'avatarId', v_room.p1_avatar, 'elo', v_room.p1_elo),
    'player2',   jsonb_build_object('id', v_room.player2_id, 'username', v_room.p2_nombre,
                                    'avatarId', v_room.p2_avatar, 'elo', v_room.p2_elo),
    'iAm',       CASE WHEN v_uid = v_room.player1_id THEN 'p1' ELSE 'p2' END,
    -- El reloj común. Puede ser nulo si nadie ha entrado todavía al campo.
    'startedAt', v_room.started_at,
    'serverNow', NOW()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.game_room_info(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.game_room_info(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. LA TOLERANCIA HACIA ATRÁS, AHORA QUE LOS RELOJES ESTÁN ALINEADOS
--
--    Con relojes desalineados hacían falta márgenes grandes y aun así se
--    rechazaban acciones legítimas. Alineados, la diferencia entre los dos es la
--    de la red: décimas de segundo. Se dejan 45 tics (1,5 s) de margen, que es
--    holgado para una conexión mala y sigue impidiendo reescribir el pasado.
-- -----------------------------------------------------------------------------
UPDATE public.shop_config SET value = 45
 WHERE key = 'ma_tolerancia_tics_atras' AND value = 30;

-- Y el techo se mide desde started_at, no desde created_at: son dos instantes
-- distintos y usar el de creación daba margen de más.
CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_room_id UUID,
  p_seq     INTEGER,
  p_tick    INTEGER,
  p_kind    TEXT,
  p_plant   TEXT,
  p_lane    SMALLINT,
  p_col     SMALLINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_room      RECORD;
  v_atras     INTEGER;
  v_adelante  INTEGER;
  v_tope      INTEGER;
  v_cuantas   INTEGER;
  v_max_sala  INTEGER;
  v_max_mio   INTEGER;
  v_techo     INTEGER;
  v_origen    TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Partida ya liquidada';
  END IF;

  IF p_tick < 0 THEN RAISE EXCEPTION 'Tic inválido'; END IF;

  IF p_kind = 'plant' THEN
    IF p_plant IS NULL THEN RAISE EXCEPTION 'Falta la carta'; END IF;
    IF NOT public._carta_en_mazo(p_room_id, v_uid, p_plant) THEN
      RAISE EXCEPTION 'Esa carta no está en tu mazo';
    END IF;
  END IF;

  SELECT COALESCE(MAX(CASE WHEN key = 'ma_tolerancia_tics_atras'    THEN value::INTEGER END), 45),
         COALESCE(MAX(CASE WHEN key = 'ma_tolerancia_tics_adelante' THEN value::INTEGER END), 90),
         COALESCE(MAX(CASE WHEN key = 'ma_max_acciones_por_jugador' THEN value::INTEGER END), 400)
    INTO v_atras, v_adelante, v_tope
    FROM public.shop_config;

  -- FRENO 1: no muy por detrás de por dónde va la partida de verdad.
  SELECT COALESCE(MAX(tick), 0) INTO v_max_sala
    FROM public.match_actions WHERE room_id = p_room_id;

  IF v_max_sala > 0 AND p_tick < v_max_sala - v_atras THEN
    RAISE EXCEPTION 'Acción demasiado antigua: tic % cuando la partida ya iba por el %',
      p_tick, v_max_sala;
  END IF;

  -- FRENO 2: nadie va hacia atrás respecto a lo suyo.
  SELECT COALESCE(MAX(tick), 0) INTO v_max_mio
    FROM public.match_actions WHERE room_id = p_room_id AND user_id = v_uid;

  IF p_tick < v_max_mio THEN
    RAISE EXCEPTION 'Tus acciones no pueden ir hacia atrás: tic % después del %',
      p_tick, v_max_mio;
  END IF;

  -- FRENO 3: techo por reloj, medido desde que empezó la partida.
  v_origen := COALESCE(v_room.started_at, v_room.created_at);
  v_techo := (EXTRACT(EPOCH FROM (NOW() - v_origen)) * 1000 / 33)::INTEGER + v_adelante;

  IF p_tick > v_techo THEN
    RAISE EXCEPTION 'Acción en el futuro: tic % cuando como mucho cabe el %',
      p_tick, v_techo;
  END IF;

  SELECT COUNT(*) INTO v_cuantas FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid;
  IF v_cuantas >= v_tope THEN
    RAISE EXCEPTION 'Demasiadas acciones en esta partida';
  END IF;

  INSERT INTO public.match_actions
    (room_id, user_id, seq, tick, kind, plant_id, lane, col)
  VALUES
    (p_room_id, v_uid, p_seq, p_tick, p_kind, p_plant, p_lane, p_col)
  ON CONFLICT (room_id, user_id, seq) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'seq', p_seq,
    'tick', p_tick,
    'roomTick', GREATEST(v_max_sala, p_tick)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('reloj_comun_de_partida', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. La columna y la función nuevas.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='game_rooms'
             AND column_name='started_at')                       AS columna_started_at,
  to_regprocedure('public.start_match_clock(uuid)') IS NOT NULL  AS funcion_reloj,
  (SELECT value FROM public.shop_config
    WHERE key='ma_tolerancia_tics_atras')                        AS tolerancia_atras;

-- 2. Las últimas partidas con su reloj y el desfase entre los tics de cada uno.
--    Si la corrección funciona, los tics de los dos jugadores van parejos.
SELECT r.id,
       r.started_at,
       (SELECT MAX(a.tick) FROM public.match_actions a
         WHERE a.room_id = r.id AND a.user_id = r.player1_id) AS ultimo_tic_p1,
       (SELECT MAX(a.tick) FROM public.match_actions a
         WHERE a.room_id = r.id AND a.user_id = r.player2_id) AS ultimo_tic_p2
  FROM public.game_rooms r
 ORDER BY r.created_at DESC
 LIMIT 10;
