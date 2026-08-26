-- =============================================================================
-- MIGRACIÓN 47: PREFLIGHT READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura antes de aplicar la migración 47.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 47 NO HA SIDO APLICADA
SELECT
  COUNT(*) AS fase_47_exists,
  CASE WHEN COUNT(*) = 0 THEN 'OK (No aplicada)' ELSE 'FAIL (Ya aplicada)' END AS status
FROM public._migration_audit
WHERE fase = '47_update_vip_pass_rewards';

-- 2. VERIFICAR EXISTENCIA Y RECUENTO DE NIVELES ACTUALES DE BATTLE_PASS_LEVELS
SELECT
  COUNT(*) AS total_niveles_actuales,
  COUNT(*) FILTER (WHERE reward_type = 'pack') AS sobres_count,
  COUNT(*) FILTER (WHERE reward_type = 'copies') AS copias_count,
  COUNT(*) FILTER (WHERE reward_type = 'badge') AS badge_count
FROM public.battle_pass_levels;

-- 3. BASELINE COMPETITIVO ANTES DE MIGRACIÓN 47
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count,
  (SELECT COALESCE(SUM(elo_rating), 0) FROM public.profiles) AS sum_elo,
  (SELECT COUNT(*) FROM public.ranked_player_stats) AS stats_rows,
  (SELECT COALESCE(SUM(wins), 0) FROM public.ranked_player_stats) AS sum_wins,
  (SELECT COALESCE(SUM(losses), 0) FROM public.ranked_player_stats) AS sum_losses,
  (SELECT COALESCE(SUM(draws), 0) FROM public.ranked_player_stats) AS sum_draws,
  (SELECT COUNT(*) FROM public.game_rooms) AS game_rooms_count,
  (SELECT COUNT(*) FROM public.pack_slots) AS total_pack_slots;
