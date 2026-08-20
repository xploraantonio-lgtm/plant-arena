-- =============================================================================
-- PRUEBA DEL EMPAREJAMIENTO POR LOTES Y DEL ARRANQUE A LA VEZ (migración 28)
--
-- Dos cosas que se ven mal en cuanto se juega y no se ven nunca leyendo el SQL:
--
--   1. Que pulsar "buscar" ya NO empareja al instante. Antes, dos personas
--      pulsando a la vez se emparejaban entre ellas siempre; ahora esperan el
--      lote y entran en el mismo sorteo que el resto.
--
--   2. Que la sala nace con la hora de inicio EN EL FUTURO. Esto es lo que hace
--      que los dos empiecen a la vez: antes el tic 0 era el momento en que
--      entraba el más rápido en cargar, y el otro tenía que recuperar tics —el
--      "uno va dos segundos por delante".
--
-- Los plazos no se esperan: se envejece la cola. El servidor mide contra NOW(),
-- así que mover created_at hacia atrás equivale a dejar pasar el tiempo.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

CREATE OR REPLACE FUNCTION public._t(p_nombre TEXT, p_ok BOOLEAN, p_detalle TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE '  OK   %', p_nombre;
  ELSE RAISE WARNING '  FALLA %  → %', p_nombre, p_detalle;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._soy(p_uid UUID)
RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('test.uid', p_uid::TEXT, false)::VOID $$;

/** Deja a todos los de la cola como si llevaran esperando lo que se le diga. */
CREATE OR REPLACE FUNCTION public._envejecer_cola(p_segundos INTEGER)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE public.matchmaking_queue
     SET created_at = NOW() - make_interval(secs => p_segundos)
   WHERE status = 'searching'
$$;

REVOKE EXECUTE ON FUNCTION public._envejecer_cola(INTEGER) FROM anon, authenticated, PUBLIC;


DO $$ BEGIN RAISE NOTICE E'\n=== 0. CUATRO JUGADORES DE PRUEBA ==='; END $$;

DO $$
DECLARE
  v_ids UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000001'::UUID,
    'e0000000-0000-0000-0000-000000000002'::UUID,
    'e0000000-0000-0000-0000-000000000003'::UUID,
    'e0000000-0000-0000-0000-000000000004'::UUID
  ];
  v_elos INTEGER[] := ARRAY[1000, 1050, 2000, 2050];
  i INTEGER;
BEGIN
  DELETE FROM public.match_actions     WHERE user_id = ANY(v_ids);
  -- La cola ENTERA, no sólo la de estos cuatro: el lote empareja a cualquiera que
  -- esté buscando, así que una fila olvidada por otra prueba les robaría pareja y
  -- acabarían en salas distintas. (Pasó, y el fallo parecía del código.)
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.game_rooms
   WHERE player1_id = ANY(v_ids) OR player2_id = ANY(v_ids);
  DELETE FROM public.referrals
   WHERE referred_id = ANY(v_ids) OR referrer_id = ANY(v_ids);
  DELETE FROM public.plant_instances   WHERE owner_id = ANY(v_ids);
  DELETE FROM public.transactions      WHERE user_id = ANY(v_ids);
  DELETE FROM auth.users WHERE id = ANY(v_ids);

  FOR i IN 1..4 LOOP
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_ids[i], 'lote' || i || '@prueba.test',
            ('{"full_name":"Lote' || i || '"}')::JSONB);
    UPDATE public.profiles SET elo_rating = v_elos[i] WHERE id = v_ids[i];
  END LOOP;

  PERFORM public._t('los cuatro perfiles existen',
                    (SELECT COUNT(*) FROM public.profiles WHERE id = ANY(v_ids)) = 4);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 1. PULSAR BUSCAR YA NO EMPAREJA AL INSTANTE ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_ra JSONB; v_rb JSONB;
BEGIN
  PERFORM public._soy(v_a);
  v_ra := public.enter_matchmaking('ranked');
  PERFORM public._soy(v_b);
  v_rb := public.enter_matchmaking('ranked');

  -- ESTE es el cambio. Antes el segundo en entrar salía emparejado en la misma
  -- llamada, así que dos personas pulsando a la vez jugaban siempre entre ellas.
  PERFORM public._t('el primero entra a la cola sin partida',
                    (v_ra->>'matched')::BOOLEAN IS FALSE, v_ra::TEXT);
  PERFORM public._t('y el segundo TAMPOCO se empareja al instante',
                    (v_rb->>'matched')::BOOLEAN IS FALSE, v_rb::TEXT);

  -- Y el sondeo dice cuánto falta para el sorteo, para que la pantalla no
  -- parezca colgada.
  PERFORM public._soy(v_a);
  v_ra := public.poll_matchmaking();
  PERFORM public._t('el sondeo dice cuánto falta para el sorteo',
                    (v_ra->>'sorteoEnSegundos')::INTEGER > 0, v_ra::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 2. CUMPLIDA LA ESPERA, EL LOTE EMPAREJA ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_ra JSONB; v_rb JSONB;
  v_sala UUID;
  v_room RECORD;
BEGIN
  PERFORM public._envejecer_cola(5);

  PERFORM public._soy(v_a);
  v_ra := public.poll_matchmaking();
  PERFORM public._t('ahora sí hay partida', (v_ra->>'matched')::BOOLEAN IS TRUE, v_ra::TEXT);

  -- Y el otro se entera en SU sondeo, con la misma sala.
  PERFORM public._soy(v_b);
  v_rb := public.poll_matchmaking();
  PERFORM public._t('los dos en la MISMA sala',
                    v_rb->>'roomId' = v_ra->>'roomId',
                    v_ra->>'roomId' || ' vs ' || COALESCE(v_rb->>'roomId', 'null'));

  v_sala := (v_ra->>'roomId')::UUID;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = v_sala;

  -- LA PIEZA QUE HACE QUE EMPIECEN A LA VEZ.
  PERFORM public._t('la sala nace con hora de inicio, y en el futuro',
                    v_room.started_at IS NOT NULL AND v_room.started_at > NOW(),
                    'started_at: ' || COALESCE(v_room.started_at::TEXT, 'null'));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 3. LOS DOS RECIBEN EL MISMO TIC 0 ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_sala UUID;
  v_ca JSONB; v_cb JSONB;
BEGIN
  SELECT matched_room_id INTO v_sala FROM public.matchmaking_queue
   WHERE user_id = v_a AND status = 'matched' ORDER BY created_at DESC LIMIT 1;

  -- El primero pide el reloj. Antes, ESTA llamada era la que fijaba el tic 0: el
  -- que cargaba más rápido decidía cuándo empezaba la partida y el otro llegaba
  -- tarde. Ahora sólo lee lo que ya estaba puesto.
  PERFORM public._soy(v_a);
  v_ca := public.start_match_clock(v_sala);
  PERFORM public._soy(v_b);
  v_cb := public.start_match_clock(v_sala);

  PERFORM public._t('los dos reciben exactamente el mismo instante de arranque',
                    v_ca->>'startedAt' = v_cb->>'startedAt',
                    (v_ca->>'startedAt') || ' vs ' || (v_cb->>'startedAt'));

  PERFORM public._t('y todavía no ha empezado: hay cuenta atrás',
                    (v_ca->>'empiezaEnSegundos')::INTEGER > 0
                AND (v_ca->>'currentTick')::INTEGER < 0,
                    v_ca::TEXT);

  PERFORM public._t('nadie tiene que recuperar tics perdidos',
                    (v_cb->>'currentTick')::INTEGER <= 0, v_cb::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 4. EL LOTE EMPAREJA POR ELO, NO POR ORDEN DE CLIC ==='; END $$;

DO $$
DECLARE
  v_ids UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000001'::UUID,   -- ELO 1000
    'e0000000-0000-0000-0000-000000000002'::UUID,   -- ELO 1050
    'e0000000-0000-0000-0000-000000000003'::UUID,   -- ELO 2000
    'e0000000-0000-0000-0000-000000000004'::UUID    -- ELO 2050
  ];
  i INTEGER;
  v_r JSONB;
  v_p1 INTEGER; v_p2 INTEGER;
  v_cruzada BOOLEAN;
BEGIN
  DELETE FROM public.matchmaking_queue WHERE user_id = ANY(v_ids);
  DELETE FROM public.game_rooms
   WHERE player1_id = ANY(v_ids) OR player2_id = ANY(v_ids);

  -- Entran en el orden PEOR posible para el ELO: 1000, 2000, 1050, 2050. Si
  -- emparejara por orden de llegada saldrían 1000-2000 y 1050-2050.
  FOREACH i IN ARRAY ARRAY[1, 3, 2, 4] LOOP
    PERFORM public._soy(v_ids[i]);
    PERFORM public.enter_matchmaking('friendly');
  END LOOP;

  PERFORM public._envejecer_cola(5);
  PERFORM public._soy(v_ids[1]);
  v_r := public.poll_matchmaking();

  PERFORM public._t('se crearon las dos partidas',
                    (SELECT COUNT(*) FROM public.game_rooms
                      WHERE player1_id = ANY(v_ids) AND player2_id = ANY(v_ids)) = 2,
                    (SELECT COUNT(*)::TEXT FROM public.game_rooms
                      WHERE player1_id = ANY(v_ids)));

  -- Ninguna partida debe cruzar los dos grupos de ELO.
  SELECT EXISTS (
    SELECT 1 FROM public.game_rooms r
      JOIN public.profiles p1 ON p1.id = r.player1_id
      JOIN public.profiles p2 ON p2.id = r.player2_id
     WHERE r.player1_id = ANY(v_ids) AND r.player2_id = ANY(v_ids)
       AND ABS(p1.elo_rating - p2.elo_rating) > 500
  ) INTO v_cruzada;

  PERFORM public._t('los de 1000 juntos y los de 2000 juntos, no cruzados',
                    NOT v_cruzada);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 5. IMPAR: UNO SE QUEDA PARA EL SIGUIENTE LOTE ==='; END $$;

DO $$
DECLARE
  v_ids UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000001'::UUID,
    'e0000000-0000-0000-0000-000000000002'::UUID,
    'e0000000-0000-0000-0000-000000000003'::UUID
  ];
  i INTEGER;
  v_r JSONB;
BEGIN
  DELETE FROM public.matchmaking_queue WHERE user_id = ANY(v_ids);
  DELETE FROM public.game_rooms
   WHERE player1_id = ANY(v_ids) OR player2_id = ANY(v_ids);
  -- Los tres al mismo ELO: cualquier pareja vale y el tercero sobra.
  UPDATE public.profiles SET elo_rating = 1500 WHERE id = ANY(v_ids);

  FOR i IN 1..3 LOOP
    PERFORM public._soy(v_ids[i]);
    PERFORM public.enter_matchmaking('friendly');
  END LOOP;

  PERFORM public._envejecer_cola(5);
  PERFORM public._soy(v_ids[1]);
  v_r := public.poll_matchmaking();

  PERFORM public._t('una sola partida con tres buscando',
                    (SELECT COUNT(*) FROM public.game_rooms
                      WHERE player1_id = ANY(v_ids) AND player2_id = ANY(v_ids)) = 1);
  PERFORM public._t('y el tercero sigue buscando, no se queda colgado',
                    (SELECT COUNT(*) FROM public.matchmaking_queue
                      WHERE user_id = ANY(v_ids) AND status = 'searching') = 1);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 6. NO REPETIR RIVAL SI HAY OTRO DISPONIBLE ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_c UUID := 'e0000000-0000-0000-0000-000000000003';
  v_d UUID := 'e0000000-0000-0000-0000-000000000004';
  v_r JSONB;
  v_rival_de_a UUID;
BEGIN
  DELETE FROM public.matchmaking_queue WHERE user_id IN (v_a, v_b, v_c, v_d);
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b, v_c, v_d) OR player2_id IN (v_a, v_b, v_c, v_d);
  UPDATE public.profiles SET elo_rating = 1500 WHERE id IN (v_a, v_b, v_c, v_d);

  -- A y B acaban de jugar. Es lo que dos cuentas harían para jugar entre ellas:
  -- buscar a la vez, una y otra vez.
  INSERT INTO public.game_rooms
    (mode, player1_id, player2_id, seed, p1_deck, p2_deck, status, created_at, settled_at)
  VALUES ('ranked', v_a, v_b, 1, '[]'::JSONB, '[]'::JSONB, 'p1_won',
          NOW() - INTERVAL '1 minute', NOW() - INTERVAL '30 seconds');

  -- Ahora buscan los cuatro. A debería tocar con C o con D, no con B otra vez.
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_b); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_c); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_d); PERFORM public.enter_matchmaking('friendly');

  PERFORM public._envejecer_cola(5);
  PERFORM public._soy(v_a);
  v_r := public.poll_matchmaking();

  SELECT CASE WHEN player1_id = v_a THEN player2_id ELSE player1_id END
    INTO v_rival_de_a
    FROM public.game_rooms
   WHERE mode = 'friendly' AND (player1_id = v_a OR player2_id = v_a)
   ORDER BY created_at DESC LIMIT 1;

  PERFORM public._t('con otros disponibles, no le repite el rival de antes',
                    v_rival_de_a IS NOT NULL AND v_rival_de_a <> v_b,
                    'le tocó: ' || COALESCE(v_rival_de_a::TEXT, 'nadie'));
END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_r JSONB;
  v_rival UUID;
BEGIN
  -- Pero si NO hay nadie más, se acepta la revancha: mejor eso que dejarlos sin
  -- partida. Es el límite honesto de esto — con dos jugadores en la cola, el
  -- lote no puede hacer magia.
  DELETE FROM public.matchmaking_queue WHERE user_id IN (v_a, v_b);
  DELETE FROM public.game_rooms WHERE mode = 'friendly'
     AND (player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b));

  INSERT INTO public.game_rooms
    (mode, player1_id, player2_id, seed, p1_deck, p2_deck, status, created_at, settled_at)
  VALUES ('ranked', v_a, v_b, 1, '[]'::JSONB, '[]'::JSONB, 'p1_won',
          NOW() - INTERVAL '1 minute', NOW() - INTERVAL '30 seconds');

  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_b); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._envejecer_cola(5);
  PERFORM public._soy(v_a);
  v_r := public.poll_matchmaking();

  SELECT CASE WHEN player1_id = v_a THEN player2_id ELSE player1_id END INTO v_rival
    FROM public.game_rooms WHERE mode = 'friendly'
     AND (player1_id = v_a OR player2_id = v_a)
   ORDER BY created_at DESC LIMIT 1;

  PERFORM public._t('sin nadie más, se acepta la revancha antes que dejarlos sin jugar',
                    v_rival = v_b, COALESCE(v_rival::TEXT, 'nadie'));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 7. SONDEAR MÁS VECES NO ADELANTA EL SORTEO ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'e0000000-0000-0000-0000-000000000001';
  v_b UUID := 'e0000000-0000-0000-0000-000000000002';
  v_r JSONB;
  i INTEGER;
BEGIN
  DELETE FROM public.matchmaking_queue WHERE user_id IN (v_a, v_b);
  DELETE FROM public.game_rooms WHERE mode = 'friendly'
     AND (player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b));

  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_b); PERFORM public.enter_matchmaking('friendly');

  -- Sin envejecer la cola: los dos acaban de entrar.
  PERFORM public._soy(v_a);
  FOR i IN 1..30 LOOP
    v_r := public.poll_matchmaking();
  END LOOP;

  PERFORM public._t('treinta sondeos no emparejan antes de la espera',
                    (v_r->>'matched')::BOOLEAN IS FALSE, v_r::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== FIN ==='; END $$;

DROP FUNCTION IF EXISTS public._envejecer_cola(INTEGER);
