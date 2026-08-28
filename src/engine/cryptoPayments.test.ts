import { describe, it, expect } from 'vitest'

// ── LÓGICA DE CONTABILIDAD Y SEGURIDAD BEP20 CRIPTO ─────────────────────────

export function calculateWithdrawalSettlement(requestedAmountGems: number, feePercent = 5.0) {
  if (requestedAmountGems < 10.0) {
    throw new Error('AMOUNT_BELOW_MIN')
  }
  if (requestedAmountGems > 500.0) {
    throw new Error('AMOUNT_ABOVE_MAX')
  }
  // 5% de comisión server-authoritative
  const feeGems = Number((requestedAmountGems * (feePercent / 100.0)).toFixed(6))
  const netGems = Number((requestedAmountGems - feeGems).toFixed(6))
  const amountUsdt = requestedAmountGems
  const feeUsdt = feeGems
  const netAmountUsdt = netGems

  return {
    amountGems: requestedAmountGems,
    feeGems,
    netGems,
    amountUsdt,
    feeUsdt,
    netAmountUsdt,
  }
}

export function validateAndNormalizeEvmAddress(address: string): string {
  if (!address || typeof address !== 'string') {
    throw new Error('INVALID_ADDRESS')
  }
  const clean = address.trim().toLowerCase()
  if (!clean.match(/^0x[a-f0-9]{40}$/)) {
    throw new Error('INVALID_EVM_FORMAT')
  }
  return clean
}

export interface DepositEvent {
  network: string
  tokenContract: string
  txHash: string
  logIndex: number
  blockNumber: number
  senderAddress: string
  destinationAddress: string
  amountUsdt: number
}

export interface DepositLedger {
  processedEvents: Set<string>
  registeredWallets: Map<string, string> // normalized_address -> user_id
  userBalances: Map<string, number> // user_id -> gems_balance
}

export function processDepositEventServerAuthoritative(
  ledger: DepositLedger,
  event: DepositEvent,
  officialTreasuryAddress: string,
  officialUsdtContract: string
) {
  const normSender = validateAndNormalizeEvmAddress(event.senderAddress)
  const normDest = validateAndNormalizeEvmAddress(event.destinationAddress)
  const normContract = validateAndNormalizeEvmAddress(event.tokenContract)
  const expectedTreasury = validateAndNormalizeEvmAddress(officialTreasuryAddress)
  const expectedContract = validateAndNormalizeEvmAddress(officialUsdtContract)

  // 1. Validar contrato USDT
  if (normContract !== expectedContract) {
    return { success: false, status: 'rejected', reason: 'UNAUTHORIZED_TOKEN_CONTRACT' }
  }

  // 2. Validar destino = tesorería oficial
  if (normDest !== expectedTreasury) {
    return { success: false, status: 'rejected', reason: 'INVALID_DESTINATION' }
  }

  // 3. Idempotencia estricta por (network, txHash, logIndex)
  const eventKey = `${event.network}:${event.txHash.toLowerCase()}:${event.logIndex}`
  if (ledger.processedEvents.has(eventKey)) {
    return { success: true, status: 'already_credited', duplicate: true }
  }

  // 4. Buscar usuario vinculado a la wallet personal registrada
  const userId = ledger.registeredWallets.get(normSender)
  if (!userId) {
    return {
      success: false,
      status: 'unmatched',
      reason: 'WALLET_NOT_REGISTERED_BY_ANY_USER',
      amountUsdt: event.amountUsdt,
      sender: normSender,
    }
  }

  // 5. Acreditación atómica 1 USDT = 1 Gema
  const currentBalance = ledger.userBalances.get(userId) ?? 0
  const creditedAmount = event.amountUsdt
  ledger.userBalances.set(userId, currentBalance + creditedAmount)
  ledger.processedEvents.add(eventKey)

  return {
    success: true,
    status: 'credited',
    userId,
    amountGems: creditedAmount,
    newBalance: currentBalance + creditedAmount,
  }
}

// ── TEST SUITE ──────────────────────────────────────────────────────────────

describe('Sistema de Depósitos y Retiros USDT BEP20 (BNB Smart Chain)', () => {
  const TREASURY_WALLET = '0x721622D8cad39621C731eC286D1EA859365A51b8'
  const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955'

  describe('Cálculo de Liquidación de Retiro (5% Comisión Server-Authoritative)', () => {
    it('TEST 4: Retiro de 10.00 Gemas (Mínimo) -> Comisión: 0.50, Neto: 9.50 USDT', () => {
      const res = calculateWithdrawalSettlement(10.0)
      expect(res.amountGems).toBe(10.0)
      expect(res.feeGems).toBe(0.5)
      expect(res.netGems).toBe(9.5)
      expect(res.amountUsdt).toBe(10.0)
      expect(res.feeUsdt).toBe(0.5)
      expect(res.netAmountUsdt).toBe(9.5)
    })

    it('TEST 5: Caso Decimal: Retiro de 25.50 Gemas -> Comisión: 1.275, Neto: 24.225 USDT', () => {
      const res = calculateWithdrawalSettlement(25.5)
      expect(res.amountGems).toBe(25.5)
      expect(res.feeGems).toBe(1.275)
      expect(res.netGems).toBe(24.225)
      expect(res.netAmountUsdt).toBe(24.225)
    })

    it('TEST 6: Retiro de 100.00 Gemas -> Comisión: 5.00, Neto: 95.00 USDT', () => {
      const res = calculateWithdrawalSettlement(100.0)
      expect(res.amountGems).toBe(100.0)
      expect(res.feeGems).toBe(5.0)
      expect(res.netGems).toBe(95.0)
      expect(res.netAmountUsdt).toBe(95.0)
    })

    it('Rechaza retiro menor al mínimo permitido (< 10.00 Gemas)', () => {
      expect(() => calculateWithdrawalSettlement(9.99)).toThrow('AMOUNT_BELOW_MIN')
      expect(() => calculateWithdrawalSettlement(1.0)).toThrow('AMOUNT_BELOW_MIN')
    })

    it('Rechaza retiro mayor al máximo permitido por transacción (> 500.00 Gemas)', () => {
      expect(() => calculateWithdrawalSettlement(500.01)).toThrow('AMOUNT_ABOVE_MAX')
    })
  })

  describe('Validación y Normalización de Direcciones EVM/BEP20', () => {
    it('Normaliza direcciones mayúsculas a minúsculas y elimina espacios', () => {
      const input = '  0x721622D8CAD39621C731EC286D1EA859365A51B8  '
      const norm = validateAndNormalizeEvmAddress(input)
      expect(norm).toBe('0x721622d8cad39621c731ec286d1ea859365a51b8')
    })

    it('Rechaza direcciones de longitud incorrecta o caracteres inválidos', () => {
      expect(() => validateAndNormalizeEvmAddress('0x123')).toThrow('INVALID_EVM_FORMAT')
      expect(() => validateAndNormalizeEvmAddress('0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow('INVALID_EVM_FORMAT')
      expect(() => validateAndNormalizeEvmAddress('')).toThrow('INVALID_ADDRESS')
    })
  })

  describe('Detección y Acreditación de Depósitos Server-Authoritative', () => {
    it('TEST 1: Depositar 1.00 USDT desde wallet personal registrada acredita +1.00 Gema', () => {
      const ledger: DepositLedger = {
        processedEvents: new Set(),
        registeredWallets: new Map([
          ['0xaaaa000000000000000000000000000000000001', 'user-lionel-123'],
        ]),
        userBalances: new Map([['user-lionel-123', 50.0]]),
      }

      const event: DepositEvent = {
        network: 'bsc-mainnet',
        tokenContract: USDT_CONTRACT,
        txHash: '0xabc1234567890123456789012345678901234567890123456789012345678901',
        logIndex: 0,
        blockNumber: 38000000,
        senderAddress: '0xaaaa000000000000000000000000000000000001',
        destinationAddress: TREASURY_WALLET,
        amountUsdt: 1.0,
      }

      const res = processDepositEventServerAuthoritative(ledger, event, TREASURY_WALLET, USDT_CONTRACT)
      expect(res.success).toBe(true)
      expect(res.status).toBe('credited')
      expect(res.amountGems).toBe(1.0)
      expect(ledger.userBalances.get('user-lionel-123')).toBe(51.0)
    })

    it('TEST 2: Repetir la detección del mismo evento no suma gemas adicionales (Idempotencia)', () => {
      const ledger: DepositLedger = {
        processedEvents: new Set(),
        registeredWallets: new Map([
          ['0xaaaa000000000000000000000000000000000001', 'user-lionel-123'],
        ]),
        userBalances: new Map([['user-lionel-123', 50.0]]),
      }

      const event: DepositEvent = {
        network: 'bsc-mainnet',
        tokenContract: USDT_CONTRACT,
        txHash: '0xduplicate_hash_000000000000000000000000000000000000000000000000001',
        logIndex: 2,
        blockNumber: 38000005,
        senderAddress: '0xaaaa000000000000000000000000000000000001',
        destinationAddress: TREASURY_WALLET,
        amountUsdt: 10.0,
      }

      // Primera ejecución -> acreditado
      const first = processDepositEventServerAuthoritative(ledger, event, TREASURY_WALLET, USDT_CONTRACT)
      expect(first.status).toBe('credited')
      expect(ledger.userBalances.get('user-lionel-123')).toBe(60.0)

      // Segunda ejecución -> ignorada sin doble gasto
      const second = processDepositEventServerAuthoritative(ledger, event, TREASURY_WALLET, USDT_CONTRACT)
      expect(second.status).toBe('already_credited')
      expect(ledger.userBalances.get('user-lionel-123')).toBe(60.0) // No incrementa
    })

    it('TEST 3: Depositar desde wallet NO registrada queda en UNMATCHED y NO acredita gemas', () => {
      const ledger: DepositLedger = {
        processedEvents: new Set(),
        registeredWallets: new Map([
          ['0xaaaa000000000000000000000000000000000001', 'user-lionel-123'],
        ]),
        userBalances: new Map([['user-lionel-123', 50.0]]),
      }

      const eventFromUnknownExchange: DepositEvent = {
        network: 'bsc-mainnet',
        tokenContract: USDT_CONTRACT,
        txHash: '0xbinance_hot_wallet_tx_000000000000000000000000000000000000000000001',
        logIndex: 0,
        blockNumber: 38000010,
        senderAddress: '0x9999999999999999999999999999999999999999', // Wallet de Binance no registrada
        destinationAddress: TREASURY_WALLET,
        amountUsdt: 100.0,
      }

      const res = processDepositEventServerAuthoritative(
        ledger,
        eventFromUnknownExchange,
        TREASURY_WALLET,
        USDT_CONTRACT
      )

      expect(res.success).toBe(false)
      expect(res.status).toBe('unmatched')
      expect(res.reason).toBe('WALLET_NOT_REGISTERED_BY_ANY_USER')
      expect(ledger.userBalances.get('user-lionel-123')).toBe(50.0) // Balance intacto
    })

    it('Rechaza depósitos a una dirección que no sea la Tesorería Oficial', () => {
      const ledger: DepositLedger = {
        processedEvents: new Set(),
        registeredWallets: new Map([
          ['0xaaaa000000000000000000000000000000000001', 'user-lionel-123'],
        ]),
        userBalances: new Map([['user-lionel-123', 50.0]]),
      }

      const fakeDestEvent: DepositEvent = {
        network: 'bsc-mainnet',
        tokenContract: USDT_CONTRACT,
        txHash: '0xfake_dest_tx_0000000000000000000000000000000000000000000000000001',
        logIndex: 0,
        blockNumber: 38000020,
        senderAddress: '0xaaaa000000000000000000000000000000000001',
        destinationAddress: '0x8888888888888888888888888888888888888888', // No es tesorería
        amountUsdt: 5.0,
      }

      const res = processDepositEventServerAuthoritative(ledger, fakeDestEvent, TREASURY_WALLET, USDT_CONTRACT)
      expect(res.success).toBe(false)
      expect(res.status).toBe('rejected')
      expect(res.reason).toBe('INVALID_DESTINATION')
    })
  })
})
