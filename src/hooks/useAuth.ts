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

const DEFAULT_GUEST_PROFILE: ProfileRow = {
  id: 'guest_local_' + Math.random().toString(36).substring(2, 9),
  username: 'PlantWarrior',
  avatar_id: 'peashooter',
  country: 'US',
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
  referred_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export function useAuth() {
  const [user, setUser] = useState<any | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.GUEST_USER)
      return saved ? JSON.parse(saved) : DEFAULT_GUEST_PROFILE
    } catch {
      return DEFAULT_GUEST_PROFILE
    }
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION) === 'true'
  })

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
        loadUserProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        loadUserProfile(session.user.id)
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

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

  // Step 1: Sign up with Email + Password + Username (triggers OTP verification)
  const signUpWithEmail = async (email: string, pass: string, username: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado en el archivo .env' }
    }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password: pass,
      options: {
        data: { username: username.trim() },
      },
    })
    setLoading(false)
    if (error) {
      return { success: false, error: error.message }
    }

    // Also send an OTP code for instant 6-digit confirmation in app
    try {
      await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      })
    } catch {
      // safe fallback
    }

    return { success: true }
  }

  // Step 2: Validate 6-digit verification code and finalize registration
  const verifySignupOtp = async (email: string, token: string, pass?: string, username?: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado en .env' }
    }
    setLoading(true)
    try {
      // First attempt verifyOtp with type 'signup'
      let verifyRes = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: 'signup',
      })

      // If signup type failed, attempt type 'email'
      if (verifyRes.error) {
        verifyRes = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          type: 'email',
        })
      }

      if (verifyRes.error) {
        setLoading(false)
        return { success: false, error: 'Código inválido o expirado. Verifica los 6 dígitos.' }
      }

      if (verifyRes.data.user) {
        const u = verifyRes.data.user
        setUser(u)

        // If password was provided, ensure user password is set
        if (pass) {
          try {
            await supabase.auth.updateUser({ password: pass })
          } catch {
            // non-fatal
          }
        }

        // Initialize user profile with 4 cards, 0 balance, 1000 ELO
        await initializeNewUserProfile(u.id, username || email.split('@')[0], email)
        await loadUserProfile(u.id)
      }

      setLoading(false)
      return { success: true }
    } catch (e: any) {
      setLoading(false)
      return { success: false, error: e?.message || 'Error al validar código' }
    }
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
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    verifySignupOtp,
    loginAsAdmin,
    logoutAdmin,
    signOut,
    reloadProfile: () => user && loadUserProfile(user.id),
  }
}
