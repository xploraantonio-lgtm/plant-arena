import React, { useState, useEffect } from 'react'
import { soundManager } from '../../utils/audioManager'
import {
  MarketplaceManager,
  type MarketListing,
} from '../../utils/marketplaceManager'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS, STAT_LABELS, type PlantStatKey } from '../../utils/gameConstants'
import './Marketplace.css'

interface MarketplaceProps {
  userTokens: number
  hasVipPass: boolean
  plantCopies: Record<PlantId, number>
  plantLevels: Record<PlantId, number>
  plantStatRolls: Record<PlantId, PlantStatKey[]>
  onDeductTokens: (amountUsd: number) => boolean
  onDonatePlant: (plantId: PlantId) => boolean // Deducts 1 copy
  onReceivePlant: (plantId: PlantId) => void // Adds 1 copy
  onBuyVipPass: () => boolean
  onBackToMenu: () => void
}

interface MarketModalDialog {
  title: string
  message: string
  icon: string
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm'
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void
}

export default function Marketplace({
  userTokens,
  hasVipPass,
  plantCopies,
  plantLevels,
  plantStatRolls,
  onDeductTokens,
  onDonatePlant,
  onReceivePlant,
  onBuyVipPass,
  onBackToMenu,
}: MarketplaceProps) {
  const [activeTab, setActiveTab] = useState<'browse' | 'sell'>('browse')
  const [listings, setListings] = useState<MarketListing[]>(() => MarketplaceManager.getListings())
  const [selectedSellPlant, setSelectedSellPlant] = useState<PlantId>('peashooter')
  const [sellPriceUsd, setSellPriceUsd] = useState<number>(3.0)
  const [activeDialog, setActiveDialog] = useState<MarketModalDialog | null>(null)

  const playerName = 'DRAGONMASTER'

  const showModalAlert = (
    title: string,
    message: string,
    icon = 'ℹ️',
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) => {
    setActiveDialog({ title, message, icon, type, confirmText: 'ENTENDIDO' })
  }

  const showModalConfirm = (
    title: string,
    message: string,
    icon: string,
    onConfirm: () => void,
    confirmText = 'CONFIRMAR',
    cancelText = 'CANCELAR'
  ) => {
    setActiveDialog({
      title,
      message,
      icon,
      type: 'confirm',
      confirmText,
      cancelText,
      onConfirm,
    })
  }

  const refreshListings = () => {
    setListings(MarketplaceManager.getListings())
  }

  useEffect(() => {
    refreshListings()
  }, [])

  // Helper to format rolls in clean pills
  const formatStatRolls = (rolls: PlantStatKey[] = []) => {
    if (!rolls || rolls.length === 0) return null
    const counts: Partial<Record<PlantStatKey, number>> = {}
    rolls.forEach((stat) => {
      counts[stat] = (counts[stat] || 0) + 1
    })

    return Object.entries(counts).map(([key, count]) => {
      const statKey = key as PlantStatKey
      const totalPct = (count || 1) * 15
      const countTag = count && count > 1 ? ` (x${count})` : ''
      const statDef = STAT_LABELS[statKey]
      const label = statDef ? statDef.label : statKey
      const icon = statDef ? statDef.icon : '⚡'

      return (
        <span key={statKey} className="market-stat-pill">
          {icon} +{totalPct}% {label}{countTag}
        </span>
      )
    })
  }

  // BUY A LISTING
  const handleBuyListing = (listing: MarketListing) => {
    if (!hasVipPass) {
      showModalConfirm(
        'PASE VIP REQUERIDO',
        'El Mercado de Comercio es exclusivo para miembros con Pase VIP ($10.00 USD).\n¿Deseas activar tu Pase VIP ahora para comprar y vender cartas libremente?',
        '👑',
        () => {
          onBuyVipPass()
        },
        'ACTIVAR VIP ($10.00)',
        'CANCELAR'
      )
      return
    }
    if (listing.sellerName === playerName) {
      showModalAlert('OFERTA PROPIA', 'No puedes comprar tu propia oferta puesta en el mercado.', '⚠️', 'warning')
      return
    }
    if (userTokens < listing.priceUsd) {
      showModalAlert('SALDO INSUFICIENTE', `Saldo insuficiente ($${listing.priceUsd.toFixed(2)} USD requeridos).\nRecarga saldo en la Tienda o en el banco.`, '⚠️', 'warning')
      return
    }

    showModalConfirm(
      'CONFIRMAR COMPRA',
      `¿Deseas comprar "${listing.plantName}" (Nivel ${listing.level}) por $${listing.priceUsd.toFixed(2)} USD?`,
      '🛒',
      () => {
        const deducted = onDeductTokens(listing.priceUsd)
        if (!deducted) return

        const bought = MarketplaceManager.buyListing(listing.id)
        if (bought) {
          onReceivePlant(bought.plantId)
          soundManager.playSound('victory', 1)
          showModalAlert('¡COMPRA EXITOSA!', `Has adquirido una copia de "${bought.plantName}" por $${bought.priceUsd.toFixed(2)} USD.\nSe ha añadido a tu inventario.`, '🎉', 'success')
          refreshListings()
        }
      },
      `COMPRAR ($${listing.priceUsd.toFixed(2)} USD)`,
      'CANCELAR'
    )
  }

  // SELL A PLANT / BUILD
  const handleCreateListing = (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasVipPass) {
      showModalConfirm(
        'PASE VIP REQUERIDO',
        'El Mercado de Comercio es exclusivo para miembros con Pase VIP ($10.00 USD).\n¿Deseas activar tu Pase VIP ahora para vender cartas y builds?',
        '👑',
        () => {
          onBuyVipPass()
        },
        'ACTIVAR VIP ($10.00)',
        'CANCELAR'
      )
      return
    }

    const availableCopies = plantCopies[selectedSellPlant] || 0
    // STRICT VALIDATION: Must keep at least 1 own copy
    if (availableCopies <= 1) {
      showModalAlert(
        'VALIDACIÓN DE SEGURIDAD',
        `Debes conservar al menos 1 copia propia de "${PLANT_CONFIGS[selectedSellPlant].name}". Tienes ${availableCopies} copia(s).`,
        '🛑',
        'error'
      )
      return
    }

    if (sellPriceUsd <= 0 || sellPriceUsd > 100) {
      showModalAlert('PRECIO NO VÁLIDO', 'Ingresa un precio válido entre $0.50 y $100.00 USD.', '⚠️', 'warning')
      return
    }

    // Deduct 1 copy from player
    const deducted = onDonatePlant(selectedSellPlant)
    if (!deducted) {
      showModalAlert('ERROR', 'Error al descontar la copia del inventario.', '⚠️', 'error')
      return
    }

    const pConfig = PLANT_CONFIGS[selectedSellPlant]
    const pLevel = plantLevels[selectedSellPlant] || 0
    const pRolls = plantStatRolls[selectedSellPlant] || []

    MarketplaceManager.createListing(
      playerName,
      selectedSellPlant,
      pConfig.name,
      pConfig.packetActive || pConfig.icon,
      pLevel,
      pRolls,
      sellPriceUsd
    )

    soundManager.playSound('plantation', 0.9)
    showModalAlert('¡OFERTA PUBLICADA!', `"${pConfig.name}" puesta en venta en el Mercado por $${sellPriceUsd.toFixed(2)} USD.`, '🏷️', 'success')
    setActiveTab('browse')
    refreshListings()
  }

  // CANCEL MY LISTING
  const handleCancelListing = (listing: MarketListing) => {
    showModalConfirm(
      'RETIRAR OFERTA',
      `¿Deseas retirar "${listing.plantName}" del mercado y recuperar tu copia en el inventario?`,
      '📦',
      () => {
        const canceled = MarketplaceManager.cancelListing(listing.id, playerName)
        if (canceled) {
          onReceivePlant(listing.plantId)
          soundManager.playSound('plantation', 0.8)
          showModalAlert('OFERTA RETIRADA', `Has retirado la oferta de "${listing.plantName}" y recuperado tu copia.`, '📦', 'info')
          refreshListings()
        }
      },
      'RETIRAR OFERTA',
      'MANTENER EN VENTA'
    )
  }

  const handleDirectBuyVip = () => {
    showModalConfirm(
      'ACTIVAR PASE VIP',
      '¿Deseas pagar $10.00 USD para activar tu Pase VIP de Temporada?\nDesbloquearás el Mercado de Comercio y todas las recompensas exclusivas del Pase de Batalla.',
      '👑',
      () => {
        const success = onBuyVipPass()
        if (success) {
          showModalAlert('¡PASE VIP ACTIVADO!', '¡Bienvenido a la Zona VIP!\nAhora tienes acceso total al Mercado para comprar y vender cartas libremente.', '🎉', 'success')
        } else {
          showModalAlert('SALDO INSUFICIENTE', 'Saldo insuficiente ($10.00 USD requeridos). Recarga saldo en la Tienda.', '⚠️', 'warning')
        }
      },
      'ACTIVAR ($10.00 USD)',
      'CANCELAR'
    )
  }

  return (
    <div className="market-container">
      {/* Top Header */}
      <div className="market-header">
        <button className="market-back-btn" type="button" onClick={onBackToMenu}>
          ⬅ VOLVER AL MENÚ
        </button>
        <h2 className="market-header__title">🤝 MERCADO DE COMERCIO DE PLANTAS & BUILDS</h2>
        <div className="market-header__tokens">
          <span>💵 Saldo: ${userTokens.toFixed(2)} USD</span>
        </div>
      </div>

      {/* VIP PASS LOCK BANNER IF NOT VIP */}
      {!hasVipPass ? (
        <div className="market-vip-lock-banner">
          <div className="market-vip-lock-icon">👑</div>
          <div className="market-vip-lock-info">
            <h3>MERCADO EXCLUSIVO PARA USUARIOS VIP ($10 USD)</h3>
            <p>
              Solo los jugadores con el <strong>Pase de Temporada VIP</strong> activo tienen autorización para vender cartas mejoradas,
              comerciar builds únicas y comprar plantas en el mercado libre.
            </p>
          </div>
          <button className="market-vip-buy-btn" type="button" onClick={handleDirectBuyVip}>
            👑 ACTIVAR PASE VIP ($10.00 USD)
          </button>
        </div>
      ) : (
        <div className="market-vip-active-banner">
          <span className="market-vip-badge">👑 PASE VIP ACTIVO — COMERCIO AUTORIZADO</span>
          <span>Vende copias excedentes y compra builds de otros jugadores con dinero real ($USD).</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="market-nav-tabs">
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'browse' ? 'market-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          🛒 EXPLORAR MERCADO ({listings.length} OFERTAS)
        </button>
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'sell' ? 'market-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('sell')}
        >
          🏷️ PONER EN VENTA MI CARTA
        </button>
      </div>

      {/* TAB 1: BROWSE LISTINGS */}
      {activeTab === 'browse' && (
        <div className="market-listings-grid">
          {listings.length === 0 ? (
            <div className="market-empty-state">
              <span>🛒 No hay ofertas en el mercado en este momento. ¡Sé el primero en vender una carta!</span>
            </div>
          ) : (
            listings.map((item) => {
              const isMine = item.sellerName === playerName
              const plantDef = PLANT_CONFIGS[item.plantId]
              const itemIcon = plantDef?.packetActive || plantDef?.icon || item.plantIcon
              return (
                <div key={item.id} className="market-item-card">
                  {/* Card Header */}
                  <div className="market-item-card__header">
                    <span className="market-item-level-tag">
                      {item.level > 0 ? `⭐ LVL ${item.level}` : '🌱 BASE'}
                    </span>
                    <span className="market-item-seller">👤 {isMine ? 'TÚ' : item.sellerName}</span>
                  </div>

                  {/* Image and Name */}
                  <div className="market-item-card__img-wrap">
                    <img src={itemIcon} alt={item.plantName} className="market-item-icon" />
                  </div>
                  <h4 className="market-item-name">{item.plantName}</h4>

                  {/* Stat Rolls Pills */}
                  <div className="market-item-stats-box">
                    {item.statRolls && item.statRolls.length > 0 ? (
                      formatStatRolls(item.statRolls)
                    ) : (
                      <span className="market-stat-pill market-stat-pill--none">Stats estándar de fábrica</span>
                    )}
                  </div>

                  {/* Price and Action Button */}
                  <div className="market-item-card__footer">
                    <div className="market-item-price-box">
                      <span className="market-price-label">PRECIO</span>
                      <span className="market-price-val">${item.priceUsd.toFixed(2)} USD</span>
                    </div>

                    {isMine ? (
                      <button
                        type="button"
                        className="market-cancel-btn"
                        onClick={() => handleCancelListing(item)}
                      >
                        RETIRAR
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="market-buy-btn"
                        onClick={() => handleBuyListing(item)}
                      >
                        COMPRAR
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* TAB 2: SELL MY PLANT */}
      {activeTab === 'sell' && (
        <form className="market-sell-pane" onSubmit={handleCreateListing}>
          <div className="market-sell-info-banner">
            <strong>📋 REGLAS DE COMERCIO:</strong>
            <ul>
              <li>Solo puedes vender copias excedentes. <strong>Siempre debes quedarte con al menos 1 copia propia</strong>.</li>
              <li>La carta se vende con su nivel de mejora y estadísticas actuales.</li>
              <li>Al venderse, el dinero ($USD) se añade directamente a tu saldo de tokens.</li>
            </ul>
          </div>

          <div className="market-sell-form-grid">
            {/* Step 1: Select Plant */}
            <div className="market-sell-column">
              <label className="market-sell-label">1. Selecciona la Planta a Vender</label>
              <div className="market-sell-picker-grid">
                {(Object.keys(PLANT_CONFIGS) as PlantId[]).map((pId) => {
                  const pConfig = PLANT_CONFIGS[pId]
                  const copies = plantCopies[pId] || 0
                  const isSelected = selectedSellPlant === pId
                  const canSell = copies > 1

                  return (
                    <button
                      key={pId}
                      type="button"
                      disabled={!canSell}
                      className={`market-picker-btn ${isSelected ? 'market-picker-btn--active' : ''} ${
                        !canSell ? 'market-picker-btn--disabled' : ''
                      }`}
                      onClick={() => setSelectedSellPlant(pId)}
                    >
                      <img src={pConfig.packetActive || pConfig.icon} alt={pConfig.name} />
                      <span className="market-picker-btn__name">{pConfig.name}</span>
                      <small className={canSell ? 'market-copies--ok' : 'market-copies--low'}>
                        {copies} copias {canSell ? '✓' : '(Mín 1)'}
                      </small>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2: Selected Preview & Price */}
            <div className="market-sell-column market-sell-column--summary">
              <label className="market-sell-label">2. Detalles y Precio de Venta</label>
              
              <div className="market-sell-preview-card">
                <div className="market-sell-preview-header">
                  <span className="market-item-level-tag">
                    {(plantLevels[selectedSellPlant] || 0) > 0
                      ? `⭐ LVL ${plantLevels[selectedSellPlant]}`
                      : '🌱 BASE'}
                  </span>
                  <span className="market-preview-copies">
                    Tienes {plantCopies[selectedSellPlant] || 0} copias (Te quedarán {(plantCopies[selectedSellPlant] || 0) - 1})
                  </span>
                </div>

                <img
                  src={PLANT_CONFIGS[selectedSellPlant].packetActive || PLANT_CONFIGS[selectedSellPlant].icon}
                  alt=""
                  className="market-preview-icon"
                />
                <h4>{PLANT_CONFIGS[selectedSellPlant].name}</h4>

                <div className="market-item-stats-box">
                  {plantStatRolls[selectedSellPlant] && plantStatRolls[selectedSellPlant].length > 0 ? (
                    formatStatRolls(plantStatRolls[selectedSellPlant])
                  ) : (
                    <span className="market-stat-pill market-stat-pill--none">Stats estándar de fábrica</span>
                  )}
                </div>

                <div className="market-price-input-group">
                  <label>Fijar Precio de Venta ($USD):</label>
                  <div className="market-price-input-wrap">
                    <span>$</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="100"
                      value={sellPriceUsd}
                      onChange={(e) => setSellPriceUsd(Number(e.target.value))}
                      required
                    />
                    <span>USD</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={(plantCopies[selectedSellPlant] || 0) <= 1}
                  className="market-publish-btn"
                >
                  {(plantCopies[selectedSellPlant] || 0) <= 1
                    ? '🔒 NO PUEDES VENDER (MÍNIMO 1 COPIA REQUERIDA)'
                    : `🏷️ PUBLICAR EN VENTA POR $${sellPriceUsd.toFixed(2)} USD`}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* CUSTOM IN-GAME POPUP DIALOG */}
      {activeDialog && (
        <div className="clan-dialog-backdrop" onClick={() => activeDialog.type !== 'confirm' && setActiveDialog(null)}>
          <div
            className={`clan-dialog-card clan-dialog-card--${activeDialog.type}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="clan-dialog-icon-ring">
              <span className="clan-dialog-icon">{activeDialog.icon}</span>
            </div>
            <h3 className="clan-dialog-title">{activeDialog.title}</h3>
            <p className="clan-dialog-msg">{activeDialog.message}</p>

            <div className="clan-dialog-actions">
              {activeDialog.type === 'confirm' && (
                <button
                  type="button"
                  className="clan-dialog-btn clan-dialog-btn--cancel"
                  onClick={() => setActiveDialog(null)}
                >
                  {activeDialog.cancelText || 'CANCELAR'}
                </button>
              )}
              <button
                type="button"
                className="clan-dialog-btn clan-dialog-btn--confirm"
                onClick={() => {
                  const confirmCb = activeDialog.onConfirm
                  setActiveDialog(null)
                  if (confirmCb) {
                    confirmCb()
                  }
                }}
              >
                {activeDialog.confirmText || 'ENTENDIDO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
