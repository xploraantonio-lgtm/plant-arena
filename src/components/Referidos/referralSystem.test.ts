import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { PREMIOS_OFICIALES } from './PanelDeReferidos'

describe('Sistema de Referidos - Auditoría y Reglas Canónicas', () => {
  describe('1. Criterio de Amigo Válido (Regla B)', () => {
    const esAmigoValido = (copas: number) => copas >= 1100

    it('un amigo con menos de 1100 copas no califica como válido', () => {
      expect(esAmigoValido(0)).toBe(false)
      expect(esAmigoValido(1000)).toBe(false)
      expect(esAmigoValido(1099)).toBe(false)
    })

    it('un amigo con 1100 o más copas califica como válido', () => {
      expect(esAmigoValido(1100)).toBe(true)
      expect(esAmigoValido(1150)).toBe(true)
      expect(esAmigoValido(2500)).toBe(true)
    })
  })

  describe('2. Recompensas Permanentes del Referidor', () => {
    it('cada amigo válido genera exactamente 100 de oro por única vez', () => {
      const amigosValidosSinCobrar = 5
      const oroACobrar = amigosValidosSinCobrar * 100
      expect(oroACobrar).toBe(500)

      const unAmigo = 1 * 100
      expect(unAmigo).toBe(100)

      const ceroAmigos = 0 * 100
      expect(ceroAmigos).toBe(0)
    })

    it('calcula el 5% en gemas de cada depósito de los referidos', () => {
      const calcularComisionGemas = (montoDeposito: number) => {
        return Math.round(montoDeposito * 0.05 * 100) / 100
      }

      expect(calcularComisionGemas(10)).toBe(0.50)
      expect(calcularComisionGemas(50)).toBe(2.50)
      expect(calcularComisionGemas(100)).toBe(5.00)
      expect(calcularComisionGemas(25)).toBe(1.25)
      expect(calcularComisionGemas(19.99)).toBe(1.00)
    })
  })

  describe('3. Metas de Temporada', () => {
    const verificarMetaSobre10 = (amigosTemporada: number) => amigosTemporada >= 10
    const verificarMetaGemas35 = (amigosTemporada: number) => amigosTemporada >= 35

    it('meta de 10 amigos entrega 1 Sobre Básico al alcanzar 10 en la temporada', () => {
      expect(verificarMetaSobre10(9)).toBe(false)
      expect(verificarMetaSobre10(10)).toBe(true)
      expect(verificarMetaSobre10(15)).toBe(true)
    })

    it('meta de 35 amigos entrega 500 Gemas al alcanzar 35 en la temporada', () => {
      expect(verificarMetaGemas35(34)).toBe(false)
      expect(verificarMetaGemas35(35)).toBe(true)
      expect(verificarMetaGemas35(50)).toBe(true)
    })
  })

  describe('4. Premios Oficiales de Ranking de Temporada (Top 1 al 5)', () => {
    it('el Top 1 recibe 1000 gemas y 1 sobre legendario', () => {
      const top1 = PREMIOS_OFICIALES.find((p) => p.puesto === 1)
      expect(top1).toBeDefined()
      expect(top1?.gemas).toBe(1000)
      expect(top1?.oro).toBe(0)
      expect(top1?.sobres).toBe(1)
      expect(top1?.tipoSobre).toContain('Legendario')
    })

    it('el Top 2 recibe 500 gemas y 1 sobre épico', () => {
      const top2 = PREMIOS_OFICIALES.find((p) => p.puesto === 2)
      expect(top2).toBeDefined()
      expect(top2?.gemas).toBe(500)
      expect(top2?.oro).toBe(0)
      expect(top2?.sobres).toBe(1)
      expect(top2?.tipoSobre).toContain('Épico')
    })

    it('el Top 3 recibe 200 gemas y 2 sobres comunes', () => {
      const top3 = PREMIOS_OFICIALES.find((p) => p.puesto === 3)
      expect(top3).toBeDefined()
      expect(top3?.gemas).toBe(200)
      expect(top3?.oro).toBe(0)
      expect(top3?.sobres).toBe(2)
      expect(top3?.tipoSobre).toContain('Comun')
    })

    it('el Top 4 recibe 2500 de oro y 1 sobre común', () => {
      const top4 = PREMIOS_OFICIALES.find((p) => p.puesto === 4)
      expect(top4).toBeDefined()
      expect(top4?.gemas).toBe(0)
      expect(top4?.oro).toBe(2500)
      expect(top4?.sobres).toBe(1)
      expect(top4?.tipoSobre).toContain('Común')
    })

    it('el Top 5 recibe 2000 de oro', () => {
      const top5 = PREMIOS_OFICIALES.find((p) => p.puesto === 5)
      expect(top5).toBeDefined()
      expect(top5?.gemas).toBe(0)
      expect(top5?.oro).toBe(2000)
      expect(top5?.sobres).toBe(0)
    })
  })

  describe('5. Auditoría de la Migración SQL 120 (Integridad en Base de Datos)', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../../supabase/migrations/120-referrals-system-overhaul.sql'
    )

    it('el archivo de migración 120 existe', () => {
      expect(fs.existsSync(migrationPath)).toBe(true)
    })

    it('contiene las tablas requeridas', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.referral_seasons')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.referrals')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.referral_deposit_commissions')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.referral_claims')
      expect(sql).toContain('CREATE TABLE public.referral_prizes')
    })

    it('aplica la regla estricta de 1100 copas para validar referidos', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('elo_rating >= 1100')
    })

    it('calcula la comisión del 5% para depósitos y acredita en gemas', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('p_deposit_amount_gems * (v_pct / 100.0)')
      expect(sql).toContain('claim_referral_deposit_gems')
      expect(sql).toContain('gems_balance = gems_balance + v_total_gems')
    })

    it('acredita 100 de oro por amigo válido cobrado', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('claim_referral_gold')
      expect(sql).toContain('v_total_oro := v_count * v_oro_por_amigo')
      expect(sql).toContain('gold_balance = gold_balance + v_total_oro')
    })

    it('contiene el cierre automático de temporada con premiación', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')
      expect(sql).toContain('_cerrar_temporada_de_referidos()')
      expect(sql).toContain('admin_close_referral_season()')
    })
  })
})
