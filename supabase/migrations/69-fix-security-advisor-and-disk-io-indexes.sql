-- =============================================================================
-- 69: CORRECCIÓN DE SEGURIDAD (SECURITY ADVISOR) Y OPTIMIZACIÓN DE DISK IO
--
-- 1. Convierte la vista public.leaderboard en SECURITY INVOKER (resuelve el aviso
--    rojo CRITICAL sin alterar datos, dependencias ni columnas).
-- 2. Asegura search_path en funciones señaladas por el Security Advisor.
-- 3. Restringe la ejecución de funciones SECURITY DEFINER sensibles a roles
--    autenticados y service_role, eliminando el acceso de PUBLIC/anon.
-- 4. Añade índices B-Tree específicos en game_rooms, match_actions y profiles
--    para eliminar Sequential Scans repetitivos y proteger el Disk IO Budget.
-- =============================================================================

-- ── 1. VISTA LEADERBOARD: SECURITY INVOKER ──────────────────────────────────
ALTER VIEW public.leaderboard SET (security_invoker = true);
GRANT SELECT ON public.leaderboard TO anon, authenticated, service_role;

-- ── 2. SEARCH PATH EN FUNCIONES DEL SECURITY ADVISOR ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_validate_tournament_deck') THEN
    EXECUTE 'ALTER FUNCTION public._validate_tournament_deck(JSONB) SET search_path = public, pg_temp;';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_ranked_elo_delta') THEN
    EXECUTE 'ALTER FUNCTION public._ranked_elo_delta(INTEGER, INTEGER, NUMERIC) SET search_path = public, pg_temp;';
  END IF;
END $$;

-- ── 3. HARDENING DE FUNCIONES SECURITY DEFINER (REVOKE DE PUBLIC) ────────────
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'admin_open_secret_code_reward',
        'create_clan',
        'create_tournament',
        'donate_clan_plant_copy',
        'finalize_tournament_and_distribute',
        'get_clans_list',
        'get_my_clan_details',
        'get_tournament_details',
        'get_tournaments_list'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC;', v_fn.nspname, v_fn.proname, v_fn.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role;', v_fn.nspname, v_fn.proname, v_fn.args);
  END LOOP;
END $$;

-- ── 4. ÍNDICES ESTRATÉGICOS PARA PROTEGER EL DISK IO BUDGET ─────────────────
CREATE INDEX IF NOT EXISTS idx_game_rooms_p1_status ON public.game_rooms(player1_id, status);
CREATE INDEX IF NOT EXISTS idx_game_rooms_p2_status ON public.game_rooms(player2_id, status);
CREATE INDEX IF NOT EXISTS idx_game_rooms_active_async ON public.game_rooms(status, is_async_match) WHERE status = 'playing';
CREATE INDEX IF NOT EXISTS idx_game_rooms_settled_at ON public.game_rooms(settled_at) WHERE settled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_match_actions_room_id_id ON public.match_actions(room_id, id);
CREATE INDEX IF NOT EXISTS idx_match_actions_room_user_created ON public.match_actions(room_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranked_async_room_plans_room_id ON public.ranked_async_room_plans(room_id);

CREATE INDEX IF NOT EXISTS idx_profiles_ranking ON public.profiles(elo_rating DESC, created_at ASC)
  WHERE NOT COALESCE(exclude_from_ranking, false);
