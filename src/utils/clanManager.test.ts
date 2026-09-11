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
})
