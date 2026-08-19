import { useState, useEffect, useRef } from 'react'
import type { PlantCardInstance, PlantId, ColosseumBetAmount } from '../types/game'
import {
  PACK_DEFINITIONS,
  openSeedPack,
  type InventoryPack,
  type PackId,
  type PackDropResult,
} from '../utils/packDropManager'
import { getArenaForElo } from '../utils/arenaManager'
import { createEmptySlots, drawFreePackCard, type FreePackSlot } from '../utils/freePackManager'
import { SupabaseService } from '../services/supabaseService'
import {
  getEligibleStatsForPlant,
  STAT_LABELS,
  type PlantStatKey,
} from '../utils/gameConstants'

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
  sunflower: 1,
  peashooter: 1,
  wallnut: 1,
  chomper: 1, // Cactus
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

  const [colosseumTickets, setColosseumTickets] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOSSEUM_TICKETS)
    return saved ? Number(saved) : 0
  })

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

  const [plantLevels, setPlantLevels] = useState<Record<PlantId, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLANT_LEVELS)
    return saved ? JSON.parse(saved) : DEFAULT_PLANT_LEVELS
  })

  const [plantStatRolls, setPlantStatRolls] = useState<Record<PlantId, PlantStatKey[]>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLANT_STAT_ROLLS)
    const empty: Record<PlantId, PlantStatKey[]> = {
      sunflower: [],
      peashooter: [],
      wallnut: [],
      chomper: [],
      repeater: [],
      garlic: [],
      bonkchoy: [],
      squash: [],
      twinsunflower: [],
      tallnut: [],
      threepeater: [],
      jalapeno: [],
      iceberglettuce: [],
      aloe: [],
      melonpult: [],
    }
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return { ...empty, ...parsed }
      } catch {
        // fallback
      }
    }
    return empty
  })

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
    localStorage.setItem(STORAGE_KEYS.PLANT_LEVELS, JSON.stringify(plantLevels))
  }, [plantLevels])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PLANT_STAT_ROLLS, JSON.stringify(plantStatRolls))
  }, [plantStatRolls])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PLANT_INSTANCES, JSON.stringify(plantInstances))
  }, [plantInstances])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DECK, JSON.stringify(activeDeck))
  }, [activeDeck])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DECK_INSTANCES, JSON.stringify(activeDeckInstances))
  }, [activeDeckInstances])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLOSSEUM_TICKETS, colosseumTickets.toString())
  }, [colosseumTickets])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLOSSEUM_CURRENT_STREAK, colosseumCurrentStreak.toString())
  }, [colosseumCurrentStreak])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLOSSEUM_MAX_STREAK, colosseumMaxStreak.toString())
  }, [colosseumMaxStreak])

  const addColosseumTickets = (qty: number) => {
    setColosseumTickets((prev) => {
      const next = Math.max(0, prev + qty)
      localStorage.setItem(STORAGE_KEYS.COLOSSEUM_TICKETS, next.toString())
      return next
    })
  }

  const useColosseumTicket = (): boolean => {
    if (colosseumTickets <= 0) return false
    setColosseumTickets((prev) => {
      const next = Math.max(0, prev - 1)
      localStorage.setItem(STORAGE_KEYS.COLOSSEUM_TICKETS, next.toString())
      return next
    })
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

  const buyPack = (packId: PackId): { success: boolean; pack?: InventoryPack; error?: string } => {
    const packDef = PACK_DEFINITIONS[packId]
    if (!packDef) return { success: false, error: 'Pack no válido' }

    // Create new inventory pack
    const newPack: InventoryPack = {
      instanceId: `pack_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      packId,
      name: packDef.name,
      icon: packDef.icon,
      rarity: packDef.rarity,
      purchasedAt: Date.now(),
    }

    setInventoryPacks((prev) => [newPack, ...prev])
    return { success: true, pack: newPack }
  }

  const recordDropCopies = (drops: PackDropResult[]) => {
    setPlantCopies((prev) => {
      const next = { ...prev }
      drops.forEach((d) => {
        next[d.plantId] = (next[d.plantId] || 0) + 1
      })
      return next
    })

    setUnlockedPlants((prev) => {
      const next = [...prev]
      drops.forEach((d) => {
        if (!next.includes(d.plantId)) {
          next.push(d.plantId)
        }
      })
      return next
    })

    // 15% de probabilidad de dropear un Ticket de Coliseo en sobres
    if (Math.random() < 0.15) {
      addColosseumTickets(1)
    }
  }

  const openPackByInstanceId = (instanceId: string): PackDropResult[] | null => {
    const packToOpen = inventoryPacks.find((p) => p.instanceId === instanceId)
    if (!packToOpen) return null

    // Perform drop roll (returns array of cards)
    const drops = openSeedPack(packToOpen.packId, unlockedPlants)

    // Remove pack from inventory
    setInventoryPacks((prev) => prev.filter((p) => p.instanceId !== instanceId))

    // Record copies & unlocks
    recordDropCopies(drops)

    return drops
  }

  const openPackByType = (packId: PackId): PackDropResult[] | null => {
    const packIndex = inventoryPacks.findIndex((p) => p.packId === packId)
    if (packIndex === -1) return null

    const targetPack = inventoryPacks[packIndex]
    return openPackByInstanceId(targetPack.instanceId)
  }

  const openMultiplePacksByInstanceIds = (instanceIds: string[]): PackDropResult[] => {
    const allDrops: PackDropResult[] = []
    let updatedUnlocked = [...unlockedPlants]

    const toOpen = inventoryPacks.filter((p) => instanceIds.includes(p.instanceId))
    if (toOpen.length === 0) return []

    toOpen.forEach((packObj) => {
      const drops = openSeedPack(packObj.packId, updatedUnlocked)
      drops.forEach((d) => {
        if (!updatedUnlocked.includes(d.plantId)) {
          updatedUnlocked.push(d.plantId)
        }
        allDrops.push(d)
      })
    })

    setInventoryPacks((prev) => prev.filter((p) => !instanceIds.includes(p.instanceId)))
    recordDropCopies(allDrops)

    return allDrops
  }

  // FUSES 5 COPIES & ADDS +1 LEVEL WITH A RANDOM STAT ROLL TO A SPECIFIC INSTANCE CARD
  const fuseAndUpgradePlant = (plantId: PlantId, targetInstanceId?: string): {
    success: boolean
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    error?: string
  } => {
    // Find target instance or default base instance
    let target = targetInstanceId
      ? plantInstances.find((i) => i.instanceId === targetInstanceId)
      : plantInstances.find((i) => i.plantId === plantId && i.isBase)

    if (!target) {
      target = plantInstances.find((i) => i.plantId === plantId)
    }

    if (!target) {
      return { success: false, error: 'Carta no encontrada en el inventario' }
    }

    const actualPlantId = target.plantId
    const isLegendary = actualPlantId === 'threepeater' || actualPlantId === 'iceberglettuce'
    const maxLevel = isLegendary ? 3 : 5
    const currentLvl = target.level
    const currentCopies = plantCopies[actualPlantId] || 0

    if (currentLvl >= maxLevel) {
      return { success: false, error: 'Esta carta ya alcanzó el Nivel Máximo' }
    }

    if (currentCopies < 5) {
      return { success: false, error: `Se requieren 5 copias base para la fusión (Tienes ${currentCopies}/5)` }
    }

    // Pick 1 random eligible stat for this plant
    const eligible = getEligibleStatsForPlant(actualPlantId)
    const rolledStat = eligible[Math.floor(Math.random() * eligible.length)]

    // Deduct 5 copies (burns copies, strengthens the card)
    setPlantCopies((prev) => ({
      ...prev,
      [actualPlantId]: Math.max(0, (prev[actualPlantId] || 0) - 5),
    }))

    const nextLvl = currentLvl + 1

    // Update the specific instance card
    setPlantInstances((prev) =>
      prev.map((inst) => {
        if (inst.instanceId === target!.instanceId) {
          return {
            ...inst,
            level: nextLvl,
            statRolls: [...inst.statRolls, rolledStat],
          }
        }
        return inst
      })
    )

    // Also update base mirrors
    if (target.isBase) {
      setPlantLevels((prev) => ({
        ...prev,
        [actualPlantId]: nextLvl,
      }))
      setPlantStatRolls((prev) => {
        const currentList = prev[actualPlantId] || []
        return {
          ...prev,
          [actualPlantId]: [...currentList, rolledStat],
        }
      })
    }

    return {
      success: true,
      newLevel: nextLvl,
      rolledStat,
      rolledStatLabel: STAT_LABELS[rolledStat].suffix,
    }
  }

  const [hasVipPass, setHasVipPass] = useState<boolean>(() => {
    return localStorage.getItem('plant_arena_has_vip_pass') === 'true'
  })

  const [claimedVipLevels, setClaimedVipLevels] = useState<number[]>(() => {
    const saved = localStorage.getItem('plant_arena_claimed_vip_pass')
    return saved ? JSON.parse(saved) : []
  })

  useEffect(() => {
    localStorage.setItem('plant_arena_has_vip_pass', String(hasVipPass))
  }, [hasVipPass])

  useEffect(() => {
    localStorage.setItem('plant_arena_claimed_vip_pass', JSON.stringify(claimedVipLevels))
  }, [claimedVipLevels])

  const buyVipPass = (): boolean => {
    if (userTokens < 10) return false
    setUserTokens((prev) => prev - 10)
    setHasVipPass(true)
    return true
  }

  const claimPassReward = (reward: any, levelNum: number) => {
    if (claimedVipLevels.includes(levelNum)) return
    setClaimedVipLevels((prev) => [...prev, levelNum])

    // Grant reward content
    if (reward.type === 'pack' && reward.packId) {
      const packId = reward.packId as PackId
      const count = reward.packCount || 1
      const packDef = PACK_DEFINITIONS[packId]
      const createdPacks: InventoryPack[] = []
      for (let i = 0; i < count; i++) {
        createdPacks.push({
          instanceId: `pack_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
          packId,
          name: packDef.name,
          rarity: packDef.rarity,
          icon: packDef.icon,
          purchasedAt: Date.now(),
        })
      }
      setInventoryPacks((prev) => [...createdPacks, ...prev])
    } else if (reward.type === 'copies' && reward.plantId) {
      const pId = reward.plantId as PlantId
      const count = reward.copiesCount || 1
      setUnlockedPlants((prev) => {
        if (!prev.includes(pId)) {
          return [...prev, pId]
        }
        return prev
      })
      setPlantCopies((prev) => ({
        ...prev,
        [pId]: (prev[pId] || 0) + count,
      }))
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
    if (currentUserIdRef.current) {
      SupabaseService.saveUserPackSlots(currentUserIdRef.current, freePackSlots)
    }
  }, [freePackSlots])

  // Check timers periodically
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

  const awardVictoryPack = (playerElo: number): { awarded: boolean; durationHours?: 2 | 4 | 8 | 12; arenaLevel?: number; isSlotsFull?: boolean } => {
    const arenaObj = getArenaForElo(playerElo)
    const emptyIndex = freePackSlots.findIndex((s) => s.status === 'empty')
    if (emptyIndex === -1) {
      return { awarded: false, isSlotsFull: true }
    }

    const durations: (2 | 4 | 8 | 12)[] = [2, 4, 8, 12]
    const randomDuration = durations[Math.floor(Math.random() * durations.length)]

    setFreePackSlots((prev) => {
      const next = [...prev]
      next[emptyIndex] = {
        slotId: emptyIndex,
        status: 'locked',
        durationHours: randomDuration,
        arenaLevel: arenaObj.id,
      }
      return next
    })
    return {
      awarded: true,
      durationHours: randomDuration,
      arenaLevel: arenaObj.id,
      isSlotsFull: false,
    }
  }

  const startUnlockingSlot = (slotId: number): { success: boolean; error?: string } => {
    const isAnyUnlocking = freePackSlots.some((s) => s.status === 'unlocking')
    if (isAnyUnlocking) {
      return { success: false, error: '⚠️ Solo puedes desbloquear 1 sobre a la vez.' }
    }

    setFreePackSlots((prev) =>
      prev.map((s) => (s.slotId === slotId ? { ...s, status: 'unlocking', unlockStartedAt: Date.now() } : s))
    )
    return { success: true }
  }

  const fastUnlockSlot = (slotId: number) => {
    setFreePackSlots((prev) =>
      prev.map((s) => (s.slotId === slotId ? { ...s, status: 'ready' } : s))
    )
  }

  const openSlotPack = (slotId: number): PackDropResult | null => {
    const slot = freePackSlots.find((s) => s.slotId === slotId)
    if (!slot || (slot.status !== 'ready' && slot.status !== 'unlocking')) return null

    const dropData = drawFreePackCard(slot.arenaLevel, unlockedPlants)
    const plantId = dropData.plantId

    // Record unlocked plant
    if (!unlockedPlants.includes(plantId)) {
      setUnlockedPlants((prev) => [...prev, plantId])
    }

    // Add copy
    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: (prev[plantId] || 0) + 1,
    }))

    // Reset slot to empty
    setFreePackSlots((prev) =>
      prev.map((s) => (s.slotId === slotId ? { ...s, status: 'empty' } : s))
    )

    const color =
      dropData.rarityLabel === 'COMÚN'
        ? '#4ade80'
        : dropData.rarityLabel === 'POCO COMÚN'
        ? '#22d3ee'
        : dropData.rarityLabel === 'RARA'
        ? '#60a5fa'
        : '#c084fc'

    // 10% de probabilidad de dropear un Ticket de Coliseo en cofres de victoria
    if (Math.random() < 0.10) {
      addColosseumTickets(1)
    }

    return {
      plantId,
      isNew: dropData.isNew,
      rarityLabel: dropData.rarityLabel as any,
      rarityColor: color,
    }
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

  const buyGoldWithTokens = (goldAmount: number, tokenCostUsd: number) => {
    if (userTokens < tokenCostUsd) {
      return { success: false, error: 'Saldo insuficiente de tokens USD/USDT' }
    }
    setUserTokens((prev) => prev - tokenCostUsd)
    setUserGold((prev) => prev + goldAmount)
    return { success: true }
  }

  const addPacksToInventory = (packId: PackId, qty: number) => {
    const packDef = PACK_DEFINITIONS[packId]
    const newPacks: InventoryPack[] = []
    for (let i = 0; i < qty; i++) {
      newPacks.push({
        instanceId: `pack-${Date.now()}-${Math.random().toString(36).substr(2, 6)}-${i}`,
        packId,
        name: packDef.name,
        icon: packDef.icon,
        rarity: packDef.rarity,
        purchasedAt: Date.now(),
      })
    }
    setInventoryPacks((prev) => [...prev, ...newPacks])
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

  return {
    syncProfileData,
    userTokens,
    setUserTokens,
    addTokens,
    userGold,
    setUserGold,
    addGold,
    deductGold,
    buyGoldWithTokens,
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
