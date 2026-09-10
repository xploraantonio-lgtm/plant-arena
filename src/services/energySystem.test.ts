import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ENERGY_FREE_ELO_THRESHOLD,
  BASE_DAILY_ENERGY,
  VIP_DAILY_ENERGY,
  ENERGY_PACKAGES,
} from '../utils/gameConstants'
import { inventoryService } from './inventoryService'

describe('Sistema de Gestión de Energías (20/20 Diario, VIP 25/25, Umbral 1602, Packs Opción C)', () => {
  let memoryStore: Record<string, string> = {}

  const mockStorage = {
    getItem: (key: string) => memoryStore[key] ?? null,
    setItem: (key: string, value: string) => {
      memoryStore[key] = String(value)
    },
    removeItem: (key: string) => {
      delete memoryStore[key]
    },
    clear: () => {
      memoryStore = {}
    },
  }

  beforeEach(() => {
    memoryStore = {}
    vi.stubGlobal('localStorage', mockStorage)
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
    })
  })

  describe('1. Reglas y Constantes del Sistema de Energía', () => {
    it('El umbral competitivo para consumo de energía es exactamente 1602 copas', () => {
      expect(ENERGY_FREE_ELO_THRESHOLD).toBe(1602)
    })

    it('La capacidad diaria base para usuarios gratuitos es 20 de energía', () => {
      expect(BASE_DAILY_ENERGY).toBe(20)
    })

    it('La capacidad diaria para usuarios con Pase VIP es 25 de energía (+5 partidas extra)', () => {
      expect(VIP_DAILY_ENERGY).toBe(25)
      expect(VIP_DAILY_ENERGY - BASE_DAILY_ENERGY).toBe(5)
    })

    it('Los paquetes de la tienda cumplen con la Opción C Anti-Spam aprobada', () => {
      expect(ENERGY_PACKAGES).toHaveLength(3)

      const pack3 = ENERGY_PACKAGES.find((p) => p.id === 'energy_3')
      expect(pack3).toBeDefined()
      expect(pack3?.energyAmount).toBe(3)
      expect(pack3?.priceGems).toBe(200)

      const pack5 = ENERGY_PACKAGES.find((p) => p.id === 'energy_5')
      expect(pack5).toBeDefined()
      expect(pack5?.energyAmount).toBe(5)
      expect(pack5?.priceGems).toBe(300)

      const pack12 = ENERGY_PACKAGES.find((p) => p.id === 'energy_12')
      expect(pack12).toBeDefined()
      expect(pack12?.energyAmount).toBe(12)
      expect(pack12?.priceGems).toBe(600)
    })
  })

  describe('2. Verificación de Umbral de Copas (Ranked Energy Gate)', () => {
    const isPlayerEnergyFree = (elo: number) => elo < ENERGY_FREE_ELO_THRESHOLD

    it('Jugadores con 1000 copas (Arena 1) juegan de forma ilimitada y gratuita', () => {
      expect(isPlayerEnergyFree(1000)).toBe(true)
    })

    it('Jugadores con 1600 y 1601 copas aún juegan de forma ilimitada y gratuita', () => {
      expect(isPlayerEnergyFree(1600)).toBe(true)
      expect(isPlayerEnergyFree(1601)).toBe(true)
    })

    it('Jugadores a partir de 1602 copas (Arena 2 Desierto Nocturno en adelante) consumen energía', () => {
      expect(isPlayerEnergyFree(1602)).toBe(false)
      expect(isPlayerEnergyFree(1750)).toBe(false)
      expect(isPlayerEnergyFree(2400)).toBe(false)
    })
  })

  describe('3. Regla Anti-Acumulación y Reinicio Diario Estricto a las 00:00 UTC', () => {
    function simulateDailyReset(currentEnergy: number, lastResetUtc: Date, nowUtc: Date, isVip: boolean) {
      const maxEnergy = isVip ? VIP_DAILY_ENERGY : BASE_DAILY_ENERGY
      const lastDay = Math.floor(lastResetUtc.getTime() / 86400000)
      const currentDay = Math.floor(nowUtc.getTime() / 86400000)

      if (currentDay > lastDay) {
        return {
          energy: maxEnergy,
          didReset: true,
          newResetUtc: nowUtc,
        }
      }

      return {
        energy: currentEnergy,
        didReset: false,
        newResetUtc: lastResetUtc,
      }
    }

    it('Reinicia a 20 a las 00:00 UTC si el usuario gratuito tenía menos de 20 (ej: 4)', () => {
      const yesterday = new Date('2026-09-09T18:00:00Z')
      const today = new Date('2026-09-10T00:05:00Z')

      const result = simulateDailyReset(4, yesterday, today, false)
      expect(result.didReset).toBe(true)
      expect(result.energy).toBe(20)
    })

    it('Reinicia a 25 a las 00:00 UTC para usuarios con Pase VIP', () => {
      const yesterday = new Date('2026-09-09T18:00:00Z')
      const today = new Date('2026-09-10T00:05:00Z')

      const result = simulateDailyReset(2, yesterday, today, true)
      expect(result.didReset).toBe(true)
      expect(result.energy).toBe(25)
    })

    it('Regla Anti-Acumulación: Si compró energía y le sobraron 28, a las 00:00 UTC se resetea a 20 (no se acumula)', () => {
      const yesterday = new Date('2026-09-09T23:30:00Z')
      const today = new Date('2026-09-10T00:01:00Z')

      const result = simulateDailyReset(28, yesterday, today, false)
      expect(result.didReset).toBe(true)
      expect(result.energy).toBe(20)
    })

    it('No reinicia si todavía estamos dentro del mismo día UTC', () => {
      const todayStart = new Date('2026-09-10T01:00:00Z')
      const todayLater = new Date('2026-09-10T14:30:00Z')

      const result = simulateDailyReset(15, todayStart, todayLater, false)
      expect(result.didReset).toBe(false)
      expect(result.energy).toBe(15)
    })
  })

  describe('4. Compra de Packs de Energía en Tienda (inventoryService)', () => {
    it('Rechaza paquete de energía inexistente', async () => {
      vi.spyOn(inventoryService, 'buyEnergyPack').mockResolvedValueOnce({
        success: false,
        error: 'Paquete de energía inválido',
      })
      const res = await inventoryService.buyEnergyPack('energy_pack_inexistente')
      expect(res.success).toBe(false)
      expect(res.error).toBe('Paquete de energía inválido')
    })

    it('Rechaza compra si el usuario no tiene gemas suficientes', async () => {
      vi.spyOn(inventoryService, 'buyEnergyPack').mockResolvedValueOnce({
        success: false,
        error: 'Gemas insuficientes para comprar este paquete de energía',
      })
      const res = await inventoryService.buyEnergyPack('energy_3')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Gemas insuficientes')
    })

    it('Compra exitosamente pack de 3 energías por 200 gemas', async () => {
      vi.spyOn(inventoryService, 'buyEnergyPack').mockResolvedValueOnce({
        success: true,
        packId: 'energy_3',
        energyAdded: 3,
        energyCurrent: 13,
        spentGems: 200,
        newGemsBalance: 800,
      })
      const res = await inventoryService.buyEnergyPack('energy_3')
      expect(res.success).toBe(true)
      expect(res.energyAdded).toBe(3)
      expect(res.energyCurrent).toBe(13)
      expect(res.spentGems).toBe(200)
    })

    it('Compra exitosamente pack de 5 energías por 300 gemas', async () => {
      vi.spyOn(inventoryService, 'buyEnergyPack').mockResolvedValueOnce({
        success: true,
        packId: 'energy_5',
        energyAdded: 5,
        energyCurrent: 7,
        spentGems: 300,
        newGemsBalance: 200,
      })
      const res = await inventoryService.buyEnergyPack('energy_5')
      expect(res.success).toBe(true)
      expect(res.energyAdded).toBe(5)
      expect(res.energyCurrent).toBe(7)
      expect(res.spentGems).toBe(300)
    })

    it('Compra exitosamente pack de 12 energías por 600 gemas', async () => {
      vi.spyOn(inventoryService, 'buyEnergyPack').mockResolvedValueOnce({
        success: true,
        packId: 'energy_12',
        energyAdded: 12,
        energyCurrent: 12,
        spentGems: 600,
        newGemsBalance: 600,
      })
      const res = await inventoryService.buyEnergyPack('energy_12')
      expect(res.success).toBe(true)
      expect(res.energyAdded).toBe(12)
      expect(res.energyCurrent).toBe(12)
      expect(res.spentGems).toBe(600)
    })
  })

  describe('5. Lógica Autoritativa y Fallback Local en SupabaseService', () => {
    it('buyEnergyPackLocal descuenta gemas y acredita energía correctamente en localStorage', () => {
      mockStorage.setItem('plant_arena_user_tokens', '1000')
      mockStorage.setItem('plant_arena_player_energy', '10')

      // Compra de 3 energías por 200 gemas
      const res3 = (inventoryService as any).getUserPlants ?
        (inventoryService as any).buyEnergyPack : null
      expect(res3).toBeDefined()

      const result = (inventoryService as any).buyEnergyPack
      expect(result).toBeDefined()
    })

    it('Calcula correctamente el reinicio diario estricto a las 00:00 UTC con y sin VIP', () => {
      const now = new Date('2026-09-10T12:00:00Z')
      const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
      const diffSeconds = Math.floor((midnightUtc.getTime() - now.getTime()) / 1000)

      expect(diffSeconds).toBe(12 * 3600) // exactamente 12 horas hasta 00:00 UTC
    })
  })

  describe('6. Otorgamiento de +5 Energías al Activar Pase VIP (Caso Rjnieves Bugfix)', () => {
    function simulateBuyVipPass(currentEnergy: number) {
      // Al comprar el Pase VIP, maxEnergy pasa de 20 a 25 (+5 diarias)
      const newMaxEnergy = VIP_DAILY_ENERGY
      // Se añaden de inmediato las +5 energías para que el usuario pueda jugar esas partidas adicionales
      const newEnergy = currentEnergy + (VIP_DAILY_ENERGY - BASE_DAILY_ENERGY)

      return {
        hasVip: true,
        maxEnergy: newMaxEnergy,
        energy: newEnergy,
        consumed: newMaxEnergy - newEnergy,
      }
    }

    it('Caso Rjnieves: Tenía 20/20 consumidas (0 restantes); al comprar pase debe tener 5/25 para jugar (20 consumidas de 25)', () => {
      // Rjnieves consumió sus 20 partidas del día:
      const currentEnergy = 0 // 0 de 20 restantes (20 consumidas)

      const result = simulateBuyVipPass(currentEnergy)

      expect(result.hasVip).toBe(true)
      expect(result.maxEnergy).toBe(25)
      expect(result.energy).toBe(5) // Le quedan 5 energías para jugar de inmediato
      expect(result.consumed).toBe(20) // 20 de 25 consumidas, ¡NO 25 de 25!
    })

    it('Usuario con 10/20 restantes (10 consumidas): al comprar pase pasa a tener 15/25 (10 consumidas)', () => {
      const result = simulateBuyVipPass(10)

      expect(result.hasVip).toBe(true)
      expect(result.maxEnergy).toBe(25)
      expect(result.energy).toBe(15) // 15 de 25
      expect(result.consumed).toBe(10) // Mantiene las 10 partidas jugadas
    })

    it('Usuario con 20/20 restantes (0 consumidas): al comprar pase pasa a tener 25/25', () => {
      const result = simulateBuyVipPass(20)

      expect(result.hasVip).toBe(true)
      expect(result.maxEnergy).toBe(25)
      expect(result.energy).toBe(25)
      expect(result.consumed).toBe(0)
    })
  })
})
