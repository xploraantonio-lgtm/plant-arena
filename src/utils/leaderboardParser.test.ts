import { describe, it, expect } from 'vitest'
import { parseLeaderboardRow } from './leaderboardParser'

describe('Leaderboard Parser (Strict / Cero Fallbacks)', () => {
  it('parsea correctamente una fila válida con 0W/0L/0D/0 games reales -> 0% win rate', () => {
    const raw = {
      id: 'a9db2ab3-71f8-43ec-bde9-0b0f9e41fa67',
      username: 'Novato',
      rank_position: 10,
      elo_rating: 1000,
      ranked_wins: 0,
      ranked_losses: 0,
      ranked_draws: 0,
      ranked_games: 0,
      ranked_win_rate: 0,
      avatar_id: null,
    }

    const parsed = parseLeaderboardRow(raw)
    expect(parsed.id).toBe('a9db2ab3-71f8-43ec-bde9-0b0f9e41fa67')
    expect(parsed.username).toBe('Novato')
    expect(parsed.rank_position).toBe(10)
    expect(parsed.elo_rating).toBe(1000)
    expect(parsed.ranked_wins).toBe(0)
    expect(parsed.ranked_losses).toBe(0)
    expect(parsed.ranked_draws).toBe(0)
    expect(parsed.ranked_games).toBe(0)
    expect(parsed.ranked_win_rate).toBe('0%')
    expect(parsed.avatar_id).toBeNull()
  })

  it('parsea correctamente una fila con 2W/1L/0D/3 games y win rate 66.7%', () => {
    const raw = {
      id: '71c01a7a-8b97-4dcc-9e3e-d725c6a150ef',
      username: 'Campeón',
      rank_position: 1,
      elo_rating: 1081,
      ranked_wins: 2,
      ranked_losses: 1,
      ranked_draws: 0,
      ranked_games: 3,
      ranked_win_rate: '66.7',
      avatar_id: 'avatar-5',
    }

    const parsed = parseLeaderboardRow(raw)
    expect(parsed.id).toBe('71c01a7a-8b97-4dcc-9e3e-d725c6a150ef')
    expect(parsed.username).toBe('Campeón')
    expect(parsed.rank_position).toBe(1)
    expect(parsed.elo_rating).toBe(1081)
    expect(parsed.ranked_wins).toBe(2)
    expect(parsed.ranked_losses).toBe(1)
    expect(parsed.ranked_draws).toBe(0)
    expect(parsed.ranked_games).toBe(3)
    expect(parsed.ranked_win_rate).toBe('66.7%')
    expect(parsed.raw_win_rate).toBe(66.7)
    expect(parsed.avatar_id).toBe('avatar-5')
  })

  it('username null o ausente lanza error de contrato (PROHIBIDO inventar Guerrero)', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: null,
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/username/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: undefined,
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/username/i)
  })

  it('username vacío o sólo espacios lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: '',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/username/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: '   ',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/username/i)
  })

  it('id null o ausente lanza error de contrato (PROHIBIDO fallback a "")', () => {
    expect(() =>
      parseLeaderboardRow({
        id: null,
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/id/i)

    expect(() =>
      parseLeaderboardRow({
        id: undefined,
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/id/i)
  })

  it('id vacío o sólo espacios lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: '',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/id/i)

    expect(() =>
      parseLeaderboardRow({
        id: '   ',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/id/i)
  })

  it('ranked_games null o ausente lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: null,
        ranked_win_rate: 100,
      })
    ).toThrowError(/ranked_games/i)
  })

  it('ranked_games NaN o malformado lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: NaN,
        ranked_win_rate: 100,
      })
    ).toThrowError(/ranked_games/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 'corrupt',
        ranked_win_rate: 100,
      })
    ).toThrowError(/ranked_games/i)
  })

  it('ranked_games diferente a W+L+D lanza error de contrato (invariante rota)', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-1',
        username: 'Jugador',
        rank_position: 1,
        elo_rating: 1000,
        ranked_wins: 2,
        ranked_losses: 1,
        ranked_draws: 0,
        ranked_games: 5, // 5 != 2 + 1 + 0
        ranked_win_rate: '66.7',
      })
    ).toThrowError(/ranked_games.*no coincide/i)
  })

  it('rank_position NULL o ausente lanza error de contrato (NO fallback a idx+1)', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-3',
        username: 'Invalido',
        rank_position: null,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 100,
      })
    ).toThrowError(/rank_position/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-3',
        username: 'Invalido',
        rank_position: 0, // rank debe ser > 0
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 100,
      })
    ).toThrowError(/rank_position/i)
  })

  it('elo_rating malformed o ausente lanza error de contrato (NO inventa 1000)', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-4',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: null,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 100,
      })
    ).toThrowError(/elo_rating/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-4',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: NaN,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 100,
      })
    ).toThrowError(/elo_rating/i)
  })

  it('ranked_wins malformed o ausente lanza error de contrato (NO inventa 0W)', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-5',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: null,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/ranked_wins/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-5',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: 'corrupted',
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/ranked_wins/i)
  })

  it('ranked_losses malformed o ausente lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-6',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: undefined,
        ranked_draws: 0,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/ranked_losses/i)
  })

  it('ranked_draws malformed o ausente lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-6',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: 0,
        ranked_losses: 0,
        ranked_draws: null,
        ranked_games: 0,
        ranked_win_rate: 0,
      })
    ).toThrowError(/ranked_draws/i)
  })

  it('ranked_win_rate malformed o fuera de rango [0, 100] lanza error de contrato', () => {
    expect(() =>
      parseLeaderboardRow({
        id: 'usr-7',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 150, // mayor a 100
      })
    ).toThrowError(/ranked_win_rate/i)

    expect(() =>
      parseLeaderboardRow({
        id: 'usr-7',
        username: 'Invalido',
        rank_position: 5,
        elo_rating: 1000,
        ranked_wins: 1,
        ranked_losses: 0,
        ranked_draws: 0,
        ranked_games: 1,
        ranked_win_rate: 'invalid_rate',
      })
    ).toThrowError(/ranked_win_rate/i)
  })
})
