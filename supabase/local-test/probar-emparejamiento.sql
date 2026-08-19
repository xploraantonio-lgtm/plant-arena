-- =============================================================================
-- PRUEBA DEL EMPAREJAMIENTO CON DOS JUGADORES
--
-- Se ejecuta sobre la base que deja probar-migraciones.sh. Simula a dos personas
-- buscando partida y comprueba lo que de verdad importa:
--
--   · que el registro crea el perfil (el trigger de la 02);
--   · que dos jugadores acaban en la MISMA sala con la MISMA semilla;
--   · que el mazo lo pone el servidor y no el cliente;
--   · que el amistoso NO da ELO, el ranked da ELO + cofre y el coliseo paga;
--   · que hacen falta los DOS reportes y que si no coinciden no se paga a nadie;
--   · que el coliseo devuelve lo cobrado si no aparece rival.
--
-- Cada bloque imprime OK o ✗ con lo esperado y lo obtenido. No usa un marco de
-- pruebas a propósito: así se puede pegar en el editor SQL de Supabase para
-- comprobar lo mismo contra producción.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

-- Ayuda para afirmar. Imprime en lugar de lanzar, para que la prueba siga y se
-- vean todos los fallos de una vez y no sólo el primero.
CREATE OR REPLACE FUNCTION public._t(p_nombre TEXT, p_ok BOOLEAN, p_detalle TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN
    RAISE NOTICE '  OK   %', p_nombre;
  ELSE
    RAISE WARNING '  FALLA %  → %', p_nombre, p_detalle;
  END IF;
END $$;

-- Ponerse en la piel de un jugador.
CREATE OR REPLACE FUNCTION public._soy(p_uid UUID)
RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('test.uid', p_uid::TEXT, false)::VOID $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 1. EL REGISTRO CREA EL PERFIL (trigger de la 02) ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_n INTEGER;
  v_gemas NUMERIC;
BEGIN
  DELETE FROM auth.users WHERE id IN (v_a, v_b);

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_a, 'ana@ejemplo.com',  '{"full_name":"Ana"}'),
         (v_b, 'beto@ejemplo.com', '{"full_name":"Beto"}');

  SELECT COUNT(*) INTO v_n FROM public.profiles WHERE id IN (v_a, v_b);
  PERFORM public._t('el trigger creó los dos perfiles', v_n = 2, 'perfiles creados: ' || v_n);

  SELECT gems_balance INTO v_gemas FROM public.profiles WHERE id = v_a;
  PERFORM public._t('nace con 0 gemas, no con gemas regaladas',
                    v_gemas = 0, 'gemas al nacer: ' || COALESCE(v_gemas::TEXT,'NULL'));
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 2. EL REGISTRO YA DEJA UN MAZO USABLE ==='; END $$;

-- El trigger de la 02 reparte 4 cartas en los huecos 0..3, así que quien se acaba
-- de registrar ya puede buscar partida. La primera versión de esta prueba daba
-- por hecho que nacía sin mazo, insertaba 4 cartas más y salían 8: el fallo era
-- de la prueba, no del código. Pero de ahí salió un hallazgo de verdad — dos
-- cartas podían acabar en el mismo hueco, y nada lo impedía.
DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_n INTEGER;
  v_mazo JSONB;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.plant_instances
   WHERE owner_id = v_a AND is_in_deck;
  PERFORM public._t('el registro deja 4 cartas en el mazo', v_n = 4, 'cartas: ' || v_n);

  v_mazo := public._active_deck(v_a);
  PERFORM public._t('_active_deck devuelve esas 4',
                    jsonb_array_length(v_mazo) = 4,
                    'devolvió ' || jsonb_array_length(v_mazo));

  -- Un hueco, una carta: si se marcan dos en el mismo, _active_deck se queda con
  -- una sola. El índice único de la 17 además lo impide de raíz.
  BEGIN
    INSERT INTO public.plant_instances
      (owner_id, plant_id, rarity, star_level, level, stat_rolls, is_base, is_in_deck, deck_slot)
    VALUES (v_a, 'melonpult', 'epic', 1, 0, '{}', FALSE, TRUE, 0);
    PERFORM public._t('el índice único impide dos cartas en el mismo hueco',
                      FALSE, 'dejó insertar la segunda');
  EXCEPTION WHEN unique_violation THEN
    PERFORM public._t('el índice único impide dos cartas en el mismo hueco', TRUE);
  END;

  -- Un jugador sin NINGUNA carta sí debe ser rechazado.
  PERFORM public._soy(v_a);
  UPDATE public.plant_instances SET is_in_deck = FALSE WHERE owner_id = v_a;
  BEGIN
    PERFORM public.enter_matchmaking('ranked');
    PERFORM public._t('rechaza a quien no tiene cartas en el mazo', FALSE, 'no lanzó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('rechaza a quien no tiene cartas en el mazo',
                      SQLERRM LIKE '%mazo%', 'mensaje: ' || SQLERRM);
  END;
  UPDATE public.plant_instances SET is_in_deck = TRUE
   WHERE owner_id = v_a AND deck_slot IS NOT NULL;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 3. DOS JUGADORES ACABAN EN LA MISMA SALA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_r1 JSONB; v_r2 JSONB;
  v_sala UUID; v_semilla BIGINT; v_p1 UUID; v_p2 UUID;
  v_mazo1 JSONB; v_mazo2 JSONB;
BEGIN
  -- Los dos ya tienen mazo del registro. Se cambia una carta de Beto para que los
  -- mazos no sean idénticos y se vea que cada uno guarda el suyo.
  UPDATE public.plant_instances SET plant_id = 'repeater'
   WHERE owner_id = v_b AND deck_slot = 3;

  -- Ana busca: no hay nadie.
  PERFORM public._soy(v_a);
  v_r1 := public.enter_matchmaking('ranked');
  PERFORM public._t('la primera en buscar se queda esperando',
                    (v_r1->>'matched')::BOOLEAN IS FALSE, v_r1::TEXT);

  -- Beto busca: la encuentra.
  PERFORM public._soy(v_b);
  v_r2 := public.enter_matchmaking('ranked');
  PERFORM public._t('el segundo empareja al momento',
                    (v_r2->>'matched')::BOOLEAN IS TRUE, v_r2::TEXT);

  v_sala := (v_r2->>'roomId')::UUID;
  SELECT seed, player1_id, player2_id, p1_deck, p2_deck
    INTO v_semilla, v_p1, v_p2, v_mazo1, v_mazo2
    FROM public.game_rooms WHERE id = v_sala;

  PERFORM public._t('la sala tiene semilla positiva',
                    v_semilla > 0, 'semilla: ' || COALESCE(v_semilla::TEXT,'NULL'));
  PERFORM public._t('los dos jugadores son los correctos',
                    (v_p1 = v_a AND v_p2 = v_b) OR (v_p1 = v_b AND v_p2 = v_a),
                    'p1=' || v_p1 || ' p2=' || v_p2);
  PERFORM public._t('quien esperaba más es el jugador 1',
                    v_p1 = v_a, 'p1 debería ser Ana: ' || v_p1);

  -- Lo importante: el mazo lo puso el SERVIDOR.
  PERFORM public._t('el servidor guardó los dos mazos, 4 cartas cada uno',
                    jsonb_array_length(v_mazo1) = 4 AND jsonb_array_length(v_mazo2) = 4,
                    'mazo1=' || jsonb_array_length(v_mazo1) || ' mazo2=' || jsonb_array_length(v_mazo2));
  PERFORM public._t('el mazo trae statRolls, que es lo que usa el motor',
                    v_mazo1->0 ? 'statRolls', (v_mazo1->0)::TEXT);

  -- Y Ana ve la misma sala al sondear.
  PERFORM public._soy(v_a);
  PERFORM public._t('la que esperaba ve la misma sala al sondear',
                    (public.poll_matchmaking()->>'roomId')::UUID = v_sala,
                    public.poll_matchmaking()::TEXT);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 4. HACEN FALTA LOS DOS REPORTES ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_res JSONB;
  v_elo_antes INTEGER; v_elo_despues INTEGER;
BEGIN
  SELECT id INTO v_sala FROM public.game_rooms ORDER BY created_at DESC LIMIT 1;
  SELECT elo_rating INTO v_elo_antes FROM public.profiles WHERE id = v_a;

  -- Sólo Ana reporta.
  PERFORM public._soy(v_a);
  v_res := public.report_match_result(v_sala, v_a);
  PERFORM public._t('con un solo reporte no se liquida',
                    v_res->>'status' = 'esperando_al_rival', v_res::TEXT);

  SELECT elo_rating INTO v_elo_despues FROM public.profiles WHERE id = v_a;
  PERFORM public._t('con un solo reporte el ELO no se mueve',
                    v_elo_antes = v_elo_despues,
                    'antes ' || v_elo_antes || ' después ' || v_elo_despues);

  -- Ana no puede reportar dos veces.
  BEGIN
    PERFORM public.report_match_result(v_sala, v_a);
    PERFORM public._t('no se puede reportar dos veces', FALSE, 'no lanzó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('no se puede reportar dos veces', SQLERRM LIKE '%Ya reportaste%', SQLERRM);
  END;

  -- Beto coincide: se liquida. Es ranked, así que ELO por tramos + cofre.
  PERFORM public._soy(v_b);
  v_res := public.report_match_result(v_sala, v_a);
  PERFORM public._t('con los dos reportes de acuerdo, se liquida',
                    v_res->>'status' = 'liquidada', v_res::TEXT);
  PERFORM public._t('ranked da +15 de ELO en el primer tramo',
                    (v_res->>'eloGained')::INTEGER = 15, 'ganó: ' || (v_res->>'eloGained'));
  PERFORM public._t('ranked da cofre al ganador',
                    (v_res->'chest'->>'awarded')::BOOLEAN IS TRUE, (v_res->'chest')::TEXT);
  PERFORM public._t('ranked NO paga gemas',
                    (v_res->>'payout')::NUMERIC = 0, 'pagó: ' || (v_res->>'payout'));

  SELECT elo_rating INTO v_elo_despues FROM public.profiles WHERE id = v_a;
  PERFORM public._t('el ELO de la ganadora subió 15',
                    v_elo_despues = v_elo_antes + 15,
                    'antes ' || v_elo_antes || ' después ' || v_elo_despues);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 5. EL AMISTOSO NO DA NADA (el fallo que había) ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_res JSONB;
  v_elo_a INTEGER; v_elo_b INTEGER; v_elo_a2 INTEGER; v_elo_b2 INTEGER;
  v_cofres INTEGER; v_cofres2 INTEGER;
BEGIN
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('friendly');
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('friendly')->>'roomId')::UUID;
  PERFORM public._t('el amistoso también empareja', v_sala IS NOT NULL, 'sin sala');

  SELECT elo_rating INTO v_elo_a FROM public.profiles WHERE id = v_a;
  SELECT elo_rating INTO v_elo_b FROM public.profiles WHERE id = v_b;
  SELECT COUNT(*) INTO v_cofres FROM public.pack_slots WHERE user_id = v_a AND status <> 'empty';

  PERFORM public._soy(v_a); PERFORM public.report_match_result(v_sala, v_a);
  PERFORM public._soy(v_b); v_res := public.report_match_result(v_sala, v_a);

  SELECT elo_rating INTO v_elo_a2 FROM public.profiles WHERE id = v_a;
  SELECT elo_rating INTO v_elo_b2 FROM public.profiles WHERE id = v_b;
  SELECT COUNT(*) INTO v_cofres2 FROM public.pack_slots WHERE user_id = v_a AND status <> 'empty';

  PERFORM public._t('el amistoso NO mueve el ELO de la ganadora',
                    v_elo_a = v_elo_a2, 'antes ' || v_elo_a || ' después ' || v_elo_a2);
  PERFORM public._t('el amistoso NO mueve el ELO del perdedor',
                    v_elo_b = v_elo_b2, 'antes ' || v_elo_b || ' después ' || v_elo_b2);
  PERFORM public._t('el amistoso NO da cofre',
                    v_cofres = v_cofres2, 'cofres antes ' || v_cofres || ' después ' || v_cofres2);
  PERFORM public._t('el amistoso NO paga gemas',
                    (v_res->>'payout')::NUMERIC = 0, v_res::TEXT);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 6. REPORTES QUE NO COINCIDEN: NADIE COBRA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_res JSONB; v_elo_a INTEGER; v_elo_a2 INTEGER;
BEGIN
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('ranked');
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('ranked')->>'roomId')::UUID;

  SELECT elo_rating INTO v_elo_a FROM public.profiles WHERE id = v_a;

  -- Cada uno dice que ganó él.
  PERFORM public._soy(v_a); PERFORM public.report_match_result(v_sala, v_a);
  PERFORM public._soy(v_b); v_res := public.report_match_result(v_sala, v_b);

  PERFORM public._t('reportes distintos quedan en disputa',
                    v_res->>'status' = 'resultado_en_disputa', v_res::TEXT);

  SELECT elo_rating INTO v_elo_a2 FROM public.profiles WHERE id = v_a;
  PERFORM public._t('en disputa nadie toca el ELO',
                    v_elo_a = v_elo_a2, 'antes ' || v_elo_a || ' después ' || v_elo_a2);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 7. COLISEO: COBRA, Y DEVUELVE SI NO HAY RIVAL ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_saldo NUMERIC; v_saldo2 NUMERIC; v_saldo3 NUMERIC;
  v_res JSONB;
BEGIN
  UPDATE public.profiles SET gems_balance = 10 WHERE id = v_a;
  PERFORM public._soy(v_a);

  -- Sin importe no entra.
  BEGIN
    PERFORM public.enter_matchmaking('colosseum');
    PERFORM public._t('el coliseo exige importe', FALSE, 'no lanzó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('el coliseo exige importe', SQLERRM LIKE '%apuesta%', SQLERRM);
  END;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_a;
  v_res := public.enter_matchmaking('colosseum', 2);
  SELECT gems_balance INTO v_saldo2 FROM public.profiles WHERE id = v_a;

  PERFORM public._t('el coliseo cobra al entrar en la cola',
                    v_saldo2 = v_saldo - 2, 'antes ' || v_saldo || ' después ' || v_saldo2);
  PERFORM public._t('la apuesta queda retenida, no gastada',
                    EXISTS (SELECT 1 FROM public.colosseum_escrow
                             WHERE user_id = v_a AND status = 'held' AND room_id IS NULL),
                    'sin retención');

  -- Cancelar devuelve.
  v_res := public.cancel_matchmaking();
  SELECT gems_balance INTO v_saldo3 FROM public.profiles WHERE id = v_a;
  PERFORM public._t('cancelar devuelve la apuesta entera',
                    v_saldo3 = v_saldo, 'esperado ' || v_saldo || ' obtenido ' || v_saldo3);

  -- Y no se pueden acumular dos apuestas retenidas.
  PERFORM public.enter_matchmaking('colosseum', 2);
  v_res := public.enter_matchmaking('colosseum', 2);
  SELECT gems_balance INTO v_saldo3 FROM public.profiles WHERE id = v_a;
  PERFORM public._t('buscar dos veces no cobra dos veces',
                    v_saldo3 = v_saldo - 2,
                    'esperado ' || (v_saldo - 2) || ' obtenido ' || v_saldo3);
  PERFORM public.cancel_matchmaking();
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 8. NO SE PUEDE EMPAREJAR CONSIGO MISMO ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_r1 JSONB; v_r2 JSONB; v_n INTEGER;
BEGIN
  PERFORM public._soy(v_a);
  v_r1 := public.enter_matchmaking('ranked');
  v_r2 := public.enter_matchmaking('ranked');

  PERFORM public._t('buscar dos veces no crea partida contra uno mismo',
                    (v_r2->>'matched')::BOOLEAN IS FALSE, v_r2::TEXT);

  SELECT COUNT(*) INTO v_n FROM public.matchmaking_queue
   WHERE user_id = v_a AND status = 'searching';
  PERFORM public._t('sólo queda una búsqueda activa por jugador',
                    v_n = 1, 'búsquedas activas: ' || v_n);
  PERFORM public.cancel_matchmaking();
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 9. LAS FUNCIONES INTERNAS NO SON LLAMABLES ==='; END $$;

DO $$
DECLARE v_mal TEXT[] := '{}'; v_f TEXT;
BEGIN
  FOR v_f IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE '\_%'
       -- _t y _soy son ayudantes de ESTA prueba, no de las migraciones.
       AND p.proname NOT IN ('_t', '_soy')
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    v_mal := array_append(v_mal, v_f);
  END LOOP;

  PERFORM public._t('ninguna función interna es llamable por authenticated',
                    array_length(v_mal,1) IS NULL,
                    'llamables: ' || array_to_string(v_mal, ', '));
END $$;

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='matchmaking_queue'
     AND grantee IN ('anon','authenticated')
     AND privilege_type IN ('INSERT','UPDATE','DELETE');
  PERFORM public._t('el cliente no puede escribir en la cola',
                    v_n = 0, 'permisos de escritura encontrados: ' || v_n);
END $$;

DO $$ BEGIN RAISE NOTICE E'\n=== fin ===\n'; END $$;
