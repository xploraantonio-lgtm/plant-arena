-- =============================================================================
-- PRUEBA DEL DUELO AMISTOSO CON CÓDIGO Y APUESTA (migración 31)
--
-- Aquí se mueven gemas de verdad, así que lo que se prueba es lo que se puede
-- perder sin culpa:
--
--   · que a una sala con código NO entre quien no lo tiene;
--   · que no se cruce a quien apostó 5 con quien no apostó nada — poner la misma
--     cantidad ES el acuerdo, y sin esa comprobación no hay acuerdo ninguno;
--   · que el ganador se lleve el 100 % y el perdedor se quede a cero;
--   · que el amistoso siga sin dar ELO ni cofre, aunque ahora pague gemas;
--   · y que si la partida no acaba, lo apostado vuelva.
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


DO $$ BEGIN RAISE NOTICE E'\n=== 0. TRES AMIGOS CON GEMAS ==='; END $$;

DO $$
DECLARE
  v_ids UUID[] := ARRAY[
    '99000000-0000-0000-0000-000000000001'::UUID,
    '99000000-0000-0000-0000-000000000002'::UUID,
    '99000000-0000-0000-0000-000000000003'::UUID
  ];
  i INTEGER;
BEGIN
  DELETE FROM public.match_actions     WHERE user_id = ANY(v_ids);
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.colosseum_escrow  WHERE user_id = ANY(v_ids);
  DELETE FROM public.game_rooms
   WHERE player1_id = ANY(v_ids) OR player2_id = ANY(v_ids);
  DELETE FROM public.transactions      WHERE user_id = ANY(v_ids);
  DELETE FROM public.referrals
   WHERE referred_id = ANY(v_ids) OR referrer_id = ANY(v_ids);
  DELETE FROM public.plant_instances   WHERE owner_id = ANY(v_ids);
  DELETE FROM auth.users WHERE id = ANY(v_ids);

  FOR i IN 1..3 LOOP
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_ids[i], 'amigo' || i || '@prueba.test',
            ('{"full_name":"Amigo' || i || '"}')::JSONB);
  END LOOP;

  UPDATE public.profiles SET gems_balance = 20, elo_rating = 1500
   WHERE id = ANY(v_ids);

  PERFORM public._t('los tres tienen 20 gemas',
                    (SELECT COUNT(*) FROM public.profiles
                      WHERE id = ANY(v_ids) AND gems_balance = 20) = 3);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 1. A UNA SALA CON CÓDIGO SÓLO ENTRA QUIEN LO TIENE ==='; END $$;

DO $$
DECLARE
  v_a UUID := '99000000-0000-0000-0000-000000000001';
  v_b UUID := '99000000-0000-0000-0000-000000000002';
  v_c UUID := '99000000-0000-0000-0000-000000000003';
  v_r JSONB;
BEGIN
  -- Ana abre una sala privada con su código.
  PERFORM public._soy(v_a);
  PERFORM public.enter_matchmaking('friendly', 0, FALSE, 'PATATA1');

  -- Ceci busca un amistoso normal, SIN código. No debe caer en la sala de Ana.
  PERFORM public._soy(v_c);
  PERFORM public.enter_matchmaking('friendly');

  UPDATE public.matchmaking_queue
     SET created_at = NOW() - INTERVAL '10 seconds' WHERE status = 'searching';

  PERFORM public._soy(v_c);
  v_r := public.poll_matchmaking();
  PERFORM public._t('quien no tiene el código no entra en la sala privada',
                    (v_r->>'matched')::BOOLEAN IS FALSE, v_r::TEXT);

  -- Y con otro código distinto, tampoco.
  PERFORM public._soy(v_b);
  PERFORM public.enter_matchmaking('friendly', 0, FALSE, 'OTRO999');
  UPDATE public.matchmaking_queue
     SET created_at = NOW() - INTERVAL '10 seconds' WHERE status = 'searching';
  v_r := public.poll_matchmaking();
  PERFORM public._t('con un código distinto tampoco',
                    (v_r->>'matched')::BOOLEAN IS FALSE, v_r::TEXT);

  -- Con el código bueno, sí.
  PERFORM public.cancel_matchmaking();
  PERFORM public._soy(v_b);
  PERFORM public.enter_matchmaking('friendly', 0, FALSE, 'PATATA1');
  UPDATE public.matchmaking_queue
     SET created_at = NOW() - INTERVAL '10 seconds' WHERE status = 'searching';
  v_r := public.poll_matchmaking();
  PERFORM public._t('con el código bueno, entra y empieza la partida',
                    (v_r->>'matched')::BOOLEAN IS TRUE, v_r::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 2. LA MISMA CANTIDAD O NO HAY PARTIDA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '99000000-0000-0000-0000-000000000001';
  v_b UUID := '99000000-0000-0000-0000-000000000002';
  v_r JSONB;
  v_saldo NUMERIC;
BEGIN
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b);
  DELETE FROM public.colosseum_escrow WHERE user_id IN (v_a, v_b);
  UPDATE public.profiles SET gems_balance = 20 WHERE id IN (v_a, v_b);

  -- Ana apuesta 5. Beto no apuesta nada. No se pueden cruzar: poner la misma
  -- cantidad es EL acuerdo, y sin esta comprobación no habría acuerdo.
  PERFORM public._soy(v_a);
  PERFORM public.enter_matchmaking('friendly', 5, FALSE, 'APUESTA');
  PERFORM public._soy(v_b);
  PERFORM public.enter_matchmaking('friendly', 0, FALSE, 'APUESTA');

  UPDATE public.matchmaking_queue
     SET created_at = NOW() - INTERVAL '10 seconds' WHERE status = 'searching';
  v_r := public.poll_matchmaking();
  PERFORM public._t('no se cruza a quien apuesta 5 con quien no apuesta',
                    (v_r->>'matched')::BOOLEAN IS FALSE, v_r::TEXT);

  -- Y la apuesta de Ana se cobró al entrar, no al emparejar.
  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_a;
  PERFORM public._t('la apuesta se cobra al entrar a la cola',
                    v_saldo = 15, 'saldo: ' || v_saldo);
  PERFORM public._t('y queda retenida, no perdida',
                    (SELECT COUNT(*) FROM public.colosseum_escrow
                      WHERE user_id = v_a AND status = 'held') = 1);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 3. EL GANADOR SE LLEVA EL 100 POR CIENTO ==='; END $$;

DO $$
DECLARE
  v_a UUID := '99000000-0000-0000-0000-000000000001';
  v_b UUID := '99000000-0000-0000-0000-000000000002';
  v_sala UUID;
  v_r JSONB;
  v_elo_a INTEGER; v_elo_a2 INTEGER;
  v_cofres INTEGER; v_cofres2 INTEGER;
BEGIN
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.colosseum_escrow WHERE user_id IN (v_a, v_b);
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b);
  UPDATE public.profiles SET gems_balance = 20 WHERE id IN (v_a, v_b);

  -- Los dos apuestan 5.
  PERFORM public._soy(v_a);
  PERFORM public.enter_matchmaking('friendly', 5, FALSE, 'DUELO');
  PERFORM public._soy(v_b);
  PERFORM public.enter_matchmaking('friendly', 5, FALSE, 'DUELO');

  UPDATE public.matchmaking_queue
     SET created_at = NOW() - CASE WHEN user_id = v_a
                                   THEN INTERVAL '11 seconds'
                                   ELSE INTERVAL '10 seconds' END
   WHERE status = 'searching';
  v_sala := (public.poll_matchmaking()->>'roomId')::UUID;
  PERFORM public._t('con la misma cantidad, se emparejan', v_sala IS NOT NULL);

  PERFORM public._t('a los dos les quedan 15',
                    (SELECT COUNT(*) FROM public.profiles
                      WHERE id IN (v_a, v_b) AND gems_balance = 15) = 2);

  SELECT elo_rating INTO v_elo_a FROM public.profiles WHERE id = v_a;
  SELECT COUNT(*) INTO v_cofres FROM public.pack_slots
   WHERE user_id = v_a AND status <> 'empty';

  -- Gana Ana. Los dos reportan lo mismo.
  UPDATE public.game_rooms SET started_at = NOW() WHERE id = v_sala;
  PERFORM public._soy(v_a); PERFORM public.report_match_result(v_sala, v_a);
  PERFORM public._soy(v_b); v_r := public.report_match_result(v_sala, v_a);

  PERFORM public._t('el ganador cobra el pozo entero: 10 gemas',
                    (v_r->>'payout')::NUMERIC = 10, v_r::TEXT);
  PERFORM public._t('y acaba con 25 (tenía 20, apostó 5, cobra 10)',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_a) = 25,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_a));
  PERFORM public._t('el perdedor se queda con 15: perdió lo que apostó',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_b) = 15,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_b));

  -- Y sigue siendo un amistoso: ni ELO ni cofre.
  SELECT elo_rating INTO v_elo_a2 FROM public.profiles WHERE id = v_a;
  SELECT COUNT(*) INTO v_cofres2 FROM public.pack_slots
   WHERE user_id = v_a AND status <> 'empty';
  PERFORM public._t('el amistoso sigue sin mover el ELO', v_elo_a = v_elo_a2,
                    v_elo_a || ' → ' || v_elo_a2);
  PERFORM public._t('y sin dar cofre', v_cofres = v_cofres2);

  PERFORM public._t('la apuesta queda liquidada, no retenida',
                    (SELECT COUNT(*) FROM public.colosseum_escrow
                      WHERE room_id = v_sala AND status = 'settled') = 2);
  PERFORM public._t('y en el historial sale como amistoso, no como coliseo',
                    EXISTS (SELECT 1 FROM public.transactions
                             WHERE user_id = v_a AND type = 'friendly_win'
                               AND amount_gems = 10));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 4. SI LA PARTIDA NO ACABA, LA APUESTA VUELVE ==='; END $$;

DO $$
DECLARE
  v_a UUID := '99000000-0000-0000-0000-000000000001';
  v_b UUID := '99000000-0000-0000-0000-000000000002';
  v_r JSONB;
BEGIN
  -- a) Cancelar la búsqueda devuelve.
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.colosseum_escrow WHERE user_id IN (v_a, v_b);
  UPDATE public.profiles SET gems_balance = 20 WHERE id IN (v_a, v_b);

  PERFORM public._soy(v_a);
  PERFORM public.enter_matchmaking('friendly', 8, FALSE, 'SOLO');
  PERFORM public._t('se cobró la apuesta',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_a) = 12);

  PERFORM public.cancel_matchmaking();
  PERFORM public._t('al cancelar la búsqueda se devuelve',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_a) = 20,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_a));

  -- b) Abandono de los dos: se devuelve a los dos.
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.colosseum_escrow WHERE user_id IN (v_a, v_b);
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b);
  UPDATE public.profiles SET gems_balance = 20 WHERE id IN (v_a, v_b);

  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('friendly', 3, FALSE, 'IRSE');
  PERFORM public._soy(v_b); PERFORM public.enter_matchmaking('friendly', 3, FALSE, 'IRSE');
  UPDATE public.matchmaking_queue
     SET created_at = NOW() - INTERVAL '10 seconds' WHERE status = 'searching';
  PERFORM public.poll_matchmaking();

  -- Se van los dos y vence el plazo.
  UPDATE public.game_rooms SET created_at = NOW() - INTERVAL '5 minutes'
   WHERE status = 'playing'
     AND (player1_id IN (v_a, v_b) OR player2_id IN (v_a, v_b));
  PERFORM public.settle_abandoned_rooms();

  PERFORM public._t('abandonada por los dos: se devuelve a los dos',
                    (SELECT COUNT(*) FROM public.profiles
                      WHERE id IN (v_a, v_b) AND gems_balance = 20) = 2,
                    (SELECT string_agg(gems_balance::TEXT, ', ') FROM public.profiles
                      WHERE id IN (v_a, v_b)));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 5. LO QUE NO SE PUEDE APOSTAR ==='; END $$;

DO $$
DECLARE
  v_a UUID := '99000000-0000-0000-0000-000000000001';
  v_falló BOOLEAN;
BEGIN
  DELETE FROM public.matchmaking_queue;
  DELETE FROM public.colosseum_escrow WHERE user_id = v_a;
  UPDATE public.profiles SET gems_balance = 20 WHERE id = v_a;
  PERFORM public._soy(v_a);

  -- Más de lo que tiene.
  v_falló := FALSE;
  BEGIN PERFORM public.enter_matchmaking('friendly', 50);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE; END;
  PERFORM public._t('no se puede apostar más de lo que se tiene', v_falló);

  -- Por encima del tope, aunque tenga saldo.
  UPDATE public.profiles SET gems_balance = 5000 WHERE id = v_a;
  v_falló := FALSE;
  BEGIN PERFORM public.enter_matchmaking('friendly', 500);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE; END;
  PERFORM public._t('hay un tope para el dedo gordo', v_falló);

  -- Con ticket de coliseo, no: es la moneda del coliseo.
  v_falló := FALSE;
  BEGIN PERFORM public.enter_matchmaking('friendly', 5, TRUE);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE; END;
  PERFORM public._t('los tickets no valen para el amistoso', v_falló);

  -- Y en ranked no se apuesta.
  v_falló := FALSE;
  BEGIN PERFORM public.enter_matchmaking('ranked', 5);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE; END;
  PERFORM public._t('en clasificatoria no se apuesta', v_falló);

  UPDATE public.profiles SET gems_balance = 20 WHERE id = v_a;
  PERFORM public.cancel_matchmaking();
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== FIN ==='; END $$;
