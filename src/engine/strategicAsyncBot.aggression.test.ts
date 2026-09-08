import { describe, expect, it } from 'vitest'
import { calcularPeligroCarrilReactivo, type LaneEvaluation } from './strategicAsyncBot.ts'

function lane(overrides: Partial<LaneEvaluation> = {}): LaneEvaluation {
  return {
    lane: 0,
    enemyPressure: 0,
    ownPressure: 0,
    enemyAttackersCount: 0,
    enemyDefendersCount: 0,
    enemyProducersCount: 0,
    ownAttackersCount: 0,
    ownDefendersCount: 0,
    ownProducersCount: 0,
    availableSpace: 6,
    proximityEnemyToBase: 0,
    proximityOwnToEnemyBase: 0,
    enemyDpsPotential: 0,
    ownDpsPotential: 0,
    enemyHpTotal: 0,
    ownHpTotal: 0,
    threatScore: 0,
    attackOpportunityScore: 0,
    isSaturated: false,
    isVulnerable: false,
    flankPriority: 0,
    ...overrides,
  }
}

describe('Rival Semilla - presión reactiva por carril', () => {
  it('considera crítico un carril con atacantes fijos de alto DPS aunque no haya proximidad', () => {
    const rangedLane = lane({
      enemyAttackersCount: 2,
      enemyDpsPotential: 95,
      ownDpsPotential: 12,
      ownDefendersCount: 0,
      threatScore: 48,
      proximityEnemyToBase: 0,
    })

    expect(calcularPeligroCarrilReactivo(rangedLane)).toBeGreaterThanOrEqual(72)
  })

  it('reduce la urgencia si Semilla ya tiene DPS y muro suficientes en ese carril', () => {
    const exposed = calcularPeligroCarrilReactivo(lane({
      enemyAttackersCount: 2,
      enemyDpsPotential: 80,
      ownDpsPotential: 5,
      ownDefendersCount: 0,
      threatScore: 50,
    }))

    const covered = calcularPeligroCarrilReactivo(lane({
      enemyAttackersCount: 2,
      enemyDpsPotential: 80,
      ownAttackersCount: 2,
      ownDpsPotential: 75,
      ownDefendersCount: 1,
      threatScore: 28,
    }))

    expect(exposed).toBeGreaterThan(covered)
  })
})
