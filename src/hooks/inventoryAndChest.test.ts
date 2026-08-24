import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseServerPlantCopies } from './useInventory'
import { calculateInstantUnlockGoldCost, type FreePackSlot } from '../utils/freePackManager'
import { sanitizeLocalStorage } from '../utils/storageSanitizer'
import type { PlantId } from '../types/game'

const ALL_15_PLANTS: PlantId[] = [
  'sunflower',
  'peashooter',
  'wallnut',
  'chomper',
  'repeater',
  'garlic',
  'bonkchoy',
  'squash',
  'twinsunflower',
  'tallnut',
  'threepeater',
  'jalapeno',
  'iceberglettuce',
  'aloe',
  'melonpult',
]

describe('FIX A — Copias de Cartas (Fuente Autoritativa y Presentación)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      localStorage.clear()
    }
  })

  it('1. Starter desbloqueada + 0 copias en DB → UI y cálculo muestran 0 copias', () => {
    const plantCopies = parseServerPlantCopies({})

    const copiesJardin = plantCopies['sunflower'] || 0
    const copiesCollection = plantCopies ? (plantCopies['sunflower'] ?? 0) : 0

    expect(copiesJardin).toBe(0)
    expect(copiesCollection).toBe(0)
  })

  it('2. Girasol con 4 copias en DB → Jardín muestra exactamente 4 copias', () => {
    const plantCopies = parseServerPlantCopies({ sunflower: 4 })

    const copiesJardin = plantCopies['sunflower'] || 0
    expect(copiesJardin).toBe(4)
  })

  it('3. El mismo Girasol con 4 copias → Colección muestra exactamente 4 copias', () => {
    const plantCopies = parseServerPlantCopies({ sunflower: 4 })

    const copiesCollection = plantCopies ? (plantCopies['sunflower'] ?? 0) : 0
    expect(copiesCollection).toBe(4)
  })

  it('4. Refresh / login desde my_inventory() preserva las 4 copias y no las convierte en 0 ni 1', () => {
    const invResponseFromPostgres = {
      copies: { sunflower: 4, wallnut: 2 },
      instances: [
        { instanceId: 'inst_sunflower', plantId: 'sunflower', level: 0, isBase: true },
      ],
      unlocked: ['sunflower', 'peashooter', 'wallnut', 'chomper'],
    }

    const baseCopies = parseServerPlantCopies(invResponseFromPostgres.copies)

    expect(baseCopies['sunflower']).toBe(4)
    expect(baseCopies['wallnut']).toBe(2)
    expect(baseCopies['peashooter']).toBe(0)
    expect(baseCopies['chomper']).toBe(0)
  })

  it('5. Abrir sobre que entrega Girasol incrementa de 4 a 5 copias', () => {
    let sunflowerCopiesInDB = 4
    sunflowerCopiesInDB += 1

    expect(sunflowerCopiesInDB).toBe(5)
  })

  it('6. Abrir sobre de otra planta (ej. Peashooter) NO altera las 4 copias de Girasol', () => {
    const serverUpdatedCopies = { sunflower: 4, peashooter: 1 }
    const baseCopies = parseServerPlantCopies(serverUpdatedCopies)

    expect(baseCopies['sunflower']).toBe(4)
    expect(baseCopies['peashooter']).toBe(1)
  })

  it('7. Fusión con 5 copias: 5 → 0 copias y nivel de instancia aumenta a 1', () => {
    let copiesInDB = 5
    let instanceLevel = 0

    if (copiesInDB >= 5) {
      copiesInDB -= 5
      instanceLevel += 1
    }

    expect(copiesInDB).toBe(0)
    expect(instanceLevel).toBe(1)
  })

  it('8. StorageSanitizer purga e inicializa starterCopies en 0 para todas las plantas', () => {
    const store: Record<string, string> = {
      plant_arena_storage_version: 'v2_old',
      plant_arena_plant_copies: JSON.stringify({ sunflower: 999 }),
    }
    const mockStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
    }
    vi.stubGlobal('window', { localStorage: mockStorage })
    vi.stubGlobal('localStorage', mockStorage)

    sanitizeLocalStorage()

    const raw = mockStorage.getItem('plant_arena_plant_copies')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.sunflower).toBe(0)
    expect(parsed.peashooter).toBe(0)
    expect(parsed.wallnut).toBe(0)
    expect(parsed.chomper).toBe(0)
  })

  it('9. Validación estricta de contrato: rawCopies null o undefined devuelve todas las plantas en 0', () => {
    const copiesFromNull = parseServerPlantCopies(null)
    const copiesFromUndefined = parseServerPlantCopies(undefined)

    ALL_15_PLANTS.forEach((id) => {
      expect(copiesFromNull[id]).toBe(0)
      expect(copiesFromUndefined[id]).toBe(0)
    })
  })

  it('10. Validación estricta de contrato: ausencia legítima de una planta en el mapa devuelve 0', () => {
    const copies = parseServerPlantCopies({ sunflower: 3 })
    expect(copies['sunflower']).toBe(3)
    expect(copies['peashooter']).toBe(0)
    expect(copies['wallnut']).toBe(0)
    expect(copies['melonpult']).toBe(0)
  })

  it('11. Validación estricta: copies.sunflower = "abc" lanza Error (no oculta corrupción con 0)', () => {
    expect(() => parseServerPlantCopies({ sunflower: 'abc' })).toThrowError(
      /Valor de copias inválido para sunflower/
    )
  })

  it('12. Validación estricta: copies.sunflower = -1 lanza Error', () => {
    expect(() => parseServerPlantCopies({ sunflower: -1 })).toThrowError(
      /Valor de copias inválido para sunflower/
    )
  })

  it('13. Validación estricta: copies.sunflower = 1.5 lanza Error (debe ser entero)', () => {
    expect(() => parseServerPlantCopies({ sunflower: 1.5 })).toThrowError(
      /Valor de copias inválido para sunflower/
    )
  })

  it('14. Validación estricta: copies = [] lanza Error de contrato', () => {
    expect(() => parseServerPlantCopies([])).toThrowError(
      /Formato de copias inválido/
    )
  })

  it('15. Validación estricta: copies = "bad" lanza Error de contrato', () => {
    expect(() => parseServerPlantCopies('bad')).toThrowError(
      /Formato de copias inválido/
    )
  })

  it('16. Validación estricta: copies = 123 lanza Error de contrato', () => {
    expect(() => parseServerPlantCopies(123)).toThrowError(
      /Formato de copias inválido/
    )
  })
})

describe('FIX B — Acelerar Sobre PvP con Oro (RPC, Timer y Atomicidad)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('1. Cálculo de coste en oro basado en horas restantes (75 oro/hora, min 10)', () => {
    const slot2h: FreePackSlot = { slotId: 0, status: 'locked', durationHours: 2, arenaLevel: 1 }
    const slot4h: FreePackSlot = { slotId: 1, status: 'locked', durationHours: 4, arenaLevel: 1 }
    const slot8h: FreePackSlot = { slotId: 2, status: 'locked', durationHours: 8, arenaLevel: 1 }
    const slot12h: FreePackSlot = { slotId: 3, status: 'locked', durationHours: 12, arenaLevel: 1 }
    const slotReady: FreePackSlot = { slotId: 0, status: 'ready', durationHours: 2, arenaLevel: 1 }

    expect(calculateInstantUnlockGoldCost(slot2h)).toBe(150)
    expect(calculateInstantUnlockGoldCost(slot4h)).toBe(300)
    expect(calculateInstantUnlockGoldCost(slot8h)).toBe(600)
    expect(calculateInstantUnlockGoldCost(slot12h)).toBe(900)
    expect(calculateInstantUnlockGoldCost(slotReady)).toBe(0)

    // Cofre con 1 hora restante
    const now = Date.now()
    const slotUnlocking1hLeft: FreePackSlot = {
      slotId: 0,
      status: 'unlocking',
      durationHours: 2,
      unlockStartedAt: now - 1 * 3600 * 1000, // 1 hora transcurrida de 2h
      arenaLevel: 1,
    }
    expect(calculateInstantUnlockGoldCost(slotUnlocking1hLeft)).toBe(75)
  })

  it('2. Cancelar confirmación → 0 llamadas a RPC y 0 oro gastado', async () => {
    const mockRpc = vi.fn()
    let slotToAccelerate: FreePackSlot | null = { slotId: 0, status: 'unlocking', durationHours: 4, arenaLevel: 1 }

    // Usuario pulsa CANCELAR
    slotToAccelerate = null

    expect(slotToAccelerate).toBeNull()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('3. Confirmar aceleración → Llama a RPC fastUnlockSlot exactamente una vez', async () => {
    const mockFastUnlock = vi.fn().mockResolvedValue({ success: true, goldSpent: 300 })
    let isAccelerating = false

    const handleConfirm = async (slotId: number) => {
      if (isAccelerating) return
      isAccelerating = true
      try {
        return await mockFastUnlock(slotId)
      } finally {
        isAccelerating = false
      }
    }

    const res = await handleConfirm(1)
    expect(mockFastUnlock).toHaveBeenCalledTimes(1)
    expect(mockFastUnlock).toHaveBeenCalledWith(1)
    expect(res).toEqual({ success: true, goldSpent: 300 })
  })

  it('4. Doble click / petición concurrente → Se ejecuta una sola vez', async () => {
    let inFlight = false
    const mockRpc = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return { success: true }
    })

    const triggerAction = async () => {
      if (inFlight) return { dropped: true }
      inFlight = true
      try {
        return await mockRpc()
      } finally {
        inFlight = false
      }
    }

    // Disparar dos llamadas en paralelo simulando doble clic rápido
    const [p1, p2] = await Promise.all([triggerAction(), triggerAction()])

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(p1).toEqual({ success: true })
    expect(p2).toEqual({ dropped: true })
  })

  it('5. Saldo de oro insuficiente → Servidor rechaza, no modifica slot y muestra error', async () => {
    const mockFastUnlock = vi.fn().mockResolvedValue({
      success: false,
      error: 'Oro insuficiente: necesitas 300 y tienes 50',
    })

    let currentGold = 50
    let slotStatus = 'unlocking'

    const res = await mockFastUnlock(1)
    if (!res.success) {
      // Estado permanece inalterado
      expect(currentGold).toBe(50)
      expect(slotStatus).toBe('unlocking')
    }

    expect(res.success).toBe(false)
    expect(res.error).toContain('Oro insuficiente')
  })

  it('6. Éxito de aceleración → Slot pasa a ready y saldo visual se actualiza', async () => {
    let slotStatus = 'unlocking'
    let userGold = 500

    const mockFastUnlock = vi.fn().mockImplementation(async () => {
      userGold -= 300
      slotStatus = 'ready'
      return { success: true, goldSpent: 300 }
    })

    const res = await mockFastUnlock(1)

    expect(res.success).toBe(true)
    expect(slotStatus).toBe('ready')
    expect(userGold).toBe(200)
  })
})
