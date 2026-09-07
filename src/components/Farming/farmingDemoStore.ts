export type FarmingDemoRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type FarmingDemoCropStage = 'seeded' | 'watered' | 'fertilized'

export type FarmingDemoRental = {
  landKey: string
  slot: number
  days: 7 | 15 | 30
  expiresAt: number
}

export type FarmingDemoCrop = {
  landKey: string
  slot: number
  stage: FarmingDemoCropStage
  plantedAt: number
}

export type FarmingDemoState = {
  gems: number
  gold: number
  seeds: number
  water: number
  fertilizer: number
  pesticide: number
  ownedLands: string[]
  rentals: Record<string, FarmingDemoRental>
  crops: Record<string, FarmingDemoCrop>
}

const STORAGE_KEY = 'plant-arena-farming-demo-v2'

export const DEFAULT_FARMING_DEMO_STATE: FarmingDemoState = {
  gems: 2500,
  gold: 3000,
  seeds: 2,
  water: 12,
  fertilizer: 4,
  pesticide: 2,
  ownedLands: [],
  rentals: {},
  crops: {},
}

export function farmingLandKey(rarity: FarmingDemoRarity, landNumber: number) {
  return `${rarity}:${landNumber}`
}

export function farmingSlotKey(landKey: string, slot: number) {
  return `${landKey}:${slot}`
}

export function loadFarmingDemoState(): FarmingDemoState {
  if (typeof window === 'undefined') return DEFAULT_FARMING_DEMO_STATE

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FARMING_DEMO_STATE }

    const parsed = JSON.parse(raw) as Partial<FarmingDemoState>
    return {
      ...DEFAULT_FARMING_DEMO_STATE,
      ...parsed,
      ownedLands: Array.isArray(parsed.ownedLands) ? parsed.ownedLands : [],
      rentals: parsed.rentals ?? {},
      crops: parsed.crops ?? {},
    }
  } catch {
    return { ...DEFAULT_FARMING_DEMO_STATE }
  }
}

export function saveFarmingDemoState(state: FarmingDemoState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('farming-demo-updated'))
}

export function updateFarmingDemoState(
  updater: (state: FarmingDemoState) => FarmingDemoState
) {
  const next = updater(loadFarmingDemoState())
  saveFarmingDemoState(next)
  return next
}

export function resetFarmingDemoState() {
  const next = { ...DEFAULT_FARMING_DEMO_STATE, ownedLands: [], rentals: {}, crops: {} }
  saveFarmingDemoState(next)
  return next
}
