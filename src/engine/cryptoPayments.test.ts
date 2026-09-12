import { describe, it, expect } from 'vitest'

// ── LÓGICA DE CONTABILIDAD Y SEGURIDAD BEP20 CRIPTO ─────────────────────────

export function calculateWithdrawalSettlement(requestedAmountGems: number, feePercent = 5.0) {
  if (requestedAmountGems < 1000.0) {
    throw new Error('AMOUNT_BELOW_MIN')
  }
  if (requestedAmountGems > 50000.0) {
    throw new Error('AMOUNT_ABOVE_MAX')
  }
  // 5% de comisión server-authoritative (100 Gemas = 1 USDT)
  const feeGems = Number((requestedAmountGems * (feePercent / 100.0)).toFixed(6))
  const netGems = Number((requestedAmountGems - feeGems).toFixed(6))
  const amountUsdt = Number((requestedAmountGems / 100.0).toFixed(6))
  const feeUsdt = Number((feeGems / 100.0).toFixed(6))
  const netAmountUsdt = Number((netGems / 100.0).toFixed(6))

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

export interface DualBalanceState {
  totalGems: number
  lockedGems: number
  withdrawableGems: number
}

export function calculateDepositSplit(
  amountUsdt: number,
  bonusPercent = 20.0,
  retirablePercent = 50.0
) {
  const baseGems = Math.round(amountUsdt * 100.0 * 100) / 100
  const bonusGems = Math.round((baseGems * (bonusPercent / 100.0)) * 100) / 100
  const totalCredited = baseGems + bonusGems
  const retirableAdd = Math.round((baseGems * (retirablePercent / 100.0)) * 100) / 100
  const lockedAdd = (baseGems - retirableAdd) + bonusGems

  return {
    baseGems,
    bonusGems,
    totalCredited,
    retirableAdd,
    lockedAdd,
  }
}

export function applyGameSpending(state: DualBalanceState, spentGems: number): DualBalanceState {
  if (spentGems <= 0) return { ...state }
  if (spentGems > state.totalGems) {
    throw new Error('INSUFFICIENT_FUNDS')
  }
  // Se consume PRIMERO el saldo no retirable (locked)
  const burnLocked = Math.min(state.lockedGems, spentGems)
  const newLocked = Math.max(0, state.lockedGems - burnLocked)
  const newTotal = state.totalGems - spentGems
  const newWithdrawable = Math.max(0, newTotal - newLocked)

  return {
    totalGems: newTotal,
    lockedGems: newLocked,
    withdrawableGems: newWithdrawable,
  }
}

export function creditGameReward(state: DualBalanceState, rewardGems: number): DualBalanceState {
  if (rewardGems <= 0) return { ...state }
  // Todo premio legítimo del juego va 100% a saldo retirable
  const newTotal = state.totalGems + rewardGems
  const newLocked = state.lockedGems
  const newWithdrawable = Math.max(0, newTotal - newLocked)

  return {
    totalGems: newTotal,
    lockedGems: newLocked,
    withdrawableGems: newWithdrawable,
  }
}

export function executeWithdrawalValidation(state: DualBalanceState, requestGems: number) {
  if (requestGems < 1000.0) {
    throw new Error('AMOUNT_BELOW_MIN')
  }
  if (requestGems > state.withdrawableGems) {
    throw new Error('EXCEEDS_WITHDRAWABLE_BALANCE')
  }
  const settlement = calculateWithdrawalSettlement(requestGems)
  const newTotal = state.totalGems - requestGems
  const newLocked = state.lockedGems
  const newWithdrawable = Math.max(0, newTotal - newLocked)

  return {
    settlement,
    newState: {
      totalGems: newTotal,
      lockedGems: newLocked,
      withdrawableGems: newWithdrawable,
    },
  }
}

export function simulateDetailedPayment(state: DualBalanceState, cost: number) {
  if (cost <= 0) throw new Error('INVALID_COST')
  if (state.totalGems < cost) throw new Error('INSUFFICIENT_GEMS')
  const paidFromLocked = Math.min(state.lockedGems, cost)
  const paidFromWithdrawable = cost - paidFromLocked
  const newLocked = state.lockedGems - paidFromLocked
  const newTotal = state.totalGems - cost
  const newWithdrawable = Math.max(0, newTotal - newLocked)

  return {
    paidFromLocked,
    paidFromWithdrawable,
    newState: {
      totalGems: newTotal,
      lockedGems: newLocked,
      withdrawableGems: newWithdrawable,
    },
  }
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

  // 5. Acreditación atómica 1 USDT = 100 Gemas
  const currentBalance = ledger.userBalances.get(userId) ?? 0
  const creditedAmount = Math.round(event.amountUsdt * 100.0 * 100) / 100
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

  describe('Cálculo de Liquidación de Retiro (5% Comisión Server-Authoritative, 100 Gemas = 1 USDT)', () => {
    it('TEST 4: Retiro de 1000.00 Gemas (Mínimo = $10.00 USDT) -> Comisión: 50.00 Gemas ($0.50), Neto: 950.00 Gemas ($9.50 USDT)', () => {
      const res = calculateWithdrawalSettlement(1000.0)
      expect(res.amountGems).toBe(1000.0)
      expect(res.feeGems).toBe(50.0)
      expect(res.netGems).toBe(950.0)
      expect(res.amountUsdt).toBe(10.0)
      expect(res.feeUsdt).toBe(0.5)
      expect(res.netAmountUsdt).toBe(9.5)
    })

    it('TEST 5: Caso Decimal: Retiro de 2550.00 Gemas ($25.50 USDT) -> Comisión: 127.50, Neto: 24.225 USDT', () => {
      const res = calculateWithdrawalSettlement(2550.0)
      expect(res.amountGems).toBe(2550.0)
      expect(res.feeGems).toBe(127.5)
      expect(res.netGems).toBe(2422.5)
      expect(res.netAmountUsdt).toBe(24.225)
    })

    it('TEST 6: Retiro de 10000.00 Gemas ($100.00 USDT) -> Comisión: 500.00, Neto: 95.00 USDT', () => {
      const res = calculateWithdrawalSettlement(10000.0)
      expect(res.amountGems).toBe(10000.0)
      expect(res.feeGems).toBe(500.0)
      expect(res.netGems).toBe(9500.0)
      expect(res.netAmountUsdt).toBe(95.0)
    })

    it('Rechaza retiro menor al mínimo permitido (< 1000.00 Gemas = $10 USDT)', () => {
      expect(() => calculateWithdrawalSettlement(999.99)).toThrow('AMOUNT_BELOW_MIN')
      expect(() => calculateWithdrawalSettlement(100.0)).toThrow('AMOUNT_BELOW_MIN')
    })

    it('Rechaza retiro mayor al máximo permitido por transacción (> 50000.00 Gemas = $500 USDT)', () => {
      expect(() => calculateWithdrawalSettlement(50000.01)).toThrow('AMOUNT_ABOVE_MAX')
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
    it('TEST 1: Depositar 1.00 USDT desde wallet personal registrada acredita +100.00 Gemas', () => {
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
      expect(res.amountGems).toBe(100.0)
      expect(ledger.userBalances.get('user-lionel-123')).toBe(150.0)
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

      // Primera ejecución -> acreditado (+1000 gemas)
      const first = processDepositEventServerAuthoritative(ledger, event, TREASURY_WALLET, USDT_CONTRACT)
      expect(first.status).toBe('credited')
      expect(ledger.userBalances.get('user-lionel-123')).toBe(1050.0)

      // Segunda ejecución -> ignorada sin doble gasto
      const second = processDepositEventServerAuthoritative(ledger, event, TREASURY_WALLET, USDT_CONTRACT)
      expect(second.status).toBe('already_credited')
      expect(ledger.userBalances.get('user-lionel-123')).toBe(1050.0) // No incrementa
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

  // ── NUEVA ARQUITECTURA: SISTEMA DE SALDO DUAL Y BLINDAJE DE RETIROS ──────────

  describe('Sistema de Saldo Dual (Retirable vs No Retirable/Bono)', () => {
    it('Caso 1: Depósito de $100 con bono del 20% acredita 12,000 gemas (5,000 retirables y 7,000 no retirables)', () => {
      const split = calculateDepositSplit(100.0, 20.0, 50.0)
      expect(split.baseGems).toBe(10000.0)
      expect(split.bonusGems).toBe(2000.0)
      expect(split.totalCredited).toBe(12000.0)
      expect(split.retirableAdd).toBe(5000.0)
      expect(split.lockedAdd).toBe(7000.0)

      const state: DualBalanceState = {
        totalGems: split.totalCredited,
        lockedGems: split.lockedAdd,
        withdrawableGems: split.retirableAdd,
      }
      expect(state.totalGems).toBe(12000.0)
      expect(state.lockedGems).toBe(7000.0)
      expect(state.withdrawableGems).toBe(5000.0)
    })

    it('Caso 2: Gastar 600 gemas en tienda quema primero el saldo no retirable (retirable queda intacto en 5,000)', () => {
      const initial: DualBalanceState = {
        totalGems: 12000.0,
        lockedGems: 7000.0,
        withdrawableGems: 5000.0,
      }

      const updated = applyGameSpending(initial, 600.0)
      expect(updated.totalGems).toBe(11400.0)
      expect(updated.lockedGems).toBe(6400.0)
      // ¡El saldo retirable sigue intacto en 5,000 gemas ($50 USDT)!
      expect(updated.withdrawableGems).toBe(5000.0)
    })

    it('Caso 3: Gastar 8,000 gemas agota completamente los 7,000 de saldo no retirable y descuenta 1,000 de retirable', () => {
      const initial: DualBalanceState = {
        totalGems: 12000.0,
        lockedGems: 7000.0,
        withdrawableGems: 5000.0,
      }

      const updated = applyGameSpending(initial, 8000.0)
      expect(updated.totalGems).toBe(4000.0)
      expect(updated.lockedGems).toBe(0.0)
      expect(updated.withdrawableGems).toBe(4000.0)
    })

    it('Caso 4: Ganancias de Ruleta, Código Secreto, Clanes, Referidos y Mercado van 100% a saldo retirable', () => {
      const initial: DualBalanceState = {
        totalGems: 11400.0,
        lockedGems: 6400.0,
        withdrawableGems: 5000.0,
      }

      // Ganar 1,000 gemas en Ruleta / Código Secreto
      const afterPrize = creditGameReward(initial, 1000.0)
      expect(afterPrize.totalGems).toBe(12400.0)
      expect(afterPrize.lockedGems).toBe(6400.0) // No incrementa locked
      expect(afterPrize.withdrawableGems).toBe(6000.0) // 100% del premio es retirable
    })

    it('Caso 5: Rechaza solicitud de retiro que intente sacar saldo no retirable (Bono o Retención)', () => {
      const state: DualBalanceState = {
        totalGems: 12000.0,
        lockedGems: 7000.0,
        withdrawableGems: 5000.0,
      }

      // Intento de retirar 5,001 gemas teniendo solo 5,000 retirables
      expect(() => executeWithdrawalValidation(state, 5001.0)).toThrow('EXCEEDS_WITHDRAWABLE_BALANCE')
      // Intento de retirar las 12,000 gemas
      expect(() => executeWithdrawalValidation(state, 12000.0)).toThrow('EXCEEDS_WITHDRAWABLE_BALANCE')
    })

    it('Caso 6: Retiro exitoso descuenta de saldo retirable sin tocar el saldo bloqueado para jugar', () => {
      const state: DualBalanceState = {
        totalGems: 12000.0,
        lockedGems: 7000.0,
        withdrawableGems: 5000.0,
      }

      // Retirar 3,000 gemas ($30 USDT)
      const res = executeWithdrawalValidation(state, 3000.0)
      expect(res.settlement.amountGems).toBe(3000.0)
      expect(res.settlement.feeGems).toBe(150.0) // 5%
      expect(res.settlement.netGems).toBe(2850.0)
      expect(res.settlement.netAmountUsdt).toBe(28.5)

      expect(res.newState.totalGems).toBe(9000.0)
      expect(res.newState.lockedGems).toBe(7000.0) // Saldo bloqueado preservado
      expect(res.newState.withdrawableGems).toBe(2000.0) // 5000 - 3000
    })

    it('Caso 7: Soporta bonos variables del 5%, 10%, 15% y 20%', () => {
      // Bono 5%: $100 -> 10,000 base + 500 bono = 10,500 total (5,000 retirable, 5,500 locked)
      const b5 = calculateDepositSplit(100.0, 5.0, 50.0)
      expect(b5.bonusGems).toBe(500.0)
      expect(b5.retirableAdd).toBe(5000.0)
      expect(b5.lockedAdd).toBe(5500.0)

      // Bono 10%: $100 -> 10,000 base + 1,000 bono = 11,000 total (5,000 retirable, 6,000 locked)
      const b10 = calculateDepositSplit(100.0, 10.0, 50.0)
      expect(b10.bonusGems).toBe(1000.0)
      expect(b10.retirableAdd).toBe(5000.0)
      expect(b10.lockedAdd).toBe(6000.0)

      // Bono 15%: $100 -> 10,000 base + 1,500 bono = 11,500 total (5,000 retirable, 6,500 locked)
      const b15 = calculateDepositSplit(100.0, 15.0, 50.0)
      expect(b15.bonusGems).toBe(1500.0)
      expect(b15.retirableAdd).toBe(5000.0)
      expect(b15.lockedAdd).toBe(6500.0)
    })

    it('Caso 8: Auditoría de Pagos: Primero consulta no retirable y completa con retirable en cualquier gasto', () => {
      // Estado: 1,000 gemas totales (400 no retirables / bono, 600 retirables)
      const state: DualBalanceState = {
        totalGems: 1000.0,
        lockedGems: 400.0,
        withdrawableGems: 600.0,
      }

      // 1. Pago de 300 💎 (ej. Tienda / Oferta Flash):
      // Consume 300 de las 400 no retirables -> 0 de retirables consumidas
      const p1 = simulateDetailedPayment(state, 300.0)
      expect(p1.paidFromLocked).toBe(300.0)
      expect(p1.paidFromWithdrawable).toBe(0.0)
      expect(p1.newState.totalGems).toBe(700.0)
      expect(p1.newState.lockedGems).toBe(100.0)
      expect(p1.newState.withdrawableGems).toBe(600.0) // 100% de retirable intacto

      // 2. Pago posterior de 250 💎 (ej. Ruleta o Donación de Clan):
      // Consume los 100 💎 restantes de no retirable y completa con 150 💎 de retirable
      const p2 = simulateDetailedPayment(p1.newState, 250.0)
      expect(p2.paidFromLocked).toBe(100.0)
      expect(p2.paidFromWithdrawable).toBe(150.0)
      expect(p2.newState.totalGems).toBe(450.0)
      expect(p2.newState.lockedGems).toBe(0.0) // No retirable agotado
      expect(p2.newState.withdrawableGems).toBe(450.0) // 600 - 150 = 450
    })

    it('Caso 9: Sorteo aleatorio de bonos sin montos fijos (5%, 10%, 15%, 20%)', () => {
      const allowedBonuses = [5.0, 10.0, 15.0, 20.0]
      for (let i = 0; i < 20; i++) {
        const randomBonus = allowedBonuses[Math.floor(Math.random() * allowedBonuses.length)]
        const randomDepositUsdt = 10 + Math.floor(Math.random() * 90) // entre 10 y 100 USDT
        const split = calculateDepositSplit(randomDepositUsdt, randomBonus, 50.0)

        // El saldo retirable acreditado SIEMPRE es exactamente el 50% de la base depositada
        expect(split.retirableAdd).toBe(split.baseGems * 0.5)
        // El saldo no retirable SIEMPRE es el 50% de la base + el bono aleatorio
        expect(split.lockedAdd).toBe(split.baseGems * 0.5 + split.bonusGems)
        // La suma de ambos siempre es igual al total acreditado
        expect(split.retirableAdd + split.lockedAdd).toBe(split.totalCredited)
      }
    })
  })
})
