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
  rewardPercentage?: number // Cuota porcentual asignada para el reparto de ganancias (0 - 100%)
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

export interface ClanJoinRequest {
  id: string
  clanId: string
  userId: string
  username: string
  elo: number
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

export interface ClanInvitation {
  id: string
  clanId: string
  clanName: string
  clanTag: string
  clanBadge: string
  clanDescription: string
  leaderName: string
  invitedUsername: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
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
  vaultGems?: number
  status: 'active' | 'defeated' // Active by default, Defeated only if depleted in war
  shieldUntil?: number // 24h shield timestamp
  wins: number
  losses: number
  createdAt: string
  fullBonusClaimedMembers: string[] // List of player names/IDs that claimed 2 green packs
  seasonPayoutClaimedMembers: string[]
  settings?: ClanSettings
  rewardShares?: Record<string, number>
  damageDealt?: number
  dailyDamageDealt?: number
}

const STORAGE_KEYS = {
  CLANS_LIST: 'plant_arena_clans_list',
  USER_CLAN_ID: 'plant_arena_user_clan_id',
  DONATION_REQUESTS: 'plant_arena_clan_donations',
  WAR_LOGS: 'plant_arena_clan_war_logs',
  ACCOUNT_CLAIMED_FULL_BONUS: 'plant_arena_account_claimed_clan_full_bonus',
  VAULT_DEPOSITS: 'plant_arena_clan_vault_deposits',
  JOIN_REQUESTS: 'plant_arena_clan_join_requests',
  CLAN_INVITATIONS: 'plant_arena_clan_invitations',
}

export class ClanManager {
  static isValidUuid(id?: string | null): boolean {
    if (!id || typeof id !== 'string') return false
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  }

  static generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  static getClans(): ClanData[] {
    const saved = localStorage.getItem(STORAGE_KEYS.CLANS_LIST)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          return parsed.filter((c: any) => this.isValidUuid(c?.id))
        }
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
    const id = localStorage.getItem(STORAGE_KEYS.USER_CLAN_ID)
    if (id && !this.isValidUuid(id)) {
      localStorage.removeItem(STORAGE_KEYS.USER_CLAN_ID)
      return null
    }
    return id
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
   * Create a new Clan (Costs 500 Gemas as foundation tax; initial Clan Vault starts at 0 💎)
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
      id: this.generateUuid(),
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
      vaultUsd: 0.0, // Initial 0 💎 in vault from creation (500 💎 is a foundation tax)
      status: 'active',
      wins: 0,
      losses: 0,
      createdAt: new Date().toISOString().split('T')[0],
      fullBonusClaimedMembers: [],
      seasonPayoutClaimedMembers: [],
      damageDealt: 0,
      dailyDamageDealt: 0,
    }

    const clans = this.getClans()
    clans.unshift(newClan)
    this.saveClans(clans)
    this.recordDeposit(newClan.id, playerName, 500.0, 'fund')
    this.setUserClanId(newClan.id)
    return newClan
  }

  /**
   * Join an existing clan (Costs 200 Gemas, adds +200 to Clan Vault)
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
    clan.vaultUsd += 200.0

    this.saveClans(clans)
    this.recordDeposit(clan.id, playerName, 200.0, 'join')
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
    // Clean up any legacy fund (creation tax) or Sistema entries from local storage
    if (all[clanId]) {
      all[clanId] = all[clanId].filter(
        (d) =>
          d.reason !== 'fund' &&
          d.depositorName?.toLowerCase() !== 'sistema' &&
          d.depositorName !== 'Fundador'
      )
    }
    if (!all[clanId] || all[clanId].length === 0) {
      const clans = this.getClans()
      const clan = clans.find((c) => c.id === clanId)
      const starterMembers = clan?.members || []
      // The 500 creation fee is a game tax, NOT a vault deposit.
      // Only non-leader members joining contribute 200 each to the vault.
      const initialLogs: ClanDepositLog[] = starterMembers.slice(1, 3).map((m, idx) => ({
        id: `dep-init-${idx + 1}`,
        clanId,
        depositorName: m.name,
        amountUsd: 200.0,
        timestamp: Date.now() - 86400000 * (2 - idx * 0.5),
        reason: 'join' as const,
      }))
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

    clan.vaultUsd = Math.max(500.0, Number((clan.vaultUsd + 500.0).toFixed(2)))
    clan.status = 'active'
    this.saveClans(clans)
    this.recordDeposit(clanId, fixerName, 500.0, 'repair')
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
   * Only net earnings above the 2,800 💎 untouchable War Reserve are eligible for distribution.
   */
  static claimSeasonVaultPayout(clanId: string, playerName: string): number {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return 0
    if (clan.seasonPayoutClaimedMembers.includes(playerName)) return 0

    const WAR_RESERVE = 2800.0
    const totalVault = clan.vaultGems ?? clan.vaultUsd
    const surplus = Math.max(0, totalVault - WAR_RESERVE)
    if (surplus <= 0) return 0

    const member = clan.members.find((m) => m.name === playerName || m.id === playerName)
    let shareGems = 0

    if (member && typeof member.rewardPercentage === 'number') {
      if (member.rewardPercentage <= 0) return 0
      shareGems = Math.floor(surplus * (member.rewardPercentage / 100))
    } else {
      const memberCount = Math.max(1, clan.members.length)
      shareGems = Number((surplus / memberCount).toFixed(0))
    }

    if (shareGems <= 0) return 0

    clan.seasonPayoutClaimedMembers.push(playerName)
    clan.vaultUsd = Math.max(WAR_RESERVE, clan.vaultUsd - shareGems)
    this.saveClans(clans)
    return shareGems
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
          plantIcon: '/game-assets/greenfoot/peashooterpacket1.webp',
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
          plantIcon: '/game-assets/greenfoot/walnutpacket1.webp',
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
    if (attacker.status === 'defeated' && (attacker.vaultGems ?? attacker.vaultUsd ?? 0) <= 0) return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: 'Tu clan está en Estado de Derrota (0 💎). Realiza un depósito al tesoro para reactivarlo.' }
    if (defender.status === 'defeated' && (defender.vaultGems ?? defender.vaultUsd ?? 0) <= 0) return { success: false, winnerClan: attacker, loserClan: defender, stolenAmount: 0, error: 'El clan rival está en Estado de Derrota (0 gemas en tesoro).' }

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

    const stolenAmount = Math.min(500.0, loser.vaultUsd)
    loser.vaultUsd = Math.max(0, Number((loser.vaultUsd - stolenAmount).toFixed(2)))
    winner.vaultUsd = Number((winner.vaultUsd + stolenAmount).toFixed(2))

    winner.wins += 1
    loser.losses += 1

    // Daño de Guerra infligido al clan rival (350 a 500 de daño de base)
    const raidDamage = 350 + Math.floor(Math.random() * 151)
    winner.damageDealt = (winner.damageDealt || 0) + raidDamage
    winner.dailyDamageDealt = (winner.dailyDamageDealt || 0) + raidDamage

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
    return { success: true, winnerClan: winner, loserClan: loser, stolenAmount, damageDealt: raidDamage }
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
        stolenUsd: 500.0,
        timestamp: Date.now() - 14400000,
      },
      {
        id: 'log-2',
        challengerClanName: 'ANTIGRAVITY GUILD',
        defenderClanName: 'FROST GUILD',
        winnerClanName: 'ANTIGRAVITY GUILD',
        stolenUsd: 500.0,
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

  /**
   * Update clan reward distribution shares (%) per member
   */
  static updateClanRewardShares(clanId: string, shares: Record<string, number>): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.rewardShares = { ...shares }
    clan.members.forEach((m) => {
      if (typeof shares[m.id] === 'number') {
        m.rewardPercentage = shares[m.id]
      } else if (typeof shares[m.name] === 'number') {
        m.rewardPercentage = shares[m.name]
      }
    })
    this.saveClans(clans)
    return true
  }

  /**
   * Get all pending join requests for a clan
   */
  static getJoinRequests(clanId: string): ClanJoinRequest[] {
    const saved = localStorage.getItem(STORAGE_KEYS.JOIN_REQUESTS)
    if (!saved) return []
    try {
      const all: Record<string, ClanJoinRequest[]> = JSON.parse(saved)
      return all[clanId] || []
    } catch {
      return []
    }
  }

  /**
   * Request to join clan (handles public, request, closed, autoAccept)
   */
  static requestJoinClan(
    clanId: string,
    playerName: string,
    playerElo: number
  ): { success: boolean; joined?: boolean; requestId?: string; error?: string } {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return { success: false, error: 'Clan no encontrado.' }
    if (clan.members.length >= 15) return { success: false, error: 'El clan ya alcanzó el máximo de 15 miembros.' }

    const privacy = clan.settings?.privacy || 'public'
    const autoAccept = clan.settings?.autoAccept ?? true
    const minElo = clan.settings?.minElo ?? 0

    if (privacy === 'closed') {
      return { success: false, error: 'Este clan tiene la admisión cerrada (solo por invitación).' }
    }

    if (playerElo < minElo) {
      return { success: false, error: `Se requiere un mínimo de ${minElo} copas ELO para este clan.` }
    }

    // Direct join if public or autoAccept is on
    if (privacy === 'public' || autoAccept) {
      const joined = this.joinClan(clanId, playerName, playerElo)
      return { success: joined, joined: true }
    }

    // Otherwise record pending join request
    const saved = localStorage.getItem(STORAGE_KEYS.JOIN_REQUESTS)
    let all: Record<string, ClanJoinRequest[]> = {}
    if (saved) {
      try {
        all = JSON.parse(saved)
      } catch {}
    }
    if (!all[clanId]) all[clanId] = []

    const alreadyPending = all[clanId].some((r) => r.username === playerName && r.status === 'pending')
    if (alreadyPending) {
      return { success: false, error: 'Ya tienes una solicitud pendiente en este clan.' }
    }

    const newReq: ClanJoinRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      clanId,
      userId: `user-${playerName}`,
      username: playerName,
      elo: playerElo,
      status: 'pending',
      createdAt: Date.now(),
    }
    all[clanId].unshift(newReq)
    localStorage.setItem(STORAGE_KEYS.JOIN_REQUESTS, JSON.stringify(all))
    return { success: true, joined: false, requestId: newReq.id }
  }

  /**
   * Respond to a join request (accept or reject by leader)
   */
  static respondJoinRequest(
    clanId: string,
    requestId: string,
    accept: boolean
  ): { success: boolean; error?: string } {
    const saved = localStorage.getItem(STORAGE_KEYS.JOIN_REQUESTS)
    if (!saved) return { success: false, error: 'Solicitud no encontrada.' }
    let all: Record<string, ClanJoinRequest[]> = {}
    try {
      all = JSON.parse(saved)
    } catch {
      return { success: false, error: 'Error al leer solicitudes.' }
    }
    const list = all[clanId] || []
    const req = list.find((r) => r.id === requestId)
    if (!req) return { success: false, error: 'Solicitud no encontrada.' }
    if (req.status !== 'pending') return { success: false, error: 'La solicitud ya fue resuelta.' }

    if (!accept) {
      req.status = 'rejected'
      localStorage.setItem(STORAGE_KEYS.JOIN_REQUESTS, JSON.stringify(all))
      return { success: true }
    }

    // If accepted, add player to clan
    const joined = this.joinClan(clanId, req.username, req.elo)
    if (!joined) return { success: false, error: 'El clan está lleno o no se pudo unir al jugador.' }

    req.status = 'accepted'
    localStorage.setItem(STORAGE_KEYS.JOIN_REQUESTS, JSON.stringify(all))
    return { success: true }
  }

  /**
   * Send direct invitation from clan leader to a player
   */
  static sendClanInvitation(
    clanId: string,
    targetUsername: string,
    senderLeaderName: string
  ): { success: boolean; invitationId?: string; error?: string } {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return { success: false, error: 'Clan no encontrado.' }
    if (clan.members.length >= 15) return { success: false, error: 'El clan ya alcanzó el máximo de 15 miembros.' }
    if (targetUsername.toLowerCase() === senderLeaderName.toLowerCase()) {
      return { success: false, error: 'No puedes invitarte a ti mismo.' }
    }
    const targetAlreadyInClan = clans.some((c) => c.members.some((m) => m.name.toLowerCase() === targetUsername.toLowerCase()))
    if (targetAlreadyInClan) {
      return { success: false, error: 'Este jugador ya pertenece a un clan.' }
    }

    const saved = localStorage.getItem(STORAGE_KEYS.CLAN_INVITATIONS)
    let invs: ClanInvitation[] = []
    if (saved) {
      try {
        invs = JSON.parse(saved)
      } catch {}
    }

    const alreadyPending = invs.some(
      (i) => i.clanId === clanId && i.invitedUsername.toLowerCase() === targetUsername.toLowerCase() && i.status === 'pending'
    )
    if (alreadyPending) {
      return { success: false, error: 'Ya enviaste una invitación a este jugador.' }
    }

    const newInv: ClanInvitation = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      clanId,
      clanName: clan.name,
      clanTag: clan.tag,
      clanBadge: clan.badge,
      clanDescription: clan.description,
      leaderName: clan.leader,
      invitedUsername: targetUsername,
      status: 'pending',
      createdAt: Date.now(),
    }
    invs.unshift(newInv)
    localStorage.setItem(STORAGE_KEYS.CLAN_INVITATIONS, JSON.stringify(invs))
    return { success: true, invitationId: newInv.id }
  }

  /**
   * Get pending invitations for a specific username
   */
  static getMyClanInvitations(username: string): ClanInvitation[] {
    const saved = localStorage.getItem(STORAGE_KEYS.CLAN_INVITATIONS)
    if (!saved) return []
    try {
      const invs: ClanInvitation[] = JSON.parse(saved)
      return invs.filter((i) => i.invitedUsername.toLowerCase() === username.toLowerCase() && i.status === 'pending')
    } catch {
      return []
    }
  }

  /**
   * Respond to clan invitation (accept or reject)
   */
  static respondClanInvitation(
    invitationId: string,
    accept: boolean,
    playerElo = 1000
  ): { success: boolean; clanId?: string; clanName?: string; error?: string } {
    const saved = localStorage.getItem(STORAGE_KEYS.CLAN_INVITATIONS)
    if (!saved) return { success: false, error: 'Invitación no encontrada.' }
    let invs: ClanInvitation[] = []
    try {
      invs = JSON.parse(saved)
    } catch {
      return { success: false, error: 'Error al leer invitaciones.' }
    }
    const inv = invs.find((i) => i.id === invitationId)
    if (!inv) return { success: false, error: 'Invitación no encontrada.' }
    if (inv.status !== 'pending') return { success: false, error: 'Esta invitación ya fue resuelta.' }

    if (!accept) {
      inv.status = 'rejected'
      localStorage.setItem(STORAGE_KEYS.CLAN_INVITATIONS, JSON.stringify(invs))
      return { success: true }
    }

    const clans = this.getClans()
    const clan = clans.find((c) => c.id === inv.clanId)
    if (!clan) return { success: false, error: 'El clan ya no existe.' }
    if (clan.members.length >= 15) return { success: false, error: 'El clan ya alcanzó el cupo máximo de 15 miembros.' }

    const joined = this.joinClan(inv.clanId, inv.invitedUsername, playerElo)
    if (!joined) return { success: false, error: 'No se pudo unir al clan.' }

    inv.status = 'accepted'
    localStorage.setItem(STORAGE_KEYS.CLAN_INVITATIONS, JSON.stringify(invs))
    return { success: true, clanId: inv.clanId, clanName: inv.clanName }
  }

  /**
   * Obtener lista de clanes ordenada por daño (Ranking de Clanes)
   */
  static getClansRanking(userClanId?: string | null): ClanRankingEntry[] {
    const clans = this.getClans()
    const sorted = [...clans].sort((a, b) => {
      const dmgA = a.damageDealt ?? 0
      const dmgB = b.damageDealt ?? 0
      if (dmgB !== dmgA) return dmgB - dmgA
      const winsDiff = (b.wins || 0) - (a.wins || 0)
      if (winsDiff !== 0) return winsDiff
      return (b.vaultGems ?? b.vaultUsd ?? 0) - (a.vaultGems ?? a.vaultUsd ?? 0)
    })

    return sorted.map((c, idx) => ({
      rank: idx + 1,
      id: c.id,
      name: c.name,
      tag: c.tag,
      badge: c.badge || '🛡️',
      description: c.description,
      leader: c.leader,
      memberCount: c.members.length,
      damageDealt: c.damageDealt ?? (c.wins * 420),
      dailyDamageDealt: c.dailyDamageDealt ?? Math.floor((c.damageDealt ?? (c.wins * 420)) * 0.35),
      wins: c.wins || 0,
      losses: c.losses || 0,
      vaultGems: c.vaultGems ?? c.vaultUsd ?? 0,
      isUserClan: Boolean(userClanId && c.id === userClanId),
    }))
  }

  /**
   * Cálculo de Recompensas Diarias por puesto (Top 10 a las 00:00 UTC)
   */
  static getDailyRewardsForRank(rank: number): { goldPerMember: number; hasPvpPack: boolean; badge: string; text: string } {
    if (rank === 1) {
      return {
        goldPerMember: 500,
        hasPvpPack: true,
        badge: '500 💰 + ⚔️ Pack PvP (5 min)',
        text: '500 Oro para cada miembro + 1x Pack PvP Exclusivo (temporizador de 5 min para abrir, no expira)',
      }
    }
    if (rank === 2) {
      return {
        goldPerMember: 200,
        hasPvpPack: false,
        badge: '200 💰 Oro',
        text: '200 Oro para cada miembro del clan',
      }
    }
    if (rank === 3) {
      return {
        goldPerMember: 100,
        hasPvpPack: false,
        badge: '100 💰 Oro',
        text: '100 Oro para cada miembro del clan',
      }
    }
    if (rank >= 4 && rank <= 10) {
      return {
        goldPerMember: 50,
        hasPvpPack: false,
        badge: '50 💰 Oro',
        text: '50 Oro para cada miembro del clan',
      }
    }
    return {
      goldPerMember: 0,
      hasPvpPack: false,
      badge: 'Sin premio',
      text: 'Fuera de la zona de premios diaria',
    }
  }

  /**
   * Duración estricta del temporizador de desbloqueo del Pack PvP (5 minutos en ms)
   */
  static readonly PVP_PACK_UNLOCK_DURATION_MS = 5 * 60 * 1000

  /**
   * Obtiene la marca de tiempo (timestamp en ms) en la que el Pack PvP se desbloquea para abrir.
   * Si no se define availableAt, se usa createdAt + 5 minutos.
   */
  static getFlashPackUnlockTime(availableAt?: string | number | null, createdAt?: string | number | null): number {
    if (availableAt) {
      const parsed = typeof availableAt === 'string' ? new Date(availableAt).getTime() : Number(availableAt)
      if (!isNaN(parsed) && parsed > 0) return parsed
    }
    if (createdAt) {
      const parsedCreated = typeof createdAt === 'string' ? new Date(createdAt).getTime() : Number(createdAt)
      if (!isNaN(parsedCreated) && parsedCreated > 0) {
        return parsedCreated + ClanManager.PVP_PACK_UNLOCK_DURATION_MS
      }
    }
    return Date.now()
  }

  /**
   * Verifica si el Pack PvP ya cumplió su temporizador estricto de 5 minutos y recién se puede abrir.
   * ¡IMPORTANTE!: El pack NO EXPIRA NUNCA; solo recién se puede abrir cuando este método retorna true.
   */
  static isFlashPackUnlocked(availableAt?: string | number | null, createdAt?: string | number | null): boolean {
    const unlockTime = ClanManager.getFlashPackUnlockTime(availableAt, createdAt)
    return Date.now() >= unlockTime
  }

  /**
   * Devuelve los segundos restantes de la cuenta regresiva de 5 minutos (0 si ya se puede abrir).
   */
  static getFlashPackRemainingSeconds(availableAt?: string | number | null, createdAt?: string | number | null): number {
    const unlockTime = ClanManager.getFlashPackUnlockTime(availableAt, createdAt)
    const diff = unlockTime - Date.now()
    return Math.max(0, Math.ceil(diff / 1000))
  }

  /**
   * El Pack PvP NO EXPIRA NUNCA. Permanece disponible hasta que el jugador lo abra.
   * Devuelve siempre false.
   */
  static isFlashPackExpired(_expiresAt?: string | number | null): boolean {
    return false
  }
}

export interface ClanRankingEntry {
  rank: number
  id: string
  name: string
  tag: string
  badge: string
  description?: string
  leader: string
  memberCount: number
  damageDealt: number
  dailyDamageDealt: number
  wins: number
  losses: number
  vaultGems: number
  isUserClan?: boolean
}

