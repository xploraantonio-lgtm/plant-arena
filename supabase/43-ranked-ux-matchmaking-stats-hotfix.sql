-- =============================================================================
-- MIGRACIÓN 43: CIERRE SEGURO RANKED UX / MATCHMAKING / STATS
-- =============================================================================
-- OBJETIVOS:
-- 1. Unificar el timeout de matchmaking Ranked asíncrono para que tanto
--    poll_matchmaking() como claim_ranked_async_opponent() lean exactamente la
--    misma clave canónica: shop_config.mm_ranked_ghost_after_seconds (default 30s).
--    Eliminar todo hardcodeo de 60s.
--
-- 2. Eliminar inferencia peligrosa de winnerSide y prohibir que _settle_room
--    actúe como segunda autoridad en salas asíncronas.
--    Salas con is_async_match = TRUE lanzan ASYNC_SETTLEMENT_REQUIRED, forzando
--    que la liquidación proceda exclusivamente por settle_verified_async_ranked_match().
--
-- 3. Eliminar ramas ELSE genéricas cuando player2_id es NULL en _settle_room.
--    Validar explícitamente p_winner_id IN (player1_id, player2_id).
--
-- 4. Blindar todas las inserciones de W/L a ranked_player_stats para player2_id
--    con IF v_room.player2_id IS NOT NULL THEN ... END IF;
--
-- 5. Registrar la ejecución en _migration_audit con fase '43_ranked_ux_matchmaking_stats_hotfix'.
-- =============================================================================

BEGIN;

-- ── 1. CONFIGURACIÓN CANÓNICA DE TIMEOUT EN SHOP_CONFIG ──────────────────────
INSERT INTO public.shop_config (key, value)
VALUES ('mm_ranked_ghost_after_seconds', '30')
ON CONFLICT (key) DO UPDATE SET value = '30';

-- ── 2. ACTUALIZAR CLAIM_RANKED_ASYNC_OPPONENT (CANÓNICO 30S / SHOP_CONFIG) ───
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

  -- 5. Crear la sala asíncrona en game_rooms
  INSERT INTO public.game_rooms (
    mode,
    status,
    player1_id,
    player2_id,
    p1_deck,
    p2_deck,
    p1_name,
    p2_name,
    p1_avatar,
    p2_avatar,
    seed,
    is_async_match,
    async_opponent_id,
    async_rating_snapshot,
    async_deck_snapshot,
    engine_version,
    created_at,
    started_at
  ) VALUES (
    'ranked',
    'in_progress',
    v_uid,
    NULL,
    v_player_deck,
    v_candidate.deck_snapshot,
    (SELECT COALESCE(display_name, 'Player 1') FROM public.profiles WHERE id = v_uid),
    v_random_name,
    (SELECT COALESCE(avatar_url, '1') FROM public.profiles WHERE id = v_uid),
    v_random_avatar,
    v_new_seed,
    TRUE,
    v_candidate.id,
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

-- ── 3. ACTUALIZAR _SETTLE_ROOM (EXCLUSIVO PVP HUMANO, SIN AUTORIDAD ASYNC) ──
CREATE OR REPLACE FUNCTION public._settle_room(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room             RECORD;
  v_perdedor         UUID;
  v_elo_p1_before    INTEGER;
  v_elo_p2_before    INTEGER;
  v_delta_p1         INTEGER;
  v_delta_p2         INTEGER;
  v_elo_p1_after     INTEGER;
  v_elo_p2_after     INTEGER;
  v_pozo             NUMERIC(10,2);
  v_pago             NUMERIC(10,2);
  v_cofre            JSONB := NULL;
  v_audit_elo        JSONB;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada: %', p_room_id; END IF;

  -- ── REGLA DE AUTORIDAD ÚNICA: RECHAZAR SALAS ASÍNCRONAS EN _SETTLE_ROOM ─────
  IF v_room.is_async_match = TRUE THEN
    RAISE EXCEPTION 'ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match';
  END IF;

  IF v_room.status IN ('p1_won', 'p2_won', 'draw', 'abandoned', 'cancelled') THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada', 'winner', v_room.server_winner_id);
  END IF;

  -- ── VALIDACIÓN EXPLÍCITA DE GANADOR ─────────────────────────────────────────
  IF p_winner_id IS NOT NULL AND p_winner_id NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'Ganador inválido para la sala: %', p_winner_id;
  END IF;

  -- ── COLISEO ────────────────────────────────────────────────────────────────
  IF v_room.mode = 'colosseum' THEN
    IF p_winner_id IS NULL THEN
      UPDATE public.colosseum_escrow SET status = 'refunded' WHERE room_id = p_room_id AND status = 'held';
      UPDATE public.game_rooms SET status = 'draw', settled_at = NOW() WHERE id = p_room_id;
      RETURN jsonb_build_object('success', TRUE, 'status', 'empate', 'refunded', TRUE);
    END IF;

    IF v_room.player2_id IS NULL THEN
      RAISE EXCEPTION 'Sala Coliseo inválida: player2_id es nulo';
    END IF;

    v_perdedor := CASE WHEN p_winner_id = v_room.player1_id THEN v_room.player2_id ELSE v_room.player1_id END;

    IF v_room.player1_id < v_room.player2_id THEN
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
    ELSE
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
    END IF;

    v_delta_p1 := CASE WHEN p_winner_id = v_room.player1_id
                       THEN (public._elo_deltas(v_elo_p1_before)->>'win')::INTEGER
                       ELSE -(public._elo_deltas(v_elo_p1_before)->>'lose')::INTEGER END;
    v_delta_p2 := CASE WHEN p_winner_id = v_room.player2_id
                       THEN (public._elo_deltas(v_elo_p2_before)->>'win')::INTEGER
                       ELSE -(public._elo_deltas(v_elo_p2_before)->>'lose')::INTEGER END;

    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);
    v_elo_p2_after := GREATEST(0, v_elo_p2_before + v_delta_p2);

    SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo
      FROM public.colosseum_escrow
     WHERE room_id = p_room_id AND status = 'held';

    v_pago := ROUND(v_pozo * 0.80, 2);

    UPDATE public.profiles
       SET colosseum_current_streak = colosseum_current_streak + 1,
           colosseum_max_streak     = GREATEST(colosseum_max_streak, colosseum_current_streak + 1),
           gems_balance             = gems_balance + v_pago,
           elo_rating               = CASE WHEN id = v_room.player1_id THEN v_elo_p1_after ELSE v_elo_p2_after END
     WHERE id = p_winner_id;

    IF v_perdedor IS NOT NULL THEN
      UPDATE public.profiles
         SET colosseum_current_streak = 0,
             elo_rating               = CASE WHEN id = v_room.player1_id THEN v_elo_p1_after ELSE v_elo_p2_after END
       WHERE id = v_perdedor;
    END IF;

    IF v_pago > 0 THEN
      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      VALUES (p_winner_id, 'colosseum_win', v_pago, 'Victoria en Coliseo (80% del pozo)', 'completed');
    END IF;

    UPDATE public.colosseum_escrow
       SET status = 'settled' WHERE room_id = p_room_id AND status = 'held';

    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW()
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE, 'status', 'liquidada', 'winner', p_winner_id,
      'mode', v_room.mode,
      'eloGained', CASE WHEN p_winner_id = v_room.player1_id THEN v_delta_p1 ELSE v_delta_p2 END,
      'eloLost', CASE WHEN p_winner_id = v_room.player1_id THEN ABS(v_delta_p2) ELSE ABS(v_delta_p1) END,
      'payout', v_pago, 'chest', NULL
    );
  END IF;

  -- ── RANKED HUMANO (Fórmula ELO canónica simétrica K=32 + W/L Records) ───────
  IF v_room.mode = 'ranked' THEN
    IF v_room.player2_id IS NULL THEN
      RAISE EXCEPTION 'Sala Ranked PvP inválida: player2_id es nulo';
    END IF;

    -- Bloquear perfiles en orden determinista por UUID para prevenir deadlocks
    IF v_room.player1_id < v_room.player2_id THEN
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
    ELSE
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
    END IF;

    IF p_winner_id = v_room.player1_id THEN
      v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_elo_p2_before, 1.0);
      v_delta_p2 := -v_delta_p1;

      -- Actualizar W/L Stats de P1 y P2 de forma segura
      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 1, 0, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET wins = ranked_player_stats.wins + 1, updated_at = NOW();

      IF v_room.player2_id IS NOT NULL THEN
        INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
        VALUES (v_room.player2_id, 0, 1, 0, NOW())
        ON CONFLICT (user_id) DO UPDATE SET losses = ranked_player_stats.losses + 1, updated_at = NOW();
      END IF;
    ELSIF p_winner_id = v_room.player2_id THEN
      v_delta_p2 := public._ranked_elo_delta(v_elo_p2_before, v_elo_p1_before, 1.0);
      v_delta_p1 := -v_delta_p2;

      -- Actualizar W/L Stats de P1 y P2 de forma segura
      IF v_room.player2_id IS NOT NULL THEN
        INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
        VALUES (v_room.player2_id, 1, 0, 0, NOW())
        ON CONFLICT (user_id) DO UPDATE SET wins = ranked_player_stats.wins + 1, updated_at = NOW();
      END IF;

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 0, 1, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET losses = ranked_player_stats.losses + 1, updated_at = NOW();
    ELSE
      RAISE EXCEPTION 'Ganador no reconocido para liquidación Ranked: %', p_winner_id;
    END IF;

    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);
    v_elo_p2_after := GREATEST(0, v_elo_p2_before + v_delta_p2);

    -- Actualizar ELO de ambos jugadores en la misma transacción
    UPDATE public.profiles SET elo_rating = v_elo_p1_after WHERE id = v_room.player1_id;
    IF v_room.player2_id IS NOT NULL THEN
      UPDATE public.profiles SET elo_rating = v_elo_p2_after WHERE id = v_room.player2_id;
    END IF;

    -- Otorgar cofre al ganador
    v_cofre := public._award_victory_chest_for(p_winner_id);

    -- Auditoría ELO
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
      'p1Before', v_elo_p1_before,
      'p2Before', v_elo_p2_before,
      'p1Delta', v_delta_p1,
      'p2Delta', v_delta_p2,
      'p1After', v_elo_p1_after,
      'p2After', v_elo_p2_after
    );

    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW(),
           verification_payload = COALESCE(verification_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE, 'status', 'liquidada', 'winner', p_winner_id,
      'mode', 'ranked',
      'eloGained', CASE WHEN p_winner_id = v_room.player1_id THEN v_delta_p1 ELSE v_delta_p2 END,
      'eloLost', CASE WHEN p_winner_id = v_room.player1_id THEN ABS(v_delta_p2) ELSE ABS(v_delta_p1) END,
      'eloAfter', CASE WHEN p_winner_id = v_room.player1_id THEN v_elo_p1_after ELSE v_elo_p2_after END,
      'chest', v_cofre
    );
  END IF;

  -- ── OTROS MODOS (Friendly, Practice, etc.) ──────────────────────────────────
  UPDATE public.game_rooms
     SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
         settled_at = NOW()
   WHERE id = p_room_id;

  RETURN jsonb_build_object('success', TRUE, 'status', 'liquidada', 'winner', p_winner_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_room(UUID, UUID) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public._settle_room(UUID, UUID) TO service_role;

-- ── 4. ACTUALIZAR SETTLE_VERIFIED_DRAW CON GUARD DE PLAYER2_ID ────────────────
CREATE OR REPLACE FUNCTION public.settle_verified_draw(
  p_room_id UUID,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_elo_p1_before INTEGER;
  v_elo_p2_before INTEGER;
  v_delta_p1 INTEGER := 0;
  v_delta_p2 INTEGER := 0;
  v_elo_p1_after INTEGER;
  v_elo_p2_after INTEGER;
  v_audit_elo JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.is_async_match = TRUE THEN
    RAISE EXCEPTION 'ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  IF v_room.mode = 'ranked' THEN
    IF v_room.player1_id IS NOT NULL AND v_room.player2_id IS NOT NULL THEN
      IF v_room.player1_id < v_room.player2_id THEN
        SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
        SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
      ELSE
        SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
        SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
      END IF;

      v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_elo_p2_before, 0.5);
      v_delta_p2 := public._ranked_elo_delta(v_elo_p2_before, v_elo_p1_before, 0.5);
      v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);
      v_elo_p2_after := GREATEST(0, v_elo_p2_before + v_delta_p2);

      IF v_delta_p1 <> 0 THEN
        UPDATE public.profiles SET elo_rating = v_elo_p1_after WHERE id = v_room.player1_id;
      END IF;
      IF v_delta_p2 <> 0 THEN
        UPDATE public.profiles SET elo_rating = v_elo_p2_after WHERE id = v_room.player2_id;
      END IF;

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 0, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET draws = ranked_player_stats.draws + 1, updated_at = NOW();

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player2_id, 0, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET draws = ranked_player_stats.draws + 1, updated_at = NOW();
    ELSIF v_room.player1_id IS NOT NULL THEN
      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 0, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET draws = ranked_player_stats.draws + 1, updated_at = NOW();
    END IF;
  END IF;

  UPDATE public.game_rooms
     SET status = 'draw',
         settled_at = NOW(),
         verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = NULL,
         verification_note = 'server_verified_draw',
         verification_payload = COALESCE(p_payload, '{}'::JSONB)
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'empate_verificado',
    'authoritative', TRUE,
    'verificationStatus', 'verified'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) TO service_role;

-- ── 5. REGISTRAR EN AUDITORÍA DE MIGRACIONES ────────────────────────────────
INSERT INTO public._migration_audit (fase, detalles)
VALUES (
  '43_ranked_ux_matchmaking_stats_hotfix',
  jsonb_build_object(
    'descripcion', 'Matchmaking 30s server-authoritative desde shop_config, eliminacion de inferencia winnerSide, _settle_room exclusivo PvP, y guards NOT NULL en ranked_player_stats',
    'timestamp', NOW()
  )
);

COMMIT;
