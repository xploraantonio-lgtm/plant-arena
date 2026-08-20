import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlantId, ColosseumMatchConfig } from '../../types/game'
import { TournamentManager, type ActiveTournamentSession } from '../../utils/tournamentManager'
import { useGameEngine } from '../../hooks/useGameEngine'
import { useAuth } from '../../hooks/useAuth'
import { SupabaseService } from '../../services/supabaseService'
import {
  PLANT_CONFIGS,
  LANES_CONFIG,
  BASE_LEFT_END_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  P1_COLUMNS,
  INITIAL_BASE_HP,
} from '../../utils/gameConstants'
import { getArenaForElo } from '../../utils/arenaManager'
const sunIcon = '/game-assets/greenfoot/sun1.png'
const peaImg = '/game-assets/images/Plants/PB00.png'
const melonImg = '/game-assets/images/Plants/melon_pult.png'
const needleImg = '/game-assets/greenfoot/needle1.png'
import PlantHand from './PlantHand'
import RelojDePartida from '../RelojDePartida/RelojDePartida'
import { SOL_SE_RECOGE_SOLO_MS } from '../../engine/balance'
import { TICK_MS } from '../../engine/time'
import { soundManager } from '../../utils/audioManager'
import { toggleFullscreen } from '../../utils/fullscreen'
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
}

const motherTreeImg = '/game-assets/greenfoot/mothertree_whitebg.png'

function BaseTower({ team, hp, maxHp, sunBank, nombre }: BaseTowerProps) {
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
            : team === 'p1' ? 'ÁRBOL MADRE (P1)' : 'ÁRBOL MADRE (P2)'}{' '}
          ({Math.round(hp)})
        </span>
        {team === 'p2' && sunBank !== undefined && (
          <div className="base__pc-sun">
            <img src={sunIcon} alt="Sol" className="base__pc-sun-icon" />
            <span>{sunBank}</span>
          </div>
        )}
      </div>
      <div className="base__tree-wrap">
        <img
          src={motherTreeImg}
          alt={team === 'p1' ? 'Árbol Madre P1' : 'Árbol Madre P2'}
          className={`base__mothertree-img ${team === 'p2' ? 'base__mothertree-img--p2' : ''}`}
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
  matchMode?: 'ranked' | 'colosseum' | 'tournament'
  colosseumConfig?: ColosseumMatchConfig | null
  tournamentOpponent?: { name: string; tournamentId: string } | null
  onColosseumComplete?: (won: boolean) => { payoutGems: number; newStreak: number; newMaxStreak: number; isNewRecord: boolean }
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
}

export default function Battlefield({
  onBackToMenu,
  onBackToCollection,
  onBattleComplete,
  onSurrender,
  practicePlantId,
  activeDeck,
  userElo = 1000,
  customBgImage,
  matchMode = 'ranked',
  roomId = null,
  seed,
  opponentId = null,
  nombres = null,
  colosseumConfig,
  tournamentOpponent,
  onColosseumComplete,
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
    surrenderGame,
    collectSun,
    placePlant,
    digPlant,
    encolarAccionDelRival,
    terminarPorOrdenDelServidor,
  } = useGameEngine()

  const { user } = useAuth()
  const currentUserId = user?.id ?? null

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
    eloGained?: number
    eloLost?: number
    payout?: number
    error?: string
  } | null>(null)

  const [battleSummaryResult, setBattleSummaryResult] = useState<{
    eloChange?: number
    newElo?: number
    packResult?: { awarded: boolean; durationHours?: 2 | 4 | 8 | 12; arenaLevel?: number; isSlotsFull?: boolean }
    isSurrendered?: boolean
  } | null>(null)

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
    if (activeDeck && activeDeck.length > 0) {
      return activeDeck
    }
    return allCatalogCards.slice(0, 6)
  }, [activeDeck, allCatalogCards])

  // ── EL REGISTRO DE ACCIONES ────────────────────────────────────────────────
  //
  // Con sala, cada plantación se manda al servidor con el TIC futuro en que debe
  // ocurrir, y se escuchan las del rival para aplicarlas en ese mismo tic. Es lo
  // que hace que las dos partidas sean la misma en lugar de dos partidas
  // paralelas contra la máquina.

  /**
   * Margen de red, en tics.
   *
   * La acción se programa para el tic actual MÁS esto, para que le dé tiempo a
   * llegar al rival antes de que su partida alcance ese tic. Seis tics son unos
   * 200 ms: suficiente para una conexión normal, y poco como retardo entre pulsar
   * y ver la planta del otro.
   *
   * Si aun así llega tarde, encolarAccionDelRival la aplica en el tic siguiente y
   * las dos pantallas se separan un poco. Eso es aceptable: el resultado lo decide
   * el servidor recalculando el registro, no lo que vio un navegador.
   */
  const MARGEN_DE_RED_TICS = 6

  /** Número de orden de mis acciones en esta partida. Empieza en 1. */
  const ordenRef = useRef<number>(0)
  /** El id de la última acción vista, para no volver a aplicarla. */
  const ultimaAccionRef = useRef<number>(0)
  const aplicadasRef = useRef<Set<number>>(new Set())

  /**
   * DIAGNÓSTICO DEL PVP
   *
   * Se enseña en pantalla, y no en la consola, por un motivo práctico: llevamos
   * varias rondas diagnosticando a ciegas y pidiendo consultas SQL después de
   * cada prueba. Con esto, una captura de las dos ventanas dice qué está pasando.
   *
   * Sólo aparece en partidas con sala. Cuando el PvP esté estable se puede quitar
   * o dejar detrás de un interruptor.
   */
  const [diag, setDiag] = useState<{
    enviadas: number
    recibidas: number
    ultimoEnvio: string
    canal: string
    /** Acciones que el SERVIDOR dice que hay en esta sala, y cuántas son mías. */
    enSala: number
    misEnSala: number
  }>({ enviadas: 0, recibidas: 0, ultimoEnvio: '—', canal: 'conectando…', enSala: 0, misEnSala: 0 })

  const registrarPlantacion = (carta: PlantId, lane: number, col: number) => {
    if (!roomId) return
    ordenRef.current += 1
    const enTic = tick + MARGEN_DE_RED_TICS
    void SupabaseService.submitMatchAction(roomId, {
      seq: ordenRef.current,
      tick: enTic,
      kind: 'plant',
      plantId: carta,
      lane,
      col,
    }).then((r) => {
      setDiag((d) => ({
        ...d,
        enviadas: d.enviadas + (r.error ? 0 : 1),
        // El error del servidor tal cual: es lo que dice POR QUÉ se rechazó.
        ultimoEnvio: r.error ? `✗ ${r.error}` : `✓ ${carta} @tic ${enTic}`,
      }))
    })
  }

  useEffect(() => {
    if (!roomId || !currentUserId) return

    /** Aplica una acción del rival; las propias ya están plantadas en local. */
    const aplicar = (a: {
      id: number
      user_id: string
      tick: number
      kind: string
      plant_id: string | null
      lane: number
      col: number | null
    }) => {
      if (a.user_id === currentUserId) return
      // Realtime puede entregar el mismo mensaje dos veces, y la recuperación por
      // match_actions_since puede solaparse con él. Sin esto, la planta del rival
      // aparecería duplicada.
      if (aplicadasRef.current.has(a.id)) return
      aplicadasRef.current.add(a.id)
      if (a.id > ultimaAccionRef.current) ultimaAccionRef.current = a.id

      if (a.kind !== 'plant' || !a.plant_id) return
      setDiag((d) => ({ ...d, recibidas: d.recibidas + 1 }))
      encolarAccionDelRival({
        tick: a.tick,
        plantId: a.plant_id as PlantId,
        lane: a.lane,
        col: a.col ?? undefined,
      })
    }

    const dejarDeEscuchar = SupabaseService.subscribeToMatchActions(roomId, aplicar, (estado) => {
      setDiag((d) => ({ ...d, canal: estado }))
    })

    // Red de seguridad: al entrar se recoge lo que ya hubiera, y cada 3 s se
    // comprueba si se perdió algún mensaje. Sin esto, una sola acción perdida
    // dejaría las dos partidas divergentes hasta el final.
    const recuperar = async () => {
      // Desde 0 a propósito, no desde la última vista: así se sabe cuántas hay en
      // total en la sala, que es el dato que dice si los dos jugadores están
      // realmente en la MISMA partida.
      const todas = await SupabaseService.matchActionsSince(roomId, 0)
      setDiag((d) => ({
        ...d,
        enSala: todas.length,
        misEnSala: todas.filter((a) => a.userId === currentUserId).length,
      }))
      const pendientes = todas.filter((a) => a.id > ultimaAccionRef.current)
      for (const a of pendientes) {
        aplicar({
          id: a.id,
          user_id: a.userId,
          tick: a.tick,
          kind: a.kind,
          plant_id: a.plantId,
          lane: a.lane,
          col: a.col,
        })
      }
    }
    void recuperar()
    const reloj = setInterval(() => { void recuperar() }, 3000)

    return () => {
      dejarDeEscuchar()
      clearInterval(reloj)
    }
  }, [roomId, currentUserId, encolarAccionDelRival])

  // ── EL FINAL LLEGA A LOS DOS LADOS ─────────────────────────────────────────
  //
  // Si el rival se rinde o pierde, el servidor liquida la sala. Sin esto tú te
  // quedabas jugando contra un campo vacío sin saber que ya habías ganado: el
  // resultado existía en la base y en su pantalla, pero no en la tuya.
  useEffect(() => {
    if (!roomId || !currentUserId) return
    let cerrado = false

    const comprobar = async () => {
      if (cerrado) return
      const r = await SupabaseService.roomResult(roomId)
      if (cerrado || !r || !r.ended) return
      cerrado = true

      setResultadoServidor({
        success: true,
        status: r.noWinner ? 'resultado_en_disputa' : 'liquidada',
        payout: 0,
      })
      // Sin ganador (disputa o abandono sin reportes) se muestra como derrota
      // pero sin premio: el aviso de arriba explica que no se repartió nada.
      terminarPorOrdenDelServidor(r.iWon ? 'victory' : 'defeat')
    }

    const dejarDeEscuchar = SupabaseService.subscribeToRoomEnd(roomId, () => { void comprobar() })
    // Y se pregunta cada 4 s por si el mensaje de Realtime se perdió. Sin esta red
    // un mensaje perdido dejaría a alguien peleando contra un campo vacío.
    const reloj = setInterval(() => { void comprobar() }, 4000)

    return () => {
      cerrado = true
      dejarDeEscuchar()
      clearInterval(reloj)
    }
  }, [roomId, currentUserId, terminarPorOrdenDelServidor])

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

      // ── PARTIDA REAL: LO LIQUIDA EL SERVIDOR ───────────────────────────────
      //
      // Con sala, quien reparte ELO, cofres y gemas es report_match_result, y
      // exige que AMBOS jugadores reporten el mismo ganador. Si no coinciden, no
      // cobra nadie. El cliente no calcula nada: sólo dice lo que vio.
      //
      // Se reporta tanto al ganar como al perder — hace falta el reporte de los
      // dos para que se liquide, así que callarse al perder dejaría al rival sin
      // su premio.
      if (roomId && opponentId && currentUserId) {
        const ganador = gameStatus === 'victory' ? currentUserId : opponentId
        void SupabaseService.reportMatchResult(roomId, ganador).then((r) => {
          setResultadoServidor(r)
        })
      }

      // Handle Colosseum match resolution
      if (matchMode === 'colosseum' && onColosseumComplete) {
        const coloRes = onColosseumComplete(gameStatus === 'victory')
        setColosseumResult(coloRes)
      }

      // Handle Tournament match resolution
      if (matchMode === 'tournament') {
        const tourneyId = tournamentOpponent?.tournamentId || 'tourney_free_1'
        const resolved = TournamentManager.resolveMatch(tourneyId, gameStatus === 'victory')
        setTournamentResult(resolved)
      }

      // Con sala, el reparto es del servidor y ya se pidió arriba. Si además se
      // ejecutara el camino del cliente, se llamaría a award_victory_chest por
      // segunda vez y se pintaría un ELO calculado aquí que no tiene por qué
      // coincidir con el que aplicó el servidor: dos cifras distintas para la
      // misma partida.
      const reparteElCliente = !roomId

      if (gameStatus === 'victory') {
        if (reparteElCliente && onBattleComplete) {
          const res = onBattleComplete(true)
          if (res) {
            setBattleSummaryResult({
              eloChange: res.winElo,
              newElo: res.newElo,
              packResult: res.packResult,
            })
          }
        }
      } else if (gameStatus === 'defeat') {
        if (reparteElCliente && onBattleComplete) {
          const res = onBattleComplete(false)
          if (res) {
            setBattleSummaryResult({
              eloChange: -(res.loseElo || 8),
              newElo: res.newElo,
            })
          }
        }
      }
    }
  }, [gameStatus, onBattleComplete, matchMode, onColosseumComplete, roomId, opponentId, currentUserId, tournamentOpponent?.tournamentId])

  useEffect(() => {
    if (practicePlantId) {
      startPracticeGame(practicePlantId)
      if (practicePlantId in PLANT_CONFIGS) {
        setSelectedCard(practicePlantId as PlantId)
      }
    } else if (gameStatus === 'ready') {
      hasHandledEndRef.current = false

      if (roomId) {
        // Con sala, la partida NO empieza en cuanto se pinta la pantalla: primero
        // se pide al servidor el reloj común, para que el tic 0 sea el mismo para
        // los dos. Si arrancáramos ya y lo alineáramos después, los primeros
        // segundos irían desalineados — y ahí es donde caen los primeros soles.
        void SupabaseService.startMatchClock(roomId).then((reloj) => {
          // Sin reloj (la migración 23 aún no está, o falló la llamada) se arranca
          // igual y se juega desalineado, que es peor pero mejor que no jugar.
          startGame(seed, true, reloj?.ancoraMs)
        })
      } else {
        // Entrenamiento contra el bot: no hay reloj que alinear, y el nivel del
        // bot se saca de tu ELO para que se parezca a alguien de tu nivel.
        startGame(seed, false, undefined, userElo)
      }
    }
  }, [practicePlantId, seed, roomId, startGame, startPracticeGame, setSelectedCard, gameStatus, userElo])

  const [showSurrenderModal, setShowSurrenderModal] = useState<boolean>(false)

  const handleSurrenderClick = () => {
    soundManager.playSound('click', 0.5)
    setShowSurrenderModal(true)
  }

  const handleConfirmSurrender = () => {
    setShowSurrenderModal(false)
    hasHandledEndRef.current = true
    surrenderGame()

    // En una partida real, rendirse lo registra el servidor: declara ganador al
    // rival y aplica el ELO. Antes esto no salía del navegador — el cliente
    // restaba 8 puntos en su propio estado, que no se guarda, así que al recargar
    // volvía el ELO de antes; y el rival se quedaba esperando un reporte que no
    // llegaba nunca.
    if (roomId) {
      void SupabaseService.surrenderMatch(roomId).then((r) => {
        setResultadoServidor(r)
      })
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
    hasHandledEndRef.current = false
    setBattleSummaryResult(null)
    // Sin semilla a propósito: volver a jugar es una partida NUEVA. Reutilizar la
    // de la sala daría exactamente la misma partida otra vez, enemigos incluidos.
    startGame()
  }

  return (
    <div
      className={`battlefield ${selectedCard === 'shovel' ? 'battlefield--shovel-mode' : ''}`}
      style={{ backgroundImage: `url(${activeBgImage})` }}
    >
      {/* Top Controls Bar (Colosseum / Tournament Pill) */}
      {(matchMode === 'colosseum' || matchMode === 'tournament') && (
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
      <BaseTower team="p1" hp={p1BaseHp} maxHp={INITIAL_BASE_HP} nombre={nombres?.mio} />
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
          <div className="pvp-diag__linea pvp-diag__linea--envio">{diag.ultimoEnvio}</div>
        </div>
      )}

      {/* Start Overlay */}
      {gameStatus === 'ready' && !practicePlantId && (
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
              const isCellSelected = selectedCard && isP1Side

              return (
                <div
                  key={col}
                  className={`lane__cell ${
                    isP1Side ? 'lane__cell--p1' : 'lane__cell--p2'
                  } ${isCellSelected ? 'lane__cell--selectable' : ''}`}
                  style={{
                    width: `${100 / TOTAL_COLUMNS}%`,
                    zIndex: isCellSelected ? (selectedCard === 'shovel' ? 10 : 40) : 1,
                    pointerEvents: isP1Side ? 'auto' : 'none',
                  }}
                  onClick={() => {
                    if (selectedCard && isP1Side) {
                      if (selectedCard === 'shovel') {
                        digPlant({ lane: lane.id, col })
                      } else {
                        const carta = selectedCard
                        // SÓLO se registra si aquí de verdad se plantó. Si el clic
                        // falla (sin soles, en enfriamiento, casilla ocupada) y se
                        // registrara igual, el rival plantaría algo que en tu
                        // pantalla no existe y las dos partidas se separarían.
                        if (placePlant(lane.id, col)) {
                          registrarPlantacion(carta, lane.id, col)
                        }
                      }
                    }
                  }}
                />
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
        const isShovelActive = selectedCard === 'shovel'

        return (
          <div
            key={plant.id}
            className={`entity plant-unit ${
              isShovelActive ? 'plant-unit--shovel-target' : ''
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
              pointerEvents: isShovelActive ? 'auto' : 'none',
            }}
            onClick={(e) => {
              if (isShovelActive) {
                e.stopPropagation()
                digPlant(plant.id)
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
                <img src="/game-assets/plants/jalapeno_flame_fx.png" alt="Fuego" />
              </div>
            ) : (
              <>
                {/* Subtle Base Ground Aura for Leveled Plants */}
                {getBattlefieldPlantLevel(plant.plantId) > 0 && (
                  <div
                    className={`plant-base-halo ${
                      getBattlefieldPlantLevel(plant.plantId) >= 3
                        ? 'plant-base-halo--gold'
                        : 'plant-base-halo--emerald'
                    }`}
                  />
                )}
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

      {/* Collectible Suns */}
      {suns.map((sun) => (
        <button
          key={sun.id}
          type="button"
          // El último segundo antes de recogerse solo se avisa: si el sol
          // desapareciera sin más, parecería que se ha perdido — y lo que pasa es
          // justo lo contrario, que entra igual.
          className={`sun-item ${
            tick - sun.createdAt >= TICS_ANTES_DE_RECOGERSE_SOLO ? 'sun-item--se-va' : ''
          }`}
          style={{
            left: `${sun.x}%`,
            top: `${sun.y}%`,
          }}
          onMouseDown={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
          onTouchStart={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
          onClick={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
        >
          <img src={sunIcon} alt="Sol" className="sun-item__icon" />
        </button>
      ))}

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
      {(gameStatus === 'victory' || gameStatus === 'defeat') && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={`game-card ${
              gameStatus === 'victory'
                ? 'game-card--victory'
                : 'game-card--defeat'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="game-card__title">
              {gameStatus === 'victory'
                ? '¡VICTORIA!'
                : battleSummaryResult?.isSurrendered
                ? '🏳️ ¡TE HAS RENDIDO!'
                : '¡DERROTA!'}
            </h2>

            {/* PARTIDA REAL: LO QUE DICE EL SERVIDOR
                Sólo aparece cuando hay sala. El premio no se da por hecho: hasta
                que el rival reporta, no hay nada repartido, y el jugador tiene que
                verlo en lugar de creer que ya cobró. */}
            {roomId && (
              <div className="resultado-servidor">
                {!resultadoServidor && (
                  <p className="resultado-servidor__esperando">
                    Enviando el resultado…
                  </p>
                )}
                {resultadoServidor?.status === 'esperando_al_rival' && (
                  <p className="resultado-servidor__esperando">
                    ⏳ Tu resultado está registrado. Falta que tu rival confirme para
                    repartir las recompensas.
                  </p>
                )}
                {resultadoServidor?.status === 'resultado_en_disputa' && (
                  <p className="resultado-servidor__disputa">
                    ⚠️ Tu rival dijo otra cosa. La partida queda en revisión y no se
                    reparte nada a ninguno de los dos.
                  </p>
                )}
                {resultadoServidor?.status === 'liquidada' && (
                  <p className="resultado-servidor__ok">
                    ✅ Partida Confirmada
                    {typeof resultadoServidor.eloGained === 'number' &&
                      gameStatus === 'victory' &&
                      ` +${resultadoServidor.eloGained} 🏆`}
                    {typeof resultadoServidor.payout === 'number' &&
                      resultadoServidor.payout > 0 &&
                      ` · +${resultadoServidor.payout} 💎`}
                  </p>
                )}
                {resultadoServidor?.error && (
                  <p className="resultado-servidor__disputa">
                    No se pudo enviar el resultado: {resultadoServidor.error}
                  </p>
                )}
              </div>
            )}

            {/* ELO BADGE */}
            {battleSummaryResult?.eloChange !== undefined && (
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
                        src="/game-assets/greenfoot/seed_pack_pvp.png"
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
          </div>
        </div>
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
