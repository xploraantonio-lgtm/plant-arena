import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para temporadas.
 */
export const seasonService = {
  getActiveSeason: SupabaseService.getActiveSeason.bind(SupabaseService),
} as const
