-- =============================================================================
-- PLANT ARENA · NO REUTILIZAR SALAS VIEJAS
--
-- Idempotente. Ejecutar después de la 23.
--
-- LA SOSPECHA PRINCIPAL DE POR QUÉ NO OS VEÍAIS
--   enter_matchmaking, antes de encolar, comprueba si ya tienes una partida en
--   curso y te devuelve a ella. La condición era: sin liquidar, en estado
--   'playing', y creada en los últimos 15 minutos.
--
--   El problema: hasta la 22 nada liquidaba las partidas abandonadas, así que las
--   pruebas anteriores dejaron varias salas colgadas. Y entonces pasa esto:
--
--     · buscas partida  → te devuelve a TU sala vieja
--     · el otro busca   → le devuelve a la SUYA, que es otra
--     · los dos creéis estar emparejados y estáis en salas distintas
--
--   De ahí los dos síntomas juntos: no veíais lo que plantaba el otro (sus
--   acciones iban a otra sala) y los soles no coincidían (dos semillas distintas).
--
--   La foto encajaba: los dos con su partida, ninguno con el otro.
--
-- LA CORRECCIÓN
--   Antes de devolverte a una sala, se comprueba si está abandonada y se cierra.
--   Sólo se reanuda una partida con señales de vida recientes — que es lo que
--   "estoy jugando" significa de verdad.
--
--   Y se acorta el margen: 15 minutos era muchísimo. Una partida de este juego
--   dura unos minutos, así que con que haya habido actividad en los últimos 2
--   basta, y es el mismo plazo que usa el abandono.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public._settle_if_abandoned(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 22: no existe _settle_if_abandoned(uuid)';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LIMPIAR LO QUE YA HAY COLGADO
--
--    Las salas de las pruebas anteriores. Sin esto, la corrección de abajo no
--    sirve de nada hasta que venzan solas.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sala UUID;
  v_cerradas INTEGER := 0;
BEGIN
  FOR v_sala IN
    SELECT id FROM public.game_rooms
     WHERE status = 'playing' AND settled_at IS NULL
  LOOP
    IF public._settle_if_abandoned(v_sala) THEN
      v_cerradas := v_cerradas + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Salas colgadas cerradas: %', v_cerradas;
END
$$;


-- -----------------------------------------------------------------------------
-- 2. SÓLO SE REANUDA UNA PARTIDA VIVA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enter_matchmaking(
  p_mode       TEXT,
  p_bet        NUMERIC DEFAULT 0,
  p_use_ticket BOOLEAN DEFAULT FALSE,
  p_room_code  TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_elo    INTEGER;
  v_deck   JSONB;
  v_room   UUID;
  v_escrow UUID;
  v_apuesta JSONB;
  v_plazo  INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF p_mode NOT IN ('ranked', 'friendly', 'colosseum', 'tournament') THEN
    RAISE EXCEPTION 'Modo de juego no válido: %', p_mode;
  END IF;

  IF p_mode = 'colosseum' AND (p_bet IS NULL OR p_bet <= 0) THEN
    RAISE EXCEPTION 'Elige la cantidad de la apuesta antes de entrar al Coliseo';
  END IF;

  -- Quitar una búsqueda anterior propia que se hubiera quedado colgada. Va
  -- primero: si no, quien tuviera partida en curso y una búsqueda colgada
  -- seguiría apareciendo como rival disponible mientras juega.
  IF EXISTS (SELECT 1 FROM public.matchmaking_queue
              WHERE user_id = v_uid AND status = 'searching') THEN
    PERFORM public.cancel_matchmaking();
  END IF;

  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  -- ── ¿HAY UNA PARTIDA MÍA DE VERDAD EN CURSO? ──────────────────────────────
  --
  -- Antes bastaba con que existiera y fuera de los últimos 15 minutos. Eso
  -- devolvía a cada jugador a SU sala vieja, así que los dos creían estar
  -- emparejados estando en salas distintas: no se veían las plantas y los soles
  -- no coincidían, porque eran dos partidas.
  --
  -- Ahora se cierra la que esté abandonada y sólo se reanuda la que tenga
  -- señales de vida recientes, que es lo que "estoy jugando" significa.
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
     -- Actividad reciente: una acción nueva, o la sala recién creada.
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

  -- El coliseo cobra ANTES de entrar en la cola. Así, si no aparece rival, hay
  -- una retención concreta que devolver.
  IF p_mode = 'colosseum' THEN
    v_apuesta := public.place_colosseum_wager(p_bet, p_use_ticket);
    v_escrow  := (v_apuesta->>'escrowId')::UUID;
  END IF;

  INSERT INTO public.matchmaking_queue
    (user_id, mode, colosseum_bet, user_elo, room_code, status, escrow_id, last_seen_at)
  VALUES
    (v_uid, p_mode,
     CASE WHEN p_mode = 'colosseum' THEN p_bet ELSE NULL END,
     v_elo, p_room_code, 'searching', v_escrow, NOW());

  v_room := public._try_match(v_uid);

  IF v_room IS NOT NULL THEN
    RETURN jsonb_build_object('matched', TRUE, 'roomId', v_room);
  END IF;

  RETURN jsonb_build_object('matched', FALSE, 'searching', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('no_reutilizar_salas_viejas', jsonb_build_object(
  'colgadas_restantes', (SELECT COUNT(*) FROM public.game_rooms
                          WHERE status = 'playing' AND settled_at IS NULL)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. ¿Queda alguna sala colgada? Debería ser 0, o sólo las de ahora mismo.
SELECT id,
       round(EXTRACT(EPOCH FROM (NOW() - GREATEST(
         created_at,
         COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                    WHERE a.room_id = game_rooms.id), created_at)
       )))) AS segundos_callada,
       status
  FROM public.game_rooms
 WHERE settled_at IS NULL
 ORDER BY created_at DESC;

-- 2. Las últimas partidas, con cuántas acciones registró cada jugador. Si las dos
--    columnas tienen números, el registro funciona en los dos sentidos.
SELECT r.id,
       r.started_at,
       (SELECT COUNT(*) FROM public.match_actions a
         WHERE a.room_id = r.id AND a.user_id = r.player1_id) AS acciones_p1,
       (SELECT COUNT(*) FROM public.match_actions a
         WHERE a.room_id = r.id AND a.user_id = r.player2_id) AS acciones_p2,
       r.status
  FROM public.game_rooms r
 ORDER BY r.created_at DESC
 LIMIT 10;
