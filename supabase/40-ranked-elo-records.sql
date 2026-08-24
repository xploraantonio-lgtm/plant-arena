-- =============================================================================
-- 40-RANKED-ELO-RECORDS.SQL
-- =============================================================================
-- SISTEMA ELO CANÓNICO JUGADOR-VS-RIVAL + ESTADÍSTICAS W/L AUTORITATIVAS
--
-- CARACTERÍSTICAS:
-- 1. Fórmula ELO clásica estándar (K=32) para todos los enfrentamientos Ranked:
--      expected = 1 / (1 + 10 ^ ((opponentRating - playerRating) / 400))
--      delta = ROUND(32 * (score - expected))
-- 2. Paridad absoluta entre PvP humano y Rival Semilla (usando async_rating_snapshot).
-- 3. Tabla de estadísticas server-only 'ranked_player_stats' (wins, losses, draws).
-- 4. Actualización atómica de ELO y W/L en el settlement del servidor.
-- 5. Cero mutación de ELO ni estadísticas en la cuenta creadora de semillas.
-- 6. Vista 'leaderboard' con orden determinista (ROW_NUMBER) y métricas W/L reales.
-- 7. Backfill idempotente de W/L desde salas verificadas oficiales.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLA DE ESTADÍSTICAS RANKED SERVER-ONLY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ranked_player_stats (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  wins       BIGINT NOT NULL DEFAULT 0,
  losses     BIGINT NOT NULL DEFAULT 0,
  draws      BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ranked_stats_non_negative CHECK (wins >= 0 AND losses >= 0 AND draws >= 0)
);

ALTER TABLE public.ranked_player_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select for all on ranked_player_stats" ON public.ranked_player_stats;
CREATE POLICY "Allow select for all on ranked_player_stats"
  ON public.ranked_player_stats
  FOR SELECT
  TO PUBLIC, anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.ranked_player_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ranked_player_stats TO service_role;

-- -----------------------------------------------------------------------------
-- 2. HELPER SERVER-ONLY: FÓRMULA ELO RANKED CANÓNICA (K=32)
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
  v_k CONSTANT INTEGER := 32;
  v_p INTEGER;
  v_o INTEGER;
  v_expected NUMERIC;
  v_delta INTEGER;
BEGIN
  v_p := GREATEST(0, COALESCE(p_player_rating, 1000));
  v_o := GREATEST(0, COALESCE(p_opponent_rating, 1000));
  v_expected := 1.0 / (1.0 + POWER(10.0, (v_o - v_p)::NUMERIC / 400.0));
  v_delta := ROUND(v_k * (p_score - v_expected));
  RETURN v_delta;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._ranked_elo_delta(INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ranked_elo_delta(INTEGER, INTEGER, NUMERIC) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. SETTLEMENT AUTORITATIVO PARA PARTIDAS ASÍNCRONAS (RIVAL SEMILLA)
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
  IF v_room.engine_version <> 'auth-v1' THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;
  IF NOT v_room.is_async_match THEN RAISE EXCEPTION 'Esta función es exclusiva para partidas asíncronas'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'ya_liquidada',
      'winner', v_room.server_winner_id,
      'winnerSide', CASE WHEN v_room.status = 'p1_won' THEN 1 WHEN v_room.status = 'p2_won' THEN 2 ELSE NULL END,
      'isAsyncMatch', TRUE
    );
  END IF;

  IF p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winner_side debe ser 1 (p1) o 2 (p2/rival)';
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  -- Bloquear perfil de P1
  SELECT elo_rating INTO v_elo_p1_before
    FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;

  -- Rating del rival congelado al crear la sala
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

    -- Actualizar W/L Stats de P1 (creador de seed queda 100% inalterado)
    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_room.player1_id, 1, 0, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET wins = ranked_player_stats.wins + 1,
          updated_at = NOW();

    -- Auditoría ELO
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
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

    -- Auditoría ELO
    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
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
      'eloLost', ABS(v_delta_p1),
      'isAsyncMatch', TRUE
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. SETTLEMENT DE SALAS (PVP HUMANO, COLISEO, AMISTOSO)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settle_room(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room             RECORD;
  v_perdedor         UUID;
  v_pozo             NUMERIC := 0;
  v_pago             NUMERIC := 0;
  v_elo_p1_before    INTEGER;
  v_elo_p2_before    INTEGER;
  v_delta_p1         INTEGER := 0;
  v_delta_p2         INTEGER := 0;
  v_elo_p1_after     INTEGER;
  v_elo_p2_after     INTEGER;
  v_cofre            JSONB := NULL;
  v_audit_elo        JSONB := NULL;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Partida ya liquidada'; END IF;

  v_perdedor := CASE WHEN p_winner_id = v_room.player1_id
                     THEN v_room.player2_id ELSE v_room.player1_id END;

  -- ── AMISTOSO ──────────────────────────────────────────────────────────────
  IF v_room.mode = 'friendly' THEN
    SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo
      FROM public.colosseum_escrow
     WHERE room_id = p_room_id AND status = 'held';

    IF v_pozo > 0 THEN
      UPDATE public.profiles SET gems_balance = gems_balance + v_pozo
       WHERE id = p_winner_id;

      INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
      VALUES (p_winner_id, 'friendly_win', v_pozo,
              'Duelo amistoso ganado (el 100 % de lo apostado)', 'completed');

      UPDATE public.colosseum_escrow
         SET status = 'settled' WHERE room_id = p_room_id AND status = 'held';
    END IF;

    UPDATE public.game_rooms
       SET status = CASE WHEN p_winner_id = player1_id THEN 'p1_won' ELSE 'p2_won' END,
           settled_at = NOW()
     WHERE id = p_room_id;

    RETURN jsonb_build_object('success', TRUE, 'status', 'liquidada',
                              'winner', p_winner_id, 'mode', 'friendly',
                              'eloGained', 0, 'eloLost', 0, 'payout', v_pozo);
  END IF;

  -- ── COLISEO (Mantiene sistema legacy de tramos) ───────────────────────────
  IF v_room.mode = 'colosseum' THEN
    -- Bloquear perfiles en orden determinista por UUID
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

    UPDATE public.profiles
       SET colosseum_current_streak = 0,
           elo_rating               = CASE WHEN id = v_room.player1_id THEN v_elo_p1_after ELSE v_elo_p2_after END
     WHERE id = v_perdedor;

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

      -- Actualizar W/L Stats
      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 1, 0, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET wins = ranked_player_stats.wins + 1, updated_at = NOW();

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player2_id, 0, 1, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET losses = ranked_player_stats.losses + 1, updated_at = NOW();
    ELSE
      v_delta_p2 := public._ranked_elo_delta(v_elo_p2_before, v_elo_p1_before, 1.0);
      v_delta_p1 := -v_delta_p2;

      -- Actualizar W/L Stats
      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player2_id, 1, 0, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET wins = ranked_player_stats.wins + 1, updated_at = NOW();

      INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
      VALUES (v_room.player1_id, 0, 1, 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET losses = ranked_player_stats.losses + 1, updated_at = NOW();
    END IF;

    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);
    v_elo_p2_after := GREATEST(0, v_elo_p2_before + v_delta_p2);

    -- Actualizar ELO de ambos jugadores en la misma transacción
    UPDATE public.profiles SET elo_rating = v_elo_p1_after WHERE id = v_room.player1_id;
    UPDATE public.profiles SET elo_rating = v_elo_p2_after WHERE id = v_room.player2_id;

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
      'eloLost', 0,
      'chest', v_cofre,
      'p1EloBefore', v_elo_p1_before,
      'p1EloDelta', v_delta_p1,
      'p1EloAfter', v_elo_p1_after,
      'p2EloBefore', v_elo_p2_before,
      'p2EloDelta', v_delta_p2,
      'p2EloAfter', v_elo_p2_after
    );
  END IF;

  RAISE EXCEPTION 'Modo de sala desconocido: %', v_room.mode;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_room(UUID, UUID) FROM anon, authenticated, PUBLIC;

-- -----------------------------------------------------------------------------
-- 5. SETTLEMENT AUTORITATIVO PARA EMPATE VERIFICADO (TRUE DRAW)
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
  v_room             RECORD;
  v_elo_p1_before    INTEGER;
  v_elo_p2_before    INTEGER;
  v_delta_p1         INTEGER := 0;
  v_delta_p2         INTEGER := 0;
  v_elo_p1_after     INTEGER;
  v_elo_p2_after     INTEGER;
  v_audit_elo        JSONB := NULL;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version <> 'auth-v1' THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;
  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  -- Reembolso de Coliseo si aplica
  IF v_room.mode = 'colosseum' THEN
    UPDATE public.profiles p
       SET gems_balance = p.gems_balance + e.bet_gems
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held'
       AND e.paid_with = 'gems' AND p.id = e.user_id;

    UPDATE public.profiles p
       SET colosseum_tickets = p.colosseum_tickets + 1
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held'
       AND e.paid_with = 'ticket' AND p.id = e.user_id;

    INSERT INTO public.transactions(user_id, type, amount_gems, description, status)
    SELECT e.user_id, 'colosseum_refund',
           CASE WHEN e.paid_with = 'ticket' THEN 0 ELSE e.bet_gems END,
           'Devolución: empate perfecto verificado por servidor', 'completed'
      FROM public.colosseum_escrow e
     WHERE e.room_id = p_room_id AND e.status = 'held';

    UPDATE public.colosseum_escrow
       SET status = 'refunded', refunded_at = NOW()
     WHERE room_id = p_room_id AND status = 'held';
  END IF;

  -- Modo Ranked: ELO y W/L para empate (score 0.5)
  IF v_room.mode = 'ranked' AND NOT v_room.is_async_match THEN
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

    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
      'draw', true,
      'p1Before', v_elo_p1_before,
      'p2Before', v_elo_p2_before,
      'p1Delta', v_delta_p1,
      'p2Delta', v_delta_p2,
      'p1After', v_elo_p1_after,
      'p2After', v_elo_p2_after
    );
  END IF;

  UPDATE public.game_rooms
     SET status = 'draw',
         settled_at = NOW(),
         verification_status = 'verified',
         verified_at = NOW(),
         server_winner_id = NULL,
         verification_note = 'server_verified_true_draw',
         verification_payload = COALESCE(p_payload, '{}'::JSONB) || CASE WHEN v_audit_elo IS NOT NULL THEN jsonb_build_object('elo', v_audit_elo) ELSE '{}'::JSONB END
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'draw',
    'authoritative', TRUE,
    'refunded', v_room.mode = 'colosseum',
    'p1EloDelta', v_delta_p1,
    'p2EloDelta', v_delta_p2
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_draw(UUID, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. SURRENDER DE PARTIDA (ACTUALIZACIÓN RANKED)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.surrender_match(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_room             RECORD;
  v_rival            UUID;
  v_result           JSONB;
  v_elo_p1_before    INTEGER;
  v_opponent_rating  INTEGER;
  v_delta_p1         INTEGER;
  v_elo_p1_after     INTEGER;
  v_audit_elo        JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN RAISE EXCEPTION 'No participas en esta partida'; END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN RAISE EXCEPTION 'No participas en esta partida'; END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status IN ('verifying', 'failed') THEN
    RAISE EXCEPTION 'La partida está cerrada para verificación';
  END IF;

  -- ── CASO ASÍNCRONO ────────────────────────────────────────────────────────
  IF v_room.is_async_match THEN
    SELECT elo_rating INTO v_elo_p1_before
      FROM public.profiles WHERE id = v_uid FOR UPDATE;

    v_opponent_rating := COALESCE(v_room.async_rating_snapshot, 1000);
    v_delta_p1 := public._ranked_elo_delta(v_elo_p1_before, v_opponent_rating, 0.0);
    v_elo_p1_after := GREATEST(0, v_elo_p1_before + v_delta_p1);

    UPDATE public.profiles
       SET elo_rating = v_elo_p1_after
     WHERE id = v_uid;

    INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
    VALUES (v_uid, 0, 1, 0, NOW())
    ON CONFLICT (user_id) DO UPDATE SET losses = ranked_player_stats.losses + 1, updated_at = NOW();

    v_audit_elo := jsonb_build_object(
      'formulaVersion', 'ranked-elo-v1',
      'k', 32,
      'surrender', true,
      'playerBefore', v_elo_p1_before,
      'opponentBefore', v_opponent_rating,
      'delta', v_delta_p1,
      'playerAfter', v_elo_p1_after,
      'isAsyncMatch', true
    );

    UPDATE public.game_rooms
       SET status = 'p2_won',
           settled_at = NOW(),
           server_winner_id = NULL,
           verification_status = 'verified',
           verified_at = NOW(),
           verification_note = 'server_verified_surrender',
           verification_payload = jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid,
             'elo', v_audit_elo
           )
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'mode', 'ranked',
      'eloBefore', v_elo_p1_before,
      'opponentElo', v_opponent_rating,
      'eloDelta', v_delta_p1,
      'eloAfter', v_elo_p1_after,
      'eloGained', 0,
      'eloLost', ABS(v_delta_p1),
      'authoritative', TRUE,
      'reason', 'surrender',
      'isAsyncMatch', TRUE
    );
  END IF;

  -- ── CASO HUMANO VS HUMANO ──────────────────────────────────────────────────
  v_rival := CASE WHEN v_uid = v_room.player1_id
                  THEN v_room.player2_id ELSE v_room.player1_id END;

  UPDATE public.game_rooms
     SET p1_reported_winner = v_rival,
         p2_reported_winner = v_rival
   WHERE id = p_room_id;

  v_result := public._settle_room(p_room_id, v_rival);

  IF v_room.engine_version = 'auth-v1' THEN
    UPDATE public.game_rooms
       SET verification_status = 'verified',
           verification_requested_at = COALESCE(verification_requested_at, NOW()),
           verification_started_at = COALESCE(verification_started_at, NOW()),
           verified_at = NOW(),
           server_winner_id = v_rival,
           verification_note = 'server_verified_surrender',
           verification_payload = COALESCE(verification_payload, '{}'::JSONB) || jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid
           )
     WHERE id = p_room_id;
  END IF;

  RETURN v_result || jsonb_build_object(
    'authoritative', v_room.engine_version = 'auth-v1',
    'reason', 'surrender'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.surrender_match(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.surrender_match(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. VISTA leaderboard DETERMINISTA Y CON ESTADÍSTICAS W/L
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT 
    p.id,
    p.username,
    p.avatar_id,
    p.country,
    p.elo_rating,
    p.colosseum_current_streak,
    p.colosseum_max_streak,
    p.created_at,
    COALESCE(s.wins, 0)::BIGINT AS ranked_wins,
    COALESCE(s.losses, 0)::BIGINT AS ranked_losses,
    COALESCE(s.draws, 0)::BIGINT AS ranked_draws,
    (COALESCE(s.wins, 0) + COALESCE(s.losses, 0) + COALESCE(s.draws, 0))::BIGINT AS ranked_games,
    CASE 
      WHEN (COALESCE(s.wins, 0) + COALESCE(s.losses, 0)) = 0 THEN 0.0
      ELSE ROUND((COALESCE(s.wins, 0)::NUMERIC * 100.0) / (COALESCE(s.wins, 0) + COALESCE(s.losses, 0))::NUMERIC, 1)
    END AS ranked_win_rate,
    ROW_NUMBER() OVER (
      ORDER BY 
        p.elo_rating DESC,
        COALESCE(s.wins, 0) DESC,
        p.created_at ASC,
        p.id ASC
    )::BIGINT AS rank_position
FROM public.profiles p
LEFT JOIN public.ranked_player_stats s ON s.user_id = p.id
WHERE NOT COALESCE(p.exclude_from_ranking, false);

GRANT SELECT ON public.leaderboard TO PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. BACKFILL IDEMPOTENTE DE ESTADÍSTICAS W/L DESDE PARTIDAS VERIFICADAS
-- -----------------------------------------------------------------------------
-- Inicializar todas las cuentas
INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)
SELECT id, 0, 0, 0, NOW()
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- Calcular conteos exactos de partidas verificadas oficiales
WITH official_rooms AS (
  SELECT 
    id,
    mode,
    is_async_match,
    player1_id,
    player2_id,
    status,
    server_winner_id
  FROM public.game_rooms
  WHERE mode = 'ranked'
    AND settled_at IS NOT NULL
    AND verification_status = 'verified'
    AND status IN ('p1_won', 'p2_won', 'draw')
),
player_events AS (
  -- P1 en partidas humanas o async
  SELECT 
    player1_id AS user_id,
    CASE WHEN status = 'p1_won' THEN 1 ELSE 0 END AS win_cnt,
    CASE WHEN status = 'p2_won' THEN 1 ELSE 0 END AS loss_cnt,
    CASE WHEN status = 'draw' THEN 1 ELSE 0 END AS draw_cnt
  FROM official_rooms
  WHERE player1_id IS NOT NULL

  UNION ALL

  -- P2 sólo en partidas humanas
  SELECT 
    player2_id AS user_id,
    CASE WHEN status = 'p2_won' THEN 1 ELSE 0 END AS win_cnt,
    CASE WHEN status = 'p1_won' THEN 1 ELSE 0 END AS loss_cnt,
    CASE WHEN status = 'draw' THEN 1 ELSE 0 END AS draw_cnt
  FROM official_rooms
  WHERE is_async_match = false AND player2_id IS NOT NULL
),
aggregated_stats AS (
  SELECT 
    user_id,
    SUM(win_cnt)::BIGINT AS total_wins,
    SUM(loss_cnt)::BIGINT AS total_losses,
    SUM(draw_cnt)::BIGINT AS total_draws
  FROM player_events
  GROUP BY user_id
)
UPDATE public.ranked_player_stats s
SET 
  wins = COALESCE(a.total_wins, 0),
  losses = COALESCE(a.total_losses, 0),
  draws = COALESCE(a.total_draws, 0),
  updated_at = NOW()
FROM public.profiles p
LEFT JOIN aggregated_stats a ON a.user_id = p.id
WHERE s.user_id = p.id;

-- -----------------------------------------------------------------------------
-- 9. REGISTRO EN AUDITORÍA DE MIGRACIONES
-- -----------------------------------------------------------------------------
INSERT INTO public._migration_audit (migration_name, executed_at, details)
VALUES (
  '40_ranked_elo_records',
  NOW(),
  jsonb_build_object(
    'description', 'Sistema ELO canónico jugador-vs-rival K=32 + estadísticas W/L server-authoritative y leaderboard determinista',
    'formula', 'expected = 1 / (1 + 10 ^ ((opponent - player)/400)), delta = ROUND(32 * (score - expected))',
    'k', 32
  )
);
