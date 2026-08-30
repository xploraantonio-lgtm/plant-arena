import { useState, useEffect } from 'react'
import background from '../../assets/images/background.png'
import logo from '../../assets/images/logo.png'
import plant1 from '../../assets/images/plant1.png'
import plant2 from '../../assets/images/plant2.png'
import play from '../../assets/images/play.png'
import jardin from '../../assets/images/jardin.png'
import coleccion from '../../assets/images/coleccion.png'
import arena from '../../assets/images/Arena.png'
import shop from '../../assets/images/shop.png'
import gema from '../../assets/ico/gema.png'
import moneda from '../../assets/ico/moneda.png'
import ranking from '../../assets/ico/Ranking.png'
import clan from '../../assets/ico/clan.png'
import ajustes from '../../assets/ico/ajustes.png'
import { soundManager } from '../../utils/audioManager'
import {
  getRemainingTimeString,
  calculateInstantUnlockGoldCost,
  type FreePackSlot,
} from '../../utils/freePackManager'
import { toggleFullscreen } from '../../utils/fullscreen'
import { BATTLE_PASS_LEVELS } from '../../utils/battlePassManager'
import { SeasonManager } from '../../utils/seasonManager'
import { UserManager, type PlayerProfile } from '../../utils/userManager'
import ProfileModal from '../ProfileModal/ProfileModal'
import ModeSelectorModal from '../ModeSelector/ModeSelectorModal'
import ColosseumModal from '../Colosseum/ColosseumModal'
import TournamentModal from '../Tournament/TournamentModal'
import type { ColosseumBetAmount, PlantId } from '../../types/game'
import './MainMenu.css'

interface MainMenuProps {
  userProfile?: {
    username?: string
    avatar_id?: string
    elo_rating?: number
    gems_balance?: number
    gold_balance?: number
  } | null
  userElo?: number
  userTokens?: number
  userGold?: number
  hasVipPass?: boolean
  unlockedPlants?: PlantId[]
  claimedVipLevels?: number[]
  freePackSlots?: FreePackSlot[]
  colosseumTickets?: number
  colosseumCurrentStreak?: number
  colosseumMaxStreak?: number
  onPlay: () => void
  /** Duelo amistoso: código de sala privada y apuesta opcional. */
  onPlayFriendly?: (roomCode: string, betGems: number) => void
  onStartColosseumMatch?: (betGems: ColosseumBetAmount, usedTicket: boolean) => void
  onStartTournamentMatch?: (opponentName: string, tournamentId: string) => void
  onOpenCollection?: () => void
  onOpenJardin?: () => void
  onOpenShop?: () => void
  onOpenRanking?: () => void
  onOpenMisPartidas?: () => void
  onOpenBattlePass?: () => void
  onOpenClan?: () => void
  onOpenMarketplace?: () => void
  onOpenLanding?: () => void
  onOpenAdmin?: () => void
  onOpenStrategicPlaytest?: () => void
  onOpenBetaInfo?: () => void
  isAdmin?: boolean
  onSignOut?: () => void
  onStartSlotUnlock?: (slotId: number) => { success: boolean; error?: string }
  onFastUnlockSlot?: (slotId: number) => Promise<{ success: boolean; goldSpent?: number; error?: string }>
  onOpenSlotPack?: (slotId: number) => void
  // onAddTokens se eliminó al dejar el formulario de recarga como maqueta:
  // era la vía por la que ProfileModal se sumaba saldo sin cobrar nada.
  onDeductTokens?: (amountUsd: number) => boolean
}

export default function MainMenu({
  userProfile,
  userElo = 1000,
  userTokens = 0,
  userGold = 0,
  hasVipPass = false,
  unlockedPlants,
  claimedVipLevels = [],
  freePackSlots = [],
  colosseumTickets = 0,
  colosseumCurrentStreak = 0,
  colosseumMaxStreak = 0,
  onPlay,
  onPlayFriendly,
  onStartColosseumMatch,
  onStartTournamentMatch,
  onOpenCollection,
  onOpenJardin,
  onOpenShop,
  onOpenRanking,
  onOpenMisPartidas,
  onOpenBattlePass,
  onOpenClan,
  onOpenLanding,
  onOpenAdmin,
  onOpenStrategicPlaytest,
  onOpenBetaInfo,
  isAdmin = false,
  onSignOut,
  onStartSlotUnlock,
  onFastUnlockSlot,
  onOpenSlotPack,
  onDeductTokens,
}: MainMenuProps) {
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(() => UserManager.getProfile())
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isModeSelectorOpen, setIsModeSelectorOpen] = useState(false)
  const [isColosseumModalOpen, setIsColosseumModalOpen] = useState(false)
  const [isTournamentModalOpen, setIsTournamentModalOpen] = useState(false)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [, setTicker] = useState<number>(0)
  const [activeAlert, setActiveAlert] = useState<{ title: string; message: string; icon: string } | null>(null)
  const [slotToAccelerate, setSlotToAccelerate] = useState<FreePackSlot | null>(null)
  const [isAccelerating, setIsAccelerating] = useState<boolean>(false)

  const handleConfirmAccelerate = async () => {
    if (!slotToAccelerate || !onFastUnlockSlot || isAccelerating) return
    setIsAccelerating(true)
    try {
      const res = await onFastUnlockSlot(slotToAccelerate.slotId)
      setSlotToAccelerate(null)
      if (!res.success) {
        setActiveAlert({
          title: 'ORO INSUFICIENTE',
          message: res.error || 'No se pudo acelerar el sobre',
          icon: '⚠️',
        })
      } else {
        soundManager.playSound('victory', 0.8)
      }
    } catch (err: any) {
      setSlotToAccelerate(null)
      setActiveAlert({
        title: 'ERROR AL ACELERAR',
        message: err?.message || 'Error inesperado al acelerar el sobre',
        icon: '⚠️',
      })
    } finally {
      setIsAccelerating(false)
    }
  }

  const handlePlayClick = () => {
    soundManager.playSound('click', 0.5)
    setIsModeSelectorOpen(true)
  }

  useEffect(() => {
    const syncProfile = () => setPlayerProfile(UserManager.getProfile())
    window.addEventListener('player_profile_updated', syncProfile)
    return () => window.removeEventListener('player_profile_updated', syncProfile)
  }, [])

  const highestLevelReached = BATTLE_PASS_LEVELS.filter((l) => userElo >= l.requiredElo).length
  const claimableCount = hasVipPass
    ? BATTLE_PASS_LEVELS.filter(
        (l) => userElo >= l.requiredElo && !claimedVipLevels.includes(l.level)
      ).length
    : 0

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  // Force tick every second to animate countdown timers
  useEffect(() => {
    const interval = setInterval(() => {
      setTicker((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="main-menu"
      style={{ backgroundImage: `url(${background})` }}
    >
      <div className="topbar">
        <div className="topbar__left">
          <div className="topbar__player-col">
            <div
              className={`card card--player ${hasVipPass ? 'card--player-vip' : ''}`}
              onClick={() => {
                soundManager.playSound('click', 0.5)
                setIsProfileModalOpen(true)
              }}
              title="Ver y editar perfil, depositar, retirar y referidos"
              style={{ cursor: 'pointer' }}
            >
              <div className={`card__player-avatar-circle ${hasVipPass ? 'card__player-avatar-circle--vip' : ''}`}>
                <img
                  src={playerProfile.avatar}
                  alt={userProfile?.username || playerProfile.name}
                  onError={(e) => {
                    e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                  }}
                />
              </div>
              <span className={`card__title ${hasVipPass ? 'card__title--vip-gold' : ''}`}>
                {hasVipPass && <span className="nick-vip-crown">👑 </span>}
                {userProfile?.username || playerProfile.name}
              </span>
            </div>

            <div className="profile-sub-row">
              <span className="badge-beta-test">🧪 Beta Test</span>
              <a
                href="https://t.me/+HY1gbZZKmAE5ZDcx"
                target="_blank"
                rel="noreferrer"
                className="btn-telegram-link"
                title="Canal Oficial de Telegram"
                onClick={(e) => e.stopPropagation()}
              >
                <svg className="telegram-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
                </svg>
                Telegram
              </a>
            </div>
          </div>

          {/* COMPACT VIP BATTLE PASS WIDGET - ONLY VISIBLE IF HAS VIP PASS */}
          {hasVipPass && (
            <div
              className="card card--pass-widget card--pass-widget-active"
              onClick={onOpenBattlePass}
              title="Ver Pase de Batalla VIP"
            >
              <span className="pass-widget__crown">👑</span>
              <div className="pass-widget__info">
                <span className="pass-widget__title">PASE VIP</span>
                <span className="pass-widget__level-txt">
                  NIVEL {highestLevelReached}/20
                </span>
                <div className="pass-widget__progress-wrap">
                  <div
                    className="pass-widget__progress-bar"
                    style={{ width: `${Math.min(100, (highestLevelReached / 20) * 100)}%` }}
                  />
                </div>
              </div>

              {claimableCount > 0 && (
                <span className="pass-widget__claim-badge">
                  ✨ {claimableCount}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="topbar__right-wrap">
          <div className="topbar__right">
            <div className="card card--stat card--stat-gold" title="Monedas de Oro">
              <img className="card__icon" src={moneda} alt="Monedas" />
              {userGold.toLocaleString()}
            </div>
            <div
              className="card card--stat"
              title="Gemas Disponibles (Clic para Depositar / Retirar USDT BEP20)"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                soundManager.playSound('click', 0.5)
                setIsProfileModalOpen(true)
              }}
            >
              <img className="card__icon" src={gema} alt="Gemas" />
              {userTokens.toLocaleString()}
            </div>
            <div className="card card--stat card--stat-ticket" title="Tickets de Coliseo (1 Ticket = 0.5 💎 de entrada)">
              <span style={{ fontSize: '1.05rem' }}>🎟️</span>
              {colosseumTickets}
            </div>
            <div
              className="card card--stat"
              style={{ cursor: 'pointer' }}
              onClick={onOpenRanking}
              title="Ver Camino de Arenas y Ranking Global"
            >
              <img className="card__icon" src={ranking} alt="" />
              {userElo} 🏆
            </div>
          </div>

          {/* 30-DAY SEASON TIMER ROW WITH FULLSCREEN & MUTE BUTTONS BESIDE IT */}
          <div className="season-timer-row">
            {isAdmin && (
              <button
                type="button"
                className="main-menu-admin-btn"
                onClick={onOpenAdmin}
                title="Abrir Panel de Administrador (Supabase)"
              >
                🛡️ Admin
              </button>
            )}
            <div
              className="season-countdown-badge"
              onClick={onOpenBetaInfo}
              style={{ cursor: onOpenBetaInfo ? 'pointer' : 'default' }}
              title="🏆 Fase Beta Oficial - Temporada 1 (45 Días) - Clic para más información"
            >
              <span className="season-badge-icon">⏳</span>
              <span className="season-badge-text">
                TEMPORADA 1: <strong>{SeasonManager.getSeasonStatus().formattedCountdown}</strong>
              </span>
            </div>
            <button
              className="fullscreen-button"
              type="button"
              onClick={toggleFullscreen}
              title="Pantalla Completa (Ocultar navegador)"
            >
              ⛶
            </button>
            <button
              className="mute-button"
              type="button"
              onClick={() => soundManager.toggleMute()}
              aria-label={isMuted ? 'Activar música' : 'Silenciar música'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            {onSignOut && (
              <button
                className="main-menu-logout-btn"
                type="button"
                onClick={onSignOut}
                title="Cerrar Sesión (Salir de la cuenta)"
                aria-label="Cerrar Sesión"
              >
                🚪
              </button>
            )}
          </div>
        </div>
      </div>

      <img
        className="logo"
        src={logo}
        alt="Plant Arena"
        onClick={onOpenLanding}
        style={{ cursor: onOpenLanding ? 'pointer' : 'default' }}
        title="Volver a la portada / Landing Page"
      />

      <img className="plant plant--left" src={plant1} alt="" />
      <img className="plant plant--right" src={plant2} alt="" />

      <button
        className="play-button"
        type="button"
        onClick={handlePlayClick}
        title="Seleccionar Modo: Ranked, Amistoso, Torneos o Coliseo"
      >
        <img className="play-button__art" src={play} alt="" />
        <span className="play-button__label">PLAY</span>
        {userElo >= 1601 && (
          <span style={{
            position: 'absolute',
            bottom: '-18px',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#000',
            fontWeight: 800,
            fontSize: '0.65rem',
            padding: '2px 8px',
            borderRadius: '999px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            border: '1px solid #fde047',
            whiteSpace: 'nowrap'
          }}>
            🏛️ COLISEO DISPONIBLE
          </span>
        )}
      </button>

      {/* 4 FREE BATTLE PACK SLOTS (CLASH ROYALE STYLE) */}
      <div className="main-menu-chest-slots">
        {freePackSlots.map((slot) => {
          const remainingText = getRemainingTimeString(slot)
          return (
            <div
              key={slot.slotId}
              className={`chest-slot chest-slot--${slot.status}`}
              onClick={() => {
                if (slot.status === 'locked' && onStartSlotUnlock) {
                  const res = onStartSlotUnlock(slot.slotId)
                  if (!res.success && res.error) {
                    setActiveAlert({ title: 'SLOT OCUPADO', message: res.error, icon: '⏳' })
                  } else {
                    soundManager.playSound('click', 0.5)
                  }
                } else if (slot.status === 'unlocking') {
                  if (onFastUnlockSlot) {
                    soundManager.playSound('click', 0.5)
                    setSlotToAccelerate(slot)
                  }
                } else if (slot.status === 'ready' && onOpenSlotPack) {
                  onOpenSlotPack(slot.slotId)
                }
              }}
            >
              {slot.status === 'empty' && (
                <div className="chest-slot__empty">
                  <span className="chest-slot__empty-icon">📦</span>
                  <span className="chest-slot__empty-label">SLOT VACÍO</span>
                </div>
              )}

              {slot.status === 'locked' && (
                <div className="chest-slot__content">
                  <span className="chest-slot__arena-tag">ARENA {slot.arenaLevel}</span>
                  <img
                    src="/game-assets/greenfoot/seed_pack_pvp.png"
                    alt="Sobre PvP"
                    className="chest-slot__pack-img"
                  />
                  <span className="chest-slot__timer">⏳ {slot.durationHours}h</span>
                  <span className="chest-slot__btn-hint">DESBLOQUEAR</span>
                </div>
              )}

              {slot.status === 'unlocking' && (
                <div className="chest-slot__content chest-slot__content--unlocking">
                  <span className="chest-slot__arena-tag">DESBLOQUEANDO</span>
                  <img
                    src="/game-assets/greenfoot/seed_pack_pvp.png"
                    alt="Sobre PvP"
                    className="chest-slot__pack-img chest-slot__pack-img--pulsing"
                  />
                  <span className="chest-slot__timer chest-slot__timer--active">
                    ⏱️ {remainingText}
                  </span>
                  <span className="chest-slot__btn-hint chest-slot__btn-hint--unlocking">
                    ⚡ ACELERAR
                  </span>
                </div>
              )}

              {slot.status === 'ready' && (
                <div className="chest-slot__content chest-slot__content--ready">
                  <span className="chest-slot__arena-tag chest-slot__arena-tag--ready">
                    ¡LISTO!
                  </span>
                  <img
                    src="/game-assets/greenfoot/seed_pack_pvp.png"
                    alt="Sobre PvP"
                    className="chest-slot__pack-img chest-slot__pack-img--glowing"
                  />
                  <span className="chest-slot__btn-hint chest-slot__btn-hint--ready">
                    ✨ ABRIR
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="panel panel--left">
        <button className="banner-button" type="button" onClick={onOpenJardin}>
          <img src={jardin} alt="" />
          <span>JARDÍN</span>
        </button>
        <button className="banner-button" type="button" onClick={onOpenCollection}>
          <img src={coleccion} alt="" />
          <span>COLECCIÓN</span>
        </button>
      </div>

      <div className="panel panel--right">
        <button className="banner-button" type="button" onClick={onOpenRanking}>
          <img src={arena} alt="" />
          <span>RANKING</span>
        </button>
        <button className="banner-button" type="button" onClick={onOpenShop}>
          <img src={shop} alt="" />
          <span>TIENDA</span>
        </button>
        {/* Las repeticiones. Sin icono propio todavía: se usa el de arena y se
            distingue por el texto, que es lo que se lee. */}
        <button className="banner-button" type="button" onClick={onOpenMisPartidas}>
          <img src={arena} alt="" />
          <span>MIS PARTIDAS</span>
        </button>
      </div>

      <div className="footer">
        <button className="footer-button footer-button--clan" type="button" onClick={onOpenClan}>
          <div className="footer-button__icon-box">
            <img src={clan} alt="Clan" />
          </div>
          <span className="footer-button__title">CLAN</span>
        </button>

        <button className="footer-button footer-button--settings" type="button">
          <div className="footer-button__icon-box">
            <img src={ajustes} alt="Ajustes" />
          </div>
          <span className="footer-button__title">AJUSTES</span>
        </button>
      </div>

      {/* IN-GAME THEMED MODAL ALERT */}
      {activeAlert && (
        <div className="main-menu-dialog-backdrop" onClick={() => setActiveAlert(null)}>
          <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="main-menu-dialog-icon">{activeAlert.icon}</div>
            <h3 className="main-menu-dialog-title">{activeAlert.title}</h3>
            <p className="main-menu-dialog-msg">{activeAlert.message}</p>
            <button
              type="button"
              className="main-menu-dialog-btn"
              onClick={() => setActiveAlert(null)}
            >
              ENTENDIDO
            </button>
          </div>
        </div>
      )}

      {/* CONFIRMACIÓN ACELERAR SOBRE CON ORO */}
      {slotToAccelerate && (
        <div
          className="main-menu-dialog-backdrop"
          onClick={() => {
            if (!isAccelerating) setSlotToAccelerate(null)
          }}
        >
          <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="main-menu-dialog-icon">⚡</div>
            <h3 className="main-menu-dialog-title">DESBLOQUEAR AL INSTANTE</h3>
            <p className="main-menu-dialog-msg">
              {`¿Deseas desbloquear este sobre al instante por ${calculateInstantUnlockGoldCost(slotToAccelerate)} de Oro?`}
            </p>
            <div className="main-menu-dialog-actions">
              <button
                type="button"
                className="main-menu-dialog-btn main-menu-dialog-btn--cancel"
                disabled={isAccelerating}
                onClick={() => setSlotToAccelerate(null)}
              >
                CANCELAR
              </button>
              <button
                type="button"
                className="main-menu-dialog-btn main-menu-dialog-btn--confirm"
                disabled={isAccelerating}
                onClick={handleConfirmAccelerate}
              >
                {isAccelerating ? 'PROCESANDO...' : 'ACELERAR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLAYER PROFILE MODAL */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        userElo={userElo}
        userTokens={userTokens}
        hasVipPass={hasVipPass}
        unlockedPlants={unlockedPlants}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* MODE SELECTOR MODAL (RANKED VS COLOSSEUM VS TOURNAMENT) */}
      <ModeSelectorModal
        isOpen={isModeSelectorOpen}
        onClose={() => setIsModeSelectorOpen(false)}
        userElo={userElo}
        userTokens={userTokens}
        colosseumTickets={colosseumTickets}
        onSelectRanked={onPlay}
        onSelectColosseum={() => setIsColosseumModalOpen(true)}
        onSelectTournament={() => setIsTournamentModalOpen(true)}
        onSelectFriendly={onPlayFriendly}
        onSelectStrategicPlaytest={onOpenStrategicPlaytest}
      />

      {/* COLOSSEUM MODAL */}
      <ColosseumModal
        isOpen={isColosseumModalOpen}
        onClose={() => setIsColosseumModalOpen(false)}
        userTokens={userTokens}
        userElo={userElo}
        colosseumTickets={colosseumTickets}
        currentStreak={colosseumCurrentStreak}
        maxStreak={colosseumMaxStreak}
        onStartColosseumMatch={(betGems, usedTicket) => {
          if (onStartColosseumMatch) {
            onStartColosseumMatch(betGems, usedTicket)
          }
        }}
        onOpenShop={onOpenShop}
      />

      {/* TOURNAMENT MODAL */}
      <TournamentModal
        isOpen={isTournamentModalOpen}
        onClose={() => setIsTournamentModalOpen(false)}
        userTokens={userTokens}
        onDeductTokens={(amount) => {
          if (onDeductTokens) return onDeductTokens(amount)
          return false
        }}
        onStartTournamentMatch={(oppName, tourneyId) => {
          if (onStartTournamentMatch) {
            onStartTournamentMatch(oppName, tourneyId)
          }
        }}
      />
    </div>
  )
}
