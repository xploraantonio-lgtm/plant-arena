-- =============================================================================
-- PLANT ARENA · LA HUELLA DE LA PARTIDA, PARA SABER SI LAS DOS PANTALLAS COINCIDEN
--
-- Idempotente. Ejecutar después de la 31.
--
-- POR QUÉ HACE FALTA
--   El 1c1 es lockstep: no se manda el tablero, se mandan las jugadas y cada
--   cliente RECALCULA el tablero. Eso permite un multijugador en tiempo real sin
--   un servidor jugando la partida, y tiene un punto débil conocido: si los dos
--   cálculos se separan aunque sea un tic, los tableros dejan de coincidir y no
--   vuelven. Al final cada uno reporta un ganador distinto, la partida queda en
--   revisión y no cobra nadie.
--
--   Eso pasó, y se arreglaron cuatro causas. Lo que no había era forma de SABER
--   si vuelve a pasar: llegaba el aviso de "tu rival dijo otra cosa" al final,
--   cuando ya no se puede averiguar nada.
--
--   Ahora cada cliente resume su tablero en una cadena corta cada diez segundos y
--   la manda. Cuando dos huellas del mismo tic no coinciden, se sabe EN QUÉ TIC
--   empezaron a separarse — que es la mitad de arreglarlo.
--
-- LO QUE ESTO NO ES
--   No decide quién gana. Es un detector, no un árbitro. El árbitro es que el
--   servidor recalcule la partida entera desde el registro de jugadas, y eso es
--   otra pieza (recalcularGanador ya está escrito; le falta dónde ejecutarse).
--
--   Pero sirve para lo importante de hoy: saber, con datos y no de oídas, si el
--   1c1 está limpio antes de abrir modos con dinero.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.match_actions') IS NULL THEN
    RAISE EXCEPTION 'Falta la 19: no existe match_actions';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LAS HUELLAS
--
--    Una fila por jugador y por tic de control. Con partidas de tres minutos y
--    una huella cada diez segundos son unas 36 filas por partida.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_checkpoints (
    room_id   UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tick      INTEGER NOT NULL CHECK (tick > 0),
    /**
     * El resumen del tablero, ya normalizado al punto de vista del jugador 1 de
     * la sala. Sin normalizar, dos pantallas de acuerdo darían cadenas distintas
     * —cada jugador se ve a sí mismo a la izquierda— y todas las partidas
     * parecerían roas.
     */
    huella    TEXT NOT NULL CHECK (length(huella) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id, tick)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_sala
  ON public.match_checkpoints (room_id, tick);

ALTER TABLE public.match_checkpoints ENABLE ROW LEVEL SECURITY;

-- Sin política ni GRANT: se escribe sólo por la función de abajo y se lee sólo
-- desde el panel. Una huella dice dónde está cada planta de los dos jugadores; no
-- es información que deba poder leer el rival a mitad de partida.
REVOKE ALL ON public.match_checkpoints FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. MANDAR UNA HUELLA
--
--    Barata a propósito: es un INSERT y nada más. Se llama cada diez segundos por
--    jugador, así que no puede hacer trabajo de más.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_checkpoint(
  p_room_id UUID,
  p_tick    INTEGER,
  p_huella  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_sala RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_tick IS NULL OR p_tick <= 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'tic_invalido');
  END IF;
  IF p_huella IS NULL OR length(p_huella) > 4000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'huella_invalida');
  END IF;

  SELECT * INTO v_sala FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_uid NOT IN (v_sala.player1_id, v_sala.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  -- Repetir la misma huella (un reintento de red) no es error y no duplica.
  INSERT INTO public.match_checkpoints (room_id, user_id, tick, huella)
  VALUES (p_room_id, v_uid, p_tick, p_huella)
  ON CONFLICT (room_id, user_id, tick) DO NOTHING;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_checkpoint(UUID, INTEGER, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_checkpoint(UUID, INTEGER, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. ¿SE SEPARARON, Y DÓNDE?
--
--    Compara las huellas del mismo tic y devuelve el PRIMER tic en que las dos
--    pantallas dejaron de coincidir. Sólo mira los tics en que hay huella de los
--    dos: si uno no la mandó (se le cayó la conexión), no es divergencia, es que
--    falta el dato.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_divergence(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sala   RECORD;
  v_tic    INTEGER;
  v_pares  INTEGER;
  v_h1     TEXT;
  v_h2     TEXT;
BEGIN
  SELECT * INTO v_sala FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  -- Sólo los dos jugadores o un administrador: una huella dice dónde tiene cada
  -- uno sus plantas.
  IF auth.uid() NOT IN (v_sala.player1_id, v_sala.player2_id)
     AND NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  SELECT MIN(c1.tick), COUNT(*)
    INTO v_tic, v_pares
    FROM public.match_checkpoints c1
    JOIN public.match_checkpoints c2
      ON c2.room_id = c1.room_id AND c2.tick = c1.tick
     AND c2.user_id = v_sala.player2_id
   WHERE c1.room_id = p_room_id
     AND c1.user_id = v_sala.player1_id;

  -- El MIN de arriba cuenta los pares; el primer tic DISTINTO va aparte.
  SELECT MIN(c1.tick) INTO v_tic
    FROM public.match_checkpoints c1
    JOIN public.match_checkpoints c2
      ON c2.room_id = c1.room_id AND c2.tick = c1.tick
     AND c2.user_id = v_sala.player2_id
   WHERE c1.room_id = p_room_id
     AND c1.user_id = v_sala.player1_id
     AND c1.huella <> c2.huella;

  IF v_tic IS NOT NULL THEN
    SELECT huella INTO v_h1 FROM public.match_checkpoints
     WHERE room_id = p_room_id AND user_id = v_sala.player1_id AND tick = v_tic;
    SELECT huella INTO v_h2 FROM public.match_checkpoints
     WHERE room_id = p_room_id AND user_id = v_sala.player2_id AND tick = v_tic;
  END IF;

  RETURN jsonb_build_object(
    -- Cuántos tics se pudieron comparar. Con cero, esta partida no dice nada:
    -- puede que uno de los dos no mandara ninguna huella.
    'comparados', COALESCE(v_pares, 0),
    'divergio',   v_tic IS NOT NULL,
    'primerTic',  v_tic,
    -- Los dos resúmenes del tic en que se separaron, para poder ver QUÉ cambió.
    'huellaP1',   v_h1,
    'huellaP2',   v_h2
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_divergence(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.match_divergence(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. EL RESUMEN PARA EL PANEL
--
--    La pregunta que hay que poder contestar con datos antes de abrir el coliseo:
--    ¿de las últimas partidas, cuántas se separaron?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_divergencias(p_limite INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_filas JSONB;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo administradores';
  END IF;

  SELECT COALESCE(jsonb_agg(fila ORDER BY (fila->>'jugadaEn') DESC), '[]'::JSONB)
    INTO v_filas
    FROM (
      SELECT jsonb_build_object(
               'roomId',   r.id,
               'mode',     r.mode,
               'jugadaEn', COALESCE(r.started_at, r.created_at),
               'estado',   r.status,
               'jugadores', COALESCE(p1.username, '?') || ' vs ' || COALESCE(p2.username, '?'),
               'comparados', (
                 SELECT COUNT(*) FROM public.match_checkpoints c1
                  JOIN public.match_checkpoints c2
                    ON c2.room_id = c1.room_id AND c2.tick = c1.tick
                   AND c2.user_id = r.player2_id
                  WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
               ),
               'primerTicDistinto', (
                 SELECT MIN(c1.tick) FROM public.match_checkpoints c1
                  JOIN public.match_checkpoints c2
                    ON c2.room_id = c1.room_id AND c2.tick = c1.tick
                   AND c2.user_id = r.player2_id
                  WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
                    AND c1.huella <> c2.huella
               )
             ) AS fila
        FROM public.game_rooms r
        LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
        LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
       WHERE EXISTS (SELECT 1 FROM public.match_checkpoints c WHERE c.room_id = r.id)
       ORDER BY COALESCE(r.started_at, r.created_at) DESC
       LIMIT GREATEST(1, LEAST(200, COALESCE(p_limite, 50)))
    ) AS sub;

  RETURN jsonb_build_object(
    'partidas', v_filas,
    'resumen', jsonb_build_object(
      'conDatos',   (SELECT COUNT(*) FROM jsonb_array_elements(v_filas) x
                      WHERE (x->>'comparados')::INTEGER > 0),
      'divergentes', (SELECT COUNT(*) FROM jsonb_array_elements(v_filas) x
                       WHERE x->>'primerTicDistinto' IS NOT NULL)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_divergencias(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_divergencias(INTEGER) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('huellas_de_partida', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. La tabla existe y está cerrada al cliente. La segunda debe salir VACÍA.
SELECT COUNT(*) AS huellas FROM public.match_checkpoints;

SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'match_checkpoints'
   AND grantee IN ('anon', 'authenticated');

-- 2. De las partidas con datos, cuántas se separaron. Es LA pregunta.
SELECT r.id,
       COALESCE(p1.username, '?') || ' vs ' || COALESCE(p2.username, '?') AS jugadores,
       (SELECT COUNT(*) FROM public.match_checkpoints c1
         JOIN public.match_checkpoints c2
           ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
         WHERE c1.room_id = r.id AND c1.user_id = r.player1_id) AS tics_comparados,
       (SELECT MIN(c1.tick) FROM public.match_checkpoints c1
         JOIN public.match_checkpoints c2
           ON c2.room_id = c1.room_id AND c2.tick = c1.tick AND c2.user_id = r.player2_id
         WHERE c1.room_id = r.id AND c1.user_id = r.player1_id
           AND c1.huella <> c2.huella) AS primer_tic_distinto
  FROM public.game_rooms r
  LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
  LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
 WHERE EXISTS (SELECT 1 FROM public.match_checkpoints c WHERE c.room_id = r.id)
 ORDER BY COALESCE(r.started_at, r.created_at) DESC
 LIMIT 20;
-- primer_tic_distinto en NULL = las dos pantallas coincidieron siempre.
