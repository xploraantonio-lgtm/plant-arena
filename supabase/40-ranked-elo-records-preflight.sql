-- =============================================================================
-- 40-RANKED-ELO-RECORDS-PREFLIGHT.SQL
-- =============================================================================
-- PREFLIGHT READ-ONLY DE PRODUCCIÓN PARA MIGRACIÓN 40:
-- SISTEMA ELO CANÓNICO JUGADOR-VS-RIVAL + ESTADÍSTICAS W/L AUTORITATIVAS
--
-- RESTRICCIONES:
--   - Este script es estrictamente de sólo lectura (SELECT / WITH).
--   - NO contiene INSERT, UPDATE, DELETE, ALTER, CREATE, DROP ni TRUNCATE.
--   - NO modifica esquemas, tablas, funciones ni datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AUDITORÍA DE FUNCIONES QUE MODIFICAN O LEEN ELO EN PRODUCCIÓN
-- -----------------------------------------------------------------------------
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    pg_get_functiondef(p.oid) ILIKE '%UPDATE%profiles%SET%elo_rating%'
    OR pg_get_functiondef(p.oid) ILIKE '%elo_rating%:=%'
    OR pg_get_functiondef(p.oid) ILIKE '%_elo_deltas%'
    OR pg_get_functiondef(p.oid) ILIKE '%elo_rating%'
  )
ORDER BY p.proname;

-- -----------------------------------------------------------------------------
-- 2. DESGLOSE GENERAL DE game_rooms
-- -----------------------------------------------------------------------------
SELECT 
    mode,
    engine_version,
    is_async_match,
    status,
    verification_status,
    (settled_at IS NOT NULL) AS is_settled,
    COUNT(*) AS room_count
FROM public.game_rooms
GROUP BY mode, engine_version, is_async_match, status, verification_status, (settled_at IS NOT NULL)
ORDER BY mode, is_async_match, is_settled DESC;

-- -----------------------------------------------------------------------------
-- 3. SALAS RANKED OFICIALES QUE ENTRAN EN EL BACKFILL DE W/L
-- -----------------------------------------------------------------------------
SELECT 
    id,
    mode,
    engine_version,
    is_async_match,
    player1_id,
    player2_id,
    async_opponent_id,
    status,
    server_winner_id,
    settled_at,
    verification_status,
    verification_note
FROM public.game_rooms
WHERE mode = 'ranked'
  AND settled_at IS NOT NULL
  AND verification_status = 'verified'
  AND status IN ('p1_won', 'p2_won', 'draw')
ORDER BY settled_at DESC;

-- -----------------------------------------------------------------------------
-- 4. SALAS RANKED EXCLUIDAS DEL BACKFILL DE W/L (LEGACY / FALLIDAS / PENDIENTES)
-- -----------------------------------------------------------------------------
SELECT 
    id,
    mode,
    engine_version,
    is_async_match,
    player1_id,
    player2_id,
    status,
    settled_at,
    verification_status,
    verification_note
FROM public.game_rooms
WHERE mode = 'ranked'
  AND (
    settled_at IS NULL
    OR verification_status IS NULL
    OR verification_status <> 'verified'
    OR status NOT IN ('p1_won', 'p2_won', 'draw')
  )
ORDER BY settled_at DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- 5. CÁLCULO PREVIO (DRY-RUN) DE ESTADÍSTICAS W/L QUE RESULTARÁN DEL BACKFILL
-- -----------------------------------------------------------------------------
WITH official_rooms AS (
  SELECT 
    id,
    mode,
    is_async_match,
    player1_id,
    player2_id,
    status,
    server_winner_id
  FROM public.game_rooms
  WHERE mode = 'ranked'
    AND settled_at IS NOT NULL
    AND verification_status = 'verified'
    AND status IN ('p1_won', 'p2_won', 'draw')
),
player_events AS (
  -- P1 en partidas humanas o async
  SELECT 
    player1_id AS user_id,
    CASE WHEN status = 'p1_won' THEN 1 ELSE 0 END AS win_cnt,
    CASE WHEN status = 'p2_won' THEN 1 ELSE 0 END AS loss_cnt,
    CASE WHEN status = 'draw' THEN 1 ELSE 0 END AS draw_cnt
  FROM official_rooms
  WHERE player1_id IS NOT NULL

  UNION ALL

  -- P2 sólo en partidas humanas
  SELECT 
    player2_id AS user_id,
    CASE WHEN status = 'p2_won' THEN 1 ELSE 0 END AS win_cnt,
    CASE WHEN status = 'p1_won' THEN 1 ELSE 0 END AS loss_cnt,
    CASE WHEN status = 'draw' THEN 1 ELSE 0 END AS draw_cnt
  FROM official_rooms
  WHERE is_async_match = false AND player2_id IS NOT NULL
),
aggregated_stats AS (
  SELECT 
    user_id,
    SUM(win_cnt)::BIGINT AS total_wins,
    SUM(loss_cnt)::BIGINT AS total_losses,
    SUM(draw_cnt)::BIGINT AS total_draws
  FROM player_events
  GROUP BY user_id
)
SELECT 
    p.id AS user_id,
    p.username,
    p.elo_rating,
    COALESCE(a.total_wins, 0) AS expected_wins,
    COALESCE(a.total_losses, 0) AS expected_losses,
    COALESCE(a.total_draws, 0) AS expected_draws,
    (COALESCE(a.total_wins, 0) + COALESCE(a.total_losses, 0) + COALESCE(a.total_draws, 0)) AS expected_games,
    CASE 
      WHEN (COALESCE(a.total_wins, 0) + COALESCE(a.total_losses, 0)) = 0 THEN 0.0
      ELSE ROUND((COALESCE(a.total_wins, 0)::NUMERIC * 100.0) / (COALESCE(a.total_wins, 0) + COALESCE(a.total_losses, 0))::NUMERIC, 1)
    END AS expected_win_rate
FROM public.profiles p
LEFT JOIN aggregated_stats a ON a.user_id = p.id
WHERE (COALESCE(a.total_wins, 0) + COALESCE(a.total_losses, 0) + COALESCE(a.total_draws, 0)) > 0
ORDER BY p.elo_rating DESC, expected_wins DESC;

-- -----------------------------------------------------------------------------
-- 6. AUDITORÍA DEL CATÁLOGO (TABLA ranked_player_stats Y COLUMNAS CONFLICTIVAS)
-- -----------------------------------------------------------------------------
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ranked_player_stats', 'leaderboard', 'profiles')
  AND column_name IN ('wins', 'losses', 'draws', 'ranked_wins', 'ranked_losses', 'ranked_draws', 'ranked_win_rate', 'rank_position')
ORDER BY table_name, ordinal_position;

-- -----------------------------------------------------------------------------
-- 7. DEFINICIÓN ACTUAL DE LA VISTA leaderboard
-- -----------------------------------------------------------------------------
SELECT pg_get_viewdef('public.leaderboard'::regclass, true) AS leaderboard_def;
