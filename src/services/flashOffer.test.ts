import { describe, it, expect, beforeEach, vi } from 'vitest'
import { inventoryService } from './inventoryService'

describe('Oferta Flash de Jalapeños (30 Gemas c/u, Máximo 3 Compras) con Backend Garantizador', () => {
  let memoryStore: Record<string, string> = {}

  const mockStorage = {
    getItem: (key: string) => memoryStore[key] ?? null,
    setItem: (key: string, value: string) => {
      memoryStore[key] = String(value)
    },
    removeItem: (key: string) => {
      delete memoryStore[key]
    },
    clear: () => {
      memoryStore = {}
    },
  }

  beforeEach(() => {
    memoryStore = {}
    vi.stubGlobal('localStorage', mockStorage)
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
    })
  })

  it('1. getFlashOfferStatus devuelve la configuración autoritativa (30 gemas, 3 disponibles)', async () => {
    const status = await inventoryService.getFlashOfferStatus('flash_jalapeno_30')
    expect(status.success).toBe(true)
    expect(status.plantId).toBe('jalapeno')
    expect(status.priceGems).toBe(30)
    expect(status.maxPurchasesPerUser).toBe(3)
    expect(status.userBought).toBe(0)
    expect(status.remainingPurchases).toBe(3)
    expect(status.isSoldOut).toBe(false)
  })

  it('2. buyFlashOffer rechaza cantidad menor o igual a cero', async () => {
    const res = await inventoryService.buyFlashOffer('flash_jalapeno_30', 0)
    expect(res.success).toBe(false)
    expect(res.error).toBe('Cantidad inválida')
  })

  it('3. buyFlashOffer rechaza la compra si las gemas son insuficientes', async () => {
    mockStorage.setItem('plant_arena_user_tokens', '20') // Se necesitan 30
    const res = await inventoryService.buyFlashOffer('flash_jalapeno_30', 1)
    expect(res.success).toBe(false)
    expect(res.error).toContain('Gemas insuficientes')
  })

  it('4. buyFlashOffer ejecuta la compra de 1 Jalapeño descontando 30 gemas y otorgando la planta', async () => {
    mockStorage.setItem('plant_arena_user_tokens', '100')
    const res = await inventoryService.buyFlashOffer('flash_jalapeno_30', 1)

    expect(res.success).toBe(true)
    expect(res.quantity).toBe(1)
    expect(res.totalGemsSpent).toBe(30)
    expect(res.userTotalBought).toBe(1)
    expect(res.remainingPurchases).toBe(2)

    // Verificar deducción de gemas (100 - 30 = 70)
    expect(parseFloat(mockStorage.getItem('plant_arena_user_tokens') || '0')).toBe(70)

    // Verificar otorgamiento de Jalapeño
    const unlocked = JSON.parse(mockStorage.getItem('plant_arena_unlocked_plants') || '[]')
    expect(unlocked).toContain('jalapeno')

    const copies = JSON.parse(mockStorage.getItem('plant_arena_plant_copies') || '{}')
    expect(copies.jalapeno).toBe(1)
  })

  it('5. buyFlashOffer permite compras múltiples hasta el límite estricto de 3 ventas', async () => {
    mockStorage.setItem('plant_arena_user_tokens', '150')

    // Compra 1: 2 jalapeños por 60 gemas
    const res1 = await inventoryService.buyFlashOffer('flash_jalapeno_30', 2)
    expect(res1.success).toBe(true)
    expect(res1.totalGemsSpent).toBe(60)
    expect(res1.userTotalBought).toBe(2)
    expect(res1.remainingPurchases).toBe(1)

    // Compra 2: 1 jalapeño por 30 gemas (total 3 compras)
    const res2 = await inventoryService.buyFlashOffer('flash_jalapeno_30', 1)
    expect(res2.success).toBe(true)
    expect(res2.totalGemsSpent).toBe(30)
    expect(res2.userTotalBought).toBe(3)
    expect(res2.remainingPurchases).toBe(0)

    // Saldo restante: 150 - 60 - 30 = 60
    expect(parseFloat(mockStorage.getItem('plant_arena_user_tokens') || '0')).toBe(60)

    // Estado ahora es AGOTADO
    const status = await inventoryService.getFlashOfferStatus('flash_jalapeno_30')
    expect(status.userBought).toBe(3)
    expect(status.remainingPurchases).toBe(0)
    expect(status.isSoldOut).toBe(true)

    // Intento de 4ta compra debe ser bloqueado por backend garantizador
    const resBlocked = await inventoryService.buyFlashOffer('flash_jalapeno_30', 1)
    expect(resBlocked.success).toBe(false)
    expect(resBlocked.error).toContain('Límite alcanzado: máximo 3 compras')
  })

  it('6. buyFlashOffer rechaza de inmediato si la cantidad solicitada excede las compras restantes', async () => {
    mockStorage.setItem('plant_arena_user_tokens', '200')
    // Intentar comprar 4 de golpe (máximo es 3)
    const res = await inventoryService.buyFlashOffer('flash_jalapeno_30', 4)
    expect(res.success).toBe(false)
    expect(res.error).toContain('Límite alcanzado')
  })
})
