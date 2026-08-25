-- =============================================================================
-- MIGRACIÓN 44: POSTCHECK READ-ONLY AUDIT
-- =============================================================================
-- PROPÓSITO:
-- Auditoría estricta de sólo lectura tras aplicar la migración 44.
-- NO MODIFICA DATOS NI ESTRUCTURA.
-- =============================================================================

-- 1. VERIFICAR QUE LA FASE 44 ESTÁ REGISTRADA EN EL LEDGER
SELECT
  fase,
  detalle->>'descripcion' AS descripcion,
  ejecutado_en,
  COUNT(*) AS rec_count
FROM public._migration_audit
WHERE fase = '44_ranked_async_opponent_usage_metadata'
GROUP BY fase, detalle, ejecutado_en;

-- 2. VERIFICAR ESTRUCTURA DE COLUMNA USAGE_COUNT
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  CASE
    WHEN data_type = 'bigint' AND is_nullable = 'NO' THEN 'OK (BIGINT NOT NULL)'
    ELSE 'FAIL'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ranked_async_opponents'
  AND column_name = 'usage_count';

-- 3. VERIFICAR ESTRUCTURA DE COLUMNA LAST_USED_AT
SELECT
  column_name,
  data_type,
  is_nullable,
  CASE
    WHEN data_type = 'timestamp with time zone' THEN 'OK (TIMESTAMPTZ)'
    ELSE 'FAIL'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ranked_async_opponents'
  AND column_name = 'last_used_at';

-- 4. VERIFICAR RESTRICCIÓN CHECK (USAGE_COUNT >= 0)
SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.ranked_async_opponents'::regclass
  AND conname = 'chk_ranked_async_opponents_usage_count';

-- 5. VERIFICAR QUE NO HAY CONTADORES NEGATIVOS
SELECT
  COUNT(*) AS total_seeds,
  COUNT(*) FILTER (WHERE usage_count < 0) AS usage_count_negativos_esperado_cero,
  COUNT(*) FILTER (WHERE usage_count = 0) AS usage_count_cero,
  COUNT(*) FILTER (WHERE usage_count > 0) AS usage_count_positivo
FROM public.ranked_async_opponents;

-- 6. BASELINE COMPETITIVO POST-MIGRACIÓN 44
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
