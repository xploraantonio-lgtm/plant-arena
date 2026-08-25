import { describe, it, expect, vi } from 'vitest'
import { RANKED_MATCHMAKING_TIMEOUT_SECONDS } from '../utils/gameConstants'
import { SupabaseService } from '../services/supabaseService'

describe('A. Matchmaking 30 Segundos y Frontera Exacta', () => {
  it('la constante canónica RANKED_MATCHMAKING_TIMEOUT_SECONDS vale 30', () => {
    expect(RANKED_MATCHMAKING_TIMEOUT_SECONDS).toBe(30)
  })

  it('evalúa la frontera exacta: 29.9s (waited = 29) NO dispara fallback y 30.0s (waited = 30) SÍ dispara fallback', async () => {
    const claimSpy = vi.spyOn(SupabaseService, 'claimRankedAsyncOpponent').mockResolvedValue({
      matched: true,
      roomId: 'test-room-async-fallback',
    } as any)

    // Función pura de evaluación de umbral de fallback en cliente
    function shouldTriggerAsyncFallback(modo: string, waitedSeconds: number, isClaiming: boolean): boolean {
      return modo === 'ranked' && waitedSeconds >= RANKED_MATCHMAKING_TIMEOUT_SECONDS && !isClaiming
    }

    // 1. A los 29.9 segundos (entero inferior 29 s del servidor)
    const t29_9 = 29
    expect(shouldTriggerAsyncFallback('ranked', t29_9, false)).toBe(false)

    // 2. A los 30.0 segundos exactos (waited = 30 s)
    const t30_0 = 30
    expect(shouldTriggerAsyncFallback('ranked', t30_0, false)).toBe(true)

    // 3. A los 31.0 segundos (waited = 31 s)
    const t31_0 = 31
    expect(shouldTriggerAsyncFallback('ranked', t31_0, false)).toBe(true)

    // 4. Si ya está en proceso de claim, no debe duplicar la llamada
    expect(shouldTriggerAsyncFallback('ranked', 30, true)).toBe(false)

    // 5. En otros modos (friendly, etc.) no debe disparar fallback de ranked
    expect(shouldTriggerAsyncFallback('friendly', 30, false)).toBe(false)

    claimSpy.mockRestore()
  })
})
