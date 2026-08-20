-- =============================================================================
-- PLANT ARENA · EL TIC DEL CLIENTE NO ES EL RELOJ, Y LOS NOMBRES EN LA BATALLA
--
-- Idempotente. Ejecutar después de la 19.
--
-- EL FALLO
--   submit_match_action deducía "por qué tic va la partida" del reloj:
--       (NOW() - game_rooms.created_at) / 33 ms
--   y rechazaba cualquier acción más de 30 tics por detrás de eso.
--
--   Pero el tic 0 del cliente NO es cuando se creó la sala. Entre una cosa y otra
--   pasan varios segundos: responder al emparejamiento, leer la sala, cambiar de
--   pantalla, cargar la batalla. Con 4 segundos de diferencia el servidor cree que
--   la partida va por el tic 121 mientras el cliente va por el 10, así que TODAS
--   las acciones se rechazaban por antiguas y el rival no veía nada.
--
--   Comprobado: "Acción demasiado antigua: tic 16 cuando la partida va por el 121".
--
-- POR QUÉ ESTABA MAL DE RAÍZ
--   El servidor no puede saber el tic del cliente a partir del reloj. Lo que sí
--   sabe, y es lo que de verdad importa para que nadie haga trampas, es:
--
--     · Por dónde va la partida DE VERDAD: el tic más alto que ya se registró en
--       esa sala, por cualquiera de los dos. Nadie puede insertar una acción muy
--       por detrás de eso, que es lo que sería reescribir el pasado.
--     · Que cada jugador no vaya hacia atrás respecto a lo que él mismo mandó.
--     · Un techo absoluto por reloj: el tic del cliente puede ir POR DETRÁS del
--       tiempo transcurrido (si va lento), pero nunca por delante. Así que el
--       reloj sirve de tope, no de suelo.
--
--   Los tres frenos juntos impiden lo mismo que se pretendía, y no rechazan
--   ninguna acción legítima.
--
-- Y ADEMÁS
--   game_room_info devuelve los nombres de los dos jugadores, para poder poner
--   "Xplora" y "Leonel" en la batalla en lugar de "ÁRBOL MADRE (P1)".
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.match_actions') IS NULL THEN
    RAISE EXCEPTION 'Falta la 19: no existe la tabla match_actions';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LA VALIDACIÓN, SIN DEPENDER DEL RELOJ
-- -----------------------------------------------------------------------------
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

  SELECT COALESCE(MAX(CASE WHEN key = 'ma_tolerancia_tics_atras'    THEN value::INTEGER END), 30),
         COALESCE(MAX(CASE WHEN key = 'ma_tolerancia_tics_adelante' THEN value::INTEGER END), 90),
         COALESCE(MAX(CASE WHEN key = 'ma_max_acciones_por_jugador' THEN value::INTEGER END), 400)
    INTO v_atras, v_adelante, v_tope
    FROM public.shop_config;

  -- ── FRENO 1: por dónde va la partida DE VERDAD ────────────────────────────
  -- El tic más alto ya registrado en la sala, por cualquiera de los dos. No se
  -- puede insertar muy por detrás de eso: sería reescribir el pasado después de
  -- ver lo que hizo el otro.
  --
  -- Al principio no hay ninguno, y entonces cualquier tic razonable vale — que es
  -- justo lo que antes fallaba.
  SELECT COALESCE(MAX(tick), 0) INTO v_max_sala
    FROM public.match_actions WHERE room_id = p_room_id;

  IF v_max_sala > 0 AND p_tick < v_max_sala - v_atras THEN
    RAISE EXCEPTION 'Acción demasiado antigua: tic % cuando la partida ya iba por el %',
      p_tick, v_max_sala;
  END IF;

  -- ── FRENO 2: nadie va hacia atrás respecto a lo suyo ──────────────────────
  SELECT COALESCE(MAX(tick), 0) INTO v_max_mio
    FROM public.match_actions WHERE room_id = p_room_id AND user_id = v_uid;

  IF p_tick < v_max_mio THEN
    RAISE EXCEPTION 'Tus acciones no pueden ir hacia atrás: tic % después del %',
      p_tick, v_max_mio;
  END IF;

  -- ── FRENO 3: techo por reloj ──────────────────────────────────────────────
  -- El tic del cliente puede ir POR DETRÁS del tiempo transcurrido (si su equipo
  -- va lento, o si tardó en cargar), pero nunca por delante: la simulación no
  -- puede correr más que el reloj. Así que el reloj vale de tope y no de suelo.
  --
  -- Un tic son 33 ms (engine/time.ts TICK_MS).
  v_techo := (EXTRACT(EPOCH FROM (NOW() - v_room.created_at)) * 1000 / 33)::INTEGER
             + v_adelante;

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
  -- Un reintento de red manda la misma acción otra vez: no se duplica y no se
  -- devuelve error, porque desde el punto de vista del jugador ya está hecha.
  ON CONFLICT (room_id, user_id, seq) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'seq', p_seq,
    'tick', p_tick,
    -- Por dónde va la sala según el registro. Útil para depurar un desfase entre
    -- los dos clientes.
    'roomTick', GREATEST(v_max_sala, p_tick)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. LOS DATOS DE LA SALA, CON LOS NOMBRES
--
--    Para poder poner el nick de cada uno en la batalla en lugar de
--    "ÁRBOL MADRE (P1)". Va por RPC y no por un select con join porque así se
--    devuelve exactamente lo que hace falta y nada más: el nombre y el avatar,
--    sin saldos ni nada del perfil ajeno.
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
    -- Quién eres tú en esta sala, para que el cliente no tenga que deducirlo.
    'iAm',       CASE WHEN v_uid = v_room.player1_id THEN 'p1' ELSE 'p2' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.game_room_info(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.game_room_info(UUID) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fix_tics_y_nicks', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Las dos funciones y quién puede llamarlas.
SELECT p.proname,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'authenticated SÍ' ELSE 'sólo interna' END AS acceso
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('submit_match_action', 'game_room_info')
 ORDER BY p.proname;

-- 2. Las acciones de las últimas partidas, por si hace falta ver un desfase.
SELECT a.room_id, a.user_id, a.seq, a.tick, a.kind, a.plant_id, a.lane, a.col
  FROM public.match_actions a
 ORDER BY a.id DESC
 LIMIT 20;
