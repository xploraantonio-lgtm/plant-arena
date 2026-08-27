import { useState, useEffect, useRef, useMemo } from 'react'
import type { PlantCardInstance, PlantId, ColosseumBetAmount } from '../types/game'
import {
  PACK_DEFINITIONS,
  type InventoryPack,
  type PackId,
  type PackDropResult,
} from '../utils/packDropManager'
import { createEmptySlots, type FreePackSlot } from '../utils/freePackManager'
import { SupabaseService } from '../services/supabaseService'
import { supabase } from '../lib/supabaseClient'
import { STAT_LABELS, type PlantStatKey } from '../utils/gameConstants'

// El servidor devuelve la rareza en inglés (columna plant_catalog.rarity).
// Estas dos tablas la traducen a lo que ya espera la interfaz, para no tener que
// tocar los componentes que pintan el resultado de un sobre.
const RARITY_LABEL: Record<string, PackDropResult['rarityLabel']> = {
  common: 'COMÚN',
  uncommon: 'POCO COMÚN',
  rare: 'RARA',
  epic: 'ÉPICA',
  legendary: 'LEGENDARIA',
}

const RARITY_COLOR: Record<string, string> = {
  common: '#4ade80',
  uncommon: '#22d3ee',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fbbf24',
}

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

const DEFAULT_TOKENS = 0
const DEFAULT_GOLD = 0

const DEFAULT_PLANT_COPIES: Record<PlantId, number> = {
  sunflower: 0,
  peashooter: 0,
  wallnut: 0,
  chomper: 0,
  repeater: 0,
  garlic: 0,
  bonkchoy: 0,
  squash: 0,
  twinsunflower: 0,
  tallnut: 0,
  threepeater: 0,
  jalapeno: 0,
  iceberglettuce: 0,
  aloe: 0,
  melonpult: 0,
}

/**
 * Normaliza y valida autoritativamente el mapa de copias devuelto por el servidor (my_inventory).
 *
 * - Si `rawCopies` es `null` o `undefined`, se interpreta legítimamente como que el usuario
 *   no posee copias excedentes y se devuelve un mapa completo de ceros para las 15 plantas.
 * - Si `rawCopies` no es un objeto plano (ej. string, array, number), lanza Error por violación de contrato.
 * - Para cada planta presente, valida estrictamente que el valor sea un entero >= 0.
 *   Cualquier valor NaN, flotante, negativo o corrupto lanza Error y NO se oculta con fallbacks permisivos.
 * - Las plantas ausentes en `rawCopies` adoptan legítimamente 0 copias.
 */
export function parseServerPlantCopies(rawCopies: unknown): Record<PlantId, number> {
  const baseCopies: Record<PlantId, number> = ALL_15_PLANTS.reduce(
    (acc, id) => {
      acc[id] = 0
      return acc
    },
    {} as Record<PlantId, number>
  )

  if (rawCopies === null || rawCopies === undefined) {
    return baseCopies
  }

  if (typeof rawCopies !== 'object' || Array.isArray(rawCopies)) {
    throw new Error(
      `[useInventory] Formato de copias inválido devuelto por el servidor: ${JSON.stringify(rawCopies)}`
    )
  }

  for (const [id, count] of Object.entries(rawCopies as Record<string, unknown>)) {
    if (!ALL_15_PLANTS.includes(id as PlantId)) {
      continue
    }
    if (typeof count !== 'number' && typeof count !== 'string') {
      throw new Error(`[useInventory] Tipo de dato corrupto para copias de ${id}: ${typeof count}`)
    }
    const n = Number(count)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`[useInventory] Valor de copias inválido para ${id}: ${count}`)
    }
    baseCopies[id as PlantId] = n
  }

  return baseCopies
}

const DEFAULT_PLANT_LEVELS: Record<PlantId, number> = {
  sunflower: 0,
  peashooter: 0,
  wallnut: 0,
  chomper: 0,
  repeater: 0,
  garlic: 0,
  bonkchoy: 0,
  squash: 0,
  twinsunflower: 0,
  tallnut: 0,
  threepeater: 0,
  jalapeno: 0,
  iceberglettuce: 0,
  aloe: 0,
  melonpult: 0,
}

const STORAGE_KEYS = {
  TOKENS: 'plant_arena_user_tokens',
  PACKS: 'plant_arena_inventory_packs',
  UNLOCKED_PLANTS: 'plant_arena_unlocked_plants',
  PLANT_COPIES: 'plant_arena_plant_copies',
  PLANT_LEVELS: 'plant_arena_plant_levels',
  VIP_PASS: 'plant_arena_vip_pass',
  CLAIMED_VIP_LEVELS: 'plant_arena_claimed_vip_levels',
  FREE_PACK_SLOTS: 'plant_arena_free_pack_slots',
  PLANT_STAT_ROLLS: 'plant_arena_plant_stat_rolls',
  PLANT_INSTANCES: 'plant_arena_plant_instances',
  ACTIVE_DECK: 'plant_arena_active_deck',
  ACTIVE_DECK_INSTANCES: 'plant_arena_active_deck_instances',
  GOLD: 'plant_arena_user_gold',
  COLOSSEUM_TICKETS: 'plant_arena_colosseum_tickets',
  COLOSSEUM_CURRENT_STREAK: 'plant_arena_colosseum_current_streak',
  COLOSSEUM_MAX_STREAK: 'plant_arena_colosseum_max_streak',
}

const DEFAULT_DECK: PlantId[] = [
  'sunflower',
  'peashooter',
  'wallnut',
  'chomper',
]

export function useInventory() {
  const [userTokens, setUserTokens] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TOKENS)
    return saved ? Number(saved) : DEFAULT_TOKENS
  })

  const [userGold, setUserGold] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.GOLD)
    return saved ? Number(saved) : DEFAULT_GOLD
  })

  /**
   * Arranca en 0, igual que el pase VIP y por el mismo motivo: el número de
   * verdad es profiles.colosseum_tickets y llega al sincronizar el perfil.
   *
   * El ticket vale una entrada al coliseo, así que mostrarlo desde localStorage
   * era enseñar un saldo que cualquiera podía escribir a mano. El gasto siempre
   * lo valida place_colosseum_wager contra la columna del servidor, así que no
   * había robo posible — pero sí un número mentiroso en pantalla.
   */
  const [colosseumTickets, setColosseumTickets] = useState<number>(0)

  const [colosseumCurrentStreak, setColosseumCurrentStreak] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOSSEUM_CURRENT_STREAK)
    return saved ? Number(saved) : 0
  })

  const [colosseumMaxStreak, setColosseumMaxStreak] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOSSEUM_MAX_STREAK)
    return saved ? Number(saved) : 0
  })

  const [inventoryPacks, setInventoryPacks] = useState<InventoryPack[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PACKS)
    return saved ? JSON.parse(saved) : []
  })

  const [unlockedPlants, setUnlockedPlants] = useState<PlantId[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.UNLOCKED_PLANTS)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PlantId[]
        return parsed
      } catch {
        // fallback
      }
    }
    return ['sunflower', 'peashooter', 'wallnut', 'chomper']
  })

  const [plantCopies, setPlantCopies] = useState<Record<PlantId, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLANT_COPIES)
    const base = { ...DEFAULT_PLANT_COPIES }
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<PlantId, number>
        ALL_15_PLANTS.forEach((id) => {
          base[id] = parsed[id] !== undefined ? parsed[id] : (DEFAULT_PLANT_COPIES[id] || 0)
        })
      } catch {
        // fallback
      }
    }
    return base
  })

  // plantLevels y plantStatRolls ya no son estado propio: se DERIVAN de las
  // instancias base. Antes eran "espejos" que la fusión actualizaba a mano en
  // paralelo a plantInstances, así que podían desincronizarse del inventario
  // real. Ahora el nivel y las tiradas viven en cada instancia (que es lo que
  // guarda el servidor) y esto sólo los reexpone en la forma que ya esperan
  // los componentes.

  // Distinct plant card instances (Original plants + Bought/Improved builds)
  const [plantInstances, setPlantInstances] = useState<PlantCardInstance[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLANT_INSTANCES)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PlantCardInstance[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch {
        // fallback
      }
    }
    // Default base cards (Only the 4 starter cards: Sunflower, Peashooter, Wallnut, Cactus)
    return DEFAULT_DECK.map((id) => ({
      instanceId: `inst_base_${id}`,
      plantId: id,
      level: 0,
      statRolls: [],
      isBase: true,
      obtainedAt: Date.now(),
    }))
  })

  // Derivados de las instancias base. Una sola fuente de verdad: si el servidor
  // sube el nivel de una carta, estos dos cambian solos.
  const plantLevels = useMemo<Record<PlantId, number>>(() => {
    const out = { ...DEFAULT_PLANT_LEVELS }
    for (const inst of plantInstances) {
      if (inst.isBase) out[inst.plantId] = inst.level
    }
    return out
  }, [plantInstances])

  const plantStatRolls = useMemo<Record<PlantId, PlantStatKey[]>>(() => {
    const out = {} as Record<PlantId, PlantStatKey[]>
    for (const id of ALL_15_PLANTS) out[id] = []
    for (const inst of plantInstances) {
      if (inst.isBase) out[inst.plantId] = inst.statRolls || []
    }
    return out
  }, [plantInstances])

  // Active Battle Deck (Plant IDs)
  const [activeDeck, setActiveDeck] = useState<PlantId[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_DECK)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch {}
    }
    return DEFAULT_DECK
  })

  // Active Battle Deck specific card instance IDs
  const [activeDeckInstances, setActiveDeckInstances] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_DECK_INSTANCES)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch {}
    }
    return []
  })

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TOKENS, userTokens.toString())
  }, [userTokens])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.GOLD, userGold.toString())
  }, [userGold])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PACKS, JSON.stringify(inventoryPacks))
  }, [inventoryPacks])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.UNLOCKED_PLANTS, JSON.stringify(unlockedPlants))
  }, [unlockedPlants])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PLANT_COPIES, JSON.stringify(plantCopies))
  }, [plantCopies])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PLANT_INSTANCES, JSON.stringify(plantInstances))
  }, [plantInstances])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DECK, JSON.stringify(activeDeck))
  }, [activeDeck])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DECK_INSTANCES, JSON.stringify(activeDeckInstances))
  }, [activeDeckInstances])

  // Ya no se guardan los tickets en localStorage: el saldo de verdad es
  // profiles.colosseum_tickets. Guardarlos sólo dejaba una copia obsoleta que
  // nadie lee y que confundía al depurar.

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLOSSEUM_CURRENT_STREAK, colosseumCurrentStreak.toString())
  }, [colosseumCurrentStreak])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLOSSEUM_MAX_STREAK, colosseumMaxStreak.toString())
  }, [colosseumMaxStreak])

  const addColosseumTickets = (qty: number) => {
    setColosseumTickets((prev) => Math.max(0, prev + qty))
  }

  /**
   * PENDIENTE DE LA FASE DE EMPAREJAMIENTO — descuento sólo visual.
   *
   * El ticket se resta aquí en el navegador, pero el servidor no se entera: al
   * recargar vuelve, así que entrar al coliseo con ticket es gratis de hecho.
   *
   * Quien lo cobra de verdad es place_colosseum_wager(apuesta, usarTicket), ya
   * disponible en el servidor. No se conecta todavía a propósito: el coliseo
   * necesita el flujo completo —retener, entrar en cola, esperar rival, y
   * devolver si no aparece en cuatro minutos— y la cola no existe aún. Cobrar
   * ahora dejaría al jugador pagando por partidas contra la IA local, con el
   * importe retenido hasta que el barrido lo devolviera.
   *
   * Se conecta en el paso 10 del plan, cuando el coliseo se active de verdad.
   */
  const useColosseumTicket = (): boolean => {
    if (colosseumTickets <= 0) return false
    setColosseumTickets((prev) => Math.max(0, prev - 1))
    return true
  }

  const resolveColosseumMatch = (
    won: boolean,
    betGems: ColosseumBetAmount,
    usedTicket: boolean
  ): { payoutGems: number; newStreak: number; newMaxStreak: number; isNewRecord: boolean } => {
    // 80% payout of total pot (2x bet) = 1.6x bet
    const payoutMultiplier = 1.6
    const payoutGems = Number((betGems * payoutMultiplier).toFixed(2))

    let newStreak = colosseumCurrentStreak
    let newMaxStreak = colosseumMaxStreak
    let isNewRecord = false

    if (won) {
      // Award winnings
      addUserTokens(payoutGems)
      newStreak = colosseumCurrentStreak + 1
      setColosseumCurrentStreak(newStreak)
      localStorage.setItem(STORAGE_KEYS.COLOSSEUM_CURRENT_STREAK, newStreak.toString())

      if (newStreak > colosseumMaxStreak) {
        newMaxStreak = newStreak
        isNewRecord = true
        setColosseumMaxStreak(newMaxStreak)
        localStorage.setItem(STORAGE_KEYS.COLOSSEUM_MAX_STREAK, newMaxStreak.toString())
      }
    } else {
      // Defeat
      if (!usedTicket) {
        deductUserTokens(betGems)
      }
      newStreak = 0
      setColosseumCurrentStreak(0)
      localStorage.setItem(STORAGE_KEYS.COLOSSEUM_CURRENT_STREAK, '0')
    }

    return { payoutGems: won ? payoutGems : 0, newStreak, newMaxStreak, isNewRecord }
  }

  const updateActiveDeck = (plantIds: PlantId[], instanceIds?: string[]) => {
    setActiveDeck(plantIds)
    if (instanceIds && instanceIds.length > 0) {
      setActiveDeckInstances(instanceIds)
    }
  }

  const addTokens = (amount: number) => {
    setUserTokens((prev) => prev + amount)
  }

  // buyPack se movió al bloque de servidor del final del archivo.
  // La versión que había aquí creaba el sobre y lo añadía al inventario sin
  // descontar nada: los sobres eran gratis, y el aviso de "gemas insuficientes"
  // de Shop.tsx era decorativo porque el saldo nunca se gastaba.

  // recordDropCopies se eliminó: sumaba copias y sorteaba el 15% de ticket de
  // coliseo en el navegador. Ambas cosas las hace ahora open_pack en el
  // servidor, dentro de la misma transacción que consume el sobre.

  /**
   * Abre un sobre. El instanceId ES la fila de player_packs, así que el
   * servidor comprueba que existe y es tuyo antes de sortear.
   *
   * La versión local llamaba a openSeedPack() con Math.random() en el navegador:
   * se podía repetir hasta sacar una legendaria, y el sobre nunca se había
   * cobrado (ver el fallo de la tienda).
   */
  const openPackByInstanceId = async (instanceId: string): Promise<PackDropResult[] | null> => {
    const res = await openPackOnServer(instanceId)
    return res ? res.drops : null
  }

  const openPackByType = async (packId: PackId): Promise<PackDropResult[] | null> => {
    const targetPack = inventoryPacks.find((p) => p.packId === packId)
    if (!targetPack) return null
    return await openPackByInstanceId(targetPack.instanceId)
  }

  const openMultiplePacksByInstanceIds = async (instanceIds: string[]): Promise<PackDropResult[]> => {
    const allDrops: PackDropResult[] = []
    // En serie y no en paralelo: cada apertura mueve saldo y tickets, y así el
    // refresco de estado de una no se pisa con el de la siguiente.
    for (const id of instanceIds) {
      const res = await openPackOnServer(id)
      if (res) allDrops.push(...res.drops)
    }
    return allDrops
  }

  // FUSES 5 COPIES & ADDS +1 LEVEL WITH A RANDOM STAT ROLL TO A SPECIFIC INSTANCE CARD
  /**
   * Fusiona: 5 copias → +1 nivel + una stat elegible al azar.
   *
   * Ahora lo resuelve fuse_plant en el servidor. La versión local sorteaba la
   * stat con Math.random() y descontaba las copias en el navegador, así que se
   * podía repetir hasta sacar la stat deseada, o subir de nivel sin tener las
   * copias. El servidor sortea entre las stats que admite ESA planta concreta
   * (plant_catalog.eligible_stats) y respeta el nivel máximo: 3 en legendarias,
   * 5 en el resto.
   */
  const fuseAndUpgradePlant = async (
    plantId: PlantId,
    targetInstanceId?: string
  ): Promise<{
    success: boolean
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    error?: string
  }> => {
    // Resolver la instancia igual que antes: la indicada, si no la base, si no
    // cualquiera de esa planta.
    const target =
      (targetInstanceId
        ? plantInstances.find((i) => i.instanceId === targetInstanceId)
        : plantInstances.find((i) => i.plantId === plantId && i.isBase)) ??
      plantInstances.find((i) => i.plantId === plantId)

    if (!target) {
      return { success: false, error: 'Carta no encontrada en el inventario' }
    }

    return await fusePlantOnServer(target.instanceId)
  }

  /**
   * Arranca en false, no en lo que diga localStorage.
   *
   * El valor de verdad es profiles.has_vip_pass, y llega unos milisegundos
   * después al sincronizar el perfil. Leer localStorage aquí sólo servía para
   * pintar antes ese primer instante, y a cambio: cualquiera podía poner la
   * marca a mano y ver la interfaz de VIP hasta que el servidor le corrigiera,
   * y si la sincronización fallaba se quedaba así. Es mejor un instante sin
   * insignia que un instante con una insignia que no es tuya.
   */
  const [hasVipPass, setHasVipPass] = useState<boolean>(false)

  const [claimedVipLevels, setClaimedVipLevels] = useState<number[]>(() => {
    const saved = localStorage.getItem('plant_arena_claimed_vip_pass')
    return saved ? JSON.parse(saved) : []
  })

  // Tampoco se guarda el pase VIP: lo dice profiles.has_vip_pass.

  useEffect(() => {
    localStorage.setItem('plant_arena_claimed_vip_pass', JSON.stringify(claimedVipLevels))
  }, [claimedVipLevels])

  // buyVipPass se movió al bloque de servidor: el precio lo pone shop_config,
  // no una constante en el cliente.

  /**
   * Reclama autoritativamente en Supabase la recompensa de un nivel del Pase VIP
   * a través de la RPC claim_battle_pass_level(p_level).
   */
  const claimPassReward = async (
    _reward: any,
    levelNum: number
  ): Promise<{ success: boolean; level?: number; label?: string; error?: string }> => {
    try {
      const res = await SupabaseService.claimBattlePassLevel(levelNum)
      if (res && res.success) {
        await Promise.all([refreshBalance(), refreshInventory()])
        return { success: true, level: levelNum, label: res.label }
      }
      return { success: false, error: res?.error || 'Error al reclamar recompensa VIP' }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error de conexión' }
    }
  }

  /**
   * Reclama autoritativamente todos los niveles disponibles del Pase VIP
   * mediante claim_all_battle_pass_levels().
   */
  const claimAllPassRewards = async (): Promise<{
    success: boolean
    claimed?: any[]
    error?: string
  }> => {
    try {
      const res = await SupabaseService.claimAllBattlePassLevels()
      if (res && res.success) {
        await Promise.all([refreshBalance(), refreshInventory()])
        return { success: true, claimed: res.claimed }
      }
      return { success: false, error: res?.error || 'Error al reclamar recompensas VIP' }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error de conexión' }
    }
  }

  const currentUserIdRef = useRef<string | null>(null)

  const [freePackSlots, setFreePackSlots] = useState<FreePackSlot[]>(() => {
    const saved = localStorage.getItem('plant_arena_free_pack_slots')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        return createEmptySlots()
      }
    }
    return createEmptySlots()
  })

  useEffect(() => {
    localStorage.setItem('plant_arena_free_pack_slots', JSON.stringify(freePackSlots))
  }, [freePackSlots])

  // Check timers periodically against absolute server unlockStartedAt timestamp
  useEffect(() => {
    const timer = setInterval(() => {
      setFreePackSlots((prev) => {
        let changed = false
        const next = prev.map((slot) => {
          if (slot.status === 'unlocking' && slot.unlockStartedAt) {
            const totalMs = slot.durationHours * 3600 * 1000
            const elapsedMs = Date.now() - slot.unlockStartedAt
            if (elapsedMs >= totalMs) {
              changed = true
              return { ...slot, status: 'ready' as const }
            }
          }
          return slot
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  /**
   * Cofre por victoria. Lo concede award_victory_chest en el servidor, que elige
   * el hueco, la duración y el nivel de arena.
   *
   * LÍMITE CONOCIDO: la partida se juega en el navegador, así que el servidor no
   * puede comprobar que se ganó de verdad. Lo acotan el tope de 4 huecos, las
   * 2–12 h de espera por cofre y un cofre como máximo cada 2 minutos. Se cierra
   * del todo cuando el servidor resuelva las partidas.
   */
  const awardVictoryPack = async (
    _playerElo: number
  ): Promise<{ awarded: boolean; durationHours?: 2 | 4 | 8 | 12; arenaLevel?: number; isSlotsFull?: boolean }> => {
    const prevSlots = freePackSlots
    const tieneHuecoVacio = prevSlots.some((s) => s.status === 'empty')

    // Si ya se tienen los 4 slots llenos, no pedir cofre ni mostrar premio de sobre
    if (!tieneHuecoVacio) {
      return { awarded: false, isSlotsFull: true }
    }

    const res = await SupabaseService.awardVictoryChest()

    // 1. Adoptar siempre los cofres tal como quedaron en el servidor.
    let remoteSlots: FreePackSlot[] | null = null
    const uid = currentUserIdRef.current ?? (await supabase.auth.getUser()).data?.user?.id
    if (uid) {
      currentUserIdRef.current = uid
      remoteSlots = await SupabaseService.getUserPackSlots(uid)
      if (remoteSlots && remoteSlots.length > 0) {
        setFreePackSlots(remoteSlots)
        localStorage.setItem('plant_arena_free_pack_slots', JSON.stringify(remoteSlots))
      }
    }

    // 2. Si el RPC concedió directamente el sobre
    if (res.awarded) {
      return {
        awarded: true,
        durationHours: res.durationHours as 2 | 4 | 8 | 12,
        arenaLevel: res.arenaLevel,
        isSlotsFull: false,
      }
    }

    // Si los huecos están llenos en el servidor
    if (res.reason === 'huecos_llenos') {
      return { awarded: false, isSlotsFull: true }
    }

    // 3. Si settlement ya lo había entregado hace instantes ('demasiado_pronto') en un hueco que antes estaba vacío
    if (res.reason === 'demasiado_pronto' && remoteSlots) {
      const newlyAwarded = remoteSlots.find(
        (s) => s.status === 'locked' && prevSlots.find((p) => p.slotId === s.slotId)?.status === 'empty'
      )

      if (newlyAwarded) {
        return {
          awarded: true,
          durationHours: newlyAwarded.durationHours as 2 | 4 | 8 | 12,
          arenaLevel: newlyAwarded.arenaLevel,
          isSlotsFull: false,
        }
      }
    }

    return { awarded: false, isSlotsFull: res.reason === 'huecos_llenos' }
  }

  const startUnlockingSlot = (slotId: number): { success: boolean; error?: string } => {
    const isAnyUnlocking = freePackSlots.some((s) => s.status === 'unlocking')
    if (isAnyUnlocking) {
      return { success: false, error: '⚠️ Solo puedes desbloquear 1 sobre a la vez.' }
    }

    const nextSlots = freePackSlots.map((s) =>
      s.slotId === slotId ? { ...s, status: 'unlocking' as const, unlockStartedAt: Date.now() } : s
    )
    setFreePackSlots(nextSlots)
    localStorage.setItem('plant_arena_free_pack_slots', JSON.stringify(nextSlots))

    if (currentUserIdRef.current) {
      void SupabaseService.syncPackSlots(nextSlots).then(({ slots }) => {
        if (slots && slots.length > 0) {
          setFreePackSlots(slots)
          localStorage.setItem('plant_arena_free_pack_slots', JSON.stringify(slots))
        }
      })
    }
    return { success: true }
  }

  /**
   * Abre un cofre al instante pagando oro. Antes era gratis: sólo ponía el
   * estado en 'ready' sin cobrar nada. Ahora instant_unlock_pack_slot cobra el
   * oro calculando el coste con el reloj del servidor.
   */
  const fastUnlockSlot = async (slotId: number): Promise<{ success: boolean; goldSpent?: number; error?: string }> => {
    return await instantUnlockSlotOnServer(slotId)
  }

  /**
   * Reclama un cofre. Ahora lo resuelve claim_pack_slot en el servidor.
   *
   * La versión local sorteaba la carta con drawFreePackCard() en el navegador y
   * ponía el cofre a 'empty' por su cuenta, así que se podía repetir la tirada
   * hasta sacar la carta deseada. El servidor además revalida el temporizador.
   */
  const openSlotPack = async (slotId: number): Promise<PackDropResult | null> => {
    return await claimSlotOnServer(slotId)
  }

  const deductUserTokens = (amountUsd: number): boolean => {
    if (userTokens < amountUsd) return false
    setUserTokens((prev) => {
      const next = Math.max(0, Number((prev - amountUsd).toFixed(2)))
      localStorage.setItem(STORAGE_KEYS.TOKENS, String(next))
      return next
    })
    return true
  }

  const addUserTokens = (amountUsd: number) => {
    setUserTokens((prev) => {
      const next = Number((prev + amountUsd).toFixed(2))
      localStorage.setItem(STORAGE_KEYS.TOKENS, String(next))
      return next
    })
  }

  const donatePlantCopy = (plantId: PlantId): boolean => {
    const current = plantCopies[plantId] || 0
    if (current <= 0) return false
    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: prev[plantId] - 1,
    }))
    return true
  }

  const receivePlantCopy = (plantId: PlantId) => {
    setUnlockedPlants((prev) => {
      if (!prev.includes(plantId)) {
        return [...prev, plantId]
      }
      return prev
    })
    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: (prev[plantId] || 0) + 1,
    }))
  }

  // RECEIVE A FULL PLANT CARD INSTANCE (FROM MARKETPLACE OR CHEST)
  const receivePlantInstance = (plantId: PlantId, level = 0, statRolls: PlantStatKey[] = []) => {
    setUnlockedPlants((prev) => {
      if (!prev.includes(plantId)) {
        return [...prev, plantId]
      }
      return prev
    })

    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: (prev[plantId] || 0) + 1,
    }))

    const newInstance: PlantCardInstance = {
      instanceId: `inst_${plantId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      plantId,
      level,
      statRolls: [...statRolls],
      isBase: false,
      obtainedAt: Date.now(),
    }

    setPlantInstances((prev) => [...prev, newInstance])
  }

  // REMOVE A PLANT CARD INSTANCE (WHEN SOLD ON MARKETPLACE)
  const removePlantInstance = (instanceId: string): boolean => {
    const target = plantInstances.find((i) => i.instanceId === instanceId)
    if (!target) return false

    setPlantInstances((prev) => prev.filter((i) => i.instanceId !== instanceId))
    setPlantCopies((prev) => ({
      ...prev,
      [target.plantId]: Math.max(0, (prev[target.plantId] || 1) - 1),
    }))
    return true
  }

  const addGold = (amount: number) => {
    setUserGold((prev) => prev + amount)
  }

  const deductGold = (amount: number): boolean => {
    if (userGold < amount) return false
    setUserGold((prev) => prev - amount)
    return true
  }

  // buyGoldWithTokens se movió al bloque de servidor y ahora recibe el ID del
  // paquete, no (cantidad, precio). Recibir ambos del cliente significaba que
  // el tipo de cambio lo decidía el navegador: 1.000.000 de oro por 1 gema era
  // una llamada.

  /**
   * PENDIENTE DE FASE 2c — cerrado a propósito.
   *
   * Creaba sobres en el navegador con un instanceId inventado. Ahora el
   * instanceId tiene que ser una fila real de player_packs, así que un sobre
   * creado aquí NO se podría abrir: open_pack lo rechazaría con "Sobre no
   * encontrado". Un sobre que aparece y no funciona es peor que ningún sobre.
   *
   * Lo llaman las recompensas de clan, la lotería y el jardín. Cada una necesita
   * su RPC que compruebe que la recompensa se ganó de verdad.
   */
  const addPacksToInventory = (packId: PackId, qty: number) => {
    console.warn(
      `[useInventory] Recompensa de ${qty} sobre(s) "${packId}" no entregada: ` +
      'los sobres deben crearse en el servidor. Pendiente de la fase 2c.'
    )
  }

  const syncProfileData = (profile: {
    id?: string
    gems_balance?: number
    gold_balance?: number
    colosseum_tickets?: number
    colosseum_current_streak?: number
    colosseum_max_streak?: number
    has_vip_pass?: boolean
    claimed_vip_levels?: number[]
  } | null) => {
    if (!profile) return
    if (profile.id) {
      currentUserIdRef.current = profile.id
      SupabaseService.getUserPackSlots(profile.id).then((remoteSlots) => {
        if (remoteSlots && remoteSlots.length > 0) {
          setFreePackSlots(remoteSlots)
        }
      }).catch(() => {})
    }
    if (profile.gems_balance !== undefined) setUserTokens(Number(profile.gems_balance))
    if (profile.gold_balance !== undefined) setUserGold(Number(profile.gold_balance))
    if (profile.colosseum_tickets !== undefined) setColosseumTickets(Number(profile.colosseum_tickets))
    if (profile.colosseum_current_streak !== undefined) setColosseumCurrentStreak(Number(profile.colosseum_current_streak))
    if (profile.colosseum_max_streak !== undefined) setColosseumMaxStreak(Number(profile.colosseum_max_streak))
    if (profile.has_vip_pass !== undefined) setHasVipPass(Boolean(profile.has_vip_pass))
    if (profile.claimed_vip_levels !== undefined) setClaimedVipLevels(profile.claimed_vip_levels || [])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE DE SERVIDOR (fase 2)
  //
  // Todo lo que cobra o crea cartas vive aquí. El patrón es siempre el mismo:
  // llamar a la RPC, y si sale bien adoptar el saldo que devuelve el servidor
  // en lugar de calcularlo en el cliente. Así el navegador nunca es la fuente
  // de verdad de nada que tenga valor.
  //
  // Se define al final del hook a propósito: aquí ya están declarados todos los
  // setters, y el orden de definición no importa porque estas funciones sólo se
  // ejecutan al interactuar el usuario.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Adopta el saldo autoritativo del servidor. */
  const refreshBalance = async (): Promise<void> => {
    const b = await SupabaseService.myBalance()
    if (!b) return
    setUserTokens(Number(b.gems_balance))
    setUserGold(Number(b.gold_balance))
    setColosseumTickets(Number(b.colosseum_tickets))
    setHasVipPass(Boolean(b.has_vip_pass))
    setClaimedVipLevels(b.claimed_vip_levels || [])
    setColosseumCurrentStreak(Number(b.colosseum_current_streak))
    setColosseumMaxStreak(Number(b.colosseum_max_streak))
  }

  /** Recarga el inventario completo desde el servidor. */
  const refreshInventory = async (): Promise<void> => {
    const inv = await SupabaseService.myInventory()
    if (!inv) return

    setPlantInstances(
      inv.instances.map((i) => ({
        instanceId: i.instanceId,
        plantId: i.plantId as PlantId,
        level: i.level,
        statRolls: (i.statRolls || []) as PlantStatKey[],
        isBase: i.isBase,
        obtainedAt: i.obtainedAt,
      }))
    )

    const baseCopies = parseServerPlantCopies(inv.copies)
    setPlantCopies(baseCopies)
    setUnlockedPlants((inv.unlocked || []) as PlantId[])

    // El instanceId del sobre ES el id de la fila en player_packs: es lo que
    // open_pack necesita para localizarlo y comprobar que es tuyo.
    setInventoryPacks(
      (inv.packs || []).map((p) => {
        const def = PACK_DEFINITIONS[p.packId as PackId]
        return {
          instanceId: p.rowId,
          packId: p.packId as PackId,
          name: def?.name || p.packId,
          icon: def?.icon || '',
          rarity: def?.rarity || 'common',
          purchasedAt: p.obtainedAt,
        }
      })
    )

    // El mazo activo sale de is_in_deck / deck_slot, no de una lista aparte que
    // podía desincronizarse del inventario real.
    const enDeck = inv.instances
      .filter((i) => i.isInDeck)
      .sort((a, b) => (a.deckSlot ?? 99) - (b.deckSlot ?? 99))
    if (enDeck.length > 0) {
      setActiveDeckInstances(enDeck.map((i) => i.instanceId))
      setActiveDeck(enDeck.map((i) => i.plantId as PlantId))
    }
  }

  const refreshPackSlots = async (): Promise<void> => {
    const uid = currentUserIdRef.current ?? (await supabase.auth.getUser()).data?.user?.id
    if (!uid) return
    currentUserIdRef.current = uid
    const remoteSlots = await SupabaseService.getUserPackSlots(uid)
    if (remoteSlots && remoteSlots.length > 0) {
      setFreePackSlots(remoteSlots)
      localStorage.setItem('plant_arena_free_pack_slots', JSON.stringify(remoteSlots))
    }
  }

  const refreshFromServer = async (): Promise<void> => {
    await Promise.all([refreshBalance(), refreshInventory(), refreshPackSlots()])
  }

  /** Compra sobres. El precio y el tope de cantidad los pone el servidor. */
  const buyPack = async (
    packId: PackId,
    qty: number = 1
  ): Promise<{ success: boolean; packs?: InventoryPack[]; error?: string }> => {
    const res = await SupabaseService.buyPacks(packId, qty)
    if (!res.success) return { success: false, error: res.error }

    await refreshFromServer()

    const def = PACK_DEFINITIONS[packId]
    const packs: InventoryPack[] = (res.packIds || []).map((id) => ({
      instanceId: id,
      packId,
      name: def.name,
      icon: def.icon,
      rarity: def.rarity,
      purchasedAt: Date.now(),
    }))
    return { success: true, packs }
  }

  /** Compra oro por ID de paquete. La cantidad y el precio salen de la base. */
  const buyGoldPackage = async (
    packageId: string
  ): Promise<{ success: boolean; goldAdded?: number; error?: string }> => {
    const res = await SupabaseService.buyGold(packageId)
    if (!res.success) return { success: false, error: res.error }
    await refreshBalance()
    return { success: true, goldAdded: res.goldAdded }
  }

  const buyVipPass = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await SupabaseService.buyVipPass()
    if (!res.success) return { success: false, error: res.error }
    await refreshBalance()
    return { success: true }
  }

  /** Abre un sobre del servidor. El sorteo lo hace Postgres. */
  const openPackOnServer = async (
    packRowId: string
  ): Promise<{ drops: PackDropResult[]; colosseumTicket: boolean } | null> => {
    const res = await SupabaseService.openPack(packRowId)
    if (!res.success || !res.drops) return null

    await refreshFromServer()

    const drops: PackDropResult[] = res.drops.map((d) => ({
      plantId: d.plantId as PlantId,
      rarityLabel: RARITY_LABEL[d.rarity] ?? 'COMÚN',
      rarityColor: RARITY_COLOR[d.rarity] ?? '#4ade80',
      isNew: d.isNew,
    }))
    return { drops, colosseumTicket: Boolean(res.colosseumTicket) }
  }

  /** Fusiona en el servidor: 5 copias + 250 oro → +1 nivel + stat al azar. */
  const fusePlantOnServer = async (
    instanceId: string
  ): Promise<{
    success: boolean
    plantId?: string
    previousLevel?: number
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    copiesSpent?: number
    copiesRemaining?: number
    goldSpent?: number
    goldBalance?: number
    error?: string
  }> => {
    const res = await SupabaseService.fusePlant(instanceId)
    if (!res.success) return { success: false, error: res.error }

    // Refrescar inventario (instancias + copias) y saldo de oro desde PostgreSQL
    await refreshFromServer()

    const stat = res.rolledStat as PlantStatKey | undefined
    return {
      success: true,
      plantId: res.plantId,
      previousLevel: res.previousLevel,
      newLevel: res.newLevel,
      rolledStat: stat,
      rolledStatLabel: stat ? STAT_LABELS[stat]?.suffix : undefined,
      copiesSpent: res.copiesSpent,
      copiesRemaining: res.copiesRemaining ?? res.copiesLeft,
      goldSpent: res.goldSpent,
      goldBalance: res.goldBalance,
    }
  }

  /** Reclama un cofre listo. El servidor revalida el temporizador. */
  const claimSlotOnServer = async (
    slotIndex: number
  ): Promise<PackDropResult | null> => {
    const res = await SupabaseService.claimPackSlot(slotIndex)
    if (!res.success || !res.plantId) return null

    await refreshFromServer()
    if (currentUserIdRef.current) {
      const remoteSlots = await SupabaseService.getUserPackSlots(currentUserIdRef.current)
      if (remoteSlots && remoteSlots.length > 0) setFreePackSlots(remoteSlots)
    }

    return {
      plantId: res.plantId as PlantId,
      rarityLabel: RARITY_LABEL[res.rarity || 'common'] ?? 'COMÚN',
      rarityColor: RARITY_COLOR[res.rarity || 'common'] ?? '#4ade80',
      isNew: Boolean(res.isNew),
    }
  }

  /** Abre un cofre al instante pagando oro. El coste lo calcula el servidor. */
  const instantUnlockSlotOnServer = async (
    slotIndex: number
  ): Promise<{ success: boolean; goldSpent?: number; error?: string }> => {
    const res = await SupabaseService.instantUnlockPackSlot(slotIndex)
    if (!res.success) return { success: false, error: res.error }

    await refreshBalance()
    if (currentUserIdRef.current) {
      const remoteSlots = await SupabaseService.getUserPackSlots(currentUserIdRef.current)
      if (remoteSlots && remoteSlots.length > 0) setFreePackSlots(remoteSlots)
    }

    return { success: true, goldSpent: res.goldSpent }
  }

  return {
    refreshFromServer,
    buyGoldPackage,
    openPackOnServer,
    fusePlantOnServer,
    claimSlotOnServer,
    instantUnlockSlotOnServer,
    syncProfileData,
    userTokens,
    setUserTokens,
    addTokens,
    userGold,
    setUserGold,
    addGold,
    deductGold,
    inventoryPacks,
    unlockedPlants,
    plantCopies,
    plantLevels,
    plantStatRolls,
    plantInstances,
    activeDeck,
    activeDeckInstances,
    updateActiveDeck,
    hasVipPass,
    claimedVipLevels,
    freePackSlots,
    buyPack,
    openPackByInstanceId,
    openPackByType,
    openMultiplePacksByInstanceIds,
    fuseAndUpgradePlant,
    buyVipPass,
    claimPassReward,
    claimAllPassRewards,
    awardVictoryPack,
    startUnlockingSlot,
    fastUnlockSlot,
    openSlotPack,
    deductUserTokens,
    addUserTokens,
    donatePlantCopy,
    receivePlantCopy,
    receivePlantInstance,
    removePlantInstance,
    addPacksToInventory,
    // Colosseum Exports
    colosseumTickets,
    setColosseumTickets,
    addColosseumTickets,
    useColosseumTicket,
    colosseumCurrentStreak,
    colosseumMaxStreak,
    resolveColosseumMatch,
  }
}
