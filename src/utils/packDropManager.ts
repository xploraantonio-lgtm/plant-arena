import type { PlantId } from '../types/game'

export type PackId = 'basic' | 'epic' | 'legendary'

export interface InventoryPack {
  instanceId: string
  packId: PackId
  name: string
  icon: string
  rarity: 'common' | 'epic' | 'legendary'
  purchasedAt: number
}

export interface PackDropResult {
  plantId: PlantId
  rarityLabel: 'COMÚN' | 'POCO COMÚN' | 'RARA' | 'ÉPICA' | 'LEGENDARIA'
  rarityColor: string
  isNew: boolean
}

export interface PackDefinition {
  name: string
  priceGems: number
  priceUsd?: number
  cardCount: number
  icon: string
  rarity: 'common' | 'epic' | 'legendary'
}

export const PACK_DEFINITIONS: Record<PackId, PackDefinition> = {
  basic: {
    name: 'Sobre de Semillas Básico',
    priceGems: 300,
    priceUsd: 300,
    cardCount: 3,
    icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp',
    rarity: 'common',
  },
  epic: {
    name: 'Sobre de Semillas Místico',
    priceGems: 1000,
    priceUsd: 1000,
    cardCount: 4,
    icon: '/game-assets/greenfoot/seed_pack_epic_whitebg.webp',
    rarity: 'epic',
  },
  legendary: {
    name: 'Sobre de Semillas VIP Legendario',
    priceGems: 2500,
    priceUsd: 2500,
    cardCount: 4,
    icon: '/game-assets/greenfoot/seed_pack_legendary_whitebg.webp',
    rarity: 'legendary',
  },
}

// 15 Plants categorized strictly by user rarity specifications
const POOL_COMUN: PlantId[] = ['sunflower', 'peashooter', 'wallnut', 'chomper']
const POOL_POCO_COMUN: PlantId[] = ['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash']
const POOL_RARA: PlantId[] = ['twinsunflower']
const POOL_EPICA: PlantId[] = ['aloe', 'tallnut']
const POOL_LEGENDARIA: PlantId[] = ['iceberglettuce', 'threepeater']

export function rollSingleCardFromPack(
  packId: PackId,
  currentlyUnlocked: PlantId[],
  isLuckySlot: boolean = false
): PackDropResult {
  const rand = Math.random() * 100
  let chosenPlant: PlantId
  let rarityLabel: 'COMÚN' | 'POCO COMÚN' | 'RARA' | 'ÉPICA' | 'LEGENDARIA'
  let rarityColor: string

  if (packId === 'basic') {
    // 3 Cartas en total: 2 de soporte + 1 destacada (10% Rara en el sobre)
    if (!isLuckySlot) {
      if (rand < 75) {
        chosenPlant = POOL_COMUN[Math.floor(Math.random() * POOL_COMUN.length)]
        rarityLabel = 'COMÚN'
        rarityColor = '#4ade80'
      } else {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      }
    } else {
      // Carta Destacada: 60% Común, 30% Poco Común, 10% Rara
      if (rand < 60) {
        chosenPlant = POOL_COMUN[Math.floor(Math.random() * POOL_COMUN.length)]
        rarityLabel = 'COMÚN'
        rarityColor = '#4ade80'
      } else if (rand < 90) {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      } else {
        chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
        rarityLabel = 'RARA'
        rarityColor = '#60a5fa'
      }
    }
  } else if (packId === 'epic') {
    // 4 Cartas en total: 3 de soporte + 1 destacada (8% Épica, 2% Legendaria en el sobre)
    if (!isLuckySlot) {
      if (rand < 40) {
        chosenPlant = POOL_COMUN[Math.floor(Math.random() * POOL_COMUN.length)]
        rarityLabel = 'COMÚN'
        rarityColor = '#4ade80'
      } else if (rand < 90) {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      } else {
        chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
        rarityLabel = 'RARA'
        rarityColor = '#60a5fa'
      }
    } else {
      // Carta Destacada: 60% Poco Común, 30% Rara, 8% Épica, 2% Legendaria
      if (rand < 60) {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      } else if (rand < 90) {
        chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
        rarityLabel = 'RARA'
        rarityColor = '#60a5fa'
      } else if (rand < 98) {
        chosenPlant = POOL_EPICA[Math.floor(Math.random() * POOL_EPICA.length)]
        rarityLabel = 'ÉPICA'
        rarityColor = '#c084fc'
      } else {
        chosenPlant = POOL_LEGENDARIA[Math.floor(Math.random() * POOL_LEGENDARIA.length)]
        rarityLabel = 'LEGENDARIA'
        rarityColor = '#fbbf24'
      }
    }
  } else {
    // 4 Cartas en total: 3 de soporte + 1 destacada (10% Legendaria en el sobre, CERO duplicadas)
    if (!isLuckySlot) {
      // Soporte: 0% Común, 50% Poco Común, 40% Rara, 10% Épica (0% Legendaria)
      if (rand < 50) {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      } else if (rand < 90) {
        chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
        rarityLabel = 'RARA'
        rarityColor = '#60a5fa'
      } else {
        chosenPlant = POOL_EPICA[Math.floor(Math.random() * POOL_EPICA.length)]
        rarityLabel = 'ÉPICA'
        rarityColor = '#c084fc'
      }
    } else {
      // Carta Destacada Jackpot: 20% Poco Común, 40% Rara, 30% Épica, 10% Legendaria
      if (rand < 20) {
        chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
        rarityLabel = 'POCO COMÚN'
        rarityColor = '#22d3ee'
      } else if (rand < 60) {
        chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
        rarityLabel = 'RARA'
        rarityColor = '#60a5fa'
      } else if (rand < 90) {
        chosenPlant = POOL_EPICA[Math.floor(Math.random() * POOL_EPICA.length)]
        rarityLabel = 'ÉPICA'
        rarityColor = '#c084fc'
      } else {
        chosenPlant = POOL_LEGENDARIA[Math.floor(Math.random() * POOL_LEGENDARIA.length)]
        rarityLabel = 'LEGENDARIA'
        rarityColor = '#fbbf24'
      }
    }
  }

  const isNew = !currentlyUnlocked.includes(chosenPlant)

  return {
    plantId: chosenPlant,
    rarityLabel,
    rarityColor,
    isNew,
  }
}

export function openSeedPack(packId: PackId, currentlyUnlocked: PlantId[]): PackDropResult[] {
  const packDef = PACK_DEFINITIONS[packId]
  const count = packDef ? packDef.cardCount : 3
  const results: PackDropResult[] = []

  for (let i = 0; i < count; i++) {
    const isLuckySlot = i === count - 1
    results.push(rollSingleCardFromPack(packId, currentlyUnlocked, isLuckySlot))
  }

  return results
}
