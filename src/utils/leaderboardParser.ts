/**
 * PARSER ESTRICTO DE FILAS DE LEADERBOARD (CERO FALLBACKS COMPETITIVOS)
 *
 * Valida autoritativamente que todos los datos numéricos y de contrato
 * provengan de la base de datos (PostgreSQL view `public.leaderboard`).
 *
 * Cero fallbacks:
 * - username: obligatorio, string no vacío (PROHIBIDO "Guerrero").
 * - id: obligatorio, string no vacío (PROHIBIDO "").
 * - rank_position: obligatorio, entero > 0 (PROHIBIDO idx + 1).
 * - elo_rating: obligatorio, finito >= 0 (PROHIBIDO ?? 1000).
 * - ranked_wins: obligatorio, entero >= 0 (PROHIBIDO || 0).
 * - ranked_losses: obligatorio, entero >= 0 (PROHIBIDO || 0).
 * - ranked_draws: obligatorio, entero >= 0.
 * - ranked_games: obligatorio, entero >= 0, DEBE coincidir exactamente con wins + losses + draws.
 * - ranked_win_rate: obligatorio, finito 0..100 autoritativo del servidor.
 * - avatar_id: string real del servidor o null (sin avatar_url inventado).
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
  avatar_id: string | null
}

export function parseLeaderboardRow(raw: unknown): ParsedLeaderboardRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Fila de leaderboard inválida: no es un objeto')
  }

  const row = raw as Record<string, unknown>

  // 1. id: obligatorio, string no vacío. PROHIBIDO fallback a "".
  if (typeof row.id !== 'string' || row.id.trim().length === 0) {
    throw new Error('Contrato roto en leaderboard: id inválido o ausente')
  }
  const id = row.id.trim()

  // 2. username: obligatorio, string no vacío. PROHIBIDO inventar "Guerrero".
  if (typeof row.username !== 'string' || row.username.trim().length === 0) {
    throw new Error('Contrato roto en leaderboard: username inválido o ausente')
  }
  const username = row.username.trim()

  // 3. rank_position: debe ser entero positivo (> 0). PROHIBIDO usar idx + 1.
  if (row.rank_position === null || row.rank_position === undefined) {
    throw new Error('Contrato roto en leaderboard: rank_position es nulo o ausente')
  }
  const rank = typeof row.rank_position === 'number' ? row.rank_position : Number(row.rank_position)
  if (!Number.isInteger(rank) || rank <= 0) {
    throw new Error(`Contrato roto en leaderboard: rank_position inválido (${String(row.rank_position)})`)
  }

  // 4. elo_rating: debe ser número finito no negativo. PROHIBIDO usar ?? 1000.
  if (row.elo_rating === null || row.elo_rating === undefined) {
    throw new Error('Contrato roto en leaderboard: elo_rating es nulo o ausente')
  }
  const elo = typeof row.elo_rating === 'number' ? row.elo_rating : Number(row.elo_rating)
  if (!Number.isFinite(elo) || elo < 0) {
    throw new Error(`Contrato roto en leaderboard: elo_rating inválido (${String(row.elo_rating)})`)
  }

  // 5. ranked_wins: debe ser entero >= 0. PROHIBIDO Number(...) || 0 silencioso ante datos corruptos.
  if (row.ranked_wins === null || row.ranked_wins === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_wins es nulo o ausente')
  }
  const wins = typeof row.ranked_wins === 'number' ? row.ranked_wins : Number(row.ranked_wins)
  if (!Number.isInteger(wins) || wins < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_wins inválido (${String(row.ranked_wins)})`)
  }

  // 6. ranked_losses: debe ser entero >= 0. PROHIBIDO Number(...) || 0 silencioso.
  if (row.ranked_losses === null || row.ranked_losses === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_losses es nulo o ausente')
  }
  const losses = typeof row.ranked_losses === 'number' ? row.ranked_losses : Number(row.ranked_losses)
  if (!Number.isInteger(losses) || losses < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_losses inválido (${String(row.ranked_losses)})`)
  }

  // 7. ranked_draws: debe ser entero >= 0.
  if (row.ranked_draws === null || row.ranked_draws === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_draws es nulo o ausente')
  }
  const draws = typeof row.ranked_draws === 'number' ? row.ranked_draws : Number(row.ranked_draws)
  if (!Number.isInteger(draws) || draws < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_draws inválido (${String(row.ranked_draws)})`)
  }

  // 8. ranked_games: obligatorio desde servidor. Debe coincidir con suma W+L+D.
  if (row.ranked_games === null || row.ranked_games === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_games es nulo o ausente')
  }
  const games = typeof row.ranked_games === 'number' ? row.ranked_games : Number(row.ranked_games)
  if (!Number.isInteger(games) || games < 0) {
    throw new Error(`Contrato roto en leaderboard: ranked_games inválido (${String(row.ranked_games)})`)
  }
  if (games !== wins + losses + draws) {
    throw new Error(
      `Contrato roto en leaderboard: ranked_games (${games}) no coincide con suma W+L+D (${wins}+${losses}+${draws})`
    )
  }

  // 9. ranked_win_rate: autoritativo desde servidor. Validar número finito entre 0 y 100.
  if (row.ranked_win_rate === null || row.ranked_win_rate === undefined) {
    throw new Error('Contrato roto en leaderboard: ranked_win_rate es nulo o ausente')
  }
  const numWr = typeof row.ranked_win_rate === 'number' ? row.ranked_win_rate : Number(row.ranked_win_rate)
  if (!Number.isFinite(numWr) || numWr < 0 || numWr > 100) {
    throw new Error(`Contrato roto en leaderboard: ranked_win_rate inválido (${String(row.ranked_win_rate)})`)
  }

  // Formato para mostrar: '66.7%' o '0%' o '100%'
  const formattedWr = `${numWr}%`

  // 10. avatar_id: campo opcional del servidor (string no vacío o null).
  const avatarId =
    typeof row.avatar_id === 'string' && row.avatar_id.trim().length > 0
      ? row.avatar_id.trim()
      : null

  return {
    id,
    username,
    rank_position: rank,
    elo_rating: elo,
    ranked_wins: wins,
    ranked_losses: losses,
    ranked_draws: draws,
    ranked_games: games,
    ranked_win_rate: formattedWr,
    raw_win_rate: numWr,
    avatar_id: avatarId,
  }
}
