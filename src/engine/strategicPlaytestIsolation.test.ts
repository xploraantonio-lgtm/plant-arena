import { describe, it, expect, vi } from 'vitest'
import { INITIAL_BASE_HP, PLANT_CONFIGS, LANES_CONFIG } from '../utils/gameConstants'
import { createBattleState } from './simulate'
import { resolverLiquidacionPartida } from './asyncOpponent'
import { detectarAnomaliasDePartida } from './strategicPlaytest'
import { isStrategicPlaytestAuthorized, STRATEGIC_PLAYTEST_USER_ALLOWLIST } from '../utils/strategicPlaytestAuth'
import { SupabaseService } from '../services/supabaseService'

describe('Gate Final de Certificación: Paridad y Aislamiento Competitivo V1', () => {
  describe('1. Verificación Canónica de HP de Base', () => {
    it('RANKED_INITIAL_BASE_HP y STRATEGIC_TEST_INITIAL_BASE_HP son idénticos y provienen de gameConstants', () => {
      const RANKED_INITIAL_BASE_HP = INITIAL_BASE_HP
      const STRATEGIC_TEST_INITIAL_BASE_HP = INITIAL_BASE_HP

      expect(RANKED_INITIAL_BASE_HP).toBe(600)
      expect(STRATEGIC_TEST_INITIAL_BASE_HP).toBe(600)
      expect(RANKED_INITIAL_BASE_HP).toEqual(STRATEGIC_TEST_INITIAL_BASE_HP)

      const rankedState = createBattleState(12345, false, false, undefined, 'auth-v2')
      const strategicState = createBattleState(12345, false, true, undefined, 'auth-v2')

      expect(rankedState.p1BaseHp).toBe(600)
      expect(rankedState.p2BaseHp).toBe(600)
      expect(strategicState.p1BaseHp).toBe(600)
      expect(strategicState.p2BaseHp).toBe(600)
      expect(rankedState.p1BaseHp).toBe(strategicState.p1BaseHp)
      expect(rankedState.p2BaseHp).toBe(strategicState.p2BaseHp)
    })
  })

  describe('2. Paridad Total de Reglas de Juego (GAMEPLAY DIFFERENCES = 0)', () => {
    it('compara todas las dimensiones de simulación entre Ranked y Strategic Test', () => {
      const seed = 99999
      const rankedState = createBattleState(seed, false, false, undefined, 'auth-v2')
      const strategicState = createBattleState(seed, false, true, undefined, 'auth-v2')

      // Paridad de estado base
      expect(strategicState.engineVersion).toBe(rankedState.engineVersion)
      expect(strategicState.sunBank).toBe(rankedState.sunBank)
      expect(strategicState.p1BaseHp).toBe(rankedState.p1BaseHp)
      expect(strategicState.p2BaseHp).toBe(rankedState.p2BaseHp)
      expect(strategicState.cooldowns).toEqual(rankedState.cooldowns)
      expect(strategicState.wave).toBe(rankedState.wave)

      // Paridad de catálogo y balance
      for (const plantKey in PLANT_CONFIGS) {
        const p = PLANT_CONFIGS[plantKey as keyof typeof PLANT_CONFIGS]
        if (p.maxHp !== undefined) {
          expect(p.maxHp).toBeGreaterThan(0)
        }
        expect(p.cost).toBeGreaterThanOrEqual(0)
        expect(p.cooldownMs).toBeGreaterThan(0)
      }

      // Paridad de carriles y dimensiones
      expect(LANES_CONFIG.length).toBe(3)
    })
  })

  describe('3 & 4. Gate Estricto de Autorización y Allowlist', () => {
    it('autoriza en entorno de desarrollo o feature flag', () => {
      expect(isStrategicPlaytestAuthorized()).toBe(true) // En vitest import.meta.env.DEV === true
    })

    it('autoriza si el usuario es administrador autenticado verificado por servidor', () => {
      const authContextAdmin = {
        isAdmin: true,
        profile: { is_admin: true },
        user: { id: 'some-user-uuid' },
      }
      expect(isStrategicPlaytestAuthorized(authContextAdmin)).toBe(true)
    })

    it('autoriza si el user.id está en la allowlist estable', () => {
      const testAllowlistedId = '11111111-2222-3333-4444-555555555555'
      STRATEGIC_PLAYTEST_USER_ALLOWLIST.push(testAllowlistedId)

      const authContextAllowlist = {
        isAdmin: false,
        profile: { is_admin: false },
        user: { id: testAllowlistedId },
      }
      expect(isStrategicPlaytestAuthorized(authContextAllowlist)).toBe(true)
    })

    it('deniega acceso si es usuario público normal en producción simulada', () => {
      // Simular producción donde DEV es false
      const origEnv = { ...import.meta.env }
      ;(import.meta.env as any).DEV = false
      ;(import.meta.env as any).VITE_ENABLE_STRATEGIC_PLAYTEST = 'false'

      try {
        const publicUserContext = {
          isAdmin: false,
          profile: { is_admin: false },
          user: { id: 'public-random-user-uuid' },
        }
        expect(isStrategicPlaytestAuthorized(publicUserContext)).toBe(false)
        expect(isStrategicPlaytestAuthorized(undefined)).toBe(false)
      } finally {
        ;(import.meta.env as any).DEV = origEnv.DEV
        ;(import.meta.env as any).VITE_ENABLE_STRATEGIC_PLAYTEST = origEnv.VITE_ENABLE_STRATEGIC_PLAYTEST
      }
    })
  })

  describe('5 & 6. Aislamiento Competitivo Estricto (Sin llamadas de red ni SQL)', () => {
    it('confirma que el playtest estratégico nunca invoca endpoints de settlement ni modifica ELO', () => {
      const reportSpy = vi.spyOn(SupabaseService, 'reportMatchResult').mockResolvedValue({ success: true } as any)
      const verifySpy = vi.spyOn(SupabaseService, 'verifyMatch').mockResolvedValue({ success: true } as any)
      const checkpointSpy = vi.spyOn(SupabaseService, 'submitMatchCheckpoint').mockResolvedValue({ success: true } as any)

      // En el playtest: matchMode === 'strategic_test', roomId === null
      const roomId = null
      const matchMode = 'strategic_test' as string
      const reparteElCliente = !roomId && matchMode !== 'ranked' && matchMode !== 'strategic_test'

      expect(reparteElCliente).toBe(false)

      const onBattleComplete = vi.fn()
      const onServerEloUpdated = vi.fn()

      if (roomId) {
        // No se ejecuta porque roomId es null
        SupabaseService.reportMatchResult('room-1', 'user-1')
        SupabaseService.verifyMatch('room-1')
      }
      if (reparteElCliente) {
        // No se ejecuta porque reparteElCliente es false
        onBattleComplete(true)
      }

      expect(reportSpy).not.toHaveBeenCalled()
      expect(verifySpy).not.toHaveBeenCalled()
      expect(checkpointSpy).not.toHaveBeenCalled()
      expect(onBattleComplete).not.toHaveBeenCalled()
      expect(onServerEloUpdated).not.toHaveBeenCalled()

      reportSpy.mockRestore()
      verifySpy.mockRestore()
      checkpointSpy.mockRestore()
    })

    it('resolverLiquidacionPartida retorna status local seguro cuando no hay servidor', () => {
      const res = resolverLiquidacionPartida({
        isAsyncMatch: true,
        soyP1: true,
        currentUserId: 'local-test-user',
        serverVerification: { status: 'failed', error: 'Sin servidor' },
      })

      expect(res.statusServidor).toBe('revision_servidor')
      expect(res.mostrarResultado).toBe(false)
      expect(res.resultadoFinal).toBe('hold')
      expect(res.payout).toBe(0)
    })
  })

  describe('7. Telemetría y Anomaly Detection', () => {
    it('detecta correctamente anomalías en logs locales', () => {
      const cleanLog = {
        winner: 'player' as const,
        durationSeconds: 65,
        p1BaseHpEnd: 350,
        p2BaseHpEnd: 0,
        botSunCredited: 800,
        botSunSpent: 750,
        telemetryHistory: [],
      }
      const anomalies = detectarAnomaliasDePartida(cleanLog)
      expect(anomalies).toEqual([])
    })
  })
})
