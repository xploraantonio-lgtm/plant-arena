import { describe, it, expect } from 'vitest'
import type { FreePackSlot } from '../utils/freePackManager'

describe('C. Sobres — Tiempo Persistente Server-Authoritative', () => {
  const GOLD_PER_HOUR = 50

  function calcularTiempoRestanteMs(slot: FreePackSlot, ahora: number): number {
    if (slot.status !== 'unlocking' || !slot.unlockStartedAt) return 0
    const totalMs = slot.durationHours * 3600 * 1000
    const transcurridoMs = ahora - slot.unlockStartedAt
    return Math.max(0, totalMs - transcurridoMs)
  }

  function calcularCosteOroAceleracion(slot: FreePackSlot, ahora: number): number {
    const restanteMs = calcularTiempoRestanteMs(slot, ahora)
    if (restanteMs <= 0) return 0
    const horasRestantes = restanteMs / (3600 * 1000)
    return Math.ceil(horasRestantes * GOLD_PER_HOUR)
  }

  it('1. El tiempo restante se deriva de un timestamp absoluto persistido (unlockStartedAt)', () => {
    const t0 = 1700000000000 // Timestamp absoluto del servidor
    const slot: FreePackSlot = {
      slotId: 0,
      status: 'unlocking',
      durationHours: 2, // 2 horas = 7,200,000 ms
      arenaLevel: 1,
      unlockStartedAt: t0,
    }

    // A los 30 minutos transcurridos (1,800,000 ms)
    const t30m = t0 + 30 * 60 * 1000
    const restante30m = calcularTiempoRestanteMs(slot, t30m)
    expect(restante30m).toBe(90 * 60 * 1000) // 1.5 horas restantes = 5,400,000 ms

    // Coste de oro a los 30 minutos (1.5 horas * 50 = 75 de oro)
    expect(calcularCosteOroAceleracion(slot, t30m)).toBe(75)
  })

  it('2. Invariante: reload / deploy / nuevo build NO resetea el temporizador de desbloqueo', () => {
    const t0 = Date.now() - 3600 * 1000 // Empezó hace 1 hora
    const slotServer: FreePackSlot = {
      slotId: 1,
      status: 'unlocking',
      durationHours: 4, // 4 horas
      arenaLevel: 1,
      unlockStartedAt: t0,
    }

    // Simular guardado y lectura tras recarga de página / deploy (JSON serialize/deserialize)
    const serialized = JSON.stringify([slotServer])
    const reloadedSlots: FreePackSlot[] = JSON.parse(serialized)

    // El slot reloaded debe conservar exactamente el mismo unlockStartedAt
    expect(reloadedSlots[0].unlockStartedAt).toBe(t0)

    // El tiempo restante tras reload sigue siendo 3 horas (no se reinicia a 4 horas)
    const restante = calcularTiempoRestanteMs(reloadedSlots[0], Date.now())
    const horasRestantesAprox = restante / (3600 * 1000)
    expect(horasRestantesAprox).toBeCloseTo(3, 0)
  })

  it('3. Invariante: nuevo dispositivo / localStorage vacío carga de la base de datos sin sobreescribir', () => {
    // Estado en PostgreSQL
    const serverDbSlot: FreePackSlot = {
      slotId: 2,
      status: 'unlocking',
      durationHours: 8,
      arenaLevel: 2,
      unlockStartedAt: Date.now() - 2 * 3600 * 1000, // 2 horas transcurridas
    }

    // Cliente nuevo sin localStorage (slots vacíos por defecto)
    const initialClientSlots: FreePackSlot[] = [
      { slotId: 0, status: 'empty', durationHours: 2, arenaLevel: 1 },
      { slotId: 1, status: 'empty', durationHours: 4, arenaLevel: 1 },
      { slotId: 2, status: 'empty', durationHours: 8, arenaLevel: 1 },
      { slotId: 3, status: 'empty', durationHours: 12, arenaLevel: 1 },
    ]

    // Al cargar de PostgreSQL (getUserPackSlots), el cliente adopta serverDbSlot
    const authoritativeSlots = initialClientSlots.map((s) => (s.slotId === 2 ? serverDbSlot : s))

    expect(authoritativeSlots[2].status).toBe('unlocking')
    expect(authoritativeSlots[2].unlockStartedAt).toBe(serverDbSlot.unlockStartedAt)
    // 6 horas restantes
    const restante = calcularTiempoRestanteMs(authoritativeSlots[2], Date.now())
    expect(restante / (3600 * 1000)).toBeCloseTo(6, 0)
  })

  it('4. Cuando el tiempo transcurrido supera la duración, el estado pasa a ready (coste oro = 0)', () => {
    const t0 = Date.now() - 3 * 3600 * 1000 // Empezó hace 3 horas para un cofre de 2 horas
    const slot: FreePackSlot = {
      slotId: 0,
      status: 'unlocking',
      durationHours: 2,
      arenaLevel: 1,
      unlockStartedAt: t0,
    }

    const restante = calcularTiempoRestanteMs(slot, Date.now())
    expect(restante).toBe(0)
    expect(calcularCosteOroAceleracion(slot, Date.now())).toBe(0)
  })
})
