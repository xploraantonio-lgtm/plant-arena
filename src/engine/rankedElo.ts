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
 * Aplica el piso de ELO (0) al rating resultante tras un delta.
 *
 * Contrato de Piso ELO:
 * - El sistema ELO es estrictamente suma cero entre jugadores (deltaP1 + deltaP2 = 0)
 *   en todas las condiciones normales.
 * - La única excepción al balance global ocurre cuando un jugador con rating bajo
 *   sufre una derrota cuyo delta negativo lo llevaría por debajo de 0. En tal caso,
 *   su rating final queda acotado en 0 (GREATEST(0, rating + delta)), mientras que
 *   el ganador recibe su incremento estándar completo.
 *
 * @param ratingBefore Rating antes de la partida
 * @param delta Cambio calculado por calcularRankedEloDelta
 * @returns Rating final acotado al piso de 0
 */
export function aplicarPisoElo(ratingBefore: number, delta: number): number {
  return Math.max(0, Math.floor(ratingBefore) + Math.round(delta))
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
