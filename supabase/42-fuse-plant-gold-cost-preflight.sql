-- =============================================================================
-- PLANT ARENA · PREFLIGHT MIGRACIÓN 42 (READ-ONLY)
-- =============================================================================

-- 1. Metadata y definición actual de fuse_plant
SELECT 
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef,
  p.proconfig AS search_path,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
  pg_get_functiondef(p.oid) AS current_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fuse_plant';

-- 2. Estado de _migration_audit (comprobar que la fase 42 no exista aún)
SELECT 
  COUNT(*) AS audit_42_already_exists
FROM public._migration_audit
WHERE fase = '42_fuse_plant_gold_cost';

-- 3. Baselines de producción y conteos de seguridad
SELECT 
  (SELECT COUNT(*) FROM public.profiles WHERE gold_balance >= 250) AS profiles_with_gold_ge_250,
  (SELECT COUNT(*) FROM public.plant_copies WHERE copies >= 5) AS plant_copies_ge_5,
  (SELECT COUNT(*) FROM public.plant_instances WHERE level > 0) AS historical_upgraded_instances,
  (SELECT SUM(gold_balance) FROM public.profiles) AS baseline_total_gold,
  (SELECT SUM(copies) FROM public.plant_copies) AS baseline_total_copies,
  (SELECT COUNT(*) FROM public.plant_instances) AS baseline_total_instances;

-- 4. Verificación de integridad de eligible_stats en plant_catalog
SELECT 
  COUNT(*) AS total_catalog_plants,
  COUNT(*) FILTER (WHERE eligible_stats IS NOT NULL AND array_length(eligible_stats, 1) >= 1) AS valid_eligible_stats_plants
FROM public.plant_catalog;
