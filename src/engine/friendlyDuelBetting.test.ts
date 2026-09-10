import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Duelos Amistosos - Auditoría y Sistema de Apuestas (Migración 76)', () => {
  const mig76Path = path.resolve(
    __dirname,
    '../../supabase/migrations/76-fix-friendly-duels-payout-and-escrow.sql'
  )
  const mig76Sql = fs.readFileSync(mig76Path, 'utf-8')

  // ── 1. AUDITORÍA ESTÁTICA SQL DE MIGRACIÓN 76 ──────────────────────────────
  describe('1. Auditoría Estática de Migración 76', () => {
    it('1.1. _settle_room contiene el bloque de liquidación explícito para friendly', () => {
      expect(mig76Sql).toContain("IF v_room.mode = 'friendly' THEN")
    })

    it('1.2. El ganador de amistoso recibe el 100% del pozo acumulado en colosseum_escrow', () => {
      expect(mig76Sql).toContain("SELECT COALESCE(SUM(bet_gems), 0) INTO v_pozo")
      expect(mig76Sql).toContain("FROM public.colosseum_escrow")
      expect(mig76Sql).toContain("WHERE room_id = p_room_id AND status = 'held'")
      expect(mig76Sql).toContain("UPDATE public.profiles")
      expect(mig76Sql).toContain("SET gems_balance = gems_balance + v_pozo")
      expect(mig76Sql).toContain("WHERE id = p_winner_id")
      expect(mig76Sql).toContain("'friendly_win'")
      expect(mig76Sql).toContain("status = 'settled'")
    })

    it('1.3. En caso de empate en amistoso (winner NULL), reembolsa a ambos jugadores', () => {
      expect(mig76Sql).toContain("IF p_winner_id IS NULL THEN")
      expect(mig76Sql).toContain("UPDATE public.profiles")
      expect(mig76Sql).toContain("SET gems_balance = gems_balance + v_escrow_rec.bet_gems")
      expect(mig76Sql).toContain("'colosseum_refund'")
      expect(mig76Sql).toContain("status = 'refunded'")
      expect(mig76Sql).toContain("status = 'draw'")
    })

    it('1.4. report_match_result reembolsa la apuesta de ambos en caso de disputa', () => {
      expect(mig76Sql).toContain("IF v_room.mode = 'friendly' THEN")
      expect(mig76Sql).toContain("UPDATE public.profiles SET gems_balance = gems_balance + v_escrow_rec.bet_gems")
      expect(mig76Sql).toContain("'colosseum_refund'")
      expect(mig76Sql).toContain("UPDATE public.colosseum_escrow SET status = 'refunded'")
    })

    it('1.5. Contiene script de reparación retroactiva para salas amistosas colgadas', () => {
      expect(mig76Sql).toContain("r.mode = 'friendly'")
      expect(mig76Sql).toContain("e.status = 'held'")
      expect(mig76Sql).toContain("UPDATE public.profiles")
      expect(mig76Sql).toContain("'friendly_win'")
      expect(mig76Sql).toContain("Duelo amistoso ganado (reparación retroactiva)")
    })

    it('1.6. shop_config fija amistoso_apuesta_maxima en 100 gemas', () => {
      expect(mig76Sql).toContain("'amistoso_apuesta_maxima', 100")
    })
  })

  // ── 2. SIMULACIÓN DE APUESTAS Y LIQUIDACIÓN (10, 50, 100 GEMAS) ─────────────
  describe('2. Simulación de Apuestas y Liquidación al 100%', () => {
    interface Jugador {
      id: string
      gemas: number
    }

    interface Escrow {
      id: string
      userId: string
      roomId: string
      betGems: number
      status: 'held' | 'settled' | 'refunded'
    }

    function simularDueloAmistoso(
      saldoInicialA: number,
      saldoInicialB: number,
      apuesta: number,
      ganadorId: string | null
    ) {
      const p1: Jugador = { id: 'player-1', gemas: saldoInicialA }
      const p2: Jugador = { id: 'player-2', gemas: saldoInicialB }
      const roomId = 'room-friendly-123'

      // Cobro inicial
      p1.gemas -= apuesta
      p2.gemas -= apuesta

      const escrows: Escrow[] = [
        { id: 'esc-1', userId: p1.id, roomId, betGems: apuesta, status: 'held' },
        { id: 'esc-2', userId: p2.id, roomId, betGems: apuesta, status: 'held' },
      ]

      // Liquidación _settle_room
      if (ganadorId === null) {
        // Empate
        for (const e of escrows) {
          if (e.status === 'held') {
            if (e.userId === p1.id) p1.gemas += e.betGems
            if (e.userId === p2.id) p2.gemas += e.betGems
            e.status = 'refunded'
          }
        }
      } else {
        // Ganador recibe el 100% del pozo
        const pozo = escrows
          .filter((e) => e.status === 'held')
          .reduce((sum, e) => sum + e.betGems, 0)

        if (ganadorId === p1.id) {
          p1.gemas += pozo
        } else {
          p2.gemas += pozo
        }

        for (const e of escrows) {
          if (e.status === 'held') e.status = 'settled'
        }
      }

      return { p1, p2, escrows }
    }

    it('2.1. Apuesta de 10 gemas: ganador recibe 20 gemas (100% del pozo, 0% rake)', () => {
      const { p1, p2, escrows } = simularDueloAmistoso(100, 100, 10, 'player-1')
      expect(p1.gemas).toBe(110) // ganó 10 netas (recibió 20 del pozo)
      expect(p2.gemas).toBe(90)  // perdió 10
      expect(escrows.every((e) => e.status === 'settled')).toBe(true)
    })

    it('2.2. Apuesta de 50 gemas: ganador recibe 100 gemas (100% del pozo)', () => {
      const { p1, p2, escrows } = simularDueloAmistoso(200, 200, 50, 'player-2')
      expect(p1.gemas).toBe(150)
      expect(p2.gemas).toBe(250) // ganó 50 netas (recibió 100 del pozo)
      expect(escrows.every((e) => e.status === 'settled')).toBe(true)
    })

    it('2.3. Apuesta de 100 gemas: ganador recibe 200 gemas (100% del pozo)', () => {
      const { p1, p2, escrows } = simularDueloAmistoso(500, 500, 100, 'player-1')
      expect(p1.gemas).toBe(600) // ganó 100 netas (recibió 200 del pozo)
      expect(p2.gemas).toBe(400)
      expect(escrows.every((e) => e.status === 'settled')).toBe(true)
    })

    it('2.4. Empate con 50 gemas: ambos reciben reembolso total de sus 50 gemas', () => {
      const { p1, p2, escrows } = simularDueloAmistoso(100, 100, 50, null)
      expect(p1.gemas).toBe(100)
      expect(p2.gemas).toBe(100)
      expect(escrows.every((e) => e.status === 'refunded')).toBe(true)
    })
  })

  // ── 3. COMPROBACIÓN DE PRESETS EN EL SELECTOR DE MODOS ──────────────────────
  describe('3. Presets en ModeSelectorModal', () => {
    it('3.1. ModeSelectorModal define los presets [0, 10, 50, 100]', () => {
      const modalPath = path.resolve(
        __dirname,
        '../components/ModeSelector/ModeSelectorModal.tsx'
      )
      const modalTsx = fs.readFileSync(modalPath, 'utf-8')
      expect(modalTsx).toContain('[0, 10, 50, 100].map((preset)')
    })
  })
})
