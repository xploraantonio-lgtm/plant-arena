-- =============================================================================
-- PLANT ARENA: MASTER DATABASE SCHEMA & SECURITY POLICIES (SUPABASE / POSTGRESQL)
-- Script 100% Idempotente y Ejecutable en el Editor SQL de Supabase
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PERFILES & ECONOMÍA (0 Inicial, 1000 ELO, Pase VIP, Referidos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    avatar_id TEXT DEFAULT 'peashooter',
    country TEXT DEFAULT 'US',
    elo_rating INTEGER DEFAULT 1000 CHECK (elo_rating >= 0),
    gems_balance NUMERIC(12, 2) DEFAULT 0.00 CHECK (gems_balance >= 0),
    gold_balance BIGINT DEFAULT 0 CHECK (gold_balance >= 0),
    colosseum_tickets INTEGER DEFAULT 0 CHECK (colosseum_tickets >= 0),
    colosseum_current_streak INTEGER DEFAULT 0,
    colosseum_max_streak INTEGER DEFAULT 0,
    has_vip_pass BOOLEAN DEFAULT FALSE,
    claimed_vip_levels INTEGER[] DEFAULT '{}',
    is_admin BOOLEAN DEFAULT FALSE,
    referral_code TEXT UNIQUE,
    referred_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles are readable by everyone" ON public.profiles;
CREATE POLICY "Profiles are readable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own avatar and name" ON public.profiles;
CREATE POLICY "Users can update own avatar and name" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- 2. TRANSACCIONES Y RETIROS (Auditoría, Depósitos y Retiros Mínimo $10)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'colosseum_win', 'colosseum_bet', 'tournament_fee', 'marketplace_buy', 'marketplace_sell', 'clan_deposit', 'shop_purchase')),
    amount_gems NUMERIC(12, 2) NOT NULL,
    amount_usd NUMERIC(12, 2),
    fee_gems NUMERIC(12, 2) DEFAULT 0.00,
    wallet_address TEXT,
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. CARTAS, FUSIONES E INVENTARIO (Instancias NFT, Multiplicadores, Mazo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plant_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plant_id TEXT NOT NULL,
    rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
    star_level INTEGER DEFAULT 1 CHECK (star_level BETWEEN 1 AND 5),
    power_mult NUMERIC(5, 2) DEFAULT 1.00,
    hp_mult NUMERIC(5, 2) DEFAULT 1.00,
    speed_mult NUMERIC(5, 2) DEFAULT 1.00,
    cooldown_mult NUMERIC(5, 2) DEFAULT 1.00,
    is_in_deck BOOLEAN DEFAULT FALSE,
    deck_slot INTEGER CHECK (deck_slot BETWEEN 0 AND 5),
    is_listed_for_sale BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.plant_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own or listed plant cards" ON public.plant_instances;
CREATE POLICY "Users can view own or listed plant cards" ON public.plant_instances 
FOR SELECT USING (auth.uid() = owner_id OR is_listed_for_sale = true);

DROP POLICY IF EXISTS "Users can insert own plant cards" ON public.plant_instances;
CREATE POLICY "Users can insert own plant cards" ON public.plant_instances 
FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own plant deck assignments" ON public.plant_instances;
CREATE POLICY "Users can update own plant deck assignments" ON public.plant_instances 
FOR UPDATE USING (auth.uid() = owner_id);

-- -----------------------------------------------------------------------------
-- 4. SLOTS DE COFRES PVP (4 Slots con Desbloqueo por Tiempo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pack_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 0 AND 3),
    status TEXT NOT NULL CHECK (status IN ('empty', 'locked', 'unlocking', 'ready')),
    duration_hours INTEGER DEFAULT 4,
    arena_level INTEGER DEFAULT 1,
    unlock_started_at TIMESTAMPTZ,
    UNIQUE(user_id, slot_index)
);

ALTER TABLE public.pack_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own pack slots" ON public.pack_slots;
CREATE POLICY "Users can manage own pack slots" ON public.pack_slots FOR ALL USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 5. CLANES, BÓVEDA, DONACIONES Y GUERRA DE BASES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    tag TEXT UNIQUE NOT NULL,
    emblem_id TEXT DEFAULT 'emblem_leaf_shield',
    description TEXT,
    min_elo INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT TRUE,
    leader_id UUID REFERENCES public.profiles(id),
    vault_gems NUMERIC(12, 2) DEFAULT 0.00 CHECK (vault_gems >= 0),
    base_hp INTEGER DEFAULT 500,
    max_base_hp INTEGER DEFAULT 500,
    shield_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clan_members (
    clan_id UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('leader', 'elder', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(clan_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clan_donations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_id UUID NOT NULL REFERENCES public.clans(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plant_id TEXT NOT NULL,
    copies_requested INTEGER DEFAULT 5,
    copies_received INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clan_war_attacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attacker_clan_id UUID NOT NULL REFERENCES public.clans(id),
    target_clan_id UUID NOT NULL REFERENCES public.clans(id),
    attacker_user_id UUID NOT NULL REFERENCES public.profiles(id),
    damage_dealt INTEGER NOT NULL,
    shield_triggered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clans are public" ON public.clans;
CREATE POLICY "Clans are public" ON public.clans FOR SELECT USING (true);

ALTER TABLE public.clan_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan members are public" ON public.clan_members;
CREATE POLICY "Clan members are public" ON public.clan_members FOR SELECT USING (true);

ALTER TABLE public.clan_donations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan donations are public" ON public.clan_donations;
CREATE POLICY "Clan donations are public" ON public.clan_donations FOR SELECT USING (true);

ALTER TABLE public.clan_war_attacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clan war attacks are public" ON public.clan_war_attacks;
CREATE POLICY "Clan war attacks are public" ON public.clan_war_attacks FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 6. MERCADO P2P (Marketplace con Comisión del 5%)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id),
    plant_instance_id UUID NOT NULL REFERENCES public.plant_instances(id),
    price_gems NUMERIC(10, 2) NOT NULL CHECK (price_gems > 0),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
    buyer_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Marketplace is viewable by all" ON public.marketplace_listings;
CREATE POLICY "Marketplace is viewable by all" ON public.marketplace_listings FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 7. RULETA DE LA SUERTE Y CÓDIGO SECRETO DIARIO
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_lottery (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_free_spin TIMESTAMPTZ,
    extra_spins INTEGER DEFAULT 0,
    total_spins INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_secret_code (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    daily_secret TEXT NOT NULL,
    attempts_history JSONB DEFAULT '[]'::JSONB,
    free_attempts_used INTEGER DEFAULT 0,
    extra_attempts INTEGER DEFAULT 0,
    solved_today BOOLEAN DEFAULT FALSE,
    last_reset TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_lottery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own lottery" ON public.user_lottery;
CREATE POLICY "Users manage own lottery" ON public.user_lottery FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.user_secret_code ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own secret code" ON public.user_secret_code;
CREATE POLICY "Users manage own secret code" ON public.user_secret_code FOR ALL USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 8. TORNEOS OFICIALES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('free_code', 'paid')),
    access_code TEXT,
    entry_cost_gems NUMERIC(10, 2) DEFAULT 0.00,
    duration_minutes INTEGER DEFAULT 60,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    wins INTEGER DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER DEFAULT 0 CHECK (losses >= 0),
    max_losses INTEGER DEFAULT 3,
    is_eliminated BOOLEAN DEFAULT FALSE,
    final_rank INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tournament_id, user_id)
);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tournaments are public" ON public.tournaments;
CREATE POLICY "Tournaments are public" ON public.tournaments FOR SELECT USING (true);

ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tournament participants are public" ON public.tournament_participants;
CREATE POLICY "Tournament participants are public" ON public.tournament_participants FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 9. TEMPORADAS Y PREMIOS DE TEMPORADA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'finished')),
    top1_elo_reward NUMERIC(10, 2) DEFAULT 100.00,
    top2_elo_reward NUMERIC(10, 2) DEFAULT 50.00,
    top3_elo_reward NUMERIC(10, 2) DEFAULT 25.00,
    top1_colosseum_reward NUMERIC(10, 2) DEFAULT 50.00,
    top2_colosseum_reward NUMERIC(10, 2) DEFAULT 25.00,
    top3_colosseum_reward NUMERIC(10, 2) DEFAULT 10.00,
    is_current BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Seasons are viewable by all" ON public.seasons;
CREATE POLICY "Seasons are viewable by all" ON public.seasons FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 10. MATCHMAKING Y HISTORIAL DE SALAS PVP
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('ranked', 'friendly', 'colosseum', 'tournament')),
    tournament_id UUID REFERENCES public.tournaments(id),
    colosseum_bet NUMERIC(5, 2),
    user_elo INTEGER NOT NULL,
    room_code TEXT,
    status TEXT DEFAULT 'searching' CHECK (status IN ('searching', 'matched', 'cancelled')),
    matched_room_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.game_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode TEXT NOT NULL,
    player1_id UUID NOT NULL REFERENCES public.profiles(id),
    player2_id UUID NOT NULL REFERENCES public.profiles(id),
    seed BIGINT NOT NULL,
    p1_deck JSONB NOT NULL,
    p2_deck JSONB NOT NULL,
    colosseum_bet NUMERIC(5, 2) DEFAULT 0,
    tournament_id UUID REFERENCES public.tournaments(id),
    status TEXT DEFAULT 'playing' CHECK (status IN ('playing', 'p1_won', 'p2_won', 'draw', 'abandoned')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own matchmaking queue" ON public.matchmaking_queue;
CREATE POLICY "Users manage own matchmaking queue" ON public.matchmaking_queue FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Players can view own game rooms" ON public.game_rooms;
CREATE POLICY "Players can view own game rooms" ON public.game_rooms 
FOR SELECT USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- =============================================================================
-- FUNCIONES RPC ATÓMICAS (SEGURIDAD Y TRANSACCIONES DEL SERVIDOR)
-- =============================================================================

-- RPC 1: Retener Apuesta de Coliseo (Escrow)
CREATE OR REPLACE FUNCTION public.place_colosseum_wager(
    p_user_id UUID,
    p_bet NUMERIC
) RETURNS JSONB AS $$
BEGIN
    IF (SELECT gems_balance FROM public.profiles WHERE id = p_user_id) < p_bet THEN
        RAISE EXCEPTION 'Saldo insuficiente de gemas para apostar en el Coliseo';
    END IF;

    UPDATE public.profiles
    SET gems_balance = gems_balance - p_bet
    WHERE id = p_user_id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (p_user_id, 'colosseum_bet', p_bet, 'Apuesta Coliseo PvP', 'completed');

    RETURN jsonb_build_object('success', true, 'bet_placed', p_bet);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 2: Liquidación de Apuesta de Coliseo (80% Ganador / 20% Proyecto)
CREATE OR REPLACE FUNCTION public.resolve_colosseum_match(
    p_room_id UUID,
    p_winner_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_room RECORD;
    v_bet NUMERIC;
    v_payout NUMERIC;
    v_loser_id UUID;
BEGIN
    SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found';
    END IF;
    IF v_room.status != 'playing' THEN
        RAISE EXCEPTION 'Match already completed';
    END IF;
    
    v_bet := v_room.colosseum_bet;
    v_payout := v_bet * 1.6; -- 80% del pozo acumulado de ambos jugadores (2 * bet * 0.80)
    
    IF p_winner_id = v_room.player1_id THEN
        v_loser_id := v_room.player2_id;
    ELSE
        v_loser_id := v_room.player1_id;
    END IF;
    
    -- Acreditar ganador y registrar transacción
    UPDATE public.profiles 
    SET gems_balance = gems_balance + v_payout,
        colosseum_current_streak = colosseum_current_streak + 1,
        colosseum_max_streak = GREATEST(colosseum_max_streak, colosseum_current_streak + 1),
        elo_rating = elo_rating + 30
    WHERE id = p_winner_id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (p_winner_id, 'colosseum_win', v_payout, 'Victoria en Coliseo (80% Pozo)', 'completed');
    
    -- Penalizar perdedor
    UPDATE public.profiles 
    SET colosseum_current_streak = 0,
        elo_rating = GREATEST(0, elo_rating - 20)
    WHERE id = v_loser_id;
    
    UPDATE public.game_rooms 
    SET status = CASE WHEN p_winner_id = v_room.player1_id THEN 'p1_won' ELSE 'p2_won' END 
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'payout', v_payout, 'winner', p_winner_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 3: Publicar Carta en el Mercado P2P
CREATE OR REPLACE FUNCTION public.list_marketplace_card(
    p_seller_id UUID,
    p_plant_instance_id UUID,
    p_price_gems NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_plant RECORD;
    v_listing_id UUID;
BEGIN
    SELECT * INTO v_plant FROM public.plant_instances 
    WHERE id = p_plant_instance_id AND owner_id = p_seller_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No eres el propietario de esta planta';
    END IF;

    IF v_plant.is_listed_for_sale = true THEN
        RAISE EXCEPTION 'La planta ya se encuentra listada a la venta';
    END IF;

    -- Quitar de mazo y marcar para venta
    UPDATE public.plant_instances
    SET is_listed_for_sale = true, is_in_deck = false, deck_slot = null
    WHERE id = p_plant_instance_id;

    INSERT INTO public.marketplace_listings (seller_id, plant_instance_id, price_gems, status)
    VALUES (p_seller_id, p_plant_instance_id, p_price_gems, 'active')
    RETURNING id INTO v_listing_id;

    RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 4: Cancelar Publicación en el Mercado P2P
CREATE OR REPLACE FUNCTION public.cancel_marketplace_listing(
    p_seller_id UUID,
    p_listing_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_list RECORD;
BEGIN
    SELECT * INTO v_list FROM public.marketplace_listings
    WHERE id = p_listing_id AND seller_id = p_seller_id AND status = 'active' FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Publicación no encontrada o inactiva';
    END IF;

    UPDATE public.plant_instances
    SET is_listed_for_sale = false
    WHERE id = v_list.plant_instance_id;

    UPDATE public.marketplace_listings
    SET status = 'cancelled', closed_at = NOW()
    WHERE id = p_listing_id;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 5: Compra P2P Segura en Marketplace (Comisión 5% y Transferencia Inmediata)
CREATE OR REPLACE FUNCTION public.buy_marketplace_card(
    p_listing_id UUID,
    p_buyer_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_list RECORD;
    v_seller_payout NUMERIC;
BEGIN
    SELECT * INTO v_list FROM public.marketplace_listings WHERE id = p_listing_id AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta carta ya no está disponible';
    END IF;
    IF v_list.seller_id = p_buyer_id THEN
        RAISE EXCEPTION 'No puedes comprar tu propia carta';
    END IF;
    
    IF (SELECT gems_balance FROM public.profiles WHERE id = p_buyer_id) < v_list.price_gems THEN
        RAISE EXCEPTION 'Saldo insuficiente de gemas';
    END IF;
    
    v_seller_payout := v_list.price_gems * 0.95; -- 5% fee de la casa
    
    -- Transferir balances y registrar transacciones
    UPDATE public.profiles SET gems_balance = gems_balance - v_list.price_gems WHERE id = p_buyer_id;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (p_buyer_id, 'marketplace_buy', v_list.price_gems, 'Compra de Carta en Mercado P2P', 'completed');

    UPDATE public.profiles SET gems_balance = gems_balance + v_seller_payout WHERE id = v_list.seller_id;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_list.seller_id, 'marketplace_sell', v_seller_payout, 'Venta de Carta en Mercado P2P (95%)', 'completed');
    
    -- Transferir propiedad de la carta al comprador
    UPDATE public.plant_instances 
    SET owner_id = p_buyer_id, is_listed_for_sale = false, is_in_deck = false, deck_slot = null
    WHERE id = v_list.plant_instance_id;
    
    -- Cerrar listado
    UPDATE public.marketplace_listings 
    SET status = 'sold', buyer_id = p_buyer_id, closed_at = NOW() 
    WHERE id = p_listing_id;
    
    RETURN jsonb_build_object('success', true, 'price_gems', v_list.price_gems);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 6: Depósito al Clan con Bono de Tickets de Coliseo
CREATE OR REPLACE FUNCTION public.deposit_to_clan_vault(
    p_clan_id UUID,
    p_user_id UUID,
    p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_tickets INTEGER;
BEGIN
    IF (SELECT gems_balance FROM public.profiles WHERE id = p_user_id) < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente de gemas';
    END IF;
    
    v_tickets := FLOOR(p_amount)::INTEGER;
    
    UPDATE public.profiles 
    SET gems_balance = gems_balance - p_amount,
        colosseum_tickets = colosseum_tickets + v_tickets
    WHERE id = p_user_id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (p_user_id, 'clan_deposit', p_amount, 'Donación a la Bóveda del Clan (+' || v_tickets || ' Tickets)', 'completed');
    
    UPDATE public.clans 
    SET vault_gems = vault_gems + p_amount 
    WHERE id = p_clan_id;
    
    RETURN jsonb_build_object('success', true, 'tickets_awarded', v_tickets, 'vault_added', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- TRIGGER AUTOMÁTICO: CREACIÓN DE PERFIL Y 4 PLANTAS INICIALES AL REGISTRARSE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_id, elo_rating, gems_balance, gold_balance, colosseum_tickets)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Guerrero'),
    'peashooter',
    1000,
    0.0,
    0,
    0
  )
  ON CONFLICT (id) DO NOTHING;

  -- 4 cartas iniciales oficiales
  INSERT INTO public.plant_instances (owner_id, plant_id, rarity, star_level, is_in_deck, deck_slot)
  VALUES
    (new.id, 'sunflower', 'common', 1, true, 0),
    (new.id, 'peashooter', 'common', 1, true, 1),
    (new.id, 'wallnut', 'common', 1, true, 2),
    (new.id, 'chomper', 'common', 1, true, 3)
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Insertar Temporada 1 Oficial inicial
INSERT INTO public.seasons (season_number, name, starts_at, ends_at, status)
VALUES (1, 'Temporada 1: Cosecha de Gloria', NOW(), NOW() + INTERVAL '30 days', 'active')
ON CONFLICT DO NOTHING;
