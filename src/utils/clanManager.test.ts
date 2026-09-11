import { describe, it, expect, beforeEach } from 'vitest'
import { ClanManager, type ClanMember } from './clanManager'

const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
}
;(globalThis as any).localStorage = mockLocalStorage

describe('ClanManager & Gem Valuations', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('creates clan with 0 gems initial vault (foundation tax does not enter vault)', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    expect(clan).toBeDefined()
    expect(clan.name).toBe('LOS GLADIADORES')
    expect(clan.tag).toBe('#LG')
    expect(clan.vaultUsd).toBe(0.0) // 0 initial gems in vault
    expect(clan.members.length).toBe(1)
    expect(clan.members[0].name).toBe('Líder Supremo')
  })

  it('adds 200 gems to vault when a member joins', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    const success = ClanManager.joinClan(clan.id, 'NuevoGuerrero', 1100)
    expect(success).toBe(true)

    const updatedClan = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(updatedClan?.members.length).toBe(2)
    expect(updatedClan?.vaultUsd).toBe(200.0) // 0 initial + 200 join fee
  })

  it('reaches exactly 2,800 gems base war reserve when full with 15 members (1 leader + 14 joined)', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    for (let i = 1; i <= 14; i++) {
      ClanManager.joinClan(clan.id, `Miembro_${i}`, 1000 + i * 10)
    }
    const fullClan = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(fullClan?.members.length).toBe(15)
    expect(fullClan?.vaultUsd).toBe(2800.0) // 14 * 200 = 2,800 💎
  })

  it('only distributes surplus earnings above the 2,800 gems War Reserve on season payout', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    for (let i = 1; i <= 14; i++) {
      ClanManager.joinClan(clan.id, `Miembro_${i}`, 1000 + i * 10)
    }
    // At 2,800 gems (base reserve), payout must be 0
    expect(ClanManager.claimSeasonVaultPayout(clan.id, 'Miembro_1')).toBe(0)

    // Clan earns 1,500 gems in clan wars -> Total vault = 4,300 gems (surplus = 1,500 gems)
    ClanManager.depositToVault(clan.id, 1500.0)
    const share = ClanManager.claimSeasonVaultPayout(clan.id, 'Miembro_1')
    // 15 members: 1500 / 15 = 100 gems
    expect(share).toBe(100)
  })

  it('protects active warrior with >= 2 rounds from kick', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    const activeMember: ClanMember = {
      id: 'm1',
      name: 'GuerreroLeal',
      role: 'Miembro',
      elo: 1300,
      donatedCount: 5,
      joinedAt: new Date().toISOString(),
      roundsParticipated: 3,
      consecutiveRoundsMissed: 2,
    }

    const res = ClanManager.validateKickMember(clan, activeMember)
    expect(res.canKick).toBe(false)
    expect(res.isProtected).toBe(true)
    expect(res.reasonCode).toBe('PROTECTED_ACTIVE_WARRIOR')
  })

  it('purges legacy non-UUID clan IDs (e.g. clan-1788870332951) and returns null', () => {
    mockLocalStorage.setItem('plant_arena_user_clan_id', 'clan-1788870332951')
    expect(ClanManager.isValidUuid('clan-1788870332951')).toBe(false)
    
    // getUserClanId must purge invalid id and return null
    const clanId = ClanManager.getUserClanId()
    expect(clanId).toBeNull()
    expect(mockLocalStorage.getItem('plant_arena_user_clan_id')).toBeNull()
  })

  it('accepts and preserves valid UUIDs', () => {
    const validUuid = 'c38a74e5-9b2e-4b6e-8d99-826048d0cf13'
    expect(ClanManager.isValidUuid(validUuid)).toBe(true)
    mockLocalStorage.setItem('plant_arena_user_clan_id', validUuid)
    expect(ClanManager.getUserClanId()).toBe(validUuid)
  })

  it('distributes season earnings by custom percentages (e.g. 60% active, 40% helper, 0% inactive)', () => {
    const clan = ClanManager.createClan('Imperio Solar', 'IS', '👑', 'Clan de élite', 'Líder Supremo', 1300)
    ClanManager.joinClan(clan.id, 'GuerreroTop', 1250)
    ClanManager.joinClan(clan.id, 'Inactivo', 1000)

    // Deposit 3,400 gems to reach 3,800 gems total (surplus = 1,000 gems above the 2,800 reserve)
    ClanManager.depositToVault(clan.id, 3400.0)

    // Leader configures percentages: Leader 50%, GuerreroTop 50%, Inactivo 0% (sum = 100%)
    const shares = {
      'Líder Supremo': 50,
      'GuerreroTop': 50,
      'Inactivo': 0,
    }
    ClanManager.updateClanRewardShares(clan.id, shares)

    // Inactivo receives 0 gems because percentage is 0%
    expect(ClanManager.claimSeasonVaultPayout(clan.id, 'Inactivo')).toBe(0)

    // GuerreroTop receives 50% of 1000 = 500 gems
    const topShare = ClanManager.claimSeasonVaultPayout(clan.id, 'GuerreroTop')
    expect(topShare).toBe(500)
  })

  it('ensures newly created clans have active status and are not defeated', () => {
    const clan = ClanManager.createClan('Nova Clanes', 'NC', '🔥', 'Clan recién creado', 'Líder Uno', 1200)
    expect(clan.status).toBe('active')
    expect(clan.vaultUsd).toBe(0.0)
    expect(clan.losses).toBe(0)
    expect(clan.wins).toBe(0)
  })

  it('updates and persists clan settings (privacy, minElo, warPermission, autoAccept)', () => {
    const clan = ClanManager.createClan('Titan Squad', 'TS', '🛡️', 'Clan competitivo', 'Líder Titan', 1500)
    const success = ClanManager.updateClanSettings(clan.id, {
      privacy: 'request',
      minElo: 1500,
      warPermission: 'leaders',
      autoAccept: false,
    })
    expect(success).toBe(true)

    const updated = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(updated?.settings?.privacy).toBe('request')
    expect(updated?.settings?.minElo).toBe(1500)
    expect(updated?.settings?.autoAccept).toBe(false)
  })

  it('handles join requests properly when clan is set to request mode', () => {
    const clan = ClanManager.createClan('Dragones', 'DG', '🐉', 'Clan con solicitud', 'Líder Dragón', 1600)
    ClanManager.updateClanSettings(clan.id, {
      privacy: 'request',
      minElo: 1200,
      warPermission: 'leaders',
      autoAccept: false,
    })

    // Player with insufficient ELO is blocked
    const lowEloRes = ClanManager.requestJoinClan(clan.id, 'Noob', 1000)
    expect(lowEloRes.success).toBe(false)
    expect(lowEloRes.error).toContain('copas ELO')

    // Player with sufficient ELO sends a pending request
    const reqRes = ClanManager.requestJoinClan(clan.id, 'GuerreroPro', 1400)
    expect(reqRes.success).toBe(true)
    expect(reqRes.joined).toBe(false)
    expect(reqRes.requestId).toBeDefined()

    // Leader views pending request
    const requests = ClanManager.getJoinRequests(clan.id)
    expect(requests.length).toBe(1)
    expect(requests[0].username).toBe('GuerreroPro')
    expect(requests[0].status).toBe('pending')

    // Leader accepts request
    const acceptRes = ClanManager.respondJoinRequest(clan.id, reqRes.requestId!, true)
    expect(acceptRes.success).toBe(true)

    // Clan now has 2 members and 200 gems in vault
    const updatedClan = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(updatedClan?.members.length).toBe(2)
    expect(updatedClan?.vaultUsd).toBe(200.0)
  })

  it('reactivates defeated clan as soon as vault has > 0 gems (e.g. 50 gems deposit)', () => {
    const clan = ClanManager.createClan('Derrotados FC', 'DFC', '💀', 'Clan caído', 'Líder D', 1000)
    // Manually simulate defeat state after war depletion
    clan.status = 'defeated'
    clan.vaultUsd = 0.0
    ClanManager.saveClans([...ClanManager.getClans().filter((c) => c.id !== clan.id), clan])

    // Deposit 50 gems (not requiring 500)
    const deposited = ClanManager.depositToVault(clan.id, 50, 'MiembroFiel')
    expect(deposited).toBe(true)

    const reactivatedClan = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(reactivatedClan?.vaultUsd).toBe(50)
    expect(reactivatedClan?.status).toBe('active')
  })
})
