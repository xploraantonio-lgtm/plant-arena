-- =============================================================================
-- PLANT ARENA · FASE 2b: TIENDA EN EL SERVIDOR
--
-- Idempotente.
--
-- MOTIVO PRINCIPAL: un fallo de economía, no sólo de seguridad.
--
--   Shop.tsx:243 handleBuyPacksBatch() comprueba que tengas gemas suficientes
--   y luego llama a onBuyPack() qty veces. Pero buyPack() (useInventory.ts)
--   sólo crea el sobre y lo mete en el inventario: NUNCA descuenta el saldo.
--   Los sobres han sido gratis desde el principio. El aviso de "gemas
--   insuficientes" es decorativo: basta con tener el saldo una vez para comprar
--   sobres sin límite.
--
--   Y buyGoldWithTokens(goldAmount, tokenCostUsd) recibe del cliente TANTO la
--   cantidad de oro COMO su precio, así que el tipo de cambio lo decidía el
--   navegador: pedir 1.000.000 de oro por 1 gema era una llamada.
--
-- Aquí los precios viven en la base y el cobro es atómico con la entrega.
--
-- PRECIOS TOMADOS TAL CUAL DEL CLIENTE
--   packDropManager.ts PACK_DEFINITIONS → basic 3, epic 8, legendary 10 gemas
--   Shop.tsx GOLD_PACKAGES             → 100/1, 250/2, 700/5
--   useInventory.ts buyVipPass()       → 10 gemas
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CATÁLOGOS DE PRECIO
--    El cliente puede leerlos para pintar la tienda, pero el cobro usa
--    siempre el valor de la base.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shop_packs (
    pack_id     TEXT PRIMARY KEY CHECK (pack_id IN ('basic','epic','legendary')),
    name        TEXT NOT NULL,
    price_gems  NUMERIC(12,2) NOT NULL CHECK (price_gems > 0),
    card_count  INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 10),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.shop_packs (pack_id, name, price_gems, card_count) VALUES
  ('basic',     'Sobre de Semillas Básico',          3,  3),
  ('epic',      'Sobre de Semillas Místico',         8,  4),
  ('legendary', 'Sobre de Semillas VIP Legendario', 10,  4)
ON CONFLICT (pack_id) DO UPDATE
  SET name = EXCLUDED.name,
      price_gems = EXCLUDED.price_gems,
      card_count = EXCLUDED.card_count;

CREATE TABLE IF NOT EXISTS public.shop_gold_packages (
    package_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    gold_amount BIGINT NOT NULL CHECK (gold_amount > 0),
    price_gems  NUMERIC(12,2) NOT NULL CHECK (price_gems > 0),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.shop_gold_packages (package_id, name, gold_amount, price_gems) VALUES
  ('gold_100', 'Bolsa de Monedas',        100, 1),
  ('gold_250', 'Cofre de Monedas',        250, 2),
  ('gold_700', 'Bóveda Real de Monedas',  700, 5)
ON CONFLICT (package_id) DO UPDATE
  SET name = EXCLUDED.name,
      gold_amount = EXCLUDED.gold_amount,
      price_gems = EXCLUDED.price_gems;

-- Configuración suelta: precio del pase VIP y límites.
CREATE TABLE IF NOT EXISTS public.shop_config (
    key   TEXT PRIMARY KEY,
    value NUMERIC NOT NULL
);
INSERT INTO public.shop_config (key, value) VALUES
  ('vip_pass_price_gems', 10),
  ('max_packs_per_purchase', 10)
ON CONFLICT (key) DO NOTHING;   -- DO NOTHING: no pisar un ajuste que hayas cambiado

-- Los tres catálogos son de lectura pública y de escritura sólo para admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shop_packs','shop_gold_packages','shop_config']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (TRUE)', t || '_read', t);

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
-- 2. COMPRAR SOBRES
--    Cobra y entrega en la misma transacción. Si algo falla, no pasa nada.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.buy_packs(p_pack_id TEXT, p_qty INTEGER DEFAULT 1)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_pack  RECORD;
  v_max   INTEGER;
  v_total NUMERIC;
  v_saldo NUMERIC;
  v_ids   UUID[] := '{}';
  v_id    UUID;
  i       INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT value::INTEGER INTO v_max FROM public.shop_config
   WHERE key = 'max_packs_per_purchase';
  v_max := COALESCE(v_max, 10);

  IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_qty > v_max THEN
    RAISE EXCEPTION 'Máximo % sobres por compra', v_max;
  END IF;

  SELECT * INTO v_pack FROM public.shop_packs
   WHERE pack_id = p_pack_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sobre no disponible: %', p_pack_id; END IF;

  v_total := v_pack.price_gems * p_qty;

  -- Bloquear el perfil antes de leer el saldo: sin esto, dos compras
  -- simultáneas podrían pasar el control las dos y dejar el saldo negativo.
  SELECT gems_balance INTO v_saldo FROM public.profiles
   WHERE id = v_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < v_total THEN
    RAISE EXCEPTION 'Gemas insuficientes: necesitas % y tienes %',
      v_total, COALESCE(v_saldo, 0);
  END IF;

  UPDATE public.profiles SET gems_balance = gems_balance - v_total
   WHERE id = v_uid;

  FOR i IN 1..p_qty LOOP
    INSERT INTO public.player_packs (user_id, pack_id, source)
    VALUES (v_uid, p_pack_id, 'purchase')
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'shop_purchase', v_total,
          p_qty || ' × ' || v_pack.name, 'completed');

  RETURN jsonb_build_object(
    'success',  TRUE,
    'packIds',  to_jsonb(v_ids),
    'spent',    v_total,
    'quantity', p_qty
  );
END;
$$;


-- =============================================================================
-- 3. COMPRAR ORO
--    El cliente manda sólo el identificador del paquete. La cantidad de oro y
--    el precio salen de la base, no del navegador.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.buy_gold(p_package_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_pkg   RECORD;
  v_saldo NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_pkg FROM public.shop_gold_packages
   WHERE package_id = p_package_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paquete no disponible: %', p_package_id; END IF;

  SELECT gems_balance INTO v_saldo FROM public.profiles
   WHERE id = v_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < v_pkg.price_gems THEN
    RAISE EXCEPTION 'Gemas insuficientes: necesitas % y tienes %',
      v_pkg.price_gems, COALESCE(v_saldo, 0);
  END IF;

  UPDATE public.profiles
     SET gems_balance = gems_balance - v_pkg.price_gems,
         gold_balance = gold_balance + v_pkg.gold_amount
   WHERE id = v_uid;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'shop_purchase', v_pkg.price_gems,
          v_pkg.name || ' (+' || v_pkg.gold_amount || ' oro)', 'completed');

  RETURN jsonb_build_object(
    'success', TRUE,
    'goldAdded', v_pkg.gold_amount,
    'spent', v_pkg.price_gems
  );
END;
$$;


-- =============================================================================
-- 4. COMPRAR PASE VIP
-- =============================================================================
CREATE OR REPLACE FUNCTION public.buy_vip_pass()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_precio NUMERIC;
  v_perfil RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT value INTO v_precio FROM public.shop_config WHERE key = 'vip_pass_price_gems';
  v_precio := COALESCE(v_precio, 10);

  SELECT gems_balance, has_vip_pass INTO v_perfil
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_perfil IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  IF v_perfil.has_vip_pass THEN RAISE EXCEPTION 'Ya tienes el pase VIP'; END IF;
  IF v_perfil.gems_balance < v_precio THEN
    RAISE EXCEPTION 'Gemas insuficientes: necesitas % y tienes %',
      v_precio, v_perfil.gems_balance;
  END IF;

  UPDATE public.profiles
     SET gems_balance = gems_balance - v_precio,
         has_vip_pass = TRUE
   WHERE id = v_uid;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'shop_purchase', v_precio, 'Pase VIP de temporada', 'completed');

  RETURN jsonb_build_object('success', TRUE, 'spent', v_precio);
END;
$$;


-- =============================================================================
-- 5. GASTAR ORO
--    El oro se usa para abrir cofres al instante
--    (calculateInstantUnlockGoldCost: 75 de oro por hora restante, mínimo 10).
--    El coste lo calcula el servidor con SU reloj.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.instant_unlock_pack_slot(p_slot_index INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_slot      RECORD;
  v_horas     NUMERIC;
  v_coste     BIGINT;
  v_oro       BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_slot_index IS NULL OR p_slot_index < 0 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'Índice de cofre inválido';
  END IF;

  SELECT * INTO v_slot FROM public.pack_slots
   WHERE user_id = v_uid AND slot_index = p_slot_index FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cofre no encontrado'; END IF;
  IF v_slot.status = 'ready'  THEN RAISE EXCEPTION 'El cofre ya está listo'; END IF;
  IF v_slot.status = 'empty'  THEN RAISE EXCEPTION 'El cofre está vacío'; END IF;

  -- Horas restantes según el reloj del servidor
  IF v_slot.status = 'unlocking' AND v_slot.unlock_started_at IS NOT NULL THEN
    v_horas := GREATEST(0, v_slot.duration_hours
                 - EXTRACT(EPOCH FROM (NOW() - v_slot.unlock_started_at)) / 3600.0);
  ELSE
    v_horas := v_slot.duration_hours;
  END IF;

  v_coste := GREATEST(10, CEIL(v_horas * 75))::BIGINT;

  SELECT gold_balance INTO v_oro FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_oro IS NULL OR v_oro < v_coste THEN
    RAISE EXCEPTION 'Oro insuficiente: necesitas % y tienes %', v_coste, COALESCE(v_oro, 0);
  END IF;

  UPDATE public.profiles SET gold_balance = gold_balance - v_coste WHERE id = v_uid;

  UPDATE public.pack_slots
     SET status = 'ready', unlock_started_at = NULL
   WHERE user_id = v_uid AND slot_index = p_slot_index;

  RETURN jsonb_build_object('success', TRUE, 'goldSpent', v_coste);
END;
$$;


-- =============================================================================
-- 6. PERMISOS DE EJECUCIÓN
-- =============================================================================
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('buy_packs','buy_gold','buy_vip_pass','instant_unlock_pack_slot')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fase2b_tienda', jsonb_build_object(
  'sobres', (SELECT count(*) FROM public.shop_packs),
  'paquetes_oro', (SELECT count(*) FROM public.shop_gold_packages)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Precios cargados. Espera 3 sobres y 3 paquetes de oro.
SELECT 'sobres' AS catalogo, pack_id AS id, name, price_gems, card_count::TEXT AS extra
  FROM public.shop_packs
UNION ALL
SELECT 'oro', package_id, name, price_gems, gold_amount::TEXT
  FROM public.shop_gold_packages
ORDER BY catalogo, price_gems;

-- 2. Config.
SELECT * FROM public.shop_config ORDER BY key;

-- 3. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');

-- 4. anon no escribe en ninguna tabla. Espera 0 filas.
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
   AND privilege_type IN ('INSERT','UPDATE','DELETE');
