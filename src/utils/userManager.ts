export interface PlayerProfile {
  name: string
  avatar: string
  isCustomAvatar: boolean
  referralCode: string
  totalReferred: number
  totalReferralBonusUsd: number
  joinedDate: string
}

export interface UserTransaction {
  id: string
  type: 'deposit' | 'withdraw' | 'reward' | 'purchase'
  amountUsd: number
  description: string
  timestamp: number
  status: 'completed' | 'pending'
}

const STORAGE_KEYS = {
  PROFILE: 'plant_arena_player_profile',
  TRANSACTIONS: 'plant_arena_user_transactions',
}

export const PRESET_AVATARS = [
  { id: 'peashooter', name: 'Lanzaguisantes', icon: '/game-assets/greenfoot/peashooterpacket1.png' },
  { id: 'sunflower', name: 'Girasol', icon: '/game-assets/greenfoot/sunflowerpacket1.png' },
  { id: 'wallnut', name: 'Nuez Muralla', icon: '/game-assets/greenfoot/walnutpacket1.png' },
  { id: 'aloe', name: 'Aloe Curandera', icon: '/game-assets/greenfoot/aloepacket1.png' },
  { id: 'repeater', name: 'Repetidora', icon: '/game-assets/greenfoot/repeaterpacket1.png' },
  { id: 'bonkchoy', name: 'Bonk Choy', icon: '/game-assets/greenfoot/bonkchoypacket1.png' },
  { id: 'jalapeno', name: 'Jalapeño Furia', icon: '/game-assets/greenfoot/jalapenopacket1.png' },
  { id: 'iceberg', name: 'Lechuga Helada', icon: '/game-assets/greenfoot/iceberglettucepacket1.png' },
]

export class UserManager {
  static getProfile(): PlayerProfile {
    const saved = localStorage.getItem(STORAGE_KEYS.PROFILE)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Sanitize old broken paths
        if (parsed.avatar && parsed.avatar.endsWith('/peashooter.png')) {
          parsed.avatar = '/game-assets/greenfoot/peashooterpacket1.png'
          this.saveProfile(parsed)
        }
        return parsed
      } catch (e) {}
    }
    const defaultProfile: PlayerProfile = {
      name: 'Guerrero',
      avatar: '/game-assets/greenfoot/peashooterpacket1.png',
      isCustomAvatar: false,
      referralCode: 'PA-ARENA',
      totalReferred: 0,
      totalReferralBonusUsd: 0.0,
      joinedDate: '2026',
    }
    this.saveProfile(defaultProfile)
    return defaultProfile
  }

  static syncWithSupabase(profile: { username?: string | null; avatar_id?: string | null; referral_code?: string | null } | null): void {
    if (!profile || !profile.username) return
    const current = this.getProfile()
    let changed = false
    if (profile.username && current.name !== profile.username) {
      current.name = profile.username
      changed = true
    }
    if (profile.referral_code && current.referralCode !== profile.referral_code) {
      current.referralCode = profile.referral_code
      changed = true
    }
    if (profile.avatar_id) {
      const found = PRESET_AVATARS.find((a) => a.id === profile.avatar_id)
      if (found && current.avatar !== found.icon) {
        current.avatar = found.icon
        changed = true
      }
    }
    if (changed) {
      this.saveProfile(current)
    }
  }

  static saveProfile(profile: PlayerProfile): void {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile))
    // Trigger storage event or sync across components
    window.dispatchEvent(new Event('player_profile_updated'))
  }

  static updateName(name: string): PlayerProfile {
    const profile = this.getProfile()
    profile.name = name.trim().slice(0, 16) || 'Guerrero'
    this.saveProfile(profile)
    return profile
  }

  static updateAvatar(avatarUrl: string, isCustom = false): PlayerProfile {
    const profile = this.getProfile()
    profile.avatar = avatarUrl
    profile.isCustomAvatar = isCustom
    this.saveProfile(profile)
    return profile
  }

  static getTransactions(): UserTransaction[] {
    const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {}
    }
    return []
  }

  static saveTransactions(txs: UserTransaction[]): void {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs.slice(0, 20)))
  }

  static addTransaction(tx: Omit<UserTransaction, 'id' | 'timestamp'>): void {
    const list = this.getTransactions()
    list.unshift({
      ...tx,
      id: `tx-${Date.now()}`,
      timestamp: Date.now(),
    })
    this.saveTransactions(list)
  }
}

/**
 * Compresses an image file client-side using HTML5 Canvas to produce an ultra-light Data URL
 */
export function compressImage(file: File, maxSize = 128, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(img.src)
          return
        }

        // Draw and compress to JPEG
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = (err) => reject(err)
    }
    reader.onerror = (err) => reject(err)
  })
}
