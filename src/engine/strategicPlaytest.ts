import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { StrategicStyle } from './strategicAsyncBot.ts'
import type { StrategicTelemetryEntry } from './asyncOpponent.ts'

export interface StrategicBotDeckPreset {
  key: 'balanced' | 'rush' | 'defensive' | 'economic' | 'mixed'
  name: string
  description: string
  deck: CartaDeMazo[]
}

export const STRATEGIC_BOT_DECKS: Record<string, StrategicBotDeckPreset> = {
  balanced: {
    key: 'balanced',
    name: 'Balanceado Estándar',
    description: 'Economía moderada, peashooter, muro y bonkchoy con remate de jalapeño.',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  rush: {
    key: 'rush',
    name: 'Rush Ofensivo Rápido',
    description: 'Presión temprana con ajo aplastador, bonkchoy boxeador y chomper caminante.',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 4, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  defensive: {
    key: 'defensive',
    name: 'Control y Muros Pesados',
    description: 'Doble línea de muros (nuez y nuez alta) con soporte de aloe y daño de retaguardia.',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'aloe', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  economic: {
    key: 'economic',
    name: 'Hiper-Economía & Artillería Pesada',
    description: 'Girasol doble, nuez alta y artillería masiva (melonpult y threepeater).',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'melonpult', level: 2, statRolls: [] },
      { slot: 4, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  mixed: {
    key: 'mixed',
    name: 'Mixto Oportunista',
    description: 'Control de carril con lechuga congelante, threepeater multi-carril y caminantes.',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'chomper', level: 2, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'iceberglettuce', level: 1, statRolls: [] },
    ],
  },
}

export interface StrategicPlaytestConfig {
  style: StrategicStyle
  difficulty: 'hard'
  deckKey: string
  botDeck: CartaDeMazo[]
  seed: number
  isRandomStyle?: boolean
}

export interface HumanPerceptionRating {
  difficulty: number // 1-10
  intelligence: number // 1-10
  fun: number // 1-10
  variety: number // 1-10
  wasStalemateNoticeable: boolean
  didDefendProperly: boolean
  didPunishOpenLanes: boolean
  didChangeLanes: boolean
  feltAbsurdMoments: boolean
  comments: string
}

export interface StrategicPlaytestLog {
  matchId: string
  timestamp: number
  seed: number
  style: StrategicStyle
  difficulty: 'hard'
  botDeckKey: string
  botDeck: CartaDeMazo[]
  playerDeck: CartaDeMazo[]
  winner: 'player' | 'bot' | 'draw'
  durationSeconds: number
  durationTicks: number
  p1BaseHpEnd: number
  p2BaseHpEnd: number
  p1DamageDealt: number
  p2DamageDealt: number
  botPlantsPlaced: number
  botSunCredited: number
  botSunSpent: number
  botFinalSunBank: number
  lanesUsed: [number, number, number]
  waitReasons: Record<string, number>
  stalemateDetections: number
  tacticalMistakes: number
  reactionBlockedTicks: number
  telemetryHistory: StrategicTelemetryEntry[]
  anomaliesDetected: string[]
  humanPerception?: HumanPerceptionRating
}

/**
 * Detecta de forma programática anomalías o comportamientos tácticos cuestionables en una partida.
 * Función pura sin efectos secundarios ni lectura de reloj.
 */
export function detectarAnomaliasDePartida(log: Partial<StrategicPlaytestLog>): string[] {
  const anomalies: string[] = []

  // 1. >15 s con sol alto (>250) sin actuar
  const telemetry = log.telemetryHistory || []
  let ticksHighSunIdle = 0
  for (const t of telemetry) {
    if (t.sunBank > 250 && !t.chosenAction && t.waitReason === 'WAIT_NO_SUN') {
      ticksHighSunIdle++
    }
  }
  if (ticksHighSunIdle > 450) {
    anomalies.push('>15s con reserva de sol alta (>250) sin colocar cartas viables')
  }

  // 2. No rematar base debilitada
  if (log.p1BaseHpEnd !== undefined && log.p1BaseHpEnd > 0 && log.p1BaseHpEnd <= 200 && log.winner === 'draw') {
    anomalies.push('Base de P1 con HP <= 200 no fue rematada durante la partida')
  }

  // 3. Empate prolongado por estancamiento
  if (log.winner === 'draw' && (log.durationSeconds ?? 0) >= 115) {
    anomalies.push('Partida finalizada en Timeout / Empate tras 120s')
  }

  // 4. Utilización de sol del bot baja (<70%)
  if (log.botSunCredited && log.botSunSpent) {
    const util = (log.botSunSpent / log.botSunCredited) * 100
    if (util < 70) {
      anomalies.push(`Utilización de sol baja del bot: ${Math.round(util)}%`)
    }
  }

  return anomalies
}
