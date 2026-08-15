import { useState, useEffect } from 'react'
import type { PlantId } from '../types/game'
import {
  PACK_DEFINITIONS,
  openSeedPack,
  type InventoryPack,
  type PackId,
  type PackDropResult,
} from '../utils/packDropManager'
import { getArenaForElo } from '../utils/arenaManager'
import { createEmptySlots, drawFreePackCard, type FreePackSlot } from '../utils/freePackManager'
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

const DEFAULT_TOKENS = 5000

const DEFAULT_PLANT_COPIES: Record<PlantId, number> = {
  sunflower: 12,
  peashooter: 12,
  wallnut: 12,
  chomper: 12,
  repeater: 12,
  garlic: 12,
  bonkchoy: 12,
  squash: 12,
  twinsunflower: 12,
  tallnut: 12,
  threepeater: 12,
  jalapeno: 12,
  iceberglettuce: 12,
  aloe: 12,
  melonpult: 12,
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
  TOKENS: 'plant_arena_tokens',
  PACKS: 'plant_arena_inventory_packs',
  UNLOCKED_PLANTS: 'plant_arena_unlocked_plants',
  PLANT_COPIES: 'plant_arena_plant_copies',
  PLANT_LEVELS: 'plant_arena_plant_levels',
  PLANT_STAT_ROLLS: 'plant_arena_plant_stat_rolls',
}

export function useInventory() {
  const [userTokens, setUserTokens] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TOKENS)
    return saved ? Number(saved) : DEFAULT_TOKENS
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
        const set = new Set([...parsed, ...ALL_15_PLANTS])
        return Array.from(set)
      } catch {
        // fallback
      }
    }
    return ALL_15_PLANTS
  })

  const [plantCopies, setPlantCopies] = useState<Record<PlantId, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLANT_COPIES)
    const base = { ...DEFAULT_PLANT_COPIES }
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<PlantId, number>
        ALL_15_PLANTS.forEach((id) => {
          base[id] = Math.max(12, parsed[id] !== undefined ? parsed[id] : 12)
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

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TOKENS, userTokens.toString())
  }, [userTokens])

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

  // FUSES 5 COPIES (BURNS 4, 1 STAYS) & ADDS +1 LEVEL WITH A RANDOM STAT ROLL
  const fuseAndUpgradePlant = (plantId: PlantId): {
    success: boolean
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    error?: string
  } => {
    const isLegendary = plantId === 'threepeater' || plantId === 'iceberglettuce'
    const maxLevel = isLegendary ? 3 : 5
    const currentLvl = plantLevels[plantId] || 0
    const currentCopies = plantCopies[plantId] || 0

    if (currentLvl >= maxLevel) {
      return { success: false, error: 'Esta planta ya alcanzó el Nivel Máximo' }
    }

    if (currentCopies < 5) {
      return { success: false, error: `Se requieren 5 copias para la fusión (Tienes ${currentCopies}/5)` }
    }

    // Pick 1 random eligible stat for this plant
    const eligible = getEligibleStatsForPlant(plantId)
    const rolledStat = eligible[Math.floor(Math.random() * eligible.length)]

    // Burn 4 copies, 1 stays
    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: prev[plantId] - 4,
    }))

    // Upgrade level
    const nextLvl = currentLvl + 1
    setPlantLevels((prev) => ({
      ...prev,
      [plantId]: nextLvl,
    }))

    // Add rolled stat
    setPlantStatRolls((prev) => {
      const currentList = prev[plantId] || []
      return {
        ...prev,
        [plantId]: [...currentList, rolledStat],
      }
    })

    return {
      success: true,
      newLevel: nextLvl,
      rolledStat,
      rolledStatLabel: STAT_LABELS[rolledStat].suffix,
    }
  }

  const [hasVipPass, setHasVipPass] = useState<boolean>(() => {
    const saved = localStorage.getItem('plant_arena_has_vip_pass')
    if (saved === 'false') return false
    return true
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
      const createdPack: InventoryPack = {
        instanceId: `pack_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        packId: reward.packId,
        name: PACK_DEFINITIONS[reward.packId as PackId].name,
        rarity: PACK_DEFINITIONS[reward.packId as PackId].rarity,
        icon: PACK_DEFINITIONS[reward.packId as PackId].icon,
        purchasedAt: Date.now(),
      }
      setInventoryPacks((prev) => [createdPack, ...prev])
    } else if (reward.type === 'copies' && reward.plantId) {
      const pId = reward.plantId as PlantId
      const count = reward.copiesCount || 1
      if (!unlockedPlants.includes(pId)) {
        setUnlockedPlants((prev) => [...prev, pId])
      }
      setPlantCopies((prev) => ({
        ...prev,
        [pId]: (prev[pId] || 0) + count,
      }))
    }
  }

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

  // Check timers periodically
  useEffect(() => {
    const timer = setInterval(() => {
      setFreePackSlots((prev) =>
        prev.map((slot) => {
          if (slot.status === 'unlocking' && slot.unlockStartedAt) {
            const totalMs = slot.durationHours * 3600 * 1000
            const elapsedMs = Date.now() - slot.unlockStartedAt
            if (elapsedMs >= totalMs) {
              return { ...slot, status: 'ready' }
            }
          }
          return slot
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const awardVictoryPack = (playerElo: number): { awarded: boolean; durationHours?: 1 | 2 | 4; arenaLevel?: number; isSlotsFull?: boolean } => {
    const arenaObj = getArenaForElo(playerElo)
    const emptyIndex = freePackSlots.findIndex((s) => s.status === 'empty')
    if (emptyIndex === -1) {
      return { awarded: false, isSlotsFull: true }
    }

    const durations: (1 | 2 | 4)[] = [1, 2, 4]
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

    return {
      plantId,
      isNew: dropData.isNew,
      rarityLabel: dropData.rarityLabel as any,
      rarityColor: color,
    }
  }

  // Clan helper methods
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
    setPlantCopies((prev) => ({
      ...prev,
      [plantId]: (prev[plantId] || 0) + 1,
    }))
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

  return {
    userTokens,
    setUserTokens,
    addTokens,
    inventoryPacks,
    unlockedPlants,
    plantCopies,
    plantLevels,
    plantStatRolls,
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
    addPacksToInventory,
  }
}
