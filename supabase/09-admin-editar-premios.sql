-- =============================================================================
-- PLANT ARENA · PERMITIR QUE EL ADMINISTRADOR EDITE PREMIOS DESDE EL PANEL
--
-- Idempotente.
--
-- lottery_sectors y battle_pass_levels se crearon sólo con política de lectura,
-- así que los premios había que cambiarlos por SQL. Aquí se abren a escritura
-- para administradores, verificado en el servidor con current_user_is_admin().
--
-- Y se añade un guardia que faltaba: si al editar los pesos de la ruleta dejan
-- de sumar 100, el sorteo queda sesgado sin que nadie lo note. Un CHECK no puede
-- mirar varias filas a la vez, así que hace falta un disparador.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ESCRITURA PARA ADMINISTRADORES
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lottery_sectors', 'battle_pass_levels']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL
        USING (public.current_user_is_admin())
        WITH CHECK (public.current_user_is_admin())
    $f$, t || '_admin_write', t);

    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. GUARDIA: LOS PESOS DE LA RULETA DEBEN SUMAR 100
--
-- Se comprueba al final de la sentencia, no fila a fila: así se puede repartir
-- el peso entre varios sectores en una sola actualización sin que salte a mitad
-- de camino. Si al terminar no suma 100, se deshace todo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._check_lottery_weights()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(weight), 0) INTO v_total
    FROM public.lottery_sectors WHERE is_active;

  IF v_total <> 100 THEN
    RAISE EXCEPTION
      'Los pesos de los sectores activos suman %, y deben sumar exactamente 100. No se guardó nada.',
      v_total;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lottery_weights ON public.lottery_sectors;
CREATE CONSTRAINT TRIGGER trg_lottery_weights
  AFTER INSERT OR UPDATE OR DELETE ON public.lottery_sectors
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._check_lottery_weights();


-- -----------------------------------------------------------------------------
-- 3. RPC PARA GUARDAR LA RULETA DE UNA VEZ
--
-- Editar sector por sector desde el cliente obligaría a que cada paso
-- intermedio sumara 100, que es imposible. Esta función recibe la tabla
-- completa y la aplica en una sola transacción: el guardia sólo se evalúa al
-- final.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_lottery_sectors(p_sectors JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_row   JSONB;
  v_total NUMERIC := 0;
  v_n     INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede editar la ruleta';
  END IF;

  IF p_sectors IS NULL OR jsonb_typeof(p_sectors) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un array de sectores';
  END IF;

  -- Validar antes de tocar nada: los pesos deben sumar 100 y los premios ser
  -- coherentes con su tipo.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_sectors)
  LOOP
    v_n := v_n + 1;
    IF (v_row->>'isActive')::BOOLEAN IS NOT FALSE THEN
      v_total := v_total + COALESCE((v_row->>'weight')::NUMERIC, 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.lottery_sectors
                    WHERE sector_id = v_row->>'sectorId') THEN
      RAISE EXCEPTION 'El sector "%" no existe', v_row->>'sectorId';
    END IF;

    IF COALESCE((v_row->>'weight')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'El sector "%" tiene un peso de 0 o negativo', v_row->>'sectorId';
    END IF;
  END LOOP;

  IF v_total <> 100 THEN
    RAISE EXCEPTION 'Los pesos suman %, deben sumar 100', v_total;
  END IF;

  -- Aplicar. Sólo se dejan cambiar el premio, el peso y si está activo: el tipo
  -- de recompensa de cada sector no se toca desde aquí para no dejar filas
  -- incoherentes (por ejemplo, tipo 'gold' sin cantidad de oro).
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


-- -----------------------------------------------------------------------------
-- 4. RPC PARA GUARDAR EL PRECIO DE UN SOBRE
--     La tienda ya lee shop_packs, así que cambiar aquí cambia lo que se muestra
--     y lo que se cobra a la vez.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_pack_price(p_pack_id TEXT, p_price NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar precios';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'El precio debe ser mayor que 0';
  END IF;

  UPDATE public.shop_packs SET price_gems = p_price WHERE pack_id = p_pack_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El sobre "%" no existe', p_pack_id; END IF;

  RETURN jsonb_build_object('success', TRUE, 'packId', p_pack_id, 'price', p_price);
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. PERMISOS
-- -----------------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('admin_save_lottery_sectors','admin_set_pack_price')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public._check_lottery_weights() FROM anon, authenticated, PUBLIC;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('admin_editar_premios', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Estado actual de la ruleta. Los pesos deben sumar 100.
SELECT sector_id, label, reward_type,
       COALESCE(gems_amount::TEXT, gold_amount::TEXT,
                pack_id || ' x' || pack_qty,
                plant_id || ' x' || plant_qty) AS premio,
       weight, is_active
  FROM public.lottery_sectors ORDER BY weight DESC;

SELECT SUM(weight) AS suma_pesos FROM public.lottery_sectors WHERE is_active;

-- 2. El guardia funciona. Esto DEBE fallar con el mensaje de los pesos:
--    (descoméntalo para probarlo, y luego deshaz con ROLLBACK)
-- BEGIN;
--   UPDATE public.lottery_sectors SET weight = 50 WHERE sector_id = 'jackpot_20';
-- COMMIT;   -- ← aquí salta el error y no se guarda nada

-- 3. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');
