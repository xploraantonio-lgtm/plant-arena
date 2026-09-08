import { UserManager } from './userManager'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

const ALLOWED_NAME = 'xplora'
const ALLOWED_EMAIL = 'xploraantonio@gmail.com'

export function isXploraUsername(value?: string | null): boolean {
  if (!value) return false
  return value.trim().toLowerCase() === ALLOWED_NAME
}

export function isXploraEmail(value?: string | null): boolean {
  if (!value) return false
  const email = value.trim().toLowerCase()
  return email === ALLOWED_EMAIL || email.split('@')[0] === ALLOWED_NAME
}

export function checkLocalIsXplora(): boolean {
  try {
    const profile = UserManager.getProfile()
    if (isXploraUsername(profile?.name)) {
      return true
    }
  } catch {}

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem('plant_arena_player_profile')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isXploraUsername(parsed?.name)) {
          return true
        }
      }
    }
  } catch {}

  return false
}

export async function checkSupabaseIsXplora(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return false

    if (isXploraEmail(user.email)) {
      return true
    }

    const metaName =
      user.user_metadata?.username ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name
    if (isXploraUsername(metaName)) {
      return true
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle()

    if (profile && isXploraUsername(profile.username)) {
      return true
    }
  } catch (err) {
    console.warn('[farmingAccess] Error verifying user:', err)
  }

  return false
}
