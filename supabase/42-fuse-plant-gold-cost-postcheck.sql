-- =============================================================================
-- PLANT ARENA · POSTCHECK MIGRACIÓN 42 (READ-ONLY)
-- =============================================================================

-- 1. Verificación de definición instalada y privilegios de ejecución
SELECT 
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef,
  p.proconfig AS search_path,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
  (pg_get_functiondef(p.oid) LIKE '%c_coste_oro%CONSTANT%250%') AS contains_cost_250_guard
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fuse_plant';

-- 2. Verificación de registro canónico en _migration_audit (exactamente 1 registro)
SELECT 
  id,
  fase,
  detalle,
  ejecutado_en
FROM public._migration_audit
WHERE fase = '42_fuse_plant_gold_cost';

-- 3. Verificación de integridad post-migración (comparación contra baselines)
-- La migración sólo modifica la función; las sumas deben ser 100% idénticas al baseline previo
SELECT 
  (SELECT SUM(gold_balance) FROM public.profiles) AS current_total_gold,
  (SELECT SUM(copies) FROM public.plant_copies) AS current_total_copies,
  (SELECT COUNT(*) FROM public.plant_instances) AS current_total_instances,
  (SELECT COUNT(*) FROM public.plant_instances WHERE level > 0) AS current_upgraded_instances;
