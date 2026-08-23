-- =============================================================================
-- PLANTS ARENA · POST-DEPLOY CHECK PARA MIGRACIÓN 36 (READ-ONLY)
-- RIVAL SEMILLA RANKED V1 (ASYNC OPPONENTS)
--
-- Este script ejecuta EXCLUSIVAMENTE consultas de solo lectura.
-- Diseñado para ejecutarse DESPUÉS de un despliegue para certificar la integridad
-- estructural, semántica, permisos, RLS, consistencia de pools y planes de partida.
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
-- 2. INTEGRIDAD Y SEMÁNTICA DEL POOL DE RIVALES SEMILLA (DEBEN SER CERO)
-- -----------------------------------------------------------------------------

-- 2.1 Semillas activas con versión de motor o protocolo inválidas (DEBE SER CERO)
SELECT
  '2.1 Semillas con versión inválida (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_corruptas
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (source_engine_version <> 'auth-v1' OR protocol_version <> 'ranked-async-v1');

-- 2.2 Semillas con snapshots que no son arrays JSON (DEBE SER CERO)
SELECT
  '2.2 Semillas con snapshots no-array (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_corruptas
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (
    jsonb_typeof(deck_snapshot) <> 'array'
    OR jsonb_typeof(actions_snapshot) <> 'array'
    OR source_duration_ticks < 300
  );

-- 2.3 Semillas activas con mazo snapshot semánticamente inválido (DEBE SER CERO)
SELECT
  '2.3 Semillas activas con mazo inválido por _validate_ranked_async_deck (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_mazos_invalidos
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (public._validate_ranked_async_deck(deck_snapshot)->>'ok') <> 'true';

-- 2.4 Semillas activas con plan de intenciones semánticamente inválido (DEBE SER CERO)
SELECT
  '2.4 Semillas activas con plan inválido por _validate_ranked_async_plan (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_planes_invalidos
FROM public.ranked_async_opponents
WHERE active = TRUE
  AND (public._validate_ranked_async_plan(actions_snapshot)->>'ok') <> 'true';

-- 2.5 Semillas activas cuya sala fuente no cumple elegibilidad estricta (DEBE SER CERO)
SELECT
  '2.5 Semillas activas con sala fuente no elegible (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_fuentes_invalidas
FROM public.ranked_async_opponents o
JOIN public.game_rooms r ON r.id = o.source_room_id
WHERE o.active = TRUE
  AND (
    r.mode <> 'ranked'
    OR r.is_async_match = TRUE
    OR r.settled_at IS NULL
    OR r.verification_status <> 'verified'
    OR r.engine_version <> 'auth-v1'
    OR r.verification_payload IS NULL
    OR r.verification_payload->>'resolutionSource' <> 'authoritative_replay'
    OR r.verification_payload->>'consistent' <> 'true'
    OR r.verification_payload->>'illegalCount' <> '0'
  );


-- -----------------------------------------------------------------------------
-- 3. INTEGRIDAD DE SALAS ASÍNCRONAS Y PLANES PRIVADOS (DEBEN SER CERO)
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

-- 3.4 Salas asíncronas con discordancia de opponent_id entre room y plan (DEBE SER CERO)
SELECT
  '3.4 Salas asíncronas con discordancia room/plan opponent_id (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_mismatches
FROM public.game_rooms gr
JOIN public.ranked_async_room_plans p ON p.room_id = gr.id
WHERE gr.is_async_match = TRUE
  AND p.async_opponent_id <> gr.async_opponent_id;

-- 3.5 Salas asíncronas con discordancia de deck_snapshot con el opponent (DEBE SER CERO)
SELECT
  '3.5 Salas asíncronas con discordancia de mazo vs opponent (DEBE SER 0)' AS chequeo,
  COUNT(*) AS total_deck_mismatches
FROM public.game_rooms gr
JOIN public.ranked_async_opponents o ON o.id = gr.async_opponent_id
WHERE gr.is_async_match = TRUE
  AND (
    gr.async_deck_snapshot <> o.deck_snapshot
    OR (gr.p2_deck IS NOT NULL AND gr.p2_deck <> o.deck_snapshot)
  );

-- 3.6 Salas asíncronas con discordancia de protocol_version (DEBE SER CERO)
SELECT
  '3.6 Discordancia de protocolo en planes (DEBE SER 0)' AS chequeo,
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
