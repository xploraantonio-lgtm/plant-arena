import type { PlantId } from '../types/game'

export interface ClanMember {
  id: string
  name: string
  role: 'Líder' | 'Colíder' | 'Veterano' | 'Miembro'
  elo: number
  donatedCount: number
  joinedAt: string
  consecutiveRoundsMissed?: number // Rondas seguidas sin participar en guerra (mínimo 2 para poder expulsar por inactividad)
  roundsParticipated?: number // Rondas participadas en la temporada (>= 2 protege contra expulsión hasta fin de temporada)
  walkoverLosses?: number // Derrotas por W.O. por no presentarse (>= 1 permite expulsar)
}

export interface ClanSettings {
  privacy: 'public' | 'request' | 'closed'
  minElo: number
  warPermission: 'leaders' | 'all'
  autoAccept: boolean
}

export interface KickValidationResult {
  canKick: boolean
  isProtected: boolean
  reasonCode: 'PROTECTED_ACTIVE_WARRIOR' | 'INSUFFICIENT_INFRACTIONS' | 'ELIGIBLE_INACTIVE' | 'ELIGIBLE_WALKOVER' | 'LEADER_CANNOT_BE_KICKED'
  message: string
  details: {
    roundsParticipated: number
    consecutiveMissed: number
    walkoverLosses: number
  }
}

export interface ClanDonationRequest {
  id: string
  requesterId: string
  requesterName: string
  plantId: PlantId
  plantName: string
  plantIcon: string
  copiesRequested: number // Always 1
  donors: { donorId: string; donorName: string }[] // Max 3 donors
  createdAt: number
}

export interface ClanDepositLog {
  id: string
  clanId: string
  depositorName: string
  amountUsd: number
  timestamp: number
  reason: 'deposit' | 'fund' | 'join' | 'repair'
}

export interface ClanWarLog {
  id: string
  challengerClanName: string
  defenderClanName: string
  winnerClanName: string
  stolenUsd: number
  timestamp: number
  isRevenge?: boolean
}

export interface ClanData {
  id: string
  name: string
  tag: string
  badge: string
  description: string
  leader: string
  members: ClanMember[]
  vaultUsd: number
  status: 'active' | 'defeated' // Defeated if vault <= 0
  shieldUntil?: number // 24h shield timestamp
  wins: number
  losses: number
  createdAt: string
  fullBonusClaimedMembers: string[] // List of player names/IDs that claimed 2 green packs
  seasonPayoutClaimedMembers: string[]
  settings?: ClanSettings
}

const STORAGE_KEYS = {
  CLANS_LIST: 'plant_arena_clans_list',
  USER_CLAN_ID: 'plant_arena_user_clan_id',
  DONATION_REQUESTS: 'plant_arena_clan_donations',
  WAR_LOGS: 'plant_arena_clan_war_logs',
  ACCOUNT_CLAIMED_FULL_BONUS: 'plant_arena_account_claimed_clan_full_bonus',
  VAULT_DEPOSITS: 'plant_arena_clan_vault_deposits',
}

export class ClanManager {
  static getClans(): ClanData[] {
    const saved = localStorage.getItem(STORAGE_KEYS.CLANS_LIST)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.error('Error parsing clans', e)
      }
    }
    return []
  }

  static saveClans(clans: ClanData[]) {
    localStorage.setItem(STORAGE_KEYS.CLANS_LIST, JSON.stringify(clans))
  }

  static getUserClanId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.USER_CLAN_ID)
  }

  static setUserClanId(clanId: string | null) {
    if (clanId) {
      localStorage.setItem(STORAGE_KEYS.USER_CLAN_ID, clanId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.USER_CLAN_ID)
    }
  }

  static getUserClan(): ClanData | null {
    const clanId = this.getUserClanId()
    if (!clanId) return null
    const clans = this.getClans()
    return clans.find((c) => c.id === clanId) || null
  }

  /**
   * Create a new Clan (Costs $5.00 USD, incepts $5.00 into Clan Vault)
   */
  static createClan(
    name: string,
    tag: string,
    badge: string,
    description: string,
    playerName: string,
    playerElo: number
  ): ClanData {
    const newClan: ClanData = {
      id: `clan-${Date.now()}`,
      name: name.trim().toUpperCase(),
      tag: tag.trim().toUpperCase().startsWith('#') ? tag.trim().toUpperCase() : `#${tag.trim().toUpperCase()}`,
      badge: badge || '🌿',
      description: description.trim() || 'Clan competitivo de Plant Arena.',
      leader: playerName,
      members: [
        {
          id: `player-${Date.now()}`,
          name: playerName,
          role: 'Líder',
          elo: playerElo,
          donatedCount: 0,
          joinedAt: new Date().toISOString().split('T')[0],
        },
      ],
      vaultUsd: 5.0, // Initial $5 in vault from creation
      status: 'active',
      wins: 0,
      losses: 0,
      createdAt: new Date().toISOString().split('T')[0],
      fullBonusClaimedMembers: [],
      seasonPayoutClaimedMembers: [],
    }

    const clans = this.getClans()
    clans.unshift(newClan)
    this.saveClans(clans)
    this.recordDeposit(newClan.id, playerName, 5.0, 'fund')
    this.setUserClanId(newClan.id)
    return newClan
  }

  /**
   * Join an existing clan (Costs $2.00 USD, adds +$2.00 to Clan Vault)
   */
  static joinClan(clanId: string, playerName: string, playerElo: number): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false
    if (clan.members.length >= 15) return false

    // Add member
    clan.members.push({
      id: `player-${Date.now()}`,
      name: playerName,
      role: 'Miembro',
      elo: playerElo,
      donatedCount: 0,
      joinedAt: new Date().toISOString().split('T')[0],
    })

    // Entry fee added to vault
    clan.vaultUsd += 2.0

    this.saveClans(clans)
    this.recordDeposit(clan.id, playerName, 2.0, 'join')
    this.setUserClanId(clan.id)
    return true
  }

  /**
   * Leave clan
   */
  static leaveClan(clanId: string, playerName: string) {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (clan) {
      clan.members = clan.members.filter((m) => m.name !== playerName)
      // If leader leaves and there are other members, assign next leader
      if (clan.leader === playerName && clan.members.length > 0) {
        clan.leader = clan.members[0].name
        clan.members[0].role = 'Líder'
      }
      this.saveClans(clans)
    }
    this.setUserClanId(null)
  }

  /**
   * Get all vault deposit logs for a clan
   */
  static getVaultDeposits(clanId: string): ClanDepositLog[] {
    const saved = localStorage.getItem(STORAGE_KEYS.VAULT_DEPOSITS)
    let all: Record<string, ClanDepositLog[]> = {}
    if (saved) {
      try {
        all = JSON.parse(saved)
      } catch (e) {}
    }
    if (!all[clanId] || all[clanId].length === 0) {
      const clans = this.getClans()
      const clan = clans.find((c) => c.id === clanId)
      const starterMembers = clan?.members || []
      const initialLogs: ClanDepositLog[] = [
        {
          id: `dep-init-1`,
          clanId,
          depositorName: clan?.leader || 'Fundador',
          amountUsd: 5.0,
          timestamp: Date.now() - 86400000 * 3,
          reason: 'fund',
        },
        ...starterMembers.slice(1, 4).map((m, idx) => ({
          id: `dep-init-${idx + 2}`,
          clanId,
          depositorName: m.name,
          amountUsd: 2.0,
          timestamp: Date.now() - 86400000 * (2 - idx * 0.5),
          reason: 'join' as const,
        })),
        ...(starterMembers.length > 2
          ? [
              {
                id: `dep-init-extra`,
                clanId,
                depositorName: starterMembers[1]?.name || 'Colíder',
                amountUsd: 10.0,
                timestamp: Date.now() - 3600000 * 12,
                reason: 'deposit' as const,
              },
            ]
          : []),
      ]
      all[clanId] = initialLogs
      localStorage.setItem(STORAGE_KEYS.VAULT_DEPOSITS, JSON.stringify(all))
    }
    return all[clanId] || []
  }

  /**
   * Record a new deposit to clan vault
   */
  static recordDeposit(
    clanId: string,
    depositorName: string,
    amountUsd: number,
    reason: 'deposit' | 'fund' | 'join' | 'repair' = 'deposit'
  ) {
    const saved = localStorage.getItem(STORAGE_KEYS.VAULT_DEPOSITS)
    let all: Record<string, ClanDepositLog[]> = {}
    if (saved) {
      try {
        all = JSON.parse(saved)
      } catch (e) {}
    }
    if (!all[clanId]) {
      all[clanId] = this.getVaultDeposits(clanId)
    }
    const newLog: ClanDepositLog = {
      id: `dep-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      clanId,
      depositorName,
      amountUsd,
      timestamp: Date.now(),
      reason,
    }
    all[clanId].unshift(newLog)
    localStorage.setItem(STORAGE_KEYS.VAULT_DEPOSITS, JSON.stringify(all))
  }

  /**
   * Deposit free amount to clan vault
   */
  static depositToVault(clanId: string, amountUsd: number, depositorName = 'Tú'): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.vaultUsd = Number((clan.vaultUsd + amountUsd).toFixed(2))
    if (clan.vaultUsd > 0 && clan.status === 'defeated') {
      clan.status = 'active'
    }
    this.saveClans(clans)
    this.recordDeposit(clanId, depositorName, amountUsd, 'deposit')
    return true
  }

  /**
   * Repair Base ($5.00 USD to resurrect defeated clan)
   */
  static repairBase(clanId: string, fixerName = 'Líder'): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.vaultUsd = Math.max(5.0, Number((clan.vaultUsd + 5.0).toFixed(2)))
    clan.status = 'active'
    this.saveClans(clans)
    this.recordDeposit(clanId, fixerName, 5.0, 'repair')
    return true
  }

  /**
   * Check if player already claimed Full Clan bonus (2 green packs)
   */
  static hasClaimedFullClanBonus(playerName: string): boolean {
    const saved = localStorage.getItem(STORAGE_KEYS.ACCOUNT_CLAIMED_FULL_BONUS)
    if (saved) {
      try {
        const list = JSON.parse(saved) as string[]
        return list.includes(playerName)
      } catch (e) {
        return false
      }
    }
    return false
  }

  /**
   * Claim 2 Green Basic Packs for 15/15 full clan
   */
  static claimFullClanBonus(clanId: string, playerName: string): boolean {
    if (this.hasClaimedFullClanBonus(playerName)) return false
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false
    if (clan.members.length < 15) return false

    if (!clan.fullBonusClaimedMembers.includes(playerName)) {
      clan.fullBonusClaimedMembers.push(playerName)
    }
    this.saveClans(clans)

    // Save on account level
    const saved = localStorage.getItem(STORAGE_KEYS.ACCOUNT_CLAIMED_FULL_BONUS)
    let list: string[] = []
    if (saved) {
      try {
        list = JSON.parse(saved)
      } catch (e) {}
    }
    list.push(playerName)
    localStorage.setItem(STORAGE_KEYS.ACCOUNT_CLAIMED_FULL_BONUS, JSON.stringify(list))
    return true
  }

  /**
   * Claim season vault payout
   */
  static claimSeasonVaultPayout(clanId: string, playerName: string): number {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return 0
    if (clan.seasonPayoutClaimedMembers.includes(playerName)) return 0

    const memberCount = Math.max(1, clan.members.length)
    const shareUsd = Number((clan.vaultUsd / memberCount).toFixed(2))

    clan.seasonPayoutClaimedMembers.push(playerName)
    this.saveClans(clans)
    return shareUsd
  }

  /**
   * Seed Donation Requests
   */
  static getDonationRequests(clanId: string): ClanDonationRequest[] {
    const saved = localStorage.getItem(STORAGE_KEYS.DONATION_REQUESTS)
    let all: Record<string, ClanDonationRequest[]> = {}
    if (saved) {
      try {
        all = JSON.parse(saved)
      } catch (e) {}
    }

    if (!all[clanId]) {
      // Default demo donation request from clan members
      all[clanId] = [
        {
          id: `req-${Date.now()}-1`,
          requesterId: 'm2',
          requesterName: 'PyroGuisante',
          plantId: 'peashooter',
          plantName: 'Lanza-guisantes',
          plantIcon: '/game-assets/greenfoot/peashooterpacket1.png',
          copiesRequested: 1,
          donors: [{ donorId: 'm3', donorName: 'SunGoddess' }],
          createdAt: Date.now() - 3600000,
        },
        {
          id: `req-${Date.now()}-2`,
          requesterId: 'm4',
          requesterName: 'LightStrike',
          plantId: 'wallnut',
          plantName: 'Nuez Muralla',
          plantIcon: '/game-assets/greenfoot/walnutpacket1.png',
          copiesRequested: 1,
          donors: [
            { donorId: 'm1', donorName: 'SolarKing_PRO' },
            { donorId: 'm5', donorName: 'GigaNuez' },
          ],
          createdAt: Date.now() - 7200000,
        },
      ]
      localStorage.setItem(STORAGE_KEYS.DONATION_REQUESTS, JSON.stringify(all))
    }

    return all[clanId] || []
  }

  static createDonationRequest(
    clanId: string,
    requesterId: string,
    requesterName: string,
    plantId: PlantId,
    plantName: string,
    plantIcon: string
  ): ClanDonationRequest | null {
    const reqs = this.getDonationRequests(clanId)
    // Check if player already requested in last 24h
    const existing = reqs.find((r) => r.requesterName === requesterName)
    if (existing && Date.now() - existing.createdAt < 86400000) {
      return null // Daily limit reached
    }

    const newReq: ClanDonationRequest = {
      id: `req-${Date.now()}`,
      requesterId,
      requesterName,
      plantId,
      plantName,
      plantIcon,
      copiesRequested: 1,
      donors: [],
      createdAt: Date.now(),
    }

    reqs.unshift(newReq)
    const saved = localStorage.getItem(STORAGE_KEYS.DONATION_REQUESTS)
    let all: Record<string, ClanDonationRequest[]> = saved ? JSON.parse(saved) : {}
    all[clanId] = reqs
    localStorage.setItem(STORAGE_KEYS.DONATION_REQUESTS, JSON.stringify(all))
    return newReq
  }

  static donateToRequest(
    clanId: string,
    requestId: string,
    donorId: string,
    donorName: string
  ): { success: boolean; plantId: PlantId; requesterName: string } | null {
    const reqs = this.getDonationRequests(clanId)
    const req = reqs.find((r) => r.id === requestId)
    if (!req) return null
    if (req.donors.length >= 3) return null // Max 3 donors
    if (req.donors.some((d) => d.donorName === donorName)) return null // Cannot donate twice

    req.donors.push({ donorId, donorName })

    const saved = localStorage.getItem(STORAGE_KEYS.DONATION_REQUESTS)
    let all: Record<string, ClanDonationRequest[]> = saved ? JSON.parse(saved) : {}
    all[clanId] = reqs
    localStorage.setItem(STORAGE_KEYS.DONATION_REQUESTS, JSON.stringify(all))

    // Update donor stats in clan
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (clan) {
      const member = clan.members.find((m) => m.name === donorName)
      if (member) member.donatedCount += 1
      this.saveClans(clans)
    }

    return { success: true, plantId: req.plantId, requesterName: req.requesterName }
  }

  /**
   * Execute Clan War Raid ($5.00 USD Stolen)
   */
  static executeClanRaid(
    attackerClanId: string,
    defenderClanId: string
  ): { success: boolean; winnerClan: ClanData; loserClan: ClanData; stolenAmount: number; error?: string } {
    const clans = this.getClans()
    const attacker = clans.find((c) => c.id === attackerClanId)
    const defender = clans.find((c) => c.id === defenderClanId)
    if (!attacker || !defender) return { success: false, winnerClan: attacker!, loserClan: defender!, stolenAmount: 0, error: 'Clan no encontrado.' }
    if (attacker.status === 'defeated') return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: 'Tu base está en Estado de Derrota. Debes Reparar la Base primero.' }
    if (defender.status === 'defeated') return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: 'El clan rival ya está en Estado de Derrota ($0.00 en tesoro).' }

    // Check 24h shield on defender
    if (defender.shieldUntil && defender.shieldUntil > Date.now()) {
      const hoursLeft = Math.ceil((defender.shieldUntil - Date.now()) / 3600000)
      return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: `El clan rival tiene un Escudo de Protección activo (${hoursLeft}h restantes).` }
    }

    // Top 3 Anti-Bullying rule: Top 3 clans cannot attack clans with more losses than wins
    const sortedByVault = [...clans].sort((a, b) => b.vaultUsd - a.vaultUsd)
    const isAttackerTop3 = sortedByVault.slice(0, 3).some((c) => c.id === attacker.id)
    if (isAttackerTop3 && defender.losses > defender.wins) {
      return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: 'Regla de Fair Play: Los Clanes del Top 3 no pueden atacar a clanes con más derrotas que victorias.' }
    }

    // Win probability based on member ELO
    const attackerEloSum = attacker.members.reduce((acc, m) => acc + m.elo, 0)
    const defenderEloSum = defender.members.reduce((acc, m) => acc + m.elo, 0)
    const attackerWinProb = attackerEloSum >= defenderEloSum ? 0.75 : 0.45
    const attackerWins = Math.random() < attackerWinProb

    const winner = attackerWins ? attacker : defender
    const loser = attackerWins ? defender : attacker

    const stolenAmount = Math.min(5.0, loser.vaultUsd)
    loser.vaultUsd = Math.max(0, Number((loser.vaultUsd - stolenAmount).toFixed(2)))
    winner.vaultUsd = Number((winner.vaultUsd + stolenAmount).toFixed(2))

    winner.wins += 1
    loser.losses += 1

    // If loser vault hits 0 -> State of Defeat
    if (loser.vaultUsd <= 0) {
      loser.status = 'defeated'
    } else {
      // 4 Hour Shield for defeated clan
      loser.shieldUntil = Date.now() + 4 * 3600000
    }

    // Record War Log
    const logs = this.getWarLogs()
    logs.unshift({
      id: `war-${Date.now()}`,
      challengerClanName: attacker.name,
      defenderClanName: defender.name,
      winnerClanName: winner.name,
      stolenUsd: stolenAmount,
      timestamp: Date.now(),
    })
    localStorage.setItem(STORAGE_KEYS.WAR_LOGS, JSON.stringify(logs.slice(0, 30)))

    this.saveClans(clans)
    return { success: true, winnerClan: winner, loserClan: loser, stolenAmount }
  }

  static getWarLogs(): ClanWarLog[] {
    const saved = localStorage.getItem(STORAGE_KEYS.WAR_LOGS)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {}
    }
    return [
      {
        id: 'log-1',
        challengerClanName: 'SOLAR LEGENDS',
        defenderClanName: 'CYBER PLANTS',
        winnerClanName: 'SOLAR LEGENDS',
        stolenUsd: 5.0,
        timestamp: Date.now() - 14400000,
      },
      {
        id: 'log-2',
        challengerClanName: 'ANTIGRAVITY GUILD',
        defenderClanName: 'FROST GUILD',
        winnerClanName: 'ANTIGRAVITY GUILD',
        stolenUsd: 5.0,
        timestamp: Date.now() - 28800000,
      },
    ]
  }

  static getUserWarWins(playerName: string): number {
    const key = `plant_arena_war_wins_${playerName}`
    const saved = localStorage.getItem(key)
    return saved ? parseInt(saved, 10) || 0 : 0
  }

  static incrementUserWarWins(playerName: string): number {
    const key = `plant_arena_war_wins_${playerName}`
    const current = this.getUserWarWins(playerName)
    const updated = current + 1
    localStorage.setItem(key, updated.toString())
    return updated
  }

  static canUserJoinWarBattle(playerName: string): { canJoin: boolean; wins: number; maxWins: number } {
    const wins = this.getUserWarWins(playerName)
    const MAX_WEEKLY_WAR_WINS = 6
    return {
      canJoin: wins < MAX_WEEKLY_WAR_WINS,
      wins,
      maxWins: MAX_WEEKLY_WAR_WINS,
    }
  }

  /**
   * Validate if a member can be kicked according to competitive clan rules:
   * 1) Leader cannot be kicked.
   * 2) If participated in >= 2 war rounds this season -> Protected until end of season.
   * 3) Eligible for kick IF:
   *    - Inactive for >= 2 consecutive war rounds (2 weeks), OR
   *    - Has >= 1 W.O. loss for not attending their scheduled match.
   */
  static validateKickMember(_clan: ClanData, member: ClanMember): KickValidationResult {
    if (member.role === 'Líder') {
      return {
        canKick: false,
        isProtected: true,
        reasonCode: 'LEADER_CANNOT_BE_KICKED',
        message: '👑 El Líder del clan no puede ser expulsado.',
        details: {
          roundsParticipated: member.roundsParticipated || 0,
          consecutiveMissed: member.consecutiveRoundsMissed || 0,
          walkoverLosses: member.walkoverLosses || 0,
        },
      }
    }

    const participated = member.roundsParticipated || 0
    const missed = member.consecutiveRoundsMissed || 0
    const wo = member.walkoverLosses || 0

    // Protection rule: Participated in 2 or more war rounds this season
    if (participated >= 2) {
      return {
        canKick: false,
        isProtected: true,
        reasonCode: 'PROTECTED_ACTIVE_WARRIOR',
        message: `🛡️ MIEMBRO BLINDADO: Este jugador ha participado en ${participated} rondas de Guerra de Clanes en la temporada actual. Por reglamento de protección de jugadores activos, NO puede ser eliminado hasta concluir la Temporada.`,
        details: {
          roundsParticipated: participated,
          consecutiveMissed: missed,
          walkoverLosses: wo,
        },
      }
    }

    // Eligible by Inactivity (>= 2 consecutive missed rounds / 2 weeks)
    if (missed >= 2) {
      return {
        canKick: true,
        isProtected: false,
        reasonCode: 'ELIGIBLE_INACTIVE',
        message: `⚠️ INACTIVIDAD CONFIRMADA: El jugador no ha participado en ${missed} rondas consecutivas de Guerra de Clanes (2 semanas seguidas sin jugar). Expulsión permitida.`,
        details: {
          roundsParticipated: participated,
          consecutiveMissed: missed,
          walkoverLosses: wo,
        },
      }
    }

    // Eligible by Walkover (>= 1 W.O.)
    if (wo >= 1) {
      return {
        canKick: true,
        isProtected: false,
        reasonCode: 'ELIGIBLE_WALKOVER',
        message: `🚨 DERROTA POR W.O.: El jugador tiene ${wo} derrota(s) por no presentarse al combate de guerra asignado. Expulsión permitida por abandono.`,
        details: {
          roundsParticipated: participated,
          consecutiveMissed: missed,
          walkoverLosses: wo,
        },
      }
    }

    // Insufficient infractions
    return {
      canKick: false,
      isProtected: false,
      reasonCode: 'INSUFFICIENT_INFRACTIONS',
      message: `❌ EXPULSIÓN NO PERMITIDA: Para expulsar a un jugador, debe acumular al menos 2 rondas consecutivas sin participar en guerra (tiene ${missed}/2) o haber perdido al menos 1 vez por W.O. por no presentarse (tiene ${wo}/1).`,
      details: {
        roundsParticipated: participated,
        consecutiveMissed: missed,
        walkoverLosses: wo,
      },
    }
  }

  /**
   * Kick member with validation check
   */
  static kickMember(clanId: string, memberId: string): { success: boolean; error?: string } {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return { success: false, error: 'Clan no encontrado.' }

    const member = clan.members.find((m) => m.id === memberId)
    if (!member) return { success: false, error: 'Miembro no encontrado.' }

    const validation = this.validateKickMember(clan, member)
    if (!validation.canKick) {
      return { success: false, error: validation.message }
    }

    clan.members = clan.members.filter((m) => m.id !== memberId)
    this.saveClans(clans)
    return { success: true }
  }

  /**
   * Update clan settings
   */
  static updateClanSettings(clanId: string, settings: ClanSettings): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.settings = { ...settings }
    this.saveClans(clans)
    return true
  }
}
