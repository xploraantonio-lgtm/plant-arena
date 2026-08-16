import { useState } from 'react'
import background from '../../assets/images/background.png'
import type { PlantCardInstance, PlantId } from '../../types/game'
import {
  PACK_DEFINITIONS,
  type InventoryPack,
  type PackId,
} from '../../utils/packDropManager'
import { soundManager } from '../../utils/audioManager'
import Marketplace from '../Marketplace/Marketplace'
import type { PlantStatKey } from '../../utils/gameConstants'
import './Shop.css'

const commonSeedImg = '/game-assets/greenfoot/seed_pack_common_whitebg.png'
const epicSeedImg = '/game-assets/greenfoot/seed_pack_epic_whitebg.png'
const legendarySeedImg = '/game-assets/greenfoot/seed_pack_legendary_whitebg.png'

interface ShopProps {
  userTokens: number
  hasVipPass?: boolean
  inventoryPacks: InventoryPack[]
  plantCopies?: Partial<Record<PlantId, number>>
  plantLevels?: Partial<Record<PlantId, number>>
  plantStatRolls?: Partial<Record<PlantId, PlantStatKey[]>>
  plantInstances?: PlantCardInstance[]
  onBack: () => void
  onBuyPack: (packId: PackId) => { success: boolean; pack?: InventoryPack; error?: string }
  onOpenJardin: () => void
  onAddTokens: (amount: number) => void
  onOpenPackImmediately: (packInstanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onBuyVipPass?: () => boolean
  onDeductTokens?: (amountUsd: number) => boolean
  onDonatePlant?: (plantId: PlantId) => boolean
  onReceivePlant?: (plantId: PlantId, level?: number, statRolls?: PlantStatKey[]) => void
}

export default function Shop({
  userTokens,
  hasVipPass = false,
  inventoryPacks,
  plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
  plantInstances = [],
  onBack,
  onBuyPack,
  onOpenJardin,
  onAddTokens,
  onOpenPackImmediately,
  onOpenMultiplePacks,
  onBuyVipPass,
  onDeductTokens,
  onDonatePlant,
  onReceivePlant,
}: ShopProps) {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [activeTab, setActiveTab] = useState<'packs' | 'pass' | 'market'>('packs')
  const [purchasedPacksList, setPurchasedPacksList] = useState<InventoryPack[]>([])
  const [themedAlert, setThemedAlert] = useState<{ title: string; message: string; icon: string } | null>(null)
  const [selectedPackDetails, setSelectedPackDetails] = useState<PackId | null>(null)

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
      setThemedAlert({
        title: 'SALDO INSUFICIENTE',
        message: `⚠️ Saldo insuficiente ($${userTokens.toFixed(2)} USD disponibles).\nSe requieren $${totalCost.toFixed(2)} USD para comprar ${qty} ${qty === 1 ? 'sobre' : 'sobres'}.`,
        icon: '⚠️',
      })
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

  const handleBuyVipFromShop = () => {
    if (onBuyVipPass) {
      const ok = onBuyVipPass()
      if (ok) {
        setThemedAlert({
          title: '¡PASE VIP ACTIVADO!',
          message: '👑 ¡Pase VIP de Temporada activado con éxito!\nAhora puedes reclamar todas las recompensas doradas desde el Menú Principal.',
          icon: '👑',
        })
        setActiveTab('packs')
      } else {
        setThemedAlert({
          title: 'SALDO INSUFICIENTE',
          message: '⚠️ Saldo insuficiente ($10.00 USD requeridos).\nRecarga saldo usando el botón "+$100 TEST" de la tienda.',
          icon: '⚠️',
        })
      }
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
          <h1 className="shop-title">🛒 TIENDA GAMING & MERCADO DE CARTAS</h1>
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

      {/* Main Navigation Tabs */}
      <div className="shop-nav-tabs">
        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'packs' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('packs')
          }}
        >
          🎒 SOBRES DE SEMILLAS
        </button>

        {!hasVipPass && (
          <button
            type="button"
            className={`shop-nav-tab ${activeTab === 'pass' ? 'shop-nav-tab--active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.5)
              setActiveTab('pass')
            }}
          >
            👑 ACTIVAR PASE VIP
          </button>
        )}

        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'market' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('market')
          }}
        >
          🏷️ COMERCIO
        </button>
      </div>

      {/* ZERO SCROLL MAIN CONTENT SLIDER VIEW */}
      <div className="shop-content">
        {/* TAB 1: SEED PACKS */}
        {activeTab === 'packs' && (
          <div className="shop-tab-pane">
            <div className="shop-packs-section-bar">
              <span className="shop-section-tagline">
                🎒 Sobres distribuidos con las 15 plantas del catálogo. ¡Haz click en un sobre para ver sus probabilidades!
              </span>
              <button
                type="button"
                className="shop-back-btn"
                style={{ background: 'linear-gradient(180deg, #2d6a4f 0%, #1b4332 100%)', borderColor: '#52b788', padding: '6px 14px', fontSize: '11px' }}
                onClick={onOpenJardin}
              >
                🌱 IR A MI JARDÍN
              </button>
            </div>

            <div className="shop-packs-grid">
              {/* Pack 1: Básico */}
              <div className="shop-pack-card shop-pack-card--basic">
                {getPackCount('basic') > 0 && (
                  <span className="shop-pack-count-badge">🎒 {getPackCount('basic')} EN JARDÍN</span>
                )}
                <div
                  className="shop-pack-img-wrap"
                  onClick={() => {
                    soundManager.playSound('click', 0.4)
                    setSelectedPackDetails('basic')
                  }}
                  title="Click para ver contenido y probabilidades"
                >
                  <img src={commonSeedImg} alt="Sobre Básico" className="shop-pack-img" />
                  <span className="shop-pack-inspect-hint">🔍 Ver Detalles</span>
                </div>
                <div className="shop-pack-meta">
                  <h4 className="shop-pack-name">Sobre Básico</h4>
                  <span className="shop-pack-price-tag">$3.00 USD</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">CANT:</span>
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
                  COMPRAR ({getQty('basic')}) — ${(3 * getQty('basic')).toFixed(2)} USD
                </button>
              </div>

              {/* Pack 2: Épico */}
              <div className="shop-pack-card shop-pack-card--epic">
                {getPackCount('epic') > 0 && (
                  <span className="shop-pack-count-badge shop-pack-count-badge--epic">🎒 {getPackCount('epic')} EN JARDÍN</span>
                )}
                <div
                  className="shop-pack-img-wrap"
                  onClick={() => {
                    soundManager.playSound('click', 0.4)
                    setSelectedPackDetails('epic')
                  }}
                  title="Click para ver contenido y probabilidades"
                >
                  <img src={epicSeedImg} alt="Sobre Épico" className="shop-pack-img shop-pack-img--epic" />
                  <span className="shop-pack-inspect-hint">🔍 Ver Detalles</span>
                </div>
                <div className="shop-pack-meta">
                  <h4 className="shop-pack-name">Sobre Épico</h4>
                  <span className="shop-pack-price-tag shop-pack-price-tag--epic">$5.00 USD</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">CANT:</span>
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
                  COMPRAR ({getQty('epic')}) — ${(5 * getQty('epic')).toFixed(2)} USD
                </button>
              </div>

              {/* Pack 3: Legendario */}
              <div className="shop-pack-card shop-pack-card--legendary">
                {getPackCount('legendary') > 0 && (
                  <span className="shop-pack-count-badge shop-pack-count-badge--legendary">🎒 {getPackCount('legendary')} EN JARDÍN</span>
                )}
                <div
                  className="shop-pack-img-wrap"
                  onClick={() => {
                    soundManager.playSound('click', 0.4)
                    setSelectedPackDetails('legendary')
                  }}
                  title="Click para ver contenido y probabilidades"
                >
                  <img src={legendarySeedImg} alt="Sobre Legendario" className="shop-pack-img shop-pack-img--legendary" />
                  <span className="shop-pack-inspect-hint">🔍 Ver Detalles</span>
                </div>
                <div className="shop-pack-meta">
                  <h4 className="shop-pack-name">Sobre Legendario</h4>
                  <span className="shop-pack-price-tag shop-pack-price-tag--legendary">$10.00 USD</span>
                </div>

                <div className="shop-pack-qty-bar">
                  <span className="shop-qty-label">CANT:</span>
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
                  COMPRAR ({getQty('legendary')}) — ${(10 * getQty('legendary')).toFixed(2)} USD
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: VIP BATTLE PASS (Purchase only) */}
        {activeTab === 'pass' && !hasVipPass && (
          <div className="shop-tab-pane">
            <div className="shop-pass-purchase-hero">
              <div className="shop-pass-hero-card">
                <span className="shop-pass-hero-crown">👑</span>
                <h2 className="shop-pass-hero-title">PASE DE BATALLA VIP — TEMPORADA 1</h2>
                <p className="shop-pass-hero-sub">
                  Desbloquea el camino completo de <strong>20 niveles de recompensas premium</strong>, multiplicadores de fichas, cartas épicas y legendarias exclusivas, y acceso al Mercado de Comercio.
                </p>

                <div className="shop-pass-perks-grid">
                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🎁</span>
                    <span className="shop-pass-perk-txt">20 Niveles de Recompensas</span>
                  </div>
                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🏷️</span>
                    <span className="shop-pass-perk-txt">Acceso al Mercado de Comercio</span>
                  </div>
                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🌟</span>
                    <span className="shop-pass-perk-txt">Sobres Legendarios Garantizados</span>
                  </div>
                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🛡️</span>
                    <span className="shop-pass-perk-txt">Emblema Dorado en Perfil</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="shop-pass-hero-buy-btn"
                  onClick={handleBuyVipFromShop}
                >
                  👑 ACTIVAR PASE VIP — $10.00 USD
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: COMERCIO */}
        {activeTab === 'market' && (
          <div className="shop-tab-pane" style={{ padding: 0, height: '100%' }}>
            <Marketplace
              userTokens={userTokens}
              hasVipPass={hasVipPass}
              plantCopies={plantCopies as Record<PlantId, number>}
              plantLevels={plantLevels as Record<PlantId, number>}
              plantStatRolls={plantStatRolls as Record<PlantId, PlantStatKey[]>}
              plantInstances={plantInstances}
              onDeductTokens={onDeductTokens || (() => false)}
              onDonatePlant={onDonatePlant || (() => false)}
              onReceivePlant={onReceivePlant || (() => {})}
              onBuyVipPass={onBuyVipPass || (() => false)}
              onBackToMenu={onBack}
            />
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

        {/* IN-GAME THEMED MODAL ALERT */}
        {themedAlert && (
          <div className="main-menu-dialog-backdrop" onClick={() => setThemedAlert(null)}>
            <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
              <div className="main-menu-dialog-icon">{themedAlert.icon}</div>
              <h3 className="main-menu-dialog-title">{themedAlert.title}</h3>
              <p className="main-menu-dialog-msg">{themedAlert.message}</p>
              <button
                type="button"
                className="main-menu-dialog-btn"
                onClick={() => setThemedAlert(null)}
              >
                ENTENDIDO
              </button>
            </div>
          </div>
        )}

        {/* PACK DETAILS MODAL (CLICK ON PACK IMAGE) */}
        {selectedPackDetails && (
          <div
            className="main-menu-dialog-backdrop"
            onClick={() => setSelectedPackDetails(null)}
          >
            <div
              className="shop-pack-details-card"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="shop-pack-details-close"
                onClick={() => setSelectedPackDetails(null)}
              >
                ✖
              </button>

              <div className="shop-pack-details-header">
                <img
                  src={
                    selectedPackDetails === 'basic'
                      ? commonSeedImg
                      : selectedPackDetails === 'epic'
                      ? epicSeedImg
                      : legendarySeedImg
                  }
                  alt=""
                  className="shop-pack-details-img"
                />
                <div className="shop-pack-details-meta">
                  <h3 className="shop-pack-details-title">
                    {selectedPackDetails === 'basic'
                      ? 'Sobre de Semillas Básico'
                      : selectedPackDetails === 'epic'
                      ? 'Sobre de Semillas Épico'
                      : 'Sobre de Semillas Legendario'}
                  </h3>
                  <span className="shop-pack-details-price">
                    💵 Precio: $
                    {selectedPackDetails === 'basic'
                      ? '3.00'
                      : selectedPackDetails === 'epic'
                      ? '5.00'
                      : '10.00'}{' '}
                    USD
                  </span>
                </div>
              </div>

              <p className="shop-pack-details-desc">
                {selectedPackDetails === 'basic'
                  ? 'Contiene 3 cartas de plantas. Probabilidades equilibradas para ampliar tu equipo inicial de combate.'
                  : selectedPackDetails === 'epic'
                  ? 'Contiene 4 cartas de plantas con 1 Rara o Épica 100% GARANTIZADA para potenciar tu jardín.'
                  : 'Contiene 5 cartas de plantas con 1 Épica o Legendaria EXCLUSIVA de máximo poder.'}
              </p>

              <div className="shop-pack-details-odds">
                <strong>🎯 PROBABILIDADES DE DROP:</strong>
                <p>
                  {selectedPackDetails === 'basic'
                    ? '60% Común | 30% Poco Común | 8% Rara | 2% Épica'
                    : selectedPackDetails === 'epic'
                    ? '40% Común | 40% Poco Común | 15% Rara | 5% Épica'
                    : '20% Común | 30% Poco Común | 30% Rara | 15% Épica | 5% Legendaria'}
                </p>
              </div>

              <div className="shop-pack-details-actions">
                <button
                  type="button"
                  className="shop-pack-btn"
                  onClick={() => {
                    const target = selectedPackDetails
                    setSelectedPackDetails(null)
                    handleBuyPacksBatch(target)
                  }}
                >
                  🛒 COMPRAR ({getQty(selectedPackDetails)}) POR $
                  {(
                    (selectedPackDetails === 'basic'
                      ? 3
                      : selectedPackDetails === 'epic'
                      ? 5
                      : 10) * getQty(selectedPackDetails)
                  ).toFixed(2)}{' '}
                  USD
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
