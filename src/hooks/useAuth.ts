import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { SupabaseService } from '../services/supabaseService'
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
  ADMIN_SESSION: 'plant_arena_admin_auth',
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
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION) === 'true'
  })
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
        loadUserProfile(session.user.id)
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
        loadUserProfile(session.user.id)
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

  const checkIfPasswordNeeded = (u: any) => {
    const isGoogle = u?.app_metadata?.provider === 'google' || u?.identities?.some((i: any) => i.provider === 'google')
    if (isGoogle) {
      const hasSet = localStorage.getItem('plant_arena_pwd_set_' + u.id) === 'true'
      if (!hasSet) {
        setNeedsPasswordSetup(true)
      }
    }
  }

  const initializeNewUserProfile = async (userId: string, username: string, email?: string) => {
    const existingProf = await SupabaseService.getProfile(userId)
    if (!existingProf) {
      const newProfile: Database['public']['Tables']['profiles']['Insert'] = {
        id: userId,
        username: username || email?.split('@')[0] || 'Guerrero_' + Math.random().toString(36).substring(2, 6),
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
      await (supabase.from('profiles') as any).insert(newProfile)

      // Insert exactly 4 Starter Plant Instances
      const starterPlants: Database['public']['Tables']['plant_instances']['Insert'][] = [
        { owner_id: userId, plant_id: 'sunflower', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 0 },
        { owner_id: userId, plant_id: 'peashooter', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 1 },
        { owner_id: userId, plant_id: 'wallnut', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 2 },
        { owner_id: userId, plant_id: 'chomper', rarity: 'common', star_level: 1, is_in_deck: true, deck_slot: 3 }, // Cactus
      ]
      await (supabase.from('plant_instances') as any).insert(starterPlants)
    }
  }

  const loadUserProfile = async (userId: string) => {
    setLoading(true)
    const prof = await SupabaseService.getProfile(userId)
    if (prof) {
      setProfile(prof)
      setIsAdmin(Boolean(prof.is_admin))
    } else {
      await initializeNewUserProfile(
        userId,
        user?.user_metadata?.username || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Guerrero',
        user?.email
      )
      const freshProf = await SupabaseService.getProfile(userId)
      if (freshProf) setProfile(freshProf)
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

  // Set/Register Password for Google Account
  const setUserPassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured() || !user) {
      return { success: false, error: 'No hay sesión de usuario activa' }
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      setLoading(false)
      if (error) return { success: false, error: error.message }
      localStorage.setItem('plant_arena_pwd_set_' + user.id, 'true')
      setNeedsPasswordSetup(false)
      return { success: true }
    } catch (e: any) {
      setLoading(false)
      return { success: false, error: e?.message || 'Error al registrar contraseña' }
    }
  }

  // Sign in with Email/Username & Password
  const signInWithEmail = async (identifier: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    const trimmedId = identifier.trim()
    const trimmedIdLower = trimmedId.toLowerCase()

    // Master Admin Login (xplora / **4253$$)
    if (trimmedIdLower === 'xplora' && pass === '**4253$$') {
      setIsAdmin(true)
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true')
      const adminProfile: ProfileRow = {
        id: 'admin_xplora_master',
        username: 'xplora',
        avatar_id: 'peashooter',
        country: 'US',
        elo_rating: 1000,
        gems_balance: 999999,
        gold_balance: 999999,
        colosseum_tickets: 999,
        colosseum_current_streak: 0,
        colosseum_max_streak: 0,
        has_vip_pass: true,
        claimed_vip_levels: [],
        is_admin: true,
        referral_code: 'XPLORA_ROOT',
        referred_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setUser({ id: 'admin_xplora_master', email: 'admin@plantarena.com', user_metadata: { username: 'xplora' } })
      setProfile(adminProfile)
      setLoading(false)
      return { success: true }
    }

    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado en el archivo .env' }
    }
    setLoading(true)
    let emailToUse = trimmedId

    // If identifier is not an email, lookup by username in profiles table
    if (!emailToUse.includes('@')) {
      const { data: profData } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', emailToUse)
        .maybeSingle()

      if (!profData) {
        setLoading(false)
        return { success: false, error: 'Usuario no encontrado' }
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

  // Admin Master Pass Login
  const loginAsAdmin = (masterPass: string): boolean => {
    if (masterPass === '**4253$$' || masterPass === 'PLANT_ADMIN_2026') {
      setIsAdmin(true)
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true')
      return true
    }
    return false
  }

  const logoutAdmin = () => {
    setIsAdmin(false)
    localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION)
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
    loginAsAdmin,
    logoutAdmin,
    signOut,
    reloadProfile: () => user && loadUserProfile(user.id),
  }
}
