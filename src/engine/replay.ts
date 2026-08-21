// ─────────────────────────────────────────────────────────────────────────────
// REPRODUCIR Y VERIFICAR UNA PARTIDA
//
// La repetición visual vuelve a ejecutar las acciones guardadas.
// La verificación autoritativa hace algo más importante: reconstruye DOS vistas,
// una desde P1 y otra desde P2, y valida las entradas locales exactamente donde
// nacen (soles, cooldown, slot y casilla) antes de introducirlas en el lockstep.
//
// Esto permite que una Edge Function sea el árbitro. El navegador puede decir
// "yo vi que ganó X", pero ese dato es sólo diagnóstico: el ganador oficial sale
// de recalcular seed + decks + acciones.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createBattleState,
  stepTick,
  type GameState,
} from './simulate.ts'
import { MARGEN_DE_RED_TICS } from './pvp.ts'
import { TOPE_DE_PARTIDA_MS } from './balance.ts'
import { msToTicks } from './time.ts'
import { leerMazo, type CartaDeMazo } from './mazoDeLaSala.ts'
import type { PlantId, PlantStatKey } from '../types/game.ts'
import {
  PLANT_CONFIGS,
  P1_COLUMNS,
  getScaledPlantConfig,
} from '../utils/gameConstants.ts'

const TOPE_DE_SEGURIDAD = msToTicks(TOPE_DE_PARTIDA_MS) + 600
const ENGINE_AUTORITATIVO = 'auth-v1'
const MAX_CATCHUP_TICKS = msToTicks(5000)
const ESTADISTICAS_VALIDAS = new Set<PlantStatKey>([
  'hp',
  'damage',
  'attackSpeed',
  'moveSpeed',
  'cooldown',
])

export interface JugadaGrabada {
  /** Identificador global de match_actions; sirve para auditoría y desempate. */
  id?: number
  /** Secuencia monotónica del jugador dentro de la sala. */
  seq?: number
  /** 1 o 2; nunca el UUID del usuario en una repetición pública. */
  de: 1 | 2
  /** Tic en que el efecto de red debe ejecutarse. */
  tick: number
  /** Tic real del clic/intención. Para plant/dig normalmente es tick - 6. */
  issuedTick?: number | null
  kind: string
  plantId: string | null
  lane: number | null
  col: number | null
  /** Hueco exacto del mazo usado. Necesario si hay cartas repetidas. */
  slot?: number | null
  /** Para collect: id determinista del sol recogido. */
  targetId?: string | null
}

export interface DatosDeRepeticion {
  roomId: string
  mode: string
  seed: number
  engineVersion?: string | null
  jugadaEn: string
  jugador1: {
    nombre: string | null
    avatar: string | null
    mazo?: unknown
  }
  jugador2: {
    nombre: string | null
    avatar: string | null
    mazo?: unknown
  }
  ganador: 1 | 2 | null
  yoSoy: 1 | 2 | null
  jugadas: JugadaGrabada[]
}

export interface Repeticion {
  estado: GameState
  ultimoTic: number
  ticFinal: number
  resultado: 'victory' | 'defeat' | null
  desde: 1 | 2
  avanzar(): boolean
  irAlTic(objetivo: number): void
}

export interface AccionIlegal {
  de: 1 | 2
  id?: number
  seq?: number
  tick: number
  issuedTick: number
  kind: string
  razon: string
}

export interface ResultadoAutoritativo {
  ganador: 1 | 2 | null
  tics: number
  baseP1: number
  baseP2: number
  /** Vista inversa, útil para detectar una asimetría real del motor. */
  baseP1VistaP2: number
  baseP2VistaP2: number
  ilegales: AccionIlegal[]
  /** true sólo si las dos vistas terminan con resultados complementarios. */
  consistente: boolean
  motivo:
    | 'simulation'
    | 'forfeit_p1'
    | 'forfeit_p2'
    | 'illegal_both'
    | 'engine_divergence'
    | 'true_draw'
    | 'no_result'
}

interface CartaResuelta {
  plantId: PlantId
  slot: number | null
  level: number
  statRolls: PlantStatKey[]
}

function esPlantId(x: string | null | undefined): x is PlantId {
  return !!x && Object.prototype.hasOwnProperty.call(PLANT_CONFIGS, x)
}

function mazoDe(datos: DatosDeRepeticion, de: 1 | 2): CartaDeMazo[] | null {
  return leerMazo(de === 1 ? datos.jugador1.mazo : datos.jugador2.mazo)
}

function rollsValidos(brutos: string[] | null | undefined): PlantStatKey[] {
  return (brutos ?? []).filter((r): r is PlantStatKey =>
    ESTADISTICAS_VALIDAS.has(r as PlantStatKey)
  )
}

/**
 * Resuelve la carta exclusivamente desde el mazo guardado por el servidor.
 * Para auth-v1 el slot es obligatorio. En partidas legacy se conserva el fallback
 * a la primera copia para que las repeticiones antiguas sigan abriendo.
 */
function resolverCarta(
  mazo: CartaDeMazo[] | null,
  plantId: string | null,
  slot: number | null | undefined,
  estricto: boolean
): { carta: CartaResuelta | null; error?: string } {
  if (!esPlantId(plantId)) return { carta: null, error: 'plant_id_invalido' }
  if (!estricto && (!mazo || mazo.length === 0)) {
    return {
      carta: {
        plantId,
        slot: slot ?? null,
        statRolls: [],
        level: 0,
      },
    }
  }
  if (!mazo || mazo.length === 0) return { carta: null, error: 'mazo_no_disponible' }

  let encontrada: CartaDeMazo | undefined
  if (slot !== null && slot !== undefined) {
    encontrada = mazo.find((c) => c.slot === slot)
    // Compatibilidad con mazos viejos que no guardaban `slot` pero sí el orden.
    if (!encontrada && mazo[slot] && (mazo[slot].slot === null || mazo[slot].slot === undefined)) {
      encontrada = mazo[slot]
    }
  } else if (!estricto) {
    encontrada = mazo.find((c) => c.plantId === plantId)
  }

  if (!encontrada) {
    if (!estricto) {
      return {
        carta: {
          plantId,
          slot: slot ?? null,
          statRolls: [],
          level: 0,
        },
      }
    }
    return { carta: null, error: 'slot_no_existe_en_mazo' }
  }
  if (encontrada.plantId !== plantId) return { carta: null, error: 'slot_no_corresponde_a_carta' }

  const statRolls = rollsValidos(encontrada.statRolls)
  const level = statRolls.length > 0 ? statRolls.length : Math.max(0, encontrada.level ?? 0)

  return {
    carta: {
      plantId,
      slot: slot ?? encontrada.slot ?? null,
      statRolls,
      level,
    },
  }
}

function issuedTickDe(j: JugadaGrabada): number {
  if (Number.isInteger(j.issuedTick) && (j.issuedTick as number) >= 0) return j.issuedTick as number
  if (j.kind === 'collect') return Math.max(0, j.tick)
  return Math.max(0, j.tick - MARGEN_DE_RED_TICS)
}

function ordenarJugadas(jugadas: JugadaGrabada[]): JugadaGrabada[] {
  return [...jugadas].sort((a, b) => {
    const ia = issuedTickDe(a)
    const ib = issuedTickDe(b)
    if (ia !== ib) return ia - ib
    if (a.de !== b.de) return a.de - b.de
    const sa = a.seq ?? Number.MAX_SAFE_INTEGER
    const sb = b.seq ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return (a.id ?? 0) - (b.id ?? 0)
  })
}

function encolarPlanta(
  estado: GameState,
  propia: boolean,
  j: JugadaGrabada,
  carta: CartaResuelta
): void {
  if (propia) {
    estado.pending.push({
      atTick: Math.max(1, j.tick),
      kind: 'own_plant',
      plantId: carta.plantId,
      lane: j.lane!,
      col: j.col ?? undefined,
      statRolls: carta.statRolls,
      level: carta.level,
    })
  } else {
    estado.pending.push({
      atTick: Math.max(1, j.tick),
      kind: 'rival_plant',
      plantId: carta.plantId,
      lane: j.lane!,
      col: j.col ?? undefined,
      statRolls: carta.statRolls,
      level: carta.level,
    })
  }
}

function encolarDig(estado: GameState, propia: boolean, j: JugadaGrabada): void {
  if (propia) {
    estado.pending.push({
      atTick: Math.max(1, j.tick),
      kind: 'own_dig',
      lane: j.lane!,
      col: j.col!,
    })
  } else {
    estado.pending.push({
      atTick: Math.max(1, j.tick),
      kind: 'rival_dig',
      lane: j.lane!,
      col: j.col!,
    })
  }
}

/**
 * Repetición visual. Para partidas auth-v1 usa slot/upgrades y también reproduce
 * excavaciones. La economía no decide nada aquí porque sólo estamos mostrando un
 * registro ya jugado; la comprobación dura vive en recalcularGanadorAutoritativo.
 */
export function construirRepeticion(datos: DatosDeRepeticion, desde: 1 | 2 = 1): Repeticion {
  const jugadas = ordenarJugadas(datos.jugadas)
  const ultimoTic = jugadas.reduce((m, j) => Math.max(m, j.tick), 0)

  function estadoInicial(): GameState {
    const estado = createBattleState(datos.seed, false, true)
    const estricto = datos.engineVersion === ENGINE_AUTORITATIVO

    for (const j of jugadas) {
      if (j.kind === 'plant' && j.plantId && j.lane !== null) {
        const { carta } = resolverCarta(mazoDe(datos, j.de), j.plantId, j.slot, estricto)
        if (!carta) continue
        encolarPlanta(estado, j.de === desde, j, carta)
      } else if (j.kind === 'dig' && j.lane !== null && j.col !== null) {
        encolarDig(estado, j.de === desde, j)
      }
    }
    return estado
  }

  const medida = (() => {
    const e = estadoInicial()
    let n = 0
    while (e.status === 'playing' && n < TOPE_DE_SEGURIDAD) {
      stepTick(e, () => {})
      n += 1
    }
    return {
      tic: e.tick,
      resultado:
        e.status === 'victory' ? ('victory' as const)
        : e.status === 'defeat' ? ('defeat' as const)
        : null,
    }
  })()

  let estado = estadoInicial()

  return {
    get estado() { return estado },
    ultimoTic,
    ticFinal: medida.tic,
    resultado: medida.resultado,
    desde,
    avanzar() {
      if (estado.status !== 'playing') return false
      stepTick(estado, () => {})
      return estado.status === 'playing'
    },
    irAlTic(objetivo) {
      if (objetivo < estado.tick) estado = estadoInicial()
      while (estado.tick < objetivo && estado.status === 'playing') {
        stepTick(estado, () => {})
      }
    },
  }
}

/** Compatibilidad: verificador antiguo, sin economía ni legalidad. */
export function recalcularGanador(
  datos: DatosDeRepeticion,
  topeTics = 20000
): { ganador: 1 | 2 | null; tics: number; baseP1: number; baseP2: number } {
  const rep = construirRepeticion(datos, 1)
  let tics = 0
  while (rep.estado.status === 'playing' && tics < topeTics) {
    rep.avanzar()
    tics += 1
  }
  const ganador =
    rep.estado.status === 'victory' ? 1
    : rep.estado.status === 'defeat' ? 2
    : null
  return {
    ganador,
    tics,
    baseP1: rep.estado.p1BaseHp,
    baseP2: rep.estado.p2BaseHp,
  }
}

function registrarIlegal(
  ilegales: AccionIlegal[],
  j: JugadaGrabada,
  razon: string
): void {
  ilegales.push({
    de: j.de,
    id: j.id,
    seq: j.seq,
    tick: j.tick,
    issuedTick: issuedTickDe(j),
    kind: j.kind,
    razon,
  })
}

function validarCoordenadas(j: JugadaGrabada): string | null {
  if (j.kind === 'collect') return null
  if (!Number.isInteger(j.lane) || (j.lane as number) < 0 || (j.lane as number) > 2) {
    return 'lane_invalido'
  }
  if (!Number.isInteger(j.col) || (j.col as number) < 0 || (j.col as number) >= P1_COLUMNS) {
    return 'col_fuera_de_tu_mitad'
  }
  return null
}

function validarYAplicarIntencion(
  datos: DatosDeRepeticion,
  j: JugadaGrabada,
  vistaP1: GameState,
  vistaP2: GameState,
  ilegales: AccionIlegal[]
): void {
  const estricto = datos.engineVersion === ENGINE_AUTORITATIVO
  const emitido = issuedTickDe(j)
  const propia = j.de === 1 ? vistaP1 : vistaP2
  const otra = j.de === 1 ? vistaP2 : vistaP1

  if (emitido !== propia.tick) {
    registrarIlegal(ilegales, j, 'issued_tick_fuera_de_orden')
    return
  }

  if (j.kind === 'collect') {
    if (!j.targetId) {
      registrarIlegal(ilegales, j, 'collect_sin_target_id')
      return
    }
    if (estricto && j.tick !== emitido) {
      registrarIlegal(ilegales, j, 'collect_tick_invalido')
      return
    }
    const sol = propia.suns.find((s) => s.id === j.targetId)
    if (!sol) {
      registrarIlegal(ilegales, j, 'sol_no_existe_o_ya_fue_recogido')
      return
    }
    propia.suns = propia.suns.filter((s) => s.id !== sol.id)
    propia.sunBank += sol.value
    propia.stats.sunsCollected += 1
    propia.stats.score += 50
    return
  }

  const errorCoord = validarCoordenadas(j)
  if (errorCoord) {
    registrarIlegal(ilegales, j, errorCoord)
    return
  }

  if (estricto && j.tick !== emitido + MARGEN_DE_RED_TICS) {
    registrarIlegal(ilegales, j, 'margen_de_red_invalido')
    return
  }

  if (j.kind === 'dig') {
    // El cliente sólo permite excavar una planta estática que realmente existe.
    const victima = propia.plants.find(
      (p) => p.lane === j.lane && p.col === j.col && !p.isWalking
    )
    if (!victima) {
      registrarIlegal(ilegales, j, 'dig_sin_planta_estatica')
      return
    }
    encolarDig(propia, true, j)
    encolarDig(otra, false, j)
    return
  }

  if (j.kind !== 'plant') {
    registrarIlegal(ilegales, j, 'tipo_de_accion_desconocido')
    return
  }

  if (!j.plantId) {
    registrarIlegal(ilegales, j, 'plant_sin_plant_id')
    return
  }

  if (estricto && (!Number.isInteger(j.slot) || (j.slot as number) < 0 || (j.slot as number) > 5)) {
    registrarIlegal(ilegales, j, 'slot_obligatorio_o_invalido')
    return
  }

  const resuelta = resolverCarta(mazoDe(datos, j.de), j.plantId, j.slot, estricto)
  if (!resuelta.carta) {
    registrarIlegal(ilegales, j, resuelta.error ?? 'carta_invalida')
    return
  }
  const carta = resuelta.carta
  const config = getScaledPlantConfig(carta.plantId, carta.statRolls)
  if (!config) {
    registrarIlegal(ilegales, j, 'config_de_carta_inexistente')
    return
  }

  if (propia.sunBank < config.cost) {
    registrarIlegal(ilegales, j, `soles_insuficientes:${propia.sunBank}<${config.cost}`)
    return
  }

  if (carta.slot !== null) {
    if ((propia.slotCooldowns[carta.slot] || 0) > propia.tick) {
      registrarIlegal(ilegales, j, 'slot_en_cooldown')
      return
    }
  } else if ((propia.cooldowns[carta.plantId] || 0) > propia.tick) {
    registrarIlegal(ilegales, j, 'carta_en_cooldown')
    return
  }

  const camina = config.category === 'melee' || !!config.moveSpeed || carta.plantId === 'chomper'
  if (!camina) {
    const ocupada = propia.plants.some(
      (p) => p.lane === j.lane && p.col === j.col && !p.isWalking
    )
    if (ocupada) {
      registrarIlegal(ilegales, j, 'casilla_ocupada')
      return
    }
  }

  // Igual que useGameEngine.placePlant: se paga y empieza cooldown en el tic del
  // clic; la entidad aparece MARGEN_DE_RED_TICS después en las dos vistas.
  propia.sunBank -= config.cost
  if (carta.slot !== null) {
    propia.slotCooldowns[carta.slot] = propia.tick + msToTicks(config.cooldownMs)
  } else {
    propia.cooldowns[carta.plantId] = propia.tick + msToTicks(config.cooldownMs)
  }
  propia.stats.plantsPlaced += 1

  encolarPlanta(propia, true, j, carta)
  encolarPlanta(otra, false, j, carta)
}

function ganadorDesdeVistaP1(estado: GameState): 1 | 2 | null {
  return estado.status === 'victory' ? 1 : estado.status === 'defeat' ? 2 : null
}

function ganadorDesdeVistaP2(estado: GameState): 1 | 2 | null {
  // En la segunda simulación P2 es el jugador local/izquierdo.
  return estado.status === 'victory' ? 2 : estado.status === 'defeat' ? 1 : null
}

function esEmpatePerfecto(estado: GameState): boolean {
  if (estado.status !== 'defeat') return false
  if (Math.abs(estado.p1BaseHp - estado.p2BaseHp) > 1e-9) return false
  if (estado.plants.length !== estado.enemyPlants.length) return false
  const propia = estado.plants.reduce((t, p) => t + Math.max(0, p.hp), 0)
  const rival = estado.enemyPlants.reduce((t, p) => t + Math.max(0, p.hp), 0)
  return Math.abs(propia - rival) <= 1e-9
}

/**
 * Árbitro autoritativo de auth-v1.
 *
 * Dos simulaciones son deliberadas: cada navegador mantiene SU economía local y
 * SUS soles recogibles. Así P1 puede validar sus target_id contra vistaP1.suns y
 * P2 contra vistaP2.suns sin inventar una economía para el lado remoto.
 */
export function recalcularGanadorAutoritativo(
  datos: DatosDeRepeticion,
  topeTics = TOPE_DE_SEGURIDAD
): ResultadoAutoritativo {
  const vistaP1 = createBattleState(datos.seed, false, true)
  const vistaP2 = createBattleState(datos.seed, false, true)
  const jugadas = ordenarJugadas(datos.jugadas)
  const ilegales: AccionIlegal[] = []
  let i = 0
  let pasos = 0

  while (
    vistaP1.status === 'playing' &&
    vistaP2.status === 'playing' &&
    pasos < topeTics
  ) {
    // Las entradas ocurren ENTRE tics, cuando state.tick todavía vale N.
    while (i < jugadas.length && issuedTickDe(jugadas[i]) === vistaP1.tick) {
      validarYAplicarIntencion(datos, jugadas[i], vistaP1, vistaP2, ilegales)
      i += 1
    }

    // Una acción que llegó con issuedTick menor al tic actual no puede aparecer
    // mágicamente en el pasado durante una verificación autoritativa.
    while (i < jugadas.length && issuedTickDe(jugadas[i]) < vistaP1.tick) {
      registrarIlegal(ilegales, jugadas[i], 'accion_en_el_pasado')
      i += 1
    }

    stepTick(vistaP1, () => {})
    stepTick(vistaP2, () => {})
    pasos += 1
  }

  // ============================================================
  // CATCH-UP DE PERSPECTIVAS
  //
  // Antes el árbitro se detenía en cuanto UNA vista terminaba.
  //
  // Ejemplo:
  //   vista P1 = victory
  //   vista P2 = playing durante 2 ticks más
  //
  // El código antiguo comparaba:
  //   P1 = ganador
  //   P2 = null
  //
  // y lo declaraba engine_divergence.
  //
  // Ya no aceptamos NUEVAS decisiones después del primer final,
  // pero dejamos terminar los efectos que YA estaban dentro del
  // motor/pending/projectiles.
  // ============================================================

  let catchup = 0

  while (
    (vistaP1.status === 'playing' ||
      vistaP2.status === 'playing') &&
    pasos < topeTics &&
    catchup < MAX_CATCHUP_TICKS
  ) {
    if (vistaP1.status === 'playing') {
      stepTick(vistaP1, () => {})
    }

    if (vistaP2.status === 'playing') {
      stepTick(vistaP2, () => {})
    }

    pasos += 1
    catchup += 1
  }

  const ganadorP1 = ganadorDesdeVistaP1(vistaP1)
  const ganadorP2 = ganadorDesdeVistaP2(vistaP2)
  const p1Ilegal = ilegales.some((x) => x.de === 1)
  const p2Ilegal = ilegales.some((x) => x.de === 2)

  let ganador: 1 | 2 | null = null
  let motivo: ResultadoAutoritativo['motivo'] = 'no_result'

  if (p1Ilegal && !p2Ilegal) {
    ganador = 2
    motivo = 'forfeit_p1'
  } else if (p2Ilegal && !p1Ilegal) {
    ganador = 1
    motivo = 'forfeit_p2'
  } else if (p1Ilegal && p2Ilegal) {
    motivo = 'illegal_both'
  } else if (
    vistaP1.status === 'defeat' &&
    vistaP2.status === 'defeat' &&
    esEmpatePerfecto(vistaP1) &&
    esEmpatePerfecto(vistaP2)
  ) {
    // decidirPorPuntos devuelve 'defeat' a los dos en un empate absolutamente
    // simétrico para no inventar un ganador dependiente de la perspectiva.
    motivo = 'true_draw'
  } else if (ganadorP1 !== null && ganadorP1 === ganadorP2) {
    ganador = ganadorP1
    motivo = 'simulation'
  } else if (ganadorP1 !== ganadorP2) {
    motivo = 'engine_divergence'
  }

  const consistente =
    (ganadorP1 !== null && ganadorP1 === ganadorP2) || motivo === 'true_draw'

  return {
    ganador,
    tics: Math.max(vistaP1.tick, vistaP2.tick),
    baseP1: vistaP1.p1BaseHp,
    baseP2: vistaP1.p2BaseHp,
    // En vistaP2, su p1BaseHp es la base física de P2 y su p2BaseHp la de P1.
    baseP1VistaP2: vistaP2.p2BaseHp,
    baseP2VistaP2: vistaP2.p1BaseHp,
    ilegales,
    consistente,
    motivo,
  }
}
