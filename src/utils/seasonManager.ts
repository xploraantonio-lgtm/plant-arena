export interface SeasonStatus {
  seasonNumber: number
  totalDays: number
  daysLeft: number
  hoursLeft: number
  minutesLeft: number
  secondsLeft: number
  isEnded: boolean
  formattedCountdown: string
}

const SEASON_KEY = 'plant_arena_season_start'
const SEASON_END_KEY = 'plant_arena_season_end'
const SEASON_NUM_KEY = 'plant_arena_season_num'
const DEFAULT_SEASON_DAYS = 30

export class SeasonManager {
  static updateFromSupabase(season: { season_number?: number; starts_at?: string; ends_at?: string } | null) {
    if (!season) return
    if (season.starts_at) {
      localStorage.setItem(SEASON_KEY, new Date(season.starts_at).getTime().toString())
    }
    if (season.ends_at) {
      localStorage.setItem(SEASON_END_KEY, new Date(season.ends_at).getTime().toString())
    }
    if (season.season_number) {
      localStorage.setItem(SEASON_NUM_KEY, season.season_number.toString())
    }
  }

  static getSeasonStatus(): SeasonStatus {
    const now = Date.now()
    const savedEnd = localStorage.getItem(SEASON_END_KEY)
    const savedStart = localStorage.getItem(SEASON_KEY)
    const savedNum = localStorage.getItem(SEASON_NUM_KEY)

    const endMs = savedEnd ? parseInt(savedEnd, 10) : now + DEFAULT_SEASON_DAYS * 86400 * 1000
    const startMs = savedStart ? parseInt(savedStart, 10) : now
    const seasonNumber = savedNum ? parseInt(savedNum, 10) : 1

    const remainingMs = Math.max(0, endMs - now)
    const totalDays = Math.max(1, Math.ceil((endMs - startMs) / (86400 * 1000)))

    const totalSeconds = Math.floor(remainingMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const isEnded = remainingMs <= 0

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
      isEnded,
      formattedCountdown,
    }
  }
}
