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
import { getRemainingTimeString, type FreePackSlot } from '../../utils/freePackManager'
import { toggleFullscreen } from '../../utils/fullscreen'
import { BATTLE_PASS_LEVELS } from '../../utils/battlePassManager'
import { SeasonManager } from '../../utils/seasonManager'
import { UserManager, type PlayerProfile } from '../../utils/userManager'
import ProfileModal from '../ProfileModal/ProfileModal'
import './MainMenu.css'

interface MainMenuProps {
  userElo?: number
  userTokens?: number
  hasVipPass?: boolean
  claimedVipLevels?: number[]
  freePackSlots?: FreePackSlot[]
  onPlay: () => void
  onOpenCollection?: () => void
  onOpenJardin?: () => void
  onOpenShop?: () => void
  onOpenRanking?: () => void
  onOpenBattlePass?: () => void
  onOpenClan?: () => void
  onOpenMarketplace?: () => void
  onOpenLanding?: () => void
  onStartSlotUnlock?: (slotId: number) => { success: boolean; error?: string }
  onFastUnlockSlot?: (slotId: number) => void
  onOpenSlotPack?: (slotId: number) => void
  onAddTokens?: (amountUsd: number) => void
  onDeductTokens?: (amountUsd: number) => boolean
}

export default function MainMenu({
  userElo = 1000,
  userTokens = 10,
  hasVipPass = false,
  claimedVipLevels = [],
  freePackSlots = [],
  onPlay,
  onOpenCollection,
  onOpenJardin,
  onOpenShop,
  onOpenRanking,
  onOpenBattlePass,
  onOpenClan,
  onOpenLanding,
  onStartSlotUnlock,
  onFastUnlockSlot,
  onOpenSlotPack,
  onAddTokens,
  onDeductTokens,
}: MainMenuProps) {
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(() => UserManager.getProfile())
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [, setTicker] = useState<number>(0)
  const [activeAlert, setActiveAlert] = useState<{ title: string; message: string; icon: string } | null>(null)

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
          <div
            className="card card--player"
            onClick={() => {
              soundManager.playSound('click', 0.5)
              setIsProfileModalOpen(true)
            }}
            title="Ver y editar perfil, depositar, retirar y referidos"
            style={{ cursor: 'pointer' }}
          >
            <div className="card__player-avatar-circle">
              <img
                src={playerProfile.avatar}
                alt={playerProfile.name}
                onError={(e) => {
                  e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                }}
              />
            </div>
            <span className="card__title">{playerProfile.name}</span>
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
              50,000
            </div>
            <div className="card card--stat" title="Gemas Disponibles">
              <img className="card__icon" src={gema} alt="Gemas" />
              1,250
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
            <div className="season-countdown-badge">
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

      <button className="play-button" type="button" onClick={onPlay}>
        <img className="play-button__art" src={play} alt="" />
        <span className="play-button__label">PLAY</span>
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
                  // If clicking on unlocking slot, fast-unlock for demo
                  if (onFastUnlockSlot) {
                    onFastUnlockSlot(slot.slotId)
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
                    src="/game-assets/greenfoot/seed_pack_common_whitebg.png"
                    alt="Sobre Gratis"
                    className="chest-slot__pack-img"
                  />
                  <span className="chest-slot__timer">⏳ {slot.durationHours}h</span>
                  <span className="chest-slot__btn-hint">INICIAR</span>
                </div>
              )}

              {slot.status === 'unlocking' && (
                <div className="chest-slot__content chest-slot__content--unlocking">
                  <span className="chest-slot__arena-tag">DESBLOQUEANDO</span>
                  <img
                    src="/game-assets/greenfoot/seed_pack_common_whitebg.png"
                    alt="Sobre Gratis"
                    className="chest-slot__pack-img chest-slot__pack-img--pulsing"
                  />
                  <span className="chest-slot__timer chest-slot__timer--active">
                    ⏱️ {remainingText}
                  </span>
                  <span className="chest-slot__btn-hint chest-slot__btn-hint--test">
                    ⚡ ABRIR (TEST)
                  </span>
                </div>
              )}

              {slot.status === 'ready' && (
                <div className="chest-slot__content chest-slot__content--ready">
                  <span className="chest-slot__arena-tag chest-slot__arena-tag--ready">
                    ¡LISTO!
                  </span>
                  <img
                    src="/game-assets/greenfoot/seed_pack_common_whitebg.png"
                    alt="Sobre Gratis"
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

      {/* PLAYER PROFILE MODAL */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        userElo={userElo}
        userTokens={userTokens}
        hasVipPass={hasVipPass}
        onClose={() => setIsProfileModalOpen(false)}
        onAddTokens={onAddTokens}
        onDeductTokens={onDeductTokens}
      />
    </div>
  )
}
