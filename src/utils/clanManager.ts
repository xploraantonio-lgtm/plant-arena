import type { PlantId } from '../types/game'

export interface ClanMember {
  id: string
  name: string
  role: 'Líder' | 'Colíder' | 'Veterano' | 'Miembro'
  elo: number
  donatedCount: number
  joinedAt: string
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
}

const STORAGE_KEYS = {
  CLANS_LIST: 'plant_arena_clans_list',
  USER_CLAN_ID: 'plant_arena_user_clan_id',
  DONATION_REQUESTS: 'plant_arena_clan_donations',
  WAR_LOGS: 'plant_arena_clan_war_logs',
  ACCOUNT_CLAIMED_FULL_BONUS: 'plant_arena_account_claimed_clan_full_bonus',
}

// 10 Initial Pre-configured Competitive Rival Clanes
const INITIAL_RIVAL_CLANS: ClanData[] = [
  {
    id: 'clan-1',
    name: 'SOLAR LEGENDS',
    tag: '#SOL99',
    badge: '👑',
    description: 'Clan Top 1 Mundial. Maestros de la luz y el fuego. +2000 Copas.',
    leader: 'SolarKing_PRO',
    members: [
      { id: 'm1', name: 'SolarKing_PRO', role: 'Líder', elo: 2450, donatedCount: 42, joinedAt: '2026-08-01' },
      { id: 'm2', name: 'PyroGuisante', role: 'Colíder', elo: 2310, donatedCount: 38, joinedAt: '2026-08-02' },
      { id: 'm3', name: 'SunGoddess', role: 'Colíder', elo: 2280, donatedCount: 35, joinedAt: '2026-08-02' },
      { id: 'm4', name: 'LightStrike', role: 'Miembro', elo: 2190, donatedCount: 29, joinedAt: '2026-08-03' },
      { id: 'm5', name: 'GigaNuez', role: 'Miembro', elo: 2120, donatedCount: 24, joinedAt: '2026-08-04' },
      { id: 'm6', name: 'DrBotanico', role: 'Miembro', elo: 2090, donatedCount: 22, joinedAt: '2026-08-05' },
      { id: 'm7', name: 'Chlorophyll', role: 'Miembro', elo: 2050, donatedCount: 19, joinedAt: '2026-08-06' },
      { id: 'm8', name: 'SolarisX', role: 'Miembro', elo: 2020, donatedCount: 18, joinedAt: '2026-08-07' },
      { id: 'm9', name: 'AuraVerde', role: 'Miembro', elo: 1980, donatedCount: 15, joinedAt: '2026-08-08' },
      { id: 'm10', name: 'FireMaster', role: 'Miembro', elo: 1950, donatedCount: 14, joinedAt: '2026-08-08' },
      { id: 'm11', name: 'RootLord', role: 'Miembro', elo: 1920, donatedCount: 12, joinedAt: '2026-08-09' },
      { id: 'm12', name: 'SunBlaster', role: 'Miembro', elo: 1890, donatedCount: 11, joinedAt: '2026-08-10' },
      { id: 'm13', name: 'SproutHero', role: 'Miembro', elo: 1850, donatedCount: 9, joinedAt: '2026-08-11' },
      { id: 'm14', name: 'SeedRunner', role: 'Miembro', elo: 1820, donatedCount: 8, joinedAt: '2026-08-12' },
      { id: 'm15', name: 'ZenFlora', role: 'Miembro', elo: 1800, donatedCount: 7, joinedAt: '2026-08-12' },
    ],
    vaultUsd: 75.0,
    status: 'active',
    wins: 14,
    losses: 2,
    createdAt: '2026-08-01',
    fullBonusClaimedMembers: ['m1', 'm2', 'm3'],
    seasonPayoutClaimedMembers: [],
  },
  {
    id: 'clan-2',
    name: 'CYBER PLANTS',
    tag: '#CYB88',
    badge: '⚡',
    description: 'Estrategias robóticas y combos de alta velocidad de ataque.',
    leader: 'NeonBotanist',
    members: [
      { id: 'c1', name: 'NeonBotanist', role: 'Líder', elo: 2380, donatedCount: 39, joinedAt: '2026-08-02' },
      { id: 'c2', name: 'LaserSprout', role: 'Colíder', elo: 2240, donatedCount: 31, joinedAt: '2026-08-03' },
      { id: 'c3', name: 'QuantumNut', role: 'Miembro', elo: 2150, donatedCount: 26, joinedAt: '2026-08-04' },
      { id: 'c4', name: 'CircuitPea', role: 'Miembro', elo: 2080, donatedCount: 20, joinedAt: '2026-08-05' },
      { id: 'c5', name: 'GlitchFlora', role: 'Miembro', elo: 1990, donatedCount: 18, joinedAt: '2026-08-06' },
      { id: 'c6', name: 'CyberRoot', role: 'Miembro', elo: 1940, donatedCount: 15, joinedAt: '2026-08-07' },
      { id: 'c7', name: 'DataLeaf', role: 'Miembro', elo: 1910, donatedCount: 14, joinedAt: '2026-08-08' },
      { id: 'c8', name: 'VaporSpore', role: 'Miembro', elo: 1860, donatedCount: 11, joinedAt: '2026-08-09' },
      { id: 'c9', name: 'ByteBloom', role: 'Miembro', elo: 1820, donatedCount: 9, joinedAt: '2026-08-10' },
      { id: 'c10', name: 'HyperStem', role: 'Miembro', elo: 1790, donatedCount: 7, joinedAt: '2026-08-11' },
      { id: 'c11', name: 'SynthSprout', role: 'Miembro', elo: 1750, donatedCount: 5, joinedAt: '2026-08-12' },
      { id: 'c12', name: 'PixelCactus', role: 'Miembro', elo: 1720, donatedCount: 4, joinedAt: '2026-08-12' },
      { id: 'c13', name: 'NanoPetal', role: 'Miembro', elo: 1690, donatedCount: 3, joinedAt: '2026-08-13' },
      { id: 'c14', name: 'RoboSeed', role: 'Miembro', elo: 1650, donatedCount: 2, joinedAt: '2026-08-13' },
    ],
    vaultUsd: 55.0,
    status: 'active',
    wins: 11,
    losses: 3,
    createdAt: '2026-08-02',
    fullBonusClaimedMembers: [],
    seasonPayoutClaimedMembers: [],
  },
  {
    id: 'clan-3',
    name: 'ANTIGRAVITY GUILD',
    tag: '#AGY01',
    badge: '🛡️',
    description: 'Defensa impenetrable de nueces y tanques pesados. Inquebrantables.',
    leader: 'TitanWall_00',
    members: [
      { id: 'a1', name: 'TitanWall_00', role: 'Líder', elo: 2290, donatedCount: 33, joinedAt: '2026-08-03' },
      { id: 'a2', name: 'IronBark', role: 'Colíder', elo: 2180, donatedCount: 28, joinedAt: '2026-08-04' },
      { id: 'a3', name: 'GigaShield', role: 'Miembro', elo: 2090, donatedCount: 21, joinedAt: '2026-08-05' },
      { id: 'a4', name: 'FortressRoot', role: 'Miembro', elo: 1980, donatedCount: 17, joinedAt: '2026-08-06' },
      { id: 'a5', name: 'ArmoredLeaf', role: 'Miembro', elo: 1910, donatedCount: 14, joinedAt: '2026-08-07' },
      { id: 'a6', name: 'HeavyStem', role: 'Miembro', elo: 1850, donatedCount: 12, joinedAt: '2026-08-08' },
      { id: 'a7', name: 'GraniteNut', role: 'Miembro', elo: 1800, donatedCount: 9, joinedAt: '2026-08-09' },
      { id: 'a8', name: 'BulwarkSprout', role: 'Miembro', elo: 1740, donatedCount: 6, joinedAt: '2026-08-10' },
      { id: 'a9', name: 'AegisFlora', role: 'Miembro', elo: 1700, donatedCount: 4, joinedAt: '2026-08-11' },
      { id: 'a10', name: 'DiamondPea', role: 'Miembro', elo: 1650, donatedCount: 3, joinedAt: '2026-08-12' },
      { id: 'a11', name: 'BunkerBranch', role: 'Miembro', elo: 1600, donatedCount: 2, joinedAt: '2026-08-13' },
      { id: 'a12', name: 'BastionSpore', role: 'Miembro', elo: 1580, donatedCount: 1, joinedAt: '2026-08-13' },
    ],
    vaultUsd: 40.0,
    status: 'active',
    wins: 8,
    losses: 4,
    createdAt: '2026-08-03',
    fullBonusClaimedMembers: [],
    seasonPayoutClaimedMembers: [],
  },
  {
    id: 'clan-4',
    name: 'FROST GUILD',
    tag: '#FRS12',
    badge: '❄️',
    description: 'Control de carril con congelación permanente. Congelamos al rival.',
    leader: 'BlizzardKing',
    members: [
      { id: 'f1', name: 'BlizzardKing', role: 'Líder', elo: 2150, donatedCount: 25, joinedAt: '2026-08-04' },
      { id: 'f2', name: 'IcebergElite', role: 'Colíder', elo: 2040, donatedCount: 20, joinedAt: '2026-08-05' },
      { id: 'f3', name: 'FrostbitePea', role: 'Miembro', elo: 1950, donatedCount: 16, joinedAt: '2026-08-06' },
      { id: 'f4', name: 'CryoLeaf', role: 'Miembro', elo: 1880, donatedCount: 13, joinedAt: '2026-08-07' },
      { id: 'f5', name: 'GlacierSprout', role: 'Miembro', elo: 1810, donatedCount: 10, joinedAt: '2026-08-08' },
      { id: 'f6', name: 'ZeroRoot', role: 'Miembro', elo: 1750, donatedCount: 8, joinedAt: '2026-08-09' },
      { id: 'f7', name: 'PolarBranch', role: 'Miembro', elo: 1690, donatedCount: 5, joinedAt: '2026-08-10' },
      { id: 'f8', name: 'SnowBloom', role: 'Miembro', elo: 1620, donatedCount: 3, joinedAt: '2026-08-11' },
      { id: 'f9', name: 'TundraSpore', role: 'Miembro', elo: 1560, donatedCount: 2, joinedAt: '2026-08-12' },
      { id: 'f10', name: 'FrostNut', role: 'Miembro', elo: 1500, donatedCount: 1, joinedAt: '2026-08-13' },
    ],
    vaultUsd: 25.0,
    status: 'active',
    wins: 5,
    losses: 6,
    createdAt: '2026-08-04',
    fullBonusClaimedMembers: [],
    seasonPayoutClaimedMembers: [],
  },
  {
    id: 'clan-5',
    name: 'HEALER SQUAD',
    tag: '#HEA44',
    badge: '💚',
    description: 'Soporte vital y regeneración rápida de HP. Nunca morimos.',
    leader: 'AloeQueen',
    members: [
      { id: 'h1', name: 'AloeQueen', role: 'Líder', elo: 1980, donatedCount: 22, joinedAt: '2026-08-05' },
      { id: 'h2', name: 'VitalSap', role: 'Colíder', elo: 1890, donatedCount: 18, joinedAt: '2026-08-06' },
      { id: 'h3', name: 'RegenBloom', role: 'Miembro', elo: 1810, donatedCount: 14, joinedAt: '2026-08-07' },
      { id: 'h4', name: 'LifeRoot', role: 'Miembro', elo: 1740, donatedCount: 11, joinedAt: '2026-08-08' },
      { id: 'h5', name: 'HealingFlora', role: 'Miembro', elo: 1680, donatedCount: 8, joinedAt: '2026-08-09' },
      { id: 'h6', name: 'MendingSprout', role: 'Miembro', elo: 1600, donatedCount: 6, joinedAt: '2026-08-10' },
      { id: 'h7', name: 'SalviaLeaf', role: 'Miembro', elo: 1520, donatedCount: 4, joinedAt: '2026-08-11' },
      { id: 'h8', name: 'NectarMaster', role: 'Miembro', elo: 1450, donatedCount: 2, joinedAt: '2026-08-12' },
    ],
    vaultUsd: 15.0,
    status: 'active',
    wins: 4,
    losses: 7,
    createdAt: '2026-08-05',
    fullBonusClaimedMembers: [],
    seasonPayoutClaimedMembers: [],
  },
]

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
    localStorage.setItem(STORAGE_KEYS.CLANS_LIST, JSON.stringify(INITIAL_RIVAL_CLANS))
    return INITIAL_RIVAL_CLANS
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
   * Deposit free amount to clan vault
   */
  static depositToVault(clanId: string, amountUsd: number): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.vaultUsd = Number((clan.vaultUsd + amountUsd).toFixed(2))
    if (clan.vaultUsd > 0 && clan.status === 'defeated') {
      clan.status = 'active'
    }
    this.saveClans(clans)
    return true
  }

  /**
   * Repair Base ($5.00 USD to resurrect defeated clan)
   */
  static repairBase(clanId: string): boolean {
    const clans = this.getClans()
    const clan = clans.find((c) => c.id === clanId)
    if (!clan) return false

    clan.vaultUsd = Math.max(5.0, Number((clan.vaultUsd + 5.0).toFixed(2)))
    clan.status = 'active'
    this.saveClans(clans)
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
}
