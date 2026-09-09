-- ==============================================================================
-- PLANT ARENA · MIGRACIÓN 67: SISTEMA AUTORITATIVO DE OFERTAS FLASH
-- ==============================================================================
-- Idempotente.
-- Ofrece garantía autoritativa en el backend:
-- 1. Tabla de ofertas flash con control de stock, precio y límites por usuario.
-- 2. Tabla de compras para trazabilidad contable y auditoría anti-trampas.
-- 3. RPC buy_flash_offer con bloqueo FOR UPDATE, deducción de gemas, entrega
--    atómica de Jalapeño (instancia base si es nueva o copia a plant_copies)
--    y registro en transacciones.
-- 4. RPC get_flash_offer_status para consultar disponibilidad en tiempo real.
-- ==============================================================================

BEGIN;

-- 1. Catálogo de Ofertas Flash
CREATE TABLE IF NOT EXISTS public.flash_offers (
    offer_id                TEXT PRIMARY KEY,
    title                   TEXT NOT NULL,
    description             TEXT,
    plant_id                TEXT NOT NULL REFERENCES public.plant_catalog(plant_id),
    price_gems              NUMERIC(12,2) NOT NULL CHECK (price_gems > 0),
    max_purchases_per_user  INTEGER NOT NULL DEFAULT 3 CHECK (max_purchases_per_user > 0),
    total_stock             INTEGER NOT NULL DEFAULT 3 CHECK (total_stock >= 0),
    sold_count              INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Semilla de la oferta flash solicitada: 3 Jalapeños a 30 gemas cada uno, máximo 3 compras
INSERT INTO public.flash_offers (
    offer_id,
    title,
    description,
    plant_id,
    price_gems,
    max_purchases_per_user,
    total_stock,
    is_active
) VALUES (
    'flash_jalapeno_30',
    'Oferta Flash: Jalapeño Explosivo',
    '¡Consigue hasta 3 unidades de Jalapeño a precio especial de 30 gemas cada una!',
    'jalapeno',
    30.00,
    3,
    3,
    TRUE
)
ON CONFLICT (offer_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    plant_id = EXCLUDED.plant_id,
    price_gems = EXCLUDED.price_gems,
    max_purchases_per_user = EXCLUDED.max_purchases_per_user,
    total_stock = EXCLUDED.total_stock,
    is_active = EXCLUDED.is_active;

-- 2. Registro de compras de ofertas flash
CREATE TABLE IF NOT EXISTS public.flash_offer_purchases (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id      TEXT NOT NULL REFERENCES public.flash_offers(offer_id),
    user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    price_gems    NUMERIC(12,2) NOT NULL CHECK (price_gems >= 0),
    total_gems    NUMERIC(12,2) NOT NULL CHECK (total_gems >= 0),
    purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flash_purchases_user_offer
ON public.flash_offer_purchases(user_id, offer_id);

-- Habilitar RLS
ALTER TABLE public.flash_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flash_offer_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flash_offers_read" ON public.flash_offers;
CREATE POLICY "flash_offers_read" ON public.flash_offers FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "flash_purchases_user_read" ON public.flash_offer_purchases;
CREATE POLICY "flash_purchases_user_read" ON public.flash_offer_purchases
FOR SELECT USING (auth.uid() = user_id);

-- 3. RPC para consultar estado de una oferta para el usuario actual
CREATE OR REPLACE FUNCTION public.get_flash_offer_status(p_offer_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_offer         RECORD;
    v_user_bought   INTEGER := 0;
    v_remaining     INTEGER := 0;
BEGIN
    SELECT * INTO v_offer FROM public.flash_offers
    WHERE offer_id = p_offer_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', FALSE,
            'error', 'Oferta flash no encontrada'
        );
    END IF;

    IF v_uid IS NOT NULL THEN
        SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_user_bought
        FROM public.flash_offer_purchases
        WHERE offer_id = p_offer_id AND user_id = v_uid;
    END IF;

    v_remaining := GREATEST(0, v_offer.max_purchases_per_user - v_user_bought);

    RETURN jsonb_build_object(
        'success', TRUE,
        'offerId', v_offer.offer_id,
        'title', v_offer.title,
        'description', v_offer.description,
        'plantId', v_offer.plant_id,
        'priceGems', v_offer.price_gems,
        'maxPurchasesPerUser', v_offer.max_purchases_per_user,
        'userBought', v_user_bought,
        'remainingPurchases', v_remaining,
        'isActive', v_offer.is_active,
        'isSoldOut', (v_remaining <= 0 OR NOT v_offer.is_active)
    );
END;
$$;

-- 4. RPC Garantizador de Compra
CREATE OR REPLACE FUNCTION public.buy_flash_offer(p_offer_id TEXT, p_qty INTEGER DEFAULT 1)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_offer         RECORD;
    v_user_bought   INTEGER := 0;
    v_max_user      INTEGER;
    v_saldo         NUMERIC;
    v_total_cost    NUMERIC;
    v_has_base      BOOLEAN := FALSE;
    v_copies_to_add INTEGER := 0;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    IF p_qty IS NULL OR p_qty < 1 THEN
        RAISE EXCEPTION 'Cantidad inválida';
    END IF;

    -- Bloquear la oferta para lectura atómica
    SELECT * INTO v_offer
    FROM public.flash_offers
    WHERE offer_id = p_offer_id FOR UPDATE;

    IF NOT FOUND OR NOT v_offer.is_active THEN
        RAISE EXCEPTION 'Oferta flash no disponible o inactiva';
    END IF;

    v_max_user := v_offer.max_purchases_per_user;

    -- Conteo estricto de compras previas del usuario
    SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_user_bought
    FROM public.flash_offer_purchases
    WHERE offer_id = p_offer_id AND user_id = v_uid;

    IF (v_user_bought + p_qty) > v_max_user THEN
        RAISE EXCEPTION 'Límite alcanzado: máximo % compras por usuario (llevas %, intentas %)',
            v_max_user, v_user_bought, p_qty;
    END IF;

    v_total_cost := v_offer.price_gems * p_qty;

    -- Bloquear el perfil para verificar y descontar saldo
    SELECT gems_balance INTO v_saldo
    FROM public.profiles
    WHERE id = v_uid FOR UPDATE;

    IF v_saldo IS NULL OR v_saldo < v_total_cost THEN
        RAISE EXCEPTION 'Gemas insuficientes: necesitas % y tienes %',
            v_total_cost, COALESCE(v_saldo, 0);
    END IF;

    -- 1. Descontar saldo de gemas
    UPDATE public.profiles
    SET gems_balance = gems_balance - v_total_cost
    WHERE id = v_uid;

    -- 2. Entregar Jalapeño de forma atómica respetando constraints (migración 64)
    SELECT EXISTS (
        SELECT 1 FROM public.plant_instances
        WHERE owner_id = v_uid AND plant_id = v_offer.plant_id AND is_base = TRUE
    ) INTO v_has_base;

    IF NOT v_has_base THEN
        -- Primera compra: se crea la instancia base nivel 0
        INSERT INTO public.plant_instances (
            owner_id, plant_id, rarity, star_level, level, stat_rolls,
            is_base, is_in_deck, deck_slot, is_listed_for_sale
        ) VALUES (
            v_uid, v_offer.plant_id, 'rare', 1, 0, '{}'::text[],
            TRUE, FALSE, NULL, FALSE
        );

        v_copies_to_add := p_qty - 1;
    ELSE
        v_copies_to_add := p_qty;
    END IF;

    -- Si quedan copias excedentes por entregar, acreditarlas a plant_copies
    IF v_copies_to_add > 0 THEN
        INSERT INTO public.plant_copies (user_id, plant_id, copies)
        VALUES (v_uid, v_offer.plant_id, v_copies_to_add)
        ON CONFLICT (user_id, plant_id)
        DO UPDATE SET copies = public.plant_copies.copies + v_copies_to_add;
    END IF;

    -- 3. Registrar compra
    INSERT INTO public.flash_offer_purchases (
        offer_id, user_id, quantity, price_gems, total_gems
    ) VALUES (
        p_offer_id, v_uid, p_qty, v_offer.price_gems, v_total_cost
    );

    -- 4. Actualizar conteo global de ventas en la oferta
    UPDATE public.flash_offers
    SET sold_count = sold_count + p_qty
    WHERE offer_id = p_offer_id;

    -- 5. Registrar en transacciones del perfil
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
        v_uid,
        'flash_offer_purchase',
        v_total_cost,
        p_qty || ' × ' || v_offer.title || ' (' || v_offer.plant_id || ')',
        'completed'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'offerId', p_offer_id,
        'plantId', v_offer.plant_id,
        'quantity', p_qty,
        'priceGems', v_offer.price_gems,
        'totalGemsSpent', v_total_cost,
        'userTotalBought', (v_user_bought + p_qty),
        'remainingPurchases', (v_max_user - (v_user_bought + p_qty))
    );
END;
$$;

-- Otorgar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION public.get_flash_offer_status(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.buy_flash_offer(TEXT, INTEGER) TO authenticated;

COMMIT;
