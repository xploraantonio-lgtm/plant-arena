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
  v_c UUID := '33333333-3333-3333-3333-333333333333';
  v_n INTEGER;
  v_gemas NUMERIC;
BEGIN
  -- Limpieza para poder repetir la prueba sobre la misma base.
  --
  -- Hay que borrar lo que apunta al jugador ANTES que al jugador: game_rooms
  -- referencia profiles sin borrado en cascada, así que un DELETE directo sobre
  -- auth.users falla en cuanto ha habido una partida.
  --
  -- (De paso: eso significa que hoy NO se puede borrar la cuenta de alguien que
  -- haya jugado. Es defendible como rastro de auditoría, pero conviene saberlo si
  -- algún día hay que atender un "bórrame la cuenta".)
  -- La cola antes que las retenciones: matchmaking_queue.escrow_id apunta a
  -- colosseum_escrow, así que al revés el borrado se bloquea.
  DELETE FROM public.match_actions     WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.matchmaking_queue WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.colosseum_escrow  WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.game_rooms
   WHERE player1_id IN (v_a, v_b, v_c) OR player2_id IN (v_a, v_b, v_c);
  DELETE FROM public.transactions     WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.pack_slots       WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.plant_instances  WHERE owner_id IN (v_a, v_b, v_c);
  DELETE FROM public.plant_copies     WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM public.user_lottery     WHERE user_id IN (v_a, v_b, v_c);
  DELETE FROM auth.users WHERE id IN (v_a, v_b, v_c);

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


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 10. RENDIRSE CUENTA DE VERDAD (migración 18) ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_res JSONB;
  v_elo_a INTEGER; v_elo_b INTEGER; v_elo_a2 INTEGER; v_elo_b2 INTEGER;
BEGIN
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('ranked');
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('ranked')->>'roomId')::UUID;

  SELECT elo_rating INTO v_elo_a FROM public.profiles WHERE id = v_a;
  SELECT elo_rating INTO v_elo_b FROM public.profiles WHERE id = v_b;

  -- Ana se rinde. No hace falta que Beto confirme nada.
  PERFORM public._soy(v_a);
  v_res := public.surrender_match(v_sala);

  PERFORM public._t('rendirse liquida sin esperar al rival',
                    v_res->>'status' = 'liquidada', v_res::TEXT);
  PERFORM public._t('gana el rival, no quien se rinde',
                    (v_res->>'winner')::UUID = v_b, v_res::TEXT);

  SELECT elo_rating INTO v_elo_a2 FROM public.profiles WHERE id = v_a;
  SELECT elo_rating INTO v_elo_b2 FROM public.profiles WHERE id = v_b;

  PERFORM public._t('al que se rinde le BAJA el ELO de verdad',
                    v_elo_a2 < v_elo_a,
                    'antes ' || v_elo_a || ' después ' || v_elo_a2);
  PERFORM public._t('al rival le sube',
                    v_elo_b2 > v_elo_b,
                    'antes ' || v_elo_b || ' después ' || v_elo_b2);

  -- Y no se puede rendir dos veces para regalarle ELO al rival.
  BEGIN
    PERFORM public.surrender_match(v_sala);
    PERFORM public._t('no se puede rendir dos veces', FALSE, 'no lanzó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('no se puede rendir dos veces',
                      SQLERRM LIKE '%ya liquidada%', SQLERRM);
  END;
END $$;

DO $$
DECLARE v_ajeno UUID := '33333333-3333-3333-3333-333333333333'; v_sala UUID;
BEGIN
  DELETE FROM auth.users WHERE id = v_ajeno;
  INSERT INTO auth.users (id, email) VALUES (v_ajeno, 'ajeno@ejemplo.com');
  SELECT id INTO v_sala FROM public.game_rooms ORDER BY created_at DESC LIMIT 1;

  PERFORM public._soy(v_ajeno);
  BEGIN
    PERFORM public.surrender_match(v_sala);
    PERFORM public._t('un tercero no puede rendir tu partida', FALSE, 'no lanzó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('un tercero no puede rendir tu partida',
                      SQLERRM LIKE '%No participas%' OR SQLERRM LIKE '%ya liquidada%', SQLERRM);
  END;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 11. EL RANKING DEJA FUERA A QUIEN NO COMPITE ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_perfiles INTEGER; v_ranking INTEGER; v_n INTEGER;
BEGIN
  UPDATE public.profiles SET exclude_from_ranking = TRUE WHERE id = v_a;

  SELECT COUNT(*) INTO v_perfiles FROM public.profiles;
  SELECT COUNT(*) INTO v_ranking  FROM public.leaderboard;
  PERFORM public._t('la vista trae menos filas que la tabla',
                    v_ranking < v_perfiles,
                    'perfiles ' || v_perfiles || ' ranking ' || v_ranking);

  SELECT COUNT(*) INTO v_n FROM public.leaderboard WHERE id = v_a;
  PERFORM public._t('la cuenta excluida no aparece en el ranking',
                    v_n = 0, 'apariciones: ' || v_n);

  -- La vista NO debe exponer saldos ni si es administrador.
  SELECT COUNT(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='leaderboard'
     AND column_name IN ('gems_balance','gold_balance','is_admin','exclude_from_ranking');
  PERFORM public._t('la vista no expone saldos ni is_admin',
                    v_n = 0, 'columnas sensibles expuestas: ' || v_n);

  UPDATE public.profiles SET exclude_from_ranking = FALSE WHERE id = v_a;
END $$;

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='profiles'
     AND column_name='exclude_from_ranking'
     AND grantee IN ('anon','authenticated') AND privilege_type='UPDATE';
  PERFORM public._t('el jugador no puede sacarse del ranking a sí mismo',
                    v_n = 0, 'permisos de UPDATE encontrados: ' || v_n);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 12. EN DISPUTA, EL COLISEO DEVUELVE LO COBRADO ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_res JSONB;
  v_sa NUMERIC; v_sb NUMERIC; v_sa2 NUMERIC; v_sb2 NUMERIC;
  v_retenidas INTEGER;
BEGIN
  UPDATE public.profiles SET gems_balance = 20 WHERE id IN (v_a, v_b);

  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('colosseum', 3);
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('colosseum', 3)->>'roomId')::UUID;
  PERFORM public._t('el coliseo empareja a dos con la misma apuesta',
                    v_sala IS NOT NULL, 'no emparejó');

  SELECT gems_balance INTO v_sa FROM public.profiles WHERE id = v_a;
  SELECT gems_balance INTO v_sb FROM public.profiles WHERE id = v_b;
  PERFORM public._t('a los dos se les cobró',
                    v_sa = 17 AND v_sb = 17, 'ana ' || v_sa || ' beto ' || v_sb);

  -- Cada uno dice que ganó él: es lo que pasa hoy si los dos vencen a su bot.
  PERFORM public._soy(v_a); PERFORM public.report_match_result(v_sala, v_a);
  PERFORM public._soy(v_b); v_res := public.report_match_result(v_sala, v_b);

  PERFORM public._t('queda en disputa', v_res->>'status' = 'resultado_en_disputa', v_res::TEXT);
  PERFORM public._t('y dice que devolvió', (v_res->>'refunded')::BOOLEAN IS TRUE, v_res::TEXT);

  SELECT gems_balance INTO v_sa2 FROM public.profiles WHERE id = v_a;
  SELECT gems_balance INTO v_sb2 FROM public.profiles WHERE id = v_b;
  PERFORM public._t('a los DOS se les devolvieron sus 3 gemas',
                    v_sa2 = 20 AND v_sb2 = 20, 'ana ' || v_sa2 || ' beto ' || v_sb2);

  SELECT COUNT(*) INTO v_retenidas FROM public.colosseum_escrow
   WHERE room_id = v_sala AND status = 'held';
  PERFORM public._t('no queda ninguna gema atrapada en retención',
                    v_retenidas = 0, 'retenciones vivas: ' || v_retenidas);
END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_tk_a INTEGER; v_tk_a2 INTEGER;
BEGIN
  -- Lo mismo pagando con ticket: debe volver el TICKET, no gemas.
  UPDATE public.profiles SET colosseum_tickets = 2, gems_balance = 20 WHERE id = v_a;
  UPDATE public.profiles SET gems_balance = 20 WHERE id = v_b;
  SELECT colosseum_tickets INTO v_tk_a FROM public.profiles WHERE id = v_a;

  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('colosseum', 3, TRUE);
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('colosseum', 3)->>'roomId')::UUID;

  PERFORM public._soy(v_a); PERFORM public.report_match_result(v_sala, v_a);
  PERFORM public._soy(v_b); PERFORM public.report_match_result(v_sala, v_b);

  SELECT colosseum_tickets INTO v_tk_a2 FROM public.profiles WHERE id = v_a;
  PERFORM public._t('quien pagó con ticket recupera el TICKET',
                    v_tk_a2 = v_tk_a, 'antes ' || v_tk_a || ' después ' || v_tk_a2);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 13. EL REGISTRO DE ACCIONES (migración 19) ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_c UUID := '33333333-3333-3333-3333-333333333333';
  v_sala UUID; v_res JSONB; v_n INTEGER; v_acciones JSONB;
BEGIN
  -- Sala nueva, sin liquidar.
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('ranked');
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('ranked')->>'roomId')::UUID;

  -- Una acción normal.
  PERFORM public._soy(v_a);
  v_res := public.submit_match_action(v_sala, 1, 40, 'plant', 'sunflower', 0::SMALLINT, 3::SMALLINT);
  PERFORM public._t('se registra una plantación válida',
                    (v_res->>'ok')::BOOLEAN, v_res::TEXT);

  -- Mandar la MISMA otra vez (reintento de red) no la duplica ni falla.
  v_res := public.submit_match_action(v_sala, 1, 40, 'plant', 'sunflower', 0::SMALLINT, 3::SMALLINT);
  SELECT COUNT(*) INTO v_n FROM public.match_actions
   WHERE room_id = v_sala AND user_id = v_a AND seq = 1;
  PERFORM public._t('el reintento no duplica la acción', v_n = 1, 'filas: ' || v_n);

  -- Una carta que NO está en su mazo.
  BEGIN
    PERFORM public.submit_match_action(v_sala, 2, 45, 'plant', 'melonpult', 1::SMALLINT, 4::SMALLINT);
    PERFORM public._t('rechaza una carta que no tienes', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('rechaza una carta que no tienes',
                      SQLERRM LIKE '%no está en tu mazo%', SQLERRM);
  END;

  -- Reescribir el pasado.
  BEGIN
    PERFORM public.submit_match_action(v_sala, 3, 0, 'plant', 'sunflower', 0::SMALLINT, 1::SMALLINT);
    -- El tic 0 puede estar dentro de tolerancia si la sala se acaba de crear, así
    -- que se usa un valor claramente imposible.
    PERFORM public.submit_match_action(v_sala, 4, -1, 'plant', 'sunflower', 0::SMALLINT, 1::SMALLINT);
    PERFORM public._t('rechaza un tic negativo', FALSE, 'lo aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('rechaza un tic negativo', TRUE);
  END;

  -- Programar una jugada muy en el futuro.
  BEGIN
    PERFORM public.submit_match_action(v_sala, 5, 99999, 'plant', 'sunflower', 0::SMALLINT, 1::SMALLINT);
    PERFORM public._t('rechaza una acción muy en el futuro', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('rechaza una acción muy en el futuro',
                      SQLERRM LIKE '%futuro%', SQLERRM);
  END;

  -- Un tercero no puede meter acciones en una partida ajena.
  PERFORM public._soy(v_c);
  BEGIN
    PERFORM public.submit_match_action(v_sala, 1, 40, 'plant', 'sunflower', 0::SMALLINT, 3::SMALLINT);
    PERFORM public._t('un tercero no puede jugar tu partida', FALSE, 'lo dejó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('un tercero no puede jugar tu partida',
                      SQLERRM LIKE '%No participas%', SQLERRM);
  END;

  -- Los dos participantes ven las acciones de la partida, incluidas las del otro.
  PERFORM public._soy(v_b);
  PERFORM public.submit_match_action(v_sala, 1, 50, 'plant', 'repeater', 2::SMALLINT, 8::SMALLINT);
  v_acciones := public.match_actions_since(v_sala, 0);
  PERFORM public._t('el rival ve las acciones de los dos',
                    jsonb_array_length(v_acciones) = 2,
                    'acciones vistas: ' || jsonb_array_length(v_acciones));
  PERFORM public._t('las acciones traen su tic',
                    (v_acciones->0->>'tick')::INTEGER = 40, v_acciones::TEXT);

  -- Un tercero no las puede leer.
  PERFORM public._soy(v_c);
  BEGIN
    PERFORM public.match_actions_since(v_sala, 0);
    PERFORM public._t('un tercero no puede leer la partida ajena', FALSE, 'la leyó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('un tercero no puede leer la partida ajena',
                      SQLERRM LIKE '%No participas%', SQLERRM);
  END;

  -- Y con la partida liquidada, no se aceptan más acciones: si no, se podrían
  -- añadir después de cobrar y el recálculo del servidor daría otro ganador.
  PERFORM public._soy(v_a); PERFORM public.surrender_match(v_sala);
  BEGIN
    PERFORM public.submit_match_action(v_sala, 9, 60, 'plant', 'sunflower', 0::SMALLINT, 2::SMALLINT);
    PERFORM public._t('no se aceptan acciones tras liquidar', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('no se aceptan acciones tras liquidar',
                      SQLERRM LIKE '%liquidada%', SQLERRM);
  END;
END $$;

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='match_actions'
     AND grantee IN ('anon','authenticated')
     AND privilege_type IN ('INSERT','UPDATE','DELETE');
  PERFORM public._t('el cliente no puede escribir acciones directamente',
                    v_n = 0, 'permisos encontrados: ' || v_n);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 14. EL TIC DEL CLIENTE NO ES EL RELOJ (migración 20) ==='; END $$;

-- El fallo que se vio jugando: el tic 0 del cliente NO es cuando se creó la sala.
-- Entre una cosa y otra pasan segundos (emparejar, leer la sala, cambiar de
-- pantalla, cargar la batalla). La primera versión deducía el tic de la partida
-- del reloj y rechazaba TODO por antiguo, así que el rival no veía nada.
--
-- Estas comprobaciones simulan ese retardo, que es lo que la prueba instantánea
-- no podía ver.
DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_res JSONB;
BEGIN
  PERFORM public._soy(v_a); PERFORM public.enter_matchmaking('ranked');
  PERFORM public._soy(v_b); v_sala := (public.enter_matchmaking('ranked')->>'roomId')::UUID;

  -- La sala se creó hace 4 segundos y el cliente acaba de empezar: su tic va por
  -- 10. Es el caso real.
  UPDATE public.game_rooms SET created_at = NOW() - INTERVAL '4 seconds' WHERE id = v_sala;

  PERFORM public._soy(v_a);
  BEGIN
    v_res := public.submit_match_action(v_sala, 1, 16, 'plant', 'sunflower', 0::SMALLINT, 3::SMALLINT);
    PERFORM public._t('acepta la primera acción aunque la sala se creara antes',
                      (v_res->>'ok')::BOOLEAN, v_res::TEXT);
  EXCEPTION WHEN others THEN
    PERFORM public._t('acepta la primera acción aunque la sala se creara antes',
                      FALSE, SQLERRM);
  END;

  -- Y el rival, con su propio retardo, también.
  PERFORM public._soy(v_b);
  BEGIN
    v_res := public.submit_match_action(v_sala, 1, 20, 'plant', 'sunflower', 1::SMALLINT, 3::SMALLINT);
    PERFORM public._t('el rival también puede jugar con su retardo',
                      (v_res->>'ok')::BOOLEAN, v_res::TEXT);
  EXCEPTION WHEN others THEN
    PERFORM public._t('el rival también puede jugar con su retardo', FALSE, SQLERRM);
  END;

  -- Lo que SÍ hay que impedir sigue impedido: reescribir el pasado cuando la
  -- partida ya iba muy avanzada.
  --
  -- La sala se envejece a 30 s para que el tic 400 sea posible: con 4 s el techo
  -- por reloj lo rechazaría, y con razón — la simulación no puede ir por delante
  -- del tiempo. (La primera versión de esta prueba no lo tenía en cuenta y fallaba
  -- ella, no el código.)
  UPDATE public.game_rooms SET created_at = NOW() - INTERVAL '30 seconds' WHERE id = v_sala;

  PERFORM public._soy(v_a);
  PERFORM public.submit_match_action(v_sala, 2, 400, 'plant', 'peashooter', 0::SMALLINT, 4::SMALLINT);
  BEGIN
    PERFORM public._soy(v_b);
    PERFORM public.submit_match_action(v_sala, 2, 30, 'plant', 'wallnut', 2::SMALLINT, 5::SMALLINT);
    PERFORM public._t('no se puede insertar muy por detrás de la partida', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('no se puede insertar muy por detrás de la partida',
                      SQLERRM LIKE '%antigua%', SQLERRM);
  END;

  -- Ni ir hacia atrás respecto a lo tuyo.
  PERFORM public._soy(v_a);
  BEGIN
    PERFORM public.submit_match_action(v_sala, 3, 390, 'plant', 'wallnut', 1::SMALLINT, 5::SMALLINT);
    PERFORM public._t('tus acciones no pueden ir hacia atrás', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('tus acciones no pueden ir hacia atrás',
                      SQLERRM LIKE '%hacia atrás%', SQLERRM);
  END;

  -- Ni correr más que el reloj: la simulación no puede ir por delante del tiempo.
  BEGIN
    PERFORM public.submit_match_action(v_sala, 4, 99999, 'plant', 'wallnut', 1::SMALLINT, 5::SMALLINT);
    PERFORM public._t('la simulación no puede ir por delante del reloj', FALSE, 'la aceptó');
  EXCEPTION WHEN others THEN
    PERFORM public._t('la simulación no puede ir por delante del reloj',
                      SQLERRM LIKE '%futuro%', SQLERRM);
  END;
END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID; v_info JSONB;
BEGIN
  SELECT id INTO v_sala FROM public.game_rooms
   WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1;

  PERFORM public._soy(v_a);
  v_info := public.game_room_info(v_sala);
  PERFORM public._t('la sala trae los nombres de los dos jugadores',
                    (v_info->'player1'->>'username') IS NOT NULL
                    AND (v_info->'player2'->>'username') IS NOT NULL,
                    v_info::TEXT);
  PERFORM public._t('y dice quién eres tú en ella',
                    (v_info->>'iAm') IN ('p1','p2'), v_info->>'iAm');
  PERFORM public._t('no expone saldos del rival',
                    NOT (v_info->'player2' ? 'gems_balance'), (v_info->'player2')::TEXT);
END $$;
