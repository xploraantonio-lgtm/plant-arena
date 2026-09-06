import { SupabaseService } from './supabaseService'

/** Fachada de dominio para historial y repeticiones. */
export const ReplayService = {
  myMatches: SupabaseService.myMatches.bind(SupabaseService),
  matchReplay: SupabaseService.matchReplay.bind(SupabaseService),
  shareMatch: SupabaseService.shareMatch.bind(SupabaseService),
  unshareMatch: SupabaseService.unshareMatch.bind(SupabaseService),
} as const
