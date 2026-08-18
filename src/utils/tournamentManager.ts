export type TournamentType = 'free_code' | 'paid'

export interface TournamentDefinition {
  id: string
  name: string
  type: TournamentType
  entryCostGems: number
  accessCode?: string // For free_code tournaments
  durationMinutes: number
  startDelaySeconds: number // Time until tournament starts
  description: string
  badgeText: string
  icon: string
  prizeInfo: string
}

export interface TournamentLeaderboardEntry {
  rank: number
  name: string
  avatar: string
  isUser: boolean
  wins: number
  losses: number
  isEliminated: boolean
}

export interface ActiveTournamentSession {
  tournamentId: string
  tournamentName: string
  registered: boolean
  startTimeMs: number
  endTimeMs: number
  userWins: number
  userLosses: number
  maxLosses: number // 3
  isEliminated: boolean
  leaderboard: TournamentLeaderboardEntry[]
}

const STORAGE_KEYS = {
  DEV_CODES: 'plant_arena_tournament_dev_codes',
  SESSIONS: 'plant_arena_tournament_sessions',
}

const DEFAULT_ACCESS_CODES: Record<string, string> = {
  tourney_free_1: 'ARENA2026',
  tourney_free_2: 'DEVVIP',
}

export const TOURNAMENT_CATALOG: TournamentDefinition[] = [
  {
    id: 'tourney_free_1',
    name: '🏆 Gran Copa Botánica (Acceso con Código)',
    type: 'free_code',
    entryCostGems: 0,
    accessCode: 'ARENA2026',
    durationMinutes: 60,
    startDelaySeconds: 60, // 1 min countdown for testing
    description: 'Torneo oficial abierto de 1 hora con cupo ilimitado. Máximo 3 derrotas. Los jugadores con más victorias lideran el Top 3.',
    badgeText: 'GRATIS CON CÓDIGO',
    icon: '🏆',
    prizeInfo: 'Premios anunciados por el organizador',
  },
  {
    id: 'tourney_paid_1',
    name: '💎 Masters Cup Premium (Entrada 2 Gemas)',
    type: 'paid',
    entryCostGems: 2.0,
    durationMinutes: 60,
    startDelaySeconds: 120, // 2 mins countdown
    description: 'Torneo competitivo. 1 hora de combates en matchmaking. Los 3 jugadores con más victorias alcanzan el Podio de Honor.',
    badgeText: 'COMPETITIVO',
    icon: '💎',
    prizeInfo: 'Premios anunciados por el organizador',
  },
  {
    id: 'tourney_free_2',
    name: '🌱 Torneo Relámpago Devs (Código Exclusivo)',
    type: 'free_code',
    entryCostGems: 0,
    accessCode: 'DEVVIP',
    durationMinutes: 45,
    startDelaySeconds: 30,
    description: 'Mini-torneo rápido organizado por los desarrolladores para la comunidad activa.',
    badgeText: 'CÓDIGO DEV',
    icon: '🎪',
    prizeInfo: 'Premios anunciados por el organizador',
  },
]

export const TournamentManager = {
  getAccessCode(tournamentId: string): string {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DEV_CODES)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed[tournamentId]) return parsed[tournamentId]
      }
    } catch {}
    return DEFAULT_ACCESS_CODES[tournamentId] || 'ARENA2026'
  },

  setAccessCode(tournamentId: string, newCode: string): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DEV_CODES)
      const current = saved ? JSON.parse(saved) : { ...DEFAULT_ACCESS_CODES }
      current[tournamentId] = newCode.trim().toUpperCase()
      localStorage.setItem(STORAGE_KEYS.DEV_CODES, JSON.stringify(current))
    } catch {}
  },

  validateAccessCode(tournamentId: string, inputCode: string): boolean {
    const validCode = this.getAccessCode(tournamentId)
    return validCode.trim().toUpperCase() === inputCode.trim().toUpperCase()
  },

  getSession(tournamentId: string): ActiveTournamentSession | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS)
      if (saved) {
        const parsed: Record<string, ActiveTournamentSession> = JSON.parse(saved)
        return parsed[tournamentId] || null
      }
    } catch {}
    return null
  },

  getAllSessions(): Record<string, ActiveTournamentSession> {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  },

  saveSession(session: ActiveTournamentSession): void {
    try {
      const all = this.getAllSessions()
      all[session.tournamentId] = session
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(all))
    } catch {}
  },

  registerPlayer(tournament: TournamentDefinition, userName = 'Tú'): ActiveTournamentSession {
    const now = Date.now()
    const startTimeMs = now + tournament.startDelaySeconds * 1000
    const endTimeMs = startTimeMs + tournament.durationMinutes * 60 * 1000

    const initialLeaderboard: TournamentLeaderboardEntry[] = [
      {
        rank: 1,
        name: userName,
        avatar: 'sunflower',
        isUser: true,
        wins: 0,
        losses: 0,
        isEliminated: false,
      },
    ]

    const session: ActiveTournamentSession = {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      registered: true,
      startTimeMs,
      endTimeMs,
      userWins: 0,
      userLosses: 0,
      maxLosses: 3,
      isEliminated: false,
      leaderboard: initialLeaderboard,
    }

    this.saveSession(session)
    return session
  },

  forceStartTournament(tournamentId: string): ActiveTournamentSession | null {
    const session = this.getSession(tournamentId)
    if (!session) return null
    session.startTimeMs = Date.now() - 1000 // Force it live
    this.saveSession(session)
    return session
  },

  resolveMatch(tournamentId: string, userWon: boolean): ActiveTournamentSession | null {
    const session = this.getSession(tournamentId)
    if (!session) return null

    if (userWon) {
      session.userWins += 1
    } else {
      session.userLosses += 1
      if (session.userLosses >= session.maxLosses) {
        session.isEliminated = true
      }
    }

    // Simulate competitor match resolutions to keep the leaderboard moving
    session.leaderboard = session.leaderboard.map((entry) => {
      if (entry.isUser) {
        return {
          ...entry,
          wins: session.userWins,
          losses: session.userLosses,
          isEliminated: session.isEliminated,
        }
      }

      // If competitor is already eliminated, keep them as is
      if (entry.isEliminated) return entry

      // Random chance for bots to gain a win or loss
      const shouldPlay = Math.random() < 0.7
      if (!shouldPlay) return entry

      const botWon = Math.random() < 0.55
      const newWins = entry.wins + (botWon ? 1 : 0)
      const newLosses = entry.losses + (botWon ? 0 : 1)
      const isElim = newLosses >= 3

      return {
        ...entry,
        wins: newWins,
        losses: newLosses,
        isEliminated: isElim,
      }
    })

    // Sort leaderboard by wins descending, then by losses ascending
    session.leaderboard.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      return a.losses - b.losses
    })

    // Re-assign ranks
    session.leaderboard.forEach((entry, idx) => {
      entry.rank = idx + 1
    })

    this.saveSession(session)
    return session
  },

  getActiveMatchOpponent(session: ActiveTournamentSession): { name: string; avatar: string } {
    const activeBots = session.leaderboard.filter((e) => !e.isUser && !e.isEliminated)
    if (activeBots.length > 0) {
      const randomBot = activeBots[Math.floor(Math.random() * activeBots.length)]
      return { name: randomBot.name, avatar: randomBot.avatar }
    }
    return { name: 'Rival de Torneo #7', avatar: 'melonpult' }
  },

  getUserRank(session: ActiveTournamentSession): number {
    const userEntry = session.leaderboard.find((e) => e.isUser)
    return userEntry ? userEntry.rank : session.leaderboard.length
  },
}
