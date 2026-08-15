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
const SEASON_DAYS = 30
const SEASON_MS = SEASON_DAYS * 24 * 60 * 60 * 1000

export class SeasonManager {
  static getSeasonStart(): number {
    const saved = localStorage.getItem(SEASON_KEY)
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!isNaN(parsed)) return parsed
    }
    // Set season start to 6 days ago so there are ~24 days left in the 30-day demo season
    const defaultStart = Date.now() - 6 * 24 * 60 * 60 * 1000
    localStorage.setItem(SEASON_KEY, defaultStart.toString())
    return defaultStart
  }

  static getSeasonStatus(): SeasonStatus {
    const start = this.getSeasonStart()
    const now = Date.now()
    const elapsed = now - start
    const remainingMs = Math.max(0, SEASON_MS - elapsed)

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
      seasonNumber: 1,
      totalDays: SEASON_DAYS,
      daysLeft: days,
      hoursLeft: hours,
      minutesLeft: minutes,
      secondsLeft: seconds,
      isEnded,
      formattedCountdown,
    }
  }

  // Force end season for testing
  static setSeasonEndedForTest(ended: boolean) {
    if (ended) {
      localStorage.setItem(SEASON_KEY, (Date.now() - SEASON_MS - 1000).toString())
    } else {
      localStorage.setItem(SEASON_KEY, (Date.now() - 6 * 24 * 60 * 60 * 1000).toString())
    }
  }
}
