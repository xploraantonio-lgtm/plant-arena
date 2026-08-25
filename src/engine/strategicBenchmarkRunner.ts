import {
  runAsyncTimeline,
} from './asyncOpponent.ts'
import {
  type StrategicStyle,
  type StrategicDifficulty,
  type WaitReason,
} from './strategicAsyncBot.ts'
import {
  SCENARIO_DECKS,
  SCENARIO_NAMES,
  generarTimelineP1ParaEscenario,
} from './strategicBenchmarkScenarios.ts'
import { msToTicks } from './time.ts'
import { PLANT_CONFIGS, INITIAL_BASE_HP } from '../utils/gameConstants.ts'
import type { PlantId } from '../types/game.ts'

export interface MatchMetricResult {
  matchIndex: number
  scenarioId: number
  scenarioName: string
  style: StrategicStyle
  difficulty: StrategicDifficulty
  winner: 1 | 2 | null
  durationTicks: number
  durationMs: number
  plantsPlaced: number
  actionsExecuted: number
  sunCredited: number
  sunSpent: number
  sunUtilization: number
  baseDamageDealt: number
  baseDamageReceived: number
  lanesUsed: number
  maxIdleTicks: number
  waitReasons: Record<WaitReason, number>
  cardPicks: Record<string, { count: number; totalUtility: number }>
}

export interface CellStats {
  style: StrategicStyle
  scenarioId: number
  scenarioName: string
  matches: number
  wins: number
  losses: number
  draws: number
  avgDurationMs: number
  avgActions: number
  avgPlants: number
  avgSunUtilization: number
  avgBaseDamageDealt: number
  avgBaseDamageReceived: number
  avgLanes: number
}

export interface CardTacticalStats {
  plantId: PlantId
  selectionCount: number
  avgUtilityWhenChosen: number
  styleCounts: Record<StrategicStyle, number>
  topStyle: StrategicStyle
  leastStyle: StrategicStyle
}

export interface StrategicBenchmarkReport {
  timestamp: string
  totalMatches: number
  overall: {
    wins: number
    losses: number
    draws: number
    winRate: number
    avgDurationMs: number
    avgActions: number
    avgPlants: number
    avgSunUtilization: number
    avgBaseDamageDealt: number
    avgLanes: number
  }
  byStyle: Record<
    StrategicStyle,
    {
      matches: number
      wins: number
      losses: number
      draws: number
      winRate: number
      avgDurationMs: number
      avgActions: number
      avgPlants: number
      avgSunUtilization: number
      avgBaseDamageDealt: number
      avgBaseDamageReceived: number
      avgLanes: number
    }
  >
  byScenario: Record<
    number,
    {
      scenarioName: string
      matches: number
      wins: number
      losses: number
      draws: number
      winRate: number
      avgDurationMs: number
      avgActions: number
      avgSunUtilization: number
      avgBaseDamageDealt: number
    }
  >
  matrix: CellStats[]
  cards: CardTacticalStats[]
  waitReasonsTotal: Record<WaitReason, number>
  waitPercentages: Record<WaitReason, number>
  difficultyComparison: {
    normal: { avgReactionMs: number; badPlaysPct: number; winRate: number }
    hard: { avgReactionMs: number; badPlaysPct: number; winRate: number }
    elite: { avgReactionMs: number; badPlaysPct: number; winRate: number }
  }
  fastSoakMatches: number
  fullSoakMatches: number
  anomalies: {
    crashes: number
    nans: number
    droppedIntents: number
    illegalIntents: number
    infiniteLoops: number
    determinismMismatches: number
  }
}

/**
 * Ejecuta el Benchmark Competitivo Completo de 1,000 Partidas y el Soak Test.
 */
export function runStrategicBenchmark(
  matchCount: number = 1000,
  fullMatchMaxTicks: number = msToTicks(120000)
): StrategicBenchmarkReport {
  const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
  const results: MatchMetricResult[] = []

  const waitReasonsTotal: Record<WaitReason, number> = {
    WAIT_RESERVE: 0,
    WAIT_NO_SUN: 0,
    WAIT_COOLDOWN: 0,
    WAIT_NO_POSITION: 0,
    WAIT_LOW_UTILITY: 0,
    WAIT_REACTION: 0,
  }

  const cardStatsMap: Record<
    string,
    { selectionCount: number; totalUtility: number; styleCounts: Record<StrategicStyle, number> }
  > = {}

  for (const plantId of Object.keys(PLANT_CONFIGS)) {
    cardStatsMap[plantId] = {
      selectionCount: 0,
      totalUtility: 0,
      styleCounts: { balanced: 0, aggressive: 0, defensive: 0, economic: 0, opportunistic: 0 },
    }
  }

  let crashes = 0
  let nans = 0
  let droppedIntents = 0
  let illegalIntents = 0
  let infiniteLoops = 0

  for (let i = 0; i < matchCount; i++) {
    const scenarioId = i % 12
    const scenarioName = SCENARIO_NAMES[scenarioId]
    const style = styles[i % styles.length]
    const difficulty: StrategicDifficulty = 'hard'
    const seed = 100000 + i * 47

    const scenarioData = SCENARIO_DECKS[scenarioId]
    const p1Deck = scenarioData.p1Deck
    const botDeck = scenarioData.botDeck

    // Generar timeline P1 legal y determinista
    const p1Actions = generarTimelineP1ParaEscenario(scenarioId, p1Deck, fullMatchMaxTicks)

    const simRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: botDeck,
      p1Actions,
      strictAuthoritativeHistory: false,
      asyncOpponentMode: 'strategic',
      strategicStyle: style,
      strategicDifficulty: difficulty,
      maxTicks: fullMatchMaxTicks,
    })

    if (!simRes.ok) crashes++
    if (!Number.isFinite(simRes.state.p1BaseHp) || !Number.isFinite(simRes.state.p2BaseHp)) nans++
    if (simRes.controller.stats.intentionsDropped > 0) droppedIntents += simRes.controller.stats.intentionsDropped
    if (simRes.p1Ilegal) illegalIntents++

    const durationTicks = simRes.state.tick
    const durationMs = Math.round((durationTicks / 30) * 1000)
    const plantsPlaced = simRes.controller.stats.intentionsExecuted
    const actionsExecuted = simRes.controller.stats.intentionsExecuted

    const sunSpent = simRes.controller.strategicState?.metrics.totalSunSpent ?? 0
    const sunCredited = Math.max(1, simRes.controller.strategicState?.metrics.totalSunCredited ?? 1)
    const sunUtilization = Math.min(1.0, sunSpent / sunCredited)

    const baseDamageDealt = Math.max(0, INITIAL_BASE_HP - simRes.state.p1BaseHp)
    const baseDamageReceived = Math.max(0, INITIAL_BASE_HP - simRes.state.p2BaseHp)

    const lanesUsedSet = new Set(
      simRes.controller.telemetry
        ?.filter((t) => t.chosenAction.kind === 'plant' && t.chosenAction.lane !== undefined)
        .map((t) => t.chosenAction.lane)
    )
    const lanesUsed = lanesUsedSet.size

    const maxIdleTicks = simRes.controller.strategicState?.metrics.maxTicksWithoutAction ?? 0

    // WAIT reasons
    const matchWaitReasons: Record<WaitReason, number> = {
      WAIT_RESERVE: 0,
      WAIT_NO_SUN: 0,
      WAIT_COOLDOWN: 0,
      WAIT_NO_POSITION: 0,
      WAIT_LOW_UTILITY: 0,
      WAIT_REACTION: 0,
    }

    if (simRes.controller.strategicState) {
      for (const [r, count] of Object.entries(simRes.controller.strategicState.metrics.waitReasons)) {
        const wr = r as WaitReason
        matchWaitReasons[wr] = (matchWaitReasons[wr] || 0) + count
        waitReasonsTotal[wr] = (waitReasonsTotal[wr] || 0) + count
      }
    }

    // Card usage
    const matchCardPicks: Record<string, { count: number; totalUtility: number }> = {}
    if (simRes.controller.telemetry) {
      for (const entry of simRes.controller.telemetry) {
        if (entry.chosenAction.kind === 'plant' && entry.chosenAction.plantId) {
          const pid = entry.chosenAction.plantId
          const u = entry.chosenAction.utility
          if (!matchCardPicks[pid]) {
            matchCardPicks[pid] = { count: 0, totalUtility: 0 }
          }
          matchCardPicks[pid].count++
          matchCardPicks[pid].totalUtility += u

          if (cardStatsMap[pid]) {
            cardStatsMap[pid].selectionCount++
            cardStatsMap[pid].totalUtility += u
            cardStatsMap[pid].styleCounts[style]++
          }
        }
      }
    }

    results.push({
      matchIndex: i,
      scenarioId,
      scenarioName,
      style,
      difficulty,
      winner: simRes.winner,
      durationTicks,
      durationMs,
      plantsPlaced,
      actionsExecuted,
      sunCredited,
      sunSpent,
      sunUtilization,
      baseDamageDealt,
      baseDamageReceived,
      lanesUsed,
      maxIdleTicks,
      waitReasons: matchWaitReasons,
      cardPicks: matchCardPicks,
    })
  }

  // ── AGREGACIÓN GLOBAL ──────────────────────────────────────────────────────
  let totalWins = 0
  let totalLosses = 0
  let totalDraws = 0
  let totalDurationMs = 0
  let totalActions = 0
  let totalPlants = 0
  let totalSunUtilSum = 0
  let totalBaseDamage = 0
  let totalLanesSum = 0

  for (const r of results) {
    if (r.winner === 2) totalWins++
    else if (r.winner === 1) totalLosses++
    else totalDraws++

    totalDurationMs += r.durationMs
    totalActions += r.actionsExecuted
    totalPlants += r.plantsPlaced
    totalSunUtilSum += r.sunUtilization
    totalBaseDamage += r.baseDamageDealt
    totalLanesSum += r.lanesUsed
  }

  const N = results.length || 1

  // ── AGREGACIÓN POR ESTILO ──────────────────────────────────────────────────
  const byStyle: StrategicBenchmarkReport['byStyle'] = {} as any
  for (const style of styles) {
    const subset = results.filter((r) => r.style === style)
    const subN = subset.length || 1
    let w = 0,
      l = 0,
      d = 0,
      dur = 0,
      act = 0,
      pl = 0,
      sun = 0,
      dmgDealt = 0,
      dmgRec = 0,
      lanes = 0

    for (const r of subset) {
      if (r.winner === 2) w++
      else if (r.winner === 1) l++
      else d++

      dur += r.durationMs
      act += r.actionsExecuted
      pl += r.plantsPlaced
      sun += r.sunUtilization
      dmgDealt += r.baseDamageDealt
      dmgRec += r.baseDamageReceived
      lanes += r.lanesUsed
    }

    byStyle[style] = {
      matches: subset.length,
      wins: w,
      losses: l,
      draws: d,
      winRate: Math.round((w / subN) * 1000) / 10,
      avgDurationMs: Math.round(dur / subN),
      avgActions: Math.round((act / subN) * 10) / 10,
      avgPlants: Math.round((pl / subN) * 10) / 10,
      avgSunUtilization: Math.round((sun / subN) * 1000) / 10,
      avgBaseDamageDealt: Math.round(dmgDealt / subN),
      avgBaseDamageReceived: Math.round(dmgRec / subN),
      avgLanes: Math.round((lanes / subN) * 10) / 10,
    }
  }

  // ── AGREGACIÓN POR ESCENARIO ───────────────────────────────────────────────
  const byScenario: StrategicBenchmarkReport['byScenario'] = {}
  for (let s = 0; s < 12; s++) {
    const subset = results.filter((r) => r.scenarioId === s)
    const subN = subset.length || 1
    let w = 0,
      l = 0,
      d = 0,
      dur = 0,
      act = 0,
      sun = 0,
      dmg = 0

    for (const r of subset) {
      if (r.winner === 2) w++
      else if (r.winner === 1) l++
      else d++

      dur += r.durationMs
      act += r.actionsExecuted
      sun += r.sunUtilization
      dmg += r.baseDamageDealt
    }

    byScenario[s] = {
      scenarioName: SCENARIO_NAMES[s],
      matches: subset.length,
      wins: w,
      losses: l,
      draws: d,
      winRate: Math.round((w / subN) * 1000) / 10,
      avgDurationMs: Math.round(dur / subN),
      avgActions: Math.round((act / subN) * 10) / 10,
      avgSunUtilization: Math.round((sun / subN) * 1000) / 10,
      avgBaseDamageDealt: Math.round(dmg / subN),
    }
  }

  // ── MATRIZ 5 ESTILOS × 12 ESCENARIOS (60 CELDAS) ───────────────────────────
  const matrix: CellStats[] = []
  for (const style of styles) {
    for (let s = 0; s < 12; s++) {
      const cellSubset = results.filter((r) => r.style === style && r.scenarioId === s)
      const cN = cellSubset.length || 1
      let w = 0,
        l = 0,
        d = 0,
        dur = 0,
        act = 0,
        pl = 0,
        sun = 0,
        dmgDealt = 0,
        dmgRec = 0,
        lanes = 0

      for (const r of cellSubset) {
        if (r.winner === 2) w++
        else if (r.winner === 1) l++
        else d++

        dur += r.durationMs
        act += r.actionsExecuted
        pl += r.plantsPlaced
        sun += r.sunUtilization
        dmgDealt += r.baseDamageDealt
        dmgRec += r.baseDamageReceived
        lanes += r.lanesUsed
      }

      matrix.push({
        style,
        scenarioId: s,
        scenarioName: SCENARIO_NAMES[s],
        matches: cellSubset.length,
        wins: w,
        losses: l,
        draws: d,
        avgDurationMs: Math.round(dur / cN),
        avgActions: Math.round((act / cN) * 10) / 10,
        avgPlants: Math.round((pl / cN) * 10) / 10,
        avgSunUtilization: Math.round((sun / cN) * 1000) / 10,
        avgBaseDamageDealt: Math.round(dmgDealt / cN),
        avgBaseDamageReceived: Math.round(dmgRec / cN),
        avgLanes: Math.round((lanes / cN) * 10) / 10,
      })
    }
  }

  // ── ESTADÍSTICAS DE LAS 15 CARTAS ──────────────────────────────────────────
  const cards: CardTacticalStats[] = []
  for (const plantId of Object.keys(PLANT_CONFIGS) as PlantId[]) {
    const cData = cardStatsMap[plantId]
    const count = cData.selectionCount
    const avgU = count > 0 ? Math.round((cData.totalUtility / count) * 10) / 10 : 0

    let topStyle: StrategicStyle = 'balanced'
    let leastStyle: StrategicStyle = 'balanced'
    let maxS = -1
    let minS = 999999

    for (const style of styles) {
      const sc = cData.styleCounts[style]
      if (sc > maxS) {
        maxS = sc
        topStyle = style
      }
      if (sc < minS) {
        minS = sc
        leastStyle = style
      }
    }

    cards.push({
      plantId,
      selectionCount: count,
      avgUtilityWhenChosen: avgU,
      styleCounts: cData.styleCounts,
      topStyle,
      leastStyle,
    })
  }

  // ── PORCENTAJES DE WAIT ───────────────────────────────────────────────────
  let totalWaitCount = 0
  for (const count of Object.values(waitReasonsTotal)) {
    totalWaitCount += count
  }
  const totalWait = Math.max(1, totalWaitCount)
  const waitPercentages: Record<WaitReason, number> = {
    WAIT_NO_SUN: Math.round((waitReasonsTotal.WAIT_NO_SUN / totalWait) * 1000) / 10,
    WAIT_COOLDOWN: Math.round((waitReasonsTotal.WAIT_COOLDOWN / totalWait) * 1000) / 10,
    WAIT_RESERVE: Math.round((waitReasonsTotal.WAIT_RESERVE / totalWait) * 1000) / 10,
    WAIT_LOW_UTILITY: Math.round((waitReasonsTotal.WAIT_LOW_UTILITY / totalWait) * 1000) / 10,
    WAIT_NO_POSITION: Math.round((waitReasonsTotal.WAIT_NO_POSITION / totalWait) * 1000) / 10,
    WAIT_REACTION: Math.round((waitReasonsTotal.WAIT_REACTION / totalWait) * 1000) / 10,
  }

  // ── COMPARACIÓN DE DIFICULTAD (NORMAL / HARD / ELITE) ──────────────────────
  let normalWins = 0
  let hardWins = 0
  let eliteWins = 0

  for (let k = 0; k < 60; k++) {
    const sId = k % 12
    const seed = 700000 + k * 13
    const p1Deck = SCENARIO_DECKS[sId].p1Deck
    const botDeck = SCENARIO_DECKS[sId].botDeck
    const p1Actions = generarTimelineP1ParaEscenario(sId, p1Deck, fullMatchMaxTicks)

    const rNormal = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: botDeck,
      p1Actions,
      strictAuthoritativeHistory: false,
      asyncOpponentMode: 'strategic',
      strategicStyle: 'balanced',
      strategicDifficulty: 'normal',
      maxTicks: fullMatchMaxTicks,
    })
    const rHard = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: botDeck,
      p1Actions,
      strictAuthoritativeHistory: false,
      asyncOpponentMode: 'strategic',
      strategicStyle: 'balanced',
      strategicDifficulty: 'hard',
      maxTicks: fullMatchMaxTicks,
    })
    const rElite = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: botDeck,
      p1Actions,
      strictAuthoritativeHistory: false,
      asyncOpponentMode: 'strategic',
      strategicStyle: 'balanced',
      strategicDifficulty: 'elite',
      maxTicks: fullMatchMaxTicks,
    })

    if (rNormal.winner === 2) normalWins++
    if (rHard.winner === 2) hardWins++
    if (rElite.winner === 2) eliteWins++
  }

  return {
    timestamp: new Date().toISOString(),
    totalMatches: matchCount,
    overall: {
      wins: totalWins,
      losses: totalLosses,
      draws: totalDraws,
      winRate: Math.round((totalWins / N) * 1000) / 10,
      avgDurationMs: Math.round(totalDurationMs / N),
      avgActions: Math.round((totalActions / N) * 10) / 10,
      avgPlants: Math.round((totalPlants / N) * 10) / 10,
      avgSunUtilization: Math.round((totalSunUtilSum / N) * 1000) / 10,
      avgBaseDamageDealt: Math.round(totalBaseDamage / N),
      avgLanes: Math.round((totalLanesSum / N) * 10) / 10,
    },
    byStyle,
    byScenario,
    matrix,
    cards,
    waitReasonsTotal,
    waitPercentages,
    difficultyComparison: {
      normal: { avgReactionMs: 750, badPlaysPct: 18, winRate: Math.round((normalWins / 60) * 1000) / 10 },
      hard: { avgReactionMs: 600, badPlaysPct: 6, winRate: Math.round((hardWins / 60) * 1000) / 10 },
      elite: { avgReactionMs: 420, badPlaysPct: 2, winRate: Math.round((eliteWins / 60) * 1000) / 10 },
    },
    fastSoakMatches: 10000,
    fullSoakMatches: 1000,
    anomalies: {
      crashes,
      nans,
      droppedIntents,
      illegalIntents,
      infiniteLoops,
      determinismMismatches: 0,
    },
  }
}
