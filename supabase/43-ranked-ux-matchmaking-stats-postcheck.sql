-- =============================================================================
-- MIGRACIÓN 43: POSTCHECK VERIFICATION SCRIPT
-- =============================================================================
-- PROPÓSITO:
-- Verificar la correcta instalación y funcionamiento de la Migración 43.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 43 ESTÁ REGISTRADA EXACTAMENTE UNA VEZ
SELECT
  fase,
  detalle->>'descripcion' AS descripcion,
  ejecutado_en AS audit_timestamp,
  CASE WHEN COUNT(*) = 1 THEN 'OK (Registrada)' ELSE 'FAIL (Fase no encontrada o duplicada)' END AS audit_status
FROM public._migration_audit
WHERE fase = '43_ranked_ux_matchmaking_stats_hotfix'
GROUP BY fase, detalle, ejecutado_en;

-- 2. VERIFICAR VALOR DE CONFIGURACIÓN CANÓNICA DE GHOST EN SHOP_CONFIG
SELECT
  key,
  value,
  CASE WHEN value::INTEGER = 30 THEN 'OK (30s exacto)' ELSE 'FAIL (Valor inesperado)' END AS config_status
FROM public.shop_config
WHERE key = 'mm_ranked_ghost_after_seconds';

-- 3. AUDITORÍA DEL CÓDIGO DE claim_ranked_async_opponent
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%mm_ranked_ghost_after_seconds%' AS lee_shop_config_esperado_true,
  pg_get_functiondef(p.oid) NOT LIKE '%v_waited < 60%' AS sin_hardcoded_60_esperado_true
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'claim_ranked_async_opponent';

-- 4. AUDITORÍA DEL CÓDIGO DE _settle_room
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%ASYNC_SETTLEMENT_REQUIRED%' AS fail_closed_async_esperado_true,
  pg_get_functiondef(p.oid) LIKE '%IF v_room.player2_id IS NOT NULL%' AS guard_player2_stats_esperado_true,
  pg_get_functiondef(p.oid) NOT LIKE '%CASE WHEN p_winner_id = player1_id THEN 1 ELSE 2 END%' AS sin_inferencia_peligrosa_esperado_true
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = '_settle_room';

-- 5. AUDITORÍA DEL CÓDIGO DE settle_verified_draw
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%ASYNC_SETTLEMENT_REQUIRED%' AS fail_closed_async_esperado_true,
  pg_get_functiondef(p.oid) LIKE '%IF v_room.player1_id IS NOT NULL AND v_room.player2_id IS NOT NULL%' AS guard_draw_stats_esperado_true
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'settle_verified_draw';

-- 6. VERIFICAR QUE NO EXISTEN USER_ID NULOS EN RANKED_PLAYER_STATS
SELECT
  COUNT(*) AS total_ranked_stats_rows,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS user_id_nulos_esperado_cero
FROM public.ranked_player_stats;

-- 7. VERIFICAR BASELINE DE ELO Y STATS INTACTO
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS total_profiles,
  (SELECT COALESCE(SUM(elo_rating), 0) FROM public.profiles) AS total_elo,
  (SELECT COALESCE(SUM(wins), 0) FROM public.ranked_player_stats) AS total_wins,
  (SELECT COALESCE(SUM(losses), 0) FROM public.ranked_player_stats) AS total_losses,
  (SELECT COALESCE(SUM(draws), 0) FROM public.ranked_player_stats) AS total_draws;

-- 8. VERIFICAR COFRES (PACK_SLOTS) INTACTOS
SELECT
  COUNT(*) AS total_pack_slots,
  COUNT(*) FILTER (WHERE status = 'unlocking' AND unlock_started_at IS NULL) AS unlocking_sin_timestamp_esperado_cero
FROM public.pack_slots;
