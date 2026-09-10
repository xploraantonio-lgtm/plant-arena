import { describe, it, expect } from 'vitest'
import { getArenaForElo, getEloDeltasForElo, getTrophyGateForElo } from './arenaManager'

describe('Sistema de Copas Ranked estilo Clash Royale', () => {
  describe('1. Verificación de deltas de copas por Arena (+15/-5, +18/-8, +20/-12, +25/-20, +30/-30)', () => {
    it('Arena 1 (0 - 1600 copas): otorga +15 en victoria y -5 en derrota', () => {
      const deltas1000 = getEloDeltasForElo(1000)
      expect(deltas1000.winElo).toBe(15)
      expect(deltas1000.loseElo).toBe(5)
      expect(deltas1000.surrenderElo).toBe(5)

      const deltas1600 = getEloDeltasForElo(1600)
      expect(deltas1600.winElo).toBe(15)
      expect(deltas1600.loseElo).toBe(5)
    })

    it('Arena 2 (1601 - 2000 copas): otorga +18 en victoria y -8 en derrota', () => {
      const deltas1601 = getEloDeltasForElo(1601)
      expect(deltas1601.winElo).toBe(18)
      expect(deltas1601.loseElo).toBe(8)
      expect(deltas1601.surrenderElo).toBe(8)

      const deltas2000 = getEloDeltasForElo(2000)
      expect(deltas2000.winElo).toBe(18)
      expect(deltas2000.loseElo).toBe(8)
    })

    it('Arena 3 (2001 - 3000 copas): otorga +20 en victoria y -12 en derrota', () => {
      const deltas2001 = getEloDeltasForElo(2001)
      expect(deltas2001.winElo).toBe(20)
      expect(deltas2001.loseElo).toBe(12)
      expect(deltas2001.surrenderElo).toBe(12)

      const deltas3000 = getEloDeltasForElo(3000)
      expect(deltas3000.winElo).toBe(20)
      expect(deltas3000.loseElo).toBe(12)
    })

    it('Arena 4 (3001 - 4000 copas): otorga +25 en victoria y -20 en derrota', () => {
      const deltas3001 = getEloDeltasForElo(3001)
      expect(deltas3001.winElo).toBe(25)
      expect(deltas3001.loseElo).toBe(20)
      expect(deltas3001.surrenderElo).toBe(20)

      const deltas4000 = getEloDeltasForElo(4000)
      expect(deltas4000.winElo).toBe(25)
      expect(deltas4000.loseElo).toBe(20)
    })

    it('Arena 5 (4001+ copas): otorga +30 en victoria y -30 en derrota', () => {
      const deltas4001 = getEloDeltasForElo(4001)
      expect(deltas4001.winElo).toBe(30)
      expect(deltas4001.loseElo).toBe(30)
      expect(deltas4001.surrenderElo).toBe(30)

      const deltas5000 = getEloDeltasForElo(5000)
      expect(deltas5000.winElo).toBe(30)
      expect(deltas5000.loseElo).toBe(30)
    })
  })

  describe('2. Verificación de Descenso entre Arenas y Piso 0', () => {
    it('el piso absoluto es 0 copas (sin pisos artificiales bloqueando descenso)', () => {
      expect(getTrophyGateForElo(900)).toBe(0)
      expect(getTrophyGateForElo(1000)).toBe(0)
      expect(getTrophyGateForElo(1600)).toBe(0)
      expect(getTrophyGateForElo(2000)).toBe(0)
      expect(getTrophyGateForElo(3000)).toBe(0)
      expect(getTrophyGateForElo(4000)).toBe(0)
    })

    it('en derrota, un jugador PUEDE descender a una arena inferior si cae por debajo del umbral', () => {
      // Caso 1: Jugador en Arena 4 con 3010 copas pierde 20 copas
      // Debe descender a 2990 copas y caer a Arena 3
      const eloA4 = 3010
      const deltasA4 = getEloDeltasForElo(eloA4)
      const nuevoEloA4 = Math.max(getTrophyGateForElo(eloA4), eloA4 - deltasA4.loseElo)
      expect(nuevoEloA4).toBe(2990)
      expect(getArenaForElo(nuevoEloA4).id).toBe(3) // Desciende a Arena 3

      // Caso 2: Jugador en Arena 3 con 2005 copas pierde 12 copas
      // Debe descender a 1993 copas y caer a Arena 2
      const eloA3 = 2005
      const deltasA3 = getEloDeltasForElo(eloA3)
      const nuevoEloA3 = Math.max(getTrophyGateForElo(eloA3), eloA3 - deltasA3.loseElo)
      expect(nuevoEloA3).toBe(1993)
      expect(getArenaForElo(nuevoEloA3).id).toBe(2) // Desciende a Arena 2

      // Caso 3: Jugador en Arena 2 con 1604 copas pierde 8 copas
      // Debe descender a 1596 copas y caer a Arena 1
      const eloA2 = 1604
      const deltasA2 = getEloDeltasForElo(eloA2)
      const nuevoEloA2 = Math.max(getTrophyGateForElo(eloA2), eloA2 - deltasA2.loseElo)
      expect(nuevoEloA2).toBe(1596)
      expect(getArenaForElo(nuevoEloA2).id).toBe(1) // Desciende a Arena 1

      // Caso 4: Jugador en Arena 1 con 2 copas pierde 5 copas -> acotado a 0
      const eloBajo = 2
      const deltasBajo = getEloDeltasForElo(eloBajo)
      const nuevoEloBajo = Math.max(getTrophyGateForElo(eloBajo), eloBajo - deltasBajo.loseElo)
      expect(nuevoEloBajo).toBe(0)
    })
  })

  describe('3. Verificación de Transición de Arenas en Victoria', () => {
    it('promociona a Arena 2 al cruzar 1600 copas', () => {
      const eloPrevio = 1595
      const arenaPrevia = getArenaForElo(eloPrevio)
      expect(arenaPrevia.id).toBe(1)

      const deltas = getEloDeltasForElo(eloPrevio)
      const eloNuevo = eloPrevio + deltas.winElo // 1595 + 15 = 1610
      expect(eloNuevo).toBe(1610)

      const arenaNueva = getArenaForElo(eloNuevo)
      expect(arenaNueva.id).toBe(2)
      expect(arenaNueva.name).toContain('Desierto Nocturno')

      // Una vez en Arena 2, el nuevo piso es 1600
      expect(getTrophyGateForElo(eloNuevo)).toBe(1600)
    })
  })
})
