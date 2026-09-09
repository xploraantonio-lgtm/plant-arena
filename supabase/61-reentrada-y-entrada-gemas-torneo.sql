-- =============================================================================
-- MIGRACIÓN 61: ENTRADA CONFIGURABLE (FREE / GEMAS) Y REENTRADA (3 GEMAS = 2 VIDAS)
-- =============================================================================

BEGIN;

-- 1. ACTUALIZAR RPC: create_tournament (Soporte de p_entry_fee_gems)
CREATE OR REPLACE FUNCTION public.create_tournament(
  p_title               TEXT,
  p_description         TEXT,
  p_prize_pool_gems     NUMERIC(12, 2) DEFAULT 0.00,
  p_start_time          TIMESTAMPTZ DEFAULT NOW(),
  p_duration_minutes    INTEGER DEFAULT 60,
  p_prize_distribution JSONB DEFAULT '{"top1": 50, "top2": 30, "top3": 20}'::jsonb,
  p_entry_fee_gems      NUMERIC(12, 2) DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_user       RECORD;
  v_clean_name TEXT;
  v_clean_desc TEXT;
  v_tourn_id   UUID;
  v_end_time   TIMESTAMPTZ;
  v_pool       NUMERIC(12, 2) := COALESCE(p_prize_pool_gems, 0.00);
  v_entry_fee  NUMERIC(12, 2) := COALESCE(p_entry_fee_gems, 0.00);
  v_duration   INTEGER := COALESCE(p_duration_minutes, 60);
  v_start_time TIMESTAMPTZ := COALESCE(p_start_time, NOW());
  v_status     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_clean_name := TRIM(COALESCE(p_title, ''));
  v_clean_desc := TRIM(COALESCE(p_description, ''));

  IF LENGTH(v_clean_name) < 3 OR LENGTH(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_TITLE_LENGTH';
  END IF;

  IF v_duration < 5 OR v_duration > 1440 THEN
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;

  IF v_pool < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_PRIZE_POOL';
  END IF;

  IF v_entry_fee < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_ENTRY_FEE';
  END IF;

  SELECT username, is_admin, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  -- Solo administradores pueden crear torneos
  IF v_user.is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'ONLY_ADMIN_CAN_CREATE_TOURNAMENTS';
  END IF;

  -- Si el creador aporta gemas al pozo inicial, validar y descontar
  IF v_pool > 0 THEN
    IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_pool THEN
      RAISE EXCEPTION 'INSUFFICIENT_GEMS';
    END IF;

    UPDATE public.profiles
       SET gems_balance = gems_balance - v_pool,
           updated_at   = NOW()
     WHERE id = v_uid;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'tournament_create_fund', v_pool, 'Fondeo de pozo de torneo: ' || v_clean_name, 'completed');
  END IF;

  -- Calcular fin del torneo
  v_end_time := v_start_time + (v_duration || ' minutes')::INTERVAL;

  IF NOW() >= v_start_time AND NOW() < v_end_time THEN
    v_status := 'live';
  ELSIF NOW() >= v_end_time THEN
    v_status := 'ended';
  ELSE
    v_status := 'scheduled';
  END IF;

  INSERT INTO public.tournaments (
    title, description, creator_id, creator_name, prize_pool_gems,
    prize_distribution, status, entry_fee_gems, start_time, end_time,
    duration_minutes, max_losses, prizes_distributed
  ) VALUES (
    v_clean_name, v_clean_desc, v_uid, COALESCE(v_user.username, 'Organizador'),
    v_pool, COALESCE(p_prize_distribution, '{"top1": 50, "top2": 30, "top3": 20}'::jsonb),
    v_status, v_entry_fee, v_start_time, v_end_time, v_duration, 3, FALSE
  ) RETURNING id INTO v_tourn_id;

  -- Inscribir automáticamente al creador con mazo inicial
  INSERT INTO public.tournament_participants (
    tournament_id, user_id, username, deck, wins, losses, is_eliminated
  ) VALUES (
    v_tourn_id, v_uid, COALESCE(v_user.username, 'Organizador'),
    '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb,
    0, 0, FALSE
  ) ON CONFLICT (tournament_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', v_tourn_id,
    'title', v_clean_name,
    'prize_pool_gems', v_pool,
    'entry_fee_gems', v_entry_fee,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'status', v_status
  );
END;
$$;

-- 2. ACTUALIZAR RPC: register_tournament_participant (Cobro autoritativo de entrada con gemas)
CREATE OR REPLACE FUNCTION public.register_tournament_participant(
  p_tournament_id UUID,
  p_deck          JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_user      RECORD;
  v_tourn     RECORD;
  v_deck      JSONB;
  v_part_id   UUID;
  v_fee       NUMERIC(12, 2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  IF v_tourn.status = 'ended' OR v_tourn.status = 'cancelled' OR NOW() >= v_tourn.end_time THEN
    RAISE EXCEPTION 'TOURNAMENT_CLOSED';
  END IF;

  -- Si ya estaba registrado, no cobrar nuevamente
  IF EXISTS (
    SELECT 1 FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'ALREADY_REGISTERED',
      'tournament_id', p_tournament_id
    );
  END IF;

  v_fee := COALESCE(v_tourn.entry_fee_gems, 0.00);

  SELECT username, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  -- Si la entrada requiere gemas, validar y cobrar autoritativamente
  IF v_fee > 0 THEN
    IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_fee THEN
      RAISE EXCEPTION 'INSUFFICIENT_GEMS_FOR_ENTRY';
    END IF;

    UPDATE public.profiles
       SET gems_balance = gems_balance - v_fee,
           updated_at   = NOW()
     WHERE id = v_uid;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_uid, 'tournament_entry_fee', v_fee,
      'Entrada a torneo: ' || v_tourn.title, 'completed'
    );

    -- Sumar la entrada al pozo del torneo para alimentar los premios
    UPDATE public.tournaments
       SET prize_pool_gems = prize_pool_gems + v_fee,
           updated_at      = NOW()
     WHERE id = p_tournament_id;
  END IF;

  -- Si se pasa un mazo personalizado, validarlo
  IF p_deck IS NOT NULL THEN
    IF NOT public._validate_tournament_deck(p_deck) THEN
      RAISE EXCEPTION 'INVALID_TOURNAMENT_DECK';
    END IF;
    v_deck := p_deck;
  ELSE
    v_deck := '["sunflower","peashooter","wallnut","chomper","repeater"]'::jsonb;
  END IF;

  INSERT INTO public.tournament_participants (
    tournament_id, user_id, username, deck, wins, losses, is_eliminated
  ) VALUES (
    p_tournament_id, v_uid, COALESCE(v_user.username, 'Jugador'),
    v_deck, 0, 0, FALSE
  )
  ON CONFLICT (tournament_id, user_id) DO UPDATE
    SET username = EXCLUDED.username
  RETURNING id INTO v_part_id;

  RETURN jsonb_build_object(
    'success', true,
    'participant_id', v_part_id,
    'tournament_id', p_tournament_id,
    'deck', v_deck,
    'wins', 0,
    'losses', 0,
    'is_eliminated', false,
    'fee_paid_gems', v_fee
  );
END;
$$;

-- 3. NUEVA RPC: reenter_tournament (3 Gemas por 2 Vidas)
CREATE OR REPLACE FUNCTION public.reenter_tournament(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_tourn        RECORD;
  v_user         RECORD;
  v_part         RECORD;
  v_reentry_cost NUMERIC(12, 2) := 3.00;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_tourn
  FROM public.tournaments
  WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';
  END IF;

  -- Solo se puede reentrar en torneos activos / en vivo
  IF v_tourn.status = 'ended' OR v_tourn.status = 'cancelled' OR v_now >= v_tourn.end_time THEN
    RAISE EXCEPTION 'TOURNAMENT_CLOSED';
  END IF;

  -- Buscar al participante
  SELECT * INTO v_part
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_REGISTERED';
  END IF;

  -- Debe estar eliminado para reentrar
  IF NOT v_part.is_eliminated AND v_part.losses < v_tourn.max_losses THEN
    RAISE EXCEPTION 'PLAYER_NOT_ELIMINATED';
  END IF;

  -- Validar saldo del jugador
  SELECT username, gems_balance INTO v_user
  FROM public.profiles
  WHERE id = v_uid FOR UPDATE;

  IF v_user.gems_balance IS NULL OR v_user.gems_balance < v_reentry_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS_FOR_REENTRY';
  END IF;

  -- Descontar las 3 gemas de reentrada
  UPDATE public.profiles
     SET gems_balance = gems_balance - v_reentry_cost,
         updated_at   = v_now
   WHERE id = v_uid;

  -- Registrar transacción (ingreso para el pool general del juego)
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (
    v_uid, 'tournament_reentry', v_reentry_cost,
    'Reentrada (2 vidas) en torneo: ' || v_tourn.title, 'completed'
  );

  -- Otorgar 2 vidas: con max_losses = 3, tener 2 vidas equivale a 1 derrota (3 - 2 = 1)
  -- El jugador conserva todas sus victorias previas para la tabla de clasificación
  UPDATE public.tournament_participants
     SET is_eliminated = FALSE,
         losses        = 1,
         updated_at    = v_now
   WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'tournament_id', p_tournament_id,
    'wins', v_part.wins,
    'losses', 1,
    'lives', 2,
    'is_eliminated', false,
    'cost_gems', v_reentry_cost
  );
END;
$$;

COMMIT;
