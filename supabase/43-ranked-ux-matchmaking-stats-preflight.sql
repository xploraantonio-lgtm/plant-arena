-- =============================================================================
-- MIGRACIÓN 43: PREFLIGHT READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura antes de aplicar la migración 43.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 43 NO HA SIDO APLICADA
SELECT
  COUNT(*) AS fase_43_exists,
  CASE WHEN COUNT(*) = 0 THEN 'OK (No aplicada)' ELSE 'FAIL (Ya aplicada)' END AS status
FROM public._migration_audit
WHERE fase = '43_ranked_ux_matchmaking_stats_hotfix';

-- 2. VERIFICAR VALOR ACTUAL DE CONFIGURACIÓN DE GHOST TIMEOUT EN SHOP_CONFIG
SELECT
  key,
  value,
  CASE
    WHEN value::INTEGER = 30 THEN 'OK (30s configurado)'
    ELSE 'REPORTAR (Valor actual es ' || COALESCE(value, 'null') || ')'
  END AS config_status
FROM public.shop_config
WHERE key = 'mm_ranked_ghost_after_seconds';

-- 3. AUDITORÍA DEL CÓDIGO ACTUAL DE claim_ranked_async_opponent
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%v_waited < 60%' AS tiene_hardcoded_60,
  pg_get_functiondef(p.oid) LIKE '%mm_ranked_ghost_after_seconds%' AS lee_shop_config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'claim_ranked_async_opponent';

-- 4. AUDITORÍA DEL CÓDIGO ACTUAL DE _settle_room
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%is_async_match%' AS detecta_async,
  pg_get_functiondef(p.oid) LIKE '%IF v_room.player2_id IS NOT NULL%' AS tiene_guard_player2
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = '_settle_room';

-- 5. AUDITORÍA DE SALAS ASÍNCRONAS Y CONSISTENCIA DE PLAYER2_ID
SELECT
  COUNT(*) AS total_async_rooms,
  COUNT(*) FILTER (WHERE player2_id IS NOT NULL) AS async_con_player2_not_null_esperado_cero,
  COUNT(*) FILTER (WHERE player1_id IS NULL) AS async_con_player1_null_esperado_cero
FROM public.game_rooms
WHERE is_async_match = TRUE;

-- 6. AUDITORÍA DE RANKED_PLAYER_STATS (USER_ID NULOS)
SELECT
  COUNT(*) AS total_ranked_stats_rows,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS user_id_null_esperado_cero,
  COALESCE(SUM(wins), 0) AS baseline_total_wins,
  COALESCE(SUM(losses), 0) AS baseline_total_losses,
  COALESCE(SUM(draws), 0) AS baseline_total_draws
FROM public.ranked_player_stats;

-- 7. AUDITORÍA DE ELO PROFILES BASELINE
SELECT
  COUNT(*) AS total_profiles,
  COALESCE(SUM(elo_rating), 0) AS baseline_total_elo,
  COALESCE(AVG(elo_rating), 1000)::INTEGER AS baseline_avg_elo
FROM public.profiles;

-- 8. AUDITORÍA DE COFRES (PACK_SLOTS)
SELECT
  COUNT(*) AS total_pack_slots,
  COUNT(*) FILTER (WHERE status = 'unlocking') AS unlocking_slots_count,
  COUNT(*) FILTER (WHERE status = 'unlocking' AND unlock_started_at IS NULL) AS unlocking_sin_timestamp_esperado_cero
FROM public.pack_slots;
