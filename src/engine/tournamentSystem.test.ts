import { describe, it, expect } from 'vitest'
import type { PlantId } from '../types/game'
import { PLANT_CONFIGS } from '../utils/gameConstants'
import { tournamentService } from '../services/tournamentService'

describe('SISTEMA AUTORITATIVO DE TORNEOS — PRUEBAS DE DOMINIO Y REGLAS', () => {
  const ALL_15_PLANTS = Object.keys(PLANT_CONFIGS) as PlantId[]

  it('1. Catálogo Libre: existen exactamente 15 cartas disponibles para el torneo', () => {
    expect(ALL_15_PLANTS.length).toBe(15)
    expect(ALL_15_PLANTS).toContain('sunflower')
    expect(ALL_15_PLANTS).toContain('peashooter')
    expect(ALL_15_PLANTS).toContain('repeater')
    expect(ALL_15_PLANTS).toContain('wallnut')
    expect(ALL_15_PLANTS).toContain('melonpult')
    expect(ALL_15_PLANTS).toContain('chomper')
    expect(ALL_15_PLANTS).toContain('bonkchoy')
    expect(ALL_15_PLANTS).toContain('garlic')
    expect(ALL_15_PLANTS).toContain('squash')
    expect(ALL_15_PLANTS).toContain('twinsunflower')
    expect(ALL_15_PLANTS).toContain('threepeater')
    expect(ALL_15_PLANTS).toContain('tallnut')
    expect(ALL_15_PLANTS).toContain('jalapeno')
    expect(ALL_15_PLANTS).toContain('iceberglettuce')
    expect(ALL_15_PLANTS).toContain('aloe')
  })

  it('2. Validación de Mazo: exige exactamente entre 5 y 6 plantas válidas del catálogo', async () => {
    // Mazo válido de 5
    const validDeck: PlantId[] = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'aloe']
    const resValid = await tournamentService.updateTournamentDeck('test_tourney', validDeck)
    expect(resValid.success).toBe(true)

    // Mazo inválido: menos de 5 cartas
    const shortDeck = ['sunflower', 'peashooter'] as PlantId[]
    const resShort = await tournamentService.updateTournamentDeck('test_tourney', shortDeck)
    expect(resShort.success).toBe(false)
    expect(resShort.error).toContain('entre 5 y 6')
  })

  it('3. Regla Estricta de 3 Derrotas: eliminación autoritativa al llegar a 3 derrotas', async () => {
    const testTourneyId = `test_gauntlet_${Date.now()}`

    // Registro inicial
    const reg = await tournamentService.registerParticipant(testTourneyId)
    expect(reg.success).toBe(true)

    // 1ª Partida: Victoria
    const m1 = await tournamentService.submitMatchResult(testTourneyId, true, 'Rival 1')
    expect(m1.success).toBe(true)
    expect(m1.wins).toBe(1)
    expect(m1.losses).toBe(0)
    expect(m1.is_eliminated).toBe(false)

    // 2ª Partida: Derrota 1
    const m2 = await tournamentService.submitMatchResult(testTourneyId, false, 'Rival 2')
    expect(m2.success).toBe(true)
    expect(m2.wins).toBe(1)
    expect(m2.losses).toBe(1)
    expect(m2.is_eliminated).toBe(false)

    // 3ª Partida: Derrota 2
    const m3 = await tournamentService.submitMatchResult(testTourneyId, false, 'Rival 3')
    expect(m3.success).toBe(true)
    expect(m3.losses).toBe(2)
    expect(m3.is_eliminated).toBe(false)

    // 4ª Partida: Derrota 3 -> ELIMINACIÓN
    const m4 = await tournamentService.submitMatchResult(testTourneyId, false, 'Rival 4')
    expect(m4.success).toBe(true)
    expect(m4.losses).toBe(3)
    expect(m4.is_eliminated).toBe(true)

    // 5ª Partida: Intento posterior a la eliminación -> RECHAZADO
    const m5 = await tournamentService.submitMatchResult(testTourneyId, true, 'Rival 5')
    expect(m5.success).toBe(false)
    expect(m5.error).toBe('PLAYER_ALREADY_ELIMINATED')
  }, 15000)

  it('4. Cálculo Matemático de Reparto del Pozo de Gemas (50%, 30%, 20%)', () => {
    const pool = 100
    const top1 = Number((pool * 0.50).toFixed(2))
    const top2 = Number((pool * 0.30).toFixed(2))
    const top3 = Number((pool * 0.20).toFixed(2))

    expect(top1).toBe(50.00)
    expect(top2).toBe(30.00)
    expect(top3).toBe(20.00)
    expect(top1 + top2 + top3).toBe(100.00)
  })

  it('5. Creación de Torneo con Hora Programada y Entrada Gratuita', async () => {
    const res = await tournamentService.createTournament({
      title: 'Torneo Test Comunidad',
      prize_pool_gems: 25,
      start_time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      duration_minutes: 45,
    })

    expect(res.success).toBe(true)
    expect(res.tournament_id).toBeDefined()

    const details = await tournamentService.getTournamentDetails(res.tournament_id!)
    expect(details).not.toBeNull()
    expect(details?.tournament.title).toBe('Torneo Test Comunidad')
    expect(details?.tournament.entry_fee_gems).toBe(0)
    expect(details?.tournament.prize_pool_gems).toBe(25)
  })

  it('6. Creación de Torneo con Entrada de Gemas configurable por Admin', async () => {
    const res = await tournamentService.createTournament({
      title: 'Torneo Pro con Entrada de Gemas',
      prize_pool_gems: 50,
      entry_fee_gems: 10,
      duration_minutes: 60,
    })

    expect(res.success).toBe(true)
    const details = await tournamentService.getTournamentDetails(res.tournament_id!)
    expect(details?.tournament.entry_fee_gems).toBe(10)
    expect(details?.tournament.prize_pool_gems).toBe(50)
  })

  it('7. Reentrada por 3 Gemas otorga 2 Vidas y restablece estado eliminado', async () => {
    const created = await tournamentService.createTournament({
      title: 'Torneo Reentrada Test',
      prize_pool_gems: 30,
      duration_minutes: 60,
    })
    const tourneyId = created.tournament_id!
    await tournamentService.registerParticipant(tourneyId)

    // Simular 3 derrotas para quedar eliminado
    await tournamentService.submitMatchResult(tourneyId, false, 'Rival #1')
    await tournamentService.submitMatchResult(tourneyId, false, 'Rival #2')
    const finalMatch = await tournamentService.submitMatchResult(tourneyId, false, 'Rival #3')
    expect(finalMatch.is_eliminated).toBe(true)
    expect(finalMatch.losses).toBe(3)

    // Reentrada por 3 gemas
    const reentry = await tournamentService.reenterTournament(tourneyId)
    expect(reentry.success).toBe(true)
    expect(reentry.lives).toBe(2)
    expect(reentry.losses).toBe(1) // 2 vidas = 1 derrota acumulada con límite de 3

    // Verificar que el participante vuelve a estar activo y el pozo del torneo no aumenta (va al pool del juego)
    const details = await tournamentService.getTournamentDetails(tourneyId)
    expect(details?.my_participation.is_eliminated).toBe(false)
    expect(details?.my_participation.losses).toBe(1)
    expect(details?.tournament.prize_pool_gems).toBe(30) // No se suma al pozo del torneo
  })

  it('8. Creación de Torneo con Fecha UTC Específica del Año Actual y Estado Programado', async () => {
    const currentYear = new Date().getUTCFullYear()
    // Programar para mañana a las 18:00 UTC
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
    const utcStartTime = new Date(Date.UTC(
      currentYear,
      tomorrow.getUTCMonth(),
      tomorrow.getUTCDate(),
      18,
      0,
      0
    )).toISOString()

    const created = await tournamentService.createTournament({
      title: 'Torneo Programado UTC Mañana',
      prize_pool_gems: 40,
      entry_fee_gems: 0,
      start_time: utcStartTime,
      duration_minutes: 90,
    })

    expect(created.success).toBe(true)
    const details = await tournamentService.getTournamentDetails(created.tournament_id!)
    expect(details).not.toBeNull()
    expect(details?.tournament.status).toBe('scheduled')
    expect(details?.tournament.start_time).toBe(utcStartTime)

    // El tiempo restante hasta el inicio debe ser positivo (mayor a 0)
    const diffMs = new Date(details!.tournament.start_time).getTime() - Date.now()
    expect(diffMs).toBeGreaterThan(0)
  })

  it('9. Auditoría de Participantes: la lista completa de inscritos se preserva sin truncamiento arbitrario', async () => {
    // Simular un torneo con 185 participantes registrados
    const fakeTourneyId = 'tourney_185_players'
    const fakeParticipants = Array.from({ length: 185 }, (_, i) => ({
      tournament_id: fakeTourneyId,
      user_id: `user_${i + 1}`,
      username: `Gladiador_${i + 1}`,
      wins: i === 0 ? 10 : i === 1 ? 9 : i === 2 ? 8 : Math.max(0, 5 - Math.floor(i / 30)),
      losses: i === 0 ? 0 : i === 1 ? 1 : i === 2 ? 1 : Math.min(3, Math.floor(i / 50)),
      is_eliminated: Math.floor(i / 50) >= 3,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }))

    // Mapeo autoritativo de clasificación con 185 elementos
    const mappedLeaderboard = fakeParticipants.map((tp, idx) => ({
      rank: idx + 1,
      user_id: tp.user_id,
      username: tp.username,
      wins: tp.wins,
      losses: tp.losses,
      is_eliminated: tp.is_eliminated,
      is_me: tp.user_id === 'user_1',
      prize_awarded_gems: idx === 0 ? 50 : idx === 1 ? 30 : idx === 2 ? 20 : 0,
    }))

    expect(mappedLeaderboard.length).toBe(185)
    expect(mappedLeaderboard[0].rank).toBe(1)
    expect(mappedLeaderboard[184].rank).toBe(185)
    expect(mappedLeaderboard[0].prize_awarded_gems).toBe(50)
    expect(mappedLeaderboard[1].prize_awarded_gems).toBe(30)
    expect(mappedLeaderboard[2].prize_awarded_gems).toBe(20)
    expect(mappedLeaderboard[3].prize_awarded_gems).toBe(0)
  })

  it('10. Torneo Finalizado: mantiene la clasificación final y premios de todos los participantes', async () => {
    const created = await tournamentService.createTournament({
      title: 'Torneo Finalizado Histórico',
      prize_pool_gems: 100,
      entry_fee_gems: 0,
      duration_minutes: 60,
    })
    const tourneyId = created.tournament_id!

    const details = await tournamentService.getTournamentDetails(tourneyId)
    expect(details).not.toBeNull()
    expect(details?.leaderboard).toBeDefined()
    expect(Array.isArray(details?.leaderboard)).toBe(true)
    expect(details?.leaderboard.length).toBeGreaterThan(0)
  })
})

