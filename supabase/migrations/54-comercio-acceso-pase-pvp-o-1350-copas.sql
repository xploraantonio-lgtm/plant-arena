-- =============================================================================
-- 54-comercio-acceso-pase-pvp-o-1350-copas.sql
--
-- REGLA DE DOMINIO AUTORITATIVA PARA EL COMERCIO P2P:
-- El acceso para publicar y comprar cartas en el mercado ahora requiere
-- O BIEN tener el Pase PvP (profiles.has_vip_pass = true)
-- O BIEN haber alcanzado al menos 1,350 copas (profiles.elo_rating >= 1350).
--
-- Si un usuario no cumple ninguna de las dos condiciones, las operaciones
-- de mercado son rechazadas autoritativamente a nivel de base de datos.
-- =============================================================================

-- 1. Función auxiliar para verificar acceso al mercado
CREATE OR REPLACE FUNCTION public.can_access_marketplace(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prof RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT has_vip_pass, COALESCE(elo_rating, 1000) AS elo, COALESCE(is_admin, false) AS admin
    INTO v_prof
    FROM public.profiles
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN COALESCE(v_prof.has_vip_pass, false) OR (v_prof.elo >= 1350) OR v_prof.admin;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_marketplace(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_marketplace(UUID) TO authenticated;

-- 2. Endpoint RPC para consultar estado de acceso al mercado
CREATE OR REPLACE FUNCTION public.check_marketplace_access()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_prof RECORD;
  v_has_access BOOLEAN;
  v_copas INT;
  v_has_vip BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('hasAccess', false, 'reason', 'not_authenticated');
  END IF;

  SELECT has_vip_pass, COALESCE(elo_rating, 1000) AS elo, COALESCE(is_admin, false) AS admin
    INTO v_prof
    FROM public.profiles
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasAccess', false, 'reason', 'no_profile');
  END IF;

  v_copas := v_prof.elo;
  v_has_vip := COALESCE(v_prof.has_vip_pass, false);
  v_has_access := v_has_vip OR (v_copas >= 1350) OR v_prof.admin;

  RETURN jsonb_build_object(
    'hasAccess', v_has_access,
    'hasVipPass', v_has_vip,
    'copas', v_copas,
    'copasRequired', 1350,
    'unlockedBy', CASE
      WHEN v_has_vip THEN 'vip_pass'
      WHEN v_copas >= 1350 THEN 'copas'
      ELSE 'none'
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_marketplace_access() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_marketplace_access() TO authenticated;

-- 3. Blindaje autoritativo en list_marketplace_card
CREATE OR REPLACE FUNCTION public.list_marketplace_card(
  p_plant_instance_id UUID,
  p_price_gems        NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plant RECORD;
  v_listing_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_price_gems IS NULL OR p_price_gems <= 0 THEN
    RAISE EXCEPTION 'Precio inválido';
  END IF;

  -- Verificación de Pase PvP o 1,350 Copas
  IF NOT public.can_access_marketplace(v_uid) THEN
    RAISE EXCEPTION 'Comercio bloqueado: Requiere Pase PvP o alcanzar 1,350 copas';
  END IF;

  SELECT * INTO v_plant FROM public.plant_instances
   WHERE id = p_plant_instance_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No eres el propietario de esta carta'; END IF;
  IF v_plant.is_listed_for_sale THEN RAISE EXCEPTION 'La carta ya está en venta'; END IF;

  UPDATE public.plant_instances
     SET is_listed_for_sale = TRUE, is_in_deck = FALSE, deck_slot = NULL
   WHERE id = p_plant_instance_id;

  INSERT INTO public.marketplace_listings (seller_id, plant_instance_id, price_gems, status)
  VALUES (v_uid, p_plant_instance_id, p_price_gems, 'active')
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$;

-- 4. Blindaje autoritativo en buy_marketplace_card
CREATE OR REPLACE FUNCTION public.buy_marketplace_card(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_list   RECORD;
  v_saldo  NUMERIC;
  v_pct    NUMERIC;
  v_comision NUMERIC;
  v_vendedor NUMERIC;
  v_activo BOOLEAN;
  v_top1   UUID;
  v_top2   UUID;
  v_g1     NUMERIC := 0;
  v_g2     NUMERIC := 0;
  v_proyecto NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Verificación de Pase PvP o 1,350 Copas
  IF NOT public.can_access_marketplace(v_uid) THEN
    RAISE EXCEPTION 'Comercio bloqueado: Requiere Pase PvP o alcanzar 1,350 copas';
  END IF;

  SELECT * INTO v_list FROM public.marketplace_listings
   WHERE id = p_listing_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta carta ya no está disponible'; END IF;
  IF v_list.seller_id = v_uid THEN RAISE EXCEPTION 'No puedes comprar tu propia carta'; END IF;

  -- Bloqueo en orden estable de id para evitar interbloqueos
  PERFORM 1 FROM public.profiles
    WHERE id IN (v_uid, v_list.seller_id) ORDER BY id FOR UPDATE;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid;
  IF v_saldo IS NULL OR v_saldo < v_list.price_gems THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  SELECT COALESCE(value, 10) INTO v_pct FROM public.shop_config
   WHERE key = 'p2p_comision_pct';
  v_pct := LEAST(GREATEST(COALESCE(v_pct, 10), 0), 100);

  v_comision := ROUND(v_list.price_gems * v_pct / 100, 2);
  v_vendedor := v_list.price_gems - v_comision;

  -- ── EL REPARTO P2P ────────────────────────────────────────────────────────
  SELECT COALESCE(value, 0) > 0 INTO v_activo FROM public.shop_config
   WHERE key = 'p2p_reparto_activo';

  IF COALESCE(v_activo, FALSE) THEN
    SELECT p2p_top1_id, p2p_top2_id INTO v_top1, v_top2
      FROM public.referral_seasons
     WHERE activa = TRUE LIMIT 1;

    IF v_top1 IS NOT NULL AND v_top2 IS NOT NULL AND v_top1 <> v_top2 THEN
      v_g1 := ROUND(v_comision * 0.40, 2);
      v_g2 := ROUND(v_comision * 0.20, 2);
    ELSIF v_top1 IS NOT NULL THEN
      v_g1 := ROUND(v_comision * 0.60, 2);
      v_g2 := 0;
    ELSE
      v_g1 := 0;
      v_g2 := 0;
    END IF;
  END IF;

  v_proyecto := v_comision - v_g1 - v_g2;

  -- ── MOVIMIENTO DE SALDOS ──────────────────────────────────────────────────
  UPDATE public.profiles SET gems_balance = gems_balance - v_list.price_gems
   WHERE id = v_uid;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'marketplace_buy', v_list.price_gems, 'Compra de carta en el mercado', 'completed');

  UPDATE public.profiles SET gems_balance = gems_balance + v_vendedor
   WHERE id = v_list.seller_id;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_list.seller_id, 'marketplace_sell', v_vendedor, 'Venta de carta en el mercado', 'completed');

  IF v_g1 > 0 THEN
    UPDATE public.profiles SET gems_balance = gems_balance + v_g1 WHERE id = v_top1;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_top1, 'p2p_reparto_top1', v_g1, 'Comisión mercado P2P (Top 1 referidos)', 'completed');
  END IF;

  IF v_g2 > 0 THEN
    UPDATE public.profiles SET gems_balance = gems_balance + v_g2 WHERE id = v_top2;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_top2, 'p2p_reparto_top2', v_g2, 'Comisión mercado P2P (Top 2 referidos)', 'completed');
  END IF;

  UPDATE public.plant_instances
     SET owner_id = v_uid, is_listed_for_sale = FALSE,
         is_in_deck = FALSE, deck_slot = NULL
   WHERE id = v_list.plant_instance_id;

  UPDATE public.marketplace_listings
     SET status = 'sold', buyer_id = v_uid, closed_at = NOW()
   WHERE id = p_listing_id;

  INSERT INTO public.marketplace_sales_log (
    listing_id, seller_id, buyer_id, plant_instance_id, price_gems, comision_gems,
    top1_id, top1_gems, top2_id, top2_gems, proyecto_gems
  ) VALUES (
    p_listing_id, v_list.seller_id, v_uid, v_list.plant_instance_id, v_list.price_gems, v_comision,
    v_top1, v_g1, v_top2, v_g2, v_proyecto
  );

  RETURN jsonb_build_object('success', true, 'price_gems', v_list.price_gems);
END;
$$;
