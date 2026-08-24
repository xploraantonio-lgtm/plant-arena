/**
 * LÓGICA Y VALIDACIÓN ESTRICTA DEL RELOJ AUTORITATIVO DE PARTIDA
 *
 * En partidas competitivas reales (Ranked PvP o Rival Semilla con roomId),
 * el reloj común del servidor es OBLIGATORIO para sincronizar el tic 0.
 *
 * Prohibido:
 * - Arrancar partidas desalineadas cuando falla el reloj (fail-closed).
 * - Aceptar respuestas sin ancoraMs válido o con valores no finitos.
 * - Doble arranque por reintentos o respuestas stale de salas anteriores.
 */

export interface MatchClockResponse {
  startedAt: string
  serverNow: string
  currentTick?: number
}

export interface ValidatedMatchClock {
  ancoraMs: number
  currentTick: number
}

export function computeAncoraMs(
  startedAt: string,
  serverNow: string,
  antesMs: number,
  despuesMs: number
): number {
  if (!startedAt || !serverNow) {
    throw new Error('Datos de tiempo insuficientes para calcular ancoraMs')
  }

  const inicioServidor = new Date(startedAt).getTime()
  const ahoraServidor = new Date(serverNow).getTime()

  if (!Number.isFinite(inicioServidor) || !Number.isFinite(ahoraServidor)) {
    throw new Error('Fechas de reloj del servidor inválidas')
  }

  if (!Number.isFinite(antesMs) || !Number.isFinite(despuesMs) || despuesMs < antesMs) {
    throw new Error('Tiempos locales de medición inválidos')
  }

  const medioViaje = Math.max(0, (despuesMs - antesMs) / 2)
  const llevaAndando = ahoraServidor - inicioServidor
  const ancoraMs = despuesMs - medioViaje - llevaAndando

  if (!Number.isFinite(ancoraMs)) {
    throw new Error('ancoraMs calculado no es un número finito')
  }

  return ancoraMs
}

export function validateMatchClock(
  data: unknown,
  antesMs: number,
  despuesMs: number
): ValidatedMatchClock {
  if (!data || typeof data !== 'object') {
    throw new Error('Respuesta de reloj inválida: no es un objeto')
  }

  const res = data as Partial<MatchClockResponse>
  if (!res.startedAt || typeof res.startedAt !== 'string') {
    throw new Error('Respuesta de reloj sin startedAt válido')
  }
  if (!res.serverNow || typeof res.serverNow !== 'string') {
    throw new Error('Respuesta de reloj sin serverNow válido')
  }

  const ancoraMs = computeAncoraMs(res.startedAt, res.serverNow, antesMs, despuesMs)
  const currentTick = Number.isInteger(res.currentTick) ? (res.currentTick as number) : 0

  return {
    ancoraMs,
    currentTick,
  }
}

/**
 * Gestor de sincronización de reloj con protección de generación stale y double-start.
 */
export class MatchClockSyncCoordinator {
  private currentGeneration = 0
  private hasStartedForGeneration = new Set<number>()

  public prepareNewAttempt(): number {
    this.currentGeneration += 1
    return this.currentGeneration
  }

  public shouldStartGame(generation: number, clock: ValidatedMatchClock | null): boolean {
    if (generation !== this.currentGeneration) {
      // Respuesta stale de una sala o intento anterior
      return false
    }

    if (this.hasStartedForGeneration.has(generation)) {
      // Ya se arrancó para este intento (evitar doble llamada)
      return false
    }

    if (!clock || typeof clock.ancoraMs !== 'number' || !Number.isFinite(clock.ancoraMs)) {
      // Sin reloj válido o finito
      return false
    }

    this.hasStartedForGeneration.add(generation)
    return true
  }

  public getCurrentGeneration(): number {
    return this.currentGeneration
  }
}
