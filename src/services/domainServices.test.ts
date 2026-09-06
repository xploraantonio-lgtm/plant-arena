import { describe, expect, it } from 'vitest'
import {
  MatchmakingService,
  ReplayService,
  accountService,
  adminService,
  battleService,
  colosseumService,
  inventoryService,
  leaderboardService,
  lotteryService,
  marketplaceService,
  profileService,
  publicService,
  referralService,
  replayService,
  seasonService,
  shopService,
} from './index'

describe('domain service facades', () => {
  it('exposes profile operations', () => {
    expect(typeof profileService.getProfile).toBe('function')
    expect(typeof profileService.myBalance).toBe('function')
    expect(typeof profileService.saveActiveDeck).toBe('function')
  })

  it('exposes inventory and progression operations', () => {
    expect(typeof inventoryService.myInventory).toBe('function')
    expect(typeof inventoryService.buyPacks).toBe('function')
    expect(typeof inventoryService.openPack).toBe('function')
    expect(typeof inventoryService.fusePlant).toBe('function')
    expect(typeof inventoryService.claimBattlePassLevel).toBe('function')
  })

  it('exposes matchmaking and replay operations', () => {
    expect(typeof MatchmakingService.enterMatchmaking).toBe('function')
    expect(typeof MatchmakingService.pollMatchmaking).toBe('function')
    expect(typeof MatchmakingService.getGameRoom).toBe('function')
    expect(typeof replayService.myMatches).toBe('function')
    expect(typeof replayService.matchReplay).toBe('function')
    expect(ReplayService).toBe(replayService)
  })

  it('exposes leaderboard, season, colosseum and referral operations', () => {
    expect(typeof leaderboardService.getGlobalLeaderboard).toBe('function')
    expect(typeof seasonService.getActiveSeason).toBe('function')
    expect(typeof colosseumService.getColosseumLeaderboard).toBe('function')
    expect(typeof referralService.myReferrals).toBe('function')
  })

  it('exposes transitional seams for remaining production domains', () => {
    expect(typeof adminService.getActiveSeason).toBe('function')
    expect(typeof accountService.myBalance).toBe('function')
    expect(typeof publicService.getGlobalLeaderboard).toBe('function')
    expect(typeof battleService.reportMatchResult).toBe('function')
    expect(typeof marketplaceService.getMarketplaceListings).toBe('function')
    expect(typeof lotteryService.getLotterySectors).toBe('function')
    expect(typeof shopService.buyPacks).toBe('function')
  })
})
