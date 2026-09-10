import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { PlantId, ColosseumMatchConfig, EngineVersion } from '../../types/game'
import { parseEngineVersion } from '../../types/game'
import { TournamentManager, type ActiveTournamentSession } from '../../utils/tournamentManager'
import { tournamentService } from '../../services/tournamentService'
import { useGameEngine } from '../../hooks/useGameEngine'
import { useAuth } from '../../hooks/useAuth'
import { battleService } from '../../services/battleService'
import { supabaseService } from '../../services/supabaseService'
import {
  MatchActionOutbox,
  type MatchActionIntent,
} from '../../services/matchActionOutbox'
import {
  PLANT_CONFIGS,
  LANES_CONFIG,
  BASE_LEFT_END_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  P1_COLUMNS,
  INITIAL_BASE_HP,
} from '../../utils/gameConstants'
import { getArenaForElo, getEloDeltasForElo, getTrophyGateForElo } from '../../utils/arenaManager'
const sunIcon = '/game-assets/greenfoot/sun1.webp'
const peaImg = '/game-assets/images/Plants/PB00.webp'
const melonImg = '/game-assets/images/Plants/melon_pult.webp'
const needleImg = '/game-assets/greenfoot/needle1.png'
import PlantHand from './PlantHand'
import RelojDePartida from '../RelojDePartida/RelojDePartida'
import { SOL_SE_RECOGE_SOLO_MS } from '../../engine/balance'
import { MARGEN_DE_RED_TICS } from '../../engine/pvp'
import { TICK_MS } from '../../engine/time'
import { soundManager } from '../../utils/audioManager'
import { toggleFullscreen } from '../../utils/fullscreen'
import { resolverLiquidacionPartida } from '../../engine/asyncOpponent'
import { StrategicPlaytestPostMatch } from '../StrategicPlaytest/StrategicPlaytestPostMatch'
import type { StrategicPlaytestConfig } from '../../engine/strategicPlaytest'
import { recordPlantPlacement } from '../../utils/plantUsageTracker'
import './Battlefield.css'

/** Un segundo antes de que el sol se recoja solo: momento de avisar. */
const TICS_ANTES_DE_RECOGERSE_SOLO = Math.round((SOL_SE_RECOGE_SOLO_MS - 1000) / TICK_MS)

function getBattlefieldPlantLevel(plantId: string): number {
  try {
    const saved = localStorage.getItem('plant_arena_plant_levels')
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed[plantId] || 0
    }
  } catch {}
  return 0
}

interface BaseTowerProps {
  team: 'p1' | 'p2'
  hp: number
  maxHp: number
  sunBank?: number
  /** El nick del dueño de este árbol. Sin él se usa la etiqueta genérica. */
  nombre?: string | null
  level?: number
}

const motherTreeImg = '/game-assets/greenfoot/mothertree_whitebg.webp'

function BaseTower({ team, hp, maxHp, sunBank, nombre, level }: BaseTowerProps) {
  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100))

  return (
    <div className={`base base--${team}`}>
      <div className="base__top">
        <div className="base__hp">
          <div
            className="base__hp-fill"
            style={{
              width: `${hpPct}%`,
              backgroundColor: team === 'p1' ? '#52e061' : '#ff4d4d',
            }}
          />
        </div>
        <span className="base__label">
          {/* El nick cuando se sabe de quién es el árbol; la etiqueta genérica
              contra el bot, donde no hay nadie al otro lado. */}
          🌳 {nombre
            ? nombre
            : team === 'p1' ? 'ÁRBOL MADRE (P1)' : 'ÁRBOL MADRE (P2)'}
          {level !== undefined && level > 0 && (
            <span style={{ color: '#facc15', fontWeight: 900, marginLeft: '4px' }}>[Nv.{level}]</span>
          )}{' '}
          <span style={{ color: '#ffffff', fontWeight: 800, marginLeft: '2px' }}>
            ({Math.round(hp)}/{maxHp})
          </span>
        </span>
        {team === 'p2' && sunBank !== undefined && (
          <div className="base__pc-sun">
            <img src={sunIcon} alt="Sol" className="base__pc-sun-icon" />
            <span>{sunBank}</span>
          </div>
        )}
      </div>
      <div className="base__tree-wrap" style={{ position: 'relative' }}>
        {team === 'p1' && level !== undefined && level > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: '-10%',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(74, 222, 128, 0.45) 0%, transparent 70%)',
              filter: 'blur(10px)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )}
        <img
          src={motherTreeImg}
          alt={team === 'p1' ? 'Árbol Madre P1' : 'Árbol Madre P2'}
          className={`base__mothertree-img ${team === 'p2' ? 'base__mothertree-img--p2' : ''}`}
          style={{ position: 'relative', zIndex: 1 }}
        />
      </div>
    </div>
  )
}

interface BattlefieldProps {
  onBackToMenu?: () => void
  onBackToCollection?: () => void
  onBattleComplete?: (isVictory: boolean) => any
  onSurrender?: () => any
  practicePlantId?: string | null
  activeDeck?: PlantId[]
  userElo?: number
  customBgImage?: string
  matchMode?: 'ranked' | 'colosseum' | 'tournament' | 'strategic_test' | 'friendly'
  friendlyBetGems?: number
  colosseumConfig?: ColosseumMatchConfig | null
  tournamentOpponent?: { name: string; tournamentId: string } | null
  tournamentDeck?: PlantId[] | null
  onColosseumComplete?: (won: boolean) => { payoutGems: number; newStreak: number; newMaxStreak: number; isNewRecord: boolean }
  strategicPlaytestConfig?: StrategicPlaytestConfig | null
  onPlayAgainPlaytest?: () => void
  /**
   * La sala de la partida, si es contra otro jugador de verdad.
   *
   * Con sala: el resultado lo liquida el servidor (report_match_result), que
   * exige que AMBOS reporten el mismo ganador. Sin sala la partida es contra el
   * bot local y no cuenta: ni ELO real ni reporte.
   */
  roomId?: string | null
  /**
   * La semilla del azar, que viene de game_rooms.seed.
   *
   * Es la MISMA para los dos jugadores: es lo que hace que ambos simulen
   * exactamente la misma partida (engine/simulate.ts). Sin ella se usa la de por
   * defecto, que sirve para jugar en solitario.
   */
  seed?: number
  /** El rival, para poder decirle al servidor quién ganó. */
  opponentId?: string | null
  /**
   * Los nicks de los dos, para ponerlos encima de cada árbol.
   *
   * Sin esto se lee "ÁRBOL MADRE (P1)" y "ÁRBOL MADRE (P2)", que no dice quién
   * es quién. Contra el bot no hay nombres y se cae a las etiquetas de siempre.
   */
  nombres?: { mio: string; rival: string } | null
  /**
   * Si soy el jugador 1 de la sala.
   *
   * Lo necesita la huella del tablero: cada jugador se ve a sí mismo a la
   * izquierda, así que las dos huellas sólo se pueden comparar si las dos están
   * normalizadas al punto de vista del jugador 1.
   */
  soyP1?: boolean
  /**
   * Los dos mazos de la sala, tal como los guardó el servidor al emparejar.
   *
   * Con el nivel y las mejoras de cada carta. Es de donde salen las estadísticas de
   * las plantas de LOS DOS lados, y por eso las dos pantallas simulan la misma
   * planta: antes cada uno aplicaba sus mejoras desde su propio navegador y el
   * rival ponía la carta básica, así que la misma planta tenía 345 de vida en un
   * lado y 300 en el otro desde el momento de plantarla. Ver
   * engine/mazoDeLaSala.ts.
   */
  mazosDeLaSala?: { mio: unknown; rival: unknown } | null
  isAsyncMatch?: boolean
  engineVersion?: EngineVersion | null
  onServerEloUpdated?: (newElo: number) => void
}

export default function Battlefield({
  onBackToMenu,
  onBackToCollection,
  onBattleComplete,
  onSurrender,
  onServerEloUpdated,
  practicePlantId,
  activeDeck,
  userElo = 1000,
  customBgImage,
  matchMode = 'ranked',
  friendlyBetGems,
  roomId = null,
  seed,
  opponentId = null,
  nombres = null,
  soyP1 = true,
  mazosDeLaSala = null,
  isAsyncMatch = false,
  engineVersion = null,
  colosseumConfig,
  tournamentOpponent,
  tournamentDeck,
  onColosseumComplete,
  strategicPlaytestConfig = null,
  onPlayAgainPlaytest,
}: BattlefieldProps) {
  const {
    tick,
    desfaseDeTics,
    gameStatus,
    isPracticeMode,
    isMuted,
    toggleMute,
    p1BaseHp,
    p2BaseHp,
    sunBank,
    p2SunBank,
    plants,
    enemyPlants,
    projectiles,
    suns,
    selectedCard,
    selectedSlotIndex,
    setSelectedCard,
    cooldowns,
    slotCooldowns,
    waveBanner,
    stats,
    startGame,
    startPracticeGame,
    startStrategicPlaytestGame,
    currentPlaytestLog,
    surrenderGame,
    prepararRecogidaSol,
    confirmarRecogidaSol,
    collectSun,
    placePlant,
    digPlant,
    pendingOwnPlants = [],
    encolarAccionDelRival,
    descartarAccionPropia,
    confirmarAccionP1,
    incorporarIntencionesAsync,
    reconciliationState,
    terminarPorOrdenDelServidor,
    tomarHuellasPendientes,
    reconstrucciones,
    rankedAsyncInconsistency,
    sessionGeneration,
    updateInitialTreeBonusHp,
  } = useGameEngine()

  const { user } = useAuth()
  const currentUserId = user?.id ?? null

  const [treeLevel, setTreeLevel] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('plant_arena_mother_tree')
      if (raw) {
        const parsed = JSON.parse(raw)
        return typeof parsed?.treeLevel === 'number' ? parsed.treeLevel : 0
      }
    } catch (_) {}
    return 0
  })

  const [treeBonusHp, setTreeBonusHp] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('plant_arena_mother_tree')
      if (raw) {
        const parsed = JSON.parse(raw)
        return typeof parsed?.treeLevel === 'number' ? parsed.treeLevel * 50 : 0
      }
    } catch (_) {}
    return 0
  })
  const treeBonusHpRef = useRef<number>(treeBonusHp)
  treeBonusHpRef.current = treeBonusHp

  useEffect(() => {
    void supabaseService.getMotherTreeState().then((res) => {
      if (typeof res?.treeLevel === 'number') {
        const bonus = res.treeLevel * 50
        setTreeLevel(res.treeLevel)
        setTreeBonusHp(bonus)
        treeBonusHpRef.current = bonus
        updateInitialTreeBonusHp(bonus)
      }
    })
  }, [updateInitialTreeBonusHp])

  const [showPvpDiag, setShowPvpDiag] = useState<boolean>(false)

  const sessionGenerationRef = useRef<number>(sessionGeneration ?? 0)
  sessionGenerationRef.current = sessionGeneration ?? 0
  const roomIdRef = useRef<string | null>(roomId ?? null)
  roomIdRef.current = roomId ?? null

  /**
   * Lo que dijo el servidor al liquidar la partida real.
   *
   * Tres estados que importan y hay que enseñar tal cual:
   *   'esperando_al_rival'   → tu reporte está registrado, falta el del otro
   *   'resultado_en_disputa' → cada uno dijo algo distinto; no cobra nadie
   *   'liquidada'            → repartido, con su ELO y su pago
   */
  const [resultadoServidor, setResultadoServidor] = useState<{
    success?: boolean
    status?: string
    eloBefore?: number
    opponentElo?: number
    eloDelta?: number
    eloAfter?: number
    eloGained?: number
    eloLost?: number
    payout?: number
    error?: string
  } | null>(null)

  const esperandoConfirmacionServidor =
    Boolean(roomId) &&
    (
      resultadoServidor === null ||
      ['verificando', 'verificacion_pendiente'].includes(
        resultadoServidor.status ?? ''
      )
    )

  const resultadoEnRevision =
    resultadoServidor?.status === 'revision_servidor'

  const resultadoEmpatado =
    ['empate_verificado', 'resultado_en_disputa'].includes(
      resultadoServidor?.status ?? ''
    )

  const [battleSummaryResult, setBattleSummaryResult] = useState<{
    eloChange?: number
    newElo?: number
    packResult?: { awarded: boolean; durationHours?: 2 | 4 | 8 | 12; arenaLevel?: number; isSlotsFull?: boolean }
    isSurrendered?: boolean
  } | null>(null)

  const [clockSyncStatus, setClockSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [clockSyncError, setClockSyncError] = useState<string | null>(null)
  const matchClockGenRef = useRef<number>(0)
  const startedGensRef = useRef<Set<number>>(new Set())

  const syncAndStartMatchClock = useCallback((targetRoomId: string) => {
    matchClockGenRef.current += 1
    const attemptGen = matchClockGenRef.current
    setClockSyncStatus('syncing')
    setClockSyncError(null)

    battleService.startMatchClock(targetRoomId)
      .then((reloj) => {
        // Protección contra respuestas stale o doble inicio:
        if (matchClockGenRef.current !== attemptGen || startedGensRef.current.has(attemptGen)) {
          return
        }
        if (!reloj || typeof reloj.ancoraMs !== 'number' || !Number.isFinite(reloj.ancoraMs)) {
          throw new Error('Reloj autoritativo incompleto o inválido.')
        }

        const validEngine = parseEngineVersion(engineVersion)
        if (!validEngine) {
          setClockSyncStatus('error')
          setClockSyncError('No se pudo validar la versión de esta partida. Actualiza el juego e inténtalo nuevamente.')
          return
        }

        startedGensRef.current.add(attemptGen)
        setClockSyncStatus('synced')
        startGame(seed, true, reloj.ancoraMs, undefined, soyP1, mazosDeLaSala, isAsyncMatch, undefined, validEngine, treeBonusHpRef.current)
      })
      .catch((err: any) => {
        if (matchClockGenRef.current !== attemptGen) {
          return
        }
        setClockSyncStatus('error')
        setClockSyncError(err?.message || 'No se pudo sincronizar la partida con el servidor.')
      })
  }, [seed, soyP1, mazosDeLaSala, isAsyncMatch, engineVersion, startGame])

  const [colosseumResult, setColosseumResult] = useState<{
    payoutGems: number
    newStreak: number
    newMaxStreak: number
    isNewRecord: boolean
  } | null>(null)

  const [tournamentResult, setTournamentResult] = useState<ActiveTournamentSession | null>(null)

  /**
   * Segundos que faltan para el tic 1.
   *
   * El desfase es negativo mientras la partida no ha empezado: el reloj común
   * apunta a un instante futuro y los dos clientes lo esperan. Es la cuenta atrás
   * que sustituye al «uno entra dos segundos antes que el otro».
   */
  const segundosParaEmpezar =
    desfaseDeTics !== null && desfaseDeTics < 0
      ? Math.ceil((-desfaseDeTics * TICK_MS) / 1000)
      : 0

  const activeArena = useMemo(() => getArenaForElo(userElo), [userElo])
  const activeBgImage = customBgImage || activeArena.bgImage

  const allCatalogCards = useMemo(() => Object.keys(PLANT_CONFIGS) as PlantId[], [])
  const effectiveDeck = useMemo(() => {
    if (matchMode === 'tournament' && tournamentDeck && tournamentDeck.length > 0) {
      return tournamentDeck
    }
    if (activeDeck && activeDeck.length > 0) {
      return activeDeck
    }
    return allCatalogCards.slice(0, 6)
  }, [matchMode, tournamentDeck, activeDeck, allCatalogCards])

  // ── EL REGISTRO DE ACCIONES ────────────────────────────────────────────────
  //
  // Con sala, cada plantación se manda al servidor con el TIC futuro en que debe
  // ocurrir, y se escuchan las del rival para aplicarlas en ese mismo tic. Es lo
  // que hace que las dos partidas sean la misma en lugar de dos partidas
  // paralelas contra la máquina.

  /** Número de orden de mis acciones en esta partida. Empieza en 1. */
  const ordenRef = useRef<number>(0)
  /** El id de la última acción vista, para no volver a aplicarla. */
  const ultimaAccionRef = useRef<number>(0)
  const ultimaSeqAsyncRef = useRef<number>(0)
  const aplicadasRef = useRef<Set<number>>(new Set())

  const MAX_IN_FLIGHT_ACTIONS = 3
  const inFlightCountRef = useRef(0)
  const [, setInFlightCount] = useState(0)
  const redBloqueadaRef = useRef(false)
  const [redBloqueada, setRedBloqueada] = useState(false)
  const collectingSunIdsRef = useRef<Set<string>>(new Set())
  const [collectingSunIds, setCollectingSunIds] = useState<Set<string>>(new Set())
  const outboxAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    outboxAbortRef.current = controller
    return () => {
      controller.abort()
      outboxAbortRef.current = null
    }
  }, [roomId])

  /** Helper único para TODAS las acciones PvP con outbox e idempotencia. */
  const enviarAccionAutoritativa = async (
    action: MatchActionIntent,
    callbacks: {
      onAck?: () => void
      onRejected?: (error: string) => void
    } = {}
  ) => {
    if (!roomId) return
    if (isAsyncMatch && (rankedAsyncInconsistency || reconciliationState === 'reconciling_pending')) {
      // Partida en estado inconsistente o esperando resolución: no seguir enviando acciones
      return
    }

    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId

    // Control de capacidad concurrente sin congelar la interacción del usuario:
    // Permite que el jugador siga interactuando y colocando cartas/soles fluidamente
    // hasta un máximo razonable de acciones simultáneas en vuelo (3).
    const bloqueaRed = action.kind === 'plant' || action.kind === 'dig'
    if (bloqueaRed) {
      inFlightCountRef.current += 1
      setInFlightCount(inFlightCountRef.current)
      const saturado = inFlightCountRef.current >= MAX_IN_FLIGHT_ACTIONS
      redBloqueadaRef.current = saturado
      setRedBloqueada(saturado)
    }

    const result = await MatchActionOutbox.deliver(
      roomId,
      action,
      outboxAbortRef.current?.signal
    )

    if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) {
      return
    }

    if (result.status === 'ack') {
      callbacks.onAck?.()
    } else if (result.status === 'rejected') {
      callbacks.onRejected?.(result.error)
    }

    // cancelled ocurre al desmontar; no hay que tocar un motor que ya no existe.
    if (result.status !== 'cancelled' && bloqueaRed) {
      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1)
      setInFlightCount(inFlightCountRef.current)
      const saturado = inFlightCountRef.current >= MAX_IN_FLIGHT_ACTIONS
      redBloqueadaRef.current = saturado
      setRedBloqueada(saturado)
    }
  }

  /**
   * DIAGNÓSTICO DEL PVP
   */
  const [diag, setDiag] = useState<{
    enviadas: number
    recibidas: number
    ultimoEnvio: string
    canal: string
    enSala: number
    misEnSala: number
    huellas: number
  }>({ enviadas: 0, recibidas: 0, ultimoEnvio: '—', canal: 'conectando…', enSala: 0, misEnSala: 0, huellas: 0 })

  const registrarPlantacion = (
    carta: PlantId,
    lane: number,
    col: number,
    enTic: number,
    slot: number,
    seq?: number
  ) => {
    if (!roomId) return
    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId
    const seqAccion = typeof seq === 'number' && Number.isFinite(seq) ? seq : ++ordenRef.current
    void enviarAccionAutoritativa(
      {
        seq: seqAccion,
        tick: enTic,
        issuedTick: enTic - MARGEN_DE_RED_TICS,
        kind: 'plant',
        plantId: carta,
        lane,
        col,
        slot,
      },
      {
        onRejected: (error) => {
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          descartarAccionPropia(enTic, lane, col, seqAccion, capturedGeneration)
          setDiag((d) => ({
            ...d,
            ultimoEnvio: `✗ ${error}`,
          }))
        },
        onAck: () => {
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          confirmarAccionP1(seqAccion, capturedGeneration)
          setDiag((d) => ({
            ...d,
            enviadas: d.enviadas + 1,
            ultimoEnvio: `✓ ${carta} [slot ${slot}] @tic ${enTic}`,
          }))
        },
      }
    )
  }

  const registrarExcavacion = (lane: number, col: number, enTic: number, seq?: number) => {
    if (!roomId) return
    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId
    const seqAccion = typeof seq === 'number' && Number.isFinite(seq) ? seq : ++ordenRef.current
    void enviarAccionAutoritativa(
      {
        seq: seqAccion,
        tick: enTic,
        issuedTick: enTic - MARGEN_DE_RED_TICS,
        kind: 'dig',
        lane,
        col,
      },
      {
        onRejected: (error) => {
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          descartarAccionPropia(enTic, lane, col, seqAccion, capturedGeneration)
          setDiag((d) => ({
            ...d,
            ultimoEnvio: `✗ ${error}`,
          }))
        },
        onAck: () => {
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          confirmarAccionP1(seqAccion, capturedGeneration)
          setDiag((d) => ({
            ...d,
            enviadas: d.enviadas + 1,
            ultimoEnvio: `✓ pico @tic ${enTic}`,
          }))
        },
      }
    )
  }

  const recogerSolAutorizado = (sunId: string) => {
    // PvE/práctica: no hay árbitro remoto.
    if (!roomId) {
      collectSun(sunId)
      return
    }

    if (isAsyncMatch && rankedAsyncInconsistency) return

    // Si ya estamos recolectando este sol, ignorar clics repetidos sobre el mismo
    if (collectingSunIdsRef.current.has(sunId)) return

    // Sólo observa el tic y confirma que el sol existe. NO suma economía todavía.
    const issuedTick = prepararRecogidaSol(sunId)
    if (issuedTick === null) return

    // Feedback visual y auditivo inmediato (0ms de latencia)
    collectingSunIdsRef.current.add(sunId)
    setCollectingSunIds(new Set(collectingSunIdsRef.current))
    soundManager.playSound('points', 0.6)

    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId
    const seqAccion = ++ordenRef.current

    void enviarAccionAutoritativa(
      {
        seq: seqAccion,
        tick: issuedTick,
        issuedTick,
        kind: 'collect',
        targetId: sunId,
        lane: null,
        col: null,
        slot: null,
      },
      {
        onAck: () => {
          collectingSunIdsRef.current.delete(sunId)
          setCollectingSunIds(new Set(collectingSunIdsRef.current))
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          // Registra la acción autoritativa con el seq inmutable capturado al enviarla (silent: true para no duplicar sonido)
          confirmarRecogidaSol(sunId, issuedTick, seqAccion, capturedGeneration, true)
          setDiag((d) => ({
            ...d,
            enviadas: d.enviadas + 1,
            ultimoEnvio: `✓ sol @tic ${issuedTick}`,
          }))
        },
        onRejected: (error) => {
          collectingSunIdsRef.current.delete(sunId)
          setCollectingSunIds(new Set(collectingSunIdsRef.current))
          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
          // No hay rollback: todavía NO habíamos sumado este sol.
          setDiag((d) => ({
            ...d,
            ultimoEnvio: `✗ sol: ${error}`,
          }))
        },
      }
    )
  }

  useEffect(() => {
    if (!roomId || !currentUserId || isAsyncMatch) return

    /** Aplica una acción del rival; las propias ya están plantadas en local. */
    const aplicar = (a: {
      id: number
      user_id: string
      seq?: number
      tick: number
      issued_tick?: number | null
      kind: string
      plant_id: string | null
      lane: number | null
      col: number | null
      slot?: number | null
      target_id?: string | null
    }) => {
      if (a.user_id === currentUserId) return
      // Realtime puede entregar el mismo mensaje dos veces, y la recuperación por
      // match_actions_since puede solaparse con él. Sin esto, la planta del rival
      // aparecería duplicada.
      if (aplicadasRef.current.has(a.id)) return
      aplicadasRef.current.add(a.id)
      if (a.id > ultimaAccionRef.current) ultimaAccionRef.current = a.id

      // Los soles son economía local del rival; se guardan para el árbitro, pero no
      // modifican nuestra simulación remota.
      if (a.kind === 'collect') return

      // El pico del rival. Antes se descartaba aquí —sólo se miraba 'plant'— así
      // que su planta excavada seguía en pie en tu pantalla: dos partidas
      // distintas desde ese momento.
      if (a.kind === 'dig') {
        setDiag((d) => ({ ...d, recibidas: d.recibidas + 1 }))
        encolarAccionDelRival({
          // El identificador del servidor viaja al registro de jugadas: es lo que
          // ordena igual en las dos pantallas dos jugadas del mismo tic.
          id: a.id,
          tick: a.tick,
          kind: 'dig',
          lane: a.lane ?? 0,
          col: a.col ?? 0,
        })
        return
      }

      if (a.kind !== 'plant' || !a.plant_id || a.lane === null) return
      setDiag((d) => ({ ...d, recibidas: d.recibidas + 1 }))
      encolarAccionDelRival({
        id: a.id,
        tick: a.tick,
        kind: 'plant',
        plantId: a.plant_id as PlantId,
        lane: a.lane,
        col: a.col ?? undefined,
        slot: a.slot,
      })
    }

    const dejarDeEscuchar = battleService.subscribeToMatchActions(roomId, aplicar, (estado) => {
      setDiag((d) => ({ ...d, canal: estado }))
    })

    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId

    // Red de seguridad: al entrar se recoge lo que ya hubiera, y periódicamente se
    // comprueba si se perdió algún mensaje. Sin esto, una sola acción perdida
    // dejaría las dos partidas divergentes hasta el final.
    let recuperando = false
    let timerRecuperar: ReturnType<typeof setTimeout> | null = null

    const programarRecuperar = () => {
      if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
      timerRecuperar = setTimeout(async () => {
        if (!recuperando) {
          recuperando = true
          try {
            await recuperar()
          } finally {
            recuperando = false
            programarRecuperar()
          }
        }
      }, 3000)
    }

    const recuperar = async () => {
      if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
      // Consulta incremental eficiente: solicita únicamente acciones posteriores a la última conocida
      const desdeId = ultimaAccionRef.current
      const nuevas = await battleService.matchActionsSince(capturedRoomId, desdeId)
      if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
      if (nuevas.length > 0) {
        setDiag((d) => ({
          ...d,
          enSala: d.enSala + nuevas.length,
          misEnSala: d.misEnSala + nuevas.filter((a) => a.userId === currentUserId).length,
        }))
        const pendientes = nuevas.filter((a) => a.id > ultimaAccionRef.current)
        for (const a of pendientes) {
          aplicar({
            id: a.id,
            user_id: a.userId,
            seq: a.seq,
            tick: a.tick,
            issued_tick: a.issuedTick,
            kind: a.kind,
            plant_id: a.plantId,
            lane: a.lane,
            col: a.col,
            slot: a.slot,
            target_id: a.targetId,
          })
        }
      }
    }
    void recuperar()
    programarRecuperar()

    return () => {
      dejarDeEscuchar()
      if (timerRecuperar) clearTimeout(timerRecuperar)
    }
  }, [roomId, currentUserId, encolarAccionDelRival, isAsyncMatch, sessionGeneration])

  // ── FEED DE INTENCIONES ASÍNCRONAS (RIVAL SEMILLA RANKED) ──────────────────
  // En lugar de saturar PostgreSQL con peticiones en paralelo sobrecargadas,
  // se utiliza un ciclo adaptativo con protección in-flight que evita apilamiento.
  useEffect(() => {
    if (!roomId || !isAsyncMatch) return
    ultimaSeqAsyncRef.current = 0
    let cancelado = false
    let enVuelo = false
    let timerId: ReturnType<typeof setTimeout> | null = null
    const capturedRoomId = roomId

    const programarSiguiente = (delayMs: number) => {
      if (cancelado) return
      timerId = setTimeout(() => {
        void refrescarIntencionesAsync()
      }, delayMs)
    }

    const refrescarIntencionesAsync = async () => {
      if (cancelado || enVuelo || capturedRoomId !== roomIdRef.current) return
      const requestGeneration = sessionGenerationRef.current
      enVuelo = true
      let nextDelayMs = 450

      try {
        const res = await battleService.pollRankedAsyncIntents(
          capturedRoomId,
          ultimaSeqAsyncRef.current
        )
        if (
          cancelado ||
          requestGeneration !== sessionGenerationRef.current ||
          capturedRoomId !== roomIdRef.current
        ) return

        // A) Error de red / transporte / res inexistente / res.ok === false -> Reintentar en el siguiente ciclo sin marcar corrupción
        if (res && res.ok !== false) {
          // B) res.ok === true pero res.intents no es array o intenciones malformadas -> PROTOCOL_INCONSISTENCY / INVALID_ASYNC_PLAN
          const resultado = incorporarIntencionesAsync(res.intents, requestGeneration)
          if (resultado.ok && typeof resultado.maxAcceptedSeq === 'number') {
            ultimaSeqAsyncRef.current = Math.max(
              ultimaSeqAsyncRef.current,
              resultado.maxAcceptedSeq
            )
          }

          // Adaptación dinámica de sondeo según la holgura autorizada por el servidor
          if (typeof res.maxRevealedTick === 'number' && typeof res.serverTick === 'number') {
            const holgura = res.maxRevealedTick - res.serverTick
            if (holgura > 30) {
              nextDelayMs = 800
            } else if (holgura > 18) {
              nextDelayMs = 500
            }
          }
        } else {
          nextDelayMs = 600
        }
      } catch {
        nextDelayMs = 600
      } finally {
        enVuelo = false
        if (!cancelado) {
          programarSiguiente(nextDelayMs)
        }
      }
    }

    void refrescarIntencionesAsync()

    return () => {
      cancelado = true
      if (timerId) clearTimeout(timerId)
    }
  }, [roomId, isAsyncMatch, sessionGeneration, incorporarIntencionesAsync])

  // ── EL FINAL LLEGA A LOS DOS LADOS ─────────────────────────────────────────
  //
  // Si el rival se rinde o pierde, el servidor liquida la sala. Sin esto tú te
  // quedabas jugando contra un campo vacío sin saber que ya habías ganado: el
  // resultado existía en la base y en su pantalla, pero no en la tuya.
  useEffect(() => {
    if (!roomId || !currentUserId || isAsyncMatch) return
    let cerrado = false
    let comprobando = false
    let timerComprobar: ReturnType<typeof setTimeout> | null = null
    const capturedGeneration = sessionGenerationRef.current
    const capturedRoomId = roomId

    const programarComprobar = () => {
      if (cerrado) return
      timerComprobar = setTimeout(async () => {
        if (!comprobando && !cerrado) {
          comprobando = true
          try {
            await comprobar()
          } finally {
            comprobando = false
            programarComprobar()
          }
        }
      }, 4000)
    }

    const comprobar = async () => {
      if (cerrado || capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) return
      const r = await battleService.roomResult(capturedRoomId)
      if (cerrado || capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current || !r || !r.ended) return
      cerrado = true

      setResultadoServidor({
        success: true,
        status: r.noWinner ? 'empate_verificado' : 'liquidada',
        payout: 0,
      })
      // Sin ganador (empate o abandono sin reportes) se muestra como derrota
      // pero sin premio: el aviso de arriba explica que no se repartió nada.
      terminarPorOrdenDelServidor(r.iWon ? 'victory' : 'defeat')
    }

    const dejarDeEscuchar = battleService.subscribeToRoomEnd(capturedRoomId, () => { void comprobar() })
    programarComprobar()

    return () => {
      cerrado = true
      if (timerComprobar) clearTimeout(timerComprobar)
      dejarDeEscuchar()
    }
  }, [roomId, currentUserId, terminarPorOrdenDelServidor, sessionGeneration, isAsyncMatch])

  // ── AVISO AL CERRAR EL NAVEGADOR ───────────────────────────────────────────
  //
  // Cerrar la pestaña a mitad de un duelo real cuenta como abandono: el rival
  // acaba ganando por el barrido del servidor. Conviene avisar antes.
  //
  // El navegador NO deja poner un texto propio (se ignora desde hace años por
  // abuso), así que enseña su mensaje genérico. Lo que importa es que pregunte.
  useEffect(() => {
    if (!roomId) return
    if (gameStatus !== 'playing') return

    const alCerrar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // returnValue sigue haciendo falta para navegadores antiguos.
      e.returnValue = 'Si sales ahora pierdes el duelo.'
      return e.returnValue
    }
    window.addEventListener('beforeunload', alCerrar)
    return () => window.removeEventListener('beforeunload', alCerrar)
  }, [roomId, gameStatus])

  const hasHandledEndRef = useRef<boolean>(false)

  useEffect(() => {
    if (hasHandledEndRef.current) return

    if (gameStatus === 'victory' || gameStatus === 'defeat') {
      hasHandledEndRef.current = true

      // Detener la música de batalla inmediatamente.
      soundManager.stopBgm()

      // ── PARTIDA REAL: LO LIQUIDA EL SERVIDOR ───────────────────────────────
      //
      // Con sala, quien reparte ELO, cofres y gemas es report_match_result, y
      // exige que AMBOS jugadores reporten el mismo ganador. Si no coinciden, no
      // cobra nadie. El cliente no calcula nada: sólo dice lo que vio.
      //
      // Se reporta tanto al ganar como al perder — hace falta el reporte de los
      // dos para que se liquide, así que callarse al perder dejaría al rival sin
      // su premio.
      if (roomId && (opponentId || isAsyncMatch) && currentUserId) {
        const capturedGeneration = sessionGenerationRef.current
        const capturedRoomId = roomId
        const ganadorQueVioMiCliente = gameStatus === 'victory' ? currentUserId : (opponentId ?? '00000000-0000-0000-0000-000000000000')

        setResultadoServidor({ success: true, status: 'verificando' })

        void (async () => {
          let reportRes: { success: boolean; status?: string; payout?: number; error?: string } | undefined
          if (!isAsyncMatch) {
            reportRes = await battleService.reportMatchResult(capturedRoomId, ganadorQueVioMiCliente)
          }

          const verificacion = await battleService.verifyMatch(capturedRoomId)

          if (capturedGeneration !== sessionGenerationRef.current || capturedRoomId !== roomIdRef.current) {
            return
          }

          const liq = resolverLiquidacionPartida({
            isAsyncMatch,
            soyP1,
            currentUserId,
            serverVerification: verificacion,
          })

          const finalPayout =
            typeof liq.payout === 'number' && liq.payout > 0
              ? liq.payout
              : (liq.resultadoFinal === 'victory' && typeof reportRes?.payout === 'number' && reportRes.payout > 0)
                ? reportRes.payout
                : 0

          setResultadoServidor({
            success: liq.statusServidor === 'liquidada' || liq.statusServidor === 'empate_verificado' || liq.statusServidor === 'verificacion_pendiente',
            status: liq.statusServidor,
            eloBefore: liq.eloBefore,
            opponentElo: liq.opponentElo,
            eloDelta: liq.eloDelta,
            eloAfter: liq.eloAfter,
            eloGained: liq.eloGained,
            eloLost: liq.eloLost,
            payout: finalPayout,
            error: liq.error,
          })

          if (liq.statusServidor === 'liquidada' && typeof liq.eloAfter === 'number' && onServerEloUpdated) {
            onServerEloUpdated(liq.eloAfter)
          }

          if (liq.statusServidor === 'liquidada' && liq.resultadoFinal === 'victory' && onBattleComplete) {
            try {
              const res = await onBattleComplete(true)
              if (res?.packResult) {
                setBattleSummaryResult((prev) => ({
                  ...prev,
                  packResult: res.packResult,
                }))
              }
            } catch (e) {
              console.warn('[Battlefield] Error obteniendo pack de victoria:', e)
            }
          }

          if (liq.mostrarResultado && (liq.resultadoFinal === 'victory' || liq.resultadoFinal === 'defeat')) {
            terminarPorOrdenDelServidor(liq.resultadoFinal)
          }
        })()
      }

      // Handle Colosseum match resolution
      if (!roomId && matchMode === 'colosseum' && onColosseumComplete) {
        const coloRes = onColosseumComplete(gameStatus === 'victory')
        setColosseumResult(coloRes)
      }

      // Handle Tournament match resolution
      if (matchMode === 'tournament') {
        const tourneyId = tournamentOpponent?.tournamentId || 'tourney_official_1'
        const oppName = tournamentOpponent?.name || 'Rival de Torneo'
        const isVictory = gameStatus === 'victory'

        void tournamentService.submitMatchResult(tourneyId, isVictory, oppName).then((res) => {
          if (res.success && res.wins !== undefined && res.losses !== undefined) {
            setTournamentResult((prev) => {
              const base = prev || TournamentManager.getSession(tourneyId) || {
                tournamentId: tourneyId,
                tournamentName: 'Torneo',
                registered: true,
                startTimeMs: 0,
                endTimeMs: 0,
                userWins: 0,
                userLosses: 0,
                maxLosses: 3,
                isEliminated: false,
                leaderboard: [],
              }
              return {
                ...base,
                userWins: res.wins ?? base.userWins,
                userLosses: res.losses ?? base.userLosses,
                isEliminated: Boolean(res.is_eliminated),
              }
            })
          }
        })

        const resolved = TournamentManager.resolveMatch(tourneyId, isVictory)
        if (resolved) {
          setTournamentResult(resolved)
        }
      }

      // Ranked sin roomId = entrenamiento/bot (el cliente calcula ELO local).
      // Ranked con roomId = el servidor calcula ELO autoritativo, pero el cofre de victoria se sincroniza inmediatamente.
      // Strategic Test Match está 100% aislado (sin ELO, sin cofres, sin settlement).
      if (gameStatus === 'victory') {
        if (onBattleComplete && matchMode !== 'strategic_test') {
          void (async () => {
            const res = await onBattleComplete(true)
            if (res) {
              setBattleSummaryResult((prev) => ({
                ...prev,
                eloChange: prev?.eloChange ?? res.winElo,
                newElo: prev?.newElo ?? res.newElo,
                packResult: res.packResult,
              }))
            }
          })()
        }
      } else if (gameStatus === 'defeat') {
        if (onBattleComplete && matchMode !== 'strategic_test') {
          void (async () => {
            const res = await onBattleComplete(false)
            if (res) {
              setBattleSummaryResult((prev) => ({
                ...prev,
                eloChange: prev?.eloChange ?? -(res.loseElo || 8),
                newElo: prev?.newElo ?? res.newElo,
              }))
            }
          })()
        }
      }
    }
  }, [gameStatus, onBattleComplete, onServerEloUpdated, matchMode, onColosseumComplete, roomId, opponentId, currentUserId, tournamentOpponent?.tournamentId, terminarPorOrdenDelServidor, isAsyncMatch, soyP1])

  useEffect(() => {
    if (practicePlantId) {
      startPracticeGame(practicePlantId)
      if (practicePlantId in PLANT_CONFIGS) {
        setSelectedCard(practicePlantId as PlantId)
      }
    } else if (matchMode === 'strategic_test' && strategicPlaytestConfig) {
      startStrategicPlaytestGame(strategicPlaytestConfig, activeDeck)
    } else if (gameStatus === 'ready') {
      hasHandledEndRef.current = false

      if (roomId) {
        // Con sala real (Ranked PvP / Rival Semilla), la partida exige reloj autoritativo.
        // Fail-closed: si el reloj falla o no está disponible, no se arranca desalineada.
        syncAndStartMatchClock(roomId)
      } else {
        // Entrenamiento contra el bot local: no hay reloj que alinear
        startGame(seed, false, undefined, userElo, undefined, undefined, undefined, undefined, undefined, treeBonusHpRef.current)
      }
    }
  }, [practicePlantId, seed, roomId, startGame, startPracticeGame, startStrategicPlaytestGame, setSelectedCard, gameStatus, userElo, syncAndStartMatchClock, matchMode, strategicPlaytestConfig, activeDeck])

  /**
   * LA HUELLA DEL TABLERO
   *
   * Cada diez segundos, un resumen de la partida al servidor. El servidor compara
   * las dos huellas del mismo tic; si no coinciden, se sabe EN QUÉ TIC se
   * separaron las dos pantallas.
   *
   * Esto no decide quién gana: es un detector. Antes, cuando las dos pantallas se
   * separaban, lo único que llegaba era el «tu rival dijo otra cosa» al final —
   * cuando ya no se puede averiguar nada. Con esto queda el sitio exacto.
   *
   * Sólo en partidas con sala y PvP humano: contra bot o Rival Semilla no hay nada que comparar.
   */
  useEffect(() => {
    if (!roomId || isAsyncMatch) return
    const pendientes = tomarHuellasPendientes()
    if (pendientes.length === 0) return
    for (const h of pendientes) {
      void battleService.submitMatchCheckpoint(roomId, h.tick, h.huella)
    }
    setDiag((d) => ({ ...d, huellas: d.huellas + pendientes.length }))
  }, [tick, roomId, tomarHuellasPendientes, isAsyncMatch])

  const [showSurrenderModal, setShowSurrenderModal] = useState<boolean>(false)

  const handleSurrenderClick = () => {
    soundManager.playSound('click', 0.5)
    setShowSurrenderModal(true)
  }

  const handleConfirmSurrender = () => {
    soundManager.stopBgm()

    setShowSurrenderModal(false)
    hasHandledEndRef.current = true
    surrenderGame()

    // En una partida real, rendirse lo registra el servidor: declara ganador al
    // rival y aplica el ELO. Antes esto no salía del navegador — el cliente
    // restaba 8 puntos en su propio estado, que no se guarda, así que al recargar
    // volvía el ELO de antes; y el rival se quedaba esperando un reporte que no
    // llegaba nunca.
    if (roomId) {
      void battleService.surrenderMatch(roomId).then((r: any) => {
        setResultadoServidor(r)
        if (r && typeof r.eloAfter === 'number' && onServerEloUpdated) {
          onServerEloUpdated(r.eloAfter)
        }
      })
      return
    }

    // Ranked sin sala es entrenamiento contra bot.
    // Rendirse aquí tampoco debe modificar ELO local.
    if (matchMode === 'ranked') {
      setBattleSummaryResult(null)
      return
    }

    if (onSurrender) {
      const res = onSurrender()
      if (res) {
        setBattleSummaryResult({
          eloChange: -(res.surrenderElo || 8),
          newElo: res.newElo,
          isSurrendered: true,
        })
      }
    }
  }

  const handlePlayAgain = () => {
    soundManager.stopBgm()

    hasHandledEndRef.current = false
    setResultadoServidor(null)
    setBattleSummaryResult(null)
    setColosseumResult(null)
    setTournamentResult(null)

    // ============================================================
    // ONLINE
    //
    // Una game_room terminada JAMÁS puede reutilizarse.
    // Para jugar nuevamente necesitamos matchmaking y roomId NUEVO.
    // ============================================================
    if (roomId) {
      MatchActionOutbox.discardRoom(roomId)

      soundManager.playBgm('menu')

      if (onBackToMenu) {
        onBackToMenu()
      }

      return
    }

    // Sólo entrenamiento/local puede reiniciar en el sitio.
    startGame()
  }

  return (
    <div
      className={`battlefield ${selectedCard === 'shovel' ? 'battlefield--shovel-mode' : ''}`}
      style={{ backgroundImage: `url(${activeBgImage})` }}
      onPointerDown={(e) => {
        if (selectedCard && e.button === 0 && e.target === e.currentTarget) {
          setSelectedCard(null, null)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (selectedCard) {
          setSelectedCard(null, null)
        }
      }}
    >
      {/* Top Controls Bar (Colosseum / Tournament / Friendly Pill) */}
      {(matchMode === 'colosseum' || matchMode === 'tournament' || matchMode === 'friendly') && (
        <div className="battlefield-top-controls">
          {matchMode === 'colosseum' && (
            <div className="battlefield-colosseum-header-pill">
              <span className="battlefield-colosseum-icon">🏛️</span>
              <span>COLISEO</span>
              <span>•</span>
              <span style={{ color: '#38bdf8' }}>Sala: {colosseumConfig?.betGems || 0.5} 💎</span>
              <span>•</span>
              <span style={{ color: '#fbbf24' }}>Pozo: {((colosseumConfig?.betGems || 0.5) * 2).toFixed(1)} 💎</span>
            </div>
          )}
          {matchMode === 'tournament' && (
            <div className="battlefield-colosseum-header-pill" style={{ borderColor: '#a855f7', boxShadow: '0 0 15px rgba(168, 85, 247, 0.4)' }}>
              <span className="battlefield-colosseum-icon">🎪</span>
              <span>TORNEO EN VIVO</span>
              <span>•</span>
              <span style={{ color: '#d8b4fe' }}>vs {tournamentOpponent?.name || 'Rival'}</span>
            </div>
          )}
          {matchMode === 'friendly' && (
            <div className="battlefield-colosseum-header-pill" style={{ borderColor: '#34d399', boxShadow: '0 0 15px rgba(52, 211, 153, 0.4)' }}>
              <span className="battlefield-colosseum-icon">🤝</span>
              <span>DUELO AMISTOSO</span>
              {friendlyBetGems !== undefined && friendlyBetGems > 0 ? (
                <>
                  <span>•</span>
                  <span style={{ color: '#38bdf8' }}>Apuesta: {friendlyBetGems} 💎</span>
                  <span>•</span>
                  <span style={{ color: '#fbbf24' }}>Pozo: {friendlyBetGems * 2} 💎</span>
                </>
              ) : (
                <>
                  <span>•</span>
                  <span style={{ color: '#a7f3d0' }}>Partida Gratuita</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Practice / Sandbox Mode Bar */}
      {isPracticeMode && (
        <div className="practice-bar">
          <span className="practice-bar__title">🎯 ENTRENAMIENTO</span>
          <button
            type="button"
            className="practice-bar__btn"
            onClick={() => startPracticeGame(practicePlantId || undefined)}
          >
            🔄 REINICIAR BLANCOS (3 CARRILES)
          </button>
          <button
            type="button"
            className="practice-bar__btn"
            onClick={() => {
              soundManager.playBgm('menu')
              if (onBackToCollection) onBackToCollection()
              else if (onBackToMenu) onBackToMenu()
            }}
          >
            ⬅️ ALMANAQUE
          </button>
        </div>
      )}

      {/* Base Towers */}
      <BaseTower team="p1" hp={p1BaseHp} maxHp={INITIAL_BASE_HP + treeBonusHp} nombre={nombres?.mio} level={treeLevel} />
      {/* Los soles del rival sólo se enseñan contra el bot, que es cuando el
          número es de verdad: lo lleva esta misma simulación. En PvP los soles del
          otro son cosa de SU navegador y aquí no se conocen, así que el contador
          se quedaría clavado en 150 — un número inventado en pantalla. Mejor no
          mostrarlo que mostrar uno falso. */}
      <BaseTower
        team="p2"
        hp={p2BaseHp}
        maxHp={INITIAL_BASE_HP}
        sunBank={roomId ? undefined : p2SunBank}
        nombre={nombres?.rival}
      />

      {/* DIAGNÓSTICO DEL PVP
          Sólo en partidas con sala. Está en pantalla y no en la consola a
          propósito: con una captura de las dos ventanas se ve qué pasa, sin tener
          que buscar en la consola ni ejecutar consultas después de cada prueba.

          Qué mirar:
            · el TIC de los dos debe ir casi igual (±10). Si uno va muy por
              delante, el reloj común no se aplicó.
            · SALA debe ser LA MISMA en las dos ventanas. Si son distintas, no
              estáis en la misma partida.
            · «último envío» dice si el servidor aceptó la plantación, y si no,
              por qué exactamente. */}
      {/* Contra la máquina se dice: así nadie juega media hora creyendo que
          está subiendo de rango. En PvP no hace falta, ahí está el nick del rival. */}
      {!roomId && !isPracticeMode && (
        <div className="entrenamiento-aviso">🤖 Entrenamiento · sin puntos ni cofre</div>
      )}

      {roomId && (
        <button
          type="button"
          className="pvp-diag-toggle-btn"
          onClick={() => setShowPvpDiag((prev) => !prev)}
          title="Ver / Ocultar diagnóstico técnico"
        >
          {showPvpDiag ? '✕ Diag' : '📊'}
        </button>
      )}

      {roomId && showPvpDiag && (
        <div className="pvp-diag">
          <div className="pvp-diag__linea">
            <b>SALA</b> {roomId.slice(0, 8)} · <b>TIC</b> {tick}
            {desfaseDeTics !== null && <> · <b>desfase</b> {desfaseDeTics}</>}
          </div>
          <div className="pvp-diag__linea">
            <b>enviadas</b> {diag.enviadas} · <b>recibidas</b> {diag.recibidas}
          </div>
          {/* EL DATO DECISIVO: cuántas acciones dice el SERVIDOR que hay en esta
              sala, y cuántas son mías.
                · misEnSala 0     → no se está enviando nada
                · enSala = mías   → estáis en salas distintas
                · enSala > mías   → estáis juntos: el problema es la entrega */}
          <div className="pvp-diag__linea">
            <b>en la sala</b> {diag.enSala} ({diag.misEnSala} mías) · {diag.canal}
          </div>
          {/* «rehechas» son las veces que una jugada llegó tarde y hubo que
              volver a montar la partida con ella en su tic. No es un fallo: es el
              arreglo funcionando. Lo que dice es cuánto retraso está habiendo de
              verdad — si sube mucho, el margen de red se queda corto. */}
          <div className="pvp-diag__linea">
            <b>huellas</b> {diag.huellas} · <b>rehechas</b> {reconstrucciones}
          </div>
          <div className="pvp-diag__linea pvp-diag__linea--envio">{diag.ultimoEnvio}</div>
          {redBloqueada && (
            <div className="pvp-diag__linea">
              ⏳ Sincronizando acción con el servidor…
            </div>
          )}
        </div>
      )}

      {/* Start Overlay (Sólo PvE local / sin sala remota) */}
      {gameStatus === 'ready' && !practicePlantId && !roomId && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="game-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="game-card__title">¡BATALLA PVE DE PLANTAS!</h2>
            <p className="game-card__text">
              Defiende tu base (P1) de las hordas de <strong>Plantas Enemigas</strong> de la PC (P2).
              <br />
              Recolecta soles haciendo click en ellos y despliega tu ejército de plantas.
            </p>
            <button className="game-button" type="button" onClick={() => startGame()}>
              ¡EMPEZAR COMBATE!
            </button>
          </div>
        </div>
      )}

      {/* Espera de inicio de sala remota (Ranked / PvP / Rival Semilla) */}
      {gameStatus === 'ready' && !practicePlantId && Boolean(roomId) && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="game-card" onClick={(e) => e.stopPropagation()}>
            {clockSyncStatus === 'error' ? (
              <>
                <h2 className="game-card__title">Error de Sincronización</h2>
                <p className="game-card__text" style={{ color: '#ff6b6b' }}>
                  {clockSyncError || 'No se pudo sincronizar la partida con el servidor.'}
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
                  <button
                    className="game-button"
                    type="button"
                    onClick={() => {
                      if (roomId) syncAndStartMatchClock(roomId)
                    }}
                  >
                    🔄 Reintentar
                  </button>
                  <button
                    className="game-button game-button--secondary"
                    type="button"
                    onClick={() => {
                      if (onBackToMenu) onBackToMenu()
                      else if (onBackToCollection) onBackToCollection()
                    }}
                  >
                    ⬅️ Salir
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="game-card__title">Preparando partida…</h2>
                <p className="game-card__text">
                  Sincronizando partida con el servidor autoritativo. La batalla comenzará en breve.
                </p>
                <div className="resultado-servidor__cargando" style={{ marginTop: '12px' }}>
                  <span className="resultado-servidor__spinner" aria-hidden="true" />
                  <span>Sincronizando…</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Grid Lanes */}
      <div className="lanes">
        {LANES_CONFIG.map((lane) => (
          <div
            key={lane.id}
            className="lane"
            style={{
              top: `${lane.topPct}%`,
              height: `${lane.heightPct}%`,
              left: `${BASE_LEFT_END_X}%`,
              width: `${FIELD_WIDTH_PCT}%`,
            }}
          >
            {Array.from({ length: TOTAL_COLUMNS }).map((_, col) => {
              const isP1Side = col < P1_COLUMNS
              const isCellSelected = Boolean(selectedCard && isP1Side)
              const isPlantCard = selectedCard && selectedCard !== 'shovel'
              const selectedCardConfig = isPlantCard ? PLANT_CONFIGS[selectedCard] : null
              const isWalkingPlantCard = Boolean(
                selectedCardConfig &&
                (selectedCardConfig.category === 'melee' ||
                  Boolean(selectedCardConfig.moveSpeed) ||
                  selectedCard === 'chomper')
              )

              // Detección estricta alineada al motor: sólo plantas estáticas bloquean el terreno
              const isCellOccupiedByPlant = plants.some((p) => p.lane === lane.id && p.col === col && !p.isWalking)
              const isCellPendingSprout = pendingOwnPlants.some((p) => p.lane === lane.id && p.col === col)
              const isCellOccupied = isCellOccupiedByPlant || isCellPendingSprout

              // Para la pala sólo son válidas plantas ya materializadas (no brotes en vuelo)
              // Para plantas caminantes/melee (Bonk Choy, Chomper), se pueden plantar en cualquier columna de nuestro lado
              // Para plantas estáticas (Girasol, Nuez, Lanzaguisantes), la casilla debe estar libre
              const isPlantDestination = isCellSelected && (
                selectedCard === 'shovel'
                  ? isCellOccupiedByPlant
                  : isWalkingPlantCard
                  ? true
                  : !isCellOccupied
              )
              const previewPlantConfig = isPlantCard && isPlantDestination ? selectedCardConfig : null

              const handleCellAction = () => {
                if (!isPlantDestination) return
                if (roomId && inFlightCountRef.current >= MAX_IN_FLIGHT_ACTIONS) {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate([20, 30]) } catch {}
                  }
                  return
                }
                if (isAsyncMatch && (rankedAsyncInconsistency || reconciliationState === 'reconciling_pending')) return
                if (selectedCard && isP1Side) {
                  if (selectedCard === 'shovel') {
                    // Igual que al plantar: sólo se registra si aquí de verdad
                    // se excavó algo. Registrar un pico que no quitó nada haría
                    // que el rival borrara una planta que en tu pantalla sigue.
                    const seq = roomId ? ++ordenRef.current : undefined
                    const casilla = digPlant({ lane: lane.id, col }, seq)
                    if (casilla) {
                      if (typeof navigator !== 'undefined' && navigator.vibrate) {
                        try { navigator.vibrate(15) } catch {}
                      }
                      registrarExcavacion(casilla.lane, casilla.col, casilla.tick, seq)
                    }
                  } else {
                    const carta = selectedCard
                    const slot = selectedSlotIndex
                    const seq = roomId ? ++ordenRef.current : undefined
                    const enTic = placePlant(lane.id, col, undefined, undefined, seq)
                    if (enTic !== null) {
                      recordPlantPlacement(carta)
                      if (slot !== null) {
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                          try { navigator.vibrate(15) } catch {}
                        }
                        registrarPlantacion(carta, lane.id, col, enTic, slot, seq)
                      }
                    }
                  }
                }
              }

              return (
                <div
                  key={col}
                  className={`lane__cell ${
                    isP1Side ? 'lane__cell--p1' : 'lane__cell--p2'
                  } ${isPlantDestination ? 'lane__cell--selectable' : ''}`}
                  style={{
                    width: `${100 / TOTAL_COLUMNS}%`,
                    zIndex: isPlantDestination ? (selectedCard === 'shovel' ? 10 : 70) : (selectedCard ? 5 : 1),
                    pointerEvents: selectedCard || isP1Side ? 'auto' : 'none',
                  }}
                  onClick={() => {
                    if (isPlantDestination) {
                      handleCellAction()
                    } else if (selectedCard) {
                      if (!isP1Side) {
                        // Tocar el lado rival cancela la selección de forma natural
                        setSelectedCard(null, null)
                      } else if (isCellOccupied) {
                        // Feedback háptico ligero de rechazo en casilla ocupada para plantas estáticas
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                          try { navigator.vibrate([15, 20]) } catch {}
                        }
                      }
                    }
                  }}
                >
                  {previewPlantConfig && (
                    <img
                      className="lane__cell-ghost-preview"
                      src={previewPlantConfig.sprite || previewPlantConfig.icon}
                      alt=""
                      aria-hidden="true"
                    />
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Center Dividing Line */}
      <div className="front-line" />

      {/* Player 1 Plants */}
      {plants.map((plant) => {
        const config = PLANT_CONFIGS[plant.plantId]
        const laneConfig = LANES_CONFIG[plant.lane]
        const hpPct = (plant.hp / plant.maxHp) * 100
        const isShovelTarget = selectedCard === 'shovel' && !plant.isWalking

        return (
          <div
            key={plant.id}
            className={`entity plant-unit ${
              isShovelTarget ? 'plant-unit--shovel-target' : ''
            } ${
              plant.isWalking ? 'plant-unit--walking' : ''
            } ${
              plant.plantId === 'garlic'
                ? plant.isSmashing
                  ? 'plant-unit--squash-smashing'
                  : 'plant-unit--squash-hopping'
                : ''
            } ${
              plant.plantId === 'squash'
                ? plant.isArmed
                  ? 'plant-unit--potato-armed'
                  : 'plant-unit--potato-unarmed'
                : ''
            } ${
              plant.plantId === 'bonkchoy' ? 'plant-unit--bonkchoy' : ''
            } ${plant.state === 'attacking' ? 'plant-unit--attacking' : ''}`}
            style={{
              left: `${plant.x}%`,
              top: `${laneConfig.topPct + laneConfig.heightPct / 2}%`,
              pointerEvents: isShovelTarget ? 'auto' : 'none',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (isShovelTarget) {
                if (roomId && inFlightCountRef.current >= MAX_IN_FLIGHT_ACTIONS) {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate([20, 30]) } catch {}
                  }
                  return
                }
                if (isAsyncMatch && (rankedAsyncInconsistency || reconciliationState === 'reconciling_pending')) return
                const seq = roomId ? ++ordenRef.current : undefined
                const casilla = digPlant(plant.id, seq)
                if (casilla) {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate(15) } catch {}
                  }
                  registrarExcavacion(casilla.lane, casilla.col, casilla.tick, seq)
                }
              }
            }}
          >
            {hpPct < 100 && (
              <div className="entity__hp">
                <div
                  className="entity__hp-fill"
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            )}
            {plant.spriteOverride?.includes('jalapeno_flame_fx') ? (
              <div className="jalapeno-lane-flame">
                <img src="/game-assets/plants/jalapeno_flame_fx.webp" alt="Fuego" />
              </div>
            ) : (
              <>
                {(() => {
                  const plantLevel = plant.level ?? getBattlefieldPlantLevel(plant.plantId)
                  return (
                    <>
                      {/* Subtle Base Ground Aura for Leveled Plants */}
                      {plantLevel > 0 && (
                        <div
                          className={`plant-base-halo ${
                            plantLevel >= 3
                              ? 'plant-base-halo--gold'
                              : 'plant-base-halo--emerald'
                          }`}
                        />
                      )}
                      {/* Field Plant Level Badge */}
                      {plantLevel > 0 && (
                        <div
                          className={`plant-unit__level-badge ${
                            plantLevel >= 3 ? 'plant-unit__level-badge--gold' : ''
                          }`}
                          title={`Nivel ${plantLevel}`}
                        >
                          ⭐{plantLevel}
                        </div>
                      )}
                    </>
                  )
                })()}
                <img
                  className={`plant-unit__sprite ${
                    plant.plantId === 'melonpult' ? 'plant-unit__sprite--melon' : ''
                  } ${plant.spriteOverride?.includes('burst') ? 'plant-unit__sprite--burst' : ''}`}
                  src={plant.spriteOverride || config.sprite}
                  alt={config.name}
                />
              </>
            )}
            {plant.isHealingFx && (
              <div className="aloe-heal-cloud">
                <img src="/game-assets/plants/aloe_heal_fx.gif" alt="Cura" />
                <span className="heal-text">+60 HP</span>
              </div>
            )}
            {plant.plantId === 'garlic' && plant.isSmashing && (
              <div className="squash-smash-fx">💥 BAM!</div>
            )}
            {plant.plantId === 'squash' && !plant.isArmed && (
              <div className="potato-arming-badge">🌱 ARMÁNDOSE</div>
            )}
            {plant.plantId === 'squash' && plant.isArmed && (
              <div className="potato-armed-badge">🚨 ¡ARMADA!</div>
            )}
            {plant.plantId === 'iceberglettuce' && plant.spriteOverride?.includes('burst') && (
              <div className="iceberg-burst-fx">⚡ ❄️ ¡RÁFAGA HELADA!</div>
            )}
          </div>
        )
      })}

      {/* Plantas Propias en fase de Brote / Siembra (Feedback visual instantáneo a 0ms) */}
      {pendingOwnPlants.map((pp, idx) => {
        const config = PLANT_CONFIGS[pp.plantId]
        const laneConfig = LANES_CONFIG[pp.lane]
        if (!laneConfig || !config) return null
        const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
        const x = BASE_LEFT_END_X + pp.col * colWidth + colWidth / 2
        const y = laneConfig.topPct + laneConfig.heightPct / 2
        const sproutLevel = pp.level ?? getBattlefieldPlantLevel(pp.plantId)

        return (
          <div
            key={`pending-plant-${pp.lane}-${pp.col}-${idx}`}
            className="entity plant-unit plant-unit--sprouting"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              pointerEvents: 'none',
              zIndex: 65,
            }}
          >
            {sproutLevel > 0 && (
              <div
                className={`plant-unit__level-badge ${
                  sproutLevel >= 3 ? 'plant-unit__level-badge--gold' : ''
                }`}
              >
                ⭐{sproutLevel}
              </div>
            )}
            <img
              className="plant-unit__sprite"
              src={config.sprite || config.icon}
              alt={config.name}
            />
          </div>
        )
      })}

      {/* Player 2 PC Enemy Plants */}
      {enemyPlants.map((enemy) => {
        // Si la planta la puso un RIVAL de verdad, trae su plantId y se pinta con
        // el sprite de esa carta. No hace falta arte nueva: los dos lados ya usan
        // los mismos ficheros (transparentsunflower.png es el girasol de ambos) y
        // el CSS de enemy-unit ya los espeja. Es la misma planta al revés.
        //
        // Ya no hay catálogo enemigo: las plantas de los dos lados son la misma
        // cosa y salen del mismo sitio. El bot también planta cartas de verdad.
        const config = PLANT_CONFIGS[enemy.plantId]
        const laneConfig = LANES_CONFIG[enemy.lane]
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)
        // frozenUntil es un TIC, no un instante de reloj. Comparado con Date.now()
        // esto era siempre falso y la congelación del hielo no se veía nunca.
        const isFrozen = enemy.frozenUntil ? tick < enemy.frozenUntil : false

        return (
          <div
            key={enemy.id}
            className={`entity enemy-unit ${
              enemy.state === 'attacking' ? 'enemy-unit--attacking' : ''
            } ${isFrozen ? 'enemy-unit--frozen' : ''}`}
            style={{
              left: `${enemy.x}%`,
              top: `${laneConfig.topPct + laneConfig.heightPct / 2}%`,
            }}
          >
            {/* Enemy Level Badge */}
            {enemy.level !== undefined && enemy.level > 0 && (
              <div
                className={`plant-unit__level-badge ${
                  enemy.level >= 3 ? 'plant-unit__level-badge--gold' : ''
                }`}
                title={`Nivel ${enemy.level}`}
              >
                ⭐{enemy.level}
              </div>
            )}
            <div className="entity__hp">
              <div
                className="entity__hp-fill entity__hp-fill--enemy"
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <img
              className={`enemy-unit__sprite ${
                enemy.plantId === 'melonpult' ? 'enemy-unit__sprite--melon' : ''
              } ${isFrozen ? 'enemy-unit__sprite--frozen' : ''}`}
              src={config.sprite}
              alt={config.name}
            />
            {isFrozen && <div className="frozen-ice-badge">🧊 CONGELADO</div>}
          </div>
        )
      })}

      {/* Flying Projectiles */}
      {projectiles.map((proj) => (
        <img
          key={proj.id}
          className={`projectile ${
            proj.type === 'melon'
              ? 'projectile--melon'
              : proj.type === 'needle'
              ? 'projectile--needle'
              : 'projectile--pea'
          } ${proj.targetTeam === 'p1' ? 'projectile--left' : ''}`}
          src={proj.type === 'melon' ? melonImg : proj.type === 'needle' ? needleImg : peaImg}
          alt=""
          style={{
            left: `${proj.x}%`,
            top: `${proj.y}%`,
          }}
        />
      ))}

      {/* Collectible Suns (Plant-generated and Sky-fallen across both sides) */}
      {suns.map((sun) => {
        const isCollecting = collectingSunIds.has(sun.id)
        return (
          <button
            key={sun.id}
            type="button"
            // El último segundo antes de recogerse solo se avisa: si el sol
            // desapareciera sin más, parecería que se ha perdido — y lo que pasa es
            // justo lo contrario, que entra igual.
            className={`sun-item ${
              tick - sun.createdAt >= TICS_ANTES_DE_RECOGERSE_SOLO ? 'sun-item--se-va' : ''
            } ${isCollecting ? 'sun-item--collecting' : ''}`}
            style={{
              left: `${sun.x}%`,
              top: `${sun.y}%`,
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              recogerSolAutorizado(sun.id)
            }}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <img src={sunIcon} alt="Sol" className="sun-item__icon" />
          </button>
        )
      })}

      {/* El reloj de la partida y la cuenta atrás hasta la muerte súbita. Sin
          esto el plazo existía pero no se veía, y un plazo que no se ve no se
          puede jugar. */}
      {gameStatus === 'playing' && (
        <RelojDePartida
          tick={tick}
          practica={isPracticeMode}
          arrancaEn={segundosParaEmpezar}
        />
      )}

      {/* Wave Banner */}
      {waveBanner && (
        <div className="wave-banner">
          <span className="wave-banner__text">{waveBanner}</span>
        </div>
      )}

      {/* Victory / Defeat Modal */}
      {matchMode !== 'strategic_test' && (gameStatus === 'victory' || gameStatus === 'defeat') && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={`game-card ${
              esperandoConfirmacionServidor
                ? 'game-card--loading'
                : resultadoEmpatado
                ? 'game-card--draw'
                : resultadoEnRevision
                ? 'game-card--draw'
                : gameStatus === 'victory'
                ? 'game-card--victory'
                : 'game-card--defeat'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="game-card__title">
              {resultadoEnRevision
                ? 'PARTIDA EN REVISIÓN'
                : resultadoEmpatado
                ? '¡EMPATE!'
                : gameStatus === 'victory'
                ? '¡VICTORIA!'
                : battleSummaryResult?.isSurrendered
                ? '🏳️ ¡TE HAS RENDIDO!'
                : '¡DERROTA!'}
            </h2>

            {/* PARTIDA REAL: LO QUE DICE EL SERVIDOR
                Sólo aparece cuando hay sala. Mientras confirma enseña el spinner
                y al responder enseña las copas autoritativas calculadas. */}
            {roomId && (
              <div className="resultado-servidor">
                {esperandoConfirmacionServidor && (
                  <div className="resultado-servidor__cargando">
                    <span
                      className="resultado-servidor__spinner"
                      aria-hidden="true"
                    />
                    <span>Calculando copas con el servidor...</span>
                  </div>
                )}

                {resultadoServidor?.status === 'revision_servidor' && (
                  <p className="resultado-servidor__disputa">
                    ⚠️ Empate Técnico, no se modificó el ELO.
                  </p>
                )}

                {resultadoEmpatado && (
                  <p className="resultado-servidor__esperando">
                    🤝 Partida empatada
                  </p>
                )}

                {!esperandoConfirmacionServidor && resultadoServidor?.status === 'liquidada' && (() => {
                  const fallbackDeltas = getEloDeltasForElo(userElo)
                  const fallbackDelta = gameStatus === 'victory' ? fallbackDeltas.winElo : -fallbackDeltas.loseElo
                  const fallbackTotal = Math.max(
                    getTrophyGateForElo(userElo),
                    userElo + fallbackDelta
                  )

                  const delta =
                    typeof resultadoServidor.eloDelta === 'number'
                      ? resultadoServidor.eloDelta
                      : typeof resultadoServidor.eloGained === 'number'
                      ? resultadoServidor.eloGained
                      : typeof resultadoServidor.eloLost === 'number' && resultadoServidor.eloLost > 0
                      ? -resultadoServidor.eloLost
                      : battleSummaryResult?.eloChange ?? fallbackDelta

                  const total =
                    typeof resultadoServidor.eloAfter === 'number'
                      ? resultadoServidor.eloAfter
                      : battleSummaryResult?.newElo ?? fallbackTotal

                  return (
                    <p className="resultado-servidor__ok">
                      ✅ {delta >= 0 ? `+${delta} 🏆` : `${delta} 🏆`} (Total: {total.toLocaleString('en-US')} 🏆)
                      {typeof resultadoServidor.payout === 'number' &&
                        resultadoServidor.payout > 0 &&
                        ` · +${resultadoServidor.payout} 💎`}
                    </p>
                  )
                })()}

                {!esperandoConfirmacionServidor &&
                  resultadoServidor?.status !== 'revision_servidor' &&
                  resultadoServidor?.error && (
                    <p className="resultado-servidor__disputa">
                      {resultadoServidor.error}
                    </p>
                  )}
              </div>
            )}

            <>
              {/* ELO BADGE (sólo para partidas sin sala / offline) */}
              {!roomId && battleSummaryResult?.eloChange !== undefined && (
                  <div
                    className={`elo-result-badge ${
                      battleSummaryResult.eloChange >= 0
                        ? 'elo-result-badge--win'
                        : 'elo-result-badge--loss'
                    }`}
                  >
                    <span>
                      {battleSummaryResult.eloChange >= 0
                        ? `🏆 +${battleSummaryResult.eloChange} COPAS`
                        : `🏆 ${battleSummaryResult.eloChange} COPAS`}
                    </span>
                    <span className="elo-result-badge__total">
                      (Total: {battleSummaryResult.newElo || userElo} 🏆)
                    </span>
                  </div>
                )}

                <div className="game-card__stats">
                  <p>☀️ Soles Recolectados: {stats.sunsCollected}</p>
                  <p>🌱 Plantas Enemigas Eliminadas: {stats.enemyPlantsDefeated}</p>
                  <p>🌻 Plantas Colocadas: {stats.plantsPlaced}</p>
                </div>

                {/* VICTORY FREE PACK REWARD DISPLAY */}
                {gameStatus === 'victory' && (
                  <div className="victory-pack-reward">
                    {battleSummaryResult?.packResult?.awarded ? (
                      <div className="victory-pack-reward__box">
                        <span className="victory-pack-reward__title">
                          🎁 ¡NUEVO SOBRE DE BATALLA OBTENIDO!
                        </span>
                        <div className="victory-pack-reward__card">
                          <img
                            src="/game-assets/greenfoot/seed_pack_pvp.webp"
                            alt="Sobre de Batalla PvP"
                            className="victory-pack-reward__img"
                          />
                          <div className="victory-pack-reward__info">
                            <span className="victory-pack-reward__name">
                              SOBRE DE BATALLA (1 CARTA)
                            </span>
                            <span className="victory-pack-reward__timer">
                              ⏳ Tiempo de Espera: <strong>{battleSummaryResult.packResult.durationHours} hora(s)</strong>
                            </span>
                            <span className="victory-pack-reward__loc">
                              📍 Guardado en tu Slot de Sobres del Menú
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : battleSummaryResult?.packResult?.isSlotsFull ? (
                      <div className="victory-pack-reward__full">
                        ⚠️ <strong>SLOTS DE SOBRES LLENOS (4/4)</strong>
                        <br />
                        Abre un sobre en el Menú Principal para liberar espacio.
                      </div>
                    ) : null}

                    {/* COLOSSEUM MATCH REWARD CARD */}
                    {matchMode === 'colosseum' && colosseumResult && (
                      <div className="colosseum-battle-payout-box">
                        {gameStatus === 'victory' ? (
                          <>
                            <div className="colosseum-payout-header">
                              <span>🏛️ ¡VICTORIA EN EL COLISEO!</span>
                            </div>
                            <div className="colosseum-payout-gems">
                              + {colosseumResult.payoutGems} GEMAS 💎
                            </div>
                            <div className="colosseum-payout-streak">
                              🔥 Racha Actual: <strong>{colosseumResult.newStreak} victorias seguidas</strong>
                            </div>
                            {colosseumResult.isNewRecord && (
                              <div className="colosseum-payout-record">
                                👑 ¡NUEVO RÉCORD DE TEMPORADA! ({colosseumResult.newMaxStreak} Victorias)
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="colosseum-payout-header colosseum-payout-header--defeat">
                              <span>💀 DERROTA EN EL COLISEO</span>
                            </div>
                            <div className="colosseum-payout-loss">
                              {colosseumConfig?.usedTicket
                                ? '🎟️ 1 Ticket de Coliseo consumido'
                                : `💎 -${colosseumConfig?.betGems || 0.5} Gemas`}
                            </div>
                            <div className="colosseum-payout-streak" style={{ color: '#ef4444' }}>
                              🔥 Racha actual reiniciada a 0 (Récord máximo preservado)
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* TOURNAMENT ROUND REWARD CARD */}
                    {matchMode === 'tournament' && tournamentResult && (
                      <div
                        className="colosseum-battle-payout-box"
                        style={{ borderColor: '#a855f7', boxShadow: '0 0 20px rgba(168, 85, 247, 0.35)' }}
                      >
                        {gameStatus === 'victory' ? (
                          <>
                            <div className="colosseum-payout-header" style={{ color: '#d8b4fe' }}>
                              🏆 ¡VICTORIA EN EL TORNEO!
                            </div>
                            <div className="colosseum-payout-gems" style={{ color: '#4ade80' }}>
                              +1 VICTORIA (Total: 🔥 {tournamentResult.userWins})
                            </div>
                            <div className="colosseum-payout-streak">
                              📊 Posición Actual: <strong>#{TournamentManager.getUserRank(tournamentResult)}</strong> | Vidas: {Array.from({ length: 3 }).map((_, i) => (
                                <span key={i}>{i < 3 - tournamentResult.userLosses ? '❤️' : '💔'}</span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="colosseum-payout-header colosseum-payout-header--defeat">
                              💔 DERROTA EN EL TORNEO
                            </div>
                            <div className="colosseum-payout-loss">
                              Perdiste 1 vida ({Math.max(0, 3 - tournamentResult.userLosses)}/3 restantes)
                            </div>
                            <div className="colosseum-payout-streak" style={{ color: tournamentResult.isEliminated ? '#ef4444' : '#fdba74' }}>
                              {tournamentResult.isEliminated
                                ? '💀 ¡HAS SIDO ELIMINADO DEL TORNEO! (3/3 derrotas)'
                                : `⚠️ Aún tienes ${3 - tournamentResult.userLosses} vida(s) para seguir buscando partidas.`}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="game-card__prompt">
                  ¿Deseas seguir jugando o regresar al menú?
                </div>

                <div className="game-card__actions">
                  <button
                    className="game-button"
                    type="button"
                    onClick={handlePlayAgain}
                  >
                    🎮 SEGUIR JUGANDO
                  </button>
                  {onBackToMenu && (
                    <button
                      className="game-button game-button--secondary"
                      type="button"
                      onClick={() => {
                        soundManager.playBgm('menu')
                        onBackToMenu()
                      }}
                    >
                      🏠 MENÚ PRINCIPAL
                    </button>
                  )}
                </div>
              </>
          </div>
        </div>
      )}

      {/* Strategic Playtest Post-Match Evaluation Modal */}
      {matchMode === 'strategic_test' && currentPlaytestLog && (
        <StrategicPlaytestPostMatch
          log={currentPlaytestLog}
          onPlayAgain={() => {
            if (onPlayAgainPlaytest) onPlayAgainPlaytest()
            else if (onBackToMenu) onBackToMenu()
          }}
          onBackToMenu={() => onBackToMenu && onBackToMenu()}
        />
      )}

      {/* Bottom Right Utility Controls & Surrender */}
      <div className="battlefield-bottom-actions">
        <div className="battlefield-utility-controls">
          <button
            type="button"
            className="fullscreen-toggle-btn"
            onClick={toggleFullscreen}
            title="Pantalla Completa (Ocultar navegador)"
          >
            ⛶
          </button>
          <button
            type="button"
            className="sound-toggle-btn"
            onClick={toggleMute}
            title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>

        {gameStatus === 'playing' && !isPracticeMode && (
          <button
            type="button"
            className="surrender-btn"
            onClick={handleSurrenderClick}
            title="Rendirse y perder ELO"
          >
            🏳️ RENDIRSE
          </button>
        )}
      </div>

      {/* Surrender Confirmation In-Game Modal */}
      {showSurrenderModal && (
        <div className="battle-surrender-modal-overlay">
          <div className="battle-surrender-modal">
            <div className="battle-surrender-modal__icon">🏳️</div>
            <h3 className="battle-surrender-modal__title">¿RENDIRTE DE LA BATALLA?</h3>
            <p className="battle-surrender-modal__desc">
              Si te rindes ahora, se declarará derrota inmediata y perderás copas de ELO en el ranking.
            </p>
            <div className="battle-surrender-modal__actions">
              <button
                type="button"
                className="battle-surrender-modal__btn battle-surrender-modal__btn--cancel"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowSurrenderModal(false)
                }}
              >
                ⚔️ SEGUIR LUCHANDO
              </button>
              <button
                type="button"
                className="battle-surrender-modal__btn battle-surrender-modal__btn--confirm"
                onClick={handleConfirmSurrender}
              >
                🏳️ SÍ, RENDIRME
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plant Hand */}
      <PlantHand
        sunBank={sunBank}
        selectedCard={selectedCard}
        selectedSlotIndex={selectedSlotIndex}
        onSelectCard={setSelectedCard}
        cooldowns={cooldowns}
        currentTick={tick}
        slotCooldowns={slotCooldowns}
        activeDeck={effectiveDeck}
      />
    </div>
  )
}
