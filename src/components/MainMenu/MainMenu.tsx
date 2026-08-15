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
import moneda from '../../assets/ico/moneda.png'
import gema from '../../assets/ico/gema.png'
import ranking from '../../assets/ico/Ranking.png'
import chat from '../../assets/ico/chat.png'
import clan from '../../assets/ico/clan.png'
import ajustes from '../../assets/ico/ajustes.png'
import { soundManager } from '../../utils/audioManager'
import { getRemainingTimeString, type FreePackSlot } from '../../utils/freePackManager'
import { toggleFullscreen, isFullscreen } from '../../utils/fullscreen'
import './MainMenu.css'

interface MainMenuProps {
  userElo?: number
  freePackSlots?: FreePackSlot[]
  onPlay: () => void
  onOpenCollection?: () => void
  onOpenJardin?: () => void
  onOpenShop?: () => void
  onOpenRanking?: () => void
  onOpenLanding?: () => void
  onStartSlotUnlock?: (slotId: number) => { success: boolean; error?: string }
  onFastUnlockSlot?: (slotId: number) => void
  onOpenSlotPack?: (slotId: number) => void
}

export default function MainMenu({
  userElo = 1000,
  freePackSlots = [],
  onPlay,
  onOpenCollection,
  onOpenJardin,
  onOpenShop,
  onOpenRanking,
  onOpenLanding,
  onStartSlotUnlock,
  onFastUnlockSlot,
  onOpenSlotPack,
}: MainMenuProps) {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [isFullscreenState, setIsFullscreenState] = useState<boolean>(isFullscreen())
  const [, setTicker] = useState<number>(0)

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreenState(isFullscreen())
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    document.addEventListener('webkitfullscreenchange', handleFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      document.removeEventListener('webkitfullscreenchange', handleFsChange)
    }
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
        <div className="card card--player">
          <span className="card__title">DRAGONMASTER</span>
          <span className="card__subtitle">Nivel 25</span>
        </div>
        <div className="topbar__right">
          <div className="card card--stat">
            <img className="card__icon" src={moneda} alt="" />
            2,500
          </div>
          <div className="card card--stat">
            <img className="card__icon" src={gema} alt="" />
            1,250
          </div>

          {/* Columna de Ranking con Botón de Maximizar visible justo debajo */}
          <div className="topbar__ranking-col">
            <div
              className="card card--stat card--ranking"
              style={{ cursor: 'pointer' }}
              onClick={onOpenRanking}
              title="Ver Camino de Arenas y Ranking Global"
            >
              <img className="card__icon" src={ranking} alt="" />
              <span>{userElo} 🏆</span>
            </div>
            <button
              className="maximize-game-btn"
              type="button"
              onClick={() => {
                toggleFullscreen()
                soundManager.playSound('click', 0.5)
              }}
              title={isFullscreenState ? 'Salir de pantalla completa' : 'Maximizar juego a pantalla completa'}
            >
              <span className="maximize-game-btn__icon">{isFullscreenState ? '🗗' : '⛶'}</span>
              <span className="maximize-game-btn__label">
                {isFullscreenState ? 'VENTANA' : 'MAXIMIZAR'}
              </span>
            </button>
          </div>

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
                    alert(res.error)
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
        <button className="footer-button" type="button">
          <img src={clan} alt="" />
          Clan
        </button>
        <button className="footer-button" type="button">
          <img src={chat} alt="" />
          Chat
        </button>
        <button className="footer-button" type="button">
          <img src={ajustes} alt="" />
          Ajustes
        </button>
      </div>
    </div>
  )
}
