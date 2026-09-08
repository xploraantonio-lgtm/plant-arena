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

  it('creates clan with 5 gems initial vault', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    expect(clan).toBeDefined()
    expect(clan.name).toBe('LOS GLADIADORES')
    expect(clan.tag).toBe('#LG')
    expect(clan.vaultUsd).toBe(5.0)
    expect(clan.members.length).toBe(1)
    expect(clan.members[0].name).toBe('Líder Supremo')
  })

  it('allows member joining with valid parameters', () => {
    const clan = ClanManager.createClan('Los Gladiadores', 'LG', '👑', 'Descripción del clan', 'Líder Supremo', 1200)
    const success = ClanManager.joinClan(clan.id, 'NuevoGuerrero', 1100)
    expect(success).toBe(true)

    const updatedClan = ClanManager.getClans().find((c) => c.id === clan.id)
    expect(updatedClan?.members.length).toBe(2)
    expect(updatedClan?.vaultUsd).toBe(7.0) // 5 initial + 2 join fee
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
})
