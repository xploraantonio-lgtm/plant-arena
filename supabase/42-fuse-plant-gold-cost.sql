-- =============================================================================
-- PLANT ARENA · MIGRACIÓN 42
-- FUSIÓN DE CARTAS CON COSTO FIJO DE 250 ORO
-- =============================================================================
--
-- 1. Actualiza public.fuse_plant(p_instance_id UUID) para exigir atómicamente:
--      - 5 copias base de la planta (public.plant_copies)
--      - 250 de oro (public.profiles.gold_balance)
-- 2. Bloqueo en orden consistente: profiles -> plant_instances -> plant_copies.
-- 3. Validaciones fail-closed: auth, propietario, no en venta, nivel < max_level,
--    copias >= 5, oro >= 250.
-- 4. Mutación atómica dentro de la misma transacción (gold - 250, copies - 5, level + 1).
-- 5. Respuesta JSON enriquecida para el cliente.
-- 6. Registro de auditoría en public._migration_audit.
--
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fuse_plant(p_instance_id UUID)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         UUID := auth.uid();
  c_coste_oro   CONSTANT BIGINT := 250;
  c_copias_req  CONSTANT INTEGER := 5;
  v_oro         BIGINT;
  v_inst        RECORD;
  v_cat         RECORD;
  v_copies      INTEGER;
  v_stat        TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- 1. Bloqueo transaccional de profiles para validar y descontar oro
  SELECT gold_balance INTO v_oro FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  IF COALESCE(v_oro, 0) < c_coste_oro THEN
    RAISE EXCEPTION 'Oro insuficiente para mejorar: necesitas % y tienes %', c_coste_oro, COALESCE(v_oro, 0);
  END IF;

  -- 2. Bloqueo transaccional de la instancia de la carta
  SELECT * INTO v_inst FROM public.plant_instances
   WHERE id = p_instance_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No eres el propietario de esta carta'; END IF;
  IF v_inst.is_listed_for_sale THEN
    RAISE EXCEPTION 'No puedes fusionar una carta que está en venta';
  END IF;

  -- 3. Catálogo de la planta y nivel máximo
  SELECT * INTO v_cat FROM public.plant_catalog WHERE plant_id = v_inst.plant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planta desconocida: %', v_inst.plant_id; END IF;

  IF v_inst.level >= v_cat.max_level THEN
    RAISE EXCEPTION 'Esta carta ya alcanzó el nivel máximo (%)', v_cat.max_level;
  END IF;

  -- 4. Bloqueo transaccional de las copias de la planta
  SELECT copies INTO v_copies FROM public.plant_copies
   WHERE user_id = v_uid AND plant_id = v_inst.plant_id FOR UPDATE;
  v_copies := COALESCE(v_copies, 0);

  IF v_copies < c_copias_req THEN
    RAISE EXCEPTION 'Se requieren % copias base para la fusión (tienes %/%)', c_copias_req, v_copies, c_copias_req;
  END IF;

  -- 5. Selección de stat roll elegible
  v_stat := v_cat.eligible_stats[1 + floor(random() * array_length(v_cat.eligible_stats, 1))::INTEGER];

  -- 6. Mutación atómica en una sola transacción
  UPDATE public.profiles
     SET gold_balance = gold_balance - c_coste_oro
   WHERE id = v_uid;

  UPDATE public.plant_copies
     SET copies = copies - c_copias_req
   WHERE user_id = v_uid AND plant_id = v_inst.plant_id;

  UPDATE public.plant_instances
     SET level      = level + 1,
         star_level = LEAST(5, level + 2),
         stat_rolls = array_append(stat_rolls, v_stat)
   WHERE id = p_instance_id;

  -- 7. Respuesta estructurada
  RETURN jsonb_build_object(
    'success',         TRUE,
    'plantId',         v_inst.plant_id,
    'previousLevel',   v_inst.level,
    'newLevel',        v_inst.level + 1,
    'rolledStat',      v_stat,
    'copiesSpent',     c_copias_req,
    'copiesRemaining', v_copies - c_copias_req,
    'copiesLeft',      v_copies - c_copias_req,
    'goldSpent',       c_coste_oro,
    'goldBalance',     v_oro - c_coste_oro
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fuse_plant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuse_plant(UUID) TO authenticated;

-- Registro en auditoría de migraciones
INSERT INTO public._migration_audit (migration_number, name, applied_at, details)
VALUES (42, 'fuse-plant-gold-cost', NOW(), '{"fusion_cost_gold": 250, "copies_required": 5}'::jsonb)
ON CONFLICT (migration_number) DO UPDATE
SET applied_at = NOW(), details = EXCLUDED.details;
