-- =============================================================================
-- PLANT ARENA · QUIÉN SIGUE AHÍ, Y EL ENLACE QUE NO SE GENERABA
--
-- Idempotente. Ejecutar después de la 25.
--
-- TRES COSAS QUE SE VIERON JUGANDO
--
-- 1. UNA PARTIDA ACABÓ EN "SIN RESULTADO" SIN QUE NADIE ATACARA NI SE RINDIERA
--
--    La causa: la única señal de vida de una partida era UNA JUGADA. Si los dos
--    jugadores se dedicaban a plantar girasoles y esperar, a los 120 segundos sin
--    plantar nada el servidor daba la sala por abandonada. Y estaban los dos ahí,
--    jugando.
--
--    Peor todavía: si uno cerraba el navegador de verdad, el que se quedaba NO
--    ganaba. Nadie había reportado, así que la sala se cerraba sin ganador. Lo
--    contrario de lo que dice el aviso al cerrar la pestaña ("perderá el duelo").
--
--    Aquí se separan las dos cosas. Cada jugador deja su huella —al plantar y al
--    preguntar por el resultado, que el cliente hace cada 4 segundos— y el plazo
--    se mide por jugador:
--      · uno presente y el otro no  → gana el que está
--      · ninguno de los dos         → abandonada, sin ganador y con devolución
--      · los dos presentes          → la partida sigue, planten o no
--
--    El arreglo de fondo va en el motor: desde ahora toda partida entra en muerte
--    súbita a los 2:30 y no puede pasar de 5:30. Esto es el cinturón: cubre el
--    navegador cerrado, que el motor no puede ver.
--
-- 2. EL BOTÓN DE COMPARTIR NO HACÍA NADA
--
--    share_match generaba el código con gen_random_bytes, que es de pgcrypto, y en
--    Supabase pgcrypto vive en el esquema `extensions`, que NO está en el
--    search_path de la función. Así que la llamada fallaba con
--    "function gen_random_bytes(integer) does not exist", el cliente recibía un
--    error y, como no lo enseñaba, el botón parecía muerto.
--
--    Ahora el código se saca de gen_random_uuid() y md5(), las dos de pg_catalog:
--    están siempre, en cualquier proyecto, sin depender de dónde se instalaron las
--    extensiones. Mismos 32 caracteres hexadecimales e igual de imposible de
--    adivinar.
--
-- 3. LA DURACIÓN QUE SE ENSEÑABA ERA LA DE LA ÚLTIMA JUGADA
--
--    Una partida de tres minutos donde nadie plantó nada después del segundo 52
--    salía como "52s". Se calculaba con el último tic registrado porque no había
--    otra cosa; ahora se usa lo que duró de verdad (de started_at a settled_at) y
--    el tic sólo como respaldo para las partidas viejas.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.share_match(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 25: no existe share_match()';
  END IF;
  IF to_regprocedure('public._settle_if_abandoned(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 22: no existe _settle_if_abandoned()';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LA HUELLA DE CADA JUGADOR
--
--    Cuándo se supo por última vez que cada uno seguía ahí. La escriben las RPC,
--    nunca el cliente: si se pudiera escribir a mano, cualquiera podría fingir que
--    su rival sigue conectado (para que la partida no se cierre) o que él mismo lo
--    está (para no perder por abandono).
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS p1_last_seen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS p2_last_seen TIMESTAMPTZ;

REVOKE UPDATE (p1_last_seen, p2_last_seen) ON public.game_rooms FROM anon, authenticated;


CREATE OR REPLACE FUNCTION public._marcar_presencia(p_room_id UUID, p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.game_rooms
     SET p1_last_seen = CASE WHEN player1_id = p_uid THEN NOW() ELSE p1_last_seen END,
         p2_last_seen = CASE WHEN player2_id = p_uid THEN NOW() ELSE p2_last_seen END
   WHERE id = p_room_id
     AND settled_at IS NULL
     AND p_uid IN (player1_id, player2_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._marcar_presencia(UUID, UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 2. EL ABANDONO SE MIDE POR JUGADOR
--
--    Y quien se queda, gana. Es lo que el juego ya le promete al que intenta
--    cerrar la pestaña; hasta ahora no era verdad.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_if_abandoned(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo     INTEGER;
  v_sala      RECORD;
  v_limite    TIMESTAMPTZ;
  v_p1        TIMESTAMPTZ;
  v_p2        TIMESTAMPTZ;
  v_presente  UUID;
  v_su_reporte UUID;
BEGIN
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  SELECT * INTO v_sala FROM public.game_rooms
   WHERE id = p_room_id AND status = 'playing' AND settled_at IS NULL
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_limite := NOW() - make_interval(secs => v_plazo);

  -- La última señal de cada uno: su huella, su última jugada, o la creación de la
  -- sala si acaba de empezar y todavía no ha hecho ninguna de las dos.
  --
  -- Las jugadas cuentan además de la huella porque son la señal más fuerte: si
  -- está plantando, está. Y la creación de la sala da el margen del principio,
  -- mientras los dos están cargando la pantalla.
  v_p1 := GREATEST(
            v_sala.created_at,
            COALESCE(v_sala.p1_last_seen, v_sala.created_at),
            COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                       WHERE a.room_id = p_room_id AND a.user_id = v_sala.player1_id),
                     v_sala.created_at));
  v_p2 := GREATEST(
            v_sala.created_at,
            COALESCE(v_sala.p2_last_seen, v_sala.created_at),
            COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                       WHERE a.room_id = p_room_id AND a.user_id = v_sala.player2_id),
                     v_sala.created_at));

  -- Los dos siguen ahí: la partida sigue, estén plantando o esperando. Este era
  -- el fallo — antes, dos jugadores presentes sin plantar durante dos minutos se
  -- quedaban sin resultado.
  --
  -- Y esta comprobación va PRIMERO, antes de mirar los reportes. Al revés se
  -- abría un agujero: un jugador reportaba "he ganado yo", llamaba acto seguido a
  -- room_result y la partida se cerraba a su favor sin que el rival —que seguía
  -- ahí jugando— confirmara nada.
  IF v_p1 >= v_limite AND v_p2 >= v_limite THEN
    RETURN FALSE;
  END IF;

  -- ── UNO SE FUE: GANA EL QUE SE QUEDA ──────────────────────────────────────
  --
  -- Con una excepción: si el que se queda YA HABÍA DICHO que perdió, se respeta
  -- lo que dijo. Nadie gana por quedarse mirando una partida que reconoció haber
  -- perdido.
  --
  -- Y no al contrario: el reporte del AUSENTE no le sirve para ganar. Si valiera,
  -- bastaría con reportar "he ganado" y cerrar el navegador para ganar cualquier
  -- partida.
  IF v_p1 >= v_limite OR v_p2 >= v_limite THEN
    v_presente   := CASE WHEN v_p1 >= v_limite THEN v_sala.player1_id ELSE v_sala.player2_id END;
    v_su_reporte := CASE WHEN v_p1 >= v_limite THEN v_sala.p1_reported_winner
                                               ELSE v_sala.p2_reported_winner END;

    IF v_su_reporte IS NOT NULL AND v_su_reporte <> v_presente THEN
      PERFORM public._settle_room(p_room_id, v_su_reporte);
    ELSE
      PERFORM public._settle_room(p_room_id, v_presente);
    END IF;
    RETURN TRUE;
  END IF;

  -- ── NO QUEDA NADIE ────────────────────────────────────────────────────────
  --
  -- Si uno de los dos dejó dicho quién ganó, vale: ya no hay nadie presente a
  -- quien ese reporte pueda perjudicar.
  IF v_sala.p1_reported_winner IS NOT NULL AND v_sala.p2_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p1_reported_winner);
    RETURN TRUE;
  ELSIF v_sala.p2_reported_winner IS NOT NULL AND v_sala.p1_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p2_reported_winner);
    RETURN TRUE;
  END IF;

  -- Ninguno reportó: no se inventa un ganador. Abandonada, y en coliseo se
  -- devuelve a cada uno lo que puso.
  UPDATE public.game_rooms
     SET status = 'abandoned', settled_at = NOW()
   WHERE id = p_room_id;

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

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  SELECT e.user_id, 'colosseum_refund',
         CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
         'Devolución: la partida se abandonó sin resultado',
         'completed'
    FROM public.colosseum_escrow e
   WHERE e.room_id = p_room_id AND e.status = 'held';

  UPDATE public.colosseum_escrow
     SET status = 'refunded', refunded_at = NOW()
   WHERE room_id = p_room_id AND status = 'held';

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_if_abandoned(UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 3. PREGUNTAR POR EL RESULTADO DEJA HUELLA
--
--    El cliente ya llama a esto cada 4 segundos mientras juega. O sea que ya
--    existía la señal de "sigo aquí": sólo había que apuntarla.
--
--    Importante el ORDEN: primero se marca la presencia de quien pregunta y
--    después se comprueba el abandono. Al revés, el que está esperando podría
--    perder por su propio plazo antes de haberse anotado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_result(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
  v_ganador UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Comprobación de acceso ANTES de tocar nada: no se limpia una sala ajena.
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  IF v_room.settled_at IS NULL THEN
    PERFORM public._marcar_presencia(p_room_id, v_uid);
    IF public._settle_if_abandoned(p_room_id) THEN
      SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
    END IF;
  END IF;

  IF v_room.settled_at IS NULL THEN
    RETURN jsonb_build_object('ended', FALSE, 'status', v_room.status);
  END IF;

  v_ganador := CASE v_room.status
                 WHEN 'p1_won' THEN v_room.player1_id
                 WHEN 'p2_won' THEN v_room.player2_id
                 ELSE NULL
               END;

  RETURN jsonb_build_object(
    'ended',  TRUE,
    'status', v_room.status,
    'winner', v_ganador,
    'iWon',   v_ganador IS NOT NULL AND v_ganador = v_uid,
    'noWinner', v_ganador IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.room_result(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.room_result(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. EL BARRIDO GENERAL, CON EL MISMO CRITERIO
--
--    settle_abandoned_rooms recorre todas las salas abiertas. Ahora delega en
--    _settle_if_abandoned en lugar de repetir la regla: una sola definición de
--    "abandonada" y no dos que se pueden separar con el tiempo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_abandoned_rooms()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo   INTEGER;
  v_sala    RECORD;
  v_cerradas INTEGER := 0;
BEGIN
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  -- Sólo las candidatas: nada nuevo en la sala desde hace el plazo. La decisión
  -- fina (quién falta, quién se queda) la toma _settle_if_abandoned.
  FOR v_sala IN
    SELECT id FROM public.game_rooms
     WHERE status = 'playing' AND settled_at IS NULL
       AND GREATEST(
             created_at,
             COALESCE(p1_last_seen, created_at),
             COALESCE(p2_last_seen, created_at)
           ) < NOW() - make_interval(secs => v_plazo)
  LOOP
    IF public._settle_if_abandoned(v_sala.id) THEN
      v_cerradas := v_cerradas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cerradas', v_cerradas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_abandoned_rooms() FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 5. EL CÓDIGO PARA COMPARTIR, SIN DEPENDER DE PGCRYPTO
--
--    md5(uuid || uuid) da 32 caracteres hexadecimales igual que encode(16 bytes),
--    y las dos funciones que usa están en pg_catalog: no hay search_path que las
--    esconda. Dos UUID v4 son 244 bits de azar; nadie adivina ni recorre eso.
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

  v_token := md5(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT);

  UPDATE public.game_rooms
     SET share_token = v_token, shared_at = NOW()
   WHERE id = p_room_id;

  RETURN jsonb_build_object('token', v_token, 'yaExistia', FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_match(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.share_match(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. LA DURACIÓN DE VERDAD
--
--    De started_at a settled_at. El último tic registrado sólo como respaldo para
--    las partidas de antes de que existiera el reloj común.
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
                 'duracionSegundos', GREATEST(0, COALESCE(
                   -- Lo que duró de verdad.
                   CASE WHEN r.started_at IS NOT NULL AND r.settled_at IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (r.settled_at - r.started_at)))
                   END,
                   -- Respaldo: el último tic registrado. Un tic son 33 ms.
                   (SELECT ROUND(MAX(a.tick) * 33 / 1000.0)
                      FROM public.match_actions a WHERE a.room_id = r.id),
                   0
                 )),
                 'rival', CASE WHEN r.player1_id = v_uid THEN p2.username ELSE p1.username END,
                 'rivalAvatar', CASE WHEN r.player1_id = v_uid THEN p2.avatar_id ELSE p1.avatar_id END,
                 'gane', CASE
                           WHEN r.status = 'p1_won' THEN r.player1_id = v_uid
                           WHEN r.status = 'p2_won' THEN r.player2_id = v_uid
                           ELSE NULL
                         END,
                 'estado', r.status,
                 'jugadas', (SELECT COUNT(*) FROM public.match_actions a WHERE a.room_id = r.id),
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


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('presencia_y_enlaces', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Las columnas de presencia existen y el cliente NO puede escribirlas.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'game_rooms'
   AND column_name IN ('p1_last_seen', 'p2_last_seen')
 ORDER BY column_name;

SELECT grantee, privilege_type, column_name
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'game_rooms'
   AND column_name IN ('p1_last_seen', 'p2_last_seen')
   AND grantee IN ('anon', 'authenticated')
   AND privilege_type = 'UPDATE';
-- Debe salir VACÍO.

-- 2. El código para compartir se genera sin pgcrypto.
SELECT LENGTH(md5(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT)) AS largo_del_codigo;
-- Debe dar 32.
