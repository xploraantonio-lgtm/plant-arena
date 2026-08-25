import { describe, it, expect } from 'vitest'
import type { FreePackSlot } from '../utils/freePackManager'

describe('5. Sobres — Simulación Real de Ciclo de Vida, Persistencia y Reload', () => {
  interface DbPackSlotRow {
    user_id: string
    slot_index: number
    status: 'empty' | 'locked' | 'unlocking' | 'ready'
    duration_hours: number
    arena_level: number
    unlock_started_at: Date | null
  }

  // Simulación de la tabla pack_slots de PostgreSQL
  const dbPackSlotsTable: Map<string, DbPackSlotRow> = new Map()

  function key(userId: string, slotIdx: number) {
    return `${userId}:${slotIdx}`
  }

  // Simulación de la RPC sync_pack_slots de PostgreSQL (07-fase2c-recompensas.sql)
  function rpcSyncPackSlots(userId: string, clientSlots: { slotId: number; status: string }[], serverNow: Date) {
    const resultSlots: FreePackSlot[] = []

    for (const inSlot of clientSlots) {
      const k = key(userId, inSlot.slotId)
      const prev = dbPackSlotsTable.get(k) || {
        user_id: userId,
        slot_index: inSlot.slotId,
        status: 'empty',
        duration_hours: inSlot.slotId === 0 ? 2 : inSlot.slotId === 1 ? 4 : inSlot.slotId === 2 ? 8 : 12,
        arena_level: 1,
        unlock_started_at: null,
      }

      let finalStatus = inSlot.status as DbPackSlotRow['status']
      let startedAt: Date | null = null

      if (inSlot.status === 'unlocking') {
        // PRESERVAR timestamp si ya estaba unlocking
        if (prev.status === 'unlocking' && prev.unlock_started_at !== null) {
          startedAt = prev.unlock_started_at
        } else {
          startedAt = serverNow
        }
      } else if (inSlot.status === 'ready') {
        if (prev.status === 'ready') {
          finalStatus = 'ready'
        } else if (
          prev.status === 'unlocking' &&
          prev.unlock_started_at !== null &&
          serverNow.getTime() >= prev.unlock_started_at.getTime() + prev.duration_hours * 3600 * 1000
        ) {
          finalStatus = 'ready'
        } else {
          finalStatus = prev.status
          startedAt = prev.unlock_started_at
        }
      }

      const updatedRow: DbPackSlotRow = {
        ...prev,
        status: finalStatus,
        unlock_started_at: startedAt,
      }
      dbPackSlotsTable.set(k, updatedRow)

      resultSlots.push({
        slotId: updatedRow.slot_index,
        status: updatedRow.status,
        durationHours: updatedRow.duration_hours as any,
        arenaLevel: updatedRow.arena_level,
        unlockStartedAt: updatedRow.unlock_started_at ? updatedRow.unlock_started_at.getTime() : undefined,
      })
    }

    return { slots: resultSlots }
  }

  function rpcGetUserPackSlots(userId: string): FreePackSlot[] {
    const slots: FreePackSlot[] = []
    for (let i = 0; i < 4; i++) {
      const row = dbPackSlotsTable.get(key(userId, i))
      if (row) {
        slots.push({
          slotId: row.slot_index,
          status: row.status,
          durationHours: row.duration_hours as any,
          arenaLevel: row.arena_level,
          unlockStartedAt: row.unlock_started_at ? row.unlock_started_at.getTime() : undefined,
        })
      }
    }
    return slots
  }

  function calcularTiempoRestanteMs(slot: FreePackSlot, ahora: number): number {
    if (slot.status !== 'unlocking' || !slot.unlockStartedAt) return 0
    const totalMs = slot.durationHours * 3600 * 1000
    const transcurridoMs = ahora - slot.unlockStartedAt
    return Math.max(0, totalMs - transcurridoMs)
  }

  it('5.1. Ciclo completo: Iniciar desbloqueo -> Guardar en DB -> Avanzar 30 min -> Simular reload -> Mismo timestamp y tiempo reducido', () => {
    const userId = 'user-test-uuid'
    const t0 = new Date('2026-08-25T12:00:00.000Z')

    // 1. Inicializar DB con un cofre de 2h
    dbPackSlotsTable.set(key(userId, 0), {
      user_id: userId,
      slot_index: 0,
      status: 'locked',
      duration_hours: 2,
      arena_level: 1,
      unlock_started_at: null,
    })

    // 2. Iniciar desbloqueo en t0
    const syncRes = rpcSyncPackSlots(userId, [{ slotId: 0, status: 'unlocking' }], t0)
    const slotUnlocking = syncRes.slots[0]
    expect(slotUnlocking.status).toBe('unlocking')
    expect(slotUnlocking.unlockStartedAt).toBe(t0.getTime())

    // En t0 el tiempo restante es exactamente 2 horas (7200 s)
    expect(calcularTiempoRestanteMs(slotUnlocking, t0.getTime())).toBe(2 * 3600 * 1000)

    // 3. Avanzar 30 minutos en el reloj (t1 = t0 + 30m)
    const t1 = new Date(t0.getTime() + 30 * 60 * 1000)

    // 4. Simular reload / nueva build / wipe de frontend
    // El cliente nuevo se monta y llama exclusivamente a getUserPackSlots(userId)
    const reloadedSlots = rpcGetUserPackSlots(userId)
    expect(reloadedSlots.length).toBeGreaterThan(0)
    const reloadedSlot = reloadedSlots[0]

    // Invariante 1: el timestamp en DB es exactamente t0
    expect(reloadedSlot.unlockStartedAt).toBe(t0.getTime())
    // Invariante 2: el tiempo restante en t1 es exactamente 1.5 horas (5400 s)
    const restanteEnT1 = calcularTiempoRestanteMs(reloadedSlot, t1.getTime())
    expect(restanteEnT1).toBe(90 * 60 * 1000) // 1.5 horas = 5400000 ms

    // 5. Simular llamada a syncPackSlots mientras está unlocking en t1
    // (Por ejemplo, al sincronizar tras ganar otra partida)
    const syncResT1 = rpcSyncPackSlots(userId, [{ slotId: 0, status: 'unlocking' }], t1)
    const slotPreserved = syncResT1.slots[0]

    // Invariante 3: NINGUNA inicialización ni sync posterior sobreescribe unlock_started_at
    expect(slotPreserved.unlockStartedAt).toBe(t0.getTime())
    expect(calcularTiempoRestanteMs(slotPreserved, t1.getTime())).toBe(90 * 60 * 1000)
  })
})
