-- =============================================================================
-- PLANT ARENA · REPETICIONES Y ENLACES PARA COMPARTIR
--
-- Idempotente. Ejecutar después de la 24.
--
-- QUÉ HACE POSIBLE ESTO
--   Una repetición no es un vídeo: es la partida VUELTA A EJECUTAR. Con la misma
--   semilla y las mismas acciones en los mismos tics, el motor da exactamente el
--   mismo resultado — eso es lo que se lleva verificando desde el principio con
--   69 tests.
--
--   Así que no hay que guardar nada nuevo. Todo está ya: game_rooms tiene la
--   semilla y los dos mazos, y match_actions tiene lo que hizo cada uno y cuándo.
--   Una repetición ocupa unas decenas de filas en lugar de megas de vídeo.
--
-- LO QUE SÍ HACE FALTA
--   1. Poder listar tus partidas.
--   2. Poder leer una entera de una vez.
--   3. Poder compartirla con quien no jugó — y eso hay que pensarlo, porque una
--      repetición enseña los dos mazos y los dos nicks.
--
-- CÓMO SE COMPARTE, Y POR QUÉ ASÍ
--   No se hace pública ninguna partida. Cuando el jugador quiere compartir una,
--   pide un código: una cadena larga e imposible de adivinar. Quien tenga el
--   enlace puede verla; quien no, no.
--
--   Se hace con código y no con "marcar como pública" por dos razones: no hay
--   nada que enumerar (nadie puede recorrer las partidas de otros probando
--   identificadores) y el jugador puede revocarlo cuando quiera.
--
--   Y lo que se enseña por el enlace está recortado a propósito: nicks, mazos y
--   jugadas. Ni identificadores de usuario, ni saldos, ni ELO.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.match_actions') IS NULL THEN
    RAISE EXCEPTION 'Falta la 19: no existe match_actions';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. EL CÓDIGO PARA COMPARTIR
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at   TIMESTAMPTZ;

-- Buscar por código es la consulta de quien abre el enlace.
CREATE INDEX IF NOT EXISTS idx_game_rooms_share_token
  ON public.game_rooms (share_token)
  WHERE share_token IS NOT NULL;

-- El jugador no escribe esta columna a mano: la pone la RPC de abajo. Si pudiera
-- escribirla, podría ponerle un código corto y adivinable, o el de otro.
REVOKE UPDATE (share_token, shared_at) ON public.game_rooms FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. MIS PARTIDAS
--
--    Sólo las liquidadas: una a medias no tiene resultado que contar. Trae lo
--    justo para pintar una lista — quién, qué modo, cómo acabó, cuánto duró.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_matches(p_limite INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(fila ORDER BY (fila->>'jugadaEn') DESC)
      FROM (
        SELECT jsonb_build_object(
                 'roomId',   r.id,
                 'mode',     r.mode,
                 'jugadaEn', COALESCE(r.started_at, r.created_at),
                 -- Cuánto duró, en segundos, según el último tic registrado.
                 -- Un tic son 33 ms (engine/time.ts).
                 'duracionSegundos', COALESCE((
                   SELECT ROUND(MAX(a.tick) * 33 / 1000.0)
                     FROM public.match_actions a WHERE a.room_id = r.id
                 ), 0),
                 'rival', CASE WHEN r.player1_id = v_uid THEN p2.username ELSE p1.username END,
                 'rivalAvatar', CASE WHEN r.player1_id = v_uid THEN p2.avatar_id ELSE p1.avatar_id END,
                 -- Desde el punto de vista de quien pregunta, para que el cliente
                 -- no tenga que comparar identificadores.
                 'gane', CASE
                           WHEN r.status = 'p1_won' THEN r.player1_id = v_uid
                           WHEN r.status = 'p2_won' THEN r.player2_id = v_uid
                           ELSE NULL
                         END,
                 'estado', r.status,
                 'jugadas', (SELECT COUNT(*) FROM public.match_actions a WHERE a.room_id = r.id),
                 -- Si ya tiene enlace, se devuelve para no volver a pedirlo.
                 'shareToken', r.share_token
               ) AS fila
          FROM public.game_rooms r
          LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
          LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
         WHERE (r.player1_id = v_uid OR r.player2_id = v_uid)
           AND r.settled_at IS NOT NULL
         ORDER BY COALESCE(r.started_at, r.created_at) DESC
         LIMIT GREATEST(1, LEAST(100, COALESCE(p_limite, 20)))
      ) AS sub
  ), '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_matches(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_matches(INTEGER) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. UNA REPETICIÓN ENTERA
--
--    Todo lo que el motor necesita para volver a ejecutar la partida: la semilla,
--    los dos mazos y las jugadas de cada uno con su tic.
--
--    Se llama de dos formas:
--      · con el identificador de la sala, si participaste
--      · con el código para compartir, si te dieron el enlace
--
--    En los dos casos devuelve lo MISMO recortado: nicks, mazos y jugadas. Nunca
--    identificadores de usuario ni nada del perfil.
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

  SELECT r.*, p1.username AS n1, p1.avatar_id AS a1, p2.username AS n2, p2.avatar_id AS a2
    INTO v_room
    FROM public.game_rooms r
    LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
    LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
   WHERE (p_token IS NOT NULL AND r.share_token = p_token)
      OR (p_token IS NULL AND r.id = p_room_id);

  IF NOT FOUND THEN RAISE EXCEPTION 'Repetición no encontrada'; END IF;

  -- Por código, cualquiera. Por identificador, sólo quien jugó: si no, se podrían
  -- recorrer identificadores y ver partidas ajenas sin que nadie las compartiera.
  IF p_token IS NULL THEN
    IF v_uid IS NULL OR v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participaste en esta partida';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'roomId',   v_room.id,
    'mode',     v_room.mode,
    'seed',     v_room.seed,
    'estado',   v_room.status,
    'jugadaEn', COALESCE(v_room.started_at, v_room.created_at),
    -- Sin identificadores de usuario: quien mira una repetición no necesita saber
    -- quién es nadie en la base de datos.
    'jugador1', jsonb_build_object('nombre', v_room.n1, 'avatar', v_room.a1, 'mazo', v_room.p1_deck),
    'jugador2', jsonb_build_object('nombre', v_room.n2, 'avatar', v_room.a2, 'mazo', v_room.p2_deck),
    -- Quién ganó, como número de jugador y no como identificador.
    'ganador',  CASE v_room.status WHEN 'p1_won' THEN 1 WHEN 'p2_won' THEN 2 ELSE NULL END,
    -- Y quién eres tú, si eres alguien: para poder mirar desde tu lado.
    'yoSoy',    CASE WHEN v_uid = v_room.player1_id THEN 1
                     WHEN v_uid = v_room.player2_id THEN 2
                     ELSE NULL END,
    'jugadas',  COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 -- 1 o 2, no el identificador del usuario.
                 'de',      CASE WHEN a.user_id = v_room.player1_id THEN 1 ELSE 2 END,
                 'tick',    a.tick,
                 'kind',    a.kind,
                 'plantId', a.plant_id,
                 'lane',    a.lane,
                 'col',     a.col
               ) ORDER BY a.tick, a.id
             )
        FROM public.match_actions a
       WHERE a.room_id = v_room.id
    ), '[]'::JSONB)
  );
END;
$$;

-- anon SÍ puede llamarla: es la que atiende los enlaces compartidos, y quien
-- abre uno puede no tener cuenta. Sin código no devuelve nada, porque sin sesión
-- la comprobación de participante falla.
GRANT EXECUTE ON FUNCTION public.match_replay(UUID, TEXT) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. COMPARTIR Y DEJAR DE COMPARTIR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.share_match(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_room  RECORD;
  v_token TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participaste en esta partida';
  END IF;
  IF v_room.settled_at IS NULL THEN
    RAISE EXCEPTION 'La partida todavía no ha terminado';
  END IF;

  -- Si ya tiene código se devuelve el mismo: así el enlace que alguien ya
  -- compartió no deja de funcionar por volver a pulsar el botón.
  IF v_room.share_token IS NOT NULL THEN
    RETURN jsonb_build_object('token', v_room.share_token, 'yaExistia', TRUE);
  END IF;

  -- 32 caracteres hexadecimales, de gen_random_bytes: imposible de adivinar y sin
  -- nada que se pueda enumerar. Un identificador correlativo permitiría recorrer
  -- las partidas de todo el mundo.
  v_token := encode(gen_random_bytes(16), 'hex');

  UPDATE public.game_rooms
     SET share_token = v_token, shared_at = NOW()
   WHERE id = p_room_id;

  RETURN jsonb_build_object('token', v_token, 'yaExistia', FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_match(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.share_match(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.unshare_match(p_room_id UUID)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participaste en esta partida';
  END IF;

  -- Se puede revocar: el enlace deja de funcionar para todo el mundo. Cualquiera
  -- de los dos jugadores puede hacerlo, porque la repetición enseña el mazo de
  -- los dos y los dos tienen derecho a retirarla.
  UPDATE public.game_rooms
     SET share_token = NULL, shared_at = NULL
   WHERE id = p_room_id;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unshare_match(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unshare_match(UUID) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('repeticiones', jsonb_build_object(
  'partidas_guardadas', (SELECT COUNT(*) FROM public.game_rooms WHERE settled_at IS NOT NULL)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Las funciones y quién puede llamarlas. match_replay es la única que anon
--    puede llamar, porque atiende los enlaces compartidos.
SELECT p.proname,
       CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon SÍ' ELSE 'no' END AS anon,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sí' ELSE 'no' END AS autenticado
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('my_matches', 'match_replay', 'share_match', 'unshare_match')
 ORDER BY p.proname;

-- 2. El jugador NO puede escribir el código a mano. Debe salir vacío.
SELECT grantee, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='game_rooms'
   AND column_name IN ('share_token','shared_at')
   AND grantee IN ('anon','authenticated')
   AND privilege_type='UPDATE';

-- 3. Cuántas partidas hay guardadas y con cuántas jugadas. Si 'jugadas' sale 0,
--    la partida se jugó antes de la migración 19 y no se puede reproducir.
SELECT r.id,
       COALESCE(r.started_at, r.created_at) AS jugada_en,
       r.mode, r.status,
       (SELECT COUNT(*) FROM public.match_actions a WHERE a.room_id = r.id) AS jugadas,
       r.share_token IS NOT NULL AS compartida
  FROM public.game_rooms r
 WHERE r.settled_at IS NOT NULL
 ORDER BY COALESCE(r.started_at, r.created_at) DESC
 LIMIT 20;
