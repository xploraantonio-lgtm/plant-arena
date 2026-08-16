import type { PlantId } from '../types/game'
import { PLANT_CONFIGS, type PlantStatKey } from './gameConstants'

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

export function getPlantRarityAndMinPrice(plantId: PlantId): {
  rarity: PlantRarity
  minPrice: number
  color: string
} {
  // Comunes: min 5
  if (['sunflower', 'peashooter', 'wallnut', 'chomper'].includes(plantId)) {
    return { rarity: 'COMÚN', minPrice: 5, color: '#4ade80' }
  }
  // Poco Comunes (PC): min 8
  if (['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash'].includes(plantId)) {
    return { rarity: 'POCO COMÚN', minPrice: 8, color: '#38bdf8' }
  }
  // Raras: min 10
  if (['twinsunflower', 'jalapeno'].includes(plantId)) {
    return { rarity: 'RARA', minPrice: 10, color: '#a855f7' }
  }
  // Épicas: min 15
  if (['aloe', 'tallnut'].includes(plantId)) {
    return { rarity: 'ÉPICA', minPrice: 15, color: '#ec4899' }
  }
  // Legendarias: min 20
  return { rarity: 'LEGENDARIA', minPrice: 20, color: '#fbbf24' }
}

const STORAGE_KEY = 'plant_arena_market_listings'

const INITIAL_MARKET_LISTINGS: MarketListing[] = [
  {
    id: 'list-1',
    sellerName: 'SolarKing_PRO',
    plantId: 'peashooter',
    plantName: 'Peashooter',
    plantIcon: '/game-assets/greenfoot/peashooterpacket1.png',
    level: 2,
    statRolls: ['damage', 'damage'],
    priceUsd: 6.0,
    createdAt: Date.now() - 7200000,
  },
  {
    id: 'list-2',
    sellerName: 'TitanWall_00',
    plantId: 'wallnut',
    plantName: 'Wall-nut',
    plantIcon: '/game-assets/greenfoot/walnutpacket1.png',
    level: 3,
    statRolls: ['hp', 'hp', 'hp'],
    priceUsd: 7.5,
    createdAt: Date.now() - 14400000,
  },
  {
    id: 'list-3',
    sellerName: 'PyroGuisante',
    plantId: 'repeater',
    plantName: 'Repeater',
    plantIcon: '/game-assets/greenfoot/repeaterpacket1.png',
    level: 2,
    statRolls: ['attackSpeed', 'damage'],
    priceUsd: 10.0,
    createdAt: Date.now() - 21600000,
  },
  {
    id: 'list-4',
    sellerName: 'AloeQueen',
    plantId: 'aloe',
    plantName: 'Aloe',
    plantIcon: '/game-assets/greenfoot/aloepacket1.png',
    level: 1,
    statRolls: ['hp'],
    priceUsd: 18.0,
    createdAt: Date.now() - 28800000,
  },
  {
    id: 'list-5',
    sellerName: 'BlizzardKing',
    plantId: 'iceberglettuce',
    plantName: 'Iceberg Lettuce',
    plantIcon: '/game-assets/greenfoot/iceberglettucepacket1.png',
    level: 2,
    statRolls: ['cooldown', 'cooldown'],
    priceUsd: 25.0,
    createdAt: Date.now() - 36000000,
  },
]

export class MarketplaceManager {
  static getListings(): MarketListing[] {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as MarketListing[]
        // Ensure all plant names match the canonical English names from PLANT_CONFIGS
        return parsed.map((item) => ({
          ...item,
          plantName: PLANT_CONFIGS[item.plantId]?.name || item.plantName,
        }))
      } catch (e) {
        console.error('Error parsing market listings', e)
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_MARKET_LISTINGS))
    return INITIAL_MARKET_LISTINGS
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
      id: `mkt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
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
