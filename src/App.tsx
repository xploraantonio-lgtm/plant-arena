import { useState, useEffect } from 'react'
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
import { useInventory } from './hooks/useInventory'
import type { PackDropResult, PackId } from './utils/packDropManager'
import background from './assets/images/background.png'
import { soundManager } from './utils/audioManager'

import { getEloDeltasForElo } from './utils/arenaManager'
import MatchmakingScreen from './components/Matchmaking/MatchmakingScreen'
import MisPartidas from './components/Repeticiones/MisPartidas'
import VerRepeticion from './components/Repeticiones/VerRepeticion'
import { useMatchmaking, buscaRival, type ModoPartida } from './hooks/useMatchmaking'
import { SupabaseService } from './services/supabaseService'
import { useAuth } from './hooks/useAuth'
import AuthModal from './components/Auth/AuthModal'
import AdminPanel from './components/Admin/AdminPanel'

import { UserManager } from './utils/userManager'
import { useVersionDelJuego } from './hooks/useVersionDelJuego'

function App() {
  const [screen, setScreen] = useState<'landing' | 'menu' | 'searching' | 'battle' | 'partidas' | 'repeticion' | 'collection' | 'jardin' | 'shop' | 'ranking' | 'pass' | 'clan' | 'market'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase()
      const hash = window.location.hash.toLowerCase()
      // Un enlace de repetición compartida, /r/<código>. Va primero porque quien
      // lo abre puede no tener cuenta y no debe acabar en la pantalla de entrada:
      // el sentido de compartir es que se pueda ver sin registrarse.
      if (path.startsWith('/r/')) return 'repeticion'
      if (path.startsWith('/play') || hash.includes('play')) {
        return 'menu'
      }
    }
    return 'landing'
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
  const [lastOpenedPackType, setLastOpenedPackType] = useState<PackId | null>(null)
  const [activeAppAlert, setActiveAppAlert] = useState<{ title: string; message: string; icon: string } | null>(null)

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
  const { nueva: hayVersionNueva, recargar: recargarVersion } = useVersionDelJuego(
    screen === 'battle'
  )

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
      const path = window.location.pathname.toLowerCase()
      const hash = window.location.hash.toLowerCase()
      if (path.startsWith('/play') || hash.includes('play')) {
        setScreen((prev) => (prev === 'landing' ? 'menu' : prev))
      } else {
        setScreen('landing')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const {
    syncProfileData,
    refreshFromServer,
    userTokens,
    userGold,
    addGold,
    buyGoldPackage,
    inventoryPacks,
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
    fuseAndUpgradePlant,
    buyVipPass,
    claimPassReward,
    awardVictoryPack,
    startUnlockingSlot,
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
        sessionStorage.setItem('pa_ref', codigo)
      } catch {}
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    let codigo: string | null = null
    try {
      codigo = sessionStorage.getItem('pa_ref')
    } catch {}
    if (!codigo) return

    // Se quita antes de llamar: si la llamada falla no se reintenta en bucle, y
    // si el código no valía tampoco tiene sentido guardarlo.
    try {
      sessionStorage.removeItem('pa_ref')
    } catch {}
    void SupabaseService.referralBind(codigo)
  }, [profile])

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false)
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState<boolean>(false)

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

  const [battleMatchMode, setBattleMatchMode] = useState<'ranked' | 'colosseum' | 'tournament'>('ranked')
  const [colosseumConfig, setColosseumConfig] = useState<import('./types/game').ColosseumMatchConfig | null>(null)
  const [tournamentOpponent, setTournamentOpponent] = useState<{ name: string; tournamentId: string } | null>(null)

  // ── EMPAREJAMIENTO ────────────────────────────────────────────────────────
  // La sala la crea el servidor (migración 17) y trae la semilla, que es lo que
  // hace que los dos jugadores simulen exactamente la misma partida. Si roomId es
  // null, la partida es contra el bot local y no cuenta para el servidor.
  const { estado: estadoCola, encontrada, buscar, cancelar } = useMatchmaking()
  const [modoBuscando, setModoBuscando] = useState<ModoPartida>('ranked')
  const [salaId, setSalaId] = useState<string | null>(null)
  const [semillaPartida, setSemillaPartida] = useState<number | undefined>(undefined)
  const [rivalId, setRivalId] = useState<string | null>(null)
  /** La partida cuya repetición se está viendo. */
  const [salaRepeticion, setSalaRepeticion] = useState<string | null>(null)
  /** Los nicks de los dos, para ponerlos encima de cada árbol en la batalla. */
  const [nombresEnPartida, setNombresEnPartida] = useState<{ mio: string; rival: string } | null>(null)

  /**
   * Cuando el servidor empareja, se leen la semilla y los jugadores de la sala y
   * se entra a la batalla. La semilla NO la elige el cliente.
   */
  useEffect(() => {
    if (!encontrada) return
    let cancelado = false
    ;(async () => {
      // gameRoomInfo trae además los nicks de los dos, para poder poner
      // "Xplora" y "Leonel" en la batalla en lugar de "ÁRBOL MADRE".
      //
      // Si esa función no existe todavía en la base (código desplegado antes que
      // la migración, que ya pasó una vez), se cae a getGameRoom: la partida
      // arranca igual, sólo sin nombres. Antes esto devolvía al menú, así que un
      // desfase de despliegue impedía jugar en absoluto — y eso es peor que
      // jugar sin nicks.
      const info = await SupabaseService.gameRoomInfo(encontrada.roomId)
      if (cancelado) return

      const sala = info ?? (await (async () => {
        const basica = await SupabaseService.getGameRoom(encontrada.roomId)
        if (!basica) return null
        return {
          id: basica.id,
          mode: basica.mode,
          seed: basica.seed,
          iAm: (basica.player1_id === user?.id ? 'p1' : 'p2') as 'p1' | 'p2',
          player1: { id: basica.player1_id, username: null },
          player2: { id: basica.player2_id, username: null },
        }
      })())
      if (cancelado) return
      if (!sala) {
        // Sin sala no se puede jugar la partida real: se vuelve al menú en lugar
        // de arrancar una partida con semilla inventada, que sería otra partida.
        setScreen('menu')
        return
      }
      setSalaId(sala.id)
      setSemillaPartida(Number(sala.seed))
      const soyP1 = sala.iAm === 'p1'
      setSoyJugador1(soyP1)
      setRivalId(soyP1 ? sala.player2.id : sala.player1.id)
      const miNick = soyP1 ? sala.player1.username : sala.player2.username
      const suNick = soyP1 ? sala.player2.username : sala.player1.username
      // Sin nombres (el respaldo de arriba) se dejan las etiquetas de siempre en
      // lugar de inventarse un "Tú" y un "Rival" que no dicen nada.
      setNombresEnPartida(
        miNick && suNick ? { mio: miNick, rival: suNick } : null
      )
      setBattleMatchMode(sala.mode === 'friendly' ? 'ranked' : (sala.mode as 'ranked' | 'colosseum' | 'tournament'))
      setPracticePlantId(null)
      setScreen('battle')
    })()
    return () => { cancelado = true }
  }, [encontrada, user?.id])

  /** Cancelar la búsqueda y volver al menú. */
  const salirDeLaCola = async () => {
    await cancelar()
    setScreen('menu')
  }

  /**
   * Ranked sin nadie al otro lado: se juega contra el bot local, que es lo que el
   * ranked hace hoy. Sin sala, así que el servidor no interviene — ni ELO real ni
   * reporte. Cuando existan las repeticiones, esto se sustituye por un fantasma.
   */
  const jugarContraRelleno = async () => {
    await cancelar()
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setBattleMatchMode('ranked')
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setScreen('battle')
  }

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
    setBattleMatchMode('ranked')   // el campo se pinta igual; el modo real es del servidor
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    setModoBuscando('friendly')
    setScreen('searching')
    void buscar('friendly', { roomCode, betGems })
  }

  const handlePlayNormal = () => {
    setBattleMatchMode('ranked')
    setColosseumConfig(null)
    setTournamentOpponent(null)
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setSalaId(null)
    setSemillaPartida(undefined)
    setRivalId(null)
    setNombresEnPartida(null)
    if (!buscaRival('ranked')) {
      setScreen('battle')
      return
    }
    setModoBuscando('ranked')
    setScreen('searching')
    void buscar('ranked')
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

  const handleStartTournamentMatch = (opponentName: string, tournamentId: string) => {
    setBattleMatchMode('tournament')
    setColosseumConfig(null)
    setTournamentOpponent({ name: opponentName, tournamentId })
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setScreen('battle')
  }

  const handleOpenCollection = () => {
    setScreen('collection')
  }

  const handleOpenJardin = () => {
    setScreen('jardin')
  }

  const handleOpenShop = () => {
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
    const drop = await openSlotPack(slotId)
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
  const handleBattleComplete = (isVictory: boolean) => {
    const deltas = getEloDeltasForElo(userElo)
    if (isVictory) {
      const newElo = userElo + deltas.winElo
      setUserElo(newElo)
      const packResult = awardVictoryPack(newElo)
      return { winElo: deltas.winElo, newElo, packResult }
    } else {
      const newElo = Math.max(0, userElo - deltas.loseElo)
      setUserElo(newElo)
      return { loseElo: deltas.loseElo, newElo }
    }
  }

  const handleSurrender = () => {
    const deltas = getEloDeltasForElo(userElo)
    const newElo = Math.max(0, userElo - deltas.surrenderElo)
    setUserElo(newElo)
    return { surrenderElo: deltas.surrenderElo, newElo }
  }

  const hasMorePacksOfSameType = lastOpenedPackType
    ? inventoryPacks.some((p) => p.packId === lastOpenedPackType)
    : false

  if (screen === 'landing') {
    return (
      <>
        {/* El mismo aviso que en el juego: la pantalla de entrada tiene su propio
            `return`, así que si no se pone aquí también, quien esté aquí ve
            recargarse la página sin explicación. */}
        {hayVersionNueva && (
          <div className="aviso-version" role="status">
            <span>🔄 Hay una versión nueva del juego.</span>
            <button type="button" onClick={recargarVersion}>Actualizar ahora</button>
          </div>
        )}
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
      {/* AVISO DE VERSIÓN NUEVA
          Se recarga solo en cuanto el jugador esté fuera de la batalla; el cartel
          es para que no parezca que el navegador se ha vuelto loco. Durante la
          batalla se queda ahí sin recargar: sacar a alguien de su propia partida
          —y en un amistoso con apuesta, de sus gemas— sería peor que dejarle
          acabarla. */}
      {hayVersionNueva && (
        <div className="aviso-version" role="status">
          <span>🔄 Hay una versión nueva del juego.</span>
          <button type="button" onClick={recargarVersion}>Actualizar ahora</button>
        </div>
      )}

      <GameFrame>
        {screen === 'menu' && (
          <MainMenu
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
            isAdmin={isAdmin}
            onSignOut={async () => {
              await signOut()
              setScreen('landing')
            }}
            onStartSlotUnlock={startUnlockingSlot}
            onOpenSlotPack={handleOpenSlotPack}
            onDeductTokens={deductUserTokens}
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
            /* El relleno sólo en ranked: en coliseo no hay bots, es la regla. */
            onJugarRelleno={
              modoBuscando === 'ranked' ? () => { void jugarContraRelleno() } : undefined
            }
          />
        )}
        {screen === 'battle' && (
          <Battlefield
            onBackToMenu={() => setScreen('menu')}
            onBackToCollection={() => setScreen('collection')}
            onBattleComplete={handleBattleComplete}
            onSurrender={handleSurrender}
            practicePlantId={practicePlantId}
            activeDeck={activeDeck}
            userElo={userElo}
            customBgImage={customArenaBg}
            matchMode={battleMatchMode}
            colosseumConfig={colosseumConfig}
            tournamentOpponent={tournamentOpponent}
            /* Con sala, la partida es real: misma semilla para los dos y el
               resultado lo liquida el servidor. Sin sala es contra el bot local. */
            roomId={salaId}
            seed={semillaPartida}
            opponentId={rivalId}
            nombres={nombresEnPartida}
            soyP1={soyJugador1}
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
            userTokens={userTokens}
            userGold={userGold}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
            onUpdateDeck={updateActiveDeck}
            onBack={() => setScreen('menu')}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenShop={handleOpenShop}
            onOpenPack={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onFusePlant={fuseAndUpgradePlant}
            onRewardsChanged={refreshFromServer}
          />
        )}
        {screen === 'shop' && (
          <Shop
            userTokens={userTokens}
            userGold={userGold}
            hasVipPass={hasVipPass}
            inventoryPacks={inventoryPacks}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
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
                onBuyVipPass={async () => {
                  const { success: ok, error } = await buyVipPass()
                  if (!ok && error) {
                    setActiveAppAlert({
                      title: 'NO SE PUDO ACTIVAR',
                      message: error,
                      icon: '⚠️',
                    })
                  }
                  if (ok) {
                    setActiveAppAlert({
                      title: '¡PASE VIP ACTIVADO!',
                      message: '👑 ¡PASE VIP DE TEMPORADA ACTIVADO!\nAhora puedes reclamar todas las recompensas doradas.',
                      icon: '👑',
                    })
                  } else {
                    setActiveAppAlert({
                      title: 'SALDO INSUFICIENTE',
                      message: '⚠️ Saldo insuficiente ($10.00 USD requeridos).\nRecarga saldo en la Tienda.',
                      icon: '⚠️',
                    })
                  }
                }}
                onClaimReward={(lvl) => {
                  claimPassReward(lvl.reward, lvl.level)
                  setActiveAppAlert({
                    title: '¡RECOMPENSA RECLAMADA!',
                    message: `👑 ¡RECOMPENSA VIP DEL NIVEL ${lvl.level} RECLAMADA!\n${lvl.reward.label}\nSe ha añadido a tu inventario de Mi Jardín.`,
                    icon: '🎉',
                  })
                }}
                onClaimAllRewards={(levels) => {
                  levels.forEach((lvl) => claimPassReward(lvl.reward, lvl.level))
                  setActiveAppAlert({
                    title: '¡RECOMPENSAS RECLAMADAS!',
                    message: `👑 ¡${levels.length} RECOMPENSAS VIP RECLAMADAS CON ÉXITO!\nSe han guardado en tu inventario de Mi Jardín.`,
                    icon: '🎁',
                  })
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
              hasVipPass={hasVipPass}
              plantCopies={plantCopies}
              plantLevels={plantLevels}
              plantStatRolls={plantStatRolls}
              plantInstances={plantInstances}
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

        {/* Global Themed Modal Alert */}
        {activeAppAlert && (
          <div className="main-menu-dialog-backdrop" onClick={() => setActiveAppAlert(null)}>
            <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
              <div className="main-menu-dialog-icon">{activeAppAlert.icon}</div>
              <h3 className="main-menu-dialog-title">{activeAppAlert.title}</h3>
              <p className="main-menu-dialog-msg">{activeAppAlert.message}</p>
              <button
                type="button"
                className="main-menu-dialog-btn"
                onClick={() => setActiveAppAlert(null)}
              >
                ENTENDIDO
              </button>
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
      </GameFrame>
      <RotateOverlay />
    </>
  )
}

export default App
