-- =============================================================================
-- PLANT ARENA · POSTCHECK READ-ONLY MIGRACIÓN 41
-- =============================================================================

-- 1. Verificar existencia de client_engine_version en matchmaking_queue
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'matchmaking_queue'
  AND column_name = 'client_engine_version';

-- 2. Verificar constraints de versión de motor
SELECT 
  conname,
  relname AS table_name,
  pg_get_constraintdef(c.oid) AS definicion
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
WHERE r.relname IN ('matchmaking_queue', 'ranked_async_opponents')
  AND (
    conname LIKE '%engine_version%'
    OR pg_get_constraintdef(c.oid) LIKE '%engine_version%'
  );

-- 3. Verificar default de game_rooms.engine_version
SELECT 
  column_name,
  column_default
FROM information_schema.columns
WHERE table_name = 'game_rooms'
  AND column_name = 'engine_version';

-- 4. Verificar permisos en matchmaking_queue (authenticated sólo SELECT, 0 INSERT/UPDATE/DELETE)
SELECT 
  grantee, 
  privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'matchmaking_queue'
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY grantee, privilege_type;

-- 5. Verificar RLS policies en matchmaking_queue
SELECT 
  polname AS policy_name,
  polcmd AS command,
  polroles::text AS roles
FROM pg_policy
WHERE polrelid = 'public.matchmaking_queue'::regclass;

-- 6. Verificar registro en _migration_audit
SELECT 
  id,
  fase,
  detalle,
  ejecutado_en
FROM public._migration_audit
WHERE fase = '41_engine_auth_v2_protocol'
ORDER BY ejecutado_en DESC
LIMIT 1;

-- 7. Verificar 0 salas con versión desconocida
SELECT 
  count(*) AS total_salas_desconocidas
FROM public.game_rooms
WHERE engine_version NOT IN ('legacy-v1', 'auth-v1', 'auth-v2');

-- 8. Verificar 0 semillas con source version inválida
SELECT 
  count(*) AS total_semillas_invalidas
FROM public.ranked_async_opponents
WHERE source_engine_version NOT IN ('auth-v1', 'auth-v2');

-- 9. Verificar integridad absoluta de baseline histórico (0 alteraciones en ELO/W/L)
SELECT 
  (SELECT count(*) FROM public.profiles) AS profiles_count,
  (SELECT sum(elo_rating) FROM public.profiles) AS profiles_elo_sum,
  (SELECT count(*) FROM public.ranked_player_stats) AS ranked_stats_count,
  (SELECT count(*) FROM public.game_rooms) AS game_rooms_count,
  (SELECT count(*) FROM public.match_actions) AS match_actions_count,
  (SELECT count(*) FROM public.ranked_async_opponents) AS seeds_count;
