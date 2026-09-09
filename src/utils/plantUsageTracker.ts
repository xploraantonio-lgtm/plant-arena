import type { PlantId } from '../types/game'
import { PLANT_CONFIGS } from './gameConstants'

export const PLANT_USAGE_STORAGE_KEY = 'plant_arena_field_plant_usage'

export interface PlantUsageStats {
  [plantId: string]: number
}

/**
 * Registra en tiempo real cada vez que una planta se coloca con éxito en el campo de batalla.
 */
export function recordPlantPlacement(plantId: PlantId | string): void {
  if (!plantId || typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(PLANT_USAGE_STORAGE_KEY)
    const stats: PlantUsageStats = raw ? JSON.parse(raw) : {}
    stats[plantId] = (stats[plantId] || 0) + 1
    localStorage.setItem(PLANT_USAGE_STORAGE_KEY, JSON.stringify(stats))
  } catch (err) {
    console.error('[PlantUsageTracker] Error al registrar colocación:', err)
  }
}

/**
 * Devuelve el registro histórico de veces que se ha colocado cada planta en el campo.
 */
export function getPlantPlacements(): PlantUsageStats {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(PLANT_USAGE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * Obtiene la planta que el jugador más ha plantado en el campo de batalla.
 *
 * Jerarquía estricta (SIN FALLBACKS ARTIFICIALES NI HASHES):
 * 1. Planta con el mayor conteo histórico de colocaciones reales en combate (> 0).
 * 2. Si aún no ha jugado partidas (0 colocadas), la primera planta de combate de su mazo activo real.
 * 3. Si no tiene mazo configurado, 'peashooter' (planta básica canónica con la que inicia todo jugador).
 */
export function getMostPlantedPlant(): { plantId: PlantId; count: number } {
  const stats = getPlantPlacements()
  let maxCount = 0
  let topPlant: PlantId | null = null

  for (const [id, count] of Object.entries(stats)) {
    if (typeof count === 'number' && count > maxCount && id in PLANT_CONFIGS) {
      maxCount = count
      topPlant = id as PlantId
    }
  }

  if (topPlant && maxCount > 0) {
    return { plantId: topPlant, count: maxCount }
  }

  // Si no ha plantado nada aún en este navegador, revisar su mazo activo real
  try {
    if (typeof window !== 'undefined') {
      const activeDeckRaw = localStorage.getItem('plant_arena_active_deck')
      if (activeDeckRaw) {
        const activeDeck: PlantId[] = JSON.parse(activeDeckRaw)
        if (Array.isArray(activeDeck) && activeDeck.length > 0) {
          // Preferir planta ofensiva sobre productora de sol para reflejar el estilo de juego
          const combatPlant = activeDeck.find(
            (id) => id !== 'sunflower' && id !== 'twinsunflower' && id in PLANT_CONFIGS
          )
          const chosen = combatPlant || activeDeck[0]
          if (chosen && chosen in PLANT_CONFIGS) {
            return { plantId: chosen, count: 0 }
          }
        }
      }
    }
  } catch {}

  // Planta canónica de inicio de todo jugador nuevo en Arena 1
  return { plantId: 'peashooter', count: 0 }
}
