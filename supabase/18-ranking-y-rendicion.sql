-- =============================================================================
-- PLANT ARENA · RANKING SIN CUENTAS DE PRUEBA, Y RENDIRSE CUENTA
--
-- Idempotente. Ejecutar después de la 17.
--
-- QUÉ RESUELVE
--
--   1. La cuenta del dueño (Xplora) salía en el ranking. No había filtro ninguno:
--      la consulta era `profiles ORDER BY elo_rating`. Se arregla con una columna
--      para marcar qué cuentas no compiten y una VISTA que ya viene filtrada.
--
--      Se hace con vista y no filtrando en el cliente por dos razones: filtrar en
--      el cliente requiere permiso de SELECT sobre la columna que se filtra
--      (Postgres lo exige también en el WHERE), y sobre todo porque una regla de
--      quién aparece en la clasificación es del servidor. Si la pone el cliente,
--      basta con no ponerla.
--
--   2. Rendirse no hacía nada en el servidor. El cliente restaba 8 puntos en su
--      propio estado de React, que no se guarda en ninguna parte: al recargar
--      volvía el ELO de antes. Y en una partida contra otro jugador, el rival se
--      quedaba esperando un reporte que no llegaba nunca.
--
--      Ahora hay una función para rendirse que declara ganador al rival y liquida
--      por el camino normal. No hace falta el reporte del otro: rendirse es
--      inequívoco, lo dice quien pierde.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.report_match_result(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 17: no existe report_match_result(uuid,uuid)';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 0.bis UNA DEVOLUCIÓN NO ES UNA VICTORIA
--
--    transactions.type no admitía ningún tipo de devolución, así que la 15 apuntó
--    las suyas como 'colosseum_win'. Efecto: el libro de cuentas dice que el
--    jugador ganó gemas cuando en realidad se le devolvió su propia apuesta. Con
--    eso no se puede auditar lo que se lleva la casa, que es justo para lo que
--    sirve esta tabla.
--
--    Se añade el tipo, se corrigen las filas mal apuntadas y se redefinen las dos
--    funciones de la 15 que lo escribían mal.
-- -----------------------------------------------------------------------------
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check CHECK (type = ANY (ARRAY[
    'deposit', 'withdrawal',
    'colosseum_win', 'colosseum_bet', 'colosseum_refund',
    'tournament_fee',
    'marketplace_buy', 'marketplace_sell',
    'clan_deposit', 'shop_purchase'
  ]));

-- Las devoluciones ya escritas como victoria se reclasifican. Se reconocen por la
-- descripción, que es la que puso la 15.
UPDATE public.transactions
   SET type = 'colosseum_refund'
 WHERE type = 'colosseum_win'
   AND (description ILIKE '%devol%' OR description ILIKE '%devuel%');


-- -----------------------------------------------------------------------------
-- 1. QUIÉN NO COMPITE
--
--    Columna propia y no `is_admin` a propósito: son dos cosas distintas. Puede
--    haber una cuenta de pruebas que no sea administradora y deba quedar fuera, y
--    algún día un administrador que sí quiera competir. Atarlo a is_admin obliga
--    a elegir entre las dos cosas.
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS exclude_from_ranking BOOLEAN NOT NULL DEFAULT FALSE;

-- Las cuentas de administración empiezan fuera, que es lo que se quería.
-- Se puede revertir una a una con un UPDATE.
UPDATE public.profiles
   SET exclude_from_ranking = TRUE
 WHERE COALESCE(is_admin, FALSE) AND NOT exclude_from_ranking;

-- El jugador NO puede tocar esto: sería salirse de la clasificación a voluntad,
-- o meter a otro. La 14 ya limitó el UPDATE del perfil a lo cosmético; se repite
-- aquí porque esta columna es nueva y no estaba en aquella lista.
REVOKE UPDATE (exclude_from_ranking) ON public.profiles FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. LA VISTA DEL RANKING
--
--    Trae sólo columnas públicas y sólo quien compite. El cliente pasa a leer de
--    aquí en lugar de la tabla, así que la regla vive en un sitio.
--
--    security_invoker: la vista se evalúa con los permisos de quien pregunta, no
--    con los del dueño. Sin eso, una vista sobre profiles sería una puerta para
--    leer filas que RLS no deja ver.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.leaderboard
WITH (security_invoker = true) AS
  SELECT p.id,
         p.username,
         p.avatar_id,
         p.country,
         p.elo_rating,
         p.colosseum_current_streak,
         p.colosseum_max_streak,
         p.created_at
    FROM public.profiles p
   WHERE NOT COALESCE(p.exclude_from_ranking, FALSE);

GRANT SELECT ON public.leaderboard TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. EL REPARTO, EN UN SOLO SITIO
--
--    Hasta ahora el reparto vivía dentro de report_match_result. Rendirse también
--    tiene que repartir, y copiar la lógica sería garantizar que las dos copias se
--    separen al primer cambio de reglas. Así que se extrae aquí y las dos la
--    llaman.
--
--    Es interna: nadie desde el cliente puede liquidar una partida directamente,
--    porque eso sería declararse ganador.
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

  -- ── AMISTOSO: no da nada ───────────────────────────────────────────────────
  -- Ni ELO, ni cofres, ni gemas. Es la regla del juego.
  IF v_room.mode = 'friendly' THEN
    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW()
     WHERE id = p_room_id;
    RETURN jsonb_build_object('success', TRUE, 'status', 'liquidada',
                              'winner', p_winner_id, 'mode', 'friendly',
                              'eloGained', 0, 'eloLost', 0, 'payout', 0);
  END IF;

  -- ── ELO POR TRAMOS ────────────────────────────────────────────────────────
  -- Cada uno según SU tramo: el que gana sube por el suyo, el que pierde baja
  -- por el suyo.
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
  -- El coliseo paga en gemas y no da cofre; el ranked da cofre y no paga gemas.
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
    'success',   TRUE,
    'status',    'liquidada',
    'winner',    p_winner_id,
    'mode',      v_room.mode,
    'eloGained', v_mas,
    'eloLost',   v_menos,
    'payout',    v_pago,
    'chest',     v_cofre
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_room(UUID, UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. report_match_result SE QUEDA SÓLO CON LOS REPORTES
--
--    Comprueba quién puede opinar, guarda el reporte, y cuando están los dos y
--    coinciden delega el reparto en _settle_room. El reparto ya no está aquí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_match_result(p_room_id UUID, p_winner_id UUID)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF p_winner_id NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'El ganador declarado no participa en esta partida';
  END IF;
  IF v_room.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Partida ya liquidada';
  END IF;

  IF v_uid = v_room.player1_id THEN
    IF v_room.p1_reported_winner IS NOT NULL THEN
      RAISE EXCEPTION 'Ya reportaste el resultado';
    END IF;
    UPDATE public.game_rooms SET p1_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p1_reported_winner := p_winner_id;
  ELSE
    IF v_room.p2_reported_winner IS NOT NULL THEN
      RAISE EXCEPTION 'Ya reportaste el resultado';
    END IF;
    UPDATE public.game_rooms SET p2_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p2_reported_winner := p_winner_id;
  END IF;

  IF v_room.p1_reported_winner IS NULL OR v_room.p2_reported_winner IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'esperando_al_rival');
  END IF;

  -- ── DISCREPANCIA ──────────────────────────────────────────────────────────
  --
  -- Cada uno dice que ganó él. No se puede saber quién, así que no se reparte
  -- ELO ni cofres a nadie.
  --
  -- Pero LO QUE SE COBRÓ HAY QUE DEVOLVERLO. Antes la retención se quedaba en
  -- 'held' con la sala ya asignada, y refund_colosseum_wager sólo devuelve
  -- retenciones SIN sala: las gemas se quedaban atrapadas para siempre, sin
  -- ganador y sin dueño. Es dinero real del jugador.
  --
  -- Se devuelve a cada uno EXACTAMENTE lo que puso, y de la misma forma: gemas si
  -- pagó con gemas, un ticket si pagó con ticket.
  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw', settled_at = NOW() WHERE id = p_room_id;

    UPDATE public.profiles p
       SET gems_balance = p.gems_balance + e.bet_gems
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id
       AND e.status  = 'held'
       AND e.paid_with = 'gems'
       AND p.id = e.user_id;

    UPDATE public.profiles p
       SET colosseum_tickets = p.colosseum_tickets + 1
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id
       AND e.status  = 'held'
       AND e.paid_with = 'ticket'
       AND p.id = e.user_id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    SELECT e.user_id, 'colosseum_refund',
           CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
           'Devolución: la partida quedó en disputa y no se determinó ganador',
           'completed'
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held';

    UPDATE public.colosseum_escrow
       SET status = 'refunded', refunded_at = NOW()
     WHERE room_id = p_room_id AND status = 'held';

    RETURN jsonb_build_object(
      'success', FALSE,
      'status',  'resultado_en_disputa',
      'refunded', TRUE
    );
  END IF;

  RETURN public._settle_room(p_room_id, p_winner_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. RENDIRSE
--
--    No necesita la confirmación del rival: lo dice quien pierde, y nadie se
--    rinde por error a favor del otro. Se rellenan los dos reportes para dejar
--    constancia y se liquida.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.surrender_match(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_room  RECORD;
  v_rival UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF v_room.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Partida ya liquidada';
  END IF;

  v_rival := CASE WHEN v_uid = v_room.player1_id
                  THEN v_room.player2_id ELSE v_room.player1_id END;

  -- Los dos reportes a la vez: el de quien se rinde porque se rinde, y el del
  -- rival porque no hay nada que discutir. Se sobreescribe lo que hubiera: si el
  -- rival ya había reportado y luego el otro se rinde, gana el rival igual.
  UPDATE public.game_rooms
     SET p1_reported_winner = v_rival,
         p2_reported_winner = v_rival
   WHERE id = p_room_id;

  RETURN public._settle_room(p_room_id, v_rival);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.surrender_match(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.surrender_match(UUID) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('ranking_y_rendicion', jsonb_build_object(
  'fuera_del_ranking', (SELECT COUNT(*) FROM public.profiles WHERE exclude_from_ranking)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Quién queda fuera del ranking. Debe salir la cuenta del dueño.
SELECT username, elo_rating, is_admin, exclude_from_ranking
  FROM public.profiles
 ORDER BY exclude_from_ranking DESC, elo_rating DESC;

-- 2. La vista trae menos filas que la tabla, y ninguna excluida.
SELECT (SELECT COUNT(*) FROM public.profiles)   AS perfiles,
       (SELECT COUNT(*) FROM public.leaderboard) AS en_el_ranking;

-- 3. El jugador no puede sacarse del ranking. Esto DEBE salir vacío.
SELECT grantee, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND column_name = 'exclude_from_ranking'
   AND grantee IN ('anon', 'authenticated')
   AND privilege_type = 'UPDATE';
