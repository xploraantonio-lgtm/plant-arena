-- =============================================================================
-- PLANTS ARENA — HOTFIX 37
-- Corrección de llamada a _active_deck en claim_ranked_async_opponent
--
-- REQUIERE: 36-rival-semilla-ranked.sql
--
-- OBJETIVO:
--   Sustituir la llamada errónea por la función
--   real y existente public._active_deck(v_uid) dentro de claim_ranked_async_opponent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_ranked_async_opponent()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_queue          RECORD;
  v_matched_q      RECORD;
  v_existing_is_async BOOLEAN;
  v_waited         INTEGER;
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

  -- Bloquear fila de cola del usuario para evitar carreras concurrentes
  SELECT * INTO v_queue
    FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status = 'searching'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Si ya fue emparejado en paralelo mientras entraba la llamada (o en un reintento)
    SELECT * INTO v_matched_q
      FROM public.matchmaking_queue
     WHERE user_id = v_uid AND status = 'matched'
     ORDER BY created_at DESC LIMIT 1;

    IF FOUND AND v_matched_q.matched_room_id IS NOT NULL THEN
      SELECT is_async_match
        INTO v_existing_is_async
        FROM public.game_rooms
       WHERE id = v_matched_q.matched_room_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'matched', FALSE,
          'error', 'matched_room_missing'
        );
      END IF;

      RETURN jsonb_build_object(
        'matched', TRUE,
        'roomId', v_matched_q.matched_room_id,
        'isAsyncMatch', v_existing_is_async
      );
    END IF;

    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_en_cola');
  END IF;

  -- Modo exclusivo Ranked
  IF v_queue.mode <> 'ranked' THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'modo_no_permitido');
  END IF;

  -- Comprobar tiempo esperado (mínimo 60 segundos)
  v_waited := EXTRACT(EPOCH FROM (NOW() - v_queue.created_at))::INTEGER;
  IF v_waited < 60 THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'tiempo_insuficiente',
      'waitedSeconds', v_waited
    );
  END IF;

  -- ── PRIORIDAD HUMANA ABSOLUTA ─────────────────────────────────────────────
  v_human_room := public._try_match(v_uid);
  IF v_human_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_human_room,
      'isAsyncMatch', FALSE
    );
  END IF;

  -- ── VALIDAR MAZO ACTIVO DEL JUGADOR ───────────────────────────────────────
  v_player_deck := public._active_deck(v_uid);
  v_deck_val := public._validate_ranked_async_deck(v_player_deck);
  IF (v_deck_val->>'ok')::BOOLEAN IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'invalid_player_deck',
      'details', v_deck_val->>'details'
    );
  END IF;

  SELECT COALESCE(elo_rating, 1000) INTO v_player_elo
    FROM public.profiles WHERE id = v_uid;

  -- Lista de los últimos 10 Rivales Semilla usados por este jugador para anti-repetición
  SELECT COALESCE(array_agg(async_opponent_id), ARRAY[]::UUID[])
    INTO v_recent
    FROM (
      SELECT async_opponent_id
        FROM public.game_rooms
       WHERE player1_id = v_uid
         AND is_async_match = TRUE
         AND async_opponent_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10
    ) s;

  -- ── SELECCIÓN Y VALIDACIÓN DEFENSIVA DEL CANDIDATO SEMILLA ────────────────
  LOOP
    -- Tier 1: ±200 ELO (sin recientes)
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND source_engine_version = 'auth-v1'
       AND protocol_version = 'ranked-async-v1'
       AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       AND id <> ALL(v_recent)
     ORDER BY random()
     LIMIT 1;

    IF NOT FOUND THEN
      -- Tier 1 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2: ±400 ELO (sin recientes)
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
         AND id <> ALL(v_recent)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3: Cualquier candidato activo
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND id <> ALL(v_recent)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('matched', FALSE, 'error', 'no_hay_candidato_semilla');
    END IF;

    -- Validar defensivamente el candidato antes de consumirlo
    v_cand_deck_val := public._validate_ranked_async_deck(v_candidate.deck_snapshot);
    v_cand_plan_val := public._validate_ranked_async_plan(v_candidate.actions_snapshot);

    IF (v_cand_deck_val->>'ok')::BOOLEAN = TRUE AND (v_cand_plan_val->>'ok')::BOOLEAN = TRUE THEN
      EXIT; -- Candidato validado exitosamente
    ELSE
      -- Candidato corrupto: desactivarlo para sanear el pool y reintentar
      UPDATE public.ranked_async_opponents SET active = FALSE WHERE id = v_candidate.id;
    END IF;
  END LOOP;

  -- ── GENERAR METADATOS INVENTADOS Y SEMILLA RNG NUEVA GARANTIZADA ──────────
  v_random_name := v_names[1 + floor(random() * array_length(v_names, 1))::INTEGER];
  v_random_avatar := v_avatars[1 + floor(random() * array_length(v_avatars, 1))::INTEGER];

  DECLARE
    v_source_seed INTEGER;
    v_seed_attempts INTEGER := 0;
  BEGIN
    SELECT seed INTO v_source_seed FROM public.game_rooms WHERE id = v_candidate.source_room_id;
    LOOP
      v_new_seed := FLOOR(100000 + random() * 899999)::INTEGER;
      v_seed_attempts := v_seed_attempts + 1;
      EXIT WHEN (v_source_seed IS NULL OR v_new_seed <> v_source_seed)
        AND NOT EXISTS (
          SELECT 1 FROM public.game_rooms
           WHERE async_opponent_id = v_candidate.id
             AND seed = v_new_seed
        );
      IF v_seed_attempts > 100 THEN
        RAISE EXCEPTION 'No se pudo generar una seed única para el Rival Semilla tras 100 intentos';
      END IF;
    END LOOP;
  END;

  -- ── CREACIÓN ATÓMICA DE SALA Y PLAN PRIVADO ───────────────────────────────
  INSERT INTO public.game_rooms (
    mode,
    player1_id,
    player2_id,
    seed,
    p1_deck,
    p2_deck,
    status,
    is_async_match,
    async_opponent_id,
    async_display_name,
    async_avatar_id,
    async_rating_snapshot,
    async_deck_snapshot,
    engine_version,
    created_at
  ) VALUES (
    'ranked',
    v_uid,
    NULL,
    v_new_seed,
    v_player_deck,
    v_candidate.deck_snapshot,
    'playing',
    TRUE,
    v_candidate.id,
    v_random_name,
    v_random_avatar,
    v_candidate.rating_snapshot,
    v_candidate.deck_snapshot,
    'auth-v1',
    NOW()
  ) RETURNING id INTO v_new_room_id;

  INSERT INTO public.ranked_async_room_plans (
    room_id,
    async_opponent_id,
    protocol_version,
    actions_snapshot,
    created_at
  ) VALUES (
    v_new_room_id,
    v_candidate.id,
    'ranked-async-v1',
    v_candidate.actions_snapshot,
    NOW()
  );

  UPDATE public.matchmaking_queue
     SET status = 'matched',
         matched_room_id = v_new_room_id
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

-- -----------------------------------------------------------------------------
-- REGISTRO DE AUDITORÍA
-- -----------------------------------------------------------------------------
INSERT INTO public._migration_audit(fase, detalle)
VALUES ('37_fix_rival_semilla_active_deck', jsonb_build_object(
  'descripcion', 'Corrige claim_ranked_async_opponent para usar public._active_deck(UUID)',
  'causa', '_active_deck_for no existe',
  'afecta', 'claim Rival Semilla',
  'sin_cambios_elo', true,
  'aplicada_en', NOW()
)) ON CONFLICT DO NOTHING;
