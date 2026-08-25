/**
 * Allowlist de IDs de usuario estables autenticados (Supabase Auth UUIDs)
 * autorizados para acceder al entorno de evaluación de Rival Estratégico.
 */
export const STRATEGIC_PLAYTEST_USER_ALLOWLIST: string[] = [
  // IDs de evaluadores / desarrolladores autorizados
  '00000000-0000-0000-0000-000000000000',
]

export interface PlaytestAuthContext {
  user?: { id?: string } | null
  profile?: { is_admin?: boolean } | null
  isAdmin?: boolean
}

/**
 * Gate estricto de autorización para el Human Playtest.
 *
 * Permite acceso SOLO si:
 * 1. Entorno de desarrollo local (DEV mode para ingenieros y pruebas offline).
 * 2. Usuario con rol admin verificado por el servidor (is_admin en base de datos).
 * 3. ID de usuario autenticado presente en la allowlist estable.
 * 4. Feature flag explícito VITE_ENABLE_STRATEGIC_PLAYTEST === 'true'.
 *
 * En cualquier otro caso (usuario público normal en producción), devuelve FALSE.
 */
export function isStrategicPlaytestAuthorized(context?: PlaytestAuthContext): boolean {
  // 1. En entorno de desarrollo (npm run dev / vitest), siempre autorizado para pruebas
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (import.meta.env.DEV) return true
    if (import.meta.env.VITE_ENABLE_STRATEGIC_PLAYTEST === 'true') return true
  }

  if (!context) return false

  // 2. Admin verificado en base de datos
  if (context.isAdmin || context.profile?.is_admin) {
    return true
  }

  // 3. User ID en allowlist estable
  if (context.user?.id && STRATEGIC_PLAYTEST_USER_ALLOWLIST.includes(context.user.id)) {
    return true
  }

  return false
}
