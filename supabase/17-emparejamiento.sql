-- =============================================================================
-- PLANT ARENA · EMPAREJAMIENTO Y RESOLUCIÓN POR MODO
--
-- Idempotente. Ejecutar después de la 16.
--
-- QUÉ RESUELVE
--   1. Nadie creaba salas. game_rooms y matchmaking_queue existían desde el
--      esquema inicial y estaban vacías: no había forma de que dos jugadores
--      acabaran en la misma partida.
--   2. report_match_result daba +30/-20 de ELO y pagaba gemas en TODOS los
--      modos. Con las reglas del juego eso está mal en dos sitios: el amistoso
--      no da ELO ni nada, y el ranked da ELO por tramos (no 30 fijo) más un
--      cofre. Sólo encajaba con el coliseo, y ni ahí usaba la tabla de tramos.
--
-- LAS REGLAS, TAL CUAL
--   amistoso  · sin ELO, sin cofres, sin gemas. Sólo jugar.
--   ranked    · ELO por tramos + cofre de victoria. Es el único que usará
--               fantasmas cuando no haya nadie buscando.
--   coliseo   · ELO por tramos + 80% del pozo. Cuesta gemas o un ticket. NUNCA
--               hay bots: espera hasta 4 minutos y si no aparece rival, se
--               devuelve lo cobrado.
--
-- DE DÓNDE SALE EL MAZO
--   Del servidor, de plant_instances.is_in_deck. El cliente no manda mazo en
--   ningún momento. Si lo mandara, cualquiera entraría con seis legendarias que
--   no tiene, y no habría forma de saberlo.
--
-- DE DÓNDE SALE LA SEMILLA
--   La genera el servidor y es la MISMA para los dos jugadores. Es lo que hace
--   que ambos simulen exactamente la misma partida (engine/simulate.ts), y lo
--   que permitirá al servidor recalcularla en lugar de creerse el "he ganado"
--   del navegador.
--
-- LO QUE NO ENTRA AQUÍ, Y POR QUÉ
--   Los fantasmas del ranked. Un fantasma es la repetición de una partida real
--   anterior, así que necesita antes la tabla de repeticiones (match_actions).
--   Construirlo ahora significaría inventarse un bot distinto que luego habría
--   que tirar. El hueco está preparado: poll_matchmaking ya avisa cuándo tocaría
--   ofrecer uno.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. COMPROBACIÓN PREVIA
--
-- Esta migración se apoya en columnas y funciones que crean las anteriores. Si
-- falta alguna, sin esto el error sería «column X does not exist» treinta líneas
-- más abajo, sin decir qué hay que ejecutar. Aquí se comprueba antes y se dice
-- exactamente qué falta.
--
-- Se comprueban las COSAS, no las filas de _migration_audit: una migración
-- puede haberse ejecutado a medias.
-- -----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_faltan TEXT[] := '{}';
BEGIN
  -- Migración 01: blindaje
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='current_user_is_admin') THEN
    v_faltan := array_append(v_faltan, 'la 01 (falta current_user_is_admin)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='game_rooms'
                    AND column_name='p1_reported_winner') THEN
    v_faltan := array_append(v_faltan, 'la 01 (falta game_rooms.p1_reported_winner)');
  END IF;

  -- Migración 04: plant_instances con el modelo level + stat_rolls
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='plant_instances'
                    AND column_name='stat_rolls') THEN
    v_faltan := array_append(v_faltan, 'la 04 (falta plant_instances.stat_rolls)');
  END IF;

  -- Migración 05: tabla de ajustes
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='shop_config') THEN
    v_faltan := array_append(v_faltan, 'la 05 (falta la tabla shop_config)');
  END IF;

  -- Migración 07: el cofre de victoria marca cuándo se concedió
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='pack_slots'
                    AND column_name='awarded_at') THEN
    v_faltan := array_append(v_faltan, 'la 07 (falta pack_slots.awarded_at)');
  END IF;

  -- Migración 15: coliseo con devolución y ticket
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='refund_colosseum_wager') THEN
    v_faltan := array_append(v_faltan, 'la 15 (falta refund_colosseum_wager)');
  END IF;
  -- to_regprocedure y no pg_get_function_identity_arguments: esa función
  -- devuelve los NOMBRES de los parámetros además de los tipos
  -- ("p_bet numeric, p_use_ticket boolean"), así que comparar con
  -- "numeric, boolean" no coincide nunca y la comprobación daba un falso
  -- negativo. to_regprocedure resuelve por firma exacta de tipos.
  IF to_regprocedure('public.place_colosseum_wager(numeric,boolean)') IS NULL THEN
    v_faltan := array_append(v_faltan, 'la 15 (falta place_colosseum_wager(numeric, boolean))');
  END IF;

  IF array_length(v_faltan, 1) > 0 THEN
    RAISE EXCEPTION E'No se puede aplicar la 17 todavía. Ejecuta antes:\n  · %',
      array_to_string(v_faltan, E'\n  · ');
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. AJUSTES, EN TABLA PARA PODER TOCARLOS SIN SQL
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Banda de ELO inicial para buscar rival.
  ('mm_elo_band_start', 150),
  -- Cuánto se ensancha la banda por cada bloque de espera, y cada cuántos
  -- segundos. Sin esto, un jugador con ELO raro no encuentra rival nunca.
  ('mm_elo_band_step', 75),
  ('mm_elo_band_step_seconds', 15),
  -- Tope: más allá de esto se empareja con cualquiera antes que dejarlo solo.
  ('mm_elo_band_max', 1200),
  -- Si un jugador deja de dar señales de vida más de esto, se le saca de la cola
  -- (cerró la pestaña). En coliseo se le devuelve lo cobrado.
  ('mm_heartbeat_timeout_seconds', 45),
  -- Segundos de espera en RANKED tras los que se ofrecerá un fantasma.
  ('mm_ranked_ghost_after_seconds', 30)
ON CONFLICT (key) DO NOTHING;   -- DO NOTHING: si ya lo ajustaste, se respeta


-- -----------------------------------------------------------------------------
-- 2. EL ELO POR TRAMOS, EN TABLA
--
--    Son los mismos números de arenaManager.ts getEloDeltasForElo. Se traen a la
--    base porque el ELO lo tiene que aplicar el servidor: si lo calcula el
--    cliente, se lo inventa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.elo_rewards (
    max_elo  INTEGER PRIMARY KEY,          -- tramo: ELO <= max_elo
    win_elo  INTEGER NOT NULL CHECK (win_elo  >= 0),
    lose_elo INTEGER NOT NULL CHECK (lose_elo >= 0)
);

ALTER TABLE public.elo_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "elo_rewards_read" ON public.elo_rewards;
CREATE POLICY "elo_rewards_read" ON public.elo_rewards FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "elo_rewards_admin_write" ON public.elo_rewards;
CREATE POLICY "elo_rewards_admin_write" ON public.elo_rewards FOR ALL
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
GRANT INSERT, UPDATE, DELETE ON public.elo_rewards TO authenticated;

INSERT INTO public.elo_rewards (max_elo, win_elo, lose_elo) VALUES
  (  1600, 15, 8),
  (  2000, 12, 8),
  (  3000, 10, 8),
  (  4000,  8, 7),
  (999999,  6, 6)
ON CONFLICT (max_elo) DO UPDATE
  SET win_elo = EXCLUDED.win_elo, lose_elo = EXCLUDED.lose_elo;

/**
 * Los puntos que se ganan y se pierden según el ELO de quien juega.
 *
 * Devuelve JSONB y no RETURNS TABLE por una razón concreta: con RETURNS TABLE,
 * los nombres de salida (win_elo, lose_elo) coinciden con los de las columnas de
 * elo_rewards, y una referencia sin cualificar dentro del cuerpo se resuelve al
 * parámetro de salida en lugar de a la columna. Con JSONB no hay ambigüedad
 * posible.
 *
 * Devuelve SIEMPRE los dos valores. Importa: si devolviera cero filas, el
 * `SELECT ... INTO` de quien llama dejaría la variable en NULL y el
 * `elo_rating + NULL` borraría el ELO del jugador.
 */
CREATE OR REPLACE FUNCTION public._elo_deltas(p_elo INTEGER)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'win',  COALESCE((SELECT e.win_elo  FROM public.elo_rewards e
                       WHERE e.max_elo >= COALESCE(p_elo, 0)
                       ORDER BY e.max_elo LIMIT 1), 6),
    'lose', COALESCE((SELECT e.lose_elo FROM public.elo_rewards e
                       WHERE e.max_elo >= COALESCE(p_elo, 0)
                       ORDER BY e.max_elo LIMIT 1), 6)
  );
$$;

REVOKE EXECUTE ON FUNCTION public._elo_deltas(INTEGER) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 3. LA COLA: LATIDO Y ENLACE CON LA APUESTA RETENIDA
-- -----------------------------------------------------------------------------
ALTER TABLE public.matchmaking_queue
  -- Último signo de vida. poll_matchmaking lo refresca; el barrido usa esto para
  -- distinguir a quien espera de quien cerró la pestaña.
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Qué retención de coliseo corresponde a esta búsqueda, para poder devolverla
  -- al cancelar o al vencer el plazo.
  ADD COLUMN IF NOT EXISTS escrow_id    UUID REFERENCES public.colosseum_escrow(id);

-- Buscar rival es la consulta caliente: por modo, estado y ELO.
CREATE INDEX IF NOT EXISTS idx_mm_queue_busqueda
  ON public.matchmaking_queue (mode, status, user_elo)
  WHERE status = 'searching';

-- Antes de poner el índice único hay que dejar como mucho una búsqueda activa
-- por jugador, o la creación del índice falla. La tabla debería estar vacía
-- (nunca se escribió en ella), pero esto lo hace repetible en cualquier caso.
UPDATE public.matchmaking_queue q
   SET status = 'cancelled'
 WHERE q.status = 'searching'
   AND q.id <> (
     SELECT q2.id FROM public.matchmaking_queue q2
      WHERE q2.user_id = q.user_id AND q2.status = 'searching'
      ORDER BY q2.created_at DESC, q2.id DESC
      LIMIT 1
   );

-- Una sola búsqueda por jugador. Sin esto, pulsar "buscar" dos veces mete dos
-- filas y el jugador puede emparejarse consigo mismo a través de ellas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mm_queue_una_por_jugador
  ON public.matchmaking_queue (user_id)
  WHERE status = 'searching';

-- El cliente no escribe en la cola: todo pasa por las RPC de abajo.
REVOKE INSERT, UPDATE, DELETE ON public.matchmaking_queue FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. EL MAZO, DESDE EL SERVIDOR
-- -----------------------------------------------------------------------------
/**
 * El mazo activo de un jugador, tal como lo tiene la base.
 *
 * Sale de plant_instances.is_in_deck / deck_slot, que es lo que el cliente ya
 * lee para pintar el mazo.
 *
 * Devuelve `level` y `statRolls`, que es el modelo REAL de la tabla desde la
 * migración 04. Allí se borraron power_mult, hp_mult, speed_mult y cooldown_mult
 * porque las estadísticas se calculan de stat_rolls + PLANT_CONFIGS
 * (getScaledPlantConfig), y esos cuatro campos no podían representar el modelo.
 * schema.sql todavía los muestra: está desactualizado, no te fíes de él.
 *
 * statRolls es lo que el motor necesita: desde la última tanda de cambios vive
 * en PlantEntity.statRolls, fijado al plantar, en lugar de releerse de
 * localStorage en cada tic.
 */
CREATE OR REPLACE FUNCTION public._active_deck(p_uid UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- UNA carta por hueco, y como mucho 6.
  --
  -- No es paranoia: la prueba local encontró perfiles con DOS cartas marcadas en
  -- el hueco 0 a la vez, porque nada lo impedía. El trigger de registro reparte
  -- 4 cartas en los huecos 0..3, y cualquier otro camino que marque is_in_deck
  -- puede volver a marcar el mismo hueco. Un mazo de 8 cartas para 6 huecos
  -- llegaría deformado a la partida.
  --
  -- Se queda la más nueva de cada hueco (id más alto), que es lo que el jugador
  -- puso el último. Es determinista, que es lo que importa: los dos jugadores y
  -- el servidor tienen que ver el mismo mazo.
  WITH una_por_hueco AS (
    SELECT DISTINCT ON (COALESCE(pi.deck_slot, -1))
           pi.id, pi.plant_id, pi.deck_slot, pi.rarity,
           pi.level, pi.stat_rolls, pi.is_base
      FROM public.plant_instances pi
     WHERE pi.owner_id = p_uid
       AND pi.is_in_deck
       -- Una carta puesta en venta no puede estar jugando: se vendería a media
       -- partida y el comprador se quedaría con una carta en uso.
       AND NOT pi.is_listed_for_sale
     ORDER BY COALESCE(pi.deck_slot, -1), pi.id DESC
  ),
  seis AS (
    SELECT * FROM una_por_hueco
     ORDER BY deck_slot NULLS LAST, id
     LIMIT 6
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'instanceId', s.id,
        'plantId',    s.plant_id,
        'slot',       s.deck_slot,
        'rarity',     s.rarity,
        'level',      s.level,
        'statRolls',  s.stat_rolls,
        'isBase',     s.is_base
      )
      ORDER BY s.deck_slot NULLS LAST, s.id
    ),
    '[]'::JSONB
  )
  FROM seis s;
$$;

REVOKE EXECUTE ON FUNCTION public._active_deck(UUID) FROM anon, authenticated, PUBLIC;

-- Y además se impide de raíz: un hueco, una carta.
--
-- Se limpian los duplicados antes de crear el índice, o la creación falla. Se
-- conserva la carta más nueva de cada hueco, igual que hace _active_deck, para
-- que el mazo que ve el jugador no cambie al aplicar esto.
UPDATE public.plant_instances pi
   SET is_in_deck = FALSE, deck_slot = NULL
 WHERE pi.is_in_deck
   AND pi.deck_slot IS NOT NULL
   AND pi.id <> (
     SELECT p2.id FROM public.plant_instances p2
      WHERE p2.owner_id = pi.owner_id
        AND p2.deck_slot = pi.deck_slot
        AND p2.is_in_deck
      ORDER BY p2.id DESC
      LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_plant_instances_un_hueco_una_carta
  ON public.plant_instances (owner_id, deck_slot)
  WHERE is_in_deck AND deck_slot IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. EL COFRE DE VICTORIA, PARA UN JUGADOR CONCRETO
--
--    award_victory_chest() se lo daba a auth.uid(), o sea a quien llamaba. En la
--    resolución hay que dárselo al GANADOR, que puede no ser quien llama (el
--    perdedor también reporta). Se extrae la lógica y la función pública pasa a
--    ser una envoltura, para no tener dos copias que se desincronicen.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._award_victory_chest_for(p_uid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elo    INTEGER;
  v_arena  INTEGER;
  v_libre  INTEGER;
  v_dur    INTEGER;
  v_ultimo TIMESTAMPTZ;
BEGIN
  IF p_uid IS NULL THEN RETURN jsonb_build_object('awarded', FALSE, 'reason', 'sin_usuario'); END IF;

  -- Freno anti-repetición: un cofre cada 2 minutos como máximo.
  SELECT MAX(awarded_at) INTO v_ultimo FROM public.pack_slots WHERE user_id = p_uid;
  IF v_ultimo IS NOT NULL AND v_ultimo > NOW() - INTERVAL '2 minutes' THEN
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'demasiado_pronto');
  END IF;

  SELECT elo_rating INTO v_elo FROM public.profiles WHERE id = p_uid;

  -- Nivel de arena por ELO, mismos tramos que arenaManager.ts
  v_arena := CASE
    WHEN v_elo >= 3100 THEN 5
    WHEN v_elo >= 2050 THEN 4
    WHEN v_elo >= 1750 THEN 3
    WHEN v_elo >= 1600 THEN 2
    ELSE 1
  END;

  SELECT i INTO v_libre FROM generate_series(0,3) AS i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pack_slots ps
      WHERE ps.user_id = p_uid AND ps.slot_index = i AND ps.status <> 'empty'
   )
   ORDER BY i LIMIT 1;

  IF v_libre IS NULL THEN
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'huecos_llenos');
  END IF;

  v_dur := (ARRAY[2,4,8,12])[1 + floor(random() * 4)::INTEGER];

  INSERT INTO public.pack_slots
    (user_id, slot_index, status, duration_hours, arena_level, unlock_started_at, awarded_at)
  VALUES (p_uid, v_libre, 'locked', v_dur, v_arena, NULL, NOW())
  ON CONFLICT (user_id, slot_index) DO UPDATE
    SET status = 'locked', duration_hours = EXCLUDED.duration_hours,
        arena_level = EXCLUDED.arena_level, unlock_started_at = NULL,
        awarded_at = NOW();

  RETURN jsonb_build_object(
    'awarded', TRUE, 'slotId', v_libre,
    'durationHours', v_dur, 'arenaLevel', v_arena
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._award_victory_chest_for(UUID) FROM anon, authenticated, PUBLIC;

-- La pública queda como envoltura sobre la interna. Mismo comportamiento que
-- antes para el cliente, una sola copia de la lógica.
CREATE OR REPLACE FUNCTION public.award_victory_chest()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  RETURN public._award_victory_chest_for(v_uid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_victory_chest() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.award_victory_chest() TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. CREAR LA SALA
--
--    Interna: sólo la llaman las funciones de emparejamiento de abajo. La
--    semilla se genera AQUÍ, una sola vez, y los dos jugadores reciben la misma.
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
  v_room UUID;
  v_seed BIGINT;
BEGIN
  -- Semilla positiva que cabe en 32 bits, que es lo que consume el generador
  -- del motor (engine/rng.ts, mulberry32).
  v_seed := 1 + floor(random() * 2147483646)::BIGINT;

  INSERT INTO public.game_rooms
    (mode, player1_id, player2_id, seed, p1_deck, p2_deck, colosseum_bet, status)
  VALUES
    (p_mode, p_p1, p_p2, v_seed,
     public._active_deck(p_p1), public._active_deck(p_p2),
     COALESCE(p_bet, 0), 'playing')
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

REVOKE EXECUTE ON FUNCTION public._create_room(TEXT, UUID, UUID, NUMERIC) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 7. BUSCAR RIVAL
--
--    Interna. La usan tanto enter_matchmaking como poll_matchmaking: si los dos
--    jugadores pulsan "buscar" en el mismo instante, ninguno ve al otro todavía
--    y ambos se encolan; al primer sondeo se encuentran.
--
--    SKIP LOCKED es lo que evita el fallo clásico: dos emparejamientos
--    simultáneos creando dos salas con el mismo rival.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._try_match(p_uid UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_yo     RECORD;
  v_rival  RECORD;
  v_banda  INTEGER;
  v_inicio INTEGER;
  v_paso   INTEGER;
  v_cada   INTEGER;
  v_tope   INTEGER;
  v_room   UUID;
BEGIN
  SELECT * INTO v_yo FROM public.matchmaking_queue
   WHERE user_id = p_uid AND status = 'searching'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(MAX(CASE WHEN key = 'mm_elo_band_start'        THEN value::INTEGER END), 150),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_step'         THEN value::INTEGER END), 75),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_step_seconds' THEN value::INTEGER END), 15),
         COALESCE(MAX(CASE WHEN key = 'mm_elo_band_max'          THEN value::INTEGER END), 1200)
    INTO v_inicio, v_paso, v_cada, v_tope
    FROM public.shop_config;

  -- La banda se ensancha con la espera: primero rivales parejos, y si no
  -- aparecen, cualquiera antes que dejarlo esperando para siempre.
  v_banda := LEAST(
    v_tope,
    v_inicio + v_paso * (EXTRACT(EPOCH FROM (NOW() - v_yo.created_at))::INTEGER / GREATEST(1, v_cada))
  );

  SELECT * INTO v_rival FROM public.matchmaking_queue q
   WHERE q.status  = 'searching'
     AND q.mode    = v_yo.mode
     AND q.user_id <> p_uid
     AND ABS(q.user_elo - v_yo.user_elo) <= v_banda
     -- En coliseo la apuesta ha de ser la misma: no se cruza a quien apuesta 1
     -- gema con quien apuesta 100.
     AND (v_yo.mode <> 'colosseum'
          OR COALESCE(q.colosseum_bet, 0) = COALESCE(v_yo.colosseum_bet, 0))
     -- En torneo, el mismo torneo.
     AND (v_yo.mode <> 'tournament'
          OR q.tournament_id IS NOT DISTINCT FROM v_yo.tournament_id)
     -- Amistoso por código: sólo con quien tenga EXACTAMENTE el mismo código, y
     -- quien busca sin código sólo con quien tampoco lo tiene. Con un
     -- `v_yo.room_code IS NULL OR ...` se sacaría de su sala privada a quien
     -- estuviera esperando a un amigo.
     AND q.room_code IS NOT DISTINCT FROM v_yo.room_code
     -- Sin señales de vida recientes no se empareja: sería una partida contra
     -- una pestaña cerrada.
     AND q.last_seen_at > NOW() - INTERVAL '45 seconds'
   ORDER BY ABS(q.user_elo - v_yo.user_elo), q.created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Quien esperaba más tiempo es el jugador 1, para que la ventaja de mover
  -- primero (si la hubiera) no dependa de quién pulsó el botón.
  IF v_rival.created_at <= v_yo.created_at THEN
    v_room := public._create_room(v_yo.mode, v_rival.user_id, p_uid, v_yo.colosseum_bet);
  ELSE
    v_room := public._create_room(v_yo.mode, p_uid, v_rival.user_id, v_yo.colosseum_bet);
  END IF;

  UPDATE public.matchmaking_queue
     SET status = 'matched', matched_room_id = v_room
   WHERE id IN (v_yo.id, v_rival.id);

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._try_match(UUID) FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 8. ENTRAR A BUSCAR PARTIDA
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  IF p_mode NOT IN ('ranked', 'friendly', 'colosseum', 'tournament') THEN
    RAISE EXCEPTION 'Modo de juego no válido: %', p_mode;
  END IF;

  -- El coliseo necesita SIEMPRE un importe, incluso pagando con ticket: es la
  -- apuesta nominal con la que se forma el pozo y con la que se emparejan los
  -- rivales (no se cruza a quien juega por 1 gema con quien juega por 100).
  -- place_colosseum_wager la rechazaría igual, pero con un mensaje menos claro.
  IF p_mode = 'colosseum' AND (p_bet IS NULL OR p_bet <= 0) THEN
    RAISE EXCEPTION 'Elige la cantidad de la apuesta antes de entrar al Coliseo';
  END IF;

  -- Quitar una búsqueda anterior propia que se hubiera quedado colgada. Va
  -- PRIMERO, antes de comprobar si ya está jugando: si no, quien tuviera partida
  -- en curso y una búsqueda colgada seguiría apareciendo como rival disponible
  -- mientras juega, y alguien se emparejaría con una pestaña ocupada.
  --
  -- Cancelar aquí no puede devolver una apuesta que esté en juego:
  -- refund_colosseum_wager sólo toca retenciones SIN sala asignada.
  IF EXISTS (SELECT 1 FROM public.matchmaking_queue
              WHERE user_id = v_uid AND status = 'searching') THEN
    PERFORM public.cancel_matchmaking();
  END IF;

  -- ¿Ya está jugando? Una partida sin liquidar y reciente significa que sigue
  -- en ella. El margen de 15 minutos evita dejar a nadie encerrado si una
  -- partida se quedó a medias.
  SELECT id INTO v_room FROM public.game_rooms
   WHERE (player1_id = v_uid OR player2_id = v_uid)
     AND settled_at IS NULL
     AND status = 'playing'
     AND created_at > NOW() - INTERVAL '15 minutes'
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

  -- Intentar emparejar ya mismo: puede haber alguien esperando.
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
-- 9. SONDEAR
--
--    El cliente llama a esto cada pocos segundos. Hace tres cosas: refresca el
--    latido, intenta emparejar, y cuenta lo que falta para el plazo.
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
  v_cancel   JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_fila FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status IN ('searching', 'matched')
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('searching', FALSE, 'matched', FALSE);
  END IF;

  -- Ya nos emparejó el rival.
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
         COALESCE(MAX(CASE WHEN key = 'mm_ranked_ghost_after_seconds'   THEN value::INTEGER END), 30)
    INTO v_timeout, v_ghost
    FROM public.shop_config;

  -- El coliseo tiene plazo: pasado el tiempo se cancela y se devuelve lo
  -- cobrado. No hay bots en coliseo, así que esperar más no sirve de nada.
  IF v_fila.mode = 'colosseum' AND v_esperado >= v_timeout THEN
    -- Se informa de lo que la devolución dijo DE VERDAD, no un TRUE fijo: si por
    -- lo que fuera no había nada retenido, el jugador debe verlo y no quedarse
    -- creyendo que le devolvieron algo.
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
    -- Sólo informativo: en coliseo, cuánto queda antes de devolver.
    'timeoutSeconds', CASE WHEN v_fila.mode = 'colosseum' THEN v_timeout ELSE NULL END,
    -- El ranked es el único que admite fantasmas. Cuando existan las
    -- repeticiones, esta bandera es la que dirá cuándo ofrecer uno.
    'ghostAvailable', (v_fila.mode = 'ranked' AND v_esperado >= v_ghost)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.poll_matchmaking() TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. CANCELAR
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

  -- Marcar cancelada y no borrar: deja rastro de cuánta gente abandona la cola,
  -- que es el dato que dirá si el emparejamiento tarda demasiado.
  UPDATE public.matchmaking_queue SET status = 'cancelled' WHERE id = v_fila.id;

  -- Devolver la entrada del coliseo. refund_colosseum_wager sólo devuelve
  -- retenciones SIN sala, así que si ya había partida no toca nada: ahí el
  -- dinero está en juego.
  IF v_fila.mode = 'colosseum' THEN
    v_devuelto := public.refund_colosseum_wager();
  END IF;

  RETURN jsonb_build_object('cancelled', TRUE, 'refund', v_devuelto);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_matchmaking() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_matchmaking() TO authenticated;


-- -----------------------------------------------------------------------------
-- 11. BARRIDO DE LA COLA
--
--    Para pg_cron, junto a expire_stale_colosseum_escrows. Saca de la cola a
--    quien dejó de dar señales de vida y le devuelve lo cobrado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_matchmaking_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timeout INTEGER;
  v_sacados INTEGER := 0;
BEGIN
  SELECT COALESCE(value::INTEGER, 45) INTO v_timeout
    FROM public.shop_config WHERE key = 'mm_heartbeat_timeout_seconds';
  v_timeout := COALESCE(v_timeout, 45);

  WITH muertas AS (
    UPDATE public.matchmaking_queue
       SET status = 'cancelled'
     WHERE status = 'searching'
       AND last_seen_at < NOW() - make_interval(secs => v_timeout)
    RETURNING user_id, escrow_id
  )
  SELECT COUNT(*) INTO v_sacados FROM muertas;

  -- Las retenciones sin sala de quien salió de la cola las devuelve el barrido
  -- de coliseo, que ya sabe distinguir gemas de ticket.
  PERFORM public.expire_stale_colosseum_escrows();

  RETURN jsonb_build_object('removed', v_sacados);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_matchmaking_queue() FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 12. RESOLUCIÓN POR MODO
--
--     Sustituye a la versión de la 01, que daba +30/-20 y pagaba gemas en todos
--     los modos. Se mantiene lo esencial de aquella: hacen falta LOS DOS
--     reportes y han de coincidir, o no se paga a nadie.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_match_result(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_room     RECORD;
  v_pozo     NUMERIC := 0;
  v_pago     NUMERIC := 0;
  v_perdedor UUID;
  v_elo_g    INTEGER;
  v_elo_p    INTEGER;
  v_mas      INTEGER := 0;
  v_menos    INTEGER := 0;
  v_cofre    JSONB := NULL;
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

  -- Registrar el reporte de quien llama, sin sobreescribir el ya emitido.
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

  -- Discrepancia: se congela para revisión. No se paga a nadie. Cuando el
  -- servidor recalcule la partida desde el registro de acciones, este caso lo
  -- resolverá él en lugar de quedarse en disputa.
  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw' WHERE id = p_room_id;
    RETURN jsonb_build_object('success', FALSE, 'status', 'resultado_en_disputa');
  END IF;

  v_perdedor := CASE WHEN p_winner_id = v_room.player1_id
                     THEN v_room.player2_id ELSE v_room.player1_id END;

  -- ── AMISTOSO: no da nada ───────────────────────────────────────────────────
  -- Ni ELO, ni cofres, ni gemas. Es la regla del juego, y antes no se cumplía:
  -- un amistoso movía el ELO igual que una partida clasificatoria.
  IF v_room.mode = 'friendly' THEN
    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW()
     WHERE id = p_room_id;
    RETURN jsonb_build_object('success', TRUE, 'status', 'liquidada',
                              'winner', p_winner_id, 'mode', 'friendly',
                              'eloChange', 0, 'payout', 0);
  END IF;

  -- ── ELO POR TRAMOS, para ranked, coliseo y torneo ─────────────────────────
  -- El tramo se mira con el ELO de cada uno: el que gana sube según SU tramo y
  -- el que pierde baja según el suyo.
  SELECT elo_rating INTO v_elo_g FROM public.profiles WHERE id = p_winner_id FOR UPDATE;
  SELECT elo_rating INTO v_elo_p FROM public.profiles WHERE id = v_perdedor   FOR UPDATE;

  v_mas   := (public._elo_deltas(v_elo_g)->>'win')::INTEGER;
  v_menos := (public._elo_deltas(v_elo_p)->>'lose')::INTEGER;

  -- ── COLISEO: 80% del pozo realmente retenido ──────────────────────────────
  IF v_room.mode = 'colosseum' THEN
    -- Lo REALMENTE retenido, no lo que diga el cliente.
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
  -- El coliseo no da cofre: paga en gemas. El ranked no paga gemas: da cofre.
  IF v_room.mode = 'ranked' THEN
    v_cofre := public._award_victory_chest_for(p_winner_id);
  END IF;

  -- El ELO se aplica al final, cuando ya no puede fallar nada.
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

REVOKE EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('emparejamiento', jsonb_build_object(
  'tramos_elo', (SELECT COUNT(*) FROM public.elo_rewards),
  'ajustes',    (SELECT COUNT(*) FROM public.shop_config WHERE key LIKE 'mm_%')
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Los tramos de ELO, como en arenaManager.ts
SELECT max_elo AS hasta_elo, win_elo AS gana, lose_elo AS pierde
  FROM public.elo_rewards ORDER BY max_elo;

-- 2. Los ajustes del emparejamiento
SELECT key, value FROM public.shop_config
 WHERE key LIKE 'mm_%' OR key = 'colosseum_queue_timeout_seconds'
 ORDER BY key;

-- 3. Las funciones nuevas y quién puede ejecutarlas.
--    Las que empiezan por _ NO deben tener 'authenticated'.
SELECT p.proname AS funcion,
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
            THEN 'authenticated SÍ' ELSE 'sólo interna' END AS acceso
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('enter_matchmaking', 'poll_matchmaking', 'cancel_matchmaking',
                     'report_match_result', 'award_victory_chest',
                     '_try_match', '_create_room', '_active_deck',
                     '_elo_deltas', '_award_victory_chest_for',
                     'sweep_matchmaking_queue')
 ORDER BY p.proname;

-- 4. El cliente NO puede escribir en la cola. Debe salir vacío.
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'matchmaking_queue'
   AND grantee IN ('anon', 'authenticated')
   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

-- 5. Programar el barrido en pg_cron, si lo tienes activo:
-- SELECT cron.schedule('barrido-emparejamiento', '* * * * *',
--                      $$SELECT public.sweep_matchmaking_queue()$$);
