/**
 * PARSER ESTRICTO DE FILAS DE LEADERBOARD (SIN FALLBACKS COMPETITIVOS)
 *
 * Valida autoritativamente que todos los datos numéricos y de contrato
 * provengan de la base de datos (PostgreSQL view `public.leaderboard`).
 *
 * Prohibido:
 * - inventar posición (#1 o idx + 1) si rank_position es nulo/inválido.
 * - inventar ELO (1000) si elo_rating es nulo/inválido.
 * - inventar W/L (0W/0L) si los campos están malformados o faltan.
 * - recalcular el porcentaje de victoria desde el cliente si falta ranked_win_rate.
 */

export interface ParsedLeaderboardRow {
  id: string
  username: string
  rank_position: number
  elo_rating: number
  ranked_wins: number
  ranked_losses: number
  ranked_draws: number
  ranked_games: number
  ranked_win_rate: string
  raw_win_rate: number
  avatar_url: string | null
}

export function parseLeaderboardRow(raw: unknown): ParsedLeaderboardRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Fila de leaderboard inválida: no es un objeto')
  }

  const row = raw as Record<string, unknown>

  // 1. rank_position: debe ser entero positivo (> 0). PROHIBIDO usar idx + 1.
  if (row.rank_position === null || row.rank_position === undefined) {
    throw new Error('Contrato roto en leaderboard: rank_position es nulo o ausente')
  }
  const rank = typeof row.rank_position === 'number' ? row.rank_position : Number(row.rank_position)
  if (!Number.isInteger(rank) || rank <= 0) {
    throw new Error(`Contrato roto en leaderboard: rank_position inválido (${String(row.rank_position)})`)
  }

  // 2. elo_rating: debe ser número finito no negativo. PROHIBIDO usar ?? 1000.
  if (row.elo_rating === null || row.elo_rating === undefined) {
    throw new Error('Contrato roto en leaderboard: elo_rating es nulo o ausente')
  }
  const elo = typeof row.elo_rating === 'number' ? row.elo_rating : Number(row.elo_rating)
  if (!Number.isFinite(elo) || elo < 0) {
    throw new Error(`Contrato roto en leaderboard: elo_rating inválido (${String(row.elo_rating)})`)
  }

  // 3. ranked_wins: debe ser entero >= 0. PROHIBIDO Number(...) || 0 silencioso ante datos corruptos.
  if (row.ranked_wins === null || row.ranked_wins === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_wins es nulo o ausente')
  }
  const wins = typeof row.ranked_wins === 'number' ? row.ranked_wins : Number(row.ranked_wins)
  if (!Number.isInteger(wins) || wins < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_wins inválido (${String(row.ranked_wins)})`)
  }

  // 4. ranked_losses: debe ser entero >= 0. PROHIBIDO Number(...) || 0 silencioso.
  if (row.ranked_losses === null || row.ranked_losses === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_losses es nulo o ausente')
  }
  const losses = typeof row.ranked_losses === 'number' ? row.ranked_losses : Number(row.ranked_losses)
  if (!Number.isInteger(losses) || losses < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_losses inválido (${String(row.ranked_losses)})`)
  }

  // 5. ranked_draws: debe ser entero >= 0.
  if (row.ranked_draws === null || row.ranked_draws === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_draws es nulo o ausente')
  }
  const draws = typeof row.ranked_draws === 'number' ? row.ranked_draws : Number(row.ranked_draws)
  if (!Number.isInteger(draws) || draws < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_draws inválido (${String(row.ranked_draws)})`)
  }

  // 6. ranked_win_rate: autoritativo desde servidor. Validar número finito entre 0 y 100.
  if (row.ranked_win_rate === null || row.ranked_win_rate === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_win_rate es nulo o ausente')
  }
  const numWr = typeof row.ranked_win_rate === 'number' ? row.ranked_win_rate : Number(row.ranked_win_rate)
  if (!Number.isFinite(numWr) || numWr < 0 || numWr > 100) {
    throw new Error(`Contrato roto en leaderboard: ranked_win_rate inválido (${String(row.ranked_win_rate)})`)
  }

  // Formato para mostrar: '66.7%' o '0%' o '100%'
  const formattedWr = `${numWr}%`

  const username = typeof row.username === 'string' && row.username.trim()
    ? row.username.trim()
    : 'Guerrero'

  const id = typeof row.id === 'string' ? row.id : ''
  const avatarUrl = typeof row.avatar_url === 'string' ? row.avatar_url : null

  return {
    id,
    username,
    rank_position: rank,
    elo_rating: elo,
    ranked_wins: wins,
    ranked_losses: losses,
    ranked_draws: draws,
    ranked_games: wins + losses + draws,
    ranked_win_rate: formattedWr,
    raw_win_rate: numWr,
    avatar_url: avatarUrl,
  }
}
