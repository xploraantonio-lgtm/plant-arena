import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para referidos.
 */
export const referralService = {
  referralBind: SupabaseService.referralBind.bind(SupabaseService),
} as const
