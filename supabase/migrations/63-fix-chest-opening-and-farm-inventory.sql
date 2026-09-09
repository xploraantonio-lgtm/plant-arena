-- =============================================================================
-- MIGRACIÓN 63: CORRECCIÓN CRÍTICA DE APERTURA DE COFRES (SLOTS Y JARDÍN)
--
-- PROBLEMA IDENTIFICADO:
-- 1. En la migración 61, claim_pack_slot intentaba hacer INSERT en una tabla
--    inexistente 'public.farm_inventory'. En Supabase, el inventario de farming
--    se almacena en la columna JSONB 'profiles.farming_inventory'. Esto hacía
--    que al abrir cualquier cofre que diera agua o fertilizante, PostgreSQL
--    arrojara el error: "relation public.farm_inventory does not exist" y abortara.
-- 2. No había margen de gracia para desfases de reloj entre cliente y servidor.
-- 3. claim_reward_pack llamaba a funciones inexistentes (_roll_rarity).
-- 4. Faltaba la RPC instant_unlock_pack_slot en PostgreSQL.
--
-- SOLUCIÓN:
-- 1. Crea la tabla public.farm_inventory como salvaguarda y actualiza
--    correctamente la columna JSONB 'profiles.farming_inventory'.
-- 2. Añade 15 segundos de tolerancia en los temporizadores para evitar falsos
--    'SLOT_NOT_READY' por diferencias de segundos entre el móvil/PC y Supabase.
-- 3. Repara claim_pack_slot, instant_unlock_pack_slot y claim_reward_pack.
-- =============================================================================

BEGIN;

-- ── 1. SALVAGUARDA: CREAR TABLA public.farm_inventory SI NO EXISTE ────────────
CREATE TABLE IF NOT EXISTS public.farm_inventory (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_id)
);

ALTER TABLE public.farm_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "farm_inventory_select_own" ON public.farm_inventory;
CREATE POLICY "farm_inventory_select_own" ON public.farm_inventory
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ── 2. REPARACIÓN DEFINITIVA DE claim_pack_slot (COFRES DE 4 SLOTS) ───────────
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
  v_inventory    JSONB;
  v_gold_balance BIGINT;
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

  -- Tolerancia de 15 segundos para compensar desfases de reloj entre el cliente y el servidor
  IF v_slot.status = 'unlocking' THEN
    IF v_slot.unlock_started_at IS NULL THEN
      RAISE EXCEPTION 'SLOT_NOT_READY';
    END IF;
    IF NOW() < v_slot.unlock_started_at + (v_slot.duration_hours || ' hours')::interval - INTERVAL '15 seconds' THEN
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
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','gold','quantity',50));
      ELSIF v_nonplant < 0.78 THEN
        v_gold := v_gold + 100;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','gold','quantity',100));
      ELSIF v_nonplant < 0.82 THEN
        v_water := v_water + 2;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','water','quantity',2));
      ELSIF v_nonplant < 0.85 THEN
        v_fert := v_fert + 2;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','fertilizer','quantity',2));
      ELSE
        v_gold := v_gold + 200;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','gold','quantity',200));
      END IF;
    END IF;
  END LOOP;

  -- Actualizar farming_inventory en profiles (JSONB)
  SELECT COALESCE(farming_inventory, '{}'::jsonb)
    INTO v_inventory
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  IF v_water > 0 THEN
    v_inventory := jsonb_set(
      v_inventory,
      '{water}',
      to_jsonb(COALESCE((v_inventory->>'water')::integer, 0) + v_water),
      TRUE
    );
    INSERT INTO public.farm_inventory(user_id, item_id, quantity)
    VALUES (v_user, 'water', v_water)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = public.farm_inventory.quantity + EXCLUDED.quantity;
  END IF;

  IF v_fert > 0 THEN
    v_inventory := jsonb_set(
      v_inventory,
      '{fertilizer}',
      to_jsonb(COALESCE((v_inventory->>'fertilizer')::integer, 0) + v_fert),
      TRUE
    );
    INSERT INTO public.farm_inventory(user_id, item_id, quantity)
    VALUES (v_user, 'fertilizer', v_fert)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = public.farm_inventory.quantity + EXCLUDED.quantity;
  END IF;

  UPDATE public.profiles
  SET farming_inventory = v_inventory,
      gold_balance = COALESCE(gold_balance, 0) + v_gold,
      updated_at = NOW()
  WHERE id = v_user
  RETURNING gold_balance INTO v_gold_balance;

  -- Vaciar el slot
  UPDATE public.pack_slots
  SET
    status = 'empty',
    unlock_started_at = NULL,
    reward_drops = v_drops,
    reward_generated_at = NOW()
  WHERE user_id = v_user AND slot_index = p_slot_index;

  RETURN jsonb_build_object(
    'success', TRUE,
    'drops', v_drops,
    'farmingItems', v_inventory,
    'goldBalance', v_gold_balance,
    'slotIndex', p_slot_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pack_slot(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pack_slot(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) TO authenticated;


-- ── 3. RPC instant_unlock_pack_slot (ACELERAR COFRE CON ORO) ───────────────────
CREATE OR REPLACE FUNCTION public.instant_unlock_pack_slot(p_slot_index INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_slot  RECORD;
  v_horas NUMERIC;
  v_coste BIGINT;
  v_oro   BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_slot_index IS NULL OR p_slot_index < 0 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'INVALID_SLOT_INDEX';
  END IF;

  SELECT * INTO v_slot
    FROM public.pack_slots
   WHERE user_id = v_uid AND slot_index = p_slot_index
     FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SLOT_NOT_FOUND'; END IF;
  IF v_slot.status = 'empty' THEN RAISE EXCEPTION 'SLOT_IS_EMPTY'; END IF;
  IF v_slot.status = 'ready' THEN
    RETURN jsonb_build_object('success', TRUE, 'goldSpent', 0);
  END IF;

  IF v_slot.status = 'unlocking' AND v_slot.unlock_started_at IS NOT NULL THEN
    v_horas := GREATEST(0, v_slot.duration_hours
                 - EXTRACT(EPOCH FROM (NOW() - v_slot.unlock_started_at)) / 3600.0);
  ELSE
    v_horas := COALESCE(v_slot.duration_hours, 2);
  END IF;

  v_coste := GREATEST(10, CEIL(v_horas * 75))::BIGINT;

  SELECT gold_balance INTO v_oro FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_oro IS NULL OR v_oro < v_coste THEN
    RAISE EXCEPTION 'INSUFFICIENT_GOLD';
  END IF;

  UPDATE public.profiles SET gold_balance = gold_balance - v_coste WHERE id = v_uid;

  UPDATE public.pack_slots
     SET status = 'ready',
         unlock_started_at = NULL
   WHERE user_id = v_uid AND slot_index = p_slot_index;

  RETURN jsonb_build_object(
    'success', TRUE,
    'goldSpent', v_coste,
    'goldBalance', v_oro - v_coste
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instant_unlock_pack_slot(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instant_unlock_pack_slot(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.instant_unlock_pack_slot(INTEGER) TO authenticated;


-- ── 4. REPARACIÓN DE claim_reward_pack (SOBRES DEL JARDÍN) ─────────────────────
CREATE OR REPLACE FUNCTION public.claim_reward_pack(p_pack_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_pack   RECORD;
  v_rarity TEXT;
  v_plant  TEXT;
  v_new    BOOLEAN;
  v_gold   BIGINT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_pack_id IS NULL THEN RAISE EXCEPTION 'INVALID_PACK_ID'; END IF;

  SELECT * INTO v_pack
    FROM public.player_reward_packs
   WHERE id = p_pack_id AND user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PACK_NOT_FOUND'; END IF;
  IF v_pack.status = 'opened' THEN RAISE EXCEPTION 'PACK_ALREADY_OPENED'; END IF;

  IF v_pack.status <> 'ready' THEN
    IF v_pack.status = 'unlocking'
       AND v_pack.unlock_started_at IS NOT NULL
       AND NOW() >= v_pack.unlock_started_at
                    + make_interval(hours => COALESCE(v_pack.duration_hours, 2)) - INTERVAL '15 seconds'
    THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'PACK_NOT_READY';
    END IF;
  END IF;

  IF random() < 0.70 THEN
    v_rarity := 'common';
    v_plant := (ARRAY['sunflower', 'peashooter', 'wallnut', 'chomper'])[1 + floor(random() * 4)::integer];
  ELSE
    v_rarity := 'uncommon';
    v_plant := (ARRAY['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash'])[1 + floor(random() * 5)::integer];
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.plant_instances
    WHERE owner_id = v_uid AND plant_id = v_plant
  ) INTO v_new;

  IF v_new THEN
    INSERT INTO public.plant_instances (
      owner_id, plant_id, rarity, star_level, level, stat_rolls,
      is_base, is_in_deck, deck_slot, is_listed_for_sale
    ) VALUES (
      v_uid, v_plant, v_rarity, 1, 0, '{}'::text[],
      TRUE, FALSE, NULL, FALSE
    );
  ELSE
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (v_uid, v_plant, 1)
    ON CONFLICT (user_id, plant_id) DO UPDATE
      SET copies = plant_copies.copies + 1;
  END IF;

  v_gold := CASE COALESCE(v_pack.duration_hours, 4)
    WHEN 2 THEN 50
    WHEN 4 THEN 100
    WHEN 8 THEN 200
    WHEN 12 THEN 350
    ELSE 100
  END;

  IF v_gold > 0 THEN
    UPDATE public.profiles
       SET gold_balance = COALESCE(gold_balance, 0) + v_gold
     WHERE id = v_uid;
  END IF;

  UPDATE public.player_reward_packs
     SET status = 'opened',
         opened_at = NOW()
   WHERE id = p_pack_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'plantId', v_plant,
    'rarity', v_rarity,
    'isNew', v_new,
    'goldReward', v_gold
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_reward_pack(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_reward_pack(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_reward_pack(UUID) TO authenticated;

COMMIT;
