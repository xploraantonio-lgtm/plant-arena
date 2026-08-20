-- =============================================================================
-- PLANT ARENA · EL REGISTRO DE ACCIONES
--
-- Idempotente. Ejecutar después de la 18.
--
-- QUÉ ES
--   La lista de todo lo que hizo cada jugador en una partida, con el TIC en que
--   lo hizo. Es la pieza que convierte dos navegadores jugando en paralelo en una
--   partida de verdad, y la que permitirá al servidor recalcular quién ganó en
--   lugar de creerse el "he ganado" del cliente.
--
-- POR QUÉ FUNCIONA
--   El motor es reproducible: con la misma semilla y las mismas acciones en los
--   mismos tics, el resultado es idéntico hasta el último decimal (36 tests lo
--   comprueban). La semilla ya la da el servidor e es la misma para los dos. Con
--   las acciones registradas, cualquiera puede recalcular la partida: el rival,
--   el servidor, o un visor de repeticiones.
--
-- CÓMO LLEGAN A TIEMPO
--   Cada acción se manda con el tic FUTURO en que debe ocurrir: el tic actual más
--   un margen (unos 200 ms). Los dos clientes la aplican en ese mismo tic, así
--   que las dos simulaciones convergen sin que ninguno tenga que esperar al otro.
--
--   Si una llega tarde, un cliente la aplica un tic después y las dos pantallas
--   se separan un poco. Da igual: quien decide el resultado es el servidor
--   recalculando desde este registro, no lo que vio un navegador.
--
-- LO QUE ESTO IMPIDE
--   · Plantar una carta que no tienes: se comprueba contra el mazo que el
--     servidor guardó en game_rooms, no contra lo que diga el cliente.
--   · Insertar acciones en el pasado para reescribir la partida.
--   · Seguir mandando acciones a una partida ya liquidada.
--   · Mandar la misma acción dos veces (el número de orden es único).
--   · Ahogar la partida a base de acciones: hay un tope por jugador.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public._settle_room(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 18: no existe _settle_room(uuid,uuid)';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LA TABLA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_actions (
    id        BIGSERIAL PRIMARY KEY,
    room_id   UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    /** Número de orden de este jugador en esta partida. Empieza en 1. */
    seq       INTEGER NOT NULL CHECK (seq > 0),
    /** El tic en que la acción debe ocurrir. */
    tick      INTEGER NOT NULL CHECK (tick >= 0),
    kind      TEXT NOT NULL CHECK (kind IN ('plant', 'dig')),
    plant_id  TEXT,
    lane      SMALLINT NOT NULL CHECK (lane BETWEEN 0 AND 2),
    col       SMALLINT CHECK (col BETWEEN 0 AND 11),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Mandar la misma acción dos veces (un reintento de red, o a mala fe) no
    -- puede duplicarla.
    UNIQUE (room_id, user_id, seq)
);

-- La consulta caliente: todas las acciones de una sala, en orden de tic.
CREATE INDEX IF NOT EXISTS idx_match_actions_sala
  ON public.match_actions (room_id, tick, id);

ALTER TABLE public.match_actions ENABLE ROW LEVEL SECURITY;

-- Leer: sólo las de las partidas en que participas. Necesitas ver las del rival
-- —son su jugada— pero no las de partidas ajenas.
DROP POLICY IF EXISTS "match_actions_read_own_rooms" ON public.match_actions;
CREATE POLICY "match_actions_read_own_rooms" ON public.match_actions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.game_rooms r
       WHERE r.id = match_actions.room_id
         AND auth.uid() IN (r.player1_id, r.player2_id)
    )
  );

-- Escribir: NADIE directamente. Todo pasa por la RPC de abajo, que es la que
-- comprueba que la carta es tuya y que el tic no está en el pasado. Con un INSERT
-- directo esas comprobaciones no existirían.
REVOKE INSERT, UPDATE, DELETE ON public.match_actions FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.match_actions_id_seq FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. AJUSTES
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Cuántos tics hacia atrás se acepta una acción. Con la red real algo llega
  -- tarde; más allá de esto es un intento de reescribir el pasado.
  ('ma_tolerancia_tics_atras', 30),
  -- Y hacia delante: nadie puede programar una jugada para dentro de un minuto.
  ('ma_tolerancia_tics_adelante', 90),
  -- Tope de acciones por jugador y partida. Una partida larga no pasa de unas
  -- decenas; esto sólo frena a quien quiera inundar la tabla.
  ('ma_max_acciones_por_jugador', 400)
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. ¿ESTÁ ESA CARTA EN TU MAZO?
--
--    Se comprueba contra el mazo que el servidor guardó al crear la sala, no
--    contra lo que mande el cliente. Es lo que impide plantar seis legendarias
--    que no tienes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._carta_en_mazo(
  p_room_id UUID,
  p_uid     UUID,
  p_plant   TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.game_rooms r
      -- El mazo del jugador que pregunta: p1_deck si es el jugador 1, p2_deck si
      -- es el 2.
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN r.player1_id = p_uid THEN r.p1_deck ELSE r.p2_deck END
      ) AS carta
     WHERE r.id = p_room_id
       AND p_uid IN (r.player1_id, r.player2_id)
       AND carta->>'plantId' = p_plant
  );
$$;

REVOKE EXECUTE ON FUNCTION public._carta_en_mazo(UUID, UUID, TEXT) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. REGISTRAR UNA ACCIÓN
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
  v_tic_ahora INTEGER;
  v_atras     INTEGER;
  v_adelante  INTEGER;
  v_tope      INTEGER;
  v_cuantas   INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  -- Una partida liquidada no se toca. Sin esto se podrían añadir acciones
  -- después de cobrar, y el recálculo del servidor daría otro ganador.
  IF v_room.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Partida ya liquidada';
  END IF;

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

  -- El tic en que va la partida, deducido del reloj del servidor y de cuándo se
  -- creó la sala. No se le pregunta al cliente: diría lo que le conviniera.
  --
  -- Un tic son 33 ms (engine/time.ts TICK_MS).
  v_tic_ahora := GREATEST(0,
    (EXTRACT(EPOCH FROM (NOW() - v_room.created_at)) * 1000 / 33)::INTEGER);

  IF p_tick < v_tic_ahora - v_atras THEN
    RAISE EXCEPTION 'Acción demasiado antigua: tic % cuando la partida va por el %',
      p_tick, v_tic_ahora;
  END IF;
  IF p_tick > v_tic_ahora + v_adelante THEN
    RAISE EXCEPTION 'Acción demasiado en el futuro: tic % cuando la partida va por el %',
      p_tick, v_tic_ahora;
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
    'serverTick', v_tic_ahora
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. LEER LAS ACCIONES DEL RIVAL
--
--    El camino normal es Realtime, que las entrega en cuanto se insertan. Esto es
--    la red de seguridad: al reconectar, o si se perdió un mensaje, se piden
--    todas las que falten desde un número de orden.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_actions_since(
  p_room_id UUID,
  p_desde_id BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.game_rooms r
     WHERE r.id = p_room_id AND v_uid IN (r.player1_id, r.player2_id)
  ) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',      a.id,
               'userId',  a.user_id,
               'seq',     a.seq,
               'tick',    a.tick,
               'kind',    a.kind,
               'plantId', a.plant_id,
               'lane',    a.lane,
               'col',     a.col
             ) ORDER BY a.id
           )
      FROM public.match_actions a
     WHERE a.room_id = p_room_id
       AND a.id > COALESCE(p_desde_id, 0)
  ), '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_actions_since(UUID, BIGINT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.match_actions_since(UUID, BIGINT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. REALTIME
--
--    Para que las acciones lleguen al rival en cuanto se insertan, en lugar de
--    tener que preguntar cada dos segundos.
--
--    En un Postgres pelado no existe la publicación de Supabase, así que se
--    intenta y se avisa si no está. No es motivo para abortar la migración: sin
--    Realtime el juego sigue funcionando pidiendo las acciones con
--    match_actions_since, sólo con más retardo.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public' AND tablename = 'match_actions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.match_actions;
      RAISE NOTICE 'match_actions añadida a Realtime';
    ELSE
      RAISE NOTICE 'match_actions ya estaba en Realtime';
    END IF;
  ELSE
    RAISE NOTICE 'No hay publicación supabase_realtime (Postgres local): se omite';
  END IF;
END
$$;

-- Realtime necesita la fila completa para entregarla; por defecto sólo manda la
-- clave primaria en los UPDATE/DELETE. Aquí sólo hay INSERT, pero se deja
-- explícito.
ALTER TABLE public.match_actions REPLICA IDENTITY FULL;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('registro_de_acciones', jsonb_build_object(
  'ajustes', (SELECT COUNT(*) FROM public.shop_config WHERE key LIKE 'ma_%')
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Los ajustes de tolerancia.
SELECT key, value FROM public.shop_config WHERE key LIKE 'ma_%' ORDER BY key;

-- 2. El cliente NO puede escribir en la tabla. Debe salir vacío.
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'match_actions'
   AND grantee IN ('anon', 'authenticated')
   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

-- 3. Las funciones y quién puede llamarlas. _carta_en_mazo debe ser interna.
SELECT p.proname,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'authenticated SÍ' ELSE 'sólo interna' END AS acceso
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('submit_match_action', 'match_actions_since', '_carta_en_mazo')
 ORDER BY p.proname;

-- 4. ¿Está en Realtime? (en Supabase debe devolver una fila)
SELECT schemaname, tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename = 'match_actions';
