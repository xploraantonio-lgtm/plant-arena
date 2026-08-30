import type { PlantId } from '../types/game'

export interface FreePackSlot {
  slotId: number // 0, 1, 2, 3
  status: 'empty' | 'locked' | 'unlocking' | 'ready'
  durationHours: 2 | 4 | 8 | 12
  unlockStartedAt?: number // Timestamp ms
  arenaLevel: number // 1, 2, 3, 4, 5
}

export interface PlayerRewardPack {
  id: string
  status: 'pending' | 'unlocking' | 'ready'
  durationHours?: number
  arenaLevel: number
  unlockStartedAt?: number // Timestamp ms
  createdAt: number
}

export function createEmptySlots(): FreePackSlot[] {
  return [
    { slotId: 0, status: 'empty', durationHours: 2, arenaLevel: 1 },
    { slotId: 1, status: 'empty', durationHours: 4, arenaLevel: 1 },
    { slotId: 2, status: 'empty', durationHours: 8, arenaLevel: 1 },
    { slotId: 3, status: 'empty', durationHours: 12, arenaLevel: 1 },
  ]
}

// Draw 1 card according to Arena level rules
export function drawFreePackCard(arenaLevel: number, unlockedPlants: PlantId[] = []): { plantId: PlantId; rarityLabel: string; isNew: boolean } {
  const poolComun: PlantId[] = ['sunflower', 'peashooter', 'wallnut', 'chomper']
  const poolPocoComun: PlantId[] = ['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash']
  const poolRara: PlantId[] = ['twinsunflower', 'jalapeno']
  const poolEpica: PlantId[] = ['aloe', 'tallnut']

  const rand = Math.random() * 100
  let chosenPool: PlantId[] = poolComun
  let rarityLabel = 'COMÚN'

  if (arenaLevel === 1) {
    // 50% Común, 50% Poco Común
    if (rand < 50) {
      chosenPool = poolComun
      rarityLabel = 'COMÚN'
    } else {
      chosenPool = poolPocoComun
      rarityLabel = 'POCO COMÚN'
    }
  } else if (arenaLevel === 2) {
    // 40% Común, 45% Poco Común, 15% Rara
    if (rand < 40) {
      chosenPool = poolComun
      rarityLabel = 'COMÚN'
    } else if (rand < 85) {
      chosenPool = poolPocoComun
      rarityLabel = 'POCO COMÚN'
    } else {
      chosenPool = poolRara
      rarityLabel = 'RARA'
    }
  } else if (arenaLevel === 3) {
    // 50% Poco Común, 50% Rara
    if (rand < 50) {
      chosenPool = poolPocoComun
      rarityLabel = 'POCO COMÚN'
    } else {
      chosenPool = poolRara
      rarityLabel = 'RARA'
    }
  } else if (arenaLevel === 4) {
    // 100% Rara
    chosenPool = poolRara
    rarityLabel = 'RARA'
  } else {
    // Arena 5: 95% Rara, 5% Épica
    if (rand < 95) {
      chosenPool = poolRara
      rarityLabel = 'RARA'
    } else {
      chosenPool = poolEpica
      rarityLabel = 'ÉPICA'
    }
  }

  const selectedPlantId = chosenPool[Math.floor(Math.random() * chosenPool.length)]
  const isNew = !unlockedPlants.includes(selectedPlantId)

  return {
    plantId: selectedPlantId,
    rarityLabel,
    isNew,
  }
}

// Calculate formatted remaining time string
export function getRemainingTimeString(slot: FreePackSlot): string {
  if (slot.status !== 'unlocking' || !slot.unlockStartedAt) {
    return `${slot.durationHours}h`
  }

  const totalMs = slot.durationHours * 3600 * 1000
  const elapsedMs = Date.now() - slot.unlockStartedAt
  const remainingMs = Math.max(0, totalMs - elapsedMs)

  if (remainingMs <= 0) {
    return '¡LISTO!'
  }

  const totalSec = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m ${secs}s`
}

/**
 * Calculates the Gold coin cost to unlock a chest slot immediately based on remaining time.
 * Scaled rate: 75 Gold per hour remaining (~1.25 Gold per minute, min 10 Gold).
 * - 2h pack = 150 Gold
 * - 4h pack = 300 Gold
 * - 8h pack = 600 Gold
 * - 12h pack = 900 Gold
 */
export function calculateInstantUnlockGoldCost(slot: FreePackSlot): number {
  if (slot.status === 'ready') return 0

  let remainingHours = slot.durationHours
  if (slot.status === 'unlocking' && slot.unlockStartedAt) {
    const totalMs = slot.durationHours * 3600 * 1000
    const elapsedMs = Date.now() - slot.unlockStartedAt
    const remainingMs = Math.max(0, totalMs - elapsedMs)
    remainingHours = remainingMs / (3600 * 1000)
  }

  // 75 Gold per hour remaining, rounded up, minimum 10 Gold
  return Math.max(10, Math.ceil(remainingHours * 75))
}
