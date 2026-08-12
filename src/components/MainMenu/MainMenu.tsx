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
import './MainMenu.css'

interface MainMenuProps {
  onPlay: () => void
  onOpenCollection?: () => void
  onOpenJardin?: () => void
  onOpenShop?: () => void
}

export default function MainMenu({
  onPlay,
  onOpenCollection,
  onOpenJardin,
  onOpenShop,
}: MainMenuProps) {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
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
          <div className="card card--stat">
            <img className="card__icon" src={ranking} alt="" />
            1200
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

      <img className="logo" src={logo} alt="Plant Arena" />

      <img className="plant plant--left" src={plant1} alt="" />
      <img className="plant plant--right" src={plant2} alt="" />

      <button className="play-button" type="button" onClick={onPlay}>
        <img className="play-button__art" src={play} alt="" />
        <span className="play-button__label">PLAY</span>
      </button>

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
        <button className="banner-button" type="button">
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
