-- =============================================================================
-- MIGRACIÓN 45: POSTCHECK READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura tras aplicar la migración 45.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 45 ESTÁ REGISTRADA EN EL LEDGER
SELECT
  fase,
  detalle->>'descripcion' AS descripcion,
  ejecutado_en,
  COUNT(*) AS rec_count
FROM public._migration_audit
WHERE fase = '45_fix_claim_async_game_rooms_schema'
GROUP BY fase, detalle, ejecutado_en;

-- 2. VERIFICAR DEFINICIÓN DE CLAIM_RANKED_ASYNC_OPPONENT EN PG_PROC
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%async_display_name%' AS tiene_async_display_name,
  pg_get_functiondef(p.oid) LIKE '%async_avatar_id%' AS tiene_async_avatar_id,
  pg_get_functiondef(p.oid) LIKE '%''playing''%' AS tiene_status_playing,
  pg_get_functiondef(p.oid) NOT LIKE '%p1_name%' AS sin_p1_name,
  pg_get_functiondef(p.oid) NOT LIKE '%p2_name%' AS sin_p2_name,
  pg_get_functiondef(p.oid) NOT LIKE '%p1_avatar%' AS sin_p1_avatar,
  pg_get_functiondef(p.oid) NOT LIKE '%p2_avatar%' AS sin_p2_avatar
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'claim_ranked_async_opponent';

-- 3. BASELINE COMPETITIVO POST-MIGRACIÓN 45
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
