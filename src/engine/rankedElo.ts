/**
 * Constante oficial del factor K para el sistema Ranked de Plant Arena.
 * K = 32 para el cálculo server-authoritative de partidas competitivas.
 */
export const RANKED_ELO_K = 32

/**
 * Calcula el cambio de ELO autoritativo entre dos jugadores usando la fórmula ELO clásica.
 *
 * expected = 1 / (1 + 10 ^ ((opponentRating - playerRating) / 400))
 * delta = ROUND(K * (score - expected))
 *
 * @param playerRating Rating actual del jugador antes de la partida
 * @param opponentRating Rating del rival (o snapshot congelado de la semilla)
 * @param score 1.0 = victoria, 0.5 = empate, 0.0 = derrota
 * @returns Cambio de ELO entero (positivo o negativo)
 */
export function calcularRankedEloDelta(
  playerRating: number,
  opponentRating: number,
  score: number
): number {
  const pRating = Math.max(0, Math.floor(playerRating))
  const oRating = Math.max(0, Math.floor(opponentRating))
  const expected = 1.0 / (1.0 + Math.pow(10.0, (oRating - pRating) / 400.0))
  return Math.round(RANKED_ELO_K * (score - expected))
}

/**
 * Interfaz con el desglose autoritativo de liquidación ELO devuelto por el servidor.
 */
export interface DetalleLiquidacionElo {
  formulaVersion: 'ranked-elo-v1'
  k: number
  playerBefore: number
  opponentBefore: number
  delta: number
  playerAfter: number
  isAsyncMatch?: boolean
  opponentAfter?: number
  opponentDelta?: number
}
