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
    ELSE 'REPORTAR (Valor actual es ' || COALESCE(value::TEXT, 'null') || ')'
  END AS config_status
FROM public.shop_config
WHERE key = 'mm_ranked_ghost_after_seconds';

-- 3. AUDITORÍA DEL CÓDIGO ACTUAL DE MATCHMAKING (claim y poll)
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%v_waited < 60%' AS tiene_hardcoded_60,
  pg_get_functiondef(p.oid) LIKE '%mm_ranked_ghost_after_seconds%' AS lee_shop_config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname IN ('claim_ranked_async_opponent', 'poll_matchmaking');

-- 4. AUDITORÍA DEL CÓDIGO ACTUAL DE SETTLEMENT (_settle_room, settle_verified_async, settle_draw)
SELECT
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%is_async_match%' AS detecta_async,
  pg_get_functiondef(p.oid) LIKE '%IF v_room.player2_id IS NOT NULL%' AS tiene_guard_player2,
  pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)%VALUES (v_room.player2_id%' AS puede_insertar_p2_null
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname IN ('_settle_room', 'settle_verified_async_ranked_match', 'settle_verified_draw');

-- 5. AUDITORÍA DE INTEGRIDAD DE SALAS ASÍNCRONAS
SELECT
  COUNT(*) AS total_async_rooms,
  COUNT(*) FILTER (WHERE player2_id IS NOT NULL) AS async_con_player2_not_null,
  COUNT(*) FILTER (WHERE player2_id IS NULL) AS async_con_player2_null,
  COUNT(*) FILTER (WHERE player1_id IS NULL) AS async_con_player1_null,
  COUNT(*) FILTER (WHERE verification_status = 'verified') AS async_rooms_verificadas,
  COUNT(*) FILTER (WHERE settled_at IS NOT NULL) AS async_rooms_liquidadas
FROM public.game_rooms
WHERE is_async_match = TRUE;

-- 6. AUDITORÍA DE INTEGRIDAD DE RANKED_PLAYER_STATS
SELECT
  COUNT(*) AS total_ranked_stats_rows,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS user_id_null,
  COUNT(*) FILTER (WHERE wins < 0) AS wins_negativos,
  COUNT(*) FILTER (WHERE losses < 0) AS losses_negativos,
  COUNT(*) FILTER (WHERE draws < 0) AS draws_negativos,
  COALESCE(SUM(wins), 0) AS total_wins,
  COALESCE(SUM(losses), 0) AS total_losses,
  COALESCE(SUM(draws), 0) AS total_draws
FROM public.ranked_player_stats;

-- 7. BASELINE COMPETITIVO ANTES DE MIGRACIÓN 43
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count,
  (SELECT COALESCE(SUM(elo_rating), 0) FROM public.profiles) AS sum_elo,
  (SELECT MIN(elo_rating) FROM public.profiles) AS min_elo,
  (SELECT MAX(elo_rating) FROM public.profiles) AS max_elo,
  (SELECT COUNT(*) FROM public.game_rooms) AS total_game_rooms,
  (SELECT COUNT(*) FROM public.game_rooms WHERE mode = 'ranked') AS ranked_rooms_count,
  (SELECT COUNT(*) FROM public.game_rooms WHERE is_async_match = TRUE) AS async_rooms_count,
  (SELECT COUNT(*) FROM public.ranked_async_opponents) AS ranked_async_opponents_count,
  (SELECT COUNT(*) FROM public.ranked_async_room_plans) AS ranked_async_room_plans_count;

-- 8. AUDITORÍA DE SOBRES EN CURSO (PACK_SLOTS)
SELECT
  COUNT(*) AS total_pack_slots,
  COUNT(*) FILTER (WHERE status = 'unlocking') AS unlocking_slots_count,
  COUNT(*) FILTER (WHERE status = 'unlocking' AND unlock_started_at IS NULL) AS unlocking_sin_timestamp,
  MIN(unlock_started_at) FILTER (WHERE status = 'unlocking') AS min_unlock_started_at,
  MAX(unlock_started_at) FILTER (WHERE status = 'unlocking') AS max_unlock_started_at
FROM public.pack_slots;

-- 9. PERMISOS Y FIRMAS DE FUNCIONES
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  p.prosecdef AS security_definer,
  n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_ranked_async_opponent',
    '_settle_room',
    'settle_verified_async_ranked_match',
    'settle_verified_draw',
    'poll_matchmaking'
  )
ORDER BY p.proname;
