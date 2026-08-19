-- =============================================================================
-- PLANT ARENA · admin_save_lottery_sectors VALIDA EL RESULTADO, NO EL ENVÍO
--
-- Idempotente. Ejecutar después de la 09.
--
-- EL PROBLEMA
--   La versión anterior sumaba los pesos de los sectores QUE LLEGAN en la
--   petición. Si el panel enviara sólo algunos, el envío podría sumar 100
--   mientras la tabla queda descuadrada.
--
--   No era un agujero: el disparador trg_lottery_weights lo detectaba al
--   confirmar y deshacía todo. Pero el error salía por el disparador, con un
--   mensaje que no dice qué sector falta, así que resultaba confuso.
--
-- LA CORRECCIÓN
--   Se calcula la suma que QUEDARÁ en la tabla: el peso nuevo para los sectores
--   enviados, y el peso actual para los que no vienen. Si eso no da 100, se
--   rechaza antes de escribir nada y el mensaje dice exactamente qué pasa.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_save_lottery_sectors(p_sectors JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_row       JSONB;
  v_total     NUMERIC := 0;
  v_n         INTEGER := 0;
  v_faltan    TEXT[];
  v_id        TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede editar la ruleta';
  END IF;

  IF p_sectors IS NULL OR jsonb_typeof(p_sectors) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un array de sectores';
  END IF;

  -- Validar cada sector enviado por separado.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_sectors)
  LOOP
    v_n  := v_n + 1;
    v_id := v_row->>'sectorId';

    IF v_id IS NULL OR btrim(v_id) = '' THEN
      RAISE EXCEPTION 'Hay un sector sin identificador en la petición';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.lottery_sectors WHERE sector_id = v_id) THEN
      RAISE EXCEPTION 'El sector "%" no existe', v_id;
    END IF;

    IF COALESCE((v_row->>'weight')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'El sector "%" tiene un peso de 0 o negativo. Si quieres quitarlo del sorteo, desactívalo en lugar de ponerle peso 0.', v_id;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'No se envió ningún sector';
  END IF;

  -- Suma que QUEDARÁ en la tabla: peso nuevo para los enviados, peso actual
  -- para los que no vienen. Es lo que antes no se comprobaba.
  SELECT COALESCE(SUM(peso), 0) INTO v_total
    FROM (
      SELECT
        COALESCE((env.j->>'weight')::NUMERIC, s.weight)                    AS peso,
        COALESCE((env.j->>'isActive')::BOOLEAN, s.is_active)               AS activo
      FROM public.lottery_sectors s
      LEFT JOIN (
        SELECT (j->>'sectorId') AS sid, j
          FROM jsonb_array_elements(p_sectors) AS j
      ) env ON env.sid = s.sector_id
    ) z
   WHERE z.activo;

  IF v_total <> 100 THEN
    -- Listar los sectores activos que NO venían en la petición, que es la causa
    -- habitual de que el resultado no cuadre.
    SELECT array_agg(s.sector_id) INTO v_faltan
      FROM public.lottery_sectors s
     WHERE s.is_active
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sectors) AS j
          WHERE (j->>'sectorId') = s.sector_id
       );

    RAISE EXCEPTION
      'Los pesos activos quedarían en % y deben sumar exactamente 100.%',
      v_total,
      CASE WHEN v_faltan IS NOT NULL
           THEN ' No enviaste estos sectores activos: ' || array_to_string(v_faltan, ', ') || '.'
           ELSE '' END;
  END IF;

  -- Aplicar. Sólo peso, activación y la cantidad del premio según su tipo: el
  -- tipo de recompensa no se cambia desde aquí para no dejar filas incoherentes
  -- (por ejemplo, tipo 'gold' sin cantidad de oro).
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_sectors)
  LOOP
    UPDATE public.lottery_sectors s
       SET weight      = (v_row->>'weight')::NUMERIC,
           is_active   = COALESCE((v_row->>'isActive')::BOOLEAN, TRUE),
           gems_amount = CASE WHEN s.reward_type = 'gems'
                              THEN COALESCE((v_row->>'gemsAmount')::NUMERIC, s.gems_amount)
                              ELSE s.gems_amount END,
           gold_amount = CASE WHEN s.reward_type = 'gold'
                              THEN COALESCE((v_row->>'goldAmount')::BIGINT, s.gold_amount)
                              ELSE s.gold_amount END,
           pack_qty    = CASE WHEN s.reward_type = 'pack'
                              THEN COALESCE((v_row->>'packQty')::INTEGER, s.pack_qty)
                              ELSE s.pack_qty END,
           plant_qty   = CASE WHEN s.reward_type = 'plant'
                              THEN COALESCE((v_row->>'plantQty')::INTEGER, s.plant_qty)
                              ELSE s.plant_qty END
     WHERE s.sector_id = v_row->>'sectorId';
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'sectors', v_n, 'weightTotal', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_save_lottery_sectors(JSONB) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_save_lottery_sectors(JSONB) TO authenticated;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fix_validacion_ruleta', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Estado actual. La suma de los activos debe ser 100.
SELECT sector_id, reward_type, weight, is_active
  FROM public.lottery_sectors ORDER BY is_active DESC, weight DESC;

SELECT SUM(weight) AS suma_activos
  FROM public.lottery_sectors WHERE is_active;

-- 2. Envío incompleto: ahora falla con un mensaje que dice qué falta, en lugar
--    de dejarlo al disparador. Debe dar error nombrando los sectores ausentes.
--    (Ejecútalo desde la app como administrador; aquí dará 'No autenticado'.)
