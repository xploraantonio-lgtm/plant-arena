// Capa de tuning del Rival Semilla.
// Conserva intacta la IA estratégica original y aplica ajustes reactivos temporales
// antes de cada decisión. Sigue siendo puro y determinista: no usa reloj, DOM,
// Supabase ni aleatoriedad adicional.

import * as Base from './strategicAsyncBot.base.ts'
import type { GameState } from './simulate.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type {
  StrategicDifficulty,
  StrategicMentalState,
  StrategicProfile,
  StrategicStyle,
  LaneEvaluation,
} from './strategicAsyncBot.base.ts'

export * from './strategicAsyncBot.base.ts'

/**
 * Peligro reactivo de un carril.
 *
 * Importante: enemyAttackersCount y enemyDpsPotential del motor base ya incluyen
 * tanto atacantes caminantes como atacantes fijos de rango. Por eso un Peashooter,
 * Repeater, Threepeater o Melonpult que esté ganando DPS en un carril también
 * obliga al Rival Semilla a responder aunque no avance físicamente hacia la base.
 */
export function calcularPeligroCarrilReactivo(lane: LaneEvaluation): number {
  const superioridadDps = Math.max(0, lane.enemyDpsPotential - lane.ownDpsPotential)
  const faltaDeMuro = lane.enemyAttackersCount > 0 && lane.ownDefendersCount === 0 ? 12 : 0
  const inferioridadNumerica = Math.max(0, lane.enemyAttackersCount - lane.ownAttackersCount) * 8

  return Math.max(
    0,
    Math.min(
      140,
      lane.threatScore +
        Math.min(32, superioridadDps * 0.28) +
        faltaDeMuro +
        inferioridadNumerica
    )
  )
}

function tunearPerfilBase(profile: StrategicProfile): StrategicProfile {
  const tuned = { ...profile }

  // Semilla debe presionar con intención, no quedarse acumulando sol.
  if (profile.style === 'balanced' || profile.style === 'opportunistic') {
    tuned.aggression = Math.max(tuned.aggression, 0.84)
    tuned.opportunism = Math.max(tuned.opportunism, 0.86)
    tuned.defense = Math.max(tuned.defense, 0.66)
    tuned.economy = Math.min(tuned.economy, 0.68)
    tuned.baseReserveSun = Math.min(tuned.baseReserveSun, 30)
  } else if (profile.style === 'aggressive') {
    // El perfil agresivo sigue atacando mucho, pero deja de ignorar un carril perdido.
    tuned.defense = Math.max(tuned.defense, 0.52)
    tuned.baseReserveSun = Math.min(tuned.baseReserveSun, 20)
  }

  return tuned
}

export function obtenerPerfilEstrategico(
  style: StrategicStyle = 'balanced',
  difficulty: StrategicDifficulty = 'hard'
): StrategicProfile {
  return tunearPerfilBase(Base.obtenerPerfilEstrategico(style, difficulty))
}

export function escalarPerfilPorElo(
  baseProfile: StrategicProfile,
  playerElo: number = 1200
): StrategicProfile {
  return tunearPerfilBase(Base.escalarPerfilPorElo(baseProfile, playerElo))
}

/**
 * Intercepta únicamente el perfil durante este ciclo de decisión.
 * Al terminar restaura exactamente los valores persistentes del estado mental,
 * preservando replay/verify-match y evitando acumular buffs entre ticks.
 */
export function decidirAccionEstrategica(
  state: GameState,
  deck: CartaDeMazo[],
  slotCooldowns: Record<number, number>,
  sunBank: number,
  mentalState: StrategicMentalState
): ReturnType<typeof Base.decidirAccionEstrategica> {
  const original = mentalState.profile
  const perfilTemporal: StrategicProfile = { ...original }

  // Percepción pura previa: no muta memoria ni personalidad.
  const preview = Base.percibirTablero(state, sunBank, perfilTemporal)
  const peligros = preview.lanes.map(calcularPeligroCarrilReactivo)
  const peligroMax = Math.max(...peligros)

  if (peligroMax >= 72) {
    // Carril realmente en riesgo: respuesta fuerte. No regalar la base por seguir
    // con economía u ofensiva en otro carril.
    perfilTemporal.defense = Math.max(perfilTemporal.defense, 1.08)
    perfilTemporal.economy = Math.min(perfilTemporal.economy, 0.22)
    perfilTemporal.aggression = Math.max(perfilTemporal.aggression, 0.78)
    perfilTemporal.baseReserveSun = 0
    perfilTemporal.badPlayMargin = Math.min(perfilTemporal.badPlayMargin, 0.035)
  } else if (peligroMax >= 45) {
    // Defensa reactiva normal: incluye ranged fijo por DPS sostenido.
    perfilTemporal.defense = Math.max(perfilTemporal.defense, 0.92)
    perfilTemporal.economy = Math.min(perfilTemporal.economy, 0.38)
    perfilTemporal.baseReserveSun = Math.min(perfilTemporal.baseReserveSun, 15)
    perfilTemporal.badPlayMargin = Math.min(perfilTemporal.badPlayMargin, 0.05)
  } else if (peligroMax < 28) {
    // Tablero controlado: convertir sol en presión en vez de esperar.
    perfilTemporal.aggression = Math.max(perfilTemporal.aggression, sunBank >= 125 ? 1.02 : 0.90)
    perfilTemporal.opportunism = Math.max(perfilTemporal.opportunism, 0.96)
    perfilTemporal.economy = Math.min(perfilTemporal.economy, 0.58)
    perfilTemporal.baseReserveSun = Math.min(perfilTemporal.baseReserveSun, sunBank >= 125 ? 0 : 20)
  }

  mentalState.profile = perfilTemporal
  try {
    return Base.decidirAccionEstrategica(state, deck, slotCooldowns, sunBank, mentalState)
  } finally {
    mentalState.profile = original
  }
}
