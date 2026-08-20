-- =============================================================================
-- PLANT ARENA · MIGRACIÓN 30: NUEVOS 8 PREMIOS DE LA RULETA
--
-- Configuración de los 8 sectores exactos:
--   1. 5 Gemas (Jackpot)
--   2. Sobre Básico
--   3. 500 de Oro
--   4. 200 de Oro
--   5. 50 de Oro
--   6. Sigue Intentando (1)
--   7. Sigue Intentando (2)
--   8. Sigue Intentando (3)
--
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- =============================================================================

BEGIN;

-- 1. Permitir 'none' en el tipo de recompensa de lottery_sectors
ALTER TABLE public.lottery_sectors
  DROP CONSTRAINT IF EXISTS lottery_sectors_reward_type_check;

ALTER TABLE public.lottery_sectors
  ADD CONSTRAINT lottery_sectors_reward_type_check
  CHECK (reward_type IN ('gems', 'gold', 'pack', 'plant', 'none'));

-- 2. Limpiar / reemplazar los sectores activos con los 8 requeridos
DELETE FROM public.lottery_sectors;

INSERT INTO public.lottery_sectors
  (sector_id, label, reward_type, gems_amount, gold_amount, pack_id, pack_qty, plant_id, plant_qty, weight, is_active)
VALUES
  ('jackpot_5',   '5 Gemas 💎',       'gems',  5.0,  NULL, NULL,     NULL, NULL, NULL,  2.0, TRUE),
  ('none_1',      'Sigue Intentando', 'none',  NULL, NULL, NULL,     NULL, NULL, NULL, 20.0, TRUE),
  ('gold_500',    '500 Oro',          'gold',  NULL,  500, NULL,     NULL, NULL, NULL,  8.0, TRUE),
  ('none_2',      'Sigue Intentando', 'none',  NULL, NULL, NULL,     NULL, NULL, NULL, 20.0, TRUE),
  ('pack_basic',  'Sobre Básico',     'pack',  NULL, NULL, 'basic',     1, NULL, NULL, 10.0, TRUE),
  ('gold_200',    '200 Oro',          'gold',  NULL,  200, NULL,     NULL, NULL, NULL, 15.0, TRUE),
  ('none_3',      'Sigue Intentando', 'none',  NULL, NULL, NULL,     NULL, NULL, NULL, 15.0, TRUE),
  ('gold_50',     '50 Oro',           'gold',  NULL,   50, NULL,     NULL, NULL, NULL, 10.0, TRUE);

-- 3. Asegurar que _grant_reward maneje 'none' sin errores
CREATE OR REPLACE FUNCTION public._grant_reward(
  p_uid          UUID,
  p_type         TEXT,
  p_pack_id      TEXT DEFAULT NULL,
  p_pack_count   INTEGER DEFAULT NULL,
  p_plant_id     TEXT DEFAULT NULL,
  p_copies_count INTEGER DEFAULT NULL,
  p_gems         NUMERIC DEFAULT NULL,
  p_gold         BIGINT DEFAULT NULL,
  p_source       TEXT DEFAULT 'gift'
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE i INTEGER;
BEGIN
  IF p_type = 'pack' AND p_pack_id IS NOT NULL THEN
    FOR i IN 1..COALESCE(p_pack_count, 1) LOOP
      INSERT INTO public.player_packs (user_id, pack_id, source)
      VALUES (p_uid, p_pack_id, p_source);
    END LOOP;
    RETURN jsonb_build_object('type','pack','packId',p_pack_id,'count',COALESCE(p_pack_count,1));

  ELSIF p_type IN ('copies','plant') AND p_plant_id IS NOT NULL THEN
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (p_uid, p_plant_id, COALESCE(p_copies_count, 1))
    ON CONFLICT (user_id, plant_id) DO UPDATE
      SET copies = plant_copies.copies + COALESCE(p_copies_count, 1);
    RETURN jsonb_build_object('type','copies','plantId',p_plant_id,'count',COALESCE(p_copies_count,1));

  ELSIF p_type = 'gems' AND p_gems IS NOT NULL THEN
    UPDATE public.profiles SET gems_balance = gems_balance + p_gems WHERE id = p_uid;
    RETURN jsonb_build_object('type','gems','amount',p_gems);

  ELSIF p_type = 'gold' AND p_gold IS NOT NULL THEN
    UPDATE public.profiles SET gold_balance = gold_balance + p_gold WHERE id = p_uid;
    RETURN jsonb_build_object('type','gold','amount',p_gold);

  ELSIF p_type = 'badge' THEN
    RETURN jsonb_build_object('type','badge');
  END IF;

  RETURN jsonb_build_object('type','none');
END;
$$;

-- 4. Actualizar spin_lottery para entregar premios (o 'none' si cae en Sigue Intentando)
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
  c_spin_cost CONSTANT NUMERIC := 1;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  INSERT INTO public.user_lottery (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_lot FROM public.user_lottery WHERE user_id = v_uid FOR UPDATE;

  IF p_paid THEN
    SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF v_saldo IS NULL OR v_saldo < c_spin_cost THEN
      RAISE EXCEPTION 'Necesitas % gema para un tiro adicional', c_spin_cost;
    END IF;
    UPDATE public.profiles SET gems_balance = gems_balance - c_spin_cost WHERE id = v_uid;
  ELSE
    -- Un tiro gratis cada 24 h
    IF v_lot.last_free_spin IS NOT NULL
       AND v_lot.last_free_spin > NOW() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'Ya usaste tu tiro gratis. Vuelve en %',
        date_trunc('minute', (v_lot.last_free_spin + INTERVAL '24 hours') - NOW());
    END IF;
    UPDATE public.user_lottery SET last_free_spin = NOW() WHERE user_id = v_uid;
  END IF;

  -- Sorteo ponderado
  v_r := random() * 100;
  FOR v_sector IN
    SELECT * FROM public.lottery_sectors WHERE is_active ORDER BY sector_id
  LOOP
    v_acc := v_acc + v_sector.weight;
    IF v_r <= v_acc THEN EXIT; END IF;
  END LOOP;

  IF v_sector IS NULL THEN
    SELECT * INTO v_sector FROM public.lottery_sectors WHERE is_active LIMIT 1;
  END IF;

  IF v_sector IS NULL THEN RAISE EXCEPTION 'No hay sectores activos en la lotería'; END IF;

  v_dado := public._grant_reward(
    v_uid, v_sector.reward_type, v_sector.pack_id, v_sector.pack_qty,
    v_sector.plant_id, v_sector.plant_qty, v_sector.gems_amount,
    v_sector.gold_amount, 'gift'
  );

  UPDATE public.user_lottery
     SET total_spins = COALESCE(total_spins,0) + 1, updated_at = NOW()
   WHERE user_id = v_uid;

  IF v_sector.reward_type = 'gems' AND v_sector.gems_amount > 0 THEN
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'deposit', v_sector.gems_amount,
            'Premio de lotería: ' || v_sector.label, 'completed');
  END IF;

  RETURN jsonb_build_object(
    'success',  TRUE,
    'sectorId', v_sector.sector_id,
    'label',    v_sector.label,
    'rewardType', v_sector.reward_type,
    'granted',  v_dado
  );
END;
$$;

-- 5. Validar que la suma de pesos de los sectores activos sea exactamente 100
DO $$
DECLARE v_total NUMERIC;
BEGIN
  SELECT SUM(weight) INTO v_total FROM public.lottery_sectors WHERE is_active;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'Los pesos de la lotería suman %, deberían sumar 100', v_total;
  END IF;
END $$;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('ruleta_8_premios', jsonb_build_object('ok', true, 'sectors_count', 8));

COMMIT;
