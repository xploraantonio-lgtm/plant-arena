import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para inventario de plantas.
 * Mantiene SupabaseService como implementación durante la migración incremental.
 */
export const inventoryService = {
  getUserPlants: SupabaseService.getUserPlants.bind(SupabaseService),
  insertPlantInstance: SupabaseService.insertPlantInstance.bind(SupabaseService),
} as const
