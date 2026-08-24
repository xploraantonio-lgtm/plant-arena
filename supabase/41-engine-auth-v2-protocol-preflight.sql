-- =============================================================================
-- PLANT ARENA · PREFLIGHT READ-ONLY MIGRACIÓN 41
-- =============================================================================

-- 1. Estado de colas de matchmaking activas por modo
SELECT 
  mode,
  status,
  count(*) AS total_filas
FROM public.matchmaking_queue
GROUP BY mode, status
ORDER BY mode, status;

-- 2. Salas actualmente en juego ('playing') y sus versiones
SELECT 
  id,
  mode,
  status,
  engine_version,
  is_async_match,
  created_at
FROM public.game_rooms
WHERE status = 'playing'
ORDER BY created_at DESC;

-- 3. Distribución global de salas por versión de motor
SELECT 
  engine_version,
  count(*) AS total_salas
FROM public.game_rooms
GROUP BY engine_version
ORDER BY engine_version;

-- 4. Distribución del pool de Rivales Semilla
SELECT 
  source_engine_version,
  protocol_version,
  active,
  count(*) AS total_semillas
FROM public.ranked_async_opponents
GROUP BY source_engine_version, protocol_version, active
ORDER BY source_engine_version;

-- 5. Constraint actual en ranked_async_opponents
SELECT 
  conname,
  pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.ranked_async_opponents'::regclass
  AND conname LIKE '%source_engine_version%';

-- 6. Baseline numérico antes de migración (debe permanecer 100% inalterado)
SELECT 
  (SELECT count(*) FROM public.profiles) AS profiles_count,
  (SELECT sum(elo_rating) FROM public.profiles) AS profiles_elo_sum,
  (SELECT count(*) FROM public.ranked_player_stats) AS ranked_stats_count,
  (SELECT count(*) FROM public.game_rooms) AS game_rooms_count,
  (SELECT count(*) FROM public.match_actions) AS match_actions_count,
  (SELECT count(*) FROM public.ranked_async_opponents) AS seeds_count;
