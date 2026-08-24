-- =============================================================================
-- 40-RANKED-ELO-RECORDS-POSTCHECK.SQL
-- =============================================================================
-- POSTCHECK DE VALIDACIÓN PARA MIGRACIÓN 40
--
-- RESTRICCIONES:
--   - Este script es estrictamente de sólo lectura (SELECT / WITH).
--   - NO contiene INSERT, UPDATE, DELETE, ALTER, CREATE, DROP ni TRUNCATE.
--   - NO modifica esquemas, tablas, funciones ni datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VERIFICAR PRESENCIA DE LA FUNCIÓN _ranked_elo_delta Y SUS CÁLCULOS BASE
-- -----------------------------------------------------------------------------
SELECT 
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS args,
    public._ranked_elo_delta(1000, 1000, 1.0) AS win_equal,
    public._ranked_elo_delta(1000, 1000, 0.0) AS loss_equal,
    public._ranked_elo_delta(1000, 1000, 0.5) AS draw_equal,
    public._ranked_elo_delta(900, 1100, 1.0)  AS underdog_win,
    public._ranked_elo_delta(1100, 900, 1.0)  AS favorite_win,
    public._ranked_elo_delta(900, 1100, 0.0)  AS underdog_loss,
    public._ranked_elo_delta(1100, 900, 0.0)  AS favorite_loss
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '_ranked_elo_delta';

-- -----------------------------------------------------------------------------
-- 2. VERIFICAR PERMISOS DE _ranked_elo_delta (REVOCADO DE anon Y authenticated)
-- -----------------------------------------------------------------------------
SELECT 
    grantee,
    privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = '_ranked_elo_delta';

-- -----------------------------------------------------------------------------
-- 3. VERIFICAR ESTRUCTURA Y RLS DE ranked_player_stats
-- -----------------------------------------------------------------------------
SELECT 
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'ranked_player_stats';

-- -----------------------------------------------------------------------------
-- 4. VERIFICAR POLÍTICAS RLS EN ranked_player_stats
-- -----------------------------------------------------------------------------
SELECT 
    policyname,
    cmd,
    roles,
    qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ranked_player_stats';

-- -----------------------------------------------------------------------------
-- 5. VERIFICAR QUE NO EXISTAN ESTADÍSTICAS NEGATIVAS NI INCONSISTENTES
-- -----------------------------------------------------------------------------
SELECT 
    user_id,
    wins,
    losses,
    draws,
    updated_at
FROM public.ranked_player_stats
WHERE wins < 0 OR losses < 0 OR draws < 0;

-- -----------------------------------------------------------------------------
-- 6. VERIFICAR ESTADÍSTICAS GLOBALES DEL BACKFILL
-- -----------------------------------------------------------------------------
SELECT 
    COUNT(*) AS total_stats_rows,
    SUM(wins) AS total_wins,
    SUM(losses) AS total_losses,
    SUM(draws) AS total_draws,
    COUNT(*) FILTER (WHERE wins > 0 OR losses > 0 OR draws > 0) AS users_with_activity
FROM public.ranked_player_stats;

-- -----------------------------------------------------------------------------
-- 7. VERIFICAR LA VISTA leaderboard Y SU ORDEN DETERMINISTA
-- -----------------------------------------------------------------------------
SELECT 
    rank_position,
    id,
    username,
    elo_rating,
    ranked_wins,
    ranked_losses,
    ranked_draws,
    ranked_games,
    ranked_win_rate
FROM public.leaderboard
ORDER BY rank_position ASC
LIMIT 15;

-- -----------------------------------------------------------------------------
-- 8. VERIFICAR QUE LAS CUENTAS CREADORAS DE SEEDS NO TIENEN W/L ASYNC CONTAMINADO
-- -----------------------------------------------------------------------------
SELECT 
    p.id,
    p.username,
    p.elo_rating,
    s.wins,
    s.losses,
    s.draws
FROM public.profiles p
LEFT JOIN public.ranked_player_stats s ON s.user_id = p.id
WHERE p.id IN ('71c01a7a-8b97-4dcc-9e3e-d725c6a150ef', 'f5ca7d23-78fb-45cf-beec-2f1fd0d1e47a');

-- -----------------------------------------------------------------------------
-- 9. VERIFICAR AUDITORÍA DE MIGRACIÓN 40 EN _migration_audit
-- -----------------------------------------------------------------------------
SELECT 
    id,
    migration_name,
    executed_at,
    details
FROM public._migration_audit
WHERE migration_name = '40_ranked_elo_records';
