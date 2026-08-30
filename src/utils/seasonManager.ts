export interface SeasonStatus {
  seasonNumber: number
  totalDays: number
  daysLeft: number
  hoursLeft: number
  minutesLeft: number
  secondsLeft: number
  isStarted: boolean
  isEnded: boolean
  formattedCountdown: string
}

const SEASON_KEY = 'plant_arena_season_start'
const SEASON_END_KEY = 'plant_arena_season_end'
const SEASON_NUM_KEY = 'plant_arena_season_num'

// ── TEMPORADA 1 OFICIAL (FASE BETA: 45 DÍAS DESDE 31 AGOSTO 2026 00:00 UTC) ──
export const BETA_SEASON_START_UTC = new Date('2026-08-31T00:00:00.000Z').getTime()
export const BETA_SEASON_DAYS = 45
export const BETA_SEASON_END_UTC = BETA_SEASON_START_UTC + BETA_SEASON_DAYS * 86400 * 1000 // 2026-10-15T00:00:00.000Z

function getStorageItem(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  return null
}

function setStorageItem(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value)
    } catch {}
  }
}

export class SeasonManager {
  static updateFromSupabase(season: { season_number?: number; starts_at?: string; ends_at?: string } | null) {
    if (!season) return
    if (season.starts_at) {
      setStorageItem(SEASON_KEY, new Date(season.starts_at).getTime().toString())
    }
    if (season.ends_at) {
      setStorageItem(SEASON_END_KEY, new Date(season.ends_at).getTime().toString())
    }
    if (season.season_number) {
      setStorageItem(SEASON_NUM_KEY, season.season_number.toString())
    }
  }

  static getSeasonStatus(customNow?: number): SeasonStatus {
    const now = customNow ?? Date.now()
    const savedEnd = getStorageItem(SEASON_END_KEY)
    const savedStart = getStorageItem(SEASON_KEY)
    const savedNum = getStorageItem(SEASON_NUM_KEY)

    const startMs = savedStart ? parseInt(savedStart, 10) : BETA_SEASON_START_UTC
    const endMs = savedEnd ? parseInt(savedEnd, 10) : (startMs + BETA_SEASON_DAYS * 86400 * 1000)
    const seasonNumber = savedNum ? parseInt(savedNum, 10) : 1

    const isStarted = now >= startMs
    const isEnded = now >= endMs

    // Si aún no arranca (antes de las 00:00 UTC del 31 de Agosto), el cronómetro
    // muestra la duración total de 45 días lista para comenzar.
    let remainingMs: number
    if (!isStarted) {
      remainingMs = Math.max(0, endMs - startMs)
    } else {
      remainingMs = Math.max(0, endMs - now)
    }

    const totalDays = Math.max(1, Math.ceil((endMs - startMs) / (86400 * 1000)))

    const totalSeconds = Math.floor(remainingMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    let formattedCountdown = `${days}d ${hours}h ${minutes}m`
    if (days === 0 && hours === 0) {
      formattedCountdown = `${minutes}m ${seconds}s`
    } else if (days === 0) {
      formattedCountdown = `${hours}h ${minutes}m ${seconds}s`
    }

    return {
      seasonNumber,
      totalDays,
      daysLeft: days,
      hoursLeft: hours,
      minutesLeft: minutes,
      secondsLeft: seconds,
      isStarted,
      isEnded,
      formattedCountdown,
    }
  }
}
