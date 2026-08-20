-- =============================================================================
-- PLANT ARENA · LA PARTIDA TERMINA EN LOS DOS LADOS
--
-- Idempotente. Ejecutar después de la 20.
--
-- QUÉ RESUELVE
--
--   1. Si uno se rinde o pierde, el otro se quedaba jugando solo contra un campo
--      vacío, sin saber que ya había ganado. El resultado sólo existía en la
--      base y en la pantalla de quien lo provocó.
--
--      Ahora game_rooms va por Realtime: cuando la sala se liquida, el rival se
--      entera al instante y su partida termina con su victoria o su derrota.
--
--   2. Si alguien cierra el navegador a mitad de partida, el otro esperaba para
--      siempre un reporte que no iba a llegar. La partida se quedaba sin liquidar
--      y, en coliseo, la apuesta retenida con ella.
--
--      settle_abandoned_rooms cierra esas partidas pasado un plazo.
--
-- LA DECISIÓN DE QUIÉN GANA AL ABANDONAR
--   Si uno reportó y el otro nunca lo hizo, se honra el reporte del que sí. Es
--   discutible —quien reporta dice quién ganó, y podría declararse ganador y
--   esperar a que el otro no reporte— pero el caso normal es justo ese: el que se
--   fue no reporta, y el que se quedó tiene razón. La alternativa (no dar la
--   partida a nadie) castiga a quien se quedó jugando, que es peor.
--
--   Cuando el servidor recalcule la partida desde match_actions esto sobra: se
--   sabrá quién iba ganando y no habrá que fiarse de ningún reporte.
--
--   Si NINGUNO reportó, no se inventa un ganador: se marca abandonada y en
--   coliseo se devuelve lo cobrado a los dos.
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
-- 1. game_rooms POR REALTIME
--
--    Para que el rival se entere de que la partida acabó sin tener que preguntar.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public' AND tablename = 'game_rooms'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
      RAISE NOTICE 'game_rooms añadida a Realtime';
    ELSE
      RAISE NOTICE 'game_rooms ya estaba en Realtime';
    END IF;
  ELSE
    RAISE NOTICE 'No hay publicación supabase_realtime (Postgres local): se omite';
  END IF;
END
$$;

-- Realtime manda sólo la clave primaria en los UPDATE si no se le dice otra
-- cosa, y aquí lo que interesa es justo lo que cambia: status y settled_at.
ALTER TABLE public.game_rooms REPLICA IDENTITY FULL;


-- -----------------------------------------------------------------------------
-- 2. AJUSTES
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Sin señales de vida (ninguna acción nueva) más de esto, la partida se
  -- considera abandonada. Dos minutos: suficiente para un tramo tranquilo sin
  -- que nadie plante nada, y poco como espera para quien se quedó jugando.
  ('gr_abandono_segundos', 120)
ON CONFLICT (key) DO NOTHING;   -- DO NOTHING: no pisar un ajuste que hayas cambiado

-- La primera versión de esta migración puso 180. Si quedó ese valor exacto, se
-- corrige; cualquier otro se respeta, porque entonces es un ajuste tuyo y el
-- ON CONFLICT de arriba está justamente para no pisarlo.
UPDATE public.shop_config SET value = 120
 WHERE key = 'gr_abandono_segundos' AND value = 180;


-- -----------------------------------------------------------------------------
-- 3. CERRAR LAS PARTIDAS ABANDONADAS
--
--    Para pg_cron, junto a los otros barridos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_abandoned_rooms()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo      INTEGER;
  v_sala       RECORD;
  v_liquidadas INTEGER := 0;
  v_abandonadas INTEGER := 0;
BEGIN
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  FOR v_sala IN
    SELECT r.id, r.player1_id, r.player2_id,
           r.p1_reported_winner, r.p2_reported_winner, r.mode
      FROM public.game_rooms r
     WHERE r.status = 'playing'
       AND r.settled_at IS NULL
       -- Nada nuevo desde hace el plazo: ni acciones, ni la propia creación.
       AND GREATEST(
             r.created_at,
             COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                        WHERE a.room_id = r.id), r.created_at)
           ) < NOW() - make_interval(secs => v_plazo)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_sala.p1_reported_winner IS NOT NULL AND v_sala.p2_reported_winner IS NULL THEN
      -- Sólo reportó el jugador 1: se honra su reporte.
      PERFORM public._settle_room(v_sala.id, v_sala.p1_reported_winner);
      v_liquidadas := v_liquidadas + 1;

    ELSIF v_sala.p2_reported_winner IS NOT NULL AND v_sala.p1_reported_winner IS NULL THEN
      PERFORM public._settle_room(v_sala.id, v_sala.p2_reported_winner);
      v_liquidadas := v_liquidadas + 1;

    ELSE
      -- Ninguno reportó: no se inventa un ganador. Se marca abandonada y en
      -- coliseo se devuelve a los dos lo que pusieron, como en una disputa.
      UPDATE public.game_rooms
         SET status = 'abandoned', settled_at = NOW()
       WHERE id = v_sala.id;

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

      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      SELECT e.user_id, 'colosseum_refund',
             CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
             'Devolución: la partida se abandonó sin resultado',
             'completed'
        FROM public.colosseum_escrow e
       WHERE e.room_id = v_sala.id AND e.status = 'held';

      UPDATE public.colosseum_escrow
         SET status = 'refunded', refunded_at = NOW()
       WHERE room_id = v_sala.id AND status = 'held';

      v_abandonadas := v_abandonadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'settled',   v_liquidadas,
    'abandoned', v_abandonadas
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_abandoned_rooms() FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. EL RESULTADO DE UNA SALA, PARA QUIEN LA ESTÁ JUGANDO
--
--    El camino normal es Realtime. Esto es la red de seguridad, igual que con las
--    acciones: si el mensaje se perdió, el cliente pregunta y se entera.
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

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
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
    -- Lo que el cliente necesita saber sin tener que comparar identificadores.
    'iWon',   v_ganador IS NOT NULL AND v_ganador = v_uid,
    -- 'draw' es una disputa; 'abandoned', que nadie reportó. En los dos casos no
    -- hay ganador y en coliseo se devolvió lo cobrado.
    'noWinner', v_ganador IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.room_result(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.room_result(UUID) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fin_de_partida_en_los_dos_lados', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Las dos tablas en Realtime. En Supabase deben salir las dos filas.
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime'
   AND tablename IN ('match_actions', 'game_rooms')
 ORDER BY tablename;

-- 2. Las funciones nuevas. settle_abandoned_rooms debe ser interna.
SELECT p.proname,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'authenticated SÍ' ELSE 'sólo interna' END AS acceso
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('settle_abandoned_rooms', 'room_result')
 ORDER BY p.proname;

-- 3. El plazo de abandono.
SELECT key, value FROM public.shop_config WHERE key = 'gr_abandono_segundos';

-- 4. Programar el barrido en pg_cron, si lo tienes activo:
-- SELECT cron.schedule('cerrar-partidas-abandonadas', '* * * * *',
--                      $$SELECT public.settle_abandoned_rooms()$$);
