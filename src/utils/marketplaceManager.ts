import type { PlantId } from '../types/game'
import { PLANT_CONFIGS, type PlantStatKey } from './gameConstants'

import type { FarmingItemId } from './pvpRewardManager'

export interface MarketListing {
  id: string
  sellerName: string
  plantId: PlantId
  plantName: string
  plantIcon: string
  level: number
  statRolls: PlantStatKey[]
  priceUsd: number
  createdAt: number
}

export type PlantRarity = 'COMÚN' | 'POCO COMÚN' | 'RARA' | 'ÉPICA' | 'LEGENDARIA'

export const FARMING_ITEM_MIN_PRICES: Record<FarmingItemId, number> = {
  water: 100,
  fertilizer: 200,
  shovel_fragment: 250,
  pesticide: 250,
  scarecrow_fragment: 500,
  shovel: 800,
  scarecrow: 1200,
}

export function getFarmingItemMinPrice(itemId: FarmingItemId): number {
  return FARMING_ITEM_MIN_PRICES[itemId] ?? 100
}

export function getPlantRarityAndMinPrice(plantId: PlantId): {
  rarity: PlantRarity
  minPrice: number
  color: string
} {
  // Comunes: min 500 gemas
  if (['sunflower', 'peashooter', 'wallnut', 'chomper'].includes(plantId)) {
    return { rarity: 'COMÚN', minPrice: 500, color: '#4ade80' }
  }
  // Poco Comunes (PC): min 800 gemas
  if (['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash'].includes(plantId)) {
    return { rarity: 'POCO COMÚN', minPrice: 800, color: '#38bdf8' }
  }
  // Raras: min 1000 gemas
  if (['twinsunflower', 'jalapeno'].includes(plantId)) {
    return { rarity: 'RARA', minPrice: 1000, color: '#a855f7' }
  }
  // Épicas: min 1500 gemas
  if (['aloe', 'tallnut'].includes(plantId)) {
    return { rarity: 'ÉPICA', minPrice: 1500, color: '#ec4899' }
  }
  // Legendarias: min 2000 gemas
  return { rarity: 'LEGENDARIA', minPrice: 2000, color: '#fbbf24' }
}

const STORAGE_KEY = 'plant_arena_market_listings'

export class MarketplaceManager {
  static getListings(): MarketListing[] {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as MarketListing[]
        return parsed.map((item) => ({
          ...item,
          plantName: PLANT_CONFIGS[item.plantId]?.name || item.plantName,
        }))
      } catch (e) {
        console.error('Error parsing market listings', e)
      }
    }
    return []
  }

  static saveListings(listings: MarketListing[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(listings))
  }

  static createListing(
    sellerName: string,
    plantId: PlantId,
    plantName: string,
    plantIcon: string,
    level: number,
    statRolls: PlantStatKey[],
    priceUsd: number
  ): MarketListing {
    const listings = this.getListings()
    const newListing: MarketListing = {
      id: `mkt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sellerName,
      plantId,
      plantName,
      plantIcon,
      level,
      statRolls,
      priceUsd,
      createdAt: Date.now(),
    }
    listings.unshift(newListing)
    this.saveListings(listings)
    return newListing
  }

  static buyListing(listingId: string): MarketListing | null {
    const listings = this.getListings()
    const index = listings.findIndex((l) => l.id === listingId)
    if (index === -1) return null

    const [bought] = listings.splice(index, 1)
    this.saveListings(listings)
    return bought
  }

  static cancelListing(listingId: string, sellerName: string): boolean {
    const listings = this.getListings()
    const index = listings.findIndex((l) => l.id === listingId && l.sellerName === sellerName)
    if (index === -1) return false

    listings.splice(index, 1)
    this.saveListings(listings)
    return true
  }
}
