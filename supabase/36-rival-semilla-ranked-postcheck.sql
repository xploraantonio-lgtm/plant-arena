-- =============================================================================
-- PLANTS ARENA · POST-DEPLOY CHECK PARA MIGRACIÓN 36 (READ-ONLY)
-- RIVAL SEMILLA RANKED V1 (ASYNC OPPONENTS)
--
-- Este script ejecuta EXCLUSIVAMENTE consultas de solo lectura.
-- Diseñado para ejecutarse DESPUÉS de un despliegue para certificar la integridad
-- estructural, permisos, RLS, consistencia de pools y planes de partida.
--
-- NO MODIFICA DATOS NI EJECUTA MIGRACIONES.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VERIFICACIÓN DE TABLAS Y RLS
-- -----------------------------------------------------------------------------

-- 1.1 Existencia de tablas server-only y estado de RLS
SELECT
  '1.1 Estado RLS de tablas' AS chequeo,
  relname AS tabla,
  relrowsecurity AS rls_activo,
  relforcerowsecurity AS rls_forzado
FROM pg_class
WHERE relname IN ('ranked_async_opponents', 'ranked_async_room_plans', 'game_rooms', 'match_actions')
  AND relnamespace = 'public'::regnamespace;

-- 1.2 Auditoría de permisos (GRANTS) en tablas privadas
SELECT
  '1.2 Permisos en tablas privadas' AS chequeo,
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('ranked_async_opponents', 'ranked_async_room_plans')
ORDER BY table_name, grantee;


-- -----------------------------------------------------------------------------
-- 2. INTEGRIDAD DEL POOL DE RIVALES SEMILLA
-- -----------------------------------------------------------------------------

-- 2.1 Cantidad de semillas activas vs inactivas por versión de protocolo
SELECT
  '2.1 Resumen del pool de semillas' AS chequeo,
  protocol_version,
  source_engine_version,
  active,
  COUNT(*) AS total_semillas,
  MIN(rating_snapshot) AS min_rating,
  MAX(rating_snapshot) AS max_rating
FROM public.ranked_async_opponents
GROUP BY protocol_version, source_engine_version, active;

-- 2.2 Semillas activas con versión de motor o protocolo inválidas (DEBE SER CERO)
SELECT
  '2.2 Semillas con versión inválida (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_corruptas
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (source_engine_version <> 'auth-v1' OR protocol_version <> 'ranked-async-v1');

-- 2.3 Semillas con snapshots que no son arrays JSON (DEBE SER CERO)
SELECT
  '2.3 Semillas con snapshots no-array (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_corruptas
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (
    jsonb_typeof(deck_snapshot) <> 'array'
    OR jsonb_typeof(actions_snapshot) <> 'array'
    OR source_duration_ticks < 300
  );


-- -----------------------------------------------------------------------------
-- 3. INTEGRIDAD DE SALAS ASÍNCRONAS Y PLANES PRIVADOS
-- -----------------------------------------------------------------------------

-- 3.1 Planes privados huérfanos sin sala (DEBE SER CERO)
SELECT
  '3.1 Planes privados sin sala asociada (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_huerfanos
FROM public.ranked_async_room_plans p
LEFT JOIN public.game_rooms gr ON gr.id = p.room_id
WHERE gr.id IS NULL;

-- 3.2 Salas asíncronas sin plan privado registrado (DEBE SER CERO)
SELECT
  '3.2 Salas asíncronas sin plan privado (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_sin_plan
FROM public.game_rooms gr
LEFT JOIN public.ranked_async_room_plans p ON p.room_id = gr.id
WHERE gr.is_async_match = TRUE
  AND p.room_id IS NULL;

-- 3.3 Salas asíncronas con player2_id asignado (DEBE SER CERO)
SELECT
  '3.3 Salas asíncronas con player2_id no-nulo (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_violaciones
FROM public.game_rooms
WHERE is_async_match = TRUE
  AND player2_id IS NOT NULL;

-- 3.4 Salas asíncronas con discordancia de protocol_version (DEBE SER CERO)
SELECT
  '3.4 Discordancia de protocolo en planes (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_mismatches
FROM public.ranked_async_room_plans p
JOIN public.game_rooms gr ON gr.id = p.room_id
WHERE p.protocol_version <> 'ranked-async-v1'
   OR gr.engine_version <> 'auth-v1';


-- -----------------------------------------------------------------------------
-- 4. ÍNDICES Y CONSTRAINTS REQUERIDOS
-- -----------------------------------------------------------------------------

-- 4.1 Comprobar índices esperados
SELECT
  '4.1 Índices requeridos' AS chequeo,
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_ranked_async_opponents_active_rating',
    'idx_ranked_async_room_plans_opp',
    'idx_game_rooms_async',
    'uq_match_actions_room_user_seq'
  )
ORDER BY tablename, indexname;
