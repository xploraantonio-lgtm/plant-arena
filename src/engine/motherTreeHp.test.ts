import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBattleState } from './simulate'
import { reconstruirPartidaAsync } from './asyncOpponent'
import { reconstruirConHuellas } from './reconstruir'
import { INITIAL_BASE_HP } from '../utils/gameConstants'
import { getStoredMotherTreeBonus } from '../hooks/useGameEngine'
import type { CartaDeMazo } from './mazoDeLaSala'

describe('Mother Tree Base HP - Inicializacion y Rollback', () => {
  const mockStorage: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    globalThis.localStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = String(v)
      },
      removeItem: (k: string) => {
        delete mockStorage[k]
      },
      clear: () => {
        Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
      },
      length: 0,
      key: () => null,
    } as any
  })

  afterEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  it('1. getStoredMotherTreeBonus lee treeLevel de localStorage correctamente', () => {
    expect(getStoredMotherTreeBonus()).toBe(0)

    localStorage.setItem('plant_arena_mother_tree', JSON.stringify({ treeLevel: 1 }))
    expect(getStoredMotherTreeBonus()).toBe(50)

    localStorage.setItem('plant_arena_mother_tree', JSON.stringify({ treeLevel: 3 }))
    expect(getStoredMotherTreeBonus()).toBe(150)

    localStorage.setItem('plant_arena_mother_tree', 'invalid-json')
    expect(getStoredMotherTreeBonus()).toBe(0)
  })

  it('2. createBattleState con bonus de arbol inicia a P1 en 650 y a P2 en 600', () => {
    const bonus = 50
    const state = createBattleState(
      1234,
      false,
      true,
      undefined,
      'auth-v2',
      INITIAL_BASE_HP + bonus,
      INITIAL_BASE_HP
    )
    expect(state.p1BaseHp).toBe(650)
    expect(state.p2BaseHp).toBe(600)
  })

  it('3. reconstruirPartidaAsync preserva p1BaseHp configurado (650) y no lo resetea a 600', () => {
    const p1Deck: CartaDeMazo[] = [
      { plantId: 'peashooter', level: 1, statRolls: [] },
      { plantId: 'sunflower', level: 1, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [
      { plantId: 'wallnut', level: 1, statRolls: [] },
      { plantId: 'peashooter', level: 1, statRolls: [] },
    ]

    const res = reconstruirPartidaAsync(
      999,
      p1Deck,
      p2Deck,
      [],
      [],
      30,
      'auth-v2',
      INITIAL_BASE_HP + 50,
      INITIAL_BASE_HP
    )

    expect(res.ok).toBe(true)
    expect(res.estado.p1BaseHp).toBe(650)
    expect(res.estado.p2BaseHp).toBe(600)
  })

  it('4. reconstruirConHuellas preserva p1BaseHp configurado (650) ante rollback en vivo', () => {
    const res = reconstruirConHuellas(
      888,
      [],
      30,
      true,
      'auth-v2',
      INITIAL_BASE_HP + 50,
      INITIAL_BASE_HP
    )

    expect(res.estado.p1BaseHp).toBe(650)
    expect(res.estado.p2BaseHp).toBe(600)
  })
})
