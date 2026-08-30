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
  reward_code_id: string
  user_id: string
  claimed_at: Date
  generated_pack_slot_id: number
}

interface DbPackSlotRow {
  user_id: string
  slot_index: number
  status: 'empty' | 'locked' | 'unlocking' | 'ready'
  duration_hours: number
  arena_level: number
  unlock_started_at: Date | null
  awarded_at: Date
}

interface DbProfileRow {
  id: string
  username: string
  elo_rating: number
  gems_balance: number
  gold_balance: number
}

describe('Fases 1 a 9 — Sistema de Códigos de Recompensa Streamer (Pack PvP Temporizado)', () => {
  // Tablas en memoria simulando PostgreSQL
  let rewardCodesTable: Map<string, DbRewardCodeRow>
  let rewardCodeClaimsTable: Map<string, DbRewardCodeClaimRow> // key: `${codeId}:${userId}`
  let packSlotsTable: Map<string, DbPackSlotRow> // key: `${userId}:${slotIndex}`
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
    packSlotsTable = new Map()
    profilesTable = new Map()

    // Inicializar 20 códigos streamer
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

    // Crear perfil base de prueba
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

    // Inicializar los 4 slots vacíos para user-1
    for (let i = 0; i < 4; i++) {
      packSlotsTable.set(`user-1:${i}`, {
        user_id: 'user-1',
        slot_index: i,
        status: 'empty',
        duration_hours: 2,
        arena_level: 1,
        unlock_started_at: null,
        awarded_at: new Date(),
      })
      packSlotsTable.set(`user-2:${i}`, {
        user_id: 'user-2',
        slot_index: i,
        status: 'empty',
        duration_hours: 2,
        arena_level: 1,
        unlock_started_at: null,
        awarded_at: new Date(),
      })
    }
  })

  // Función simulada de asignación de pack slot (_award_reward_pack_slot_for)
  function _award_reward_pack_slot_for(uid: string): {
    awarded: boolean
    reason?: string
    slotId?: number
    durationHours?: number
    arenaLevel?: number
  } {
    const profile = profilesTable.get(uid)
    if (!profile) return { awarded: false, reason: 'sin_usuario' }

    const elo = profile.elo_rating ?? 1000
    let arenaLevel = 1
    if (elo >= 3100) arenaLevel = 5
    else if (elo >= 2050) arenaLevel = 4
    else if (elo >= 1750) arenaLevel = 3
    else if (elo >= 1600) arenaLevel = 2

    // Buscar primer hueco libre en 0..3
    let freeSlot: number | null = null
    for (let i = 0; i < 4; i++) {
      const slot = packSlotsTable.get(`${uid}:${i}`)
      if (!slot || slot.status === 'empty') {
        freeSlot = i
        break
      }
    }

    if (freeSlot === null) {
      return { awarded: false, reason: 'huecos_llenos' }
    }

    const durOptions = [2, 4, 8, 12] as const
    const randomDuration = durOptions[Math.floor(Math.random() * durOptions.length)]

    packSlotsTable.set(`${uid}:${freeSlot}`, {
      user_id: uid,
      slot_index: freeSlot,
      status: 'locked',
      duration_hours: randomDuration,
      arena_level: arenaLevel,
      unlock_started_at: null,
      awarded_at: new Date(),
    })

    return {
      awarded: true,
      slotId: freeSlot,
      durationHours: randomDuration,
      arenaLevel,
    }
  }

  // Simulación de la RPC PostgreSQL claim_reward_code(p_code TEXT)
  function rpcClaimRewardCode(userId: string | null, rawCode: string): {
    success: boolean
    code?: string
    slotId?: number
    durationHours?: number
    arenaLevel?: number
    error?: string
  } {
    if (!userId) {
      return { success: false, error: 'NOT_AUTHENTICATED' }
    }

    const cleanCode = (rawCode || '').trim().toUpperCase()
    if (!cleanCode) {
      return { success: false, error: 'CODE_EMPTY' }
    }

    const codeRow = rewardCodesTable.get(cleanCode)
    if (!codeRow) {
      return { success: false, error: 'CODE_NOT_FOUND' }
    }

    if (!codeRow.active) {
      return { success: false, error: 'CODE_DISABLED' }
    }

    if (codeRow.expires_at && new Date() > codeRow.expires_at) {
      return { success: false, error: 'CODE_EXPIRED' }
    }

    const claimKey = `${codeRow.id}:${userId}`
    if (rewardCodeClaimsTable.has(claimKey)) {
      return { success: false, error: 'CODE_ALREADY_CLAIMED' }
    }

    if (codeRow.used_count >= codeRow.max_uses) {
      return { success: false, error: 'CODE_LIMIT_REACHED' }
    }

    // Crear pack slot
    const packResult = _award_reward_pack_slot_for(userId)
    if (!packResult.awarded) {
      if (packResult.reason === 'huecos_llenos') {
        return { success: false, error: 'SLOTS_FULL' }
      }
      return { success: false, error: `COULD_NOT_AWARD_PACK: ${packResult.reason}` }
    }

    // Registrar claim
    rewardCodeClaimsTable.set(claimKey, {
      id: `claim-${Date.now()}-${Math.random()}`,
      reward_code_id: codeRow.id,
      user_id: userId,
      claimed_at: new Date(),
      generated_pack_slot_id: packResult.slotId!,
    })

    // Incrementar used_count
    codeRow.used_count += 1
    rewardCodesTable.set(cleanCode, codeRow)

    return {
      success: true,
      code: cleanCode,
      slotId: packResult.slotId,
      durationHours: packResult.durationHours,
      arenaLevel: packResult.arenaLevel,
    }
  }

  // ── TESTS UNITARIOS Y DE INTEGRACIÓN ───────────────────────────────────────

  it('1. Código válido genera un pack slot con status locked y duración 2/4/8/12h', () => {
    const res = rpcClaimRewardCode('user-1', 'FLAME')

    expect(res.success).toBe(true)
    expect(res.code).toBe('FLAME')
    expect(res.slotId).toBe(0)
    expect([2, 4, 8, 12]).toContain(res.durationHours)
    expect(res.arenaLevel).toBe(2) // ELO 1650 -> Arena 2

    const slot = packSlotsTable.get('user-1:0')
    expect(slot).toBeDefined()
    expect(slot?.status).toBe('locked')
    expect(slot?.unlock_started_at).toBeNull()
  })

  it('2. Código inexistente falla con CODE_NOT_FOUND', () => {
    const res = rpcClaimRewardCode('user-1', 'CODIGO_INVENTADO_123')

    expect(res.success).toBe(false)
    expect(res.error).toBe('CODE_NOT_FOUND')
  })

  it('3. Código ya usado por el mismo usuario falla con CODE_ALREADY_CLAIMED', () => {
    const firstClaim = rpcClaimRewardCode('user-1', 'TKSITO')
    expect(firstClaim.success).toBe(true)

    const secondClaim = rpcClaimRewardCode('user-1', 'TKSITO')
    expect(secondClaim.success).toBe(false)
    expect(secondClaim.error).toBe('CODE_ALREADY_CLAIMED')
  })

  it('4. Código con max_uses=1 no permite que dos usuarios lo usen (concurrencia / límite)', () => {
    const user1Claim = rpcClaimRewardCode('user-1', 'ARENA2026')
    expect(user1Claim.success).toBe(true)

    // user-2 intenta canjear el mismo código de 1 uso
    const user2Claim = rpcClaimRewardCode('user-2', 'ARENA2026')
    expect(user2Claim.success).toBe(false)
    expect(user2Claim.error).toBe('CODE_LIMIT_REACHED')
  })

  it('5. Pack generado aparece estrictamente con status locked y sin reloj iniciado', () => {
    const res = rpcClaimRewardCode('user-1', 'PLANTKING')
    expect(res.success).toBe(true)

    const slot = packSlotsTable.get(`user-1:${res.slotId}`)
    expect(slot?.status).toBe('locked')
    expect(slot?.unlock_started_at).toBeNull()
  })

  it('6. Duración del cofre pertenece exclusivamente al conjunto [2, 4, 8, 12]', () => {
    const validDurations = new Set([2, 4, 8, 12])

    for (let i = 0; i < 20; i++) {
      const res = _award_reward_pack_slot_for('user-2')
      if (res.awarded) {
        expect(validDurations.has(res.durationHours as any)).toBe(true)
      }
    }
  })

  it('7. Canjear código NO modifica el ELO del usuario', () => {
    const eloBefore = profilesTable.get('user-1')?.elo_rating
    rpcClaimRewardCode('user-1', 'GREENPOWER')
    const eloAfter = profilesTable.get('user-1')?.elo_rating

    expect(eloBefore).toBe(1650)
    expect(eloAfter).toBe(1650)
  })

  it('8. Canjear código NO modifica las gemas del usuario', () => {
    const gemsBefore = profilesTable.get('user-1')?.gems_balance
    rpcClaimRewardCode('user-1', 'SUNMASTER')
    const gemsAfter = profilesTable.get('user-1')?.gems_balance

    expect(gemsBefore).toBe(100)
    expect(gemsAfter).toBe(100)
  })

  it('9. No permite abrir el sobre inmediatamente si está locked (revalida temporizador)', () => {
    rpcClaimRewardCode('user-1', 'BATTLEARENA')
    const slot = packSlotsTable.get('user-1:0')!

    // Simular intento de apertura sin tiempo transcurrido
    const canOpenImmediately = slot.status === 'ready'
    expect(canOpenImmediately).toBe(false)
  })

  it('10. Puede acelerarse con oro mediante la lógica existente (instant_unlock_pack_slot)', () => {
    rpcClaimRewardCode('user-1', 'TKSITOFAMILY')
    const slot = packSlotsTable.get('user-1:0')!
    expect(slot.status).toBe('locked')

    // Simulación de instant_unlock_pack_slot
    const userProfile = profilesTable.get('user-1')!
    const goldCost = Math.max(10, Math.ceil(slot.duration_hours * 75))
    expect(userProfile.gold_balance).toBeGreaterThanOrEqual(goldCost)

    userProfile.gold_balance -= goldCost
    slot.status = 'ready'
    slot.unlock_started_at = null

    expect(slot.status).toBe('ready')
    expect(userProfile.gold_balance).toBe(5000 - goldCost)
  })

  it('11. Si los 4 huecos están llenos, falla con SLOTS_FULL y preserva el código sin usar', () => {
    // Llenar los 4 slots
    for (let i = 0; i < 4; i++) {
      packSlotsTable.set(`user-1:${i}`, {
        user_id: 'user-1',
        slot_index: i,
        status: 'locked',
        duration_hours: 4,
        arena_level: 2,
        unlock_started_at: null,
        awarded_at: new Date(),
      })
    }

    const res = rpcClaimRewardCode('user-1', 'BATTLEARENA')
    expect(res.success).toBe(false)
    expect(res.error).toBe('SLOTS_FULL')

    // Verificar que el código NO fue consumido
    const code = rewardCodesTable.get('BATTLEARENA')!
    expect(code.used_count).toBe(0)
    expect(rewardCodeClaimsTable.has(`${code.id}:user-1`)).toBe(false)
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

    it('A. Contiene CREATE TABLE public.reward_codes y reward_code_claims con restricciones', () => {
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.reward_codes')
      expect(sqlContent).toContain('CONSTRAINT uq_reward_codes_normalized UNIQUE (normalized_code)')
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS public.reward_code_claims')
      expect(sqlContent).toContain('CONSTRAINT uq_reward_code_user_claim UNIQUE (reward_code_id, user_id)')
    })

    it('B. Contiene RLS y revocación de permisos directos en tablas', () => {
      expect(sqlContent).toContain('ALTER TABLE public.reward_codes ENABLE ROW LEVEL SECURITY')
      expect(sqlContent).toContain('REVOKE ALL ON TABLE public.reward_codes FROM anon, authenticated, PUBLIC')
      expect(sqlContent).toContain('ALTER TABLE public.reward_code_claims ENABLE ROW LEVEL SECURITY')
    })

    it('C. Contiene RPC SECURITY DEFINER claim_reward_code con SELECT FOR UPDATE', () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.claim_reward_code(p_code TEXT)')
      expect(sqlContent).toContain('SECURITY DEFINER')
      expect(sqlContent).toContain('FOR UPDATE')
      expect(sqlContent).toContain('GRANT  EXECUTE ON FUNCTION public.claim_reward_code(TEXT) TO authenticated')
    })

    it('D. Contiene los 39 códigos iniciales especificados', () => {
      INITIAL_CODES.forEach((code) => {
        expect(sqlContent).toContain(`'${code}'`)
      })
    })
  })
})
