-- =============================================================================
-- PLANT ARENA · PREFLIGHT MIGRACIÓN 42
-- =============================================================================

SELECT 
  (SELECT COUNT(*) FROM public.plant_instances) AS total_instances,
  (SELECT COUNT(*) FROM public.plant_copies WHERE copies >= 5) AS fusion_ready_copies,
  (SELECT COUNT(*) FROM public.profiles WHERE gold_balance >= 250) AS fusion_ready_gold_profiles,
  EXISTS(
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON n.oid = p.pronamespace 
    WHERE n.nspname = 'public' AND p.proname = 'fuse_plant'
  ) AS fuse_plant_exists;
