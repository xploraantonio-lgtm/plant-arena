import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  SeasonManager,
  BETA_SEASON_START_UTC,
  BETA_SEASON_DAYS,
  BETA_SEASON_END_UTC,
} from '../utils/seasonManager'

describe('Fase Beta & Temporada 1 Oficial (45 Días - Inicio 31 Agosto 00:00 UTC)', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      length: store.size,
    } as Storage
  })

  it('1. Constantes canónicas: Inicio el 31 de Agosto de 2026 00:00 UTC y duración de 45 días', () => {
    const expectedStart = new Date('2026-08-31T00:00:00.000Z').getTime()
    const expectedEnd = new Date('2026-10-15T00:00:00.000Z').getTime()

    expect(BETA_SEASON_START_UTC).toBe(expectedStart)
    expect(BETA_SEASON_DAYS).toBe(45)
    expect(BETA_SEASON_END_UTC).toBe(expectedEnd)
    expect((expectedEnd - expectedStart) / (86400 * 1000)).toBe(45)
  })

  it('2. Antes de las 00:00 UTC del 31 de Agosto, el temporizador muestra los 45 días completos', () => {
    // Simular 30 de Agosto a las 20:00 UTC
    const beforeStart = new Date('2026-08-30T20:00:00.000Z').getTime()
    const status = SeasonManager.getSeasonStatus(beforeStart)

    expect(status.isStarted).toBe(false)
    expect(status.isEnded).toBe(false)
    expect(status.totalDays).toBe(45)
    expect(status.daysLeft).toBe(45)
    expect(status.formattedCountdown).toBe('45d 0h 0m')
  })

  it('3. A partir de las 00:00 UTC del 31 de Agosto, el cronómetro comienza a disminuir en tiempo real', () => {
    // Exactamente al iniciar (31 de Agosto 00:00 UTC)
    const atStart = new Date('2026-08-31T00:00:00.000Z').getTime()
    const statusAtStart = SeasonManager.getSeasonStatus(atStart)
    expect(statusAtStart.isStarted).toBe(true)
    expect(statusAtStart.isEnded).toBe(false)
    expect(statusAtStart.daysLeft).toBe(45)

    // 12 horas después (31 de Agosto 12:00 UTC) -> 44 días y 12 horas restantes
    const twelveHoursLater = new Date('2026-08-31T12:00:00.000Z').getTime()
    const status12h = SeasonManager.getSeasonStatus(twelveHoursLater)
    expect(status12h.isStarted).toBe(true)
    expect(status12h.daysLeft).toBe(44)
    expect(status12h.hoursLeft).toBe(12)
    expect(status12h.formattedCountdown).toBe('44d 12h 0m')

    // 15 días después (15 de Septiembre 00:00 UTC) -> 30 días restantes
    const fifteenDaysLater = new Date('2026-09-15T00:00:00.000Z').getTime()
    const status15d = SeasonManager.getSeasonStatus(fifteenDaysLater)
    expect(status15d.daysLeft).toBe(30)
    expect(status15d.hoursLeft).toBe(0)
    expect(status15d.formattedCountdown).toBe('30d 0h 0m')
  })

  it('4. Cuando concluyen los 45 días (15 de Octubre 00:00 UTC), marca isEnded = true', () => {
    const afterSeason = new Date('2026-10-15T01:00:00.000Z').getTime()
    const status = SeasonManager.getSeasonStatus(afterSeason)

    expect(status.isEnded).toBe(true)
    expect(status.daysLeft).toBe(0)
    expect(status.hoursLeft).toBe(0)
  })

  it('5. updateFromSupabase actualiza correctamente los datos de temporada', () => {
    SeasonManager.updateFromSupabase({
      season_number: 1,
      starts_at: '2026-08-31T00:00:00.000Z',
      ends_at: '2026-10-15T00:00:00.000Z',
    })

    const duringSeason = new Date('2026-09-01T00:00:00.000Z').getTime()
    const status = SeasonManager.getSeasonStatus(duringSeason)

    expect(status.seasonNumber).toBe(1)
    expect(status.daysLeft).toBe(44)
  })

  describe('Auditoría estática de 51-reset-elo-season-beta.sql', () => {
    const sqlPath = path.resolve(__dirname, '../../supabase/51-reset-elo-season-beta.sql')
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

    it('A. Reinicia elo_rating = 1000 en profiles', () => {
      expect(sqlContent).toContain('UPDATE public.profiles')
      expect(sqlContent).toContain('SET elo_rating = 1000')
    })

    it('B. Reinicia wins, losses, draws a 0 en ranked_player_stats', () => {
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.ranked_player_stats')
      expect(sqlContent).toContain('SET wins = 0')
      expect(sqlContent).toContain('losses = 0')
      expect(sqlContent).toContain('draws = 0')
    })

    it('C. Configura la Temporada 1 de 45 días (2026-08-31 00:00 UTC a 2026-10-15 00:00 UTC)', () => {
      expect(sqlContent).toContain('public.seasons')
      expect(sqlContent).toContain("'Fase Beta: Temporada 1'")
      expect(sqlContent).toContain("'2026-08-31 00:00:00+00'")
      expect(sqlContent).toContain("'2026-10-15 00:00:00+00'")
    })
  })
})
