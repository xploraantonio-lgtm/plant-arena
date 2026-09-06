import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para rankings.
 * Delega en la implementación existente para evitar cambios funcionales.
 */
export const leaderboardService = {
  getGlobalLeaderboard: SupabaseService.getGlobalLeaderboard.bind(SupabaseService),
  getUserRank: SupabaseService.getUserRank.bind(SupabaseService),
  getColosseumLeaderboard: SupabaseService.getColosseumLeaderboard.bind(SupabaseService),
} as const
