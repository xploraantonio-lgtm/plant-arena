-- =============================================================================
-- PLANT ARENA · DUELO AMISTOSO CON CÓDIGO Y APUESTA
--
-- Idempotente. Ejecutar después de la 30.
--
-- QUÉ SE ABRE
--   El amistoso ya funcionaba en el servidor —empareja, no da ELO, no da cofre y
--   no paga gemas— y las salas privadas por código también: el emparejamiento
--   sólo cruza a quien tenga EXACTAMENTE el mismo código, así que a tu sala no
--   entra nadie que no lo tenga. Lo que estaba cerrado era la tarjeta del menú.
--
--   Lo que falta y se añade aquí es la APUESTA: si los dos ponen la misma
--   cantidad, el ganador se lleva el 100 % de la del otro.
--
-- CÓMO SE PONEN DE ACUERDO, SIN NECESIDAD DE NEGOCIAR
--   No hace falta un ida y vuelta de «¿aceptas?». El emparejamiento ya exige que
--   la apuesta sea IDÉNTICA para cruzar a dos jugadores, así que sólo te emparejas
--   con alguien que puso lo mismo que tú. Quien crea la sala dice la cantidad y la
--   comparte con el código; quien entra pone esa misma cantidad o no entra.
--
--   Ése es el acuerdo: poner la misma cantidad. Y como se cobra ANTES de entrar a
--   la cola, no hay forma de apostar lo que no se tiene.
--
-- EL REPARTO, QUE ES DISTINTO DEL COLISEO
--   Coliseo: la casa se queda el 20 % del pozo.
--   Amistoso: el ganador se lleva el pozo ENTERO — su apuesta más la del rival.
--   Sobre 5 gemas cada uno: el ganador acaba con 10 y el otro con 0.
--
--   Sin comisión a propósito: es una apuesta entre dos amigos, no un modo de la
--   casa. El amistoso sigue sin dar ELO ni cofre; lo único que mueve son las
--   gemas apostadas.
--
-- SI LA PARTIDA NO ACABA
--   Lo apostado se devuelve, y eso ya funcionaba: las devoluciones por cancelar la
--   búsqueda, por abandono y por disputa miran las retenciones de la sala sin
--   distinguir el modo. Aquí sólo se comprueba que sigue siendo verdad.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public._settle_room(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 18: no existe _settle_room()';
  END IF;
  IF to_regprocedure('public._emparejar_lote(text,numeric,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 28: no existe _emparejar_lote()';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. AJUSTES
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Tope de la apuesta en amistoso. Es una barrera contra el dedo gordo: sin
  -- tope, un cero de más en el cuadro se lleva el saldo entero.
  ('amistoso_apuesta_maxima', 100)
ON CONFLICT (key) DO NOTHING;

-- Dos tipos de movimiento propios, para que en el historial no parezca coliseo.
DO $$
BEGIN
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit','withdrawal','colosseum_win','colosseum_bet',
                    'colosseum_refund','tournament_fee','marketplace_buy',
                    'marketplace_sell','clan_deposit','shop_purchase',
                    'referral_reward','p2p_share',
                    'friendly_bet','friendly_win'));
END $$;


-- -----------------------------------------------------------------------------
-- 2. COBRAR LA APUESTA DEL AMISTOSO
--
--    Función propia y no place_colosseum_wager, aunque el mecanismo sea parecido:
--    aquella cobra también con tickets de coliseo y apunta el movimiento como
--    coliseo. Un duelo entre amigos no gasta tickets y no debe salir en el
--    historial como si fuera del coliseo.
--
--    Se reutiliza la TABLA de retenciones (colosseum_escrow) porque es la que ya
--    saben devolver los tres caminos de devolución —cancelar, abandono y
--    disputa—. Duplicarla significaría duplicar esos tres.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apostar_en_amistoso(p_uid UUID, p_bet NUMERIC)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saldo  NUMERIC;
  v_tope   NUMERIC;
  v_escrow UUID;
BEGIN
  IF p_bet IS NULL OR p_bet <= 0 THEN RETURN NULL; END IF;

  SELECT COALESCE(value, 100) INTO v_tope
    FROM public.shop_config WHERE key = 'amistoso_apuesta_maxima';
  IF p_bet > COALESCE(v_tope, 100) THEN
    RAISE EXCEPTION 'La apuesta máxima en amistoso es de % gemas', COALESCE(v_tope, 100);
  END IF;

  -- Se bloquea el perfil antes de leer el saldo: sin esto, dos apuestas
  -- simultáneas podrían pasar las dos el control y dejar el saldo en negativo.
  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = p_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < p_bet THEN
    RAISE EXCEPTION 'Gemas insuficientes: la apuesta es de % y tienes %',
      p_bet, COALESCE(v_saldo, 0);
  END IF;

  UPDATE public.profiles SET gems_balance = gems_balance - p_bet WHERE id = p_uid;

  INSERT INTO public.colosseum_escrow (user_id, bet_gems, status, paid_with, expires_at)
  VALUES (p_uid, p_bet, 'held', 'gems', NOW() + INTERVAL '30 minutes')
  RETURNING id INTO v_escrow;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (p_uid, 'friendly_bet', p_bet, 'Apuesta de duelo amistoso', 'completed');

  RETURN v_escrow;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._apostar_en_amistoso(UUID, NUMERIC)
  FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 3. ENTRAR A UN AMISTOSO, CON O SIN APUESTA
--
--    Lo único que cambia respecto a la 28 es el cobro del amistoso. El resto es
--    igual, incluida la comprobación de que el código de sala coincide, que es lo
--    que hace privada una sala.
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

  IF p_mode = 'colosseum' AND (p_bet IS NULL OR p_bet <= 0) THEN
    RAISE EXCEPTION 'Elige la cantidad de la apuesta antes de entrar al Coliseo';
  END IF;

  -- Los tickets son del coliseo. En amistoso se apuesta con gemas o no se
  -- apuesta: si no, un ticket de coliseo se gastaría en un duelo entre amigos.
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
  --
  -- Esto viene de la 24 y hay que conservarlo. Antes bastaba con que la sala
  -- existiera y fuera de los últimos 15 minutos, y eso devolvía a cada jugador a
  -- SU sala vieja: los dos creían estar emparejados estando en salas distintas.
  --
  -- Se cierra la que esté abandonada y sólo se reanuda la que tenga señales de
  -- vida recientes, que es lo que "estoy jugando" significa.
  SELECT COALESCE(value::INTEGER, 120) INTO v_plazo
    FROM public.shop_config WHERE key = 'gr_abandono_segundos';
  v_plazo := COALESCE(v_plazo, 120);

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

  -- Se cobra ANTES de entrar en la cola. Así, si no aparece rival, hay una
  -- retención concreta que devolver.
  IF p_mode = 'colosseum' THEN
    v_apuesta := public.place_colosseum_wager(p_bet, p_use_ticket);
    v_escrow  := (v_apuesta->>'escrowId')::UUID;
  ELSIF p_mode = 'friendly' AND COALESCE(p_bet, 0) > 0 THEN
    v_escrow := public._apostar_en_amistoso(v_uid, p_bet);
  END IF;

  INSERT INTO public.matchmaking_queue
    (user_id, mode, colosseum_bet, user_elo, room_code, status, escrow_id, last_seen_at)
  VALUES
    (v_uid, p_mode,
     -- La apuesta se guarda también en amistoso: el emparejamiento exige que sea
     -- IDÉNTICA para cruzar a dos jugadores, y eso es lo que hace de acuerdo. Sin
     -- guardarla, se cruzaría a quien apostó 5 con quien no apostó nada.
     CASE WHEN p_mode IN ('colosseum', 'friendly') THEN COALESCE(p_bet, 0) ELSE NULL END,
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


-- -----------------------------------------------------------------------------
-- 4. EL GANADOR DEL AMISTOSO SE LLEVA EL POZO ENTERO
--
--    Y sigue sin haber ELO ni cofre: lo único que mueve un amistoso son las
--    gemas apostadas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_room(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room     RECORD;
  v_perdedor UUID;
  v_pozo     NUMERIC := 0;
  v_pago     NUMERIC := 0;
  v_elo_g    INTEGER;
  v_elo_p    INTEGER;
  v_mas      INTEGER := 0;
  v_menos    INTEGER := 0;
  v_cofre    JSONB := NULL;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Partida ya liquidada'; END IF;

  v_perdedor := CASE WHEN p_winner_id = v_room.player1_id
                     THEN v_room.player2_id ELSE v_room.player1_id END;

  -- ── AMISTOSO ──────────────────────────────────────────────────────────────
  -- Sin ELO y sin cofre, como siempre. Con apuesta, el ganador se lleva el pozo
  -- ENTERO: su apuesta más la del rival, sin comisión. Es una apuesta entre dos
  -- amigos, no un modo de la casa.
  IF v_room.mode = 'friendly' THEN
    SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo
      FROM public.colosseum_escrow
     WHERE room_id = p_room_id AND status = 'held';

    IF v_pozo > 0 THEN
      UPDATE public.profiles SET gems_balance = gems_balance + v_pozo
       WHERE id = p_winner_id;

      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      VALUES (p_winner_id, 'friendly_win', v_pozo,
              'Duelo amistoso ganado (el 100 % de lo apostado)', 'completed');

      UPDATE public.colosseum_escrow
         SET status = 'settled' WHERE room_id = p_room_id AND status = 'held';
    END IF;

    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW()
     WHERE id = p_room_id;

    RETURN jsonb_build_object('success', TRUE, 'status', 'liquidada',
                              'winner', p_winner_id, 'mode', 'friendly',
                              'eloGained', 0, 'eloLost', 0, 'payout', v_pozo);
  END IF;

  -- ── ELO POR TRAMOS ────────────────────────────────────────────────────────
  SELECT elo_rating INTO v_elo_g FROM public.profiles WHERE id = p_winner_id FOR UPDATE;
  SELECT elo_rating INTO v_elo_p FROM public.profiles WHERE id = v_perdedor   FOR UPDATE;

  v_mas   := (public._elo_deltas(v_elo_g)->>'win')::INTEGER;
  v_menos := (public._elo_deltas(v_elo_p)->>'lose')::INTEGER;

  -- ── COLISEO: 80% del pozo realmente retenido ──────────────────────────────
  IF v_room.mode = 'colosseum' THEN
    SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo
      FROM public.colosseum_escrow
     WHERE room_id = p_room_id AND status = 'held';

    v_pago := ROUND(v_pozo * 0.80, 2);   -- 20% se queda la casa

    UPDATE public.profiles
       SET colosseum_current_streak = colosseum_current_streak + 1,
           colosseum_max_streak     = GREATEST(colosseum_max_streak,
                                               colosseum_current_streak + 1),
           gems_balance             = gems_balance + v_pago
     WHERE id = p_winner_id;

    UPDATE public.profiles SET colosseum_current_streak = 0 WHERE id = v_perdedor;

    IF v_pago > 0 THEN
      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      VALUES (p_winner_id, 'colosseum_win', v_pago,
              'Victoria en Coliseo (80% del pozo)', 'completed');
    END IF;

    UPDATE public.colosseum_escrow
       SET status = 'settled' WHERE room_id = p_room_id AND status = 'held';
  END IF;

  -- ── RANKED: cofre de victoria ─────────────────────────────────────────────
  IF v_room.mode = 'ranked' THEN
    v_cofre := public._award_victory_chest_for(p_winner_id);
  END IF;

  UPDATE public.profiles SET elo_rating = elo_rating + v_mas WHERE id = p_winner_id;
  UPDATE public.profiles SET elo_rating = GREATEST(0, elo_rating - v_menos)
   WHERE id = v_perdedor;

  UPDATE public.game_rooms
     SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
         settled_at = NOW()
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'status', 'liquidada', 'winner', p_winner_id,
    'mode', v_room.mode, 'eloGained', v_mas, 'eloLost', v_menos,
    'payout', v_pago, 'chest', v_cofre
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_room(UUID, UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 5. CANCELAR DEVUELVE LA APUESTA DEL AMISTOSO
--
--    Lo cazó la prueba: cancel_matchmaking sólo devolvía si el modo era coliseo,
--    porque cuando se escribió el amistoso no apostaba nada. Con la apuesta
--    puesta, quien entraba y cancelaba se quedaba sin las gemas — retenidas para
--    siempre en una búsqueda cancelada.
--
--    Ahora se devuelve en los dos modos. refund_colosseum_wager sólo toca
--    retenciones SIN sala asignada, así que esto no puede sacar dinero de una
--    partida en juego: si ya había sala, el dinero está jugándose.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_matchmaking()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_fila     RECORD;
  v_devuelto JSONB := NULL;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_fila FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status = 'searching'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelled', FALSE, 'reason', 'no_estabas_buscando');
  END IF;

  -- Marcar cancelada y no borrar: deja rastro de cuánta gente abandona la cola.
  UPDATE public.matchmaking_queue SET status = 'cancelled' WHERE id = v_fila.id;

  -- Cualquier modo que apueste. Antes decía sólo 'colosseum'.
  IF v_fila.mode IN ('colosseum', 'friendly') THEN
    v_devuelto := public.refund_colosseum_wager();
  END IF;

  RETURN jsonb_build_object('cancelled', TRUE, 'refund', v_devuelto);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_matchmaking() TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('amistoso_con_apuesta', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. El tope de la apuesta.
SELECT key, value FROM public.shop_config WHERE key = 'amistoso_apuesta_maxima';

-- 2. Los dos tipos de movimiento nuevos están admitidos.
SELECT 'friendly_bet y friendly_win admitidos' AS que,
       pg_get_constraintdef(oid) LIKE '%friendly_win%' AS ok
  FROM pg_constraint
 WHERE conrelid = 'public.transactions'::regclass
   AND conname = 'transactions_type_check';

-- 3. Las apuestas de amistoso, con lo que pasó con ellas.
SELECT r.mode,
       COUNT(*)                                   AS retenciones,
       COUNT(*) FILTER (WHERE e.status = 'held')     AS en_juego,
       COUNT(*) FILTER (WHERE e.status = 'settled')  AS pagadas,
       COUNT(*) FILTER (WHERE e.status = 'refunded') AS devueltas
  FROM public.colosseum_escrow e
  LEFT JOIN public.game_rooms r ON r.id = e.room_id
 GROUP BY r.mode;
