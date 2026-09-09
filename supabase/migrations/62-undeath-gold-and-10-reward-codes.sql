-- =============================================================================
-- MIGRACIÓN 62: SOPORTE DE RECOMPENSAS DIRECTAS (ORO O CARTA) Y 10 CÓDIGOS
--
-- NOTA IMPORTANTE:
-- 1. No incluye la asignación de 2,000 de oro a 'Undeath' porque ya fue asignada.
-- 2. Cada código otorga ESTRICTAMENTE CARTA U ORO (no los dos).
-- 3. Se ofrecen más opciones de Oro (7 códigos de oro con montos variados)
--    y códigos de cartas Comunes y Poco Comunes.
-- 4. Soporta hasta 50 usos por código (cada jugador solo puede canjearlo 1 vez).
-- =============================================================================

BEGIN;

-- ── 1. EXPANDIR TIPOS DE RECOMPENSA EN public.reward_codes ─────────────────────
ALTER TABLE public.reward_codes DROP CONSTRAINT IF EXISTS reward_codes_reward_type_check;
ALTER TABLE public.reward_codes ADD CONSTRAINT reward_codes_reward_type_check 
  CHECK (reward_type IN ('pvp_pack', 'gold', 'plant'));

ALTER TABLE public.reward_codes ADD COLUMN IF NOT EXISTS reward_plant_id TEXT;


-- ── 2. ACTUALIZAR RPC claim_reward_code (ORO DIRECTO O CARTA DIRECTA) ───────────
CREATE OR REPLACE FUNCTION public.claim_reward_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_clean_code TEXT;
  v_code_row   RECORD;
  v_elo        INTEGER;
  v_arena      INTEGER;
  v_pack_id    UUID;
  v_plant_id   TEXT;
  v_rarity     TEXT;
  v_is_new     BOOLEAN;
  v_gold_amt   BIGINT;
BEGIN
  -- 1. Validar autenticación
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Normalizar código
  v_clean_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'CODE_EMPTY';
  END IF;

  -- 3. Buscar y bloquear fila
  SELECT * INTO v_code_row
    FROM public.reward_codes
   WHERE normalized_code = v_clean_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CODE_NOT_FOUND';
  END IF;

  IF v_code_row.active = FALSE THEN
    RAISE EXCEPTION 'CODE_DISABLED';
  END IF;

  IF v_code_row.expires_at IS NOT NULL AND NOW() > v_code_row.expires_at THEN
    RAISE EXCEPTION 'CODE_EXPIRED';
  END IF;

  -- 4. Validar que este usuario no lo haya canjeado antes
  IF EXISTS (
    SELECT 1 FROM public.reward_code_claims
     WHERE user_id = v_uid AND reward_code_id = v_code_row.id
  ) THEN
    RAISE EXCEPTION 'CODE_ALREADY_CLAIMED';
  END IF;

  IF v_code_row.used_count >= v_code_row.max_uses THEN
    RAISE EXCEPTION 'CODE_LIMIT_REACHED';
  END IF;

  -- 5. Procesar entrega según tipo de recompensa (SOLO ORO O SOLO CARTA)

  -- RECOMPENSA TIPO 1: SOLO ORO DIRECTO
  IF v_code_row.reward_type = 'gold' THEN
    v_gold_amt := COALESCE(v_code_row.reward_value, 100);

    UPDATE public.profiles
       SET gold_balance = COALESCE(gold_balance, 0) + v_gold_amt,
           updated_at = NOW()
     WHERE id = v_uid;

    INSERT INTO public.reward_code_claims (user_id, reward_code_id, claimed_at)
    VALUES (v_uid, v_code_row.id, NOW());

    UPDATE public.reward_codes
       SET used_count = used_count + 1
     WHERE id = v_code_row.id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'code', v_clean_code,
      'rewardType', 'gold',
      'goldAmount', v_gold_amt,
      'message', format('¡Has recibido +%s de Oro!', v_gold_amt)
    );

  -- RECOMPENSA TIPO 2: SOLO CARTA DIRECTA
  ELSIF v_code_row.reward_type = 'plant' THEN
    v_plant_id := v_code_row.reward_plant_id;
    IF v_plant_id IS NULL OR v_plant_id = '' THEN
      v_plant_id := 'peashooter';
    END IF;

    -- Rareza catalogada
    v_rarity := CASE 
      WHEN v_plant_id IN ('garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash', 'snowpea') THEN 'uncommon'
      WHEN v_plant_id IN ('jalapeno', 'potatomine', 'cherrybomb') THEN 'rare'
      WHEN v_plant_id IN ('cattail', 'gatlingpea', 'doomshroom') THEN 'epic'
      WHEN v_plant_id IN ('cobcannon', 'goldensunflower') THEN 'legendary'
      ELSE 'common'
    END;

    -- Comprobar si ya tiene una instancia de esta planta
    SELECT NOT EXISTS (
      SELECT 1 FROM public.plant_instances
      WHERE owner_id = v_uid AND plant_id = v_plant_id
    ) INTO v_is_new;

    IF v_is_new THEN
      INSERT INTO public.plant_instances (
        owner_id, plant_id, rarity, star_level, level, stat_rolls,
        is_base, is_in_deck, deck_slot, is_listed_for_sale
      ) VALUES (
        v_uid, v_plant_id, v_rarity, 1, 0, '{}'::text[],
        TRUE, FALSE, NULL, FALSE
      );
    ELSE
      INSERT INTO public.plant_copies (user_id, plant_id, copies)
      VALUES (v_uid, v_plant_id, 1)
      ON CONFLICT (user_id, plant_id)
      DO UPDATE SET copies = public.plant_copies.copies + 1;
    END IF;

    INSERT INTO public.reward_code_claims (user_id, reward_code_id, claimed_at)
    VALUES (v_uid, v_code_row.id, NOW());

    UPDATE public.reward_codes
       SET used_count = used_count + 1
     WHERE id = v_code_row.id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'code', v_clean_code,
      'rewardType', 'plant',
      'plantId', v_plant_id,
      'rarity', v_rarity,
      'isNew', v_is_new,
      'message', format('¡Has recibido la carta %s (%s)!', v_plant_id, v_rarity)
    );

  -- RECOMPENSA TIPO 3: SOBRE PvP PENDIENTE EN JARDÍN
  ELSE
    SELECT elo_rating INTO v_elo FROM public.profiles WHERE id = v_uid;
    v_arena := CASE
      WHEN COALESCE(v_elo, 1000) >= 3100 THEN 5
      WHEN COALESCE(v_elo, 1000) >= 2050 THEN 4
      WHEN COALESCE(v_elo, 1000) >= 1750 THEN 3
      WHEN COALESCE(v_elo, 1000) >= 1600 THEN 2
      ELSE 1
    END;

    INSERT INTO public.player_reward_packs
      (user_id, reward_code_id, source, status, duration_hours, arena_level, unlock_started_at)
    VALUES
      (v_uid, v_code_row.id, 'streamer_code', 'pending', NULL, v_arena, NULL)
    RETURNING id INTO v_pack_id;

    INSERT INTO public.reward_code_claims (user_id, reward_code_id, claimed_at)
    VALUES (v_uid, v_code_row.id, NOW());

    UPDATE public.reward_codes
       SET used_count = used_count + 1
     WHERE id = v_code_row.id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'code', v_clean_code,
      'rewardType', 'pvp_pack',
      'packId', v_pack_id,
      'status', 'pending',
      'arenaLevel', v_arena
    );
  END IF;
END;
$$;


-- ── 3. INSERCIÓN DE CÓDIGOS DE RECOMPENSA (SOLO ORO O SOLO CARTA) ──────────────
INSERT INTO public.reward_codes (code, normalized_code, reward_type, reward_value, reward_plant_id, max_uses, used_count, active)
VALUES
  -- ── OPCIONES DE SOLO ORO (7 CÓDIGOS CON MONTOS VARIADOS) ─────────────────────
  -- Código 1: Gran Bolsa de Oro
  ('UNDEATHGOLD',  'UNDEATHGOLD',  'gold',  500, NULL, 50, 0, TRUE),

  -- Código 2: Cofre de Oro 2026
  ('OROVERDE2026', 'OROVERDE2026', 'gold',  400, NULL, 50, 0, TRUE),

  -- Código 3: Impulso de Oro de Arena
  ('ARENABOOST',   'ARENABOOST',   'gold',  350, NULL, 50, 0, TRUE),

  -- Código 4: Tesoro Verde de Oro
  ('TESOROVERDE',  'TESOROVERDE',  'gold',  300, NULL, 50, 0, TRUE),

  -- Código 5: Monedas Solares de Girasol
  ('GIRASOLCOINS', 'GIRASOLCOINS', 'gold',  250, NULL, 50, 0, TRUE),

  -- Código 6: Bolsa de Monedas de Batalla
  ('PVPCHESTX',    'PVPCHESTX',    'gold',  200, NULL, 50, 0, TRUE),

  -- Código 7: Fortuna de Oro Inicial
  ('FORTUNAGOLD',  'FORTUNAGOLD',  'gold',  150, NULL, 50, 0, TRUE),

  -- ── OPCIONES DE SOLO CARTAS (POCO COMUNES Y COMUNES) ─────────────────────────
  -- Código 8: Carta Poco Común Bonk Choy (Luchador cuerpo a cuerpo)
  ('POCOCOMUN77',  'POCOCOMUN77',  'plant', 1, 'bonkchoy', 50, 0, TRUE),

  -- Código 9: Carta Poco Común Repetidora (Doble disparo)
  ('BONUSGUISANTE','BONUSGUISANTE','plant', 1, 'repeater', 50, 0, TRUE),

  -- Código 10: Carta Común Lanzaguisantes
  ('PLANTCOMUN1',  'PLANTCOMUN1',  'plant', 1, 'peashooter', 50, 0, TRUE),

  -- Código Extra: Carta Común Defensiva Nuez
  ('NUEZFORTUNA',  'NUEZFORTUNA',  'plant', 1, 'wallnut', 50, 0, TRUE)

ON CONFLICT (normalized_code) DO UPDATE
  SET reward_type     = EXCLUDED.reward_type,
      reward_value    = EXCLUDED.reward_value,
      reward_plant_id = EXCLUDED.reward_plant_id,
      active          = TRUE,
      max_uses        = EXCLUDED.max_uses;

COMMIT;
