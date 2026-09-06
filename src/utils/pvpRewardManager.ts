import type { PlantId } from '../types/game'

export type FarmingItemId =
  | 'water'
  | 'fertilizer'
  | 'shovel_fragment'
  | 'scarecrow_fragment'
  | 'pesticide'
  | 'shovel'
  | 'scarecrow'

export interface FarmingInventory {
  water: number
  fertilizer: number
  shovel_fragment: number
  scarecrow_fragment: number
  pesticide: number
  shovel: number
  scarecrow: number
}

export const EMPTY_FARMING_INVENTORY: FarmingInventory = {
  water: 0,
  fertilizer: 0,
  shovel_fragment: 0,
  scarecrow_fragment: 0,
  pesticide: 0,
  shovel: 0,
  scarecrow: 0,
}

export const FARMING_ITEM_DEFINITIONS: Record<
  FarmingItemId,
  { label: string; description: string; icon: string; fallback: string }
> = {
  water: {
    label: 'Agua',
    description: 'Recurso básico para regar cultivos.',
    icon: '/game-assets/farming/water.webp',
    fallback: '💧',
  },
  fertilizer: {
    label: 'Fertilizante',
    description: 'Mejora el rendimiento de los cultivos.',
    icon: '/game-assets/farming/fertilizer.webp',
    fallback: '🌱',
  },
  shovel_fragment: {
    label: 'Fragmento de pala',
    description: 'Pieza de crafting de la pala.',
    icon: '/game-assets/farming/shovel_fragment.webp',
    fallback: '🪏',
  },
  scarecrow_fragment: {
    label: 'Frag. espantapájaros',
    description: '30 piezas + 1.000 oro crearán un espantapájaros.',
    icon: '/game-assets/farming/scarecrow_fragment.webp',
    fallback: '🌾',
  },
  pesticide: {
    label: 'Pesticida',
    description: 'Consumible social para expulsar cuervos de parcelas amigas.',
    icon: '/game-assets/farming/pesticide.webp',
    fallback: '🧴',
  },
  shovel: {
    label: 'Pala',
    description: 'Herramienta de farming obtenida mediante crafting.',
    icon: '/game-assets/farming/shovel.webp',
    fallback: '🪏',
  },
  scarecrow: {
    label: 'Espantapájaros',
    description: 'Se equipa a un slot y reduce la aparición de cuervos.',
    icon: '/game-assets/farming/scarecrow.webp',
    fallback: '🌾',
  },
}

export type PvpRewardDrop =
  | {
      type: 'plant'
      plantId: PlantId
      rarity: 'common' | 'uncommon'
      isNew: boolean
      quantity: 1
    }
  | {
      type: 'item'
      itemId: FarmingItemId
      quantity: number
    }
  | {
      type: 'gold'
      quantity: number
    }

export function parseFarmingInventory(raw: unknown): FarmingInventory {
  const parsed = { ...EMPTY_FARMING_INVENTORY }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return parsed

  for (const key of Object.keys(parsed) as FarmingItemId[]) {
    const value = Number((raw as Record<string, unknown>)[key] ?? 0)
    parsed[key] = Number.isInteger(value) && value >= 0 ? value : 0
  }
  return parsed
}
