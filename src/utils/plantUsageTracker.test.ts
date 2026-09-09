import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordPlantPlacement,
  getPlantPlacements,
  getMostPlantedPlant,
} from './plantUsageTracker'

// Mock para entorno Node (Vitest)
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, String(v)),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
}

// Configurar globals para el test
;(globalThis as any).window = globalThis
;(globalThis as any).localStorage = mockLocalStorage

describe('PlantUsageTracker — Contador Real de Plantas en el Campo', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('inicia vacío y devuelve peashooter como planta canónica si no hay datos ni mazo', () => {
    const top = getMostPlantedPlant()
    expect(top.plantId).toBe('peashooter')
    expect(top.count).toBe(0)
  })

  it('si no hay partidas jugadas pero hay mazo activo, elige la planta de combate del mazo', () => {
    mockLocalStorage.setItem('plant_arena_active_deck', JSON.stringify(['sunflower', 'repeater', 'wallnut']))
    const top = getMostPlantedPlant()
    expect(top.plantId).toBe('repeater')
    expect(top.count).toBe(0)
  })

  it('registra colocaciones reales en el campo y determina la planta con mayor conteo', () => {
    recordPlantPlacement('sunflower')
    recordPlantPlacement('sunflower')
    recordPlantPlacement('peashooter')
    recordPlantPlacement('peashooter')
    recordPlantPlacement('peashooter')
    recordPlantPlacement('wallnut')

    const placements = getPlantPlacements()
    expect(placements.sunflower).toBe(2)
    expect(placements.peashooter).toBe(3)
    expect(placements.wallnut).toBe(1)

    const top = getMostPlantedPlant()
    expect(top.plantId).toBe('peashooter')
    expect(top.count).toBe(3)
  })

  it('actualiza la planta más usada cuando otra planta supera el conteo', () => {
    recordPlantPlacement('peashooter')
    recordPlantPlacement('bonkchoy')
    recordPlantPlacement('bonkchoy')

    const top = getMostPlantedPlant()
    expect(top.plantId).toBe('bonkchoy')
    expect(top.count).toBe(2)
  })

  it('ignora identificadores de plantas inválidas y maneja fallos con gracia', () => {
    recordPlantPlacement('')
    recordPlantPlacement('non_existent_plant_xyz')

    const stats = getPlantPlacements()
    expect(stats['']).toBeUndefined()
    expect(stats.non_existent_plant_xyz).toBe(1)

    // Al calcular topPlant, sólo toma en cuenta plantas que existen en PLANT_CONFIGS
    const top = getMostPlantedPlant()
    expect(top.plantId).toBe('peashooter')
  })
})
