-- =============================================================================
-- PLANT ARENA · ¿SE SEPARARON LAS DOS PANTALLAS?
--
-- Sólo LEE. No cambia nada, no borra nada. Se puede ejecutar cuantas veces haga
-- falta, incluso con gente jugando.
--
-- QUÉ CONTESTA
--   La única pregunta que importa antes de dejar jugar a todo el mundo: de las
--   últimas partidas, ¿en cuántas las dos pantallas dejaron de ver lo mismo?
--
--   Cada cliente resume su tablero cada 10 segundos y lo manda (la «huella»).
--   Esto compara las dos huellas del mismo tic. Si coinciden en todos los tics,
--   los dos jugaron exactamente la misma partida.
--
-- ⚠️  MIRA SÓLO LAS PARTIDAS JUGADAS DESPUÉS DE DESPLEGAR
--   Las huellas se guardan desde antes del arreglo, así que las partidas viejas
--   van a salir separadas — eso es el fallo que ya está arreglado, no uno nuevo.
--   La consulta 1 trae la hora de cada partida para poder distinguirlas.
--
-- ⚠️  Y LOS DOS JUGADORES TIENEN QUE TENER LA VERSIÓN NUEVA
--   Una pantalla con el código nuevo contra una con el viejo SE SEPARA, y es
--   normal: el arreglo consiste precisamente en cambiar cómo se cuentan los tics
--   y de dónde salen las mejoras de las cartas. El juego recarga solo cuando hay
--   versión nueva, pero durante el primer minuto tras desplegar puede haber
--   partidas a medias con una de cada. Si una partida sale separada, mira primero
--   la hora: si es de justo después de desplegar, repítela.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. EL VEREDICTO, UNA FILA POR PARTIDA
--
--    Lo que hay que leer es la columna `veredicto`:
--
--      ✅ IGUALES          las dos pantallas vieron lo mismo de principio a fin.
--                          Esto es lo que tiene que salir.
--      ❌ SE SEPARARON     dejaron de coincidir, y `primer_tic_distinto` dice
--                          dónde. Divide por 30 para saber el segundo.
--      ⚠️  SIN DATOS       no hubo ningún tic con huella de los dos. No dice
--                          nada: puede que uno se fuera antes de los 10 primeros
--                          segundos, o que jugara con la versión vieja.
-- -----------------------------------------------------------------------------
SELECT
  COALESCE(r.started_at, r.created_at)                     AS jugada_en,
  r.mode                                                    AS modo,
  COALESCE(p1.username, '?') || ' vs ' || COALESCE(p2.username, '?') AS jugadores,

  -- Cuántos tics se pudieron comparar. Con 0, la fila no prueba nada.
  (SELECT COUNT(*)
     FROM public.match_checkpoints c1
     JOIN public.match_checkpoints c2
       ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
    WHERE c1.room_id = r.id AND c1.user_id = r.player1_id)  AS tics_comparados,

  -- El primer tic en que las dos huellas no coincidieron. NULL es la buena.
  (SELECT MIN(c1.tick)
     FROM public.match_checkpoints c1
     JOIN public.match_checkpoints c2
       ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
    WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
      AND c1.huella <> c2.huella)                           AS primer_tic_distinto,

  CASE
    WHEN (SELECT COUNT(*)
            FROM public.match_checkpoints c1
            JOIN public.match_checkpoints c2
              ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
           WHERE c1.room_id = r.id AND c1.user_id = r.player1_id) = 0
      THEN '⚠️ SIN DATOS'
    WHEN (SELECT MIN(c1.tick)
            FROM public.match_checkpoints c1
            JOIN public.match_checkpoints c2
              ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
           WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
             AND c1.huella <> c2.huella) IS NULL
      THEN '✅ IGUALES'
    ELSE '❌ SE SEPARARON'
  END                                                       AS veredicto,

  r.id                                                      AS sala
FROM public.game_rooms r
LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
WHERE EXISTS (SELECT 1 FROM public.match_checkpoints c WHERE c.room_id = r.id)
ORDER BY COALESCE(r.started_at, r.created_at) DESC
LIMIT 30;


-- -----------------------------------------------------------------------------
-- 2. EL NÚMERO PARA DECIDIR
--
--    Lo mismo en una sola fila, contando sólo las partidas de las últimas HORAS
--    que se indiquen. Cambia el '6 hours' por lo que haga falta: pon el rato que
--    llevas desplegado.
--
--    `separadas` tiene que ser 0. Y `con_datos` tiene que ser un número decente:
--    con dos partidas no se puede concluir nada.
-- -----------------------------------------------------------------------------
WITH ultimas AS (
  SELECT
    r.id,
    (SELECT COUNT(*)
       FROM public.match_checkpoints c1
       JOIN public.match_checkpoints c2
         ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
      WHERE c1.room_id = r.id AND c1.user_id = r.player1_id) AS comparados,
    (SELECT MIN(c1.tick)
       FROM public.match_checkpoints c1
       JOIN public.match_checkpoints c2
         ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
      WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
        AND c1.huella <> c2.huella)                          AS primer_distinto
  FROM public.game_rooms r
  WHERE COALESCE(r.started_at, r.created_at) > NOW() - INTERVAL '6 hours'
    AND EXISTS (SELECT 1 FROM public.match_checkpoints c WHERE c.room_id = r.id)
)
SELECT
  COUNT(*)                                                        AS partidas,
  COUNT(*) FILTER (WHERE comparados > 0)                           AS con_datos,
  COUNT(*) FILTER (WHERE comparados > 0 AND primer_distinto IS NULL) AS iguales,
  COUNT(*) FILTER (WHERE primer_distinto IS NOT NULL)              AS separadas,
  CASE
    WHEN COUNT(*) FILTER (WHERE comparados > 0) = 0
      THEN '⚠️ todavía no hay ninguna partida con datos que comparar'
    WHEN COUNT(*) FILTER (WHERE primer_distinto IS NOT NULL) = 0
      THEN '✅ ninguna se separó: se puede abrir'
    ELSE '❌ alguna se separó: mira la consulta 3 antes de abrir'
  END                                                              AS veredicto
FROM ultimas;


-- -----------------------------------------------------------------------------
-- 3. SI ALGUNA SE SEPARÓ: QUÉ CAMBIÓ EXACTAMENTE
--
--    Pon aquí la `sala` de la fila que salió en rojo y ejecuta esta sola. Saca
--    las dos huellas del primer tic distinto, una debajo de la otra.
--
--    Cómo se lee una huella:
--       t1800                    el tic
--       b600.000/600.000         vida de las dos bases
--       1[...] 2[...]            las plantas de cada jugador, como
--                                carta:carril:columna:vida
--
--    Y lo que hay que buscar es la diferencia MÁS PEQUEÑA:
--       · una planta con otra vida  → un disparo de más en un lado (desfase de
--                                     tics)
--       · una planta con otra vida MÁXIMA, o distinta desde el principio
--                                   → las mejoras de la carta (mazo de la sala)
--       · una planta que sólo está en un lado
--                                   → una jugada que no llegó
-- -----------------------------------------------------------------------------
-- Sustituye el identificador por el de la partida que quieras mirar:
WITH sala AS (
  SELECT * FROM public.game_rooms WHERE id = '00000000-0000-0000-0000-000000000000'
),
primer_distinto AS (
  SELECT MIN(c1.tick) AS tick
    FROM public.match_checkpoints c1
    JOIN sala s ON TRUE
    JOIN public.match_checkpoints c2
      ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = s.player2_id
   WHERE c1.room_id = s.id AND c1.user_id = s.player1_id
     AND c1.huella <> c2.huella
)
SELECT
  CASE WHEN c.user_id = s.player1_id THEN 'jugador 1' ELSE 'jugador 2' END AS quien,
  c.tick,
  c.huella
FROM public.match_checkpoints c
JOIN sala s ON s.id = c.room_id
JOIN primer_distinto d ON d.tick = c.tick
ORDER BY quien;
