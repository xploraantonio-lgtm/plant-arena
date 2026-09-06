import { SupabaseService } from './supabaseService'

/**
 * Fachada transicional para operaciones administrativas.
 *
 * El panel de administración mezcla hoy varias responsabilidades. Mantener una
 * fachada propia permite desacoplar el consumidor ahora y extraer después cada
 * operación sin obligar al panel a depender del servicio monolítico.
 */
export const adminService = SupabaseService
