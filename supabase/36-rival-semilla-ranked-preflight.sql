-- =============================================================================
-- PLANTS ARENA · PREFLIGHT AUDIT PARA MIGRACIÓN 36 (READ-ONLY)
-- RIVAL SEMILLA RANKED V1 (ASYNC OPPONENTS)
--
-- Este script ejecuta EXCLUSIVAMENTE consultas de solo lectura.
-- Diagnostica el estado de la base de datos antes de aplicar la Migración 36,
-- detectando datos históricos con inconsistencias, salas elegibles para semillas,
-- índices existentes y objetos a reemplazar.
--
-- NO MODIFICA DATOS NI CREA OBJETOS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AUDITORÍA DE ACCIONES HISTÓRICAS EN match_actions
-- -----------------------------------------------------------------------------

-- 1.1 Acciones auth-v1 con issued_tick NULL (inelegibles para semillas V1)
SELECT
  '1.1 Acciones auth-v1 con issued_tick NULL' AS chequeo,
  COUNT(*) AS total_incompatibles
FROM public.match_actions ma
JOIN public.game_rooms gr ON gr.id = ma.room_id
WHERE gr.engine_version = 'auth-v1'
  AND (ma.issued_tick IS NULL OR ma.issued_tick < 0);

-- 1.2 Acciones con seq nulo o inválido
SELECT
  '1.2 Acciones con seq nulo o menor a cero' AS chequeo,
  COUNT(*) AS total_invalidos
FROM public.match_actions
WHERE seq IS NULL OR seq < 0;

-- 1.3 Acciones con seq duplicado para el mismo (room_id, user_id, seq)
SELECT
  '1.3 Duplicados de (room_id, user_id, seq)' AS chequeo,
  room_id,
  user_id,
  seq,
  COUNT(*) AS ocurrencias
FROM public.match_actions
WHERE seq IS NOT NULL
GROUP BY room_id, user_id, seq
HAVING COUNT(*) > 1
LIMIT 20;

-- 1.4 Acciones auth-v1 con relación temporal inválida (tick vs issued_tick)
SELECT
  '1.4 Acciones auth-v1 con margen temporal inválido' AS chequeo,
  COUNT(*) AS total_invalidas
FROM public.match_actions ma
JOIN public.game_rooms gr ON gr.id = ma.room_id
WHERE gr.engine_version = 'auth-v1'
  AND ma.issued_tick IS NOT NULL
  AND (
    (ma.kind IN ('plant', 'dig') AND ma.tick <> ma.issued_tick + 6)
    OR
    (ma.kind = 'collect' AND ma.tick <> ma.issued_tick)
  );


-- -----------------------------------------------------------------------------
-- 2. AUDITORÍA DE SALAS HISTÓRICAS Y METADATOS DE VERIFICACIÓN (DESGLOSE)
-- -----------------------------------------------------------------------------

-- 2.1 Salas ranked verificadas sin verification_payload
SELECT
  '2.1 Salas sin verification_payload' AS chequeo,
  COUNT(*) AS total_sin_payload
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND verification_payload IS NULL;

-- 2.2 Salas ranked verificadas sin campo consistent o con consistent <> true
SELECT
  '2.2 Salas sin consistent o consistent != true' AS chequeo,
  COUNT(*) AS total_no_consistente
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (
    verification_payload->>'consistent' IS NULL
    OR verification_payload->>'consistent' <> 'true'
  );

-- 2.3 Salas ranked verificadas sin illegalCount o con illegalCount <> 0
SELECT
  '2.3 Salas con illegalCount ausente o distinto de cero' AS chequeo,
  COUNT(*) AS total_con_ilegales
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (
    verification_payload->>'illegalCount' IS NULL
    OR (verification_payload->>'illegalCount') !~ '^\d+$'
    OR (verification_payload->>'illegalCount')::INTEGER <> 0
  );

-- 2.4 Salas ranked verificadas sin resolutionSource o con resolutionSource <> authoritative_replay
SELECT
  '2.4 Salas con resolutionSource ausente o distinto de authoritative_replay' AS chequeo,
  COUNT(*) AS total_no_authoritative_replay
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (
    verification_payload->>'resolutionSource' IS NULL
    OR verification_payload->>'resolutionSource' <> 'authoritative_replay'
  );

-- 2.5 Salas ranked verificadas resueltas por consenso de clientes
SELECT
  '2.5 Salas resueltas por consenso de clientes (resolutionSource = ranked_client_consensus)' AS chequeo,
  COUNT(*) AS total_consenso_cliente
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (verification_payload->>'resolutionSource') = 'ranked_client_consensus';

-- 2.6 Salas ranked verificadas con ticks ausentes o menores a 300
SELECT
  '2.6 Salas con ticks ausentes o menores a 300' AS chequeo,
  COUNT(*) AS total_duracion_invalida
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (
    verification_payload->>'ticks' IS NULL
    OR (verification_payload->>'ticks') !~ '^\d+$'
    OR (verification_payload->>'ticks')::INTEGER < 300
  );

-- 2.7 Salas ranked finalizadas por surrender o forfeit
SELECT
  '2.7 Salas finalizadas por surrender o forfeit' AS chequeo,
  COUNT(*) AS total_surrender_forfeit
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (verification_payload->>'reason') IN ('forfeit_p1', 'forfeit_p2', 'surrender');

-- 2.8 Salas ranked sin mazos snapshot válidos
SELECT
  '2.8 Salas sin mazos snapshots' AS chequeo,
  COUNT(*) AS total_sin_mazo
FROM public.game_rooms
WHERE mode = 'ranked'
  AND verification_status = 'verified'
  AND (
    p1_deck IS NULL OR jsonb_typeof(p1_deck) <> 'array'
    OR p2_deck IS NULL OR jsonb_typeof(p2_deck) <> 'array'
  );

-- 2.9 Salas potencialmente elegibles para Rivales Semilla V1 (CRITERIO POSITIVO ESTRICTO)
SELECT
  '2.9 Salas estrictamente elegibles para pool V1' AS chequeo,
  COUNT(*) AS total_salas_elegibles
FROM public.game_rooms
WHERE mode = 'ranked'
  AND is_async_match = FALSE
  AND settled_at IS NOT NULL
  AND verification_status = 'verified'
  AND player1_id IS NOT NULL
  AND player2_id IS NOT NULL
  AND engine_version = 'auth-v1'
  AND verification_payload IS NOT NULL
  AND verification_payload->>'resolutionSource' = 'authoritative_replay'
  AND verification_payload->>'consistent' = 'true'
  AND verification_payload->>'illegalCount' = '0'
  AND (verification_payload->>'ticks') ~ '^\d+$'
  AND (verification_payload->>'ticks')::INTEGER >= 300
  AND COALESCE(verification_payload->>'reason', '') NOT IN ('forfeit_p1', 'forfeit_p2', 'surrender')
  AND p1_deck IS NOT NULL
  AND jsonb_typeof(p1_deck) = 'array'
  AND p2_deck IS NOT NULL
  AND jsonb_typeof(p2_deck) = 'array';


-- -----------------------------------------------------------------------------
-- 3. AUDITORÍA DE ÍNDICES Y CONSTRAINTS PREEXISTENTES
-- -----------------------------------------------------------------------------

-- 3.1 Índices existentes en match_actions y game_rooms
SELECT
  '3.1 Índices existentes' AS chequeo,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('match_actions', 'game_rooms', 'ranked_async_opponents', 'ranked_async_room_plans')
ORDER BY tablename, indexname;

-- 3.2 Funciones / RPCs que serán reemplazadas por Migración 36
SELECT
  '3.2 Funciones a reemplazar' AS chequeo,
  n.nspname AS esquema,
  p.proname AS nombre_funcion,
  pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'capture_ranked_async_opponents_from_room',
    'claim_ranked_async_opponent',
    'settle_verified_async_ranked_match',
    'game_room_info',
    'poll_ranked_async_intents',
    'submit_match_action',
    'report_match_result',
    'surrender_match',
    'room_result',
    '_validate_ranked_async_deck',
    '_validate_ranked_async_plan'
  )
ORDER BY p.proname;
