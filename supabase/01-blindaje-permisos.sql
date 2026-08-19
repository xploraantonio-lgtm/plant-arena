-- =============================================================================
-- PLANT ARENA · FASE 1: BLINDAJE DE PERMISOS
--
-- Idempotente: se puede ejecutar varias veces sin daño.
-- Escrito contra el estado REAL de la base (diagnóstico del 19-08-2026), no
-- contra schema.sql, que está desincronizado.
--
-- PRINCIPIO: el cliente sólo puede escribir lo que no tiene valor. Todo lo que
-- afecta al saldo, al inventario, al ELO o a la administración pasa por una
-- función SECURITY DEFINER que saca la identidad de auth.uid().
--
-- Datos al ejecutar: 1 perfil, 4 cartas, 0 transacciones. No hay nada que
-- preservar, así que el blindaje puede ser agresivo.
--
-- ROMPE A PROPÓSITO (todo esto ya estaba roto o era explotable):
--   · Crear perfil desde el cliente        -> lo hará el trigger
--   · Insertar/mejorar cartas               -> requiere RPC (fase 2)
--   · Manipular cofres y lotería            -> requiere RPC (fase 2)
--   · Escribir elo_rating desde el cliente  -> lo calcula el servidor
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. AUDITORÍA: guardar el estado previo por si hay que comparar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._migration_audit (
    id          BIGSERIAL PRIMARY KEY,
    fase        TEXT NOT NULL,
    detalle     JSONB,
    ejecutado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public._migration_audit ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie salvo service_role la lee. Es intencional.

INSERT INTO public._migration_audit (fase, detalle)
SELECT 'fase1_inicio', jsonb_build_object(
  'perfiles',        (SELECT count(*) FROM public.profiles),
  'cartas',          (SELECT count(*) FROM public.plant_instances),
  'transacciones',   (SELECT count(*) FROM public.transactions)
);


-- =============================================================================
-- 1. CORREGIR EL ESQUEMA
-- =============================================================================

-- 1.1 transactions.description: las RPC la insertan y no existe. Por eso
--     buy_marketplace_card, deposit_to_clan_vault y resolve_colosseum_match
--     fallaban en ejecución.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 1.2 game_rooms: confirmación por ambos lados del resultado. Sin esto, quien
--     llama a la resolución declara el ganador, o sea se declara ganador a sí
--     mismo. Con esto el pago sólo ocurre si los dos reportan lo mismo.
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS p1_reported_winner UUID,
  ADD COLUMN IF NOT EXISTS p2_reported_winner UUID,
  ADD COLUMN IF NOT EXISTS settled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escrow_gems        NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 1.3 Trazabilidad de la apuesta retenida, para no pagar un pozo que no existe.
CREATE TABLE IF NOT EXISTS public.colosseum_escrow (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bet_gems   NUMERIC(12,2) NOT NULL CHECK (bet_gems > 0),
    room_id    UUID REFERENCES public.game_rooms(id),
    status     TEXT NOT NULL DEFAULT 'held'
               CHECK (status IN ('held', 'settled', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.colosseum_escrow ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escrow_select_own" ON public.colosseum_escrow;
CREATE POLICY "escrow_select_own" ON public.colosseum_escrow
  FOR SELECT USING (auth.uid() = user_id);


-- =============================================================================
-- 2. QUITAR TODOS LOS PERMISOS DE ESCRITURA
--    Punto de partida: nadie escribe nada. Después se devuelve lo mínimo.
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM authenticated;

-- anon queda estrictamente de lectura. Si mañana añades una tabla, no hereda
-- permisos de escritura por defecto.
DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE 'No se pudieron ajustar los privilegios por defecto (hazlo como postgres).';
END $$;

-- Ninguna función debe ser invocable sin sesión. anon no juega.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE 'Privilegios por defecto de funciones sin ajustar.';
END $$;


-- =============================================================================
-- 3. HELPER: ¿el usuario actual es administrador?
--    SECURITY DEFINER para poder leer profiles sin depender de RLS.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), FALSE);
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;


-- =============================================================================
-- 4. PROFILES
-- =============================================================================

-- 4.1 El cliente ya no crea perfiles: lo hace el trigger sobre auth.users.
--     Esta política permitía insertar la propia fila con saldo e is_admin
--     arbitrarios, que era la escalada más directa que quedaba.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- 4.2 Sólo cosmética, y sólo la fila propia. (Ya lo aplicaste; se reafirma
--     porque el REVOKE del punto 2 borró el GRANT.)
DROP POLICY IF EXISTS "Users can update own avatar and name" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_cosmetics"      ON public.profiles;
CREATE POLICY "profiles_update_own_cosmetics" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT UPDATE (username, avatar_id, country) ON public.profiles TO authenticated;

-- 4.3 Lectura. anon (visitante sin sesión) sólo ve lo que necesita el ranking
--     público de la landing: ni saldos, ni códigos de referido.
REVOKE SELECT ON public.profiles FROM anon;
GRANT  SELECT (
  id, username, avatar_id, country, elo_rating,
  colosseum_current_streak, colosseum_max_streak, created_at
) ON public.profiles TO anon;

-- LIMITACIÓN CONOCIDA, asumida a propósito:
-- authenticated conserva SELECT sobre todas las columnas, así que un jugador
-- con sesión puede leer el saldo de otros. Es divulgación de información, no
-- robo: con las RPC del punto 8 arregladas, conocer un saldo no permite
-- tocarlo. No lo cierro aquí porque la política de lectura es USING(true) y
-- RLS no filtra por columna: taparlo exige una vista pública aparte y cambiar
-- los select('*') del cliente (getProfile, getGlobalLeaderboard), y eso
-- rompería el login si se hace en el mismo paso. Va en la fase 2.


-- =============================================================================
-- 5. PLANT_INSTANCES — el inventario de cartas
-- =============================================================================

-- 5.1 Acuñar cartas desde el cliente se acabó. Las cartas vienen de sobres,
--     compras o fusiones, y todo eso será RPC (fase 2).
DROP POLICY IF EXISTS "Users can insert own plant cards" ON public.plant_instances;

-- 5.2 Lo único que el jugador decide sobre una carta que ya tiene es si va en
--     el mazo. Ni rareza, ni estrellas, ni multiplicadores, ni dueño.
DROP POLICY IF EXISTS "Users can update own plant deck assignments" ON public.plant_instances;
CREATE POLICY "plants_update_own_deck" ON public.plant_instances
  FOR UPDATE
  USING      (auth.uid() = owner_id AND is_listed_for_sale = FALSE)
  WITH CHECK (auth.uid() = owner_id AND is_listed_for_sale = FALSE);

GRANT UPDATE (is_in_deck, deck_slot) ON public.plant_instances TO authenticated;
-- is_listed_for_sale NO se concede: lo gestiona la RPC del mercado. Y la
-- condición de arriba impide reorganizar una carta que está en venta.

DROP POLICY IF EXISTS "Users can view own or listed plant cards" ON public.plant_instances;
CREATE POLICY "plants_select_own_or_listed" ON public.plant_instances
  FOR SELECT USING (auth.uid() = owner_id OR is_listed_for_sale = TRUE);


-- =============================================================================
-- 6. TABLAS QUE PASAN A SÓLO LECTURA PARA EL CLIENTE
--    Las políticas FOR ALL de estas tablas permitían, con los grants de
--    columna, saltarse temporizadores y contadores enteros.
-- =============================================================================

-- 6.1 pack_slots: los cofres se abrían poniendo status='ready' a mano.
DROP POLICY IF EXISTS "Users can manage own pack slots" ON public.pack_slots;
CREATE POLICY "pack_slots_select_own" ON public.pack_slots
  FOR SELECT USING (auth.uid() = user_id);

-- 6.2 user_lottery: extra_spins era editable.
DROP POLICY IF EXISTS "Users manage own lottery" ON public.user_lottery;
CREATE POLICY "lottery_select_own" ON public.user_lottery
  FOR SELECT USING (auth.uid() = user_id);

-- 6.3 user_secret_code: el jugador podía LEER daily_secret, o sea la
--     respuesta del acertijo. La columna deja de ser visible; la comprobación
--     del intento se hará en una RPC que compara sin revelar.
DROP POLICY IF EXISTS "Users manage own secret code" ON public.user_secret_code;
CREATE POLICY "secret_code_select_own" ON public.user_secret_code
  FOR SELECT USING (auth.uid() = user_id);

REVOKE SELECT ON public.user_secret_code FROM anon, authenticated;
GRANT  SELECT (user_id, attempts_history, free_attempts_used,
               extra_attempts, solved_today, last_reset)
  ON public.user_secret_code TO authenticated;

-- 6.4 transactions: historial, nunca escritura. Las RPC insertan por ser
--     SECURITY DEFINER.
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);


-- =============================================================================
-- 7. MATCHMAKING — el jugador entra en cola pero no decide el resultado
-- =============================================================================

DROP POLICY IF EXISTS "Users manage own matchmaking queue" ON public.matchmaking_queue;

-- Entra en cola declarando su ELO... que se verifica contra el real. Así no
-- puede fingir ELO bajo para emparejarse con novatos.
CREATE POLICY "queue_insert_own" ON public.matchmaking_queue
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND status = 'searching'
    AND matched_room_id IS NULL
    AND user_elo = (SELECT elo_rating FROM public.profiles WHERE id = auth.uid())
  );

-- Lo único que puede cambiar es cancelar. No puede marcarse 'matched'.
CREATE POLICY "queue_cancel_own" ON public.matchmaking_queue
  FOR UPDATE
  USING      (auth.uid() = user_id AND status = 'searching')
  WITH CHECK (auth.uid() = user_id AND status = 'cancelled');

CREATE POLICY "queue_select_own" ON public.matchmaking_queue
  FOR SELECT USING (auth.uid() = user_id);

GRANT INSERT (user_id, mode, user_elo, colosseum_bet, tournament_id, room_code)
  ON public.matchmaking_queue TO authenticated;
GRANT UPDATE (status) ON public.matchmaking_queue TO authenticated;

-- game_rooms: sólo lectura de las propias. Las crea la RPC de emparejamiento.
DROP POLICY IF EXISTS "Players can view own game rooms" ON public.game_rooms;
CREATE POLICY "rooms_select_own" ON public.game_rooms
  FOR SELECT USING (auth.uid() IN (player1_id, player2_id));


-- =============================================================================
-- 8. RPC DE ECONOMÍA — reescritas con auth.uid()
--    Regla: ninguna acepta el id del usuario como parámetro.
-- =============================================================================

-- 8.0 Borrar las versiones vulnerables por firma exacta. CREATE OR REPLACE con
--     otra lista de argumentos crea una sobrecarga nueva y deja la vieja viva:
--     es lo que pasó con place_colosseum_wager.
DROP FUNCTION IF EXISTS public.place_colosseum_wager(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.resolve_colosseum_match(UUID, UUID);
DROP FUNCTION IF EXISTS public.buy_marketplace_card(UUID, UUID);
DROP FUNCTION IF EXISTS public.deposit_to_clan_vault(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.list_marketplace_card(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.cancel_marketplace_listing(UUID, UUID);


-- 8.1 Mi propio saldo (sustituye al SELECT directo de las columnas sensibles).
CREATE OR REPLACE FUNCTION public.my_balance()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid(); r RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT gems_balance, gold_balance, colosseum_tickets, elo_rating,
         has_vip_pass, claimed_vip_levels,
         colosseum_current_streak, colosseum_max_streak
    INTO r FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  RETURN to_jsonb(r);
END;
$$;


-- 8.2 Retener apuesta del coliseo. Mantiene tu versión y añade el registro en
--     transactions y el apunte de escrow, que faltaban.
CREATE OR REPLACE FUNCTION public.place_colosseum_wager(p_bet NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_saldo NUMERIC;
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_bet IS NULL OR p_bet <= 0 THEN RAISE EXCEPTION 'Apuesta inválida'; END IF;
  IF p_bet > 1000 THEN RAISE EXCEPTION 'Apuesta por encima del máximo permitido'; END IF;

  SELECT gems_balance INTO v_saldo
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < p_bet THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  UPDATE public.profiles SET gems_balance = gems_balance - p_bet WHERE id = v_uid;

  INSERT INTO public.colosseum_escrow (user_id, bet_gems)
  VALUES (v_uid, p_bet) RETURNING id INTO v_id;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'colosseum_bet', p_bet, 'Apuesta retenida en el Coliseo', 'completed');

  RETURN jsonb_build_object('success', true, 'escrow_id', v_id, 'bet_placed', p_bet);
END;
$$;


-- 8.3 Reportar el resultado. El pago sólo ocurre cuando LOS DOS jugadores
--     reportan el mismo ganador. Un jugador solo no puede cobrar nada, que era
--     el agujero central del coliseo.
CREATE OR REPLACE FUNCTION public.report_match_result(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_room   RECORD;
  v_pozo   NUMERIC := 0;
  v_pago   NUMERIC := 0;
  v_perdedor UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  -- Sólo los dos participantes opinan, y el ganador ha de ser uno de ellos.
  IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;
  IF p_winner_id NOT IN (v_room.player1_id, v_room.player2_id) THEN
    RAISE EXCEPTION 'El ganador declarado no participa en esta partida';
  END IF;
  IF v_room.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Partida ya liquidada';
  END IF;

  -- Registrar el reporte de quien llama, sin sobreescribir el ya emitido.
  IF v_uid = v_room.player1_id THEN
    IF v_room.p1_reported_winner IS NOT NULL THEN
      RAISE EXCEPTION 'Ya reportaste el resultado';
    END IF;
    UPDATE public.game_rooms SET p1_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p1_reported_winner := p_winner_id;
  ELSE
    IF v_room.p2_reported_winner IS NOT NULL THEN
      RAISE EXCEPTION 'Ya reportaste el resultado';
    END IF;
    UPDATE public.game_rooms SET p2_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p2_reported_winner := p_winner_id;
  END IF;

  -- Falta el otro: se espera. Nada se paga todavía.
  IF v_room.p1_reported_winner IS NULL OR v_room.p2_reported_winner IS NULL THEN
    RETURN jsonb_build_object('success', true, 'status', 'esperando_al_rival');
  END IF;

  -- Discrepancia: se congela para revisión. No se paga a nadie.
  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw' WHERE id = p_room_id;
    RETURN jsonb_build_object('success', false, 'status', 'resultado_en_disputa');
  END IF;

  -- Acuerdo: liquidar.
  v_perdedor := CASE WHEN p_winner_id = v_room.player1_id
                     THEN v_room.player2_id ELSE v_room.player1_id END;

  -- El pozo es lo REALMENTE retenido, no lo que diga el cliente.
  SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo
    FROM public.colosseum_escrow
   WHERE room_id = p_room_id AND status = 'held';

  v_pago := ROUND(v_pozo * 0.80, 2);   -- 80% al ganador, 20% a la casa

  UPDATE public.profiles
     SET colosseum_current_streak = colosseum_current_streak + 1,
         colosseum_max_streak     = GREATEST(colosseum_max_streak,
                                             colosseum_current_streak + 1),
         elo_rating               = elo_rating + 30,
         gems_balance             = gems_balance + v_pago
   WHERE id = p_winner_id;

  UPDATE public.profiles
     SET colosseum_current_streak = 0,
         elo_rating               = GREATEST(0, elo_rating - 20)
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

  RETURN jsonb_build_object('success', true, 'status', 'liquidada',
                            'winner', p_winner_id, 'payout', v_pago);
END;
$$;


-- 8.4 Publicar carta en el mercado. No existía en la base: vender nunca
--     funcionó. El vendedor es siempre quien llama.
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


-- 8.5 Cancelar publicación propia.
CREATE OR REPLACE FUNCTION public.cancel_marketplace_listing(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid(); v_list RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_list FROM public.marketplace_listings
   WHERE id = p_listing_id AND seller_id = v_uid AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publicación no encontrada o ya cerrada'; END IF;

  UPDATE public.plant_instances
     SET is_listed_for_sale = FALSE WHERE id = v_list.plant_instance_id;
  UPDATE public.marketplace_listings
     SET status = 'cancelled', closed_at = NOW() WHERE id = p_listing_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 8.6 Comprar carta. El comprador es siempre quien llama: ya no se puede
--     forzar a otro jugador a comprar y vaciarle el saldo.
CREATE OR REPLACE FUNCTION public.buy_marketplace_card(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_list RECORD;
  v_saldo NUMERIC;
  v_pago_vendedor NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_list FROM public.marketplace_listings
   WHERE id = p_listing_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta carta ya no está disponible'; END IF;
  IF v_list.seller_id = v_uid THEN RAISE EXCEPTION 'No puedes comprar tu propia carta'; END IF;

  -- Bloquear los dos perfiles en orden estable de id: evita interbloqueos
  -- cuando dos compras cruzadas ocurren a la vez.
  PERFORM 1 FROM public.profiles
    WHERE id IN (v_uid, v_list.seller_id) ORDER BY id FOR UPDATE;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid;
  IF v_saldo IS NULL OR v_saldo < v_list.price_gems THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  v_pago_vendedor := ROUND(v_list.price_gems * 0.95, 2);  -- 5% comisión

  UPDATE public.profiles SET gems_balance = gems_balance - v_list.price_gems
   WHERE id = v_uid;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'marketplace_buy', v_list.price_gems, 'Compra de carta en el mercado', 'completed');

  UPDATE public.profiles SET gems_balance = gems_balance + v_pago_vendedor
   WHERE id = v_list.seller_id;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_list.seller_id, 'marketplace_sell', v_pago_vendedor, 'Venta de carta en el mercado (95%)', 'completed');

  UPDATE public.plant_instances
     SET owner_id = v_uid, is_listed_for_sale = FALSE,
         is_in_deck = FALSE, deck_slot = NULL
   WHERE id = v_list.plant_instance_id;

  UPDATE public.marketplace_listings
     SET status = 'sold', buyer_id = v_uid, closed_at = NOW()
   WHERE id = p_listing_id;

  RETURN jsonb_build_object('success', true, 'price_gems', v_list.price_gems);
END;
$$;


-- 8.7 Donar a la bóveda del clan. Sólo con gemas propias, y sólo a un clan
--     del que se sea miembro.
CREATE OR REPLACE FUNCTION public.deposit_to_clan_vault(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clan_id UUID;
  v_saldo NUMERIC;
  v_tickets INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Importe inválido'; END IF;

  -- El clan se deduce de la pertenencia, no lo elige el cliente.
  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN RAISE EXCEPTION 'No perteneces a ningún clan'; END IF;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < p_amount THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;

  v_tickets := FLOOR(p_amount)::INTEGER;

  UPDATE public.profiles
     SET gems_balance      = gems_balance - p_amount,
         colosseum_tickets = colosseum_tickets + v_tickets
   WHERE id = v_uid;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'clan_deposit', p_amount,
          'Donación a la bóveda del clan (+' || v_tickets || ' tickets)', 'completed');

  UPDATE public.clans SET vault_gems = vault_gems + p_amount WHERE id = v_clan_id;

  RETURN jsonb_build_object('success', true, 'tickets_awarded', v_tickets,
                            'clan_id', v_clan_id);
END;
$$;


-- =============================================================================
-- 9. PERMISOS DE EJECUCIÓN: sólo usuarios con sesión
-- =============================================================================
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN (
         'my_balance', 'place_colosseum_wager', 'report_match_result',
         'list_marketplace_card', 'cancel_marketplace_listing',
         'buy_marketplace_card', 'deposit_to_clan_vault',
         'current_user_is_admin'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

-- handle_new_user es de trigger: nadie debe poder invocarla directamente.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, PUBLIC', f.sig);
  END LOOP;
END $$;


-- =============================================================================
-- 10. CONTENIDO ADMINISTRATIVO — el panel necesita escribir, verificado en
--     el servidor. Ocultar el botón no bastaba.
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tournaments', 'seasons']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL
        USING (public.current_user_is_admin())
        WITH CHECK (public.current_user_is_admin())
    $f$, t || '_admin_write', t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;


-- =============================================================================
-- 11. ÍNDICES para las consultas que la migración vuelve calientes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_elo          ON public.profiles (elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_streak       ON public.profiles (colosseum_max_streak DESC);
CREATE INDEX IF NOT EXISTS idx_plants_owner          ON public.plant_instances (owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_active       ON public.marketplace_listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_searching       ON public.matchmaking_queue (mode, status, user_elo);
CREATE INDEX IF NOT EXISTS idx_escrow_room           ON public.colosseum_escrow (room_id, status);
CREATE INDEX IF NOT EXISTS idx_tx_user              ON public.transactions (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_members_user ON public.clan_members (user_id);


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fase1_fin', jsonb_build_object('ok', true));

COMMIT;

-- =============================================================================
-- COMPROBACIÓN: ninguna fila debe salir aquí.
-- =============================================================================
-- Funciones SECURITY DEFINER sin auth.uid() o ejecutables por anon:
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
       (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%')  AS usa_auth_uid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname <> 'handle_new_user'
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');
