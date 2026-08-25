-- =============================================================================
-- MIGRACIÓN 44: PREFLIGHT READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura antes de aplicar la migración 44.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 44 NO HA SIDO APLICADA
SELECT
  COUNT(*) AS fase_44_exists,
  CASE WHEN COUNT(*) = 0 THEN 'OK (No aplicada)' ELSE 'FAIL (Ya aplicada)' END AS status
FROM public._migration_audit
WHERE fase = '44_ranked_async_opponent_usage_metadata';

-- 2. VERIFICAR EXISTENCIA DE TABLA Y ESTADO DE COLUMNAS USAGE_COUNT Y LAST_USED_AT
SELECT
  'ranked_async_opponents' AS table_name,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ranked_async_opponents') AS tabla_existe,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ranked_async_opponents' AND column_name = 'usage_count') AS usage_count_existe,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ranked_async_opponents' AND column_name = 'last_used_at') AS last_used_at_existe;

-- 3. AUDITORÍA DEL POOL DE SEMILLAS ACTUALES (TOTAL, ACTIVAS, VERSIONES)
SELECT
  COUNT(*) AS total_seeds,
  COUNT(*) FILTER (WHERE active = TRUE) AS active_seeds,
  COUNT(*) FILTER (WHERE active = FALSE) AS inactive_seeds,
  COUNT(DISTINCT source_engine_version) AS distinct_engine_versions,
  COUNT(DISTINCT protocol_version) AS distinct_protocol_versions
FROM public.ranked_async_opponents;

-- 4. DISTRIBUCIÓN DE VERSIONES DE MOTOR Y PROTOCOLO
SELECT
  source_engine_version,
  protocol_version,
  active,
  COUNT(*) AS seed_count
FROM public.ranked_async_opponents
GROUP BY source_engine_version, protocol_version, active
ORDER BY source_engine_version, protocol_version, active;

-- 5. VERIFICACIÓN DE DUPLICADOS EN (source_room_id, source_side)
SELECT
  source_room_id,
  source_side,
  COUNT(*) AS duplicate_count
FROM public.ranked_async_opponents
GROUP BY source_room_id, source_side
HAVING COUNT(*) > 1;

-- 6. VERIFICACIÓN DE SNAPSHOTS DE MAZO Y ACCIONES NULOS O INVÁLIDOS
SELECT
  COUNT(*) FILTER (WHERE deck_snapshot IS NULL OR jsonb_typeof(deck_snapshot) <> 'array') AS invalid_deck_snapshots,
  COUNT(*) FILTER (WHERE actions_snapshot IS NULL OR jsonb_typeof(actions_snapshot) <> 'array') AS invalid_actions_snapshots,
  COUNT(*) FILTER (WHERE rating_snapshot IS NULL OR rating_snapshot < 0) AS invalid_rating_snapshots
FROM public.ranked_async_opponents;

-- 7. BASELINE COMPETITIVO ANTES DE MIGRACIÓN 44
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count,
  (SELECT COALESCE(SUM(elo_rating), 0) FROM public.profiles) AS sum_elo,
  (SELECT COUNT(*) FROM public.ranked_player_stats) AS stats_rows,
  (SELECT COALESCE(SUM(wins), 0) FROM public.ranked_player_stats) AS sum_wins,
  (SELECT COALESCE(SUM(losses), 0) FROM public.ranked_player_stats) AS sum_losses,
  (SELECT COALESCE(SUM(draws), 0) FROM public.ranked_player_stats) AS sum_draws,
  (SELECT COUNT(*) FROM public.game_rooms) AS game_rooms_count,
  (SELECT COUNT(*) FROM public.game_rooms WHERE is_async_match = TRUE) AS async_rooms_count,
  (SELECT COUNT(*) FROM public.ranked_async_opponents) AS seeds_count,
  (SELECT COUNT(*) FROM public.ranked_async_room_plans) AS plans_count,
  (SELECT COUNT(*) FROM public.pack_slots) AS total_pack_slots,
  (SELECT COUNT(*) FROM public.pack_slots WHERE status = 'unlocking') AS unlocking_pack_slots_count;
