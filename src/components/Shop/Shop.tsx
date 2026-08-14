import { useState } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import { PACK_DEFINITIONS, type InventoryPack, type PackId } from '../../utils/packDropManager'
import BattlePass from '../BattlePass/BattlePass'
import './Shop.css'

const commonSeedImg = '/game-assets/greenfoot/seed_pack_common_whitebg.png'
const epicSeedImg = '/game-assets/greenfoot/seed_pack_epic_whitebg.png'
const legendarySeedImg = '/game-assets/greenfoot/seed_pack_legendary_whitebg.png'

interface ShopProps {
  userTokens: number
  userElo?: number
  hasVipPass?: boolean
  claimedVipLevels?: number[]
  inventoryPacks: InventoryPack[]
  onBack: () => void
  onBuyPack: (packId: PackId) => { success: boolean; pack?: InventoryPack; error?: string }
  onOpenJardin: () => void
  onAddTokens: (amount: number) => void
  onOpenPackImmediately: (packInstanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onBuyVipPass?: () => boolean
  onClaimPassReward?: (reward: any, levelNum: number) => void
}

export default function Shop({
  userTokens,
  userElo = 1000,
  hasVipPass = false,
  claimedVipLevels = [],
  inventoryPacks,
  onBack,
  onBuyPack,
  onOpenJardin,
  onAddTokens,
  onOpenPackImmediately,
  onOpenMultiplePacks,
  onBuyVipPass,
  onClaimPassReward,
}: ShopProps) {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [activeTab, setActiveTab] = useState<'packs' | 'pass' | 'tokens'>('packs')
  const [purchasedPacksList, setPurchasedPacksList] = useState<InventoryPack[]>([])

  const [buyQuantities, setBuyQuantities] = useState<Record<PackId, number>>({
    basic: 1,
    epic: 1,
    legendary: 1,
  })

  const getPackCount = (packId: PackId) => {
    return inventoryPacks.filter((p) => p.packId === packId).length
  }

  const getQty = (packId: PackId) => buyQuantities[packId] || 1

  const setQty = (packId: PackId, val: number) => {
    const clamped = Math.max(1, Math.min(20, val))
    setBuyQuantities((prev) => ({ ...prev, [packId]: clamped }))
  }



  const handleBuyPacksBatch = (packId: PackId) => {
    const qty = getQty(packId)
    const packDef = PACK_DEFINITIONS[packId]
    const totalCost = packDef.priceUsd * qty

    if (userTokens < totalCost) {
      alert(`⚠️ Saldo insuficiente. Se requieren $${totalCost}.00 USD para comprar ${qty} sobres.`)
      return
    }

    const bought: InventoryPack[] = []
    for (let i = 0; i < qty; i++) {
      const res = onBuyPack(packId)
      if (res.success && res.pack) {
        bought.push(res.pack)
      }
    }

    if (bought.length > 0) {
      soundManager.playSound('plantation', 0.8)
      setPurchasedPacksList(bought)
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
          <h1 className="shop-title">🛒 TIENDA GAMING & SOBRES DE SEMILLAS</h1>
          <span className="shop-subtitle">Moneda Paridad 1:1 USD ($1 Token = $1.00 USD)</span>
        </div>
        <div className="shop-header__right">
          <div className="shop-token-badge">
            <span className="shop-token-icon">💵</span>
            <span className="shop-token-amount">${userTokens}.00 USD</span>
          </div>
          <button
            className="shop-back-btn"
            type="button"
            style={{ background: '#16a34a', borderColor: '#4ade80' }}
            onClick={() => onAddTokens(100)}
            title="Añadir $100.00 USD de prueba para testear compras"
          >
            +$100 TEST
          </button>
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

      {/* GAMING CATEGORY NAVIGATION TABS (ZERO SCROLL) */}
      <div className="shop-nav-tabs">
        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'packs' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('packs')
          }}
        >
          🌱 SOBRES DE SEMILLAS ({inventoryPacks.length} EN JARDÍN)
        </button>
        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'pass' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('pass')
          }}
        >
          👑 PASE DE BATALLA VIP
        </button>
        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'tokens' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('tokens')
          }}
        >
          💵 RECARGA DE TOKENS ($USD)
        </button>
      </div>

      {/* ZERO SCROLL MAIN CONTENT SLIDER VIEW */}
      <div className="shop-content">
        {/* TAB 1: SEED PACKS */}
        {activeTab === 'packs' && (
          <div className="shop-tab-pane">
            <div className="shop-packs-section-bar">
              <span className="shop-section-tagline">
                🎒 Sobres distribuidos con las 15 plantas del catálogo. ¡Comprahoy y abre cuando quieras!
              </span>
              <button
                type="button"
                className="shop-back-btn"
                style={{ background: 'linear-gradient(180deg, #2d6a4f 0%, #1b4332 100%)', borderColor: '#52b788', padding: '6px 14px', fontSize: '11px' }}
                onClick={onOpenJardin}
              >
                🪴 IR A MI JARDÍN ({inventoryPacks.length} SOBRES GUARDADOS)
              </button>
            </div>

            <div className="shop-packs-grid">
              {/* Pack 1: Básico */}
              <div className="shop-pack-card shop-pack-card--common">
                <div className="shop-pack-badge">PACK VERDE BÁSICO ($3.00 USD)</div>
                {getPackCount('basic') > 0 && (
                  <span className="shop-pack-count-badge">🎒 {getPackCount('basic')} EN JARDÍN</span>
                )}
                <div className="shop-pack-img-wrap">
                  <img src={commonSeedImg} alt="Sobre Básico" className="shop-pack-img shop-pack-img--common" />
                </div>
                <h4 className="shop-pack-name">Sobre de Semillas Básico</h4>
                <p className="shop-pack-desc">Contiene 3 Cartas de plantas.</p>
                <div className="shop-pack-odds">
                  🎯 <span>60% Común | 30% Poco Común | 8% Rara | 2% Épica</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">COMPRAR:</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('basic', getQty('basic') - 1)}>-</button>
                  <span className="shop-qty-num">{getQty('basic')}</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('basic', getQty('basic') + 1)}>+</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('basic', 5)}>x5</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('basic', 10)}>x10</button>
                </div>

                <button
                  className="shop-pack-btn"
                  type="button"
                  onClick={() => handleBuyPacksBatch('basic')}
                >
                  COMPRAR {getQty('basic')} {getQty('basic') === 1 ? 'SOBRE' : 'SOBRES'} (${getQty('basic') * PACK_DEFINITIONS.basic.priceUsd}.00 USD)
                </button>
              </div>

              {/* Pack 2: Místico */}
              <div className="shop-pack-card shop-pack-card--epic">
                <div className="shop-pack-badge shop-pack-badge--epic">PACK MÍSTICO PÚRPURA ($8.00 USD)</div>
                {getPackCount('epic') > 0 && (
                  <span className="shop-pack-count-badge shop-pack-count-badge--epic">🎒 {getPackCount('epic')} EN JARDÍN</span>
                )}
                <div className="shop-pack-img-wrap">
                  <img src={epicSeedImg} alt="Sobre Místico" className="shop-pack-img" />
                </div>
                <h4 className="shop-pack-name">Sobre de Semillas Místico</h4>
                <p className="shop-pack-desc">Contiene 4 Cartas de gran valor.</p>
                <div className="shop-pack-odds">
                  🎯 <span>20% Común | 45% Poco Común | 25% Rara | 8% Épica | 2% Legendaria</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">COMPRAR:</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('epic', getQty('epic') - 1)}>-</button>
                  <span className="shop-qty-num">{getQty('epic')}</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('epic', getQty('epic') + 1)}>+</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('epic', 5)}>x5</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('epic', 10)}>x10</button>
                </div>

                <button
                  className="shop-pack-btn shop-pack-btn--epic"
                  type="button"
                  onClick={() => handleBuyPacksBatch('epic')}
                >
                  COMPRAR {getQty('epic')} {getQty('epic') === 1 ? 'SOBRE' : 'SOBRES'} (${getQty('epic') * PACK_DEFINITIONS.epic.priceUsd}.00 USD)
                </button>
              </div>

              {/* Pack 3: Legendario / VIP */}
              <div className="shop-pack-card shop-pack-card--legendary">
                <div className="shop-pack-badge shop-pack-badge--legendary">PACK LEGENDARIO VIP ($10.00 USD)</div>
                {getPackCount('legendary') > 0 && (
                  <span className="shop-pack-count-badge shop-pack-count-badge--legendary">🎒 {getPackCount('legendary')} EN JARDÍN</span>
                )}
                <div className="shop-pack-img-wrap">
                  <img src={legendarySeedImg} alt="Sobre Legendario" className="shop-pack-img" />
                </div>
                <h4 className="shop-pack-name">Sobre de Semillas VIP Legendario</h4>
                <p className="shop-pack-desc">¡Contiene 4 Cartas con alta probabilidad Legendaria!</p>
                <div className="shop-pack-odds shop-pack-odds--vip">
                  👑 <span>25% Poco Común | 45% Rara | 20% Épica | 10% Legendaria</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">COMPRAR:</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('legendary', getQty('legendary') - 1)}>-</button>
                  <span className="shop-qty-num">{getQty('legendary')}</span>
                  <button type="button" className="shop-qty-btn" onClick={() => setQty('legendary', getQty('legendary') + 1)}>+</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('legendary', 5)}>x5</button>
                  <button type="button" className="shop-qty-preset" onClick={() => setQty('legendary', 10)}>x10</button>
                </div>

                <button
                  className="shop-pack-btn shop-pack-btn--legendary"
                  type="button"
                  onClick={() => handleBuyPacksBatch('legendary')}
                >
                  COMPRAR {getQty('legendary')} {getQty('legendary') === 1 ? 'SOBRE' : 'SOBRES'} (${getQty('legendary') * PACK_DEFINITIONS.legendary.priceUsd}.00 USD)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SEASON PASS BATTLE PASS */}
        {activeTab === 'pass' && (
          <div className="shop-tab-pane">
            <BattlePass
              userElo={userElo}
              hasVipPass={hasVipPass}
              claimedVipLevels={claimedVipLevels}
              onBuyVipPass={() => {
                if (onBuyVipPass) {
                  const ok = onBuyVipPass()
                  if (ok) {
                    alert('👑 ¡PASE VIP DE TEMPORADA ACTIVADO! Ahora puedes reclamar las recompensas doradas VIP de cada nivel alcanzado.')
                  } else {
                    alert('⚠️ Saldo insuficiente ($10.00 USD requeridos). Recarga tokens en la Tienda.')
                  }
                }
              }}
              onClaimReward={(lvl) => {
                if (onClaimPassReward) {
                  onClaimPassReward(lvl.reward, lvl.level)
                  alert(`👑 ¡RECOMPENSA VIP DEL NIVEL ${lvl.level} RECLAMADA!\n${lvl.reward.label}`)
                }
              }}
            />
          </div>
        )}

        {/* TAB 3: TOKEN REFILL CHESTS */}
        {activeTab === 'tokens' && (
          <div className="shop-tab-pane">
            <div className="shop-tokens-grid">
              <div className="shop-token-card">
                <span className="shop-token-card__badge">BÁSICO</span>
                <span className="shop-token-card__icon">💰</span>
                <h4 className="shop-token-card__title">10 TOKENS USD</h4>
                <span className="shop-token-card__price">$10.00 USD</span>
                <button
                  type="button"
                  className="shop-token-card__btn"
                  onClick={() => {
                    onAddTokens(10)
                    soundManager.playSound('plantation', 0.8)
                  }}
                >
                  + RECARGAR $10
                </button>
              </div>

              <div className="shop-token-card shop-token-card--featured">
                <span className="shop-token-card__badge shop-token-card__badge--popular">POPULAR 🔥</span>
                <span className="shop-token-card__icon">💎</span>
                <h4 className="shop-token-card__title">25 TOKENS USD (+1 GRATIS)</h4>
                <span className="shop-token-card__price">$25.00 USD</span>
                <button
                  type="button"
                  className="shop-token-card__btn shop-token-card__btn--featured"
                  onClick={() => {
                    onAddTokens(26)
                    soundManager.playSound('plantation', 0.8)
                  }}
                >
                  + RECARGAR $25
                </button>
              </div>

              <div className="shop-token-card">
                <span className="shop-token-card__badge">AVANZADO</span>
                <span className="shop-token-card__icon">👑</span>
                <h4 className="shop-token-card__title">50 TOKENS USD (+3 GRATIS)</h4>
                <span className="shop-token-card__price">$50.00 USD</span>
                <button
                  type="button"
                  className="shop-token-card__btn"
                  onClick={() => {
                    onAddTokens(53)
                    soundManager.playSound('plantation', 0.8)
                  }}
                >
                  + RECARGAR $50
                </button>
              </div>

              <div className="shop-token-card shop-token-card--legendary">
                <span className="shop-token-card__badge shop-token-card__badge--gold">MÁXIMO VALOR 🏆</span>
                <span className="shop-token-card__icon">🚀</span>
                <h4 className="shop-token-card__title">100 TOKENS USD (+10 GRATIS)</h4>
                <span className="shop-token-card__price">$100.00 USD</span>
                <button
                  type="button"
                  className="shop-token-card__btn shop-token-card__btn--gold"
                  onClick={() => {
                    onAddTokens(110)
                    soundManager.playSound('plantation', 0.8)
                  }}
                >
                  + RECARGAR $100
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Opened Pack / Purchase Confirmation Modal */}
        {purchasedPacksList.length > 0 && (
          <div className="shop-result-modal">
            <div className="shop-result-card">
              <h3>🎉 ¡COMPRA EXITOSA!</h3>
              <p style={{ color: '#e2e8f0', fontSize: '13px', marginBottom: '16px' }}>
                Has adquirido <strong>{purchasedPacksList.length} {purchasedPacksList.length === 1 ? 'Sobre de Semillas' : 'Sobres de Semillas'} ({purchasedPacksList[0].name})</strong>.<br />
                Se han guardado en tu inventario de <strong>"Mi Jardín"</strong>.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  className="shop-result-btn"
                  style={{ background: 'linear-gradient(180deg, #eab308 0%, #ca8a04 100%)', borderColor: '#fef08a', color: '#1a1000' }}
                  type="button"
                  onClick={() => {
                    const instIds = purchasedPacksList.map((p) => p.instanceId)
                    setPurchasedPacksList([])
                    if (instIds.length === 1) {
                      onOpenPackImmediately(instIds[0])
                    } else if (onOpenMultiplePacks) {
                      onOpenMultiplePacks(instIds)
                    }
                  }}
                >
                  ✨ ABRIR {purchasedPacksList.length === 1 ? 'ESTE SOBRE AHORA MISMO' : `ESTOS ${purchasedPacksList.length} SOBRES AHORA MISMO`}
                </button>

                <button
                  className="shop-result-btn"
                  type="button"
                  onClick={() => {
                    setPurchasedPacksList([])
                    onOpenJardin()
                  }}
                >
                  🪴 IR A MI JARDÍN (VER INVENTARIO)
                </button>

                <button
                  className="shop-result-btn"
                  style={{ background: 'linear-gradient(180deg, #475569 0%, #1e293b 100%)', borderColor: '#94a3b8' }}
                  type="button"
                  onClick={() => setPurchasedPacksList([])}
                >
                  🛒 SEGUIR COMPRANDO
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
