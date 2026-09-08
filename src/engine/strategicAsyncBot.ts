// Capa de dificultad consistente para Rival Semilla.
// La implementación estratégica completa se conserva intacta en strategicAsyncBot.base.ts.
// Esta capa solo endurece los perfiles normal/hard para evitar partidas trivialmente fáciles
// sin tocar daño, vida, cooldowns, economía del jugador ni determinismo.

export * from './strategicAsyncBot.base.ts'

import * as base from './strategicAsyncBot.base.ts'
import type { GameState } from './simulate.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type {
  CandidateAction,
  StrategicDifficulty,
  StrategicMentalState,
  StrategicPerception,
  StrategicProfile,
  StrategicStyle,
  StrategicTelemetryEntry,
} from './strategicAsyncBot.base.ts'

/**
 * Garantiza un suelo mínimo de competencia sin convertir al bot en perfecto.
 *
 * normal = exige atención y castiga errores.
 * hard   = presiona, defiende y contraataca con mucha más consistencia.
 * elite  = se conserva como estaba.
 */
export function aplicarPisoCompetitivo(profile: StrategicProfile): StrategicProfile {
  const difficulty = profile.difficulty ?? 'hard'

  if (difficulty === 'elite') {
    return { ...profile }
  }

  if (difficulty === 'normal') {
    return {
      ...profile,
      aggression: Math.max(profile.aggression, 0.55),
      defense: Math.max(profile.defense, 0.60),
      opportunism: Math.max(profile.opportunism, 0.60),
      reactionMs: Math.min(profile.reactionMs, 650),
      badPlayMargin: Math.min(profile.badPlayMargin, 0.08),
      irregularity: Math.min(profile.irregularity, 0.30),
      baseReserveSun: Math.min(profile.baseReserveSun, 50),
      targetProducers: Math.min(profile.targetProducers, 3),
      maxProducers: Math.min(profile.maxProducers, 4),
    }
  }

  // HARD = "Semilla bueno": menos decisiones flojas y menos pasividad,
  // pero todavía con reacción humana y alternativas entre jugadas cercanas.
  return {
    ...profile,
    aggression: Math.max(profile.aggression, 0.68),
    defense: Math.max(profile.defense, 0.68),
    opportunism: Math.max(profile.opportunism, 0.72),
    reactionMs: Math.min(profile.reactionMs, 540),
    badPlayMargin: Math.min(profile.badPlayMargin, 0.04),
    irregularity: Math.min(profile.irregularity, 0.22),
    baseReserveSun: Math.min(profile.baseReserveSun, 40),
    targetProducers: Math.min(profile.targetProducers, 3),
    maxProducers: Math.min(profile.maxProducers, 3),
  }
}

export function obtenerPerfilEstrategico(
  style: StrategicStyle = 'balanced',
  difficulty: StrategicDifficulty = 'hard'
): StrategicProfile {
  return aplicarPisoCompetitivo(base.obtenerPerfilEstrategico(style, difficulty))
}

export function escalarPerfilPorElo(
  baseProfile: StrategicProfile,
  playerElo: number = 1200
): StrategicProfile {
  // El escalado por ELO puede aumentar de nuevo el margen de error; lo capamos
  // después para que ninguna semilla caiga por debajo del suelo de dificultad.
  return aplicarPisoCompetitivo(base.escalarPerfilPorElo(baseProfile, playerElo))
}

export function decidirAccionEstrategica(
  state: GameState,
  deck: CartaDeMazo[],
  slotCooldowns: Record<number, number>,
  sunBank: number,
  mentalState: StrategicMentalState
): {
  decision: CandidateAction | null
  perception: StrategicPerception
  telemetryEntry?: StrategicTelemetryEntry
} {
  // También protege perfiles custom o estados restaurados de partidas antiguas.
  const tuned = aplicarPisoCompetitivo(mentalState.profile)
  mentalState.profile = tuned
  return base.decidirAccionEstrategica(state, deck, slotCooldowns, sunBank, mentalState)
}
