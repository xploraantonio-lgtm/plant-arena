import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { getRankReward } from '../components/Ranking/Ranking'

describe('Distribución del Pozo de Temporada Ranked ($100 USD = 10,000 Gemas)', () => {
  it('1. El 100% exacto de las 10,000 gemas se distribuye en el Top 5 (40%, 25%, 15%, 12%, 8%)', () => {
    const TOTAL_POOL_USD = 100
    const TOTAL_POOL_GEMS = 10000

    const top1 = getRankReward(1)
    const top2 = getRankReward(2)
    const top3 = getRankReward(3)
    const top4 = getRankReward(4)
    const top5 = getRankReward(5)

    expect(top1).not.toBeNull()
    expect(top2).not.toBeNull()
    expect(top3).not.toBeNull()
    expect(top4).not.toBeNull()
    expect(top5).not.toBeNull()

    // Porcentajes oficiales del pozo (restando un cero a los valores iniciales)
    expect(top1!.gems).toBe(TOTAL_POOL_GEMS * 0.40) // 4,000 Gemas ($40 USD)
    expect(top2!.gems).toBe(TOTAL_POOL_GEMS * 0.25) // 2,500 Gemas ($25 USD)
    expect(top3!.gems).toBe(TOTAL_POOL_GEMS * 0.15) // 1,500 Gemas ($15 USD)
    expect(top4!.gems).toBe(TOTAL_POOL_GEMS * 0.12) // 1,200 Gemas ($12 USD)
    expect(top5!.gems).toBe(TOTAL_POOL_GEMS * 0.08) //   800 Gemas ($8 USD)

    // Suma matemática total: 100%
    const sumGems = top1!.gems + top2!.gems + top3!.gems + top4!.gems + top5!.gems
    expect(sumGems).toBe(TOTAL_POOL_GEMS)
    expect(sumGems / 100).toBe(TOTAL_POOL_USD)
  })

  it('2. Verificación de sobres y oro complementario por puesto (solo gemas y sin texto de USD en el ranking)', () => {
    const top1 = getRankReward(1)!
    expect(top1.pack).toContain('Legendario')
    expect(top1.fullText).toBe('4,000 Gemas 💎 + 1x Pack Legendario 👑')
    expect(top1.fullText).not.toContain('USD')

    const top2 = getRankReward(2)!
    expect(top2.pack).toContain('Épico')
    expect(top2.fullText).toBe('2,500 Gemas 💎 + 1x Pack Épico 🟣')
    expect(top2.fullText).not.toContain('USD')

    const top3 = getRankReward(3)!
    expect(top3.pack).toContain('Comunes')
    expect(top3.fullText).toBe('1,500 Gemas 💎 + 2x Packs Comunes 📦')
    expect(top3.fullText).not.toContain('USD')

    const top4 = getRankReward(4)!
    expect(top4.gold).toBe(2000)
    expect(top4.fullText).toBe('1,200 Gemas 💎 + 2,000 Oro 💰')
    expect(top4.fullText).not.toContain('USD')

    const top5 = getRankReward(5)!
    expect(top5.gold).toBe(1000)
    expect(top5.fullText).toBe('800 Gemas 💎 + 1,000 Oro 💰')
    expect(top5.fullText).not.toContain('USD')

    // Rango 6 al 10: 500 oro, 0 gemas
    for (let r = 6; r <= 10; r++) {
      const rew = getRankReward(r)!
      expect(rew.gems).toBe(0)
      expect(rew.gold).toBe(500)
    }

    // Rango 11 al 20: 250 oro, 0 gemas
    for (let r = 11; r <= 20; r++) {
      const rew = getRankReward(r)!
      expect(rew.gems).toBe(0)
      expect(rew.gold).toBe(250)
    }

    // Rango > 20: sin recompensas
    expect(getRankReward(21)).toBeNull()
  })

  describe('3. Auditoría Estática de Migración 91 (Backend Authoritative Settlement)', () => {
    const migPath = path.resolve(__dirname, '../../supabase/migrations/91-settle-season-rewards-100-usd-pool.sql')
    const sql = fs.readFileSync(migPath, 'utf8')

    it('A. Define la función settle_season_rewards con SECURITY DEFINER y chequeo de permisos de administrador', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.settle_season_rewards')
      expect(sql).toContain('SECURITY DEFINER')
      expect(sql).toContain('UNAUTHORIZED_ADMIN_ONLY')
    })

    it('B. Distribuye los valores canónicos exactos de gemas al Top 5 (4000, 2500, 1500, 1200, 800)', () => {
      expect(sql).toContain('v_gems := 4000')
      expect(sql).toContain('v_gems := 2500')
      expect(sql).toContain('v_gems := 1500')
      expect(sql).toContain('v_gems := 1200')
      expect(sql).toContain('v_gems := 800')
    })

    it('C. Otorga sobres en player_packs y registra auditoría en transactions con amount_usd', () => {
      expect(sql).toContain('INSERT INTO public.player_packs')
      expect(sql).toContain('legendary')
      expect(sql).toContain('epic')
      expect(sql).toContain('basic')
      expect(sql).toContain('INSERT INTO public.transactions')
      expect(sql).toContain('season_reward')
    })

    it('D. Finaliza la temporada en public.seasons marcándola finished y cerrando is_current = FALSE', () => {
      expect(sql).toContain("status = 'finished'")
      expect(sql).toContain('is_current = FALSE')
      expect(sql).toContain('top1_elo_reward = 4000')
      expect(sql).toContain('top2_elo_reward = 2500')
      expect(sql).toContain('top3_elo_reward = 1500')
    })
  })
})
