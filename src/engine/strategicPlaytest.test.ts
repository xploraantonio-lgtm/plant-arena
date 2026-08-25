import { describe, it, expect, beforeEach } from 'vitest'
import {
  STRATEGIC_BOT_DECKS,
  detectarAnomaliasDePartida,
  type StrategicPlaytestLog,
} from './strategicPlaytest'
import {
  savePlaytestLog,
  getPlaytestLogs,
  updatePlaytestPerception,
  clearPlaytestLogs,
  exportPlaytestLogsJSON,
} from '../utils/strategicPlaytestStorage'
import { PLANT_CONFIGS } from '../utils/gameConstants'
import { createBattleState, stepTick } from './simulate'
import { createStrategicOpponentController, stepAsyncOpponent } from './asyncOpponent'

describe('Strategic Playtest V1 Module', () => {
  beforeEach(() => {
    clearPlaytestLogs()
  })

  describe('Preset Decks Validation', () => {
    const deckKeys = Object.keys(STRATEGIC_BOT_DECKS)

    it('has all 5 required preset decks', () => {
      expect(deckKeys).toEqual(['balanced', 'rush', 'defensive', 'economic', 'mixed'])
    })

    it.each(deckKeys)('deck %s contains legal plants and valid slots', (key) => {
      const preset = STRATEGIC_BOT_DECKS[key]
      expect(preset.deck.length).toBeLessThanOrEqual(6)
      expect(preset.deck.length).toBeGreaterThanOrEqual(4)

      const usedSlots = new Set<number>()
      for (const card of preset.deck) {
        expect(PLONT_IS_VALID(card.plantId)).toBe(true)
        expect(typeof card.slot).toBe('number')
        if (typeof card.slot === 'number') {
          expect(card.slot).toBeGreaterThanOrEqual(0)
          expect(card.slot).toBeLessThan(6)
          expect(usedSlots.has(card.slot)).toBe(false)
          usedSlots.add(card.slot)
        }
      }
    })
  })

  describe('Anomaly Detection', () => {
    it('detects high sun idle (>15s without playing cards)', () => {
      const telemetry: any[] = []
      // 460 ticks with sunBank > 250 and WAIT_NO_SUN / no action
      for (let i = 0; i < 460; i++) {
        telemetry.push({
          sunBank: 300,
          chosenAction: null,
          waitReason: 'WAIT_NO_SUN',
        })
      }

      const log: Partial<StrategicPlaytestLog> = {
        telemetryHistory: telemetry,
        winner: 'draw',
      }

      const anomalies = detectarAnomaliasDePartida(log)
      expect(anomalies.some((a) => a.includes('>15s con reserva de sol alta'))).toBe(true)
    })

    it('detects unexecuted finisher on weakened base (HP <= 200 in draw)', () => {
      const log: Partial<StrategicPlaytestLog> = {
        p1BaseHpEnd: 150,
        winner: 'draw',
        durationSeconds: 120,
      }

      const anomalies = detectarAnomaliasDePartida(log)
      expect(anomalies.some((a) => a.includes('HP <= 200 no fue rematada'))).toBe(true)
    })

    it('detects low sun utilization (<70%)', () => {
      const log: Partial<StrategicPlaytestLog> = {
        botSunCredited: 1000,
        botSunSpent: 500, // 50% utilization
        winner: 'draw',
      }

      const anomalies = detectarAnomaliasDePartida(log)
      expect(anomalies.some((a) => a.includes('Utilización de sol baja'))).toBe(true)
    })
  })

  describe('LocalStorage Persistence & Export', () => {
    it('saves, retrieves, updates perception and exports logs', () => {
      const mockLog: StrategicPlaytestLog = {
        matchId: 'playtest_test_1',
        timestamp: Date.now(),
        seed: 4242,
        style: 'aggressive',
        difficulty: 'hard',
        botDeckKey: 'rush',
        botDeck: STRATEGIC_BOT_DECKS.rush.deck,
        playerDeck: STRATEGIC_BOT_DECKS.balanced.deck,
        winner: 'bot',
        durationSeconds: 75,
        durationTicks: 2250,
        p1BaseHpEnd: 0,
        p2BaseHpEnd: 480,
        p1DamageDealt: 20,
        p2DamageDealt: 600,
        botPlantsPlaced: 8,
        botSunCredited: 850,
        botSunSpent: 800,
        botFinalSunBank: 50,
        lanesUsed: [3, 2, 3],
        waitReasons: { WAIT_COOLDOWN: 10 },
        stalemateDetections: 0,
        tacticalMistakes: 0,
        reactionBlockedTicks: 0,
        telemetryHistory: [],
        anomaliesDetected: [],
      }

      savePlaytestLog(mockLog)
      const logs = getPlaytestLogs()
      expect(logs.length).toBe(1)
      expect(logs[0].matchId).toBe('playtest_test_1')

      updatePlaytestPerception('playtest_test_1', {
        difficulty: 9,
        intelligence: 8,
        fun: 9,
        variety: 8,
        wasStalemateNoticeable: false,
        didDefendProperly: true,
        didPunishOpenLanes: true,
        didChangeLanes: true,
        feltAbsurdMoments: false,
        comments: 'Excelente presión en carril superior.',
      })

      const updated = getPlaytestLogs()
      expect(updated[0].humanPerception?.difficulty).toBe(9)
      expect(updated[0].humanPerception?.comments).toBe('Excelente presión en carril superior.')

      const json = exportPlaytestLogsJSON()
      expect(json).toContain('playtest_test_1')
      expect(json).toContain('Excelente presión en carril superior.')
    })
  })

  describe('Live Playtest Game Loop Simulation', () => {
    it('executes a simulation against each of the 5 decks with HARD StrategicPolicy', () => {
      const styles = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic'] as const
      const deckKeys = ['balanced', 'rush', 'defensive', 'economic', 'mixed'] as const

      for (let i = 0; i < 5; i++) {
        const style = styles[i]
        const deckKey = deckKeys[i]
        const botDeck = STRATEGIC_BOT_DECKS[deckKey].deck

        const state = createBattleState(1000 + i, false, true, undefined, 'auth-v2')
        const controller = createStrategicOpponentController(botDeck, {
          style,
          difficulty: 'hard',
          roomSeed: 1000 + i,
        })

        // Run 600 ticks (20s) of simulation
        for (let t = 0; t < 600; t++) {
          stepAsyncOpponent(controller, state)
          stepTick(state)
        }

        // Verify bot placed plants and collected sun
        expect(controller.sunBank).toBeGreaterThanOrEqual(0)
        expect(controller.strategicState?.metrics.actionsExecuted).toBeGreaterThan(0)
        expect(controller.telemetry?.length).toBeGreaterThan(0)
      }
    })
  })
})

function PLONT_IS_VALID(plantId: string): boolean {
  return plantId in PLANT_CONFIGS
}
