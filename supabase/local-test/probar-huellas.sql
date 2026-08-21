-- =============================================================================
-- PRUEBA DEL DETECTOR DE DIVERGENCIA (migración 32)
--
-- Un detector tiene dos formas de ser inútil, y las dos hay que descartarlas:
--
--   · que NO vea una divergencia de verdad → no sirve para nada;
--   · que vea divergencias donde no hay → nadie le hará caso, y cuando pase una
--     de verdad se ignorará como todas las anteriores.
--
-- Así que se prueban las dos: dos pantallas de acuerdo tienen que salir limpias, y
-- una diferencia de una sola planta tiene que salir con el tic exacto.
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


DO $$ BEGIN RAISE NOTICE E'\n=== 0. DOS JUGADORES Y UNA SALA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_b UUID := '77000000-0000-0000-0000-000000000002';
BEGIN
  DELETE FROM public.match_checkpoints
   WHERE room_id IN (SELECT id FROM public.game_rooms
                      WHERE player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b));
  DELETE FROM public.match_actions     WHERE user_id IN (v_a, v_b);
  DELETE FROM public.matchmaking_queue WHERE user_id IN (v_a, v_b);
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b);
  DELETE FROM public.referrals
   WHERE referred_id IN (v_a, v_b) OR referrer_id IN (v_a, v_b);
  DELETE FROM public.plant_instances   WHERE owner_id IN (v_a, v_b);
  DELETE FROM auth.users WHERE id IN (v_a, v_b);

  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_a, 'huella1@prueba.test', '{"full_name":"HuellaA"}'),
    (v_b, 'huella2@prueba.test', '{"full_name":"HuellaB"}');

  PERFORM public._t('los dos perfiles existen',
                    (SELECT COUNT(*) FROM public.profiles WHERE id IN (v_a, v_b)) = 2);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 1. DE ACUERDO: NINGUNA DIVERGENCIA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_b UUID := '77000000-0000-0000-0000-000000000002';
  v_sala UUID;
  v_r JSONB;
  i INTEGER;
BEGIN
  INSERT INTO public.game_rooms
    (player1_id, player2_id, mode, status, seed, p1_deck, p2_deck, started_at)
  VALUES (v_a, v_b, 'ranked', 'playing', 4242, '[]'::JSONB, '[]'::JSONB, NOW())
  RETURNING id INTO v_sala;

  -- Los dos mandan la MISMA huella en los mismos tics, que es lo que pasa cuando
  -- las dos pantallas van a la par.
  FOR i IN 1..6 LOOP
    PERFORM public._soy(v_a);
    PERFORM public.submit_match_checkpoint(v_sala, i * 300, 't' || i * 300 || '|b600/600|1[]|2[]');
    PERFORM public._soy(v_b);
    PERFORM public.submit_match_checkpoint(v_sala, i * 300, 't' || i * 300 || '|b600/600|1[]|2[]');
  END LOOP;

  PERFORM public._soy(v_a);
  v_r := public.match_divergence(v_sala);

  PERFORM public._t('se compararon los seis tics',
                    (v_r->>'comparados')::INTEGER = 6, v_r::TEXT);
  PERFORM public._t('y no hay divergencia',
                    (v_r->>'divergio')::BOOLEAN IS FALSE, v_r::TEXT);
  PERFORM public._t('mandar la misma huella dos veces no duplica',
                    (SELECT COUNT(*) FROM public.match_checkpoints
                      WHERE room_id = v_sala) = 12);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 2. SI SE SEPARAN, DICE EN QUÉ TIC ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_b UUID := '77000000-0000-0000-0000-000000000002';
  v_sala UUID;
  v_r JSONB;
  i INTEGER;
BEGIN
  INSERT INTO public.game_rooms
    (player1_id, player2_id, mode, status, seed, p1_deck, p2_deck, started_at)
  VALUES (v_a, v_b, 'ranked', 'playing', 99, '[]'::JSONB, '[]'::JSONB, NOW())
  RETURNING id INTO v_sala;

  -- Coinciden hasta el tic 900 y a partir de ahí no. Es lo que se ve cuando algo
  -- pasa en una pantalla y no en la otra: coinciden un rato y luego nunca más.
  FOR i IN 1..6 LOOP
    PERFORM public._soy(v_a);
    PERFORM public.submit_match_checkpoint(v_sala, i * 300, 'igual-' || i * 300);
    PERFORM public._soy(v_b);
    PERFORM public.submit_match_checkpoint(
      v_sala, i * 300,
      CASE WHEN i * 300 >= 1200 THEN 'distinto-' || i * 300 ELSE 'igual-' || i * 300 END
    );
  END LOOP;

  PERFORM public._soy(v_a);
  v_r := public.match_divergence(v_sala);

  PERFORM public._t('detecta la divergencia',
                    (v_r->>'divergio')::BOOLEAN IS TRUE, v_r::TEXT);
  PERFORM public._t('y dice el PRIMER tic en que se separaron, no cualquiera',
                    (v_r->>'primerTic')::INTEGER = 1200, v_r::TEXT);
  PERFORM public._t('trae las dos huellas de ese tic, para ver qué cambió',
                    v_r->>'huellaP1' = 'igual-1200'
                AND v_r->>'huellaP2' = 'distinto-1200', v_r::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 3. SI FALTA UN LADO, NO ES DIVERGENCIA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_b UUID := '77000000-0000-0000-0000-000000000002';
  v_sala UUID;
  v_r JSONB;
BEGIN
  INSERT INTO public.game_rooms
    (player1_id, player2_id, mode, status, seed, p1_deck, p2_deck, started_at)
  VALUES (v_a, v_b, 'ranked', 'playing', 7, '[]'::JSONB, '[]'::JSONB, NOW())
  RETURNING id INTO v_sala;

  -- Sólo uno manda huellas: al otro se le cayó la conexión. Eso NO es que las
  -- pantallas discrepen — es que falta el dato, y confundirlo sería el camino más
  -- rápido a que nadie se fíe del detector.
  PERFORM public._soy(v_a);
  PERFORM public.submit_match_checkpoint(v_sala, 300, 'sola-300');
  PERFORM public.submit_match_checkpoint(v_sala, 600, 'sola-600');

  v_r := public.match_divergence(v_sala);
  PERFORM public._t('sin pareja que comparar, no se inventa una divergencia',
                    (v_r->>'divergio')::BOOLEAN IS FALSE
                AND (v_r->>'comparados')::INTEGER = 0, v_r::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 4. LAS HUELLAS SON PRIVADAS ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_c UUID := '77000000-0000-0000-0000-000000000003';
  v_sala UUID;
  v_falló BOOLEAN := FALSE;
BEGIN
  DELETE FROM public.plant_instances WHERE owner_id = v_c;
  DELETE FROM auth.users WHERE id = v_c;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_c, 'huella3@prueba.test', '{"full_name":"HuellaC"}');

  SELECT id INTO v_sala FROM public.game_rooms
   WHERE player1_id = v_a ORDER BY created_at DESC LIMIT 1;

  -- Una huella dice dónde tiene cada uno sus plantas: un tercero no la ve.
  PERFORM public._soy(v_c);
  BEGIN
    PERFORM public.match_divergence(v_sala);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE;
  END;
  PERFORM public._t('un tercero no puede leer las huellas de una partida ajena', v_falló);

  -- Ni mandar una en nombre de otro.
  v_falló := FALSE;
  BEGIN
    PERFORM public.submit_match_checkpoint(v_sala, 900, 'inventada');
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE;
  END;
  PERFORM public._t('ni meter huellas en una partida en la que no juega', v_falló);

  -- Y la tabla no se lee directamente.
  PERFORM public._t('la tabla de huellas no está abierta al cliente',
    (SELECT COUNT(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'match_checkpoints'
        AND grantee IN ('anon', 'authenticated')) = 0);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 5. EL RESUMEN DEL PANEL ==='; END $$;

DO $$
DECLARE
  v_a UUID := '77000000-0000-0000-0000-000000000001';
  v_falló BOOLEAN := FALSE;
  v_r JSONB;
BEGIN
  -- Sólo admin: enseña los nicks y el estado de todas las partidas.
  PERFORM public._soy(v_a);
  BEGIN
    PERFORM public.admin_divergencias(10);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE;
  END;
  PERFORM public._t('el resumen es sólo para administradores', v_falló);

  -- Con un administrador sí, y cuenta bien.
  UPDATE public.profiles SET is_admin = TRUE WHERE id = v_a;
  v_r := public.admin_divergencias(20);
  PERFORM public._t('cuenta las partidas con datos y las divergentes',
                    (v_r->'resumen'->>'conDatos')::INTEGER >= 2
                AND (v_r->'resumen'->>'divergentes')::INTEGER >= 1,
                    (v_r->'resumen')::TEXT);
  UPDATE public.profiles SET is_admin = FALSE WHERE id = v_a;
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== FIN ==='; END $$;
