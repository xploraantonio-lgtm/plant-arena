import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para referidos.
 * Mantiene la implementación actual en SupabaseService mientras los consumidores
 * se migran de forma gradual.
 */
export const referralService = {
  referralBind: SupabaseService.referralBind.bind(SupabaseService),
  myReferrals: SupabaseService.myReferrals.bind(SupabaseService),
  claimReferralGold: SupabaseService.claimReferralGold.bind(SupabaseService),
  claimReferralDepositGems: SupabaseService.claimReferralDepositGems.bind(SupabaseService),
  claimReferralReward: SupabaseService.claimReferralReward.bind(SupabaseService),
  adminCloseReferralSeason: SupabaseService.adminCloseReferralSeason.bind(SupabaseService),
} as const

export type { MisReferidos } from './supabaseService'
