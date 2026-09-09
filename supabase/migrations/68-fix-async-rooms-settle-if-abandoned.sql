-- =============================================================================
-- MIGRACIÓN 68: CORRECCIÓN DE CIERRE Y MATCHMAKING EN SALAS ASÍNCRONAS
-- =============================================================================
-- PROBLEMA RESUELTO:
-- 1. En salas asíncronas contra Rival Semilla (is_async_match = TRUE), el
--    jugador 2 no es un humano conectado sino un bot grabado en DB. No tiene
--    latido ni presencia en tiempo real (p2_last_seen es NULL).
--
-- 2. Al cumplirse 120 s (gr_abandono_segundos) o al entrar a buscar rival en
--    enter_matchmaking(), se invocaba _settle_if_abandoned(p_room_id).
--    Dicha función detectaba erróneamente que "Player 2 se fue" y trataba de
--    liquidar la victoria a favor de Player 1 llamando a:
--      _settle_room(p_room_id, player1_id)
--
-- 3. Desde la migración 43 y 61, _settle_room rechaza estrictamente salas
--    asíncronas lanzando:
--      ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse
--      mediante settle_verified_async_ranked_match
--
--    Esto provocaba que enter_matchmaking() abortara con error a los 0:00 s,
--    bloqueando al usuario de volver a buscar partida.
--
-- SOLUCIÓN:
-- 1. Actualizar public._settle_if_abandoned(UUID) con manejo exclusivo para
--    salas asíncronas:
--    - Mide únicamente la actividad de Player 1 (v_p1).
--    - Si P1 sigue activo dentro del plazo: la partida sigue activa (RETURN FALSE).
--    - Si P1 estuvo inactivo por >= 120 s: se marca como abandonada directamente:
--      status = 'abandoned', settled_at = NOW(), verification_status = 'failed'.
--    - NUNCA invoca _settle_room en salas asíncronas.
--
-- 2. Blindar public.enter_matchmaking() con bloque de captura en el barrido
--    de salas huérfanas para que ningún fallo secundario impida al usuario jugar.
--
-- 3. Limpiar salas asíncronas huérfanas actualmente trabadas en status='playing'
--    con settled_at IS NULL y creadas hace más de 2 minutos.
--
-- 4. Registrar en public._migration_audit.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ACTUALIZAR _SETTLE_IF_ABANDONED CON SOPORTE ASÍNCRONO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_if_abandoned(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plazo      INTEGER;
  v_sala       RECORD;
  v_limite     TIMESTAMPTZ;
  v_p1         TIMESTAMPTZ;
  v_p2         TIMESTAMPTZ;
  v_presente   UUID;
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

  -- ── CASO 1: SALA ASÍNCRONA (RIVAL SEMILLA) ──────────────────────────────────
  -- En salas asíncronas player2 es un rival simulado sin cliente en tiempo real.
  -- Por regla de seguridad fail-closed, las salas asíncronas NUNCA se liquidan
  -- mediante _settle_room (lo cual lanzaría ASYNC_SETTLEMENT_REQUIRED).
  IF COALESCE(v_sala.is_async_match, FALSE) = TRUE THEN
    v_p1 := GREATEST(
              v_sala.created_at,
              COALESCE(v_sala.p1_last_seen, v_sala.created_at),
              COALESCE((SELECT MAX(a.created_at) FROM public.match_actions a
                         WHERE a.room_id = p_room_id AND a.user_id = v_sala.player1_id),
                       v_sala.created_at));

    -- Si P1 sigue activo dentro del plazo, la partida asíncrona continúa activa
    IF v_p1 >= v_limite THEN
      RETURN FALSE;
    END IF;

    -- P1 se ausentó por más de v_plazo: la sala se cierra directamente como abandonada
    UPDATE public.game_rooms
       SET status = 'abandoned',
           settled_at = NOW(),
           verification_status = 'failed',
           verification_note = 'abandoned_by_player'
     WHERE id = p_room_id;

    RETURN TRUE;
  END IF;

  -- ── CASO 2: SALA MULTIJUGADOR HUMANO VS HUMANO ──────────────────────────────
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

  -- Los dos siguen presentes dentro del plazo: la partida sigue
  IF v_p1 >= v_limite AND v_p2 >= v_limite THEN
    RETURN FALSE;
  END IF;

  -- Uno se fue: gana el que se queda (respetando si ya reportó derrota)
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

  -- No queda nadie: si uno dejó reporte consistente, liquidar
  IF v_sala.p1_reported_winner IS NOT NULL AND v_sala.p2_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p1_reported_winner);
    RETURN TRUE;
  ELSIF v_sala.p2_reported_winner IS NOT NULL AND v_sala.p1_reported_winner IS NULL THEN
    PERFORM public._settle_room(p_room_id, v_sala.p2_reported_winner);
    RETURN TRUE;
  END IF;

  -- Ninguno reportó: abandonada sin ganador y devolución en coliseo
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
-- 2. ACTUALIZAR ENTER_MATCHMAKING CON DEFENSA EN PROFUNDIDAD
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enter_matchmaking(
  p_mode           TEXT,
  p_bet            NUMERIC DEFAULT 0,
  p_use_ticket     BOOLEAN DEFAULT FALSE,
  p_room_code      TEXT    DEFAULT NULL,
  p_engine_version TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_elo     INTEGER;
  v_deck    JSONB;
  v_plazo   INTEGER;
  v_room    UUID;
  v_escrow  UUID;
  v_apuesta JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_mode NOT IN ('ranked', 'friendly', 'colosseum', 'tournament') THEN
    RAISE EXCEPTION 'Modo desconocido: %', p_mode;
  END IF;

  -- ── SERVER-SIDE GATE ESTRICTO: CERO FALLBACKS / CLIENTES VIEJOS RECHAZADOS ─
  IF p_engine_version IS NULL OR p_engine_version <> 'auth-v2' THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'searching', FALSE,
      'error', 'client_update_required',
      'message', 'Se requiere actualizar el juego a la versión actual para jugar partidas multijugador.'
    );
  END IF;

  IF p_mode = 'colosseum' AND (p_bet IS NULL OR p_bet <= 0) THEN
    RAISE EXCEPTION 'Elige la cantidad de la apuesta antes de entrar al Coliseo';
  END IF;

  IF p_mode <> 'colosseum' AND COALESCE(p_use_ticket, FALSE) THEN
    RAISE EXCEPTION 'Los tickets sólo valen para el Coliseo';
  END IF;

  IF p_mode NOT IN ('colosseum', 'friendly') AND COALESCE(p_bet, 0) > 0 THEN
    RAISE EXCEPTION 'En este modo no se apuesta';
  END IF;

  -- Quitar una búsqueda anterior propia que se hubiera quedado colgada.
  IF EXISTS (SELECT 1 FROM public.matchmaking_queue
              WHERE user_id = v_uid AND status = 'searching') THEN
    PERFORM public.cancel_matchmaking();
  END IF;

  -- ── ¿HAY UNA PARTIDA MÍA DE VERDAD EN CURSO? ──────────────────────────────
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

  -- Limpiar salas abandonadas del usuario con aislamiento de excepciones
  FOR v_room IN
    SELECT id FROM public.game_rooms
     WHERE (player1_id = v_uid OR player2_id = v_uid)
       AND settled_at IS NULL
       AND status = 'playing'
  LOOP
    BEGIN
      PERFORM public._settle_if_abandoned(v_room);
    EXCEPTION WHEN OTHERS THEN
      -- Si alguna sala tiene algún estado anómalo, no debe romper el matchmaking
      NULL;
    END;
  END LOOP;

  SELECT r.id INTO v_room
    FROM public.game_rooms r
   WHERE (r.player1_id = v_uid OR r.player2_id = v_uid)
     AND r.settled_at IS NULL
     AND r.status = 'playing'
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

  IF p_mode = 'colosseum' THEN
    v_apuesta := public.place_colosseum_wager(p_bet, p_use_ticket);
    v_escrow  := (v_apuesta->>'escrowId')::UUID;
  ELSIF p_mode = 'friendly' AND COALESCE(p_bet, 0) > 0 THEN
    v_escrow := public._apostar_en_amistoso(v_uid, p_bet);
  END IF;

  INSERT INTO public.matchmaking_queue (
    user_id,
    mode,
    colosseum_bet,
    user_elo,
    room_code,
    status,
    escrow_id,
    client_engine_version,
    last_seen_at
  ) VALUES (
    v_uid,
    p_mode,
    CASE WHEN p_mode IN ('colosseum', 'friendly') THEN COALESCE(p_bet, 0) ELSE NULL END,
    v_elo,
    p_room_code,
    'searching',
    v_escrow,
    'auth-v2',
    NOW()
  );

  RETURN jsonb_build_object('matched', FALSE, 'searching', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enter_matchmaking(TEXT, NUMERIC, BOOLEAN, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. LIMPIEZA INMEDIATA DE SALAS ASÍNCRONAS HUÉRFANAS / TRABADAS
-- -----------------------------------------------------------------------------
UPDATE public.game_rooms
   SET status = 'abandoned',
       settled_at = NOW(),
       verification_status = 'failed',
       verification_note = 'stale_async_cleanup'
 WHERE is_async_match = TRUE
   AND status = 'playing'
   AND settled_at IS NULL
   AND created_at < NOW() - INTERVAL '2 minutes';

-- -----------------------------------------------------------------------------
-- 4. AUDITORÍA DE MIGRACIÓN
-- -----------------------------------------------------------------------------
INSERT INTO public._migration_audit (fase, detalle)
VALUES (
  '68-fix-async-rooms-settle-if-abandoned',
  jsonb_build_object(
    'timestamp', NOW(),
    'issue', 'ASYNC_SETTLEMENT_REQUIRED on enter_matchmaking',
    'settle_if_abandoned_async_handled', TRUE,
    'enter_matchmaking_safe_sweep', TRUE
  )
);

COMMIT;
