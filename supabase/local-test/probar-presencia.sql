-- =============================================================================
-- PRUEBA DE LA PRESENCIA Y DE LOS ENLACES (migración 26)
--
-- Se ejecuta sobre la base que deja probar-migraciones.sh, después de
-- probar-emparejamiento.sql (que es quien crea las plantas y los mazos).
--
-- LO QUE SE COMPRUEBA, Y POR QUÉ
--   Los tres casos de abandono son fáciles de confundir, y confundirlos se paga
--   con partidas mal liquidadas:
--
--     los dos ahí        → la partida SIGUE, planten o no. Este era el fallo:
--                          dos jugadores esperando sin plantar se quedaban sin
--                          resultado a los 120 segundos.
--     uno se fue         → GANA el que se queda. Es lo que promete el aviso al
--                          cerrar la pestaña; antes no era verdad.
--     se fueron los dos  → sin ganador, y en coliseo se devuelve lo puesto.
--
--   Y el enlace para compartir, que fallaba en silencio porque gen_random_bytes
--   no está en el search_path de la función en Supabase.
--
-- Imprime OK o FALLA por cada comprobación. Se puede pegar en el editor SQL de
-- Supabase tal cual.
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

/**
 * Una sala en marcha entre dos jugadores, con la antigüedad que se le pida.
 *
 * `p_hace_segundos` desplaza la creación hacia atrás. Es lo que permite probar
 * plazos sin esperarlos: el servidor mide contra NOW(), así que envejecer la sala
 * equivale a dejar pasar el tiempo.
 */
CREATE OR REPLACE FUNCTION public._sala_de_prueba(
  p_p1 UUID, p_p2 UUID, p_modo TEXT, p_hace_segundos INTEGER
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  -- Los mazos son obligatorios en la tabla. Aquí no importan: lo que se prueba es
  -- quién sigue conectado, no lo que se planta.
  INSERT INTO public.game_rooms (player1_id, player2_id, mode, status, seed,
                                 p1_deck, p2_deck, created_at, started_at)
  VALUES (p_p1, p_p2, p_modo, 'playing', 4242,
          '[]'::JSONB, '[]'::JSONB,
          NOW() - make_interval(secs => p_hace_segundos),
          NOW() - make_interval(secs => p_hace_segundos))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 1. LOS DOS SIGUEN AHÍ: LA PARTIDA NO SE CIERRA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_res JSONB;
  v_estado TEXT;
BEGIN
  -- Cinco minutos de partida y NINGUNA jugada. Con la regla vieja esto se cerraba
  -- como abandonada; es exactamente la partida que salió "SIN RESULTADO".
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 300);

  -- Los dos han estado preguntando por el resultado todo el rato, que es lo que
  -- hace el cliente cada 4 segundos. Se deja la huella de los dos hace 3 segundos
  -- para retratar eso: cinco minutos de partida, ninguna jugada, y los dos ahí.
  UPDATE public.game_rooms
     SET p1_last_seen = NOW() - INTERVAL '3 seconds',
         p2_last_seen = NOW() - INTERVAL '3 seconds'
   WHERE id = v_sala;

  PERFORM public._soy(v_a);
  v_res := public.room_result(v_sala);
  PERFORM public._soy(v_b);
  v_res := public.room_result(v_sala);

  SELECT status INTO v_estado FROM public.game_rooms WHERE id = v_sala;
  PERFORM public._t('sigue jugándose aunque nadie haya plantado',
                    (v_res->>'ended')::BOOLEAN IS FALSE AND v_estado = 'playing',
                    'estado: ' || v_estado || '  respuesta: ' || v_res::TEXT);

  PERFORM public._t('quedó huella de los dos',
                    (SELECT p1_last_seen IS NOT NULL AND p2_last_seen IS NOT NULL
                       FROM public.game_rooms WHERE id = v_sala));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 2. UNO SE VA: GANA EL QUE SE QUEDA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_res JSONB;
  v_elo_antes INTEGER;
  v_elo_despues INTEGER;
BEGIN
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 300);

  -- Ana está: acaba de preguntar. Beto cerró el navegador hace cinco minutos, así
  -- que su huella se queda como estaba (nula) y su plazo cuenta desde la creación.
  SELECT elo_rating INTO v_elo_antes FROM public.profiles WHERE id = v_a;

  PERFORM public._soy(v_a);
  v_res := public.room_result(v_sala);

  PERFORM public._t('la partida termina', (v_res->>'ended')::BOOLEAN IS TRUE,
                    v_res::TEXT);
  PERFORM public._t('y la gana Ana, que es la que estaba',
                    (v_res->>'iWon')::BOOLEAN IS TRUE, v_res::TEXT);

  SELECT elo_rating INTO v_elo_despues FROM public.profiles WHERE id = v_a;
  PERFORM public._t('cobra el ELO de la victoria', v_elo_despues > v_elo_antes,
                    v_elo_antes || ' → ' || v_elo_despues);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 3. SE VAN LOS DOS: SIN GANADOR ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_estado TEXT;
BEGIN
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 300);

  -- Nadie pregunta: lo cierra el barrido general.
  PERFORM public.settle_abandoned_rooms();

  SELECT status INTO v_estado FROM public.game_rooms WHERE id = v_sala;
  PERFORM public._t('se marca abandonada', v_estado = 'abandoned',
                    'estado: ' || v_estado);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 4. PREGUNTAR MÁS VECES NO ADELANTA NADA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_res JSONB;
BEGIN
  -- Recién creada: nadie puede haber abandonado todavía.
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 5);

  PERFORM public._soy(v_a);
  FOR i IN 1..20 LOOP
    v_res := public.room_result(v_sala);
  END LOOP;

  PERFORM public._t('veinte llamadas no cierran una partida nueva',
                    (v_res->>'ended')::BOOLEAN IS FALSE, v_res::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 5. NADIE TOCA UNA SALA AJENA ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_c UUID := '33333333-3333-3333-3333-333333333333';
  v_sala UUID;
  v_falló BOOLEAN := FALSE;
BEGIN
  DELETE FROM auth.users WHERE id = v_c;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_c, 'ceci@ejemplo.com', '{"full_name":"Ceci"}');

  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 300);

  PERFORM public._soy(v_c);
  BEGIN
    PERFORM public.room_result(v_sala);
  EXCEPTION WHEN OTHERS THEN
    v_falló := TRUE;
  END;

  PERFORM public._t('un tercero no puede consultar ni cerrar la sala', v_falló);
  PERFORM public._t('y no dejó huella en ella',
                    (SELECT p1_last_seen IS NULL AND p2_last_seen IS NULL
                       FROM public.game_rooms WHERE id = v_sala));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 6. EL ENLACE PARA COMPARTIR ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_c UUID := '33333333-3333-3333-3333-333333333333';
  v_sala UUID;
  v_r1 JSONB;
  v_r2 JSONB;
  v_rep JSONB;
  v_falló BOOLEAN := FALSE;
BEGIN
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 300);
  UPDATE public.game_rooms
     SET status = 'p1_won', settled_at = NOW()
   WHERE id = v_sala;

  PERFORM public._soy(v_a);
  v_r1 := public.share_match(v_sala);

  -- ESTE es el fallo que se veía como "el botón no hace nada": la función
  -- lanzaba excepción por gen_random_bytes y el cliente se lo comía.
  PERFORM public._t('devuelve un código', v_r1->>'token' IS NOT NULL, v_r1::TEXT);
  PERFORM public._t('de 32 caracteres hexadecimales',
                    v_r1->>'token' ~ '^[0-9a-f]{32}$', v_r1::TEXT);

  -- Volver a pulsar no cambia el enlace: uno ya enviado tiene que seguir sirviendo.
  v_r2 := public.share_match(v_sala);
  PERFORM public._t('pulsar otra vez devuelve el mismo',
                    v_r2->>'token' = v_r1->>'token' AND (v_r2->>'yaExistia')::BOOLEAN,
                    v_r2::TEXT);

  -- Con el código, cualquiera la ve. Sin cuenta también, pero eso aquí no se
  -- puede simular: auth.uid() sale de una variable de sesión.
  PERFORM public._soy(v_c);
  v_rep := public.match_replay(NULL, v_r1->>'token');
  PERFORM public._t('con el código se puede ver sin haber jugado',
                    v_rep IS NOT NULL AND v_rep ? 'seed', COALESCE(v_rep::TEXT, 'NULL'));
  PERFORM public._t('y no lleva identificadores de usuario',
                    v_rep::TEXT NOT LIKE '%' || v_a::TEXT || '%'
                AND v_rep::TEXT NOT LIKE '%' || v_b::TEXT || '%',
                    v_rep::TEXT);

  -- Sin el código, un tercero no ve nada. La función lanza excepción en lugar de
  -- devolver nulo, así que se captura: lo que importa es que NO devuelva la
  -- partida, no de qué forma se niega.
  BEGIN
    v_rep := public.match_replay(v_sala, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_falló := TRUE;
    v_rep := NULL;
  END;
  PERFORM public._t('sin el código, un tercero no la ve', v_falló OR v_rep IS NULL,
                    COALESCE(v_rep::TEXT, 'NULL'));

  -- Revocar deja el enlace muerto.
  PERFORM public._soy(v_b);   -- cualquiera de los dos puede revocarlo
  PERFORM public.unshare_match(v_sala);
  PERFORM public._soy(v_c);

  v_falló := FALSE;
  BEGIN
    v_rep := public.match_replay(NULL, v_r1->>'token');
  EXCEPTION WHEN OTHERS THEN
    v_falló := TRUE;
    v_rep := NULL;
  END;
  PERFORM public._t('al revocarlo el enlace deja de funcionar',
                    v_falló OR v_rep IS NULL, COALESCE(v_rep::TEXT, 'NULL'));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== 7. LA DURACIÓN QUE SE ENSEÑA ES LA DE VERDAD ==='; END $$;

DO $$
DECLARE
  v_a UUID := '11111111-1111-1111-1111-111111111111';
  v_b UUID := '22222222-2222-2222-2222-222222222222';
  v_sala UUID;
  v_dur NUMERIC;
BEGIN
  v_sala := public._sala_de_prueba(v_a, v_b, 'ranked', 200);
  UPDATE public.game_rooms
     SET status = 'p1_won', settled_at = NOW()
   WHERE id = v_sala;

  -- Una sola jugada, al segundo 10: con la cuenta vieja la partida entera duraba
  -- "10 s". Es lo que salía en la lista: 52 s para una partida de tres minutos.
  INSERT INTO public.match_actions (room_id, user_id, seq, tick, kind, plant_id, lane, col)
  VALUES (v_sala, v_a, 1, 300, 'plant', 'sunflower', 0, 2);

  PERFORM public._soy(v_a);
  SELECT (fila->>'duracionSegundos')::NUMERIC INTO v_dur
    FROM jsonb_array_elements(public.my_matches(50)) AS fila
   WHERE fila->>'roomId' = v_sala::TEXT;

  PERFORM public._t('la duración es la de la partida, no la de la última jugada',
                    v_dur > 150, 'duración: ' || COALESCE(v_dur::TEXT, 'NULL'));
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== FIN ==='; END $$;

-- Se retiran los ayudantes de la prueba: dejarlos en la base haría que el control
-- de "ninguna función interna es llamable por authenticated" de
-- probar-emparejamiento.sql saltara por un artefacto de test.
DROP FUNCTION IF EXISTS public._sala_de_prueba(UUID, UUID, TEXT, INTEGER);
