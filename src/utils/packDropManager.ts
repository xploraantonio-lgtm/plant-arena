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
  priceUsd: number
  cardCount: number
  icon: string
  rarity: 'common' | 'epic' | 'legendary'
}

export const PACK_DEFINITIONS: Record<PackId, PackDefinition> = {
  basic: {
    name: 'Sobre de Semillas Básico',
    priceUsd: 3,
    cardCount: 3,
    icon: '/game-assets/greenfoot/seed_pack_common_whitebg.png',
    rarity: 'common',
  },
  epic: {
    name: 'Sobre de Semillas Místico',
    priceUsd: 5,
    cardCount: 4,
    icon: '/game-assets/greenfoot/seed_pack_epic_whitebg.png',
    rarity: 'epic',
  },
  legendary: {
    name: 'Sobre de Semillas VIP Legendario',
    priceUsd: 10,
    cardCount: 4,
    icon: '/game-assets/greenfoot/seed_pack_legendary_whitebg.png',
    rarity: 'legendary',
  },
}

// 15 Plants categorized strictly by user rarity specifications
const POOL_COMUN: PlantId[] = ['sunflower', 'peashooter', 'wallnut', 'chomper']
const POOL_POCO_COMUN: PlantId[] = ['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash']
const POOL_RARA: PlantId[] = ['twinsunflower', 'jalapeno']
const POOL_EPICA: PlantId[] = ['aloe', 'tallnut']
const POOL_LEGENDARIA: PlantId[] = ['iceberglettuce', 'threepeater']

export function rollSingleCardFromPack(packId: PackId, currentlyUnlocked: PlantId[]): PackDropResult {
  const rand = Math.random() * 100
  let chosenPlant: PlantId
  let rarityLabel: 'COMÚN' | 'POCO COMÚN' | 'RARA' | 'ÉPICA' | 'LEGENDARIA'
  let rarityColor: string

  if (packId === 'basic') {
    // $3 Pack: 60% Common, 30% Uncommon, 8% Rare, 2% Epic, 0% Legendary
    if (rand < 60) {
      chosenPlant = POOL_COMUN[Math.floor(Math.random() * POOL_COMUN.length)]
      rarityLabel = 'COMÚN'
      rarityColor = '#4ade80'
    } else if (rand < 90) {
      chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
      rarityLabel = 'POCO COMÚN'
      rarityColor = '#22d3ee'
    } else if (rand < 98) {
      chosenPlant = POOL_RARA[Math.floor(Math.random() * POOL_RARA.length)]
      rarityLabel = 'RARA'
      rarityColor = '#60a5fa'
    } else {
      chosenPlant = POOL_EPICA[Math.floor(Math.random() * POOL_EPICA.length)]
      rarityLabel = 'ÉPICA'
      rarityColor = '#c084fc'
    }
  } else if (packId === 'epic') {
    // $8 Pack: 20% Common, 45% Uncommon, 25% Rare, 8% Epic, 2% Legendary
    if (rand < 20) {
      chosenPlant = POOL_COMUN[Math.floor(Math.random() * POOL_COMUN.length)]
      rarityLabel = 'COMÚN'
      rarityColor = '#4ade80'
    } else if (rand < 65) {
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
  } else {
    // $10 Pack: 0% Common, 25% Uncommon, 45% Rare, 20% Epic, 10% Legendary
    if (rand < 25) {
      chosenPlant = POOL_POCO_COMUN[Math.floor(Math.random() * POOL_POCO_COMUN.length)]
      rarityLabel = 'POCO COMÚN'
      rarityColor = '#22d3ee'
    } else if (rand < 70) {
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
    results.push(rollSingleCardFromPack(packId, currentlyUnlocked))
  }

  return results
}
