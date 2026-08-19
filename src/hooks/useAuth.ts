import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { SupabaseService } from '../services/supabaseService'
import { UserManager } from '../utils/userManager'
import type { Database } from '../types/database.types'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

export interface AuthState {
  user: any | null
  profile: ProfileRow | null
  loading: boolean
  isAdmin: boolean
  needsPasswordSetup: boolean
}

const STORAGE_KEYS = {
  GUEST_USER: 'plant_arena_guest_profile',
  // Legacy: el estado de administrador se guardaba aquí, lo que permitía
  // concederse el panel con una línea en la consola. Ya no se lee nunca;
  // sólo se borra, para purgar los navegadores que la tengan puesta.
  LEGACY_ADMIN_SESSION: 'plant_arena_admin_auth',
  EARLY_ACCESS_PASS: 'plant_arena_early_access_granted',
}

// IP autorizada para pruebas de testing y creación ilimitada de cuentas
export const WHITELISTED_DEVELOPER_IPS = [
  '38.25.2.192', // Tu IP de Desarrollador / Tester
  '127.0.0.1',
  'localhost',
]

export function useAuth() {
  const [user, setUser] = useState<any | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  // Arranca siempre en false. La única fuente de verdad es profiles.is_admin,
  // leído del servidor en loadUserProfile: el navegador no puede concederlo.
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState<boolean>(false)

  // Listen for Supabase Auth changes
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }

    // Get current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        checkIfPasswordNeeded(session.user)
        loadUserProfile(session.user.id, session.user)
      } else {
        setLoading(false)
      }
    })

    // Clean up any stale error parameters in URL from previous failed attempts
    if (typeof window !== 'undefined' && window.location.search.includes('error=')) {
      window.history.replaceState(null, '', window.location.pathname)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        checkIfPasswordNeeded(session.user)
        loadUserProfile(session.user.id, session.user)
        if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      } else {
        setUser(null)
        setNeedsPasswordSetup(false)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  /**
   * ¿Hay que pedirle nick y contraseña?
   *
   * Antes se decidía con la marca 'plant_arena_pwd_set_<id>' en localStorage.
   * Eso es por navegador: el modal reaparecía al entrar desde otro dispositivo
   * o al limpiar el almacenamiento, aunque la contraseña ya estuviera puesta.
   * Ahora se pregunta al servidor, que lee auth.users.encrypted_password.
   */
  const checkIfPasswordNeeded = async (u: any) => {
    const isGoogle =
      u?.app_metadata?.provider === 'google' ||
      u?.identities?.some((i: any) => i.provider === 'google')
    if (!isGoogle) {
      setNeedsPasswordSetup(false)
      return
    }

    const status = await SupabaseService.myAuthStatus()
    if (!status) {
      // Sin respuesta del servidor no se molesta al jugador: es preferible no
      // pedir la contraseña que pedirla de nuevo a quien ya la puso.
      setNeedsPasswordSetup(false)
      return
    }
    setNeedsPasswordSetup(!status.hasPassword)

    // Limpiar la marca vieja: ya no se usa.
    localStorage.removeItem('plant_arena_pwd_set_' + u.id)
  }

  const initializeNewUserProfile = async (userId: string, username: string, email?: string) => {
    try {
      const cleanName = (username || email?.split('@')[0] || 'Guerrero')
        .replace(/[^a-zA-Z0-9_\s-]/g, '')
        .slice(0, 16) || 'Guerrero'

      const newProfile: Database['public']['Tables']['profiles']['Insert'] = {
        id: userId,
        username: cleanName,
        avatar_id: 'peashooter',
        elo_rating: 1000,
        gems_balance: 0.0,
        gold_balance: 0,
        colosseum_tickets: 0,
        colosseum_current_streak: 0,
        colosseum_max_streak: 0,
        has_vip_pass: false,
        claimed_vip_levels: [],
        is_admin: false,
        referral_code: 'PLANT_' + Math.random().toString(36).substring(2, 7).toUpperCase(),
      }

      await (supabase.from('profiles') as any).upsert(newProfile, { onConflict: 'id' })

      // Insert exactly 4 Starter Plant Instances
      const starterPlants: Database['public']['Tables']['plant_instances']['Insert'][] = [
        { owner_id: userId, plant_id: 'sunflower', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 0 },
        { owner_id: userId, plant_id: 'peashooter', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 1 },
        { owner_id: userId, plant_id: 'wallnut', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 2 },
        { owner_id: userId, plant_id: 'chomper', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 3 }, // Cactus
      ]
      await (supabase.from('plant_instances') as any).insert(starterPlants)
    } catch (e) {
      console.warn('[useAuth] Exception in initializeNewUserProfile:', e)
    }
  }

  const loadUserProfile = async (userId: string, currentUser?: any) => {
    setLoading(true)
    let prof = await SupabaseService.getProfile(userId)
    const authUser = currentUser || user
    const candidateName =
      authUser?.user_metadata?.username ||
      authUser?.user_metadata?.full_name ||
      authUser?.user_metadata?.name ||
      authUser?.email?.split('@')[0]

    if (prof) {
      // Auto-heal placeholder username if user has a real Google/Email name
      if ((prof.username === 'Guerrero' || !prof.username) && candidateName && candidateName !== 'Guerrero') {
        const cleanName = candidateName.replace(/[^a-zA-Z0-9_\s-]/g, '').slice(0, 16)
        if (cleanName) {
          await (supabase.from('profiles') as any).update({ username: cleanName }).eq('id', userId)
          prof.username = cleanName
        }
      }
      setProfile(prof)
      setIsAdmin(Boolean(prof.is_admin))
      localStorage.removeItem(STORAGE_KEYS.LEGACY_ADMIN_SESSION)
    } else {
      await initializeNewUserProfile(userId, candidateName || 'Guerrero', authUser?.email)
      prof = await SupabaseService.getProfile(userId)
      if (prof) {
        setProfile(prof)
        setIsAdmin(Boolean(prof.is_admin))
        localStorage.removeItem(STORAGE_KEYS.LEGACY_ADMIN_SESSION)
      }
    }
    setLoading(false)
  }

  // Sign in with Google OAuth
  const signInWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado en .env' }
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      })
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || 'Error al conectar con Google' }
    }
  }

  // Set/Register Password and Custom Username for Account
  const setUserPassword = async (newPassword: string, newUsername?: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured() || !user) {
      return { success: false, error: 'No hay sesión de usuario activa' }
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setLoading(false)
        return { success: false, error: error.message }
      }

      if (newUsername && newUsername.trim()) {
        const cleanName = newUsername.trim().replace(/[^a-zA-Z0-9_\s-]/g, '').slice(0, 16)
        if (cleanName) {
          await (supabase.from('profiles') as any).update({ username: cleanName }).eq('id', user.id)
          setProfile((prev) => (prev ? { ...prev, username: cleanName } : prev))
          UserManager.syncWithSupabase({ username: cleanName })
        }
      }

      // Ya no se guarda marca en localStorage: la contraseña acaba de quedar en
      // auth.users, y es allí donde checkIfPasswordNeeded la consulta. Así el
      // modal no vuelve a salir en ningún navegador.
      setNeedsPasswordSetup(false)
      setLoading(false)
      return { success: true }
    } catch (e: any) {
      setLoading(false)
      return { success: false, error: e?.message || 'Error al registrar contraseña' }
    }
  }

  // Sign in with Email/Username & Password
  const signInWithEmail = async (identifier: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    const trimmedId = identifier.trim()

    // El acceso maestro con contraseña incrustada se eliminó: viajaba en el
    // bundle del navegador, así que cualquiera podía leerla. El estado de
    // administrador ahora sale sólo de profiles.is_admin en el servidor.

    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado en el archivo .env' }
    }
    setLoading(true)
    let emailToUse = trimmedId

    // Entrar con NOMBRE DE USUARIO: lo resuelve la Edge Function en el servidor.
    //
    // Antes se pedía el correo al servidor con get_email_by_username y luego se
    // iniciaba sesión desde aquí. Eso obligaba a tener un endpoint público que,
    // dado un nombre, devolvía el correo — y los nombres son públicos porque
    // salen en el ranking, así que cualquiera podía recorrerlo y quedarse con
    // los correos de todos los jugadores.
    //
    // Ahora se mandan usuario y contraseña a la función, que traduce el nombre
    // internamente y devuelve sólo los tokens. El correo no llega al navegador,
    // y la función limita intentos por IP, algo que desde aquí era imposible.
    if (!emailToUse.includes('@')) {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ identifier: trimmedId, password: pass }),
        })

        const payload = await res.json().catch(() => null)

        if (!res.ok || !payload?.access_token) {
          setLoading(false)
          return {
            success: false,
            error: payload?.error || 'Usuario o contraseña incorrectos.',
          }
        }

        // Instalar la sesión que devolvió el servidor.
        const { data: sesion, error: setErr } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        })

        if (setErr || !sesion?.user) {
          setLoading(false)
          return { success: false, error: 'No se pudo abrir la sesión. Inténtalo de nuevo.' }
        }

        setUser(sesion.user)
        await loadUserProfile(sesion.user.id, sesion.user)
        setLoading(false)
        return { success: true }
      } catch (err) {
        console.error('[useAuth] fallo al iniciar sesión por nombre de usuario:', err)
        setLoading(false)
        return {
          success: false,
          error: 'No se pudo contactar con el servicio de inicio de sesión.',
        }
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: pass,
    })

    if (error) {
      setLoading(false)
      return { success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' }
    }

    if (data.user) {
      setUser(data.user)
      await loadUserProfile(data.user.id)
    }
    setLoading(false)
    return { success: true }
  }

  // loginAsAdmin se eliminó: aceptaba dos contraseñas maestras escritas en el
  // código del cliente y nadie lo llamaba. Para conceder administración, marca
  // profiles.is_admin en la base de datos.

  const logoutAdmin = () => {
    setIsAdmin(false)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_ADMIN_SESSION)
  }

  const signOut = async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut()
    }
    setUser(null)
    logoutAdmin()
  }

  return {
    user,
    profile,
    loading,
    isAdmin,
    needsPasswordSetup,
    signInWithGoogle,
    setUserPassword,
    signInWithEmail,
    logoutAdmin,
    signOut,
    reloadProfile: () => user && loadUserProfile(user.id),
  }
}
