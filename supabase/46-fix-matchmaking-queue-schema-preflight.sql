-- =============================================================================
-- MIGRACIÓN 46: PREFLIGHT READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura antes de aplicar la migración 46.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 46 NO HA SIDO APLICADA
SELECT
  COUNT(*) AS fase_46_exists,
  CASE WHEN COUNT(*) = 0 THEN 'OK (No aplicada)' ELSE 'FAIL (Ya aplicada)' END AS status
FROM public._migration_audit
WHERE fase = '46_fix_matchmaking_queue_schema';

-- 2. VERIFICAR EXISTENCIA DE LAS COLUMNAS FÍSICAS CANÓNICAS EN MATCHMAKING_QUEUE
SELECT
  COUNT(*) AS total_columnas_verificadas,
  COUNT(*) FILTER (WHERE column_name IN (
    'id', 'user_id', 'mode', 'tournament_id', 'colosseum_bet', 'user_elo',
    'room_code', 'status', 'matched_room_id', 'created_at', 'last_seen_at',
    'escrow_id', 'client_engine_version'
  )) AS columnas_requeridas_existentes_esperado_13
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'matchmaking_queue';

-- 3. CONFIRMAR AUSENCIA ESPERADA DE MATCHED_AT
SELECT
  COUNT(*) FILTER (WHERE column_name = 'matched_at') AS matched_at_exists_esperado_0
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'matchmaking_queue';

-- 4. BASELINE COMPETITIVO ANTES DE MIGRACIÓN 46
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
