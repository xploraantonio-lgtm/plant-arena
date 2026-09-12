import { describe, expect, it } from 'vitest'
import {
  aplicarPisoCompetitivo,
  escalarPerfilPorElo,
  obtenerPerfilEstrategico,
} from './strategicAsyncBot.ts'

describe('Rival Semilla - piso competitivo', () => {
  it('normal no cae en un bot trivialmente fácil', () => {
    const p = obtenerPerfilEstrategico('economic', 'normal')
    expect(p.badPlayMargin).toBeLessThanOrEqual(0.08)
    expect(p.irregularity).toBeLessThanOrEqual(0.30)
    expect(p.aggression).toBeGreaterThanOrEqual(0.55)
    expect(p.defense).toBeGreaterThanOrEqual(0.60)
    expect(p.maxProducers).toBeLessThanOrEqual(4)
  })

  it('hard mantiene presión, defensa y oportunismo altos', () => {
    const p = obtenerPerfilEstrategico('economic', 'hard')
    expect(p.badPlayMargin).toBeLessThanOrEqual(0.05)
    expect(p.irregularity).toBeLessThanOrEqual(0.22)
    expect(p.aggression).toBeGreaterThanOrEqual(0.68)
    expect(p.defense).toBeGreaterThanOrEqual(0.68)
    expect(p.opportunism).toBeGreaterThanOrEqual(0.72)
    expect(p.baseReserveSun).toBeLessThanOrEqual(40)
  })

  it('el escalado por ELO suaviza la dificultad para novatos (< 1600 copas)', () => {
    const base = obtenerPerfilEstrategico('balanced', 'normal')
    const lowElo = escalarPerfilPorElo(base, 700)
    expect(lowElo.badPlayMargin).toBe(0.15)
    expect(lowElo.irregularity).toBe(0.45)
    expect(lowElo.reactionMs).toBeGreaterThan(650)
  })

  it('el escalado por ELO mantiene el piso competitivo a partir de 1600 copas', () => {
    const base = obtenerPerfilEstrategico('balanced', 'normal')
    const highElo = escalarPerfilPorElo(base, 1600)
    expect(highElo.badPlayMargin).toBeLessThanOrEqual(0.08)
    expect(highElo.irregularity).toBeLessThanOrEqual(0.30)
  })

  it('respeta elite sin degradarlo', () => {
    const elite = obtenerPerfilEstrategico('balanced', 'elite')
    const tuned = aplicarPisoCompetitivo(elite)
    expect(tuned.badPlayMargin).toBe(elite.badPlayMargin)
    expect(tuned.irregularity).toBe(elite.irregularity)
    expect(tuned.reactionMs).toBe(elite.reactionMs)
  })
})
