import { useState, useEffect, useCallback } from 'react'
import GameFrame from './components/GameFrame/GameFrame'
import RotateOverlay from './components/RotateOverlay/RotateOverlay'
import MainMenu from './components/MainMenu/MainMenu'
import Battlefield from './components/Battlefield/Battlefield'
import Collection from './components/Collection/Collection'
import Jardin from './components/Jardin/Jardin'
import Shop from './components/Shop/Shop'
import Ranking from './components/Ranking/Ranking'
import BattlePass from './components/BattlePass/BattlePass'
import Clan from './components/Clan/Clan'
import Marketplace from './components/Marketplace/Marketplace'
import LandingPage from './components/LandingPage/LandingPage'
import PackOpeningModal from './components/PackOpeningModal/PackOpeningModal'
import PvpRewardOpeningModal from './components/PvpRewardOpeningModal/PvpRewardOpeningModal'
import type { PvpRewardDrop } from './utils/pvpRewardManager'
import { useInventory } from './hooks/useInventory'
import type { PackDropResult, PackId } from './utils/packDropManager'
import background from './assets/images/background.webp'
import { soundManager } from './utils/audioManager'
import { getEloDeltasForElo, getTrophyGateForElo } from './utils/arenaManager'
import MatchmakingScreen from './components/Matchmaking/MatchmakingScreen'
import MisPartidas from './components/Repeticiones/MisPartidas'
import VerRepeticion from './components/Repeticiones/VerRepeticion'
import { useMatchmaking, buscaRival, type ModoPartida } from './hooks/useMatchmaking'
import { profileService } from './services/profileService'
import { inventoryService } from './services/inventoryService'
import { referralService } from './services/referralService'
import { seasonService } from './services/seasonService'
import { MatchmakingService } from './services/matchmakingService'
import { useAuth } from './hooks/useAuth'
import AuthModal from './components/Auth/AuthModal'
import AdminPanel from './components/Admin/AdminPanel'
import { supabaseService, isSupabaseConfigured } from './services/supabaseService'
import { ClanManager } from './utils/clanManager'

import { UserManager } from './utils/userManager'
import { useVersionDelJuego } from './hooks/useVersionDelJuego'
import UpdateModal from './components/UpdateModal/UpdateModal'
import { parseEngineVersion, type EngineVersion, type PlantId } from './types/game'
import { StrategicPlaytestLauncherModal } from './components/StrategicPlaytest/StrategicPlaytestLauncherModal'
import type { StrategicPlaytestConfig } from './engine/strategicPlaytest'
import { SeasonManager } from './utils/seasonManager'
import BetaPhaseModal from './components/BetaPhaseModal/BetaPhaseModal'
import { isStrategicPlaytestAuthorized } from './utils/strategicPlaytestAuth'
import { useOnlineUsers } from './hooks/useOnlineUsers'
import { VIP_PASS_PRECIO_GEMAS } from './utils/gameConstants'
import {
  trackPageView,
  type GameScreen,
  SCREEN_ROUTES,
  getScreenFromPath,
  getShopTabFromPath,
} from './utils/analytics'

function App() {
  const [screen, setScreen] = useState<GameScreen>(() => {
    if (typeof window !== 'undefined') {
      return getScreenFromPath(window.location.pathname, window.location.hash)
    }
    return 'landing'
  })
  const [shopInitialTab, setShopInitialTab] = useState<'packs' | 'pass' | 'gold' | 'energy' | 'market'>(() => {
    if (typeof window !== 'undefined') {
      return getShopTabFromPath(window.location.pathname)
    }
    return 'packs'
  })


  /**
   * El código del enlace de repetición, si se llegó por uno.
   *
   * Se lee de la dirección una sola vez, al arrancar. Con código se pide la
   * repetición por él —sin necesidad de sesión— y sin código se pide por sala,
   * que exige haber jugado.
   */
  const [tokenRepeticion] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const partes = window.location.pathname.split('/').filter(Boolean)
    return partes[0]?.toLowerCase() === 'r' && partes[1] ? partes[1] : null
  })
  const [practicePlantId, setPracticePlantId] = useState<string | null>(null)
  const [activeOpeningResult, setActiveOpeningResult] = useState<PackDropResult | PackDropResult[] | null>(null)
  const [activePvpRewardDrops, setActivePvpRewardDrops] = useState<PvpRewardDrop[] | null>(null)
  const [lastOpenedPackType, setLastOpenedPackType] = useState<PackId | null>(null)
  const [activeAppAlert, setActiveAppAlert] = useState<{
    title: string
    message: string
    icon: string
    actionLabel?: string
    onAction?: () => void
  } | null>(null)
  const [activeClanInvitation, setActiveClanInvitation] = useState<{
    id: string
    clanId: string
    clanName: string
    clanTag: string
    clanBadge: string
    clanDescription: string
    leaderName: string
  } | null>(null)
  const [isProcessingClanInvitation, setIsProcessingClanInvitation] = useState(false)

  useEffect(() => {
    const handleGameAlert = (e: Event) => {
      const customEvent = e as CustomEvent<{ title: string; message: string; icon?: string }>
      if (customEvent.detail) {
        setActiveAppAlert({
          title: customEvent.detail.title,
          message: customEvent.detail.message,
          icon: customEvent.detail.icon || '⚠️',
        })
      }
    }
    window.addEventListener('plant-arena:game-alert', handleGameAlert)
    return () => window.removeEventListener('plant-arena:game-alert', handleGameAlert)
  }, [])

  /**
   * VERSIÓN NUEVA PUBLICADA
   *
   * Recarga sola cuando es seguro. Hace falta porque la partida es una simulación
   * determinista: dos jugadores con versiones distintas del motor no juegan la
   * misma partida, cada uno calcula un ganador y la partida acaba en revisión sin
   * repartir nada. Pedir «recargad» no funciona; esto sí.
   *
   * En mitad de una batalla NO se recarga: sería echar a alguien de su propia
   * partida y, con apuesta, hacerle perder las gemas.
   */
  const {
    nueva: hayVersionNueva,
    segundosParaRecarga,
    recargar: recargarVersion,
  } = useVersionDelJuego(screen === 'battle')

  const [userElo, setUserElo] = useState<number>(1000)
  const [customArenaBg, setCustomArenaBg] = useState<string | undefined>(undefined)
  /**
   * Si soy el jugador 1 de la sala.
   *
   * Lo necesita la huella del tablero: cada jugador se ve a sí mismo a la
   * izquierda, así que para que las dos huellas se puedan comparar hay que
   * normalizarlas al punto de vista del jugador 1 — y para eso hay que saber si se
   * es el 1 o el 2.
   */
  const [soyJugador1, setSoyJugador1] = useState<boolean>(true)

  useEffect(() => {
    const handlePopState = () => {
      const nextScreen = getScreenFromPath(window.location.pathname, window.location.hash)
      if (nextScreen === 'shop') {
        setShopInitialTab(getShopTabFromPath(window.location.pathname))
      }
      setScreen(nextScreen)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Sincronización con HTML5 History API (pushState) y Pageviews Virtuales (GA4)
  useEffect(() => {
    const route = SCREEN_ROUTES[screen]
    if (!route) return

    try {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
        const currentPath = window.location.pathname.toLowerCase()
        const isGameOverPath = currentPath.includes('/game-over') && screen === 'battle'
        const isShopSubpath = currentPath.startsWith('/play/shop') && screen === 'shop'
        if (currentPath !== route.path.toLowerCase() && !isGameOverPath && !isShopSubpath) {
          window.history.pushState({ screen }, route.title, route.path)
        }
      }
    } catch (e) {
      console.warn('[History API] Error al actualizar pushState:', e)
    }

    // Si la tienda ya gestiona sus propias subrutas (/play/shop/packs, etc.), no duplicar el pageview general
    const isShopSpecific = window.location.pathname.toLowerCase().startsWith('/play/shop/') && screen === 'shop'
    if (!isShopSpecific) {
      trackPageView({
        page_title: route.title,
        page_path: route.path,
      })
    }
  }, [screen])

  const {
    syncProfileData,
    refreshFromServer,
    userTokens,
    userGold,
    farmingItems,
    addGold,
    buyGoldPackage,
    inventoryPacks,
    playerRewardPacks,
    unlockedPlants,
    plantCopies,
    plantLevels,
    plantStatRolls,
    plantInstances,
    activeDeck,
    activeDeckInstances,
    updateActiveDeck,
    hasVipPass,
    claimedVipLevels,
    freePackSlots,
    buyPack,
    openPackByInstanceId,
    openPackByType,
    openMultiplePacksByInstanceIds,
    startUnlockRewardPack,
    instantUnlockRewardPack,
    openRewardPack,
    fuseAndUpgradePlant,
    buyVipPass,
    claimPassReward,
    claimAllPassRewards,
    awardVictoryPack,
    startUnlockingSlot,
    fastUnlockSlot,
    openSlotPack,
    deductUserTokens,
    addUserTokens,
    donatePlantCopy,
    receivePlantInstance,
    removePlantInstance,
    addPacksToInventory,
    colosseumTickets,
    colosseumCurrentStreak,
    colosseumMaxStreak,
    resolveColosseumMatch,
    playerEnergy,
    setPlayerEnergy,
    maxPlayerEnergy,
    buyEnergyPack,
  } = useInventory()


  const {
    user,
    profile,
    loading,
    isAdmin,
    needsPasswordSetup,
    signInWithGoogle,
    setUserPassword,
    signInWithEmail,
    signOut,
  } = useAuth()

  const onlineUsersCount = useOnlineUsers(user?.id)

  // Real-time synchronization of authenticated Supabase profile with game state
  useEffect(() => {
    if (profile) {
      syncProfileData(profile)
      UserManager.syncWithSupabase(profile)
      if (profile.elo_rating !== undefined && profile.elo_rating !== null) {
        setUserElo(profile.elo_rating)
      }
      // Cargar inventario y saldo autoritativos del servidor. Hasta ahora el
      // estado salía de localStorage, así que el jugador veía su propio
      // navegador en lugar de su cuenta: se perdía el progreso al cambiar de
      // dispositivo y era editable a mano.
      void refreshFromServer()
    }
  }, [profile])

  useEffect(() => {
    if (!user?.id || screen !== 'menu') return

    let cancelado = false

    void profileService.myBalance().then((balance) => {
      if (cancelado || !balance) return

      const eloReal = Number(balance.elo_rating)

      if (Number.isFinite(eloReal)) {
        setUserElo(eloReal)
      }

      if (balance.energy_current !== undefined) {
        setPlayerEnergy(Number(balance.energy_current))
      }
    })

    return () => {
      cancelado = true
    }
  }, [screen, user?.id])

  // Check for direct clan invitations when player is in Lobby
  useEffect(() => {
    if (screen !== 'menu' || !user?.id) return
    let cancelled = false

    const checkInvitations = async () => {
      // If user already has a valid clan, do not show invitation popups
      const currentClan = ClanManager.getUserClan()
      if (currentClan && ClanManager.isValidUuid(currentClan.id)) return

      if (isSupabaseConfigured()) {
        try {
          const invs = await supabaseService.getMyClanInvitations()
          if (!cancelled && invs && invs.length > 0) {
            setActiveClanInvitation(invs[0])
            return
          }
        } catch {}
      }

      // Offline fallback
      const localUsername = profile?.username || UserManager.getProfile().name
      if (localUsername) {
        const localInvs = ClanManager.getMyClanInvitations(localUsername)
        if (!cancelled && localInvs.length > 0) {
          setActiveClanInvitation(localInvs[0])
        }
      }
    }

    void checkInvitations()

    return () => {
      cancelled = true
    }
  }, [screen, user?.id, profile?.username])

  const handleRespondClanInvitation = async (accept: boolean) => {
    if (!activeClanInvitation) return

    if (accept) {
      if (userTokens < 200.0) {
        soundManager.playSound('surrender', 0.6)
        setActiveAppAlert({
          title: 'SALDO INSUFICIENTE',
          message: `Saldo insuficiente para unirte al clan "${activeClanInvitation.clanName}".\nRequieres 200 Gemas 💎 y tu saldo disponible es de ${Math.floor(userTokens)} Gemas 💎.\nPor favor recarga saldo en la Tienda.`,
          icon: '💎',
          actionLabel: 'IR A LA TIENDA',
          onAction: () => setScreen('shop'),
        })
        return
      }

      setIsProcessingClanInvitation(true)
      try {
        if (isSupabaseConfigured()) {
          const res = await supabaseService.respondClanInvitation(activeClanInvitation.id, true)
          if (!res.success) {
            setActiveAppAlert({
              title: 'ERROR AL UNIRSE',
              message: res.message || res.error || 'No se pudo aceptar la invitación.',
              icon: '❌',
            })
            setIsProcessingClanInvitation(false)
            return
          }
        } else {
          const res = ClanManager.respondClanInvitation(activeClanInvitation.id, true, userElo)
          if (!res.success) {
            setActiveAppAlert({
              title: 'ERROR AL UNIRSE',
              message: res.error || 'No se pudo aceptar la invitación.',
              icon: '❌',
            })
            setIsProcessingClanInvitation(false)
            return
          }
        }

        // Deduct 200 gems
        deductUserTokens(200.0)
        soundManager.playSound('plantation', 0.9)
        ClanManager.setUserClanId(activeClanInvitation.clanId)
        void refreshFromServer()

        setActiveAppAlert({
          title: '¡BIENVENIDO AL CLAN!',
          message: `Te has unido exitosamente al clan "${activeClanInvitation.clanName}".\nSe transfirieron 200 Gemas 💎 al Tesoro del Clan.`,
          icon: '🎉',
        })
        setActiveClanInvitation(null)
      } catch (e: any) {
        setActiveAppAlert({
          title: 'ERROR',
          message: e?.message || 'Error al procesar la invitación.',
          icon: '❌',
        })
      } finally {
        setIsProcessingClanInvitation(false)
      }
    } else {
      // Reject
      setIsProcessingClanInvitation(true)
      try {
        if (isSupabaseConfigured()) {
          await supabaseService.respondClanInvitation(activeClanInvitation.id, false)
        } else {
          ClanManager.respondClanInvitation(activeClanInvitation.id, false)
        }
        soundManager.playSound('click', 0.4)
        setActiveClanInvitation(null)
      } catch {
        setActiveClanInvitation(null)
      } finally {
        setIsProcessingClanInvitation(false)
      }
    }
  }

  /**
   * EL ENLACE DE INVITACIÓN
   *
   * Antes esto no existía: el enlace era «/?ref=<nombre>» y nadie leía ese
   * parámetro, así que repartirlo no servía absolutamente para nada.
   *
   * El código se guarda en cuanto se abre la página, ANTES de registrarse: quien
   * llega por una invitación tiene que crearse la cuenta primero, y en ese viaje
   * la dirección se pierde. Se queda en sessionStorage hasta que hay sesión, y
   * entonces se manda una sola vez.
   *
   * El servidor decide si vale (referral_bind): no a uno mismo, no dos veces, no
   * con la cuenta ya vieja y no si ya se pasó de las copas. Aquí sólo se entrega.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const codigo = new URLSearchParams(window.location.search).get('ref')
    if (codigo) {
      try {
        sessionStorage.setItem('pa_ref', codigo.trim())
        localStorage.setItem('pa_ref', codigo.trim())
      } catch {}
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    let codigo: string | null = null
    try {
      codigo = sessionStorage.getItem('pa_ref') || localStorage.getItem('pa_ref')
    } catch {}
    if (!codigo) return

    void referralService.referralBind(codigo).then((res) => {
      // Si tuvo éxito o el motivo es terminal (ej. ya vinculado o código inválido), limpiar el almacenamiento
      if (res.ok || (res.motivo && res.motivo !== 'sin_supabase')) {
        try {
          sessionStorage.removeItem('pa_ref')
          localStorage.removeItem('pa_ref')
        } catch {}
      }
    })
  }, [profile])

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false)
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState<boolean>(false)
  const [isBetaPhaseModalOpen, setIsBetaPhaseModalOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !localStorage.getItem('plant_arena_beta_phase_seen_v1')
  })

  // Sincronizar temporada oficial desde Supabase al iniciar
  useEffect(() => {
    seasonService.getActiveSeason().then((season) => {
      if (season) {
        SeasonManager.updateFromSupabase(season)
      }
    })
  }, [])

  // Automatically show set password modal if user logged in with Google for first time
  useEffect(() => {
    if (needsPasswordSetup) {
      setIsAuthModalOpen(true)
    }
  }, [needsPasswordSetup])

  // Verify session when accessing /play route
  useEffect(() => {
    if (loading) return

    const isPlayRoute = typeof window !== 'undefined' && (
      window.location.pathname.toLowerCase().startsWith('/play') ||
      window.location.hash.toLowerCase().includes('play')
    )

    if (isPlayRoute) {
      if (user) {
        // Only set screen to menu if currently on landing
        setScreen((prev) => (prev === 'landing' ? 'menu' : prev))
      } else {
        // No active session found -> redirect to landing and pop up login/register
        setScreen('landing')
        setIsAuthModalOpen(true)
      }
    }
  }, [loading, user])

  const [battleMatchMode, setBattleMatchMode] = useState<'ranked' | 'friendly' | 'colosseum' | 'tournament' | 'strategic_test'>('ranked')
  const [friendlyBet, setFriendlyBet] = useState<number>(0)
  const [colosseumConfig, setColosseumConfig] = useState<import('./types/game').ColosseumMatchConfig | null>(null)
  const [tournamentOpponent, setTournamentOpponent] = useState<{ name: string; tournamentId: string } | null>(null)
  const [tournamentDeck, setTournamentDeck] = useState<PlantId[] | null>(null)
  const [isStrategicPlaytestModalOpen, setIsStrategicPlaytestModalOpen] = useState<boolean>(false)
  const [strategicPlaytestConfig, setStrategicPlaytestConfig] = useState<StrategicPlaytestConfig | null>(null)

  // ── EMPAREJAMIENTO ────────────────────────────────────────────────────────
  // La sala la crea el servidor (migración 17) y trae la semilla, que es lo que
  // hace que los dos jugadores simulen exactamente la misma partida. Si roomId es
  // null, la partida es contra el bot local y no cuenta para el servidor.
  const { estado: estadoCola, encontrada, buscar, cancelar } = useMatchmaking()
  const [modoBuscando, setModoBuscando] = useState<ModoPartida>('ranked')
  const [salaId, setSalaId] = useState<string | null>(null)
  const [engineVersionSala, setEngineVersionSala] = useState<EngineVersion | null>(null)
  const [semillaPartida, setSemillaPartida] = useState<number | undefined>(undefined)
  const [rivalId, setRivalId] = useState<string | null>(null)
  /** La partida cuya repetición se está viendo. */
  const [salaRepeticion, setSalaRepeticion] = useState<string | null>(null)
  /** Los nicks de los dos, para ponerlos encima de cada árbol en la batalla. */
  const [nombresEnPartida, setNombresEnPartida] = useState<{ mio: string; rival: string } | null>(null)
  /**
   * Los dos mazos de la sala, tal como los guardó el SERVIDOR al emparejar.
   *
   * Con el nivel y las mejoras de cada carta. Es lo que permite a las dos pantallas
   * simular la misma planta: quien planta aplicaba sus mejoras desde su navegador y
   * el rival ponía la carta básica, así que la misma planta tenía 345 de vida en un
   * lado y 300 en el otro desde el momento de plantarla. Ver
   * engine/mazoDeLaSala.ts.
   *
   * El dato ya llegaba en game_room_info; sólo se estaba tirando.
   */
  const [mazosDeLaSala, setMazosDeLaSala] = useState<{ mio: unknown; rival: unknown } | null>(null)
  const [partidaAsincrona, setPartidaAsincrona] = useState<boolean>(false)
  const [reopenTournamentOnMenu, setReopenTournamentOnMenu] = useState<boolean>(false)

  // Reaccionar a errores asíncronos de la cola (por ej. agotamiento de energías en backend)
  useEffect(() => {
    if (screen === 'searching' && estadoCola.error) {
      setScreen('menu')
      if (
        estadoCola.error === 'sin_energia' ||
        estadoCola.error.includes('energía') ||
        estadoCola.error.includes('energia')
      ) {
        setActiveAppAlert({
          title: 'ENERGÍA AGOTADA',
          message:
            '⚡ Has agotado tus energías de Ranked. Se recargan automáticamente a las 00:00 UTC, o puedes recargar ahora en la Tienda.',
          icon: '⚡',
          actionLabel: 'IR A TIENDA',
          onAction: () => handleOpenShop('energy'),
        })
      } else {
        setActiveAppAlert({
          title: 'ERROR EN EMPAREJAMIENTO',
          message: estadoCola.error,
          icon: '⚠️',
        })
      }
      void refreshFromServer()
    }
  }, [screen, estadoCola.error, refreshFromServer])

  /**
   * Cuando el servidor empareja, se leen la semilla y los jugadores de la sala y
   * se entra a la batalla. La semilla NO la elige el cliente.
   */
  useEffect(() => {
    if (!encontrada) return
    let cancelado = false
    ;(async () => {
      const info = await MatchmakingService.gameRoomInfo(encontrada.roomId)
      if (cancelado) return

      const sala = info ?? (await (async () => {
        const basica = await MatchmakingService.getGameRoom(encontrada.roomId)
        if (!basica) return null
        return {
          id: basica.id,
          mode: basica.mode,
          seed: basica.seed,
          engineVersion: parseEngineVersion(basica.engine_version),
          iAm: (basica.player1_id === user?.id ? 'p1' : 'p2') as 'p1' | 'p2',
          player1: { id: basica.player1_id, username: null },
          player2: { id: basica.player2_id ?? '00000000-0000-0000-0000-000000000000', username: basica.async_display_name ?? null },
          p1Deck: basica.p1_deck,
          p2Deck: basica.is_async_match ? basica.async_deck_snapshot : basica.p2_deck,
          isAsyncMatch: basica.is_async_match,
        }
      })())
      if (cancelado) return
      if (!sala) {
        setScreen('menu')
        return
      }

      const versionValidada = parseEngineVersion(sala.engineVersion)
      if (!versionValidada) {
        setScreen('menu')
        setActiveAppAlert({
          title: 'Versión no válida',
          message: 'No se pudo validar la versión de esta partida. Actualiza el juego e inténtalo nuevamente.',
          icon: '⚠️',
        })
        return
      }

      setSalaId(sala.id)
      setEngineVersionSala(versionValidada)
      setSemillaPartida(Number(sala.seed))
      const soyP1 = sala.iAm === 'p1'
      setSoyJugador1(soyP1)
      setRivalId(soyP1 ? sala.player2.id : sala.player1.id)
      const miNick = soyP1 ? sala.player1.username : sala.player2.username
      const suNick = soyP1 ? sala.player2.username : sala.player1.username
      setNombresEnPartida(
        miNick && suNick ? { mio: miNick, rival: suNick } : null
      )
      setMazosDeLaSala({
        mio: soyP1 ? sala.p1Deck : sala.p2Deck,
        rival: soyP1 ? sala.p2Deck : sala.p1Deck,
      })
      setPartidaAsincrona(Boolean(sala.isAsyncMatch))
      setBattleMatchMode(sala.mode as 'ranked' | 'friendly' | 'colosseum' | 'tournament')
      if (sala.mode === 'ranked' && userElo >= 1602) {
        setPlayerEnergy((prev) => Math.max(0, prev - 1))
      }
      if (sala.mode === 'friendly') {
        setFriendlyBet(Number((sala as any).colosseumBet) || 0)
      }
      setPracticePlantId(null)
      setScreen('battle')
    })()
    return () => { cancelado = true }
  }, [encontrada, user?.id])

  const limpiarEstadoPartida = useCallback(() => {
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    setMazosDeLaSala(null)
    setPartidaAsincrona(false)
    setEngineVersionSala(null)
    setCustomArenaBg(undefined)
    setTournamentOpponent(null)
    setTournamentDeck(null)
    setPracticePlantId(null)
  }, [])

  const handleRegresarAlMenu = useCallback(() => {
    if (battleMatchMode === 'tournament') {
      setReopenTournamentOnMenu(true)
    }
    limpiarEstadoPartida()
    setScreen('menu')
    void refreshFromServer()
  }, [battleMatchMode, limpiarEstadoPartida, refreshFromServer])

  /** Cancelar la búsqueda y volver al menú. */
  const salirDeLaCola = async () => {
    await cancelar()
    void refreshFromServer()
    handleRegresarAlMenu()
  }

  /** Flujo de compra directa del Pase VIP desde el Pase de Batalla o cualquier sección */
  const handleBuyVipPassDirect = useCallback(() => {
    soundManager.playSound('click', 0.5)
    setActiveAppAlert({
      title: 'COMPRAR PASE VIP',
      message: `¿Deseas comprar el Pase VIP de Temporada por ${VIP_PASS_PRECIO_GEMAS.toLocaleString()} 💎 gemas?\n\nBeneficios incluidos:\n👑 Desbloqueo y reclamo de todas las recompensas doradas del Pase.\n⚡ +5 Energías máximas diarias (25 energías en total).\n📦 Acceso completo para comerciar cartas en el Mercado P2P.`,
      icon: '👑',
      actionLabel: `COMPRAR (${VIP_PASS_PRECIO_GEMAS.toLocaleString()} 💎)`,
      onAction: async () => {
        const { success: ok, error } = await buyVipPass()
        if (ok) {
          soundManager.playSound('plantation', 0.9)
          setActiveAppAlert({
            title: '¡PASE VIP ACTIVADO!',
            message: '👑 ¡Pase VIP de Temporada activado con éxito!\nAhora puedes reclamar todas las recompensas doradas que tengas desbloqueadas.',
            icon: '🎉',
          })
        } else {
          setActiveAppAlert({
            title: 'NO SE PUDO ACTIVAR',
            message: error || `Saldo insuficiente. Se requieren ${VIP_PASS_PRECIO_GEMAS.toLocaleString()} 💎 gemas para comprar el Pase VIP.`,
            icon: '⚠️',
          })
        }
      },
    })
  }, [buyVipPass])

  const handleGoToGame = () => {
    setScreen('menu')
    try {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:' && !window.location.pathname.startsWith('/play')) {
        window.history.pushState(null, '', '/play')
      }
    } catch {
      // Safe fallback
    }
  }

  const handleGoToLanding = () => {
    setScreen('landing')
    try {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:' && window.location.pathname !== '/') {
        window.history.pushState(null, '', '/')
      }
    } catch {
      // Safe fallback
    }
  }

  /**
   * DUELO AMISTOSO
   *
   * El código hace la sala privada: el servidor sólo empareja a quien tenga
   * exactamente el mismo, así que a tu sala no entra nadie más — espera a tu amigo
   * y en cuanto entra, empieza.
   *
   * La apuesta va con la búsqueda porque se cobra al ENTRAR a la cola: si no
   * aparece nadie y se cancela, hay una retención concreta que devolver. Y sólo se
   * cruzan dos jugadores que hayan puesto la MISMA cantidad, que es lo que hace de
   * acuerdo sin necesidad de negociar.
   */
  const handlePlayFriendly = (roomCode: string, betGems: number) => {
    setBattleMatchMode('friendly')
    setFriendlyBet(betGems)
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    setMazosDeLaSala(null)
    setModoBuscando('friendly')
    setScreen('searching')
    void buscar('friendly', { roomCode, betGems })
  }

  const guardarMazoAntesDeBuscar = async (
    instanceIdsOverride?: string[]
  ): Promise<boolean> => {
    let ids = instanceIdsOverride ?? activeDeckInstances

    const inventario = await inventoryService.myInventory()
    if (!inventario) {
      return false
    }

    // Convertir IDs legados como "inst_base_..." a UUIDs
    ids = ids
      .map((id) => {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return id
        }

        if (id.startsWith('inst_base_')) {
          const plantId = id.replace('inst_base_', '')
          return inventario.instances.find(
            (inst) => inst.plantId === plantId
          )?.instanceId
        }

        return undefined
      })
      .filter((id): id is string => Boolean(id))

    // Validar contra el inventario real: solo instancias que pertenezcan al usuario y NO estén en venta
    const unlistedInstances = inventario.instances.filter((inst) => !inst.isListed)
    const validInstanceSet = new Set(unlistedInstances.map((inst) => inst.instanceId))

    let cleanIds = ids.filter((id) => validInstanceSet.has(id))

    // Si por ventas en el mercado o desincronización quedaron menos de 3 cartas, auto-rellenar
    if (cleanIds.length < 3) {
      for (const inst of unlistedInstances) {
        if (!cleanIds.includes(inst.instanceId)) {
          cleanIds.push(inst.instanceId)
          if (cleanIds.length >= 4) break
        }
      }
    }

    if (cleanIds.length > 6) {
      cleanIds = cleanIds.slice(0, 6)
    }

    if (cleanIds.length < 3) {
      setActiveAppAlert({
        title: 'MAZO INVÁLIDO',
        message: 'Debes tener al menos 3 plantas disponibles (no en venta) para jugar.',
        icon: '⚠️',
      })
      return false
    }

    const resultado = await profileService.saveActiveDeck(cleanIds)

    if (!resultado.success) {
      setActiveAppAlert({
        title: 'NO SE PUDO GUARDAR EL MAZO',
        message:
          resultado.error ??
          'No se pudo sincronizar tu mazo con el servidor.',
        icon: '⚠️',
      })
      return false
    }

    // Sincronizar estado local en caso de que se hayan purgado cartas en venta
    const plantIdsForDeck = cleanIds
      .map((id) => unlistedInstances.find((inst) => inst.instanceId === id)?.plantId as PlantId)
      .filter(Boolean)
    updateActiveDeck(plantIdsForDeck, cleanIds)

    return true
  }

  const handleBackFromJardin = (instanceIds?: string[]) => {
    if (instanceIds && instanceIds.length >= 3 && instanceIds.length <= 6) {
      void guardarMazoAntesDeBuscar(instanceIds)
    }
    setScreen('menu')
  }

  const handlePlayNormal = async (
    instanceIdsOverride?: string[]
  ) => {
    // El mazo se guarda ANTES de entrar a matchmaking.
    // Así game_rooms.p1_deck / p2_deck reciben exactamente
    // las cartas que el jugador tiene seleccionadas.
    const mazoGuardado = await guardarMazoAntesDeBuscar(
      instanceIdsOverride
    )

    if (!mazoGuardado) return

    setBattleMatchMode('ranked')
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    setMazosDeLaSala(null)

    if (!buscaRival('ranked')) {
      setScreen('battle')
      return
    }

    setModoBuscando('ranked')
    setScreen('searching')

    const r = await buscar('ranked')
    if (!r.ok) {
      setScreen('menu')
      if (r.error === 'sin_energia' || r.error?.includes('energía') || r.error?.includes('energia')) {
        setActiveAppAlert({
          title: 'ENERGÍA AGOTADA',
          message:
            '⚡ Has agotado tus partidas competitivas de hoy. Tu energía se recarga automáticamente a las 00:00 UTC, o puedes recargar ahora en la Tienda.',
          icon: '⚡',
          actionLabel: 'IR A TIENDA',
          onAction: () => handleOpenShop('energy'),
        })
      } else if (r.error && r.error !== 'cancelled') {
        setActiveAppAlert({
          title: 'NO SE PUDO BUSCAR PARTIDA',
          message: r.error,
          icon: '⚠️',
        })
      }
      void refreshFromServer()
      return
    }
  }

  /**
   * COLISEO
   *
   * Ya no se descuenta el ticket aquí: lo hace el servidor dentro de
   * enter_matchmaking, junto con la retención de la apuesta. Antes se restaba en
   * el cliente, así que el número bailaba y la siguiente sincronización lo
   * corregía; y si el jugador cerraba la pestaña, se quedaba sin ticket sin haber
   * jugado.
   *
   * Si no aparece rival en 4 minutos, el servidor devuelve lo cobrado solo.
   */
  const handleStartColosseumMatch = async (betGems: import('./types/game').ColosseumBetAmount, usedTicket: boolean) => {
    setBattleMatchMode('colosseum')
    setTournamentOpponent(null)
    setColosseumConfig({
      betGems,
      usedTicket,
      // Informativo: el pago real lo calcula report_match_result sobre el pozo
      // efectivamente retenido, no sobre esta cuenta.
      payoutGems: Number((betGems * 1.6).toFixed(2)),
      rakeGems: Number((betGems * 0.4).toFixed(2)),
    })
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    if (!buscaRival('colosseum')) {
      // El coliseo espera a la verificación en servidor. Hasta entonces una
      // discrepancia entre los dos clientes dejaría la partida en disputa, y aquí
      // hay gemas de verdad: se devuelven, pero es una vuelta entera para nada.
      setScreen('battle')
      return
    }
    setModoBuscando('colosseum')
    setScreen('searching')
    const r = await buscar('colosseum', { betGems, useTicket: usedTicket })
    if (!r.ok) {
      // No se cobró nada: enter_matchmaking cobra dentro de la misma transacción
      // que encola, así que si falla no hay retención que devolver.
      setScreen('menu')
      return
    }
    // El saldo lo pone el servidor, que ya cobró.
    void refreshFromServer()
  }

  const handleStartTournamentMatch = async (opponentName: string, tournamentId: string, tourneyDeck?: PlantId[]) => {
    setBattleMatchMode('tournament')
    setColosseumConfig(null)
    setTournamentOpponent({ name: opponentName || 'Rival del Torneo', tournamentId })
    setTournamentDeck(tourneyDeck || null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    setMazosDeLaSala(null)

    if (!buscaRival('tournament')) {
      setScreen('battle')
      return
    }

    setModoBuscando('tournament')
    setScreen('searching')
    void buscar('tournament', { roomCode: tournamentId })
  }

  const handleStartStrategicPlaytest = (config: StrategicPlaytestConfig) => {
    // Gate estricto: denegar si el usuario no está explícitamente autorizado
    if (!isStrategicPlaytestAuthorized({ user, profile, isAdmin })) {
      return
    }

    setBattleMatchMode('strategic_test')
    setStrategicPlaytestConfig(config)
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setRivalId(null)
    setSemillaPartida(config.seed)
    // Estilo 100% oculto durante el combate (sin filtración en el árbol rival)
    setNombresEnPartida({ mio: 'TÚ (P1)', rival: 'RIVAL ESTRATÉGICO' })
    setPartidaAsincrona(true)
    setEngineVersionSala('auth-v2')
    setScreen('battle')
    setIsStrategicPlaytestModalOpen(false)
  }

  const handleOpenCollection = () => {
    setScreen('collection')
  }

  const handleOpenJardin = () => {
    setScreen('jardin')
  }

  const handleOpenShop = (tab: 'packs' | 'pass' | 'gold' | 'energy' | 'market' = 'packs') => {
    setShopInitialTab(tab)
    setScreen('shop')
  }


  const handleOpenRanking = () => {
    setScreen('ranking')
  }

  const handlePracticePlant = (plantId: string) => {
    setPracticePlantId(plantId)
    setCustomArenaBg(undefined)
    setScreen('battle')
  }

  // Estos cuatro manejadores pasaron a asíncronos: la apertura la resuelve el
  // servidor. El sorteo ya no ocurre en el navegador, así que hay que esperar
  // la respuesta antes de pintar la animación de resultado.
  const handleTriggerPackOpenByInstanceId = async (instanceId: string) => {
    const packObj = inventoryPacks.find((p) => p.instanceId === instanceId)
    if (packObj) {
      setLastOpenedPackType(packObj.packId)
    }
    const drop = await openPackByInstanceId(instanceId)
    if (drop) {
      setActiveOpeningResult(drop)
    }
  }

  const handleOpenMultiplePacks = async (instanceIds: string[]) => {
    if (instanceIds.length === 0) return
    const packObj = inventoryPacks.find((p) => p.instanceId === instanceIds[0])
    if (packObj) {
      setLastOpenedPackType(packObj.packId)
    }
    const drops = await openMultiplePacksByInstanceIds(instanceIds)
    if (drops.length > 0) {
      setActiveOpeningResult(drops)
    }
  }

  const handleOpenAnotherPack = async () => {
    if (!lastOpenedPackType) return
    const drop = await openPackByType(lastOpenedPackType)
    if (drop) {
      setActiveOpeningResult(drop)
    } else {
      setActiveOpeningResult(null)
    }
  }

  const handleOpenSlotPack = async (slotId: number) => {
    const drops = await openSlotPack(slotId)
    if (drops && drops.length > 0) {
      setActivePvpRewardDrops(drops)
    }
  }

  const handleOpenRewardPack = async (packId: string) => {
    const drop = await openRewardPack(packId)
    if (drop) {
      setActiveOpeningResult(drop)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ELO — PENDIENTE DE FASE 2
  //
  // Aquí se escribía elo_rating directamente en profiles. Eso permitía a
  // cualquier jugador ponerse primero del ranking global con una línea en la
  // consola, porque getGlobalLeaderboard ordena precisamente por esa columna.
  // El permiso de columna está revocado, así que esas llamadas ya sólo
  // devolvían un error que nadie miraba.
  //
  // El ELO tiene que calcularlo el servidor al resolver la partida, como ya
  // hace report_match_result en el coliseo. Mientras el emparejamiento y la
  // resolución de partida clasificatoria no existan (fase 2), el ELO se mueve
  // sólo en pantalla y el ranking se queda congelado. Es preferible un ranking
  // parado a uno que cualquiera puede falsificar.
  // ───────────────────────────────────────────────────────────────────────────
  const handleBattleComplete = async (isVictory: boolean) => {
    const deltas = getEloDeltasForElo(userElo)
    if (isVictory) {
      const newElo = userElo + deltas.winElo
      setUserElo(newElo)
      const packResult = await awardVictoryPack(newElo)
      return { winElo: deltas.winElo, newElo, packResult }
    } else {
      const gate = getTrophyGateForElo(userElo)
      const newElo = Math.max(gate, userElo - deltas.loseElo)
      const effectiveLoss = userElo - newElo
      setUserElo(newElo)
      return { loseElo: effectiveLoss, newElo }
    }
  }

  const handleSurrender = () => {
    const deltas = getEloDeltasForElo(userElo)
    const gate = getTrophyGateForElo(userElo)
    const newElo = Math.max(gate, userElo - deltas.surrenderElo)
    const effectiveLoss = userElo - newElo
    setUserElo(newElo)
    return { surrenderElo: effectiveLoss, newElo }
  }

  const handleServerEloUpdated = (newElo: number) => {
    if (typeof newElo === 'number' && !isNaN(newElo)) {
      setUserElo(newElo)
      void refreshFromServer()
    }
  }

  const hasMorePacksOfSameType = lastOpenedPackType
    ? inventoryPacks.some((p) => p.packId === lastOpenedPackType)
    : false

  if (screen === 'landing') {
    return (
      <>
        {/* Ventana emergente / banner de actualización */}
        <UpdateModal
          isOpen={hayVersionNueva}
          isBattle={false}
          countdownSeconds={segundosParaRecarga}
          onReload={recargarVersion}
        />

        <LandingPage
          onPlayGame={handleGoToGame}
          isLoggedIn={Boolean(user)}
          userProfile={profile}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onSignOut={signOut}
        />
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          userEmail={user?.email}
          initialUsername={profile?.username || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0]}
          needsPasswordSetup={needsPasswordSetup}
          onSignInGoogle={signInWithGoogle}
          onSignInEmail={signInWithEmail}
          onSetUserPassword={setUserPassword}
          onSuccessRedirect={handleGoToGame}
        />
        <AdminPanel
          isOpen={isAdminPanelOpen}
          onClose={() => setIsAdminPanelOpen(false)}
        />
      </>
    )
  }

  return (
    <>
      {/* Ventana emergente / banner de actualización */}
      <UpdateModal
        isOpen={hayVersionNueva}
        isBattle={screen === 'battle'}
        countdownSeconds={segundosParaRecarga}
        onReload={recargarVersion}
      />


      <GameFrame>
        {screen === 'menu' && (
          <MainMenu
            onlineUsersCount={onlineUsersCount}
            userProfile={profile}
            userElo={userElo}
            userTokens={userTokens}
            userGold={userGold}
            hasVipPass={hasVipPass}
            unlockedPlants={unlockedPlants}
            claimedVipLevels={claimedVipLevels}
            freePackSlots={freePackSlots}
            colosseumTickets={colosseumTickets}
            colosseumCurrentStreak={colosseumCurrentStreak}
            colosseumMaxStreak={colosseumMaxStreak}
            playerEnergy={playerEnergy}
            maxPlayerEnergy={maxPlayerEnergy}
            onPlay={handlePlayNormal}
            onPlayFriendly={handlePlayFriendly}
            onStartColosseumMatch={handleStartColosseumMatch}
            onOpenMisPartidas={() => setScreen('partidas')}
            onStartTournamentMatch={handleStartTournamentMatch}
            onOpenCollection={handleOpenCollection}
            onOpenJardin={handleOpenJardin}
            onOpenShop={handleOpenShop}
            onOpenRanking={handleOpenRanking}
            onOpenBattlePass={() => setScreen('pass')}
            onOpenClan={() => setScreen('clan')}
            onOpenMarketplace={() => setScreen('market')}
            onOpenLanding={handleGoToLanding}
            onOpenAdmin={() => setIsAdminPanelOpen(true)}
            onOpenBetaInfo={() => setIsBetaPhaseModalOpen(true)}
            onOpenStrategicPlaytest={
              isStrategicPlaytestAuthorized({ user, profile, isAdmin })
                ? () => setIsStrategicPlaytestModalOpen(true)
                : undefined
            }
            isAdmin={isAdmin}
            onSignOut={async () => {
              await signOut()
              setScreen('landing')
            }}
            onStartSlotUnlock={startUnlockingSlot}
            onFastUnlockSlot={fastUnlockSlot}
            onOpenSlotPack={handleOpenSlotPack}
            onDeductTokens={deductUserTokens}
            reopenTournamentModal={reopenTournamentOnMenu}
            onResetReopenTournamentModal={() => setReopenTournamentOnMenu(false)}
          />
        )}
        {screen === 'partidas' && (
          <MisPartidas
            onVolver={() => setScreen('menu')}
            onVerRepeticion={(roomId) => {
              setSalaRepeticion(roomId)
              setScreen('repeticion')
            }}
          />
        )}
        {screen === 'repeticion' && (
          <VerRepeticion
            roomId={salaRepeticion}
            token={tokenRepeticion}
            onVolver={() => {
              setSalaRepeticion(null)
              // Quien llegó por un enlace compartido no viene de la lista de sus
              // partidas: se le lleva a la portada, que es lo que hay detrás para
              // él. Y se limpia la dirección para que recargar no vuelva a abrir
              // la repetición.
              if (tokenRepeticion) {
                setScreen('landing')
                if (typeof window !== 'undefined') {
                  window.history.replaceState(null, '', '/')
                }
              } else {
                setScreen('partidas')
              }
            }}
          />
        )}
        {screen === 'searching' && (
          <MatchmakingScreen
            modo={modoBuscando}
            estado={estadoCola}
            apuesta={
              modoBuscando === 'colosseum' && colosseumConfig
                ? { gemas: colosseumConfig.betGems, conTicket: colosseumConfig.usedTicket }
                : null
            }
            onCancelar={() => { void salirDeLaCola() }}
          />
        )}
        {screen === 'battle' && (
          <Battlefield
            onBackToMenu={handleRegresarAlMenu}
            onBackToCollection={() => setScreen('collection')}
            onBattleComplete={handleBattleComplete}
            onSurrender={handleSurrender}
            onServerEloUpdated={handleServerEloUpdated}
            practicePlantId={practicePlantId}
            activeDeck={activeDeck}
            userElo={userElo}
            customBgImage={customArenaBg}
            matchMode={battleMatchMode}
            friendlyBetGems={friendlyBet}
            colosseumConfig={colosseumConfig}
            tournamentOpponent={tournamentOpponent}
            tournamentDeck={tournamentDeck}
            strategicPlaytestConfig={strategicPlaytestConfig}
            onPlayAgainPlaytest={() => setIsStrategicPlaytestModalOpen(true)}
            /* Con sala, la partida es real: misma semilla para los dos y el
               resultado lo liquida el servidor. Sin sala es contra el bot local. */
            roomId={salaId}
            seed={semillaPartida}
            opponentId={rivalId}
            nombres={nombresEnPartida}
            soyP1={soyJugador1}
            /* Los mazos que guardó el servidor, con el nivel y las mejoras de cada
               carta. Es lo que hace que las dos pantallas simulen la MISMA planta:
               ver engine/mazoDeLaSala.ts. */
            mazosDeLaSala={mazosDeLaSala}
            isAsyncMatch={partidaAsincrona}
            engineVersion={engineVersionSala}
            onColosseumComplete={(won) => {
              if (colosseumConfig) {
                return resolveColosseumMatch(won, colosseumConfig.betGems, colosseumConfig.usedTicket)
              }
              return { payoutGems: 0, newStreak: 0, newMaxStreak: colosseumMaxStreak, isNewRecord: false }
            }}
          />
        )}
        {screen === 'collection' && (
          <Collection
            onBack={() => setScreen('menu')}
            onPracticePlant={handlePracticePlant}
            unlockedPlants={unlockedPlants}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
          />
        )}
        {screen === 'jardin' && (
          <Jardin
            activeDeck={activeDeck}
            unlockedPlants={unlockedPlants}
            inventoryPacks={inventoryPacks}
            playerRewardPacks={playerRewardPacks}
            userTokens={userTokens}
            userGold={userGold}
            farmingItems={farmingItems}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
            onUpdateDeck={updateActiveDeck}
            onBack={handleBackFromJardin}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenShop={handleOpenShop}
            onOpenPack={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onStartUnlockRewardPack={startUnlockRewardPack}
            onInstantUnlockRewardPack={instantUnlockRewardPack}
            onOpenRewardPack={handleOpenRewardPack}
            onFusePlant={fuseAndUpgradePlant}
            isAdmin={isAdmin}
            onOpenAdmin={() => setIsAdminPanelOpen(true)}
            onRewardsChanged={refreshFromServer}
          />
        )}
        {screen === 'shop' && (
          <Shop
            userTokens={userTokens}
            userElo={userElo}
            userGold={userGold}
            hasVipPass={hasVipPass}
            inventoryPacks={inventoryPacks}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
            farmingItems={farmingItems}
            initialTab={shopInitialTab}
            playerEnergy={playerEnergy}
            maxPlayerEnergy={maxPlayerEnergy}
            onBuyEnergyPack={buyEnergyPack}
            onBack={() => setScreen('menu')}
            onBuyPack={buyPack}
            onBuyGold={buyGoldPackage}
            onAddGold={addGold}
            onOpenJardin={handleOpenJardin}
            onOpenPackImmediately={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onBuyVipPass={buyVipPass}
            onDeductTokens={deductUserTokens}
            onDonatePlant={donatePlantCopy}
            onReceivePlant={receivePlantInstance}
            onServerChange={refreshFromServer}
          />
        )}
        {screen === 'ranking' && (
          <Ranking
            userElo={userElo}
            userProfile={profile}
            hasVipPass={hasVipPass}
            onBack={() => setScreen('menu')}
          />
        )}
        {screen === 'pass' && (
          <div
            className="ranking-screen"
            style={{ backgroundImage: `url(${background})` }}
          >
            <div className="ranking-header">
              <button
                type="button"
                className="ranking-back-btn"
                onClick={() => setScreen('menu')}
              >
                ⬅ VOLVER AL MENÚ
              </button>
              <div className="ranking-header__center">
                <h1 className="ranking-title">👑 PASE DE TEMPORADA VIP</h1>
                <span className="ranking-subtitle">
                  Sube copas ELO en la Arena para desbloquear recompensas exclusivas
                </span>
              </div>
              <div className="ranking-header__right">
                <button
                  type="button"
                  className="ranking-mute-btn"
                  onClick={() => soundManager.toggleMute()}
                >
                  🔊
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: '6px 0' }}>
              <BattlePass
                userElo={userElo}
                hasVipPass={hasVipPass}
                claimedVipLevels={claimedVipLevels}
                onBuyVipPass={handleBuyVipPassDirect}
                onClaimReward={async (lvl) => {
                  const res = await claimPassReward(lvl.reward, lvl.level)
                  if (res?.success) {
                    setActiveAppAlert({
                      title: '¡RECOMPENSA RECLAMADA!',
                      message: `👑 ¡RECOMPENSA VIP DEL NIVEL ${lvl.level} RECLAMADA!\n${lvl.reward.label}\nSe ha añadido a tu inventario de Mi Jardín.`,
                      icon: '🎉',
                    })
                  } else {
                    setActiveAppAlert({
                      title: 'NO SE PUDO RECLAMAR',
                      message: res?.error || 'No se pudo reclamar la recompensa.',
                      icon: '⚠️',
                    })
                  }
                }}
                onClaimAllRewards={async (levels) => {
                  const res = await claimAllPassRewards()
                  if (res?.success) {
                    setActiveAppAlert({
                      title: '¡RECOMPENSAS RECLAMADAS!',
                      message: `👑 ¡${levels.length} RECOMPENSAS VIP RECLAMADAS CON ÉXITO!\nSe han guardado en tu inventario de Mi Jardín.`,
                      icon: '🎁',
                    })
                  } else {
                    setActiveAppAlert({
                      title: 'NO SE PUDO RECLAMAR',
                      message: res?.error || 'No se pudieron reclamar las recompensas.',
                      icon: '⚠️',
                    })
                  }
                }}
              />
            </div>
          </div>
        )}

        {screen === 'clan' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${background})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              padding: '10px 16px',
              boxSizing: 'border-box',
            }}
          >
            <Clan
              userElo={userElo}
              userTokens={userTokens}
              hasVipPass={hasVipPass}
              plantCopies={plantCopies}
              onDeductTokens={deductUserTokens}
              onAddTokens={addUserTokens}
              onDonatePlant={donatePlantCopy}
              onAddPacks={addPacksToInventory}
              onBackToMenu={() => setScreen('menu')}
              onRefreshUserData={refreshFromServer}
            />
          </div>
        )}

        {screen === 'market' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${background})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              padding: '10px 16px',
              boxSizing: 'border-box',
            }}
          >
            <Marketplace
              userTokens={userTokens}
              userElo={userElo}
              hasVipPass={hasVipPass}
              plantCopies={plantCopies}
              plantLevels={plantLevels}
              plantStatRolls={plantStatRolls}
              plantInstances={plantInstances}
              farmingItems={farmingItems}
              unlockedPlants={unlockedPlants}
              activeDeck={activeDeck}
              activeDeckInstances={activeDeckInstances}
              onDeductTokens={deductUserTokens}
              onDonatePlant={donatePlantCopy}
              onReceivePlant={receivePlantInstance}
              onRemovePlantInstance={removePlantInstance}
              onUpdateDeck={updateActiveDeck}
              onBuyVipPass={buyVipPass}
              // El mercado ya no mueve el inventario en el navegador: lo hace el
              // servidor. Esto recarga saldo y cartas tras comprar, publicar o
              // retirar una oferta.
              onServerChange={() => void refreshFromServer()}
              onBackToMenu={() => setScreen('menu')}
            />
          </div>
        )}

        {/* Global Pack Opening Reveal Modal */}
        {activeOpeningResult && (
          <PackOpeningModal
            result={activeOpeningResult}
            onClose={() => {
              setActiveOpeningResult(null)
              setScreen('jardin')
            }}
            onOpenAnother={handleOpenAnotherPack}
            hasMorePacks={hasMorePacksOfSameType}
          />
        )}

        {/* PvP victory pack: 3 server-authoritative drops revealed one by one. */}
        {activePvpRewardDrops && (
<PvpRewardOpeningModal
  drops={activePvpRewardDrops}
  onClose={() => {
    setActivePvpRewardDrops(null)
    setScreen('jardin')
  }}
/>
        )}

        {/* POP-UP INVITACIÓN DE CLAN EN EL LOBBY */}
        {screen === 'menu' && activeClanInvitation && (
          <div className="main-menu-dialog-backdrop">
            <div className="clan-invitation-dialog-card" onClick={(e) => e.stopPropagation()}>
              <div className="clan-invitation-dialog-header">
                <span className="clan-invitation-dialog-badge">{activeClanInvitation.clanBadge}</span>
                <div className="clan-invitation-dialog-titles">
                  <span className="clan-invitation-dialog-tag">{activeClanInvitation.clanTag}</span>
                  <h3 className="clan-invitation-dialog-title">{activeClanInvitation.clanName}</h3>
                </div>
              </div>

              <div className="clan-invitation-dialog-body">
                <div className="clan-invitation-dialog-leader-box">
                  <span className="clan-invitation-crown">👑</span>
                  <span>El Líder <strong>{activeClanInvitation.leaderName}</strong> te ha invitado a unirte a su Clan.</span>
                </div>
                {activeClanInvitation.clanDescription && (
                  <p className="clan-invitation-dialog-desc">«{activeClanInvitation.clanDescription}»</p>
                )}
                <div className="clan-invitation-dialog-cost-box">
                  <div className="clan-invitation-cost-row">
                    <span>Cuota de entrada al Tesoro:</span>
                    <strong className="clan-invitation-cost-gems">200 Gemas 💎</strong>
                  </div>
                  <div className="clan-invitation-cost-row clan-invitation-cost-row--sub">
                    <span>Tu saldo disponible:</span>
                    <span className={userTokens < 200 ? 'clan-invitation-gems--low' : ''}>
                      {Math.floor(userTokens)} Gemas 💎 {userTokens < 200 ? '(Insuficiente)' : '✓'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="clan-invitation-dialog-actions">
                <button
                  type="button"
                  className="clan-invitation-btn clan-invitation-btn--accept"
                  onClick={() => handleRespondClanInvitation(true)}
                  disabled={isProcessingClanInvitation}
                >
                  {isProcessingClanInvitation ? 'UNIENDO...' : '✓ UNIRSE AL CLAN (200 💎)'}
                </button>
                <button
                  type="button"
                  className="clan-invitation-btn clan-invitation-btn--reject"
                  onClick={() => handleRespondClanInvitation(false)}
                  disabled={isProcessingClanInvitation}
                >
                  ✕ RECHAZAR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global Themed Modal Alert */}
        {activeAppAlert && (
          <div className="main-menu-dialog-backdrop" onClick={() => setActiveAppAlert(null)}>
            <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
              <div className="main-menu-dialog-header">
                <div className="main-menu-dialog-icon">{activeAppAlert.icon}</div>
                <h3 className="main-menu-dialog-title">{activeAppAlert.title}</h3>
                <button
                  type="button"
                  className="main-menu-dialog-close"
                  onClick={() => setActiveAppAlert(null)}
                >
                  ✕
                </button>
              </div>
              <p className="main-menu-dialog-msg">{activeAppAlert.message}</p>
              <div className="main-menu-dialog-actions">
                {activeAppAlert.actionLabel && activeAppAlert.onAction ? (
                  <>
                    <button
                      type="button"
                      className="main-menu-dialog-btn"
                      onClick={() => {
                        const cb = activeAppAlert.onAction
                        setActiveAppAlert(null)
                        cb?.()
                      }}
                      style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff' }}
                    >
                      {activeAppAlert.actionLabel}
                    </button>
                    <button
                      type="button"
                      className="main-menu-dialog-btn"
                      onClick={() => setActiveAppAlert(null)}
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    >
                      CERRAR
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="main-menu-dialog-btn"
                    onClick={() => setActiveAppAlert(null)}
                  >
                    ENTENDIDO
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Supabase Auth Modal */}
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          userEmail={user?.email}
          needsPasswordSetup={needsPasswordSetup}
          onSignInGoogle={signInWithGoogle}
          onSignInEmail={signInWithEmail}
          onSetUserPassword={setUserPassword}
        />

        {/* Central Admin Dashboard Panel (Supabase Database Controller) */}
        <AdminPanel
          isOpen={isAdminPanelOpen}
          onClose={() => setIsAdminPanelOpen(false)}
        />

        {/* Strategic Playtest Launcher Modal (HARD AI Evaluation Protocol) */}
        <StrategicPlaytestLauncherModal
          isOpen={isStrategicPlaytestModalOpen}
          onClose={() => setIsStrategicPlaytestModalOpen(false)}
          onStartPlaytest={handleStartStrategicPlaytest}
        />

        {/* Beta Phase Welcome Modal (Season 1 - 45 Days) */}
        <BetaPhaseModal
          isOpen={isBetaPhaseModalOpen}
          onClose={() => setIsBetaPhaseModalOpen(false)}
          onPlayNow={handlePlayNormal}
        />
      </GameFrame>
      <RotateOverlay />
    </>
  )
}

export default App
