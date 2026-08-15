import type { PlantId } from '../types/game'
import type { PlantStatKey } from './gameConstants'

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

const STORAGE_KEY = 'plant_arena_market_listings'

const INITIAL_MARKET_LISTINGS: MarketListing[] = [
  {
    id: 'list-1',
    sellerName: 'SolarKing_PRO',
    plantId: 'peashooter',
    plantName: 'Lanza-guisantes',
    plantIcon: '/game-assets/greenfoot/peashooterpacket1.png',
    level: 2,
    statRolls: ['damage', 'damage'],
    priceUsd: 3.5,
    createdAt: Date.now() - 7200000,
  },
  {
    id: 'list-2',
    sellerName: 'TitanWall_00',
    plantId: 'wallnut',
    plantName: 'Nuez Muralla',
    plantIcon: '/game-assets/greenfoot/walnutpacket1.png',
    level: 3,
    statRolls: ['hp', 'hp', 'hp'],
    priceUsd: 5.0,
    createdAt: Date.now() - 14400000,
  },
  {
    id: 'list-3',
    sellerName: 'PyroGuisante',
    plantId: 'repeater',
    plantName: 'Repetidora',
    plantIcon: '/game-assets/greenfoot/repeaterpacket1.png',
    level: 2,
    statRolls: ['attackSpeed', 'damage'],
    priceUsd: 4.0,
    createdAt: Date.now() - 21600000,
  },
  {
    id: 'list-4',
    sellerName: 'AloeQueen',
    plantId: 'aloe',
    plantName: 'Aloe Curativa',
    plantIcon: '/game-assets/greenfoot/aloepacket1.png',
    level: 1,
    statRolls: ['hp'],
    priceUsd: 2.0,
    createdAt: Date.now() - 28800000,
  },
  {
    id: 'list-5',
    sellerName: 'BlizzardKing',
    plantId: 'iceberglettuce',
    plantName: 'Lechuga Iceberg',
    plantIcon: '/game-assets/greenfoot/iceberglettucepacket1.png',
    level: 2,
    statRolls: ['cooldown', 'cooldown'],
    priceUsd: 3.0,
    createdAt: Date.now() - 36000000,
  },
]

export class MarketplaceManager {
  static getListings(): MarketListing[] {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        return JSON.parse(saved)
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
