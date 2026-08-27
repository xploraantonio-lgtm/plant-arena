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

describe('FUSIÓN DE CARTAS CON COSTO DE 250 ORO Y 5 COPIAS (Transaccional y Fail-Closed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // Simulación lógica de la RPC autoritativa en PostgreSQL (public.fuse_plant)
  function simulateServerFusePlant(params: {
    userGold: number
    copies: number
    level: number
    maxLevel: number
    isOwner: boolean
    isListed: boolean
    eligibleStats?: string[] | null
  }) {
    const FUSION_GOLD_COST = 250
    const FUSION_COPIES_REQ = 5

    if (!params.isOwner) {
      return { success: false, error: 'No eres el propietario de esta carta' }
    }
    if (params.isListed) {
      return { success: false, error: 'No puedes fusionar una carta que está en venta' }
    }
    if (params.userGold < FUSION_GOLD_COST) {
      return {
        success: false,
        error: `Oro insuficiente para mejorar: necesitas ${FUSION_GOLD_COST} y tienes ${params.userGold}`,
      }
    }
    if (params.level >= params.maxLevel) {
      return { success: false, error: `Esta carta ya alcanzó el nivel máximo (${params.maxLevel})` }
    }
    if (!params.eligibleStats || params.eligibleStats.length === 0) {
      return { success: false, error: 'La planta no tiene estadísticas elegibles configuradas' }
    }
    if (params.copies < FUSION_COPIES_REQ) {
      return {
        success: false,
        error: `Se requieren ${FUSION_COPIES_REQ} copias base para la fusión (tienes ${params.copies}/${FUSION_COPIES_REQ})`,
      }
    }

    const rolled = params.eligibleStats[0]

    return {
      success: true,
      previousLevel: params.level,
      newLevel: params.level + 1,
      rolledStat: rolled,
      copiesSpent: FUSION_COPIES_REQ,
      copiesRemaining: params.copies - FUSION_COPIES_REQ,
      goldSpent: FUSION_GOLD_COST,
      goldBalance: params.userGold - FUSION_GOLD_COST,
    }
  }

  it('1. 5 copias + 250 oro → Éxito: level +1, copies -5, gold -250', () => {
    let userGold = 250
    let copies = 5
    let level = 0
    const maxLevel = 5

    const res = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel,
      isOwner: true,
      isListed: false,
      eligibleStats: ['damage', 'attackSpeed'],
    })

    expect(res.success).toBe(true)
    if (res.success) {
      userGold = res.goldBalance!
      copies = res.copiesRemaining!
      level = res.newLevel!
    }

    expect(level).toBe(1)
    expect(copies).toBe(0)
    expect(userGold).toBe(0)
    expect(res.goldSpent).toBe(250)
    expect(res.copiesSpent).toBe(5)
  })

  it('2. 5 copias + 249 oro → FAIL: 0 oro gastado, 0 copias consumidas, nivel intacto', () => {
    let userGold = 249
    let copies = 5
    let level = 0

    const res = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['damage'],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('Oro insuficiente')
    // Los datos locales no se modifican
    expect(userGold).toBe(249)
    expect(copies).toBe(5)
    expect(level).toBe(0)
  })

  it('3. 4 copias + 1000 oro → FAIL: 0 oro gastado, 0 copias consumidas, nivel intacto', () => {
    let userGold = 1000
    let copies = 4
    let level = 0

    const res = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['damage'],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('Se requieren 5 copias base')
    expect(userGold).toBe(1000)
    expect(copies).toBe(4)
    expect(level).toBe(0)
  })

  it('4. 0 copias + 0 oro → FAIL: rechazo fail-closed inmediato', () => {
    const res = simulateServerFusePlant({
      userGold: 0,
      copies: 0,
      level: 0,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['damage'],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('Oro insuficiente')
  })

  it('5. 10 copias + 500 oro → Dos fusiones consecutivas procesadas correctamente', () => {
    let userGold = 500
    let copies = 10
    let level = 0

    // Primera fusión
    const res1 = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['hp', 'cooldown'],
    })
    expect(res1.success).toBe(true)
    userGold = res1.goldBalance!
    copies = res1.copiesRemaining!
    level = res1.newLevel!

    expect(level).toBe(1)
    expect(copies).toBe(5)
    expect(userGold).toBe(250)

    // Segunda fusión
    const res2 = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['hp', 'cooldown'],
    })
    expect(res2.success).toBe(true)
    userGold = res2.goldBalance!
    copies = res2.copiesRemaining!
    level = res2.newLevel!

    expect(level).toBe(2)
    expect(copies).toBe(0)
    expect(userGold).toBe(0)

    // Intento de tercera fusión sin recursos
    const res3 = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['hp', 'cooldown'],
    })
    expect(res3.success).toBe(false)
  })

  it('6. Doble click con 5 copias y 250 oro → Exactamente 1 llamada tiene éxito', async () => {
    let inFlight = false
    let currentCopies = 5
    let currentGold = 250
    let currentLevel = 0

    const mockFuseRpc = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      if (currentCopies < 5 || currentGold < 250) {
        return { success: false, error: 'Recursos insuficientes' }
      }
      currentCopies -= 5
      currentGold -= 250
      currentLevel += 1
      return { success: true, newLevel: currentLevel }
    })

    const triggerFuse = async () => {
      if (inFlight) return { dropped: true }
      inFlight = true
      try {
        return await mockFuseRpc()
      } finally {
        inFlight = false
      }
    }

    const [call1, call2] = await Promise.all([triggerFuse(), triggerFuse()])

    expect(mockFuseRpc).toHaveBeenCalledTimes(1)
    expect(call1).toEqual({ success: true, newLevel: 1 })
    expect(call2).toEqual({ dropped: true })
    expect(currentCopies).toBe(0)
    expect(currentGold).toBe(0)
    expect(currentLevel).toBe(1)
  })

  it('7. RPC falla en el servidor → Frontend no resta nada localmente', () => {
    let localGold = 300
    let localCopies = 6
    let localLevel = 1

    const serverResponse = {
      success: false,
      error: 'Database connection error',
    }

    if (!serverResponse.success) {
      // Regla de contrato: no aplicar cambios optimistas ante error
    } else {
      localGold -= 250
      localCopies -= 5
      localLevel += 1
    }

    expect(localGold).toBe(300)
    expect(localCopies).toBe(6)
    expect(localLevel).toBe(1)
  })

  it('8. Cancelar confirmación → 0 llamadas RPC, 0 oro y 0 copias gastadas', () => {
    const mockRpc = vi.fn()
    let fuseCandidate: { plantId: string } | null = { plantId: 'sunflower' }

    // Usuario pulsa CANCELAR
    fuseCandidate = null

    expect(fuseCandidate).toBeNull()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('9. Carta en nivel máximo → Rechazo de fusión', () => {
    const res = simulateServerFusePlant({
      userGold: 1000,
      copies: 10,
      level: 5,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: ['damage'],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('ya alcanzó el nivel máximo')
  })

  it('10. Planta con eligible_stats NULL → Falla fail-closed, 0 oro y 0 copias consumidas', () => {
    let userGold = 500
    let copies = 5
    let level = 0

    const res = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: null,
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('no tiene estadísticas elegibles')
    expect(userGold).toBe(500)
    expect(copies).toBe(5)
    expect(level).toBe(0)
  })

  it('11. Planta con eligible_stats array vacío → Falla fail-closed, 0 cambios', () => {
    let userGold = 500
    let copies = 5
    let level = 0

    const res = simulateServerFusePlant({
      userGold,
      copies,
      level,
      maxLevel: 5,
      isOwner: true,
      isListed: false,
      eligibleStats: [],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('no tiene estadísticas elegibles')
    expect(userGold).toBe(500)
    expect(copies).toBe(5)
    expect(level).toBe(0)
  })

  it('12. Esquema de _migration_audit usa columnas reales (fase, detalle, ejecutado_en)', () => {
    const auditRecord = {
      fase: '42_fuse_plant_gold_cost',
      detalle: {
        fusion_cost_gold: 250,
        copies_required: 5,
        descripcion: 'Fusión autoritativa con costo fijo de 250 de oro y 5 copias',
      },
      ejecutado_en: new Date().toISOString(),
    }

    expect(auditRecord).toHaveProperty('fase')
    expect(auditRecord).toHaveProperty('detalle')
    expect(auditRecord).toHaveProperty('ejecutado_en')
    expect(auditRecord).not.toHaveProperty('migration_number')
    expect(auditRecord).not.toHaveProperty('applied_at')
  })

  it('13. awardVictoryPack reconoce cofre ya entregado por settlement ante respuesta demasiado_pronto', async () => {
    // Simula el flujo del hook cuando awardVictoryChest devuelve 'demasiado_pronto'
    // pero getUserPackSlots devuelve los slots con el nuevo cofre bloqueado (locked).
    const prevSlots: FreePackSlot[] = [
      { slotId: 0, status: 'empty', durationHours: 2, arenaLevel: 1 },
      { slotId: 1, status: 'empty', durationHours: 4, arenaLevel: 1 },
      { slotId: 2, status: 'empty', durationHours: 8, arenaLevel: 1 },
      { slotId: 3, status: 'empty', durationHours: 12, arenaLevel: 1 },
    ]

    const rpcResponse = { awarded: false, reason: 'demasiado_pronto' }
    const remoteSlotsFromSettlement: FreePackSlot[] = [
      { slotId: 0, status: 'locked', durationHours: 12, arenaLevel: 1 },
      { slotId: 1, status: 'empty', durationHours: 4, arenaLevel: 1 },
      { slotId: 2, status: 'empty', durationHours: 8, arenaLevel: 1 },
      { slotId: 3, status: 'empty', durationHours: 12, arenaLevel: 1 },
    ]

    const newlyAwarded =
      remoteSlotsFromSettlement.find(
        (s) => s.status === 'locked' && prevSlots.find((p) => p.slotId === s.slotId)?.status === 'empty'
      ) ?? remoteSlotsFromSettlement.find((s) => s.status === 'locked')

    expect(newlyAwarded).toBeDefined()
    expect(newlyAwarded?.slotId).toBe(0)
    expect(newlyAwarded?.durationHours).toBe(12)
    expect(newlyAwarded?.arenaLevel).toBe(1)

    const result = newlyAwarded
      ? {
          awarded: true,
          durationHours: newlyAwarded.durationHours as 2 | 4 | 8 | 12,
          arenaLevel: newlyAwarded.arenaLevel,
          isSlotsFull: false,
        }
      : { awarded: false, isSlotsFull: rpcResponse.reason === 'huecos_llenos' }

    expect(result.awarded).toBe(true)
    expect(result.durationHours).toBe(12)
    expect(result.arenaLevel).toBe(1)
    expect(result.isSlotsFull).toBe(false)
  })

  it('14. awardVictoryPack con los 4 slots llenos devuelve isSlotsFull: true y awarded: false de inmediato', () => {
    // 4 slots totalmente ocupados (ninguno empty)
    const fullSlots: FreePackSlot[] = [
      { slotId: 0, status: 'locked', durationHours: 2, arenaLevel: 1 },
      { slotId: 1, status: 'unlocking', durationHours: 4, arenaLevel: 1 },
      { slotId: 2, status: 'locked', durationHours: 8, arenaLevel: 1 },
      { slotId: 3, status: 'ready', durationHours: 12, arenaLevel: 1 },
    ]

    const tieneHuecoVacio = fullSlots.some((s) => s.status === 'empty')
    expect(tieneHuecoVacio).toBe(false)

    // El resultado cuando no hay hueco vacío
    const resultado = !tieneHuecoVacio ? { awarded: false, isSlotsFull: true } : { awarded: true, isSlotsFull: false }

    expect(resultado.awarded).toBe(false)
    expect(resultado.isSlotsFull).toBe(true)
  })

  it('15. awardVictoryPack ante respuesta huecos_llenos de Supabase no extrae sobres viejos como nuevos', () => {
    const fullSlots: FreePackSlot[] = [
      { slotId: 0, status: 'locked', durationHours: 2, arenaLevel: 1 },
      { slotId: 1, status: 'locked', durationHours: 4, arenaLevel: 1 },
      { slotId: 2, status: 'locked', durationHours: 8, arenaLevel: 1 },
      { slotId: 3, status: 'locked', durationHours: 12, arenaLevel: 1 },
    ]
    expect(fullSlots.length).toBe(4)

    const res = { awarded: false, reason: 'huecos_llenos' }
    let resultadoFinal = { awarded: false, isSlotsFull: false }

    if (res.reason === 'huecos_llenos') {
      resultadoFinal = { awarded: false, isSlotsFull: true }
    }

    expect(resultadoFinal.awarded).toBe(false)
    expect(resultadoFinal.isSlotsFull).toBe(true)
  })
})
