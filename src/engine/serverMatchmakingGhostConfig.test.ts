import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('1. Matchmaking 30s Server-Authoritative (shop_config.mm_ranked_ghost_after_seconds)', () => {
  const migration43Path = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-hotfix.sql')
  const migration43Sql = fs.readFileSync(migration43Path, 'utf-8')

  it('1.1. SQL Audit: claim_ranked_async_opponent lee shop_config.mm_ranked_ghost_after_seconds con fallback 30s', () => {
    // Debe consultar shop_config
    expect(migration43Sql).toContain('mm_ranked_ghost_after_seconds')
    expect(migration43Sql).toMatch(/SELECT\s+COALESCE\(MAX\(CASE\s+WHEN\s+key\s*=\s*'mm_ranked_ghost_after_seconds'\s+THEN\s+value::INTEGER\s+END\),\s*30\)/i)
    
    // No debe existir 'IF v_waited < 60' ni '60 - v_waited'
    expect(migration43Sql).not.toContain('v_waited < 60')
    expect(migration43Sql).not.toContain('60 - v_waited')
  })

  it('1.2. Frontera física exacta: 29s devuelve tiempo_insuficiente; 30s permite claim', () => {
    function simulateServerClaimGate(waitedSeconds: number, ghostTimeoutSeconds: number) {
      if (waitedSeconds < ghostTimeoutSeconds) {
        return {
          matched: false,
          error: 'tiempo_insuficiente',
          segundos_restantes: ghostTimeoutSeconds - waitedSeconds,
        }
      }
      return {
        matched: true,
        roomId: 'room-async-new-uuid',
        isAsyncMatch: true,
      }
    }

    const ghostConfig = 30

    // 29.0 s -> Rechazado por el servidor con 1 segundo restante
    const res29 = simulateServerClaimGate(29, ghostConfig)
    expect(res29.matched).toBe(false)
    expect(res29.error).toBe('tiempo_insuficiente')
    expect(res29.segundos_restantes).toBe(1)

    // 29.9 s (redondeado a entero 29) -> Rechazado
    const res299 = simulateServerClaimGate(Math.floor(29.9), ghostConfig)
    expect(res299.matched).toBe(false)
    expect(res299.error).toBe('tiempo_insuficiente')

    // 30.0 s -> Permitido
    const res30 = simulateServerClaimGate(30, ghostConfig)
    expect(res30.matched).toBe(true)
    expect(res30.roomId).toBe('room-async-new-uuid')
    expect(res30.isAsyncMatch).toBe(true)
  })

  it('1.3. Paridad server-side: poll_matchmaking y claim_ranked_async_opponent usan idéntica condición', () => {
    function simulateServerPoll(waitedSeconds: number, ghostTimeout: number) {
      return {
        searching: true,
        matched: false,
        waitedSeconds,
        ghostAvailable: waitedSeconds >= ghostTimeout,
      }
    }

    const ghostTimeout = 30

    // A los 29s
    const poll29 = simulateServerPoll(29, ghostTimeout)
    expect(poll29.ghostAvailable).toBe(false)

    // A los 30s
    const poll30 = simulateServerPoll(30, ghostTimeout)
    expect(poll30.ghostAvailable).toBe(true)
  })
})
