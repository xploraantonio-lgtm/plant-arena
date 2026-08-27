-- ============================================================================
-- MIGRACIÓN 44: SISTEMA DE DEPÓSITOS Y RETIROS USDT BEP20 → GEMAS
--
-- REGLAS ECONÓMICAS Y DE SEGURIDAD:
-- 1. 1 USDT = 1 Gema (conversión exacta sin redondeos destructivos).
-- 2. Depósitos automáticos SOLO desde wallets personales/self-custody registradas.
-- 3. Retiros: 5% de comisión de Plant Arena deducida del monto solicitado.
-- 4. Idempotencia total a nivel de blockchain (network, tx_hash, log_index).
-- 5. Deducción y acreditación atómica de saldo con bloqueo FOR UPDATE.
-- ============================================================================

-- ── 1. TABLA DE WALLETS DE DEPÓSITO REGISTRADAS ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.deposit_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'bsc-mainnet',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deposit_wallets_address_format CHECK (normalized_address ~ '^0x[a-f0-9]{40}$'),
  CONSTRAINT deposit_wallets_unique_active UNIQUE (normalized_address, network)
);

CREATE INDEX IF NOT EXISTS idx_deposit_wallets_lookup ON public.deposit_wallets (normalized_address, network) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_deposit_wallets_user ON public.deposit_wallets (user_id);

-- ── 2. TABLA LEDGER DE DEPÓSITOS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deposit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  deposit_wallet_id UUID REFERENCES public.deposit_wallets(id),
  network TEXT NOT NULL DEFAULT 'bsc-mainnet',
  token_contract TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  block_number BIGINT NOT NULL,
  sender_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  amount_usdt NUMERIC(18,6) NOT NULL CHECK (amount_usdt > 0),
  amount_gems NUMERIC(18,6) NOT NULL CHECK (amount_gems > 0),
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirming', 'confirmed', 'credited', 'unmatched', 'rejected', 'failed')),
  confirmations INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deposit_tx_unique_event UNIQUE (network, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_deposit_tx_user ON public.deposit_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_status ON public.deposit_transactions (status);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_sender ON public.deposit_transactions (sender_address);

-- ── 3. TABLA LEDGER DE RETIROS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawal_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  amount_gems NUMERIC(18,6) NOT NULL CHECK (amount_gems > 0),
  fee_gems NUMERIC(18,6) NOT NULL CHECK (fee_gems >= 0),
  net_gems NUMERIC(18,6) NOT NULL CHECK (net_gems > 0),
  amount_usdt NUMERIC(18,6) NOT NULL CHECK (amount_usdt > 0),
  fee_usdt NUMERIC(18,6) NOT NULL CHECK (fee_usdt >= 0),
  net_amount_usdt NUMERIC(18,6) NOT NULL CHECK (net_amount_usdt > 0),
  destination_wallet TEXT NOT NULL,
  normalized_destination TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'bsc-mainnet',
  token_contract TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'broadcasted', 'confirmed', 'completed', 'failed', 'cancelled', 'rejected')),
  tx_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT withdrawal_address_format CHECK (normalized_destination ~ '^0x[a-f0-9]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_tx_user ON public.withdrawal_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_tx_status ON public.withdrawal_transactions (status);

-- ── 4. CONFIGURACIÓN GLOBAL DE CRIPTO / TESORERÍA ───────────────────────────
CREATE TABLE IF NOT EXISTS public.crypto_treasury_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.crypto_treasury_config (key, value, description)
VALUES 
  ('bsc_treasury_wallet', '0x721622D8cad39621C731eC286D1EA859365A51b8', 'Wallet oficial de recepción de depósitos en BSC'),
  ('usdt_bep20_contract', '0x55d398326f99059fF775485246999027B3197955', 'Contrato oficial USDT BEP20 Mainnet'),
  ('min_withdrawal_gems', '1.00', 'Retiro mínimo permitido en gemas'),
  ('max_withdrawal_gems', '500.00', 'Retiro máximo por transacción en gemas'),
  ('daily_withdrawal_limit_gems', '1000.00', 'Límite diario total de retiros por usuario en gemas'),
  ('max_daily_withdrawals_count', '5', 'Número máximo de retiros por día por usuario'),
  ('withdrawal_fee_percent', '5.00', 'Porcentaje de comisión de retiro (5%)')
ON CONFLICT (key) DO NOTHING;

-- ── 5. SEGURIDAD Y PERMISOS RLS ──────────────────────────────────────────────
ALTER TABLE public.deposit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_treasury_config ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura para usuarios autenticados
DROP POLICY IF EXISTS "deposit_wallets_select_own" ON public.deposit_wallets;
CREATE POLICY "deposit_wallets_select_own" ON public.deposit_wallets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "deposit_transactions_select_own" ON public.deposit_transactions;
CREATE POLICY "deposit_transactions_select_own" ON public.deposit_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "withdrawal_transactions_select_own" ON public.withdrawal_transactions;
CREATE POLICY "withdrawal_transactions_select_own" ON public.withdrawal_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "crypto_treasury_config_select" ON public.crypto_treasury_config;
CREATE POLICY "crypto_treasury_config_select" ON public.crypto_treasury_config
  FOR SELECT TO authenticated
  USING (true);

-- ── 6. RPC: REGISTRAR WALLET PERSONAL DE DEPÓSITO ────────────────────────────
CREATE OR REPLACE FUNCTION public.register_deposit_wallet(p_wallet_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_norm TEXT;
  v_existing_owner UUID;
  v_wallet_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Debes iniciar sesión.');
  END IF;

  IF p_wallet_address IS NULL OR TRIM(p_wallet_address) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ADDRESS', 'message', 'Dirección de wallet vacía.');
  END IF;

  v_norm := LOWER(TRIM(p_wallet_address));
  IF v_norm !~ '^0x[a-f0-9]{40}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ETH_FORMAT', 'message', 'Formato de dirección BEP20 inválido (debe iniciar con 0x y tener 40 caracteres hexadecimales).');
  END IF;

  -- Comprobar si ya pertenece a otro usuario activo
  SELECT user_id INTO v_existing_owner
  FROM public.deposit_wallets
  WHERE normalized_address = v_norm AND network = 'bsc-mainnet' AND status = 'active'
  LIMIT 1;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'WALLET_ALREADY_REGISTERED', 'message', 'Esta wallet personal ya está registrada por otra cuenta de Plant Arena.');
  END IF;

  -- Desactivar cualquier wallet previa del mismo usuario para esta red
  UPDATE public.deposit_wallets
  SET status = 'revoked', updated_at = NOW()
  WHERE user_id = v_uid AND network = 'bsc-mainnet' AND normalized_address <> v_norm;

  -- Insertar o reactivar la nueva wallet
  INSERT INTO public.deposit_wallets (user_id, wallet_address, normalized_address, network, status, verified_at, updated_at)
  VALUES (v_uid, TRIM(p_wallet_address), v_norm, 'bsc-mainnet', 'active', NOW(), NOW())
  ON CONFLICT (normalized_address, network)
  DO UPDATE SET status = 'active', user_id = v_uid, updated_at = NOW()
  RETURNING id INTO v_wallet_id;

  RETURN jsonb_build_object(
    'success', true,
    'wallet', jsonb_build_object(
      'id', v_wallet_id,
      'address', TRIM(p_wallet_address),
      'normalized', v_norm,
      'network', 'bsc-mainnet',
      'status', 'active'
    )
  );
END;
$$;

-- ── 7. RPC: OBTENER DATOS DE DEPÓSITO Y WALLET REGISTRADA ─────────────────────
CREATE OR REPLACE FUNCTION public.get_deposit_info()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_wallet RECORD;
  v_treasury TEXT;
  v_usdt_contract TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_wallet
  FROM public.deposit_wallets
  WHERE user_id = v_uid AND network = 'bsc-mainnet' AND status = 'active'
  LIMIT 1;

  SELECT value INTO v_treasury FROM public.crypto_treasury_config WHERE key = 'bsc_treasury_wallet';
  SELECT value INTO v_usdt_contract FROM public.crypto_treasury_config WHERE key = 'usdt_bep20_contract';

  RETURN jsonb_build_object(
    'success', true,
    'registeredWallet', CASE
      WHEN v_wallet.id IS NOT NULL THEN jsonb_build_object(
        'id', v_wallet.id,
        'address', v_wallet.wallet_address,
        'normalized', v_wallet.normalized_address,
        'status', v_wallet.status,
        'createdAt', v_wallet.created_at
      )
      ELSE NULL
    END,
    'treasuryWallet', COALESCE(v_treasury, '0x721622D8cad39621C731eC286D1EA859365A51b8'),
    'tokenContract', COALESCE(v_usdt_contract, '0x55d398326f99059fF775485246999027B3197955'),
    'network', 'BNB Smart Chain (BEP20)',
    'rate', '1 USDT = 1 GEMA'
  );
END;
$$;

-- ── 8. RPC: SOLICITAR RETIRO (5% COMISIÓN SERVER-AUTHORITATIVE) ────────────────
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount_gems NUMERIC,
  p_destination_wallet TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_norm_dest TEXT;
  v_saldo NUMERIC;
  v_min NUMERIC;
  v_max NUMERIC;
  v_daily_limit NUMERIC;
  v_max_count INTEGER;
  v_fee_pct NUMERIC;
  v_fee_gems NUMERIC(18,6);
  v_net_gems NUMERIC(18,6);
  v_today_total NUMERIC;
  v_today_count INTEGER;
  v_tx_id UUID;
  v_existing RECORD;
  v_usdt_contract TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Debes iniciar sesión.');
  END IF;

  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_IDEMPOTENCY_KEY', 'message', 'Clave de idempotencia requerida.');
  END IF;

  -- 1. Idempotencia: Si ya existe la solicitud con esta clave, devolver el registro existente sin re-procesar
  SELECT * INTO v_existing
  FROM public.withdrawal_transactions
  WHERE idempotency_key = TRIM(p_idempotency_key)
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', true,
      'withdrawal', jsonb_build_object(
        'id', v_existing.id,
        'amountGems', v_existing.amount_gems,
        'feeGems', v_existing.fee_gems,
        'netGems', v_existing.net_gems,
        'netAmountUsdt', v_existing.net_amount_usdt,
        'destinationWallet', v_existing.destination_wallet,
        'status', v_existing.status,
        'createdAt', v_existing.created_at
      )
    );
  END IF;

  -- 2. Validar formato de wallet de destino
  IF p_destination_wallet IS NULL OR TRIM(p_destination_wallet) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ADDRESS', 'message', 'Dirección de destino vacía.');
  END IF;

  v_norm_dest := LOWER(TRIM(p_destination_wallet));
  IF v_norm_dest !~ '^0x[a-f0-9]{40}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ETH_FORMAT', 'message', 'Formato de dirección BEP20 de destino inválido.');
  END IF;

  -- 3. Cargar configuración de límites
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 1.00) INTO v_min FROM public.crypto_treasury_config WHERE key = 'min_withdrawal_gems';
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 500.00) INTO v_max FROM public.crypto_treasury_config WHERE key = 'max_withdrawal_gems';
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 1000.00) INTO v_daily_limit FROM public.crypto_treasury_config WHERE key = 'daily_withdrawal_limit_gems';
  SELECT COALESCE(NULLIF(value, '')::INTEGER, 5) INTO v_max_count FROM public.crypto_treasury_config WHERE key = 'max_daily_withdrawals_count';
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 5.00) INTO v_fee_pct FROM public.crypto_treasury_config WHERE key = 'withdrawal_fee_percent';
  SELECT value INTO v_usdt_contract FROM public.crypto_treasury_config WHERE key = 'usdt_bep20_contract';

  IF p_amount_gems IS NULL OR p_amount_gems < v_min THEN
    RETURN jsonb_build_object('success', false, 'error', 'AMOUNT_BELOW_MIN', 'message', format('El monto mínimo de retiro es de %s gemas.', v_min));
  END IF;

  IF p_amount_gems > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'AMOUNT_ABOVE_MAX', 'message', format('El monto máximo por retiro es de %s gemas.', v_max));
  END IF;

  -- 4. Validar límites diarios
  SELECT COALESCE(SUM(amount_gems), 0), COUNT(*) INTO v_today_total, v_today_count
  FROM public.withdrawal_transactions
  WHERE user_id = v_uid AND created_at >= NOW() - INTERVAL '24 hours' AND status NOT IN ('failed', 'cancelled', 'rejected');

  IF v_today_count >= v_max_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAILY_COUNT_EXCEEDED', 'message', format('Has alcanzado el límite de %s retiros en 24 horas.', v_max_count));
  END IF;

  IF (v_today_total + p_amount_gems) > v_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAILY_LIMIT_EXCEEDED', 'message', format('Este retiro supera el límite de %s gemas diarias (utilizado: %s gemas).', v_daily_limit, v_today_total));
  END IF;

  -- 5. Cálculo server-authoritative de comisión (5%) y neto
  v_fee_gems := ROUND(p_amount_gems * (v_fee_pct / 100.0), 6);
  v_net_gems := p_amount_gems - v_fee_gems;

  -- 6. Bloqueo FOR UPDATE sobre el perfil del usuario para atomicidad estricta
  SELECT gems_balance INTO v_saldo
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF v_saldo IS NULL OR v_saldo < p_amount_gems THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE', 'message', 'Saldo de gemas insuficiente.');
  END IF;

  -- 7. Descontar el 100% del monto solicitado del balance del usuario
  UPDATE public.profiles
  SET gems_balance = gems_balance - p_amount_gems, updated_at = NOW()
  WHERE id = v_uid;

  -- 8. Insertar en withdrawal_transactions
  INSERT INTO public.withdrawal_transactions (
    user_id,
    amount_gems,
    fee_gems,
    net_gems,
    amount_usdt,
    fee_usdt,
    net_amount_usdt,
    destination_wallet,
    normalized_destination,
    network,
    token_contract,
    status,
    idempotency_key,
    created_at
  ) VALUES (
    v_uid,
    p_amount_gems,
    v_fee_gems,
    v_net_gems,
    p_amount_gems,
    v_fee_gems,
    v_net_gems,
    TRIM(p_destination_wallet),
    v_norm_dest,
    'bsc-mainnet',
    COALESCE(v_usdt_contract, '0x55d398326f99059fF775485246999027B3197955'),
    'requested',
    TRIM(p_idempotency_key),
    NOW()
  )
  RETURNING id INTO v_tx_id;

  -- 9. Registrar en el ledger general transactions
  INSERT INTO public.transactions (
    user_id,
    type,
    amount_gems,
    amount_usd,
    fee_gems,
    wallet_address,
    status,
    description
  ) VALUES (
    v_uid,
    'withdrawal',
    p_amount_gems,
    v_net_gems,
    v_fee_gems,
    TRIM(p_destination_wallet),
    'pending',
    format('Retiro USDT BEP20: Solicitado %s 💎 (Comisión 5%%: %s 💎, Neto: %s USDT)', p_amount_gems, v_fee_gems, v_net_gems)
  );

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal', jsonb_build_object(
      'id', v_tx_id,
      'requestedGems', p_amount_gems,
      'feeGems', v_fee_gems,
      'netGems', v_net_gems,
      'netAmountUsdt', v_net_gems,
      'destinationWallet', TRIM(p_destination_wallet),
      'status', 'requested',
      'remainingBalance', v_saldo - p_amount_gems
    )
  );
END;
$$;

-- ── 9. RPC: PROCESAR DEPÓSITO VERIFICADO (SERVER-SIDE / BLOCKCHAIN WORKER) ──
CREATE OR REPLACE FUNCTION public.process_verified_deposit(
  p_network TEXT,
  p_token_contract TEXT,
  p_tx_hash TEXT,
  p_log_index INTEGER,
  p_block_number BIGINT,
  p_sender_address TEXT,
  p_destination_address TEXT,
  p_amount_usdt NUMERIC,
  p_confirmations INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm_sender TEXT;
  v_norm_dest TEXT;
  v_norm_contract TEXT;
  v_treasury TEXT;
  v_expected_contract TEXT;
  v_wallet RECORD;
  v_amount_gems NUMERIC(18,6);
  v_existing RECORD;
  v_tx_id UUID;
BEGIN
  IF p_tx_hash IS NULL OR p_sender_address IS NULL OR p_destination_address IS NULL OR p_amount_usdt IS NULL OR p_amount_usdt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DEPOSIT_PARAMS');
  END IF;

  v_norm_sender := LOWER(TRIM(p_sender_address));
  v_norm_dest := LOWER(TRIM(p_destination_address));
  v_norm_contract := LOWER(TRIM(p_token_contract));

  -- 1. Validar contrato de token esperado
  SELECT LOWER(TRIM(value)) INTO v_expected_contract FROM public.crypto_treasury_config WHERE key = 'usdt_bep20_contract';
  IF v_norm_contract <> COALESCE(v_expected_contract, '0x55d398326f99059ff775485246999027b3197955') THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_TOKEN_CONTRACT', 'message', 'El contrato del token no corresponde al USDT BEP20 autorizado.');
  END IF;

  -- 2. Validar que el destino sea la tesorería de Plant Arena
  SELECT LOWER(TRIM(value)) INTO v_treasury FROM public.crypto_treasury_config WHERE key = 'bsc_treasury_wallet';
  IF v_norm_dest <> COALESCE(v_treasury, '0x721622d8cad39621c731ec286d1ea859365a51b8') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DESTINATION', 'message', 'La transferencia no fue enviada a la wallet oficial de Plant Arena.');
  END IF;

  -- 3. Idempotencia: Verificar si el evento ya existe en el ledger
  SELECT * INTO v_existing
  FROM public.deposit_transactions
  WHERE network = p_network AND tx_hash = LOWER(TRIM(p_tx_hash)) AND log_index = p_log_index
  LIMIT 1;

  IF v_existing.id IS NOT NULL AND v_existing.status = 'credited' THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_credited', 'depositId', v_existing.id, 'amountGems', v_existing.amount_gems);
  END IF;

  -- 4. 1 USDT = 1 GEMA
  v_amount_gems := p_amount_usdt;

  -- 5. Buscar si el sender corresponde a una wallet personal registrada
  SELECT * INTO v_wallet
  FROM public.deposit_wallets
  WHERE normalized_address = v_norm_sender AND network = p_network AND status = 'active'
  LIMIT 1;

  IF v_wallet.id IS NULL THEN
    -- Wallet NO registrada: Registrar evento como UNMATCHED sin crear gemas
    INSERT INTO public.deposit_transactions (
      user_id,
      deposit_wallet_id,
      network,
      token_contract,
      tx_hash,
      log_index,
      block_number,
      sender_address,
      destination_address,
      amount_usdt,
      amount_gems,
      status,
      confirmations,
      rejection_reason,
      detected_at
    ) VALUES (
      NULL,
      NULL,
      p_network,
      v_norm_contract,
      LOWER(TRIM(p_tx_hash)),
      p_log_index,
      p_block_number,
      v_norm_sender,
      v_norm_dest,
      p_amount_usdt,
      v_amount_gems,
      'unmatched',
      p_confirmations,
      'WALLET_NOT_REGISTERED_BY_ANY_USER',
      NOW()
    )
    ON CONFLICT (network, tx_hash, log_index)
    DO UPDATE SET status = 'unmatched', confirmations = p_confirmations, updated_at = NOW()
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object('success', false, 'status', 'unmatched', 'message', 'Depósito detectado pero la wallet de origen no está registrada por ningún usuario.');
  END IF;

  -- 6. Acreditación atómica al usuario dueño de la wallet
  UPDATE public.profiles
  SET gems_balance = gems_balance + v_amount_gems, updated_at = NOW()
  WHERE id = v_wallet.user_id;

  -- 7. Registrar en ledger deposit_transactions con estado 'credited'
  INSERT INTO public.deposit_transactions (
    user_id,
    deposit_wallet_id,
    network,
    token_contract,
    tx_hash,
    log_index,
    block_number,
    sender_address,
    destination_address,
    amount_usdt,
    amount_gems,
    status,
    confirmations,
    detected_at,
    confirmed_at,
    credited_at
  ) VALUES (
    v_wallet.user_id,
    v_wallet.id,
    p_network,
    v_norm_contract,
    LOWER(TRIM(p_tx_hash)),
    p_log_index,
    p_block_number,
    v_norm_sender,
    v_norm_dest,
    p_amount_usdt,
    v_amount_gems,
    'credited',
    p_confirmations,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (network, tx_hash, log_index)
  DO UPDATE SET 
    status = 'credited',
    confirmations = p_confirmations,
    confirmed_at = COALESCE(deposit_transactions.confirmed_at, NOW()),
    credited_at = COALESCE(deposit_transactions.credited_at, NOW()),
    updated_at = NOW()
  RETURNING id INTO v_tx_id;

  -- 8. Registrar en el ledger transactions general
  INSERT INTO public.transactions (
    user_id,
    type,
    amount_gems,
    amount_usd,
    wallet_address,
    status,
    description
  ) VALUES (
    v_wallet.user_id,
    'deposit',
    v_amount_gems,
    p_amount_usdt,
    v_norm_sender,
    'completed',
    format('Depósito USDT BEP20 acreditado: +%s 💎 (TX: %s)', v_amount_gems, LOWER(TRIM(p_tx_hash)))
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'credited',
    'depositId', v_tx_id,
    'userId', v_wallet.user_id,
    'amountGems', v_amount_gems
  );
END;
$$;

-- ── 10. RPC: HISTORIAL FINANCIERO DEL USUARIO ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_financial_history()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_deposits JSONB;
  v_withdrawals JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(jsonb_agg(d ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_deposits
  FROM (
    SELECT id, tx_hash, amount_usdt, amount_gems, sender_address, status, created_at, credited_at
    FROM public.deposit_transactions
    WHERE user_id = v_uid
    ORDER BY created_at DESC
    LIMIT 20
  ) d;

  SELECT COALESCE(jsonb_agg(w ORDER BY w.created_at DESC), '[]'::jsonb)
  INTO v_withdrawals
  FROM (
    SELECT id, amount_gems, fee_gems, net_gems, net_amount_usdt, destination_wallet, status, tx_hash, created_at, completed_at, failure_reason
    FROM public.withdrawal_transactions
    WHERE user_id = v_uid
    ORDER BY created_at DESC
    LIMIT 20
  ) w;

  RETURN jsonb_build_object(
    'success', true,
    'deposits', v_deposits,
    'withdrawals', v_withdrawals
  );
END;
$$;

-- Permisos de ejecución sobre las nuevas RPCs
REVOKE EXECUTE ON FUNCTION public.register_deposit_wallet(TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_deposit_wallet(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_deposit_info() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_deposit_info() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC, TEXT, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_financial_history() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_financial_history() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_verified_deposit(TEXT, TEXT, TEXT, INTEGER, BIGINT, TEXT, TEXT, NUMERIC, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_verified_deposit(TEXT, TEXT, TEXT, INTEGER, BIGINT, TEXT, TEXT, NUMERIC, INTEGER) TO service_role;
