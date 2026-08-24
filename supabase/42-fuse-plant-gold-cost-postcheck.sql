-- =============================================================================
-- PLANT ARENA · POSTCHECK MIGRACIÓN 42
-- =============================================================================

SELECT 
  EXISTS(
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON n.oid = p.pronamespace 
    WHERE n.nspname = 'public' AND p.proname = 'fuse_plant'
  ) AS fuse_plant_exists,
  has_function_privilege('authenticated', 'public.fuse_plant(uuid)', 'EXECUTE') AS authenticated_has_execute,
  (SELECT applied_at FROM public._migration_audit WHERE migration_number = 42) AS migration_42_applied_at;
