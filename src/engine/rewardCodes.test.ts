import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ── SIMULACIÓN AUTORITATIVA DE POSTGRESQL (MIGRACIÓN 50) ─────────────────────

interface DbRewardCodeRow {
  id: string
  code: string
  normalized_code: string
  reward_type: string
  reward_value: number
  max_uses: number
  used_count: number
  active: boolean
  created_at: Date
  expires_at: Date | null
}

interface DbRewardCodeClaimRow {
  id: string
  user_id: string
  reward_code_id: string
  claimed_at: Date
}

interface DbPlayerRewardPackRow {
  id: string
  user_id: string
  reward_code_id: string | null
  source: string
  status: 'pending' | 'unlocking' | 'ready' | 'opened'
  duration_hours: number | null
  arena_level: number
  unlock_started_at: Date | null
  created_at: Date
  opened_at: Date | null
}

interface DbProfileRow {
  id: string
  username: string
  elo_rating: number
  gems_balance: number
  gold_balance: number
}

interface DbPlantCopyRow {
  user_id: string
  plant_id: string
  copies: number
}

describe('Sistema de Códigos de Recompensa Streamer y Sobres PvP en Jardín (Migración 50)', () => {
  let rewardCodesTable: Map<string, DbRewardCodeRow>
  let rewardCodeClaimsTable: Map<string, DbRewardCodeClaimRow> // key: `${userId}:${codeId}`
  let playerRewardPacksTable: Map<string, DbPlayerRewardPackRow> // key: packId
  let plantCopiesTable: Map<string, DbPlantCopyRow> // key: `${userId}:${plantId}`
  let profilesTable: Map<string, DbProfileRow>

  const INITIAL_CODES = [
    // 10 Variantes TKSITO
    'TKSITO', 'TKSITOPVP', 'TKSITOPLANT', 'TKSITOKING', 'TKSITOARENA',
    'TKSITOPRO', 'TKSITOGOD', 'TKSITOFAMILY', 'TKSITOPACK', 'TKSITOSTREAM',
    // 10 Variantes FLAME
    'FLAME', 'FLAMEPVP', 'FLAMEPLANT', 'FLAMEKING', 'FLAMEARENA',
    'FLAMEPRO', 'FLAMEGOD', 'FLAMEFAMILY', 'FLAMEPACK', 'FLAMESTREAM',
    // 10 Códigos de Eventos / Arena
    'ARENA2026', 'BATTLEARENA', 'ARENACHAMPION', 'HYPERBATTLE', 'VICTORYCHEST',
    'COLOSSEUMKING', 'TOURNAMENTPACK', 'ARENAMASTER', 'BATTLECHEST', 'ROYALVICTORY',
    // 9 Códigos Generales
    'PLANTKING', 'GREENPOWER', 'SUNMASTER', 'LEGENDARYGARDEN', 'SOLARFLARE',
    'CHOMPERPRO', 'PEASHOOTER99', 'WALLNUTSHIELD', 'PLANTMASTER',
  ]

  beforeEach(() => {
    rewardCodesTable = new Map()
    rewardCodeClaimsTable = new Map()
    playerRewardPacksTable = new Map()
    plantCopiesTable = new Map()
    profilesTable = new Map()

    INITIAL_CODES.forEach((c) => {
      const id = `code-${c.toLowerCase()}`
      rewardCodesTable.set(c, {
        id,
        code: c,
        normalized_code: c,
        reward_type: 'pvp_pack',
        reward_value: 1,
        max_uses: 1,
        used_count: 0,
        active: true,
        created_at: new Date(),
        expires_at: null,
      })
    })

    profilesTable.set('user-1', {
      id: 'user-1',
      username: 'PlayerOne',
      elo_rating: 1650,
      gems_balance: 100,
      gold_balance: 5000,
    })

    profilesTable.set('user-2', {
      id: 'user-2',
      username: 'PlayerTwo',
      elo_rating: 2200,
      gems_balance: 50,
      gold_balance: 5000,
    })
  })

  // ── SIMULACIÓN DE RPC claim_reward_code ───────────────────────────────────
  function rpcClaimRewardCode(userId: string, inputCode: string) {
    const cleanCode = (inputCode || '').trim().toUpperCase()
    if (!cleanCode) return { success: false, error: 'CODE_EMPTY' }

    const codeRow = rewardCodesTable.get(cleanCode)
    if (!codeRow) return { success: false, error: 'CODE_NOT_FOUND' }
    if (!codeRow.active) return { success: false, error: 'CODE_DISABLED' }
    if (codeRow.expires_at && new Date() > codeRow.expires_at) return { success: false, error: 'CODE_EXPIRED' }

    // Prioridad 1: Validar si este usuario ya lo canjeó
    const claimKey = `${userId}:${codeRow.id}`
    if (rewardCodeClaimsTable.has(claimKey)) {
      return { success: false, error: 'CODE_ALREADY_CLAIMED' }
    }

    // Prioridad 2: Validar límite de usos globales
    if (codeRow.used_count >= codeRow.max_uses) {
      return { success: false, error: 'CODE_LIMIT_REACHED' }
    }

    // Calcular arena level
    const profile = profilesTable.get(userId)
    const elo = profile?.elo_rating ?? 1000
    let arenaLevel = 1
    if (elo >= 3100) arenaLevel = 5
    else if (elo >= 2050) arenaLevel = 4
    else if (elo >= 1750) arenaLevel = 3
    else if (elo >= 1600) arenaLevel = 2

    // Crear sobre PvP pendiente en Jardín
    const packId = `pack-reward-${Date.now()}-${Math.random()}`
    const packRow: DbPlayerRewardPackRow = {
      id: packId,
      user_id: userId,
      reward_code_id: codeRow.id,
      source: 'streamer_code',
      status: 'pending',
      duration_hours: null,
      arena_level: arenaLevel,
      unlock_started_at: null,
      created_at: new Date(),
      opened_at: null,
    }
    playerRewardPacksTable.set(packId, packRow)

    // Registrar claim
    rewardCodeClaimsTable.set(claimKey, {
      id: `claim-${Date.now()}`,
      user_id: userId,
      reward_code_id: codeRow.id,
      claimed_at: new Date(),
    })

    // Incrementar used_count
    codeRow.used_count += 1

    return {
      success: true,
      code: cleanCode,
      packId,
      status: 'pending',
      arenaLevel,
    }
  }

  // ── SIMULACIÓN DE RPC start_unlock_reward_pack ────────────────────────────
  function rpcStartUnlockRewardPack(userId: string, packId: string) {
    const pack = playerRewardPacksTable.get(packId)
    if (!pack || pack.user_id !== userId) return { success: false, error: 'PACK_NOT_FOUND' }
    if (pack.status === 'opened') return { success: false, error: 'PACK_ALREADY_OPENED' }
    if (pack.status === 'ready') return { success: false, error: 'PACK_ALREADY_READY' }
    if (pack.status === 'unlocking') return { success: false, error: 'PACK_ALREADY_UNLOCKING' }

    const durations = [2, 4, 8, 12]
    const dur = durations[Math.floor(Math.random() * durations.length)]

    pack.status = 'unlocking'
    pack.duration_hours = dur
    pack.unlock_started_at = new Date()

    return {
      success: true,
      packId,
      status: 'unlocking',
      durationHours: dur,
      unlockStartedAt: pack.unlock_started_at.getTime(),
    }
  }

  // ── SIMULACIÓN DE RPC instant_unlock_reward_pack ──────────────────────────
  function rpcInstantUnlockRewardPack(userId: string, packId: string, customNow = new Date()) {
    const pack = playerRewardPacksTable.get(packId)
    if (!pack || pack.user_id !== userId) return { success: false, error: 'PACK_NOT_FOUND' }
    if (pack.status === 'opened') return { success: false, error: 'PACK_ALREADY_OPENED' }
    if (pack.status === 'ready') return { success: false, error: 'PACK_ALREADY_READY' }

    let remainingHours: number
    if (pack.status === 'unlocking' && pack.unlock_started_at) {
      const elapsedHours = (customNow.getTime() - pack.unlock_started_at.getTime()) / (3600 * 1000)
      remainingHours = Math.max(0, (pack.duration_hours || 4) - elapsedHours)
    } else {
      remainingHours = pack.duration_hours ?? 4
    }

    const goldCost = Math.max(10, Math.ceil(remainingHours * 75))
    const profile = profilesTable.get(userId)
    if (!profile || profile.gold_balance < goldCost) {
      return { success: false, error: 'INSUFFICIENT_GOLD' }
    }

    profile.gold_balance -= goldCost
    pack.status = 'ready'
    pack.unlock_started_at = null

    return {
      success: true,
      packId,
      status: 'ready',
      goldSpent: goldCost,
      goldBalance: profile.gold_balance,
    }
  }

  // ── SIMULACIÓN DE RPC claim_reward_pack ───────────────────────────────────
  function rpcClaimRewardPack(userId: string, packId: string, customNow = new Date()) {
    const pack = playerRewardPacksTable.get(packId)
    if (!pack || pack.user_id !== userId) return { success: false, error: 'PACK_NOT_FOUND' }
    if (pack.status === 'opened') return { success: false, error: 'PACK_ALREADY_OPENED' }

    if (pack.status !== 'ready') {
      if (pack.status === 'unlocking' && pack.unlock_started_at) {
        const elapsedMs = customNow.getTime() - pack.unlock_started_at.getTime()
        const requiredMs = (pack.duration_hours || 2) * 3600 * 1000
        if (elapsedMs < requiredMs) {
          return { success: false, error: 'PACK_NOT_READY' }
        }
      } else {
        return { success: false, error: 'PACK_NOT_READY' }
      }
    }

    const plantId = 'peashooter'
    const rarity = 'common'
    const goldReward = pack.duration_hours === 2 ? 50 : pack.duration_hours === 8 ? 200 : pack.duration_hours === 12 ? 350 : 100

    const copyKey = `${userId}:${plantId}`
    const existingCopies = plantCopiesTable.get(copyKey)?.copies ?? 0
    plantCopiesTable.set(copyKey, {
      user_id: userId,
      plant_id: plantId,
      copies: existingCopies + 1,
    })

    const profile = profilesTable.get(userId)
    if (profile) profile.gold_balance += goldReward

    pack.status = 'opened'
    pack.opened_at = customNow

    return {
      success: true,
      plantId,
      rarity,
      isNew: existingCopies === 0,
      goldReward,
    }
  }

  // ── PRUEBAS UNITARIAS DE REGLAS DE NEGOCIO ─────────────────────────────────

  it('1. Canjear código genera sobre PvP pendiente en Jardín con status pending', () => {
    const res = rpcClaimRewardCode('user-1', 'FLAME')
    expect(res.success).toBe(true)
    expect(res.status).toBe('pending')

    const pack = playerRewardPacksTable.get(res.packId!)!
    expect(pack).toBeDefined()
    expect(pack.user_id).toBe('user-1')
    expect(pack.status).toBe('pending')
    expect(pack.duration_hours).toBeNull()
    expect(pack.unlock_started_at).toBeNull()
    expect(pack.arena_level).toBe(2) // ELO 1650 -> Arena 2
  })

  it('2. Canjear código NO depende de huecos libres en pack_slots', () => {
    // Usuario canjea múltiples códigos
    const res1 = rpcClaimRewardCode('user-1', 'TKSITO')
    const res2 = rpcClaimRewardCode('user-1', 'ARENA2026')
    const res3 = rpcClaimRewardCode('user-1', 'BATTLEARENA')

    expect(res1.success).toBe(true)
    expect(res2.success).toBe(true)
    expect(res3.success).toBe(true)

    // Los 3 sobres existen en player_reward_packs
    const userPacks = Array.from(playerRewardPacksTable.values()).filter((p) => p.user_id === 'user-1')
    expect(userPacks.length).toBe(3)
  })

  it('3. Código inexistente falla con CODE_NOT_FOUND', () => {
    const res = rpcClaimRewardCode('user-1', 'CODIGO_INVENTADO_99')
    expect(res.success).toBe(false)
    expect(res.error).toBe('CODE_NOT_FOUND')
  })

  it('4. Código ya usado por el mismo usuario falla con CODE_ALREADY_CLAIMED', () => {
    rpcClaimRewardCode('user-1', 'FLAME')
    const retry = rpcClaimRewardCode('user-1', 'FLAME')

    expect(retry.success).toBe(false)
    expect(retry.error).toBe('CODE_ALREADY_CLAIMED')
  })

  it('5. Código con max_uses=1 no permite que un segundo usuario lo canjee (CODE_LIMIT_REACHED)', () => {
    const res1 = rpcClaimRewardCode('user-1', 'TKSITOKING')
    expect(res1.success).toBe(true)

    const res2 = rpcClaimRewardCode('user-2', 'TKSITOKING')
    expect(res2.success).toBe(false)
    expect(res2.error).toBe('CODE_LIMIT_REACHED')
  })

  it('6. start_unlock_reward_pack asigna duración aleatoria [2, 4, 8, 12] y status unlocking', () => {
    const claim = rpcClaimRewardCode('user-1', 'FLAMEKING')
    const unlock = rpcStartUnlockRewardPack('user-1', claim.packId!)

    expect(unlock.success).toBe(true)
    expect(unlock.status).toBe('unlocking')
    expect([2, 4, 8, 12]).toContain(unlock.durationHours)

    const pack = playerRewardPacksTable.get(claim.packId!)!
    expect(pack.status).toBe('unlocking')
    expect(pack.unlock_started_at).toBeDefined()
  })

  it('7. No permite abrir sobre si el temporizador del servidor no ha transcurrido (anti-cheat)', () => {
    const claim = rpcClaimRewardCode('user-1', 'SUNMASTER')
    rpcStartUnlockRewardPack('user-1', claim.packId!)

    // Intentar abrir 10 segundos después (cuando la duración es 2h+)
    const earlyTime = new Date(Date.now() + 10 * 1000)
    const openAttempt = rpcClaimRewardPack('user-1', claim.packId!, earlyTime)

    expect(openAttempt.success).toBe(false)
    expect(openAttempt.error).toBe('PACK_NOT_READY')
  })

  it('8. Acelerar con oro (instant_unlock_reward_pack) descuenta oro y pone status ready', () => {
    const claim = rpcClaimRewardCode('user-1', 'GREENPOWER')
    rpcStartUnlockRewardPack('user-1', claim.packId!)

    const pack = playerRewardPacksTable.get(claim.packId!)!
    const expectedCost = Math.max(10, Math.ceil(pack.duration_hours! * 75))

    const speedup = rpcInstantUnlockRewardPack('user-1', claim.packId!)
    expect(speedup.success).toBe(true)
    expect(speedup.status).toBe('ready')
    expect(speedup.goldSpent).toBe(expectedCost)

    const profile = profilesTable.get('user-1')!
    expect(profile.gold_balance).toBe(5000 - expectedCost)
    expect(pack.status).toBe('ready')
  })

  it('9. Acelerar con oro insuficiente falla con INSUFFICIENT_GOLD', () => {
    const profile = profilesTable.get('user-1')!
    profile.gold_balance = 5 // Muy poco oro

    const claim = rpcClaimRewardCode('user-1', 'LEGENDARYGARDEN')
    rpcStartUnlockRewardPack('user-1', claim.packId!)

    const speedup = rpcInstantUnlockRewardPack('user-1', claim.packId!)
    expect(speedup.success).toBe(false)
    expect(speedup.error).toBe('INSUFFICIENT_GOLD')
  })

  it('10. Abrir sobre listo entrega carta y oro, y marca status opened', () => {
    const claim = rpcClaimRewardCode('user-1', 'SOLARFLARE')
    rpcStartUnlockRewardPack('user-1', claim.packId!)
    rpcInstantUnlockRewardPack('user-1', claim.packId!)

    const open = rpcClaimRewardPack('user-1', claim.packId!)
    expect(open.success).toBe(true)
    expect(open.plantId).toBe('peashooter')
    expect(open.goldReward).toBeGreaterThan(0)

    const pack = playerRewardPacksTable.get(claim.packId!)!
    expect(pack.status).toBe('opened')
    expect(pack.opened_at).toBeDefined()

    const copies = plantCopiesTable.get('user-1:peashooter')!
    expect(copies.copies).toBe(1)
  })

  it('11. Canjear código NO altera el ELO ni las gemas del usuario', () => {
    const profile = profilesTable.get('user-1')!
    const eloBefore = profile.elo_rating
    const gemsBefore = profile.gems_balance

    rpcClaimRewardCode('user-1', 'CHOMPERPRO')

    expect(profile.elo_rating).toBe(eloBefore)
    expect(profile.gems_balance).toBe(gemsBefore)
  })

  it('12. Normalización de código: ignora espacios y minúsculas ("  flame  " -> "FLAME")', () => {
    const res = rpcClaimRewardCode('user-1', '  flame  ')
    expect(res.success).toBe(true)
    expect(res.code).toBe('FLAME')
  })

  // ── AUDITORÍA ESTÁTICA DEL ARCHIVO SQL DE LA MIGRACIÓN 50 ──────────────────
  describe('Auditoría estática de 50-reward-codes-streamer-pvp-pack.sql', () => {
    const sqlPath = path.resolve(__dirname, '../../supabase/50-reward-codes-streamer-pvp-pack.sql')
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

    it('A. Contiene CREATE TABLE public.player_reward_packs, reward_codes y reward_code_claims', () => {
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.player_reward_packs')
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.reward_codes')
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.reward_code_claims')
      expect(sqlContent).toContain('CONSTRAINT uq_reward_code_user_claim UNIQUE (user_id, reward_code_id)')
    })

    it('B. Contiene RLS y revocación de permisos directos en tablas', () => {
      expect(sqlContent).toContain('ALTER TABLE public.player_reward_packs ENABLE ROW LEVEL SECURITY')
      expect(sqlContent).toContain('ALTER TABLE public.reward_codes ENABLE ROW LEVEL SECURITY')
      expect(sqlContent).toContain('REVOKE ALL ON TABLE public.reward_codes FROM anon, authenticated, PUBLIC')
      expect(sqlContent).toContain('ALTER TABLE public.reward_code_claims ENABLE ROW LEVEL SECURITY')
    })

    it('C. Contiene las 5 RPCs SECURITY DEFINER autoritativas', () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.claim_reward_code(p_code TEXT)')
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.start_unlock_reward_pack(p_pack_id UUID)')
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.instant_unlock_reward_pack(p_pack_id UUID)')
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.claim_reward_pack(p_pack_id UUID)')
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.get_my_reward_packs()')
      expect(sqlContent).toContain('SECURITY DEFINER')
    })

    it('D. Contiene los 39 códigos iniciales especificados', () => {
      INITIAL_CODES.forEach((code) => {
        expect(sqlContent).toContain(`'${code}'`)
      })
    })
  })
})
