-- =============================================================================
-- MIGRACIÓN 106: REBALANCEO CALIBRADO DE LA RULETA (CERO FUGA + 500💎 MEGA JACKPOT)
--
-- 1. Agrega soporte para consumibles de farming ('item') y cartas de planta ('plant').
-- 2. Actualiza _grant_reward() para otorgar items (2 aguas, 1 fertilizante, frag. de pala)
--    en farming_inventory de profiles y plantas (wallnut) en plant_instances/plant_copies.
-- 3. Corrige la función spin_lottery() para cobrar exactamente 10 Gemas (c_spin_cost = 10).
-- 4. Distribución blindada para 1,000+ jugadores (Costo total en gemas < $30/mes para 1,000 jugadores):
--    - jackpot_500     -> 500 Gemas 💎 (Mega Jackpot!)     [ 0.01% prob]
--    - item_water      -> 2x Agua 💧                       [18.00% prob]
--    - pack_basic      -> Sobre Básico 👑                  [ 0.20% prob]
--    - item_fertilizer -> Fertilizante 🌿                  [10.00% prob]
--    - jackpot_10      -> 10 Gemas 💎 (¡Giro Extra!)       [ 0.50% prob]
--    - item_shovel     -> Frag. de Pala 🪏                 [ 3.00% prob]
--    - plant_wallnut   -> Wall-nut 🥜 (Carta)              [ 1.50% prob]
--    - none_1          -> Sigue Intentando 💨              [66.79% prob]
--
-- Total: 0.01 + 18.00 + 0.20 + 10.00 + 0.50 + 3.00 + 1.50 + 66.79 = 100.00%
-- =============================================================================

BEGIN;

-- 1. Permitir columnas de item y tipo 'item' en lottery_sectors
ALTER TABLE public.lottery_sectors ADD COLUMN IF NOT EXISTS item_id TEXT;
ALTER TABLE public.lottery_sectors ADD COLUMN IF NOT EXISTS item_qty INTEGER DEFAULT 1;

ALTER TABLE public.lottery_sectors DROP CONSTRAINT IF EXISTS lottery_sectors_reward_type_check;
ALTER TABLE public.lottery_sectors ADD CONSTRAINT lottery_sectors_reward_type_check
  CHECK (reward_type IN ('gems', 'gold', 'pack', 'plant', 'item', 'none'));

-- 2. Limpiar y configurar los 8 sectores atractivos
DELETE FROM public.lottery_sectors;

INSERT INTO public.lottery_sectors
  (sector_id, label, reward_type, gems_amount, gold_amount, pack_id, pack_qty, plant_id, plant_qty, item_id, item_qty, weight, is_active)
VALUES
  ('jackpot_500',     '500 Gemas 💎',     'gems',   500.0, NULL, NULL,    NULL, NULL,      NULL, NULL,              NULL,  0.01, TRUE),
  ('item_water',      '2x Agua 💧',       'item',   NULL,  NULL, NULL,    NULL, NULL,      NULL, 'water',           2,    18.00, TRUE),
  ('pack_basic',      'Sobre Básico',     'pack',   NULL,  NULL, 'basic', 1,    NULL,      NULL, NULL,              NULL,  0.20, TRUE),
  ('item_fertilizer', 'Fertilizante',     'item',   NULL,  NULL, NULL,    NULL, NULL,      NULL, 'fertilizer',      1,    10.00, TRUE),
  ('jackpot_10',      '10 Gemas 💎',      'gems',   10.0,  NULL, NULL,    NULL, NULL,      NULL, NULL,              NULL,  0.50, TRUE),
  ('item_shovel',     'Frag. Pala',       'item',   NULL,  NULL, NULL,    NULL, NULL,      NULL, 'shovel_fragment', 1,     3.00, TRUE),
  ('plant_wallnut',   'Wall-nut 🥜',      'plant',  NULL,  NULL, NULL,    NULL, 'wallnut', 1,    NULL,              NULL,  1.50, TRUE),
  ('none_1',          'Sigue Intentando', 'none',   NULL,  NULL, NULL,    NULL, NULL,      NULL, NULL,              NULL, 66.79, TRUE);

-- Validar que los pesos de los sectores activos sumen exactamente 100.00%
DO $$
DECLARE
  v_total NUMERIC;
BEGIN
  SELECT SUM(weight) INTO v_total FROM public.lottery_sectors WHERE is_active;
  IF v_total <> 100.00 THEN
    RAISE EXCEPTION 'Los pesos de la lotería suman %, deben sumar exactamente 100.00', v_total;
  END IF;
END $$;

-- 3. Actualizar función _grant_reward para soportar item, plant, pack, gems, gold
CREATE OR REPLACE FUNCTION public._grant_reward(
  p_uid          UUID,
  p_type         TEXT,
  p_pack_id      TEXT DEFAULT NULL,
  p_pack_count   INTEGER DEFAULT NULL,
  p_plant_id     TEXT DEFAULT NULL,
  p_copies_count INTEGER DEFAULT NULL,
  p_gems         NUMERIC DEFAULT NULL,
  p_gold         BIGINT DEFAULT NULL,
  p_source       TEXT DEFAULT 'lottery',
  p_item_id      TEXT DEFAULT NULL,
  p_item_count   INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  i INTEGER;
  v_is_new BOOLEAN;
  v_rarity TEXT;
  v_inv JSONB;
BEGIN
  IF p_type = 'pack' AND p_pack_id IS NOT NULL THEN
    FOR i IN 1..COALESCE(p_pack_count, 1) LOOP
      INSERT INTO public.player_packs (user_id, pack_id, source)
      VALUES (p_uid, p_pack_id, p_source);
    END LOOP;
    RETURN jsonb_build_object('type', 'pack', 'packId', p_pack_id, 'count', COALESCE(p_pack_count, 1));

  ELSIF p_type IN ('copies', 'plant') AND p_plant_id IS NOT NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.plant_instances
      WHERE owner_id = p_uid AND plant_id = p_plant_id AND is_base = TRUE
    ) INTO v_is_new;

    IF v_is_new THEN
      v_rarity := CASE
        WHEN p_plant_id IN ('sunflower', 'peashooter', 'wallnut', 'chomper') THEN 'common'
        WHEN p_plant_id IN ('garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash') THEN 'uncommon'
        ELSE 'common'
      END;

      INSERT INTO public.plant_instances (
        owner_id, plant_id, rarity, star_level, level, stat_rolls,
        is_base, is_in_deck, deck_slot, is_listed_for_sale
      ) VALUES (
        p_uid, p_plant_id, v_rarity, 1, 0, '{}'::text[],
        TRUE, FALSE, NULL, FALSE
      );
    ELSE
      INSERT INTO public.plant_copies (user_id, plant_id, copies)
      VALUES (p_uid, p_plant_id, COALESCE(p_copies_count, 1))
      ON CONFLICT (user_id, plant_id) DO UPDATE
        SET copies = public.plant_copies.copies + COALESCE(p_copies_count, 1);
    END IF;

    RETURN jsonb_build_object('type', 'plant', 'plantId', p_plant_id, 'count', COALESCE(p_copies_count, 1), 'isNew', v_is_new);

  ELSIF p_type = 'item' AND p_item_id IS NOT NULL THEN
    SELECT COALESCE(
      farming_inventory,
      '{"water":0,"fertilizer":0,"shovel_fragment":0,"scarecrow_fragment":0,"pesticide":0,"shovel":0,"scarecrow":0}'::jsonb
    ) INTO v_inv
    FROM public.profiles WHERE id = p_uid FOR UPDATE;

    v_inv := jsonb_set(
      v_inv,
      ARRAY[p_item_id],
      to_jsonb(COALESCE((v_inv->>p_item_id)::INTEGER, 0) + COALESCE(p_item_count, 1)),
      TRUE
    );

    UPDATE public.profiles
       SET farming_inventory = v_inv
     WHERE id = p_uid;

    RETURN jsonb_build_object('type', 'item', 'itemId', p_item_id, 'count', COALESCE(p_item_count, 1));

  ELSIF p_type = 'gems' AND p_gems IS NOT NULL THEN
    UPDATE public.profiles SET gems_balance = gems_balance + p_gems WHERE id = p_uid;
    RETURN jsonb_build_object('type', 'gems', 'amount', p_gems);

  ELSIF p_type = 'gold' AND p_gold IS NOT NULL THEN
    UPDATE public.profiles SET gold_balance = gold_balance + p_gold WHERE id = p_uid;
    RETURN jsonb_build_object('type', 'gold', 'amount', p_gold);
  END IF;

  RETURN jsonb_build_object('type', 'none');
END;
$$;

-- 4. Actualizar spin_lottery() con cobro de 10 Gemas y entrega de recompensas
CREATE OR REPLACE FUNCTION public.spin_lottery(p_paid BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_lot       RECORD;
  v_saldo     NUMERIC;
  v_r         NUMERIC;
  v_acc       NUMERIC := 0;
  v_sector    RECORD;
  v_dado      JSONB;
  c_spin_cost CONSTANT NUMERIC := 10; -- Costo sincronizado de 10 gemas
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  INSERT INTO public.user_lottery (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_lot
    FROM public.user_lottery
   WHERE user_id = v_uid
     FOR UPDATE;

  IF p_paid THEN
    SELECT gems_balance INTO v_saldo
      FROM public.profiles
     WHERE id = v_uid
       FOR UPDATE;

    IF v_saldo IS NULL OR v_saldo < c_spin_cost THEN
      RAISE EXCEPTION 'Necesitas % gemas para un tiro adicional', c_spin_cost;
    END IF;

    -- Cobrar las 10 gemas
    UPDATE public.profiles
       SET gems_balance = gems_balance - c_spin_cost
     WHERE id = v_uid;

    -- Registrar el débito en transacciones
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'spend', c_spin_cost, 'Giro adicional en Ruleta de la Suerte', 'completed');
  ELSE
    -- Comprobar cooldown de 24 horas para el tiro gratis
    IF v_lot.last_free_spin IS NOT NULL
       AND v_lot.last_free_spin > NOW() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'Ya usaste tu tiro gratis. Vuelve en %',
        date_trunc('minute', (v_lot.last_free_spin + INTERVAL '24 hours') - NOW());
    END IF;

    UPDATE public.user_lottery
       SET last_free_spin = NOW()
     WHERE user_id = v_uid;
  END IF;

  -- Sorteo ponderado según lottery_sectors
  v_r := random() * 100;
  FOR v_sector IN
    SELECT *
      FROM public.lottery_sectors
     WHERE is_active
     ORDER BY sector_id
  LOOP
    v_acc := v_acc + v_sector.weight;
    IF v_r <= v_acc THEN
      EXIT;
    END IF;
  END LOOP;

  IF v_sector IS NULL THEN
    SELECT * INTO v_sector
      FROM public.lottery_sectors
     WHERE is_active
     LIMIT 1;
  END IF;

  IF v_sector IS NULL THEN
    RAISE EXCEPTION 'No hay sectores activos en la lotería';
  END IF;

  -- Entregar recompensa en base de datos
  v_dado := public._grant_reward(
    v_uid,
    v_sector.reward_type,
    v_sector.pack_id,
    v_sector.pack_qty,
    v_sector.plant_id,
    v_sector.plant_qty,
    v_sector.gems_amount,
    v_sector.gold_amount,
    'lottery',
    v_sector.item_id,
    v_sector.item_qty
  );

  -- Incrementar contador total de giros del usuario
  UPDATE public.user_lottery
     SET total_spins = COALESCE(total_spins, 0) + 1,
         updated_at = NOW()
   WHERE user_id = v_uid;

  -- Si el premio fue en gemas, registrar transacción de crédito
  IF v_sector.reward_type = 'gems' AND v_sector.gems_amount > 0 THEN
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'deposit', v_sector.gems_amount,
            'Premio de lotería: ' || v_sector.label, 'completed');
  END IF;

  RETURN jsonb_build_object(
    'success',    TRUE,
    'sectorId',   v_sector.sector_id,
    'label',      v_sector.label,
    'rewardType', v_sector.reward_type,
    'granted',    v_dado
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spin_lottery(BOOLEAN) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.spin_lottery(BOOLEAN) TO authenticated;

-- Auditoría de la migración
INSERT INTO public._migration_audit (fase, detalle)
VALUES ('rebalance_roulette_calibrated_106', jsonb_build_object(
  'ok', true,
  'c_spin_cost', 10,
  'mega_jackpot', '500 Gemas (0.01%)',
  'jackpot_gemas', '10 Gemas (0.50%)',
  'jackpot_sobre', 'Sobre Básico (0.20%)',
  'farming', jsonb_build_object('water_2', '18.0%', 'fertilizer_1', '10.0%', 'shovel_fragment', '3.0%'),
  'plant', 'Wall-nut (1.5%)',
  'sin_premio', '66.79%'
));

COMMIT;

NOTIFY pgrst, 'reload schema';
