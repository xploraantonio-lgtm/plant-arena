import { useState } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import './Shop.css'

const commonSeedImg = '/game-assets/greenfoot/seed_pack_common_whitebg.png'
const epicSeedImg = '/game-assets/greenfoot/seed_pack_epic_whitebg.png'
const legendarySeedImg = '/game-assets/greenfoot/seed_pack_legendary_whitebg.png'

interface ShopProps {
  onBack: () => void
}

export default function Shop({ onBack }: ShopProps) {
  const [userTokens, setUserTokens] = useState<number>(2500)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [openedPackResult, setOpenedPackResult] = useState<string | null>(null)

  const handleBuyBattlePass = () => {
    if (userTokens >= 10) {
      soundManager.playSound('plantation', 0.8)
      setUserTokens((prev) => prev - 10)
      alert('🎉 ¡PASE DE BATALLA PREMIUM ACTIVADO! Has desbloqueado las recompensas VIP de la temporada.')
    } else {
      alert('⚠️ Saldo insuficiente para adquirir el Pase Premium.')
    }
  }

  const handleBuySeedPack = (packName: string, cost: number) => {
    if (userTokens >= cost) {
      soundManager.playSound('plantation', 0.8)
      setUserTokens((prev) => prev - cost)
      setOpenedPackResult(`🎉 ¡${packName.toUpperCase()} COMPRADO CON ÉXITO!\nEl sobre se ha guardado en tu Inventario de "Mi Jardín".`)
    } else {
      alert(`⚠️ Saldo insuficiente para comprar el ${packName}.`)
    }
  }

  return (
    <div className="shop-screen" style={{ backgroundImage: `url(${background})` }}>
      {/* Top Header */}
      <div className="shop-header">
        <button className="shop-back-btn" type="button" onClick={onBack}>
          ⬅️ MENÚ
        </button>
        <div className="shop-header__center">
          <h1 className="shop-title">🛒 TIENDA WEB3 & SOBRES MÍSTICOS DE SEMILLAS</h1>
          <span className="shop-subtitle">Moneda Paridad 1:1 USD ($1 Token = $1.00 USD)</span>
        </div>
        <div className="shop-header__right">
          <div className="shop-token-badge">
            <span className="shop-token-icon">💵</span>
            <span className="shop-token-amount">${userTokens}.00 USD</span>
          </div>
          <button
            className="shop-mute-btn"
            type="button"
            onClick={() => {
              soundManager.toggleMute()
              setIsMuted(soundManager.isMuted())
            }}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      <div className="shop-content">
        {/* BIG HERO HEADER: BATTLE PASS PREMIUM */}
        <div className="shop-banner-pass">
          <div className="shop-pass-info">
            <span className="shop-pass-tag">🔥 TEMPORADA 1 WEB3</span>
            <h2 className="shop-pass-title">PASE DE BATALLA PREMIUM VIP</h2>
            <p className="shop-pass-desc">
              Desbloquea recompensas exclusivas, multiplicador de ganancias $USD en Wager PvP,
              Skins doradas de temporada y 3 Sobres Místicos Garantizados.
            </p>
            <div className="shop-pass-perks">
              <span>✨ Recompensas VIP de Temporada</span>
              <span>⚡ x2 Recompensas en Wager PvP</span>
              <span>👑 Skin Dorada de Bonk Choy</span>
            </div>
          </div>
          <div className="shop-pass-buy">
            <div className="shop-pass-price">
              <span>VALOR PASE:</span>
              <strong>$10.00 USD</strong>
            </div>
            <button
              className="shop-pass-btn"
              type="button"
              onClick={handleBuyBattlePass}
            >
              👑 COMPRAR PASE PREMIUM
            </button>
          </div>
        </div>



        {/* 3 MYSTERY SEED PACKS GRID */}
        <h3 className="shop-packs-title">🌱 SOBRES DE SEMILLAS MÍSTICAS (3 PACKS AL AZAR)</h3>
        <div className="shop-packs-grid">
          {/* Pack 1: Común */}
          <div className="shop-pack-card shop-pack-card--common">
            <div className="shop-pack-badge">PACK VERDE MÁGICO</div>
            <div className="shop-pack-img-wrap">
              <img src={commonSeedImg} alt="Sobre Común" className="shop-pack-img shop-pack-img--common" />
            </div>
            <h4 className="shop-pack-name">Sobre de Semillas Básicas</h4>
            <p className="shop-pack-desc">Contiene 1 Semilla al azar de plantas tácticas iniciales.</p>
            <div className="shop-pack-odds">
              🎯 <span>Probabilidades: 70% Común | 25% Rara | 5% Épica</span>
            </div>
            <div className="shop-pack-pool">
              <span>Posibles: Threepeater, Twin Sunflower, Cactus</span>
            </div>
            <div className="shop-pack-footer">
              <button
                className="shop-pack-btn"
                type="button"
                onClick={() => handleBuySeedPack('Sobre de Semillas Básicas', 1)}
              >
                COMPRAR
              </button>
            </div>
          </div>

          {/* Pack 2: Épico */}
          <div className="shop-pack-card shop-pack-card--epic">
            <div className="shop-pack-badge shop-pack-badge--epic">PACK MÍSTICO PÚRPURA</div>
            <div className="shop-pack-img-wrap">
              <img src={epicSeedImg} alt="Sobre Épico" className="shop-pack-img" />
            </div>
            <h4 className="shop-pack-name">Sobre de Semillas Pesadas</h4>
            <p className="shop-pack-desc">Garantiza 1 Semilla de alto impacto y defensa.</p>
            <div className="shop-pack-odds">
              🎯 <span>Probabilidades: 50% Épica | 35% Rara | 15% Mítica</span>
            </div>
            <div className="shop-pack-pool">
              <span>Posibles: Squash, Tall-nut, Melon-pult</span>
            </div>
            <div className="shop-pack-footer">
              <button
                className="shop-pack-btn shop-pack-btn--epic"
                type="button"
                onClick={() => handleBuySeedPack('Sobre de Semillas Pesadas', 3)}
              >
                COMPRAR
              </button>
            </div>
          </div>

          {/* Pack 3: Legendario / VIP */}
          <div className="shop-pack-card shop-pack-card--legendary">
            <div className="shop-pack-badge shop-pack-badge--legendary">PACK LEGENDARIO DORADO</div>
            <div className="shop-pack-img-wrap">
              <img src={legendarySeedImg} alt="Sobre Legendario" className="shop-pack-img" />
            </div>
            <h4 className="shop-pack-name">Sobre de Semillas Legendarias</h4>
            <p className="shop-pack-desc">¡Semilla Garantizada de Plantas Míticas y Skins!</p>
            <div className="shop-pack-odds shop-pack-odds--vip">
              👑 <span>Probabilidades: 60% Mítica | 40% Legendaria + Skin</span>
            </div>
            <div className="shop-pack-pool">
              <span>Posibles: Bonk Choy, Squash, Tall-nut + Skin Dorada</span>
            </div>
            <div className="shop-pack-footer">
              <button
                className="shop-pack-btn shop-pack-btn--legendary"
                type="button"
                onClick={() => handleBuySeedPack('Sobre de Semillas Legendarias', 5)}
              >
                COMPRAR
              </button>
            </div>
          </div>
        </div>

        {/* Opened Pack Modal Alert */}
        {openedPackResult && (
          <div className="shop-result-modal">
            <div className="shop-result-card">
              <h3>{openedPackResult}</h3>
              <button
                className="shop-result-btn"
                type="button"
                onClick={() => setOpenedPackResult(null)}
              >
                ¡RECLAMAR AL INVENTARIO DE MI JARDÍN!
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
