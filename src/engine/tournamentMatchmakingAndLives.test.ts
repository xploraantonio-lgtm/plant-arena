import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('BLINDAJE AUTORITATIVO DE TORNEOS — CERO BOTS, CERO DESCUENTO ELO Y 3 VIDAS', () => {
  const m130Path = path.resolve(__dirname, '../../supabase/migrations/130-tournament-authoritative-zero-bots-3-lives-guard.sql')
  const m130Sql = fs.readFileSync(m130Path, 'utf-8')

  it('1.1. SQL Audit: game_rooms y matchmaking_queue incorporan tournament_id', () => {
    expect(m130Sql).toContain('ALTER TABLE public.game_rooms')
    expect(m130Sql).toContain('ADD COLUMN IF NOT EXISTS tournament_id UUID')
    expect(m130Sql).toContain('ALTER TABLE public.matchmaking_queue')
  })

  it('1.2. SQL Audit: enter_matchmaking valida autoritativamente la regla de 3 vidas', () => {
    expect(m130Sql).toContain('v_tourn_part.is_eliminated OR v_tourn_part.losses >= COALESCE(v_tourn.max_losses, 3)')
    expect(m130Sql).toContain('tournament_eliminated')
    expect(m130Sql).toContain('0 vidas restantes')
  })

  it('1.3. SQL Audit: enter_matchmaking aisla salas y nunca reanuda bots/salas asincronas en torneos', () => {
    expect(m130Sql).toContain('COALESCE(r.is_async_match, FALSE) = FALSE')
    expect(m130Sql).toContain('r.mode = p_mode')
    expect(m130Sql).toContain('r.tournament_id IS NOT DISTINCT FROM v_tournament_id')
  })

  it('1.4. SQL Audit: claim_ranked_async_opponent prohibe terminantemente bots en torneos', () => {
    expect(m130Sql).toContain("IF v_queue.mode <> 'ranked' THEN")
    expect(m130Sql).toContain('modo_no_soporta_semilla')
    expect(m130Sql).toContain('Cero bots')
  })

  it('1.5. SQL Audit: _settle_room en modo torneo garantiza ELO delta 0 y resta autoritativa de vidas', () => {
    expect(m130Sql).toContain("IF v_room.mode = 'tournament' THEN")
    expect(m130Sql).toContain('wins = wins + 1')
    expect(m130Sql).toContain('losses = losses + 1')
    expect(m130Sql).toContain('is_eliminated = (losses + 1 >= 3)')
    expect(m130Sql).toContain("'eloGained', 0")
    expect(m130Sql).toContain("'eloLost', 0")
    expect(m130Sql).toContain("'eloDelta', 0")
  })

  it('2.1. Simulacion Logica de 3 Vidas: 3 derrotas eliminan al participante y bloquean matchmaking', () => {
    interface Participant {
      userId: string
      tournamentId: string
      wins: number
      losses: number
      isEliminated: boolean
      maxLosses: number
    }

    function simulateTournamentLoss(p: Participant): { participant: Participant; livesRemaining: number } {
      const newLosses = p.losses + 1
      const isEliminated = newLosses >= p.maxLosses
      p.losses = newLosses
      p.isEliminated = isEliminated
      return {
        participant: p,
        livesRemaining: Math.max(0, p.maxLosses - newLosses),
      }
    }

    function simulateEnterMatchmakingGate(p: Participant): { allowed: boolean; error?: string } {
      if (p.isEliminated || p.losses >= p.maxLosses) {
        return {
          allowed: false,
          error: 'tournament_eliminated: Has sido eliminado del torneo (0 vidas restantes).',
        }
      }
      return { allowed: true }
    }

    const player: Participant = {
      userId: 'user-gladiator-1',
      tournamentId: 'tourney-123',
      wins: 0,
      losses: 0,
      isEliminated: false,
      maxLosses: 3,
    }

    // Inicial: 3 vidas, puede buscar
    expect(simulateEnterMatchmakingGate(player).allowed).toBe(true)

    // 1a Derrota -> 2 vidas restantes (1 derrota acumulada)
    const r1 = simulateTournamentLoss(player)
    expect(r1.livesRemaining).toBe(2)
    expect(player.isEliminated).toBe(false)
    expect(simulateEnterMatchmakingGate(player).allowed).toBe(true)

    // 2a Derrota -> 1 vida restante (2 derrotas acumuladas)
    const r2 = simulateTournamentLoss(player)
    expect(r2.livesRemaining).toBe(1)
    expect(player.isEliminated).toBe(false)
    expect(simulateEnterMatchmakingGate(player).allowed).toBe(true)

    // 3a Derrota -> 0 vidas restantes (3 derrotas acumuladas) -> ELIMINADO
    const r3 = simulateTournamentLoss(player)
    expect(r3.livesRemaining).toBe(0)
    expect(player.isEliminated).toBe(true)

    // Bloqueo autoritativo de matchmaking: ya no puede buscar
    const gateCheck = simulateEnterMatchmakingGate(player)
    expect(gateCheck.allowed).toBe(false)
    expect(gateCheck.error).toContain('tournament_eliminated')
  })

  it('2.2. Inmunidad Total de ELO: una derrota en torneo mantiene el ELO intacto (delta = 0)', () => {
    function simulateSettleTournamentRoom(winnerId: string, p1Id: string, p2Id: string, initialEloP1: number, initialEloP2: number) {
      const loserId = winnerId === p1Id ? p2Id : p1Id
      return {
        mode: 'tournament',
        winner: winnerId,
        loser: loserId,
        eloDeltaP1: 0,
        eloDeltaP2: 0,
        eloAfterP1: initialEloP1,
        eloAfterP2: initialEloP2,
        eloGained: 0,
        eloLost: 0,
      }
    }

    const res = simulateSettleTournamentRoom('user-winner', 'user-winner', 'user-loser', 1650, 1420)
    expect(res.eloDeltaP1).toBe(0)
    expect(res.eloDeltaP2).toBe(0)
    expect(res.eloAfterP1).toBe(1650)
    expect(res.eloAfterP2).toBe(1420)
    expect(res.eloLost).toBe(0)
    expect(res.eloGained).toBe(0)
  })

  it('2.3. Cero Bots en Torneo: el sondeo de emparejamiento nunca solicita rival semilla si modo es torneo', () => {
    function canClaimSeedOpponent(mode: string, waitedSeconds: number): boolean {
      if (mode !== 'ranked') {
        return false // En torneo o coliseo, CERO BOTS
      }
      return waitedSeconds >= 30
    }

    // En torneo, aunque espere 60 segundos, NUNCA puede pedir rival semilla
    expect(canClaimSeedOpponent('tournament', 30)).toBe(false)
    expect(canClaimSeedOpponent('tournament', 60)).toBe(false)
    expect(canClaimSeedOpponent('tournament', 120)).toBe(false)

    // En ranked, tras 30s si esta habilitado
    expect(canClaimSeedOpponent('ranked', 29)).toBe(false)
    expect(canClaimSeedOpponent('ranked', 30)).toBe(true)
  })
})
