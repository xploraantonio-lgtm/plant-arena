-- =============================================================================
-- PLANT ARENA · LOS BARRIDOS NO NECESITAN CRON
--
-- Idempotente. Ejecutar después de la 21.
--
-- EL PROBLEMA
--   Tres funciones estaban escritas para pg_cron:
--     · settle_abandoned_rooms      (21) cierra partidas que nadie sigue jugando
--     · sweep_matchmaking_queue     (17) saca de la cola a quien cerró la pestaña
--     · expire_stale_colosseum_escrows (15) devuelve apuestas retenidas caducadas
--
--   Y este proyecto no tiene pg_cron. O sea que NINGUNO se ejecutaba nunca. Con
--   eso, si alguien cierra el navegador a mitad de partida, su rival espera para
--   siempre: la sala nunca se liquida y, en coliseo, la apuesta se queda retenida
--   con ella.
--
-- LA SOLUCIÓN
--   Que los barridos se disparen CUANDO ALGUIEN LOS NECESITA, no por reloj.
--
--   Quien está esperando ya está preguntando: el cliente llama a room_result cada
--   4 segundos mientras la partida sigue, y a poll_matchmaking cada 2 mientras
--   busca rival. Esos son exactamente los momentos en que hay que limpiar, y
--   quien pregunta es justo a quien le importa.
--
--   Así no hace falta infraestructura. Si algún día activas pg_cron, los barridos
--   siguen valiendo tal cual y de paso se ejecutan también cuando no hay nadie
--   mirando; deja de ser un requisito y pasa a ser una mejora.
--
-- POR QUÉ NO SE PUEDE ADELANTAR NADA CON ESTO
--   Una partida sólo se considera abandonada tras 120 segundos sin ninguna acción
--   nueva. Preguntar más veces no acorta ese plazo: la condición la comprueba el
--   servidor con su propio reloj. Alguien que llame mil veces no consigue nada
--   más que alguien que llame una.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.settle_abandoned_rooms()') IS NULL THEN
    RAISE EXCEPTION 'Falta la 21: no existe settle_abandoned_rooms()';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. CERRAR *UNA* SALA SI ESTÁ ABANDONADA
--
--    settle_abandoned_rooms recorre todas. Para el caso de "estoy esperando y mi
--    rival desapareció" basta con mirar la mía, que es mucho más barato: se va a
--    llamar cada 4 segundos por cada jugador esperando.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_if_abandoned(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo   INTEGER;
  v_sala    RECORD;
  v_ultima  TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  SELECT * INTO v_sala FROM public.game_rooms
   WHERE id = p_room_id AND status = 'playing' AND settled_at IS NULL
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- La última señal de vida de la partida: la acción más reciente, o su creación
  -- si todavía no hubo ninguna.
  SELECT GREATEST(
           v_sala.created_at,
           COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                      WHERE a.room_id = p_room_id), v_sala.created_at)
         ) INTO v_ultima;

  IF v_ultima >= NOW() - make_interval(secs => v_plazo) THEN
    RETURN FALSE;   -- sigue viva
  END IF;

  IF v_sala.p1_reported_winner IS NOT NULL AND v_sala.p2_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p1_reported_winner);
    RETURN TRUE;
  ELSIF v_sala.p2_reported_winner IS NOT NULL AND v_sala.p1_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p2_reported_winner);
    RETURN TRUE;
  END IF;

  -- Nadie reportó: no se inventa un ganador. Abandonada, y en coliseo se
  -- devuelve a los dos lo que pusieron.
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
-- 2. room_result LIMPIA LO SUYO ANTES DE CONTESTAR
--
--    El cliente ya llama a esto cada 4 segundos mientras la partida sigue. Es el
--    momento exacto en que hay que comprobar si el rival se fue, y quien pregunta
--    es justo el que está esperando.
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

  -- Si el rival desapareció y ya venció el plazo, se cierra aquí. Llamar más
  -- veces no lo adelanta: el plazo lo mide el servidor con su reloj.
  IF v_room.settled_at IS NULL THEN
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
    -- 'draw' es una disputa; 'abandoned', que nadie reportó. En los dos casos no
    -- hay ganador y en coliseo se devolvió lo cobrado.
    'noWinner', v_ganador IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.room_result(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.room_result(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. LA COLA SE LIMPIA AL SONDEARLA
--
--    Mismo razonamiento: quien busca rival está llamando cada 2 segundos, y le
--    conviene que la cola no tenga pestañas cerradas — se emparejaría con una.
--
--    Se limita a una vez cada 10 segundos por si hay mucha gente buscando: barrer
--    en cada sondeo de cada jugador sería trabajo repetido sin ganancia.
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  ('mm_barrido_cada_segundos', 10)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public._sweep_state (
    nombre     TEXT PRIMARY KEY,
    ultima_vez TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public._sweep_state ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo la tocan las funciones SECURITY DEFINER.

/**
 * Barre la cola y las apuestas caducadas, como mucho una vez cada N segundos.
 *
 * Devuelve TRUE si barrió. El bloqueo de la fila con FOR UPDATE SKIP LOCKED evita
 * que dos jugadores sondeando a la vez barran los dos.
 */
CREATE OR REPLACE FUNCTION public._sweep_si_toca()
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cada INTEGER;
  v_toca BOOLEAN := FALSE;
BEGIN
  SELECT COALESCE(value::INTEGER, 10) INTO v_cada
    FROM public.shop_config WHERE key = 'mm_barrido_cada_segundos';
  v_cada := COALESCE(v_cada, 10);

  INSERT INTO public._sweep_state (nombre, ultima_vez)
  VALUES ('cola', NOW() - INTERVAL '1 day')
  ON CONFLICT (nombre) DO NOTHING;

  UPDATE public._sweep_state
     SET ultima_vez = NOW()
   WHERE nombre = 'cola'
     AND ultima_vez < NOW() - make_interval(secs => v_cada)
  RETURNING TRUE INTO v_toca;

  IF COALESCE(v_toca, FALSE) THEN
    PERFORM public.sweep_matchmaking_queue();
  END IF;

  RETURN COALESCE(v_toca, FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._sweep_si_toca() FROM anon, authenticated, PUBLIC;


-- poll_matchmaking pasa a barrer de paso. El resto de la función no cambia: se
-- reescribe entera porque plpgsql no permite parchear un trozo.
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
  v_cancel   JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Sin pg_cron, este es el momento de limpiar: quien busca rival no quiere
  -- emparejarse con una pestaña cerrada. Se autolimita por tiempo, así que
  -- sondear más no cuesta más.
  PERFORM public._sweep_si_toca();

  SELECT * INTO v_fila FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status IN ('searching', 'matched')
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('searching', FALSE, 'matched', FALSE);
  END IF;

  IF v_fila.status = 'matched' THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_fila.matched_room_id);
  END IF;

  UPDATE public.matchmaking_queue SET last_seen_at = NOW() WHERE id = v_fila.id;

  v_room := public._try_match(v_uid);
  IF v_room IS NOT NULL THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_room);
  END IF;

  v_esperado := EXTRACT(EPOCH FROM (NOW() - v_fila.created_at))::INTEGER;

  SELECT COALESCE(MAX(CASE WHEN key = 'colosseum_queue_timeout_seconds' THEN value::INTEGER END), 240),
         COALESCE(MAX(CASE WHEN key = 'mm_ranked_ghost_after_seconds'   THEN value::INTEGER END), 30)
    INTO v_timeout, v_ghost
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
    'searching',      TRUE,
    'matched',        FALSE,
    'waitedSeconds',  v_esperado,
    'mode',           v_fila.mode,
    'timeoutSeconds', CASE WHEN v_fila.mode = 'colosseum' THEN v_timeout ELSE NULL END,
    'ghostAvailable', (v_fila.mode = 'ranked' AND v_esperado >= v_ghost)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.poll_matchmaking() TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('barridos_sin_cron', jsonb_build_object(
  'tiene_pg_cron', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Las funciones nuevas deben ser internas.
SELECT p.proname,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'authenticated SÍ' ELSE 'sólo interna' END AS acceso
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('_settle_if_abandoned', '_sweep_si_toca', 'room_result', 'poll_matchmaking')
 ORDER BY p.proname;

-- 2. ¿Hay pg_cron? Si algún día lo activas, los barridos siguen valiendo y de
--    paso se ejecutan también cuando no hay nadie jugando.
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') AS tiene_pg_cron;

-- 3. Partidas sin liquidar y cuánto llevan calladas. Aquí se ve si alguna se
--    quedó colgada.
SELECT r.id,
       r.status,
       round(EXTRACT(EPOCH FROM (NOW() - GREATEST(
         r.created_at,
         COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                    WHERE a.room_id = r.id), r.created_at)
       )))) AS segundos_callada,
       r.p1_reported_winner IS NOT NULL AS reporto_p1,
       r.p2_reported_winner IS NOT NULL AS reporto_p2
  FROM public.game_rooms r
 WHERE r.settled_at IS NULL
 ORDER BY r.created_at DESC
 LIMIT 20;
