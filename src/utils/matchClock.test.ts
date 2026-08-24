import { describe, it, expect } from 'vitest'
import {
  computeAncoraMs,
  validateMatchClock,
  MatchClockSyncCoordinator,
} from './matchClock'

describe('Match Clock Autoritativo & Fail-Closed Coordinator', () => {
  it('calcula ancoraMs correctamente con desfase y RTT', () => {
    const startedAt = '2026-08-24T00:00:00.000Z'
    const serverNow = '2026-08-24T00:00:05.000Z' // 5 segundos después
    const antesMs = 10000
    const despuesMs = 10100 // RTT = 100ms, medioViaje = 50ms
    // llevaAndando = 5000ms
    // ancoraMs = despuesMs - medioViaje - llevaAndando = 10100 - 50 - 5000 = 5050ms
    const ancora = computeAncoraMs(startedAt, serverNow, antesMs, despuesMs)
    expect(ancora).toBe(5050)
  })

  it('validateMatchClock valida y estructura un reloj correcto', () => {
    const clock = validateMatchClock(
      {
        startedAt: '2026-08-24T00:00:00.000Z',
        serverNow: '2026-08-24T00:00:02.000Z',
        currentTick: 10,
      },
      1000,
      1100
    )
    expect(clock.currentTick).toBe(10)
    expect(Number.isFinite(clock.ancoraMs)).toBe(true)
  })

  it('validateMatchClock lanza error si falta startedAt o serverNow (fail-closed)', () => {
    expect(() => validateMatchClock({}, 1000, 1100)).toThrowError(/startedAt/i)
    expect(() =>
      validateMatchClock({ startedAt: '2026-08-24T00:00:00.000Z' }, 1000, 1100)
    ).toThrowError(/serverNow/i)
  })

  it('startMatchClock success -> startGame exactamente 1 vez', () => {
    const coordinator = new MatchClockSyncCoordinator()
    const gen1 = coordinator.prepareNewAttempt()
    const validClock = { ancoraMs: 5000, currentTick: 0 }

    let startCalls = 0
    if (coordinator.shouldStartGame(gen1, validClock)) {
      startCalls += 1
    }

    // Si se reevalúa el mismo intento, NO vuelve a llamar
    if (coordinator.shouldStartGame(gen1, validClock)) {
      startCalls += 1
    }

    expect(startCalls).toBe(1)
  })

  it('startMatchClock error -> startGame 0 veces', () => {
    const coordinator = new MatchClockSyncCoordinator()
    const gen = coordinator.prepareNewAttempt()

    let startCalls = 0
    if (coordinator.shouldStartGame(gen, null)) {
      startCalls += 1
    }

    expect(startCalls).toBe(0)
  })

  it('reloj sin ancoraMs o no finito -> startGame 0 veces', () => {
    const coordinator = new MatchClockSyncCoordinator()
    const gen = coordinator.prepareNewAttempt()

    let startCalls = 0
    if (coordinator.shouldStartGame(gen, { ancoraMs: NaN, currentTick: 0 })) {
      startCalls += 1
    }
    if (coordinator.shouldStartGame(gen, { ancoraMs: undefined as any, currentTick: 0 })) {
      startCalls += 1
    }

    expect(startCalls).toBe(0)
  })

  it('retry success -> startGame exactamente 1 vez para el nuevo intento', () => {
    const coordinator = new MatchClockSyncCoordinator()

    // Intento 1 falló
    const gen1 = coordinator.prepareNewAttempt()
    let startCalls = 0
    if (coordinator.shouldStartGame(gen1, null)) {
      startCalls += 1
    }
    expect(startCalls).toBe(0)

    // Intento 2 (Retry) tuvo éxito
    const gen2 = coordinator.prepareNewAttempt()
    const validClock = { ancoraMs: 6000, currentTick: 0 }
    if (coordinator.shouldStartGame(gen2, validClock)) {
      startCalls += 1
    }

    expect(startCalls).toBe(1)
  })

  it('respuesta stale después de cambiar room -> startGame 0 veces', () => {
    const coordinator = new MatchClockSyncCoordinator()

    // Sala anterior
    const staleGen = coordinator.prepareNewAttempt()

    // Se cambia de sala inmediatamente
    const freshGen = coordinator.prepareNewAttempt()

    let startCalls = 0
    // Llega tarde la respuesta de la sala anterior:
    const staleClock = { ancoraMs: 5000, currentTick: 0 }
    if (coordinator.shouldStartGame(staleGen, staleClock)) {
      startCalls += 1
    }

    expect(startCalls).toBe(0)

    // La sala nueva sí puede arrancar cuando llegue su respuesta
    const freshClock = { ancoraMs: 7000, currentTick: 0 }
    if (coordinator.shouldStartGame(freshGen, freshClock)) {
      startCalls += 1
    }

    expect(startCalls).toBe(1)
  })
})
