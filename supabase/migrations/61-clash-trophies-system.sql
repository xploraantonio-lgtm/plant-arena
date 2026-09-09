-- =============================================================================
-- 61-CLASH-TROPHIES-SYSTEM.SQL
-- =============================================================================
-- SISTEMA DE COPAS RANKED ESTILO CLASH ROYALE + TROPHY GATES POR ARENA
--
-- CARACTERÍSTICAS:
-- 1. Ganancias y pérdidas calibradas por Arena:
--    - Arena 1 (0 – 1600 copas):       +15 victoria / -5 derrota
--    - Arena 2 (1601 – 2000 copas):     +18 victoria / -8 derrota
--    - Arena 3 (2001 – 3000 copas):     +20 victoria / -12 derrota
--    - Arena 4 (3001 – 4000 copas):     +25 victoria / -20 derrota
--    - Arena 5 (4001+ copas):           +30 victoria / -30 derrota
--    - Empates (Draw):                   0 copas (sin cambio)
--
-- 2. Puertas de Arena (Trophy Gates):
--    - Un jugador NUNCA puede descender de la arena alcanzada.
--    - Pisos protegidos:
--      * Arena 5: Piso en 4000 copas
--      * Arena 4: Piso en 3000 copas
--      * Arena 3: Piso en 2000 copas
--      * Arena 2: Piso en 1600 copas
--      * Arena 1: Piso en 1000 copas (mínimo base de inicio)
--
-- 3. Blindaje definitivo en claim_pack_slot:
--    - Elimina la restricción 'is_base = true' al verificar posesión de planta.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ACTUALIZAR TABLA DE RECOMPENSAS ELO / COPAS (elo_rewards)
-- -----------------------------------------------------------------------------
INSERT INTO public.elo_rewards (max_elo, win_elo, lose_elo) VALUES
  (  1600, 15,  5),
  (  2000, 18,  8),
  (  3000, 20, 12),
  (  4000, 25, 20),
  (999999, 30, 30)
ON CONFLICT (max_elo) DO UPDATE
  SET win_elo = EXCLUDED.win_elo, lose_elo = EXCLUDED.lose_elo;

-- -----------------------------------------------------------------------------
-- 2. FUNCIÓN HELPER _elo_deltas (ACTUALIZADA)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._elo_deltas(p_elo INTEGER)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'win',  COALESCE((SELECT e.win_elo  FROM public.elo_rewards e
                       WHERE e.max_elo >= COALESCE(p_elo, 0)
                       ORDER BY e.max_elo LIMIT 1), 15),
    'lose', COALESCE((SELECT e.lose_elo FROM public.elo_rewards e
                       WHERE e.max_elo >= COALESCE(p_elo, 0)
                       ORDER BY e.max_elo LIMIT 1), 5)
  );
$$;

REVOKE EXECUTE ON FUNCTION public._elo_deltas(INTEGER) FROM anon, authenticated, PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. FÓRMULA AUTORITATIVA DE COPAS RANKED ESTILO CLASH ROYALE + TROPHY GATES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ranked_elo_delta(
  p_player_rating INTEGER,
  p_opponent_rating INTEGER,
  p_score NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_p           INTEGER;
  v_win_delta   INTEGER;
  v_lose_delta  INTEGER;
  v_gate_floor  INTEGER;
  v_nominal_new INTEGER;
  v_clamped_new INTEGER;
  v_final_delta INTEGER;
BEGIN
  v_p := GREATEST(0, COALESCE(p_player_rating, 1000));

  -- 1. Empate exacto (score ~ 0.5): 0 copas
  IF p_score > 0.4 AND p_score < 0.6 THEN
    RETURN 0;
  END IF;

  -- 2. Determinar ganancia / pérdida nominal y piso de arena (Trophy Gate)
  IF v_p <= 1600 THEN
    -- Arena 1: Jardín Clásico (0 / 1000 - 1600)
    v_win_delta  := 15;
    v_lose_delta := -5;
    v_gate_floor := CASE WHEN v_p >= 1000 THEN 1000 ELSE 0 END;
  ELSIF v_p <= 2000 THEN
    -- Arena 2: Desierto Nocturno (1601 - 2000)
    v_win_delta  := 18;
    v_lose_delta := -8;
    v_gate_floor := 1600;
  ELSIF v_p <= 3000 THEN
    -- Arena 3: Rascacielos Cyberpunk (2001 - 3000)
    v_win_delta  := 20;
    v_lose_delta := -12;
    v_gate_floor := 2000;
  ELSIF v_p <= 4000 THEN
    -- Arena 4: Coliseo Galáctico (3001 - 4000)
    v_win_delta  := 25;
    v_lose_delta := -20;
    v_gate_floor := 3000;
  ELSE
    -- Arena 5: Olimpo de Leyendas (4001+)
    v_win_delta  := 30;
    v_lose_delta := -30;
    v_gate_floor := 4000;
  END IF;

  -- 3. Cálculo de victoria o derrota
  IF p_score >= 1.0 THEN
    -- Victoria: suma directa
    v_final_delta := v_win_delta;
  ELSE
    -- Derrota: resta protegida por el Trophy Gate de su arena actual
    v_nominal_new := v_p + v_lose_delta;
    v_clamped_new := GREATEST(v_gate_floor, v_nominal_new);
    v_final_delta := v_clamped_new - v_p; -- Será entre v_lose_delta y 0
  END IF;

  RETURN v_final_delta;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._ranked_elo_delta(INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ranked_elo_delta(INTEGER, INTEGER, NUMERIC) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. SETTLEMENT AUTORITATIVO PARA PARTIDAS ASÍNCRONAS (RIVAL SEMILLA)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_verified_async_ranked_match(
  p_room_id UUID,
  p_winner_side SMALLINT,
  p_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room             RECORD;
  v_elo_p1_before    INTEGER;
  v_opponent_rating  INTEGER;
  v_delta_p1         INTEGER;
  v_elo_p1_after     INTEGER;
  v_cofre            JSONB := NULL;
  v_recent_wins      INTEGER;
  v_audit_elo        JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;
  IF v_room.mode <> 'ranked' THEN RAISE EXCEPTION 'La sala no es ranked'; END IF;
  IF v_room.is_async_match IS NOT TRUE THEN RAISE EXCEPTION 'La sala no es asíncrona'; END IF;

  IF v_room.status IN ('p1_won', 'p2_won', 'draw', 'abandoned', 'cancelled') THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  IF p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winner_side inválido: %', p_winner_side;
  END IF;

  SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
  v_elo_p1_before := COALESCE(v_elo_p1_before, 1000);
  v_opponent_rating := COALESCE(v_room.async_rating_snapshot, 1000);

  IF p_winner_side = 1 THEN
    -- Victoria P1
    v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_opponent_rating, 1.0);
    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);

    -- Anti-farming cofre
    SELECT COUNT(*) INTO v_recent_wins
      FROM public.game_rooms
     WHERE player1_id = v_room.player1_id
       AND async_opponent_id = v_room.async_opponent_id
       AND status = 'p1_won'
       AND settled_at > NOW() - INTERVAL '1 hour'
       AND id <> p_room_id;

    IF v_recent_wins = 0 THEN
      v_cofre := public._award_victory_chest_for(v_room.player1_id);
    ELSE
      v_cofre := jsonb_build_object('awarded', FALSE, 'reason', 'anti_farming_same_opponent');
    END IF;

    -- Actualizar ELO de P1
    UPDATE public.profiles
       SET elo_rating = v_elo_p1_after
     WHERE id = v_room.player1_id;

    -- Actualizar W/L Stats de P1
    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_room.player1_id, 1, 0, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET wins = ranked_player_stats.wins + 1,
          updated_at = NOW();

    -- Auditoría de copas
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'clash-trophies-v1',
      'playerBefore', v_elo_p1_before,
      'opponentBefore', v_opponent_rating,
      'delta', v_delta_p1,
      'playerAfter', v_elo_p1_after,
      'isAsyncMatch', true
    );

    UPDATE public.game_rooms
       SET status = 'p1_won',
           settled_at = NOW(),
           verification_status = 'verified',
           verified_at = NOW(),
           server_winner_id = v_room.player1_id,
           verification_note = 'server_verified_async',
           verification_payload = COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'authoritative', TRUE,
      'status', 'liquidada',
      'winner', v_room.player1_id,
      'winnerSide', 1,
      'mode', 'ranked',
      'eloBefore', v_elo_p1_before,
      'opponentElo', v_opponent_rating,
      'eloDelta', v_delta_p1,
      'eloAfter', v_elo_p1_after,
      'eloGained', GREATEST(0, v_delta_p1),
      'eloLost', 0,
      'chest', v_cofre,
      'isAsyncMatch', TRUE
    );
  ELSE
    -- Derrota P1
    v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_opponent_rating, 0.0);
    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);

    -- Actualizar ELO de P1
    UPDATE public.profiles
       SET elo_rating = v_elo_p1_after
     WHERE id = v_room.player1_id;

    -- Actualizar W/L Stats de P1
    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_room.player1_id, 0, 1, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET losses = ranked_player_stats.losses + 1,
          updated_at = NOW();

    -- Auditoría de copas
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'clash-trophies-v1',
      'playerBefore', v_elo_p1_before,
      'opponentBefore', v_opponent_rating,
      'delta', v_delta_p1,
      'playerAfter', v_elo_p1_after,
      'isAsyncMatch', true
    );

    UPDATE public.game_rooms
       SET status = 'p2_won',
           settled_at = NOW(),
           verification_status = 'verified',
           verified_at = NOW(),
           server_winner_id = NULL,
           verification_note = 'server_verified_async',
           verification_payload = COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'authoritative', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'winnerSide', 2,
      'mode', 'ranked',
      'eloBefore', v_elo_p1_before,
      'opponentElo', v_opponent_rating,
      'eloDelta', v_delta_p1,
      'eloAfter', v_elo_p1_after,
      'eloGained', 0,
      'eloLost', GREATEST(0, -v_delta_p1),
      'isAsyncMatch', TRUE
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. SETTLEMENT DE SALAS (PVP HUMANO, COLISEO, AMISTOSO)
-- -----------------------------------------------------------------------------
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

  IF v_room.is_async_match = TRUE THEN
    RAISE EXCEPTION 'ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match';
  END IF;

  IF v_room.status IN ('p1_won', 'p2_won', 'draw', 'abandoned', 'cancelled') THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada', 'winner', v_room.server_winner_id);
  END IF;

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

  -- ── RANKED HUMANO (Clash Royale Trophies + Trophy Gates + W/L Records) ───────
  IF v_room.mode = 'ranked' THEN
    IF v_room.player2_id IS NULL THEN
      RAISE EXCEPTION 'Sala Ranked PvP inválida: player2_id es nulo';
    END IF;

    IF v_room.player1_id < v_room.player2_id THEN
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
    ELSE
      SELECT elo_rating INTO v_elo_p2_before FROM public.profiles WHERE id = v_room.player2_id FOR UPDATE;
      SELECT elo_rating INTO v_elo_p1_before FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;
    END IF;

    v_elo_p1_before := COALESCE(v_elo_p1_before, 1000);
    v_elo_p2_before := COALESCE(v_elo_p2_before, 1000);

    IF p_winner_id = v_room.player1_id THEN
      v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_elo_p2_before, 1.0);
      v_delta_p2 := public._ranked_elo_delta(v_elo_p2_before, v_elo_p1_before, 0.0);

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
      v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_elo_p2_before, 0.0);

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

    UPDATE public.profiles SET elo_rating = v_elo_p1_after WHERE id = v_room.player1_id;
    UPDATE public.profiles SET elo_rating = v_elo_p2_after WHERE id = v_room.player2_id;

    -- Cofre de victoria para el ganador
    v_cofre := public._award_victory_chest_for(p_winner_id);

    -- Auditoría ELO / Copas
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'clash-trophies-v1',
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
      'success', TRUE,
      'authoritative', TRUE,
      'status', 'liquidada',
      'winner', p_winner_id,
      'mode', 'ranked',
      'eloBefore', CASE WHEN p_winner_id = v_room.player1_id THEN v_elo_p1_before ELSE v_elo_p2_before END,
      'opponentElo', CASE WHEN p_winner_id = v_room.player1_id THEN v_elo_p2_before ELSE v_elo_p1_before END,
      'eloDelta', CASE WHEN p_winner_id = v_room.player1_id THEN v_delta_p1 ELSE v_delta_p2 END,
      'eloAfter', CASE WHEN p_winner_id = v_room.player1_id THEN v_elo_p1_after ELSE v_elo_p2_after END,
      'eloGained', CASE WHEN p_winner_id = v_room.player1_id THEN GREATEST(0, v_delta_p1) ELSE GREATEST(0, v_delta_p2) END,
      'eloLost', CASE WHEN p_winner_id = v_room.player1_id THEN GREATEST(0, -v_delta_p2) ELSE GREATEST(0, -v_delta_p1) END,
      'chest', v_cofre,
      'isAsyncMatch', FALSE
    );
  END IF;

  RETURN jsonb_build_object('success', FALSE, 'error', 'Modo no soportado');
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_room(UUID, UUID) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public._settle_room(UUID, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. SETTLEMENT DE EMPATES (settle_verified_draw)
-- -----------------------------------------------------------------------------
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

  IF v_room.status IN ('p1_won', 'p2_won', 'draw', 'abandoned', 'cancelled') THEN
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

      -- En empate el delta es 0
      v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_elo_p2_before, 0.5);
      v_delta_p2 := public._ranked_elo_delta(v_elo_p2_before, v_elo_p1_before, 0.5);
      v_elo_p1_after := v_elo_p1_before + v_delta_p1;
      v_elo_p2_after := v_elo_p2_before + v_delta_p2;

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 0, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET draws = ranked_player_stats.draws + 1, updated_at = NOW();

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player2_id, 0, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET draws = ranked_player_stats.draws + 1, updated_at = NOW();
    END IF;
  END IF;

  v_audit_elo := jsonb_build_object(
    'formulaVersion', 'clash-trophies-v1',
    'p1Before', v_elo_p1_before,
    'p2Before', v_elo_p2_before,
    'p1Delta', 0,
    'p2Delta', 0,
    'p1After', v_elo_p1_before,
    'p2After', v_elo_p2_before
  );

  UPDATE public.game_rooms
     SET status = 'draw',
         settled_at = NOW(),
         verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = NULL,
         verification_note = 'server_verified_draw',
         verification_payload = COALESCE(p_payload, '{}'::JSONB) || jsonb_build_object('elo', v_audit_elo)
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'authoritative', TRUE,
    'status', 'liquidada',
    'winner', NULL,
    'winnerSide', NULL,
    'mode', v_room.mode,
    'eloBefore', v_elo_p1_before,
    'opponentElo', v_elo_p2_before,
    'eloDelta', 0,
    'eloAfter', v_elo_p1_before,
    'eloGained', 0,
    'eloLost', 0,
    'isAsyncMatch', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. BLINDAJE EN claim_pack_slot: SIN FILTRO is_base = true
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pack_slot(p_slot_index INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user         UUID := auth.uid();
  v_slot         RECORD;
  v_drops        JSONB := '[]'::jsonb;
  v_roll         DOUBLE PRECISION;
  v_pool         TEXT[];
  v_rarity       TEXT;
  v_plant_id     TEXT;
  v_is_new       BOOLEAN;
  v_water        INTEGER := 0;
  v_fert         INTEGER := 0;
  v_gold         INTEGER := 0;
  v_nonplant     DOUBLE PRECISION;
  v_plant_chance DOUBLE PRECISION;
  v_plant_seen   BOOLEAN := FALSE;
  v_elo          INTEGER;
  v_arena        INTEGER;
  i              INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_slot_index IS NULL OR p_slot_index < 0 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'INVALID_SLOT_INDEX';
  END IF;

  SELECT * INTO v_slot
  FROM public.pack_slots
  WHERE user_id = v_user AND slot_index = p_slot_index
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  IF v_slot.status = 'empty' THEN
    RAISE EXCEPTION 'SLOT_IS_EMPTY';
  END IF;

  IF v_slot.status = 'locked' THEN
    RAISE EXCEPTION 'SLOT_IS_LOCKED';
  END IF;

  IF v_slot.status = 'unlocking' THEN
    IF v_slot.unlock_started_at IS NULL THEN
      RAISE EXCEPTION 'SLOT_NOT_READY';
    END IF;
    IF NOW() < v_slot.unlock_started_at + (v_slot.duration_hours || ' hours')::interval THEN
      RAISE EXCEPTION 'SLOT_NOT_READY';
    END IF;
  END IF;

  v_plant_chance := CASE WHEN v_slot.duration_hours = 6 THEN 0.75 ELSE 0.12 END;

  FOR i IN 1..3 LOOP
    v_roll := random();

    IF NOT v_plant_seen AND v_roll < v_plant_chance THEN
      v_plant_seen := TRUE;

      IF random() < 0.70 THEN
        v_pool := ARRAY['sunflower','peashooter','wallnut','chomper'];
        v_rarity := 'common';
      ELSE
        v_pool := ARRAY['garlic','bonkchoy','repeater','melonpult','squash'];
        v_rarity := 'uncommon';
      END IF;

      v_plant_id := v_pool[1 + floor(random() * array_length(v_pool, 1))::integer];

      -- COMPROBACIÓN SEGURA: si ya tiene CUALQUIER instancia de la planta, NO es nueva.
      SELECT NOT EXISTS (
        SELECT 1 FROM public.plant_instances
        WHERE owner_id = v_user AND plant_id = v_plant_id
      ) INTO v_is_new;

      IF v_is_new THEN
        INSERT INTO public.plant_instances (
          owner_id, plant_id, rarity, star_level, level, stat_rolls,
          is_base, is_in_deck, deck_slot, is_listed_for_sale
        ) VALUES (
          v_user, v_plant_id, v_rarity, 1, 0, '{}'::text[],
          TRUE, FALSE, NULL, FALSE
        );
      ELSE
        INSERT INTO public.plant_copies(user_id, plant_id, copies)
        VALUES (v_user, v_plant_id, 1)
        ON CONFLICT (user_id, plant_id)
        DO UPDATE SET copies = public.plant_copies.copies + 1;
      END IF;

      v_drops := v_drops || jsonb_build_array(jsonb_build_object(
        'type', 'plant',
        'plantId', v_plant_id,
        'rarity', v_rarity,
        'isNew', v_is_new,
        'quantity', 1
      ));
    ELSE
      v_nonplant := random() * 0.88;

      IF v_nonplant < 0.34 THEN
        v_water := v_water + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','water','quantity',1));
      ELSIF v_nonplant < 0.58 THEN
        v_fert := v_fert + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','fertilizer','quantity',1));
      ELSIF v_nonplant < 0.72 THEN
        v_gold := v_gold + 50;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','gold','quantity',50));
      ELSIF v_nonplant < 0.78 THEN
        v_gold := v_gold + 100;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','gold','quantity',100));
      ELSIF v_nonplant < 0.82 THEN
        v_water := v_water + 2;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','water','quantity',2));
      ELSIF v_nonplant < 0.85 THEN
        v_fert := v_fert + 2;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','fertilizer','quantity',2));
      ELSE
        v_gold := v_gold + 200;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','gold','quantity',200));
      END IF;
    END IF;
  END LOOP;

  IF v_water > 0 THEN
    INSERT INTO public.farm_inventory(user_id, item_id, quantity)
    VALUES (v_user, 'water', v_water)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = public.farm_inventory.quantity + EXCLUDED.quantity;
  END IF;

  IF v_fert > 0 THEN
    INSERT INTO public.farm_inventory(user_id, item_id, quantity)
    VALUES (v_user, 'fertilizer', v_fert)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = public.farm_inventory.quantity + EXCLUDED.quantity;
  END IF;

  IF v_gold > 0 THEN
    UPDATE public.profiles
    SET gold_balance = COALESCE(gold_balance, 0) + v_gold
    WHERE id = v_user;
  END IF;

  UPDATE public.pack_slots
  SET
    status = 'empty',
    unlock_started_at = NULL,
    duration_hours = 0,
    rarity = 'common',
    reward_type = 'pack',
    source = 'pvp_victory',
    updated_at = NOW()
  WHERE user_id = v_user AND slot_index = p_slot_index;

  RETURN jsonb_build_object(
    'success', TRUE,
    'drops', v_drops,
    'slotIndex', p_slot_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pack_slot(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pack_slot(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. AUDITORÍA DE MIGRACIÓN
-- -----------------------------------------------------------------------------
INSERT INTO public._migration_audit (fase, detalle)
VALUES (
  '61-clash-trophies-system',
  jsonb_build_object(
    'timestamp', NOW(),
    'arenas', jsonb_build_object(
      'arena1', '+15 / -5 (piso 1000)',
      'arena2', '+18 / -8 (piso 1600)',
      'arena3', '+20 / -12 (piso 2000)',
      'arena4', '+25 / -20 (piso 3000)',
      'arena5', '+30 / -30 (piso 4000)'
    ),
    'claim_pack_slot_fixed', TRUE
  )
);

COMMIT;
