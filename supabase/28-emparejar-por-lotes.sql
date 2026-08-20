-- =============================================================================
-- PLANT ARENA · EMPAREJAR POR LOTES, Y EMPEZAR LOS DOS A LA VEZ
--
-- Idempotente. Ejecutar después de la 27.
--
-- LAS DOS COSAS QUE ARREGLA, QUE SON DISTINTAS
--
-- 1. «UNO VA DOS SEGUNDOS POR DELANTE DEL OTRO»
--
--    La causa estaba aquí, no en los soles. Al emparejar, la sala se creaba en la
--    llamada de UNO de los dos, y start_match_clock ponía started_at = NOW() la
--    primera vez que alguien lo pedía. O sea que el tic 0 de la partida era el
--    momento en que el MÁS RÁPIDO EN CARGAR entraba al campo. El otro llegaba dos
--    segundos después y su cliente simulaba de golpe los tics perdidos: entraba
--    con la partida ya empezada, y los primeros soles ya cayendo.
--
--    Ahora la sala nace con la hora de inicio YA PUESTA y en el futuro: NOW() más
--    unos segundos de cuenta atrás. Los dos clientes reciben el mismo instante,
--    los dos esperan en el tic 0 mientras cargan, y el tic 1 ocurre a la vez en
--    las dos pantallas. Nadie recupera nada porque nadie va por detrás.
--
--    Y deja de importar quién entró primero, que era el fondo del problema.
--
-- 2. EMPAREJAR AL INSTANTE HACE QUE TE TOQUE SIEMPRE QUIEN PULSÓ CUANDO TÚ
--
--    Antes se emparejaba en el mismo instante en que el segundo jugador entraba a
--    la cola. Con eso, dos personas que pulsan "buscar" a la vez se emparejan
--    entre ellas casi siempre — y si lo hacen a propósito, tienen su propia
--    partida privada en modo clasificatorio.
--
--    Ahora nadie se empareja al entrar: se espera un lote de unos segundos, se
--    junta a todo el que esté buscando en ese momento y se emparejan por ELO. Con
--    tres o más buscando, ya no depende de quién pulsó primero.
--
--    LO QUE ESTO **NO** ARREGLA, Y CONVIENE SABERLO
--      Si en la cola de un modo sólo están esos dos, se van a emparejar entre
--      ellos por narices: no hay con quién más. El lote reparte cuando hay gente;
--      no puede inventar rivales. Contra eso lo que sirve es no repetir rival —
--      que también entra aquí, más abajo — y con el tiempo, más jugadores.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public._try_match(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 17: no existe _try_match()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'game_rooms'
       AND column_name = 'started_at'
  ) THEN
    RAISE EXCEPTION 'Falta la 23: game_rooms no tiene started_at';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. AJUSTES
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Lo que se espera antes de emparejar a nadie. Es la ventana del lote: cuanto
  -- más larga, más gente entra en el sorteo y menos depende de quién pulsó
  -- primero; pero más se tarda en jugar. Cuatro segundos no se notan al lado de
  -- la pantalla de búsqueda que ya había.
  ('mm_espera_de_lote_segundos', 4),
  -- Cuenta atrás entre crear la sala y el tic 1. Tiene que dar para que los dos
  -- clientes carguen la pantalla de batalla; si es muy corta, el que tarde más en
  -- cargar volverá a tener que recuperar tics.
  ('mm_cuenta_atras_segundos', 3),
  -- No repetir rival: minutos durante los que se prefiere a cualquier otro antes
  -- que al mismo de la última partida.
  ('mm_no_repetir_minutos', 10)
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. LA SALA NACE CON SU HORA DE INICIO, EN EL FUTURO
--
--    Es el cambio que hace que los dos empiecen a la vez. Antes started_at se
--    quedaba en NULL y lo estampaba el primer cliente que pedía el reloj.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._create_room(
  p_mode TEXT,
  p_p1   UUID,
  p_p2   UUID,
  p_bet  NUMERIC
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room  UUID;
  v_seed  BIGINT;
  v_cuenta INTEGER;
BEGIN
  -- Semilla positiva que cabe en 32 bits, que es lo que consume el generador
  -- del motor (engine/rng.ts, mulberry32).
  v_seed := 1 + floor(random() * 2147483646)::BIGINT;

  SELECT COALESCE(value::INTEGER, 3) INTO v_cuenta
    FROM public.shop_config WHERE key = 'mm_cuenta_atras_segundos';
  v_cuenta := GREATEST(1, COALESCE(v_cuenta, 3));

  INSERT INTO public.game_rooms
    (mode, player1_id, player2_id, seed, p1_deck, p2_deck, colosseum_bet, status,
     started_at)
  VALUES
    (p_mode, p_p1, p_p2, v_seed,
     public._active_deck(p_p1), public._active_deck(p_p2),
     COALESCE(p_bet, 0), 'playing',
     -- EN EL FUTURO. Los dos clientes reciben este mismo instante, los dos
     -- esperan mientras cargan, y el tic 1 ocurre a la vez en las dos pantallas.
     NOW() + make_interval(secs => v_cuenta))
  RETURNING id INTO v_room;

  -- Las apuestas retenidas de ambos pasan a estar en juego: a partir de ahora no
  -- se devuelven, las liquida report_match_result.
  UPDATE public.colosseum_escrow
     SET room_id = v_room
   WHERE user_id IN (p_p1, p_p2)
     AND status = 'held'
     AND room_id IS NULL;

  -- El pozo real de la sala, para no tener que recalcularlo desde el cliente.
  UPDATE public.game_rooms
     SET escrow_gems = COALESCE((
       SELECT SUM(bet_gems) FROM public.colosseum_escrow
        WHERE room_id = v_room AND status = 'held'
     ), 0)
   WHERE id = v_room;

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._create_room(TEXT, UUID, UUID, NUMERIC)
  FROM anon, authenticated, PUBLIC;


-- El reloj ya no lo inventa nadie: se lee. Si la sala trae hora (todas las
-- nuevas), se devuelve tal cual. El NOW() se queda sólo como red para las salas
-- creadas antes de esta migración.
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

  -- Salas anteriores a la 28: no traían hora y la ponía el primero en pedirla.
  -- Es justo el comportamiento que hacía que el tic 0 fuera «cuando entró el más
  -- rápido»; se conserva sólo para no romper una partida en curso.
  IF v_room.started_at IS NULL THEN
    UPDATE public.game_rooms SET started_at = NOW() WHERE id = p_room_id
    RETURNING started_at INTO v_room.started_at;
  END IF;

  RETURN jsonb_build_object(
    'startedAt', v_room.started_at,
    -- El reloj del SERVIDOR en este momento. El cliente lo usa para corregir la
    -- diferencia con el suyo: los relojes de dos ordenadores no coinciden.
    'serverNow', NOW(),
    -- Por qué tic va la partida. NEGATIVO si todavía no ha empezado: eso es la
    -- cuenta atrás, y el cliente la enseña en lugar de un campo congelado.
    'currentTick', (EXTRACT(EPOCH FROM (NOW() - v_room.started_at)) * 1000 / 33)::INTEGER,
    'empiezaEnSegundos', GREATEST(0,
      CEIL(EXTRACT(EPOCH FROM (v_room.started_at - NOW()))))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_match_clock(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_match_clock(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. EL LOTE
--
--    Junta a todo el que lleve esperando el plazo en el mismo grupo (modo, y en
--    coliseo la misma apuesta, y en amistoso el mismo código), los ordena por ELO
--    y los va emparejando de dos en dos.
--
--    Por qué ordenados por ELO: emparejando vecinos, la diferencia media es la
--    más baja posible para ese grupo. Un emparejamiento al azar dentro del lote
--    sería «justo» en el sentido de imprevisible, pero produciría partidas de
--    1000 contra 2500.
--
--    El desempate es al azar. Con dos jugadores del mismo ELO, cualquiera de los
--    dos órdenes vale, y sortearlo evita que la lista salga siempre igual.
-- -----------------------------------------------------------------------------
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

  -- DOS PASADAS.
  --
  -- La primera empareja sólo a quien tenga un rival que NO sea el de su última
  -- partida; la segunda coge lo que quede y ya acepta revanchas.
  --
  -- Hace falta porque en una sola pasada esto es codicioso y se estropea solo:
  -- con A y B recién enfrentados y C y D libres, si le toca procesar a C primero
  -- empareja C-D, y entonces A y B se quedan sin más opción que repetir. Con la
  -- primera pasada, A y B cogen a C y a D antes de que éstos se junten.
  FOR v_pasada IN 1..2 LOOP

  -- El lote: los del grupo que ya cumplieron su espera y siguen vivos. Se
  -- bloquean todos de una vez para que dos sondeos simultáneos no emparejen al
  -- mismo jugador dos veces.
  FOR v_fila IN
    SELECT q.*,
           LEAST(v_tope, v_inicio + v_paso *
             (EXTRACT(EPOCH FROM (NOW() - q.created_at))::INTEGER / GREATEST(1, v_cada))
           ) AS banda
      FROM public.matchmaking_queue q
     WHERE q.status = 'searching'
       AND q.mode = p_mode
       AND COALESCE(q.colosseum_bet, 0) = COALESCE(p_bet, 0)
       AND q.room_code IS NOT DISTINCT FROM p_room_code
       AND q.tournament_id IS NOT DISTINCT FROM p_torneo
       AND q.created_at <= NOW() - make_interval(secs => v_espera)
       AND q.last_seen_at > NOW() - INTERVAL '45 seconds'
     -- ORDEN: PRIMERO LOS QUE VIENEN ATADOS.
     --
     -- "Atado" = tiene en este mismo lote al rival de su última partida. Ésos se
     -- procesan antes porque son los únicos que pueden quedarse sin opción: si
     -- primero se emparejan los libres entre ellos, al atado no le queda más que
     -- repetir rival. (Con A y B recién enfrentados y C y D libres: procesando C
     -- primero sale C-D, y entonces A sólo puede jugar contra B otra vez. Se vio
     -- en la prueba, que fallaba una de cada tres veces.)
     --
     -- Después, por ELO: cada uno coge a su vecino más cercano disponible.
     ORDER BY
       EXISTS (
         SELECT 1
           FROM public.matchmaking_queue q2
           JOIN public.game_rooms r
             ON ((r.player1_id = q.user_id AND r.player2_id = q2.user_id)
              OR (r.player2_id = q.user_id AND r.player1_id = q2.user_id))
          WHERE q2.status = 'searching'
            AND q2.mode = p_mode
            AND q2.user_id <> q.user_id
            AND r.created_at > NOW() - make_interval(mins => v_norepe)
       ) DESC,
       q.user_elo,
       random()
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Si ya lo emparejó esta misma pasada, se salta.
    CONTINUE WHEN v_fila.user_id = ANY(v_lote);

    -- El vecino más cercano por ELO que quede libre. Se prefiere a quien NO sea
    -- el rival de la última partida: repetir rival es lo que permitiría a dos
    -- cuentas jugar entre ellas a propósito. Si no hay nadie más, se acepta el
    -- repetido — mejor una revancha que dejarlos sin partida.
    SELECT q.* INTO v_cand
      FROM public.matchmaking_queue q
     WHERE q.status = 'searching'
       AND q.mode = p_mode
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
       -- Primera pasada: el rival reciente no vale. Segunda: ya vale.
       AND (v_pasada = 2 OR NOT EXISTS (
             SELECT 1 FROM public.game_rooms r
              WHERE r.created_at > NOW() - make_interval(mins => v_norepe)
                AND ((r.player1_id = v_fila.user_id AND r.player2_id = q.user_id)
                  OR (r.player2_id = v_fila.user_id AND r.player1_id = q.user_id))
           ))
     ORDER BY
       -- Por si acaso, el mismo criterio en el orden: primero los no recientes.
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

    -- Quien llegó antes a la cola es el jugador 1. Da igual para jugar —cada
    -- cliente se ve a sí mismo a la izquierda— pero fija un orden estable para
    -- los reportes de resultado.
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

  END LOOP;   -- pasadas

  RETURN v_hechos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._emparejar_lote(TEXT, NUMERIC, TEXT, UUID)
  FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. _try_match PASA A SER «CORRE EL LOTE Y MIRA SI ME TOCÓ»
--
--    Se mantiene el nombre y la firma a propósito: enter_matchmaking y
--    poll_matchmaking la llaman igual y no hay que tocarlas. El cambio de
--    comportamiento es que YA NO empareja al que acaba de entrar — tiene que
--    cumplir su espera como todo el mundo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._try_match(p_uid UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_yo   RECORD;
  v_room UUID;
BEGIN
  SELECT * INTO v_yo FROM public.matchmaking_queue
   WHERE user_id = p_uid AND status IN ('searching', 'matched')
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Puede que el lote de otro sondeo ya me haya emparejado.
  IF v_yo.status = 'matched' THEN RETURN v_yo.matched_room_id; END IF;

  -- Se corre el lote de MI grupo. Aunque yo aún no cumpla la espera, esto puede
  -- emparejar a otros que sí: quien sondea hace avanzar la cola de todos.
  PERFORM public._emparejar_lote(
    v_yo.mode, v_yo.colosseum_bet, v_yo.room_code, v_yo.tournament_id
  );

  SELECT matched_room_id INTO v_room FROM public.matchmaking_queue
   WHERE id = v_yo.id AND status = 'matched';

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._try_match(UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 5. EL SONDEO DICE CUÁNTO FALTA PARA EL SORTEO
--
--    Para que la pantalla de búsqueda pueda decir «buscando rival…» con sentido
--    en lugar de parecer que se ha quedado colgada cuatro segundos.
-- -----------------------------------------------------------------------------
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

  -- Señal de vida. Sin esto, el barrido nos sacaría de la cola.
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

  -- El coliseo tiene plazo: pasado el tiempo se cancela y se devuelve lo
  -- cobrado. No hay bots en coliseo, así que esperar más no sirve de nada.
  IF v_fila.mode = 'colosseum' AND v_esperado >= v_timeout THEN
    v_cancel := public.cancel_matchmaking();
    RETURN jsonb_build_object(
      'searching', FALSE, 'matched', FALSE, 'timedOut', TRUE,
      'refund', v_cancel->'refund',
      'message', 'No apareció rival. Se te devolvió la entrada.'
    );
  END IF;

  RETURN jsonb_build_object(
    'searching',     TRUE,
    'matched',       FALSE,
    'waitedSeconds', v_esperado,
    'mode',          v_fila.mode,
    -- Cuánto falta para entrar en el sorteo. En cuanto llega a cero, este
    -- jugador entra en el siguiente lote.
    'sorteoEnSegundos', GREATEST(0, v_espera - v_esperado),
    'timeoutSeconds', CASE WHEN v_fila.mode = 'colosseum' THEN v_timeout ELSE NULL END,
    'ghostAvailable', (v_fila.mode = 'ranked' AND v_esperado >= v_ghost)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.poll_matchmaking() TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('emparejar_por_lotes', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Los ajustes nuevos.
SELECT key, value FROM public.shop_config
 WHERE key IN ('mm_espera_de_lote_segundos', 'mm_cuenta_atras_segundos',
               'mm_no_repetir_minutos')
 ORDER BY key;

-- 2. Las salas nuevas nacen con hora de inicio EN EL FUTURO. Con partidas
--    recientes creadas después de esta migración, la diferencia debe ser
--    positiva (los segundos de cuenta atrás).
SELECT id, created_at, started_at,
       ROUND(EXTRACT(EPOCH FROM (started_at - created_at))::NUMERIC, 2) AS cuenta_atras
  FROM public.game_rooms
 ORDER BY created_at DESC LIMIT 5;

-- 3. Las tres internas siguen siendo internas.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS puede_authenticated
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('_create_room', '_try_match', '_emparejar_lote')
 ORDER BY p.proname;
-- Las tres deben salir en FALSE.
