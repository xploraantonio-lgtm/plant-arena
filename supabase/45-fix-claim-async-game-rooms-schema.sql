-- =============================================================================
-- MIGRACIÓN 45: CORRECCIÓN DE SCHEMA EN CLAIM_RANKED_ASYNC_OPPONENT (GAME_ROOMS)
-- =============================================================================
-- PROPÓSITO:
-- 1. Alinear el INSERT INTO public.game_rooms dentro de claim_ranked_async_opponent()
--    con el esquema físico real de producción.
-- 2. Eliminar referencias a columnas inexistentes: p1_name, p2_name, p1_avatar, p2_avatar.
-- 3. Utilizar las columnas canónicas de rival asíncrono: async_display_name, async_avatar_id.
-- 4. Establecer status = 'playing' (cumpliendo game_rooms_status_check).
-- 5. Registrar la ejecución en _migration_audit bajo la fase
--    '45_fix_claim_async_game_rooms_schema'.
--
-- INVARIANTES:
-- - 0 cambios en Strategic AI.
-- - 0 modificaciones a tablas físicas (no añade columnas a game_rooms).
-- - 0 alteraciones de ELO, W/L/D, settlement, sobres o partidas históricas.
-- =============================================================================

BEGIN;

-- ── 1. ACTUALIZAR CLAIM_RANKED_ASYNC_OPPONENT ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_ranked_async_opponent()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_queue          RECORD;
  v_existing_is_async BOOLEAN;
  v_waited         INTEGER;
  v_ghost_timeout  INTEGER := 30;
  v_human_room     UUID;
  v_player_elo     INTEGER := 1000;
  v_player_deck    JSONB;
  v_deck_val       JSONB;
  v_candidate      RECORD;
  v_cand_deck_val  JSONB;
  v_cand_plan_val  JSONB;
  v_recent         UUID[];
  v_random_name    TEXT;
  v_random_avatar  TEXT;
  v_new_seed       INTEGER;
  v_new_room_id    UUID;
  v_names          TEXT[] := ARRAY[
    'LeafStorm', 'SolarFox', 'PeaKnight', 'GreenNova', 'GardenWolf',
    'BloomRush', 'NightLeaf', 'SunRider', 'FloraGuard', 'SporeStrike',
    'BrambleFang', 'MossRanger', 'ThornBlade', 'RootWalker', 'VineVanguard',
    'PetalFury', 'BarkTitan', 'FernStriker', 'ShadowSprout', 'TimberWolf'
  ];
  v_avatars        TEXT[] := ARRAY['1', '2', '3', '4', '5', '6', '7', '8'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 1. Verificar si el usuario está en cola Ranked activa
  SELECT *
    INTO v_queue
    FROM public.matchmaking_queue
   WHERE user_id = v_uid
     AND mode = 'ranked'
     AND status IN ('waiting', 'searching', 'matched')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_en_cola');
  END IF;

  -- En caso de que ya tenga status='matched', resolver de forma canónica
  IF v_queue.status = 'matched' AND v_queue.matched_room_id IS NOT NULL THEN
    SELECT is_async_match INTO v_existing_is_async
      FROM public.game_rooms
     WHERE id = v_queue.matched_room_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'matched', FALSE,
        'error', 'matched_room_missing',
        'details', 'La sala emparejada no existe en game_rooms'
      );
    END IF;

    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_queue.matched_room_id,
      'isAsyncMatch', v_existing_is_async
    );
  END IF;

  -- ── SERVER-SIDE GATE: RECHAZAR FILAS SIN CAPACIDAD auth-v2 ─────────────────
  IF v_queue.client_engine_version IS NULL OR v_queue.client_engine_version <> 'auth-v2' THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'client_update_required',
      'message', 'Se requiere actualizar el juego para emparejar con un Rival Semilla.'
    );
  END IF;

  -- ── LECTURA CANÓNICA DE TIMEOUT SERVER-SIDE ────────────────────────────────
  SELECT COALESCE(MAX(CASE WHEN key = 'mm_ranked_ghost_after_seconds' THEN value::INTEGER END), 30)
    INTO v_ghost_timeout
    FROM public.shop_config;

  v_waited := EXTRACT(EPOCH FROM (NOW() - v_queue.created_at))::INTEGER;
  IF v_waited < v_ghost_timeout THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'tiempo_insuficiente',
      'segundos_restantes', v_ghost_timeout - v_waited
    );
  END IF;

  -- 2. Prioridad humana absoluta: intentar emparejar con humano primero
  v_human_room := public._try_match(v_uid);
  IF v_human_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_human_room,
      'isAsyncMatch', FALSE
    );
  END IF;

  -- 3. Cargar mazo activo y ELO del jugador
  v_player_deck := public._active_deck(v_uid);
  v_deck_val := public._validate_ranked_async_deck(v_player_deck);
  IF (v_deck_val->>'ok')::BOOLEAN <> TRUE THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'invalid_player_deck', 'details', v_deck_val);
  END IF;

  SELECT COALESCE(elo_rating, 1000) INTO v_player_elo
    FROM public.profiles
   WHERE id = v_uid;

  SELECT ARRAY_AGG(async_opponent_id) INTO v_recent
    FROM (
      SELECT async_opponent_id
        FROM public.game_rooms
       WHERE player1_id = v_uid
         AND is_async_match = TRUE
         AND created_at > NOW() - INTERVAL '1 hour'
         AND async_opponent_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5
    ) r;

  -- 4. Búsqueda y selección de candidato semilla
  FOR v_candidate IN
    SELECT *
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND (v_recent IS NULL OR id <> ALL(v_recent))
     ORDER BY ABS(rating_snapshot - v_player_elo) ASC, usage_count ASC, created_at DESC
     LIMIT 10
  LOOP
    v_cand_deck_val := public._validate_ranked_async_deck(v_candidate.deck_snapshot);
    v_cand_plan_val := public._validate_ranked_async_plan(v_candidate.actions_snapshot);

    IF (v_cand_deck_val->>'ok')::BOOLEAN = TRUE AND (v_cand_plan_val->>'ok')::BOOLEAN = TRUE THEN
      EXIT;
    ELSE
      UPDATE public.ranked_async_opponents
         SET active = FALSE
       WHERE id = v_candidate.id;
      v_candidate := NULL;
    END IF;
  END LOOP;

  IF v_candidate IS NULL OR v_candidate.id IS NULL THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_hay_candidato_semilla');
  END IF;

  v_random_name := v_names[1 + floor(random() * array_length(v_names, 1))::INTEGER];
  v_random_avatar := v_avatars[1 + floor(random() * array_length(v_avatars, 1))::INTEGER];
  v_new_seed := 100000 + floor(random() * 899999)::INTEGER;

  -- 5. Crear la sala asíncrona en game_rooms (alineada al esquema físico real)
  INSERT INTO public.game_rooms (
    mode,
    status,
    player1_id,
    player2_id,
    p1_deck,
    p2_deck,
    seed,
    is_async_match,
    async_opponent_id,
    async_display_name,
    async_avatar_id,
    async_rating_snapshot,
    async_deck_snapshot,
    engine_version,
    created_at,
    started_at
  ) VALUES (
    'ranked',
    'playing',
    v_uid,
    NULL,
    v_player_deck,
    v_candidate.deck_snapshot,
    v_new_seed,
    TRUE,
    v_candidate.id,
    v_random_name,
    v_random_avatar,
    v_candidate.rating_snapshot,
    v_candidate.deck_snapshot,
    'auth-v2',
    NOW(),
    NOW()
  ) RETURNING id INTO v_new_room_id;

  -- 6. Insertar plan de acciones en tabla privada server-only
  INSERT INTO public.ranked_async_room_plans (
    room_id,
    async_opponent_id,
    actions_snapshot,
    protocol_version
  ) VALUES (
    v_new_room_id,
    v_candidate.id,
    v_candidate.actions_snapshot,
    'ranked-async-v1'
  );

  -- 7. Actualizar uso del candidato semilla
  UPDATE public.ranked_async_opponents
     SET usage_count = usage_count + 1,
         last_used_at = NOW()
   WHERE id = v_candidate.id;

  -- 8. Finalizar la entrada en cola
  UPDATE public.matchmaking_queue
     SET status = 'matched',
         matched_room_id = v_new_room_id,
         matched_at = NOW()
   WHERE id = v_queue.id;

  RETURN jsonb_build_object(
    'matched', TRUE,
    'roomId', v_new_room_id,
    'isAsyncMatch', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_ranked_async_opponent() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_ranked_async_opponent() TO authenticated, service_role;

-- ── 2. REGISTRO EN EL LEDGER DE AUDITORÍA ────────────────────────────────────
INSERT INTO public._migration_audit (
  fase,
  detalle,
  ejecutado_en
) VALUES (
  '45_fix_claim_async_game_rooms_schema',
  jsonb_build_object(
    'descripcion', 'Alinear INSERT INTO game_rooms en claim_ranked_async_opponent con el esquema fisico real (async_display_name, async_avatar_id, status playing, eliminacion de p1_name/p2_name/p1_avatar/p2_avatar)',
    'columnas_reemplazadas', jsonb_build_object(
      'p2_name', 'async_display_name',
      'p2_avatar', 'async_avatar_id'
    ),
    'columnas_eliminadas_de_insert', jsonb_build_array('p1_name', 'p1_avatar'),
    'status_corregido', 'playing'
  ),
  NOW()
);

COMMIT;
