-- =============================================================================
-- MIGRACIÓN 47: POSTCHECK READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura tras aplicar la migración 47.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 47 ESTÁ REGISTRADA EXACTAMENTE 1 VEZ EN EL LEDGER
SELECT
  fase,
  detalle->>'descripcion' AS descripcion,
  ejecutado_en,
  COUNT(*) AS rec_count
FROM public._migration_audit
WHERE fase = '47_update_vip_pass_rewards'
GROUP BY fase, detalle, ejecutado_en;

-- 2. VERIFICAR QUE EXISTEN EXACTAMENTE LOS 20 NIVELES ACTUALIZADOS
SELECT
  COUNT(*) AS total_niveles_esperado_20,
  COUNT(*) FILTER (WHERE reward_type = 'pack' AND pack_id = 'basic') AS sobres_basicos_count,
  COUNT(*) FILTER (WHERE reward_type = 'pack' AND pack_id = 'legendary') AS sobres_legendarios_count_esperado_0,
  COUNT(*) FILTER (WHERE reward_type = 'copies' AND copies_count = 1) AS copias_1x_count,
  COUNT(*) FILTER (WHERE reward_type = 'badge') AS badge_count_esperado_1
FROM public.battle_pass_levels;

-- 3. AUDITORÍA DETALLADA DE NIVELES MODIFICADOS
SELECT
  level,
  required_elo,
  arena_name,
  reward_type,
  pack_id,
  pack_count,
  plant_id,
  copies_count,
  label
FROM public.battle_pass_levels
ORDER BY level ASC;

-- 4. BASELINE COMPETITIVO POST-MIGRACIÓN 47 (INTACTO)
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count,
  (SELECT COALESCE(SUM(elo_rating), 0) FROM public.profiles) AS sum_elo,
  (SELECT COUNT(*) FROM public.ranked_player_stats) AS stats_rows,
  (SELECT COALESCE(SUM(wins), 0) FROM public.ranked_player_stats) AS sum_wins,
  (SELECT COALESCE(SUM(losses), 0) FROM public.ranked_player_stats) AS sum_losses,
  (SELECT COALESCE(SUM(draws), 0) FROM public.ranked_player_stats) AS sum_draws,
  (SELECT COUNT(*) FROM public.game_rooms) AS game_rooms_count,
  (SELECT COUNT(*) FROM public.pack_slots) AS total_pack_slots;
