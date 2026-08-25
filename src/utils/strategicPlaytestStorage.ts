import type { StrategicPlaytestLog, HumanPerceptionRating } from '../engine/strategicPlaytest'

const STORAGE_KEY = 'plant_arena_strategic_playtest_logs_v1'

// In-memory fallback for test environments or SSR where localStorage is absent
let memoryFallbackLogs: StrategicPlaytestLog[] = []

/**
 * Guarda un log de partida de playtest en localStorage (o memoria) y emite reporte a consola.
 */
export function savePlaytestLog(log: StrategicPlaytestLog): void {
  try {
    const existing = getPlaytestLogs()
    existing.unshift(log)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 50)))
    } else {
      memoryFallbackLogs = existing.slice(0, 50)
    }

    // Emitir telemetría estructurada en consola
    if (typeof console !== 'undefined' && console.group) {
      console.group(`🧪 [STRATEGIC PLAYTEST] Partida ${log.matchId} — ${log.winner.toUpperCase()}`)
      console.log(`Estilo: ${log.style} | Mazo Bot: ${log.botDeckKey} | Semilla: ${log.seed}`)
      console.log(`Resultado: P1 HP = ${log.p1BaseHpEnd} | Bot HP = ${log.p2BaseHpEnd} | Duración = ${log.durationSeconds}s`)
      console.log(`Economía Bot: Sol Recibido = ${log.botSunCredited}, Gastado = ${log.botSunSpent} (Restante: ${log.botFinalSunBank})`)
      console.log(`Plantas Bot: ${log.botPlantsPlaced} colocadas en carriles [${log.lanesUsed.join(', ')}]`)
      console.log(`Anomalías Detectadas:`, log.anomaliesDetected.length > 0 ? log.anomaliesDetected : 'Ninguna (Juego Limpio)')
      console.log(`Telemetría Completa:`, log)
      console.groupEnd()
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error('Error guardando playtest log:', err)
    }
  }
}

/**
 * Obtiene todos los logs guardados en localStorage (o memoria).
 */
export function getPlaytestLogs(): StrategicPlaytestLog[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      return JSON.parse(raw) as StrategicPlaytestLog[]
    }
    return [...memoryFallbackLogs]
  } catch {
    return []
  }
}

/**
 * Actualiza la percepción humana de un log existente.
 */
export function updatePlaytestPerception(matchId: string, perception: HumanPerceptionRating): void {
  try {
    const logs = getPlaytestLogs()
    const idx = logs.findIndex((l) => l.matchId === matchId)
    if (idx !== -1) {
      logs[idx].humanPerception = perception
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs))
      } else {
        memoryFallbackLogs = logs
      }
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error('Error actualizando percepción de playtest:', err)
    }
  }
}

/**
 * Limpia todos los logs de playtest de localStorage y memoria.
 */
export function clearPlaytestLogs(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
    memoryFallbackLogs = []
  } catch {}
}

/**
 * Exporta todos los logs de playtest en formato JSON descargable.
 */
export function exportPlaytestLogsJSON(): string {
  const logs = getPlaytestLogs()
  return JSON.stringify(logs, null, 2)
}
