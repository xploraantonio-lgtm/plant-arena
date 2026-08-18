import React, { useState, useEffect, useMemo } from 'react'
import { soundManager } from '../../utils/audioManager'
import {
  MarketplaceManager,
  getPlantRarityAndMinPrice,
  type MarketListing,
  type PlantRarity,
} from '../../utils/marketplaceManager'
import type { PlantId, PlantCardInstance } from '../../types/game'
import { PLANT_CONFIGS, STAT_LABELS, type PlantStatKey } from '../../utils/gameConstants'
import { UserManager } from '../../utils/userManager'
import './Marketplace.css'

interface MarketplaceProps {
  userTokens: number
  hasVipPass: boolean
  plantCopies: Partial<Record<PlantId, number>>
  plantLevels: Partial<Record<PlantId, number>>
  plantStatRolls: Partial<Record<PlantId, PlantStatKey[]>>
  plantInstances?: PlantCardInstance[]
  unlockedPlants?: PlantId[]
  activeDeck?: PlantId[]
  activeDeckInstances?: string[]
  onDeductTokens: (amountUsd: number) => boolean
  onDonatePlant: (plantId: PlantId) => boolean
  onReceivePlant: (plantId: PlantId, level?: number, statRolls?: PlantStatKey[]) => void
  onRemovePlantInstance?: (instanceId: string) => boolean
  onUpdateDeck?: (plantIds: PlantId[], instanceIds?: string[]) => void
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
  plantCopies: _plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
  plantInstances = [],
  unlockedPlants,
  activeDeck = [],
  activeDeckInstances = [],
  onDeductTokens,
  onDonatePlant,
  onReceivePlant,
  onRemovePlantInstance,
  onUpdateDeck,
  onBuyVipPass,
  onBackToMenu,
}: MarketplaceProps) {
  const [activeTab, setActiveTab] = useState<'browse' | 'sell'>('browse')
  const [listings, setListings] = useState<MarketListing[]>(() => MarketplaceManager.getListings())
  const [activeDialog, setActiveDialog] = useState<MarketModalDialog | null>(null)

  const playerName = UserManager.getProfile().name || 'Guerrero'

  // Build the list of all individual card builds/instances from Mi Jardín
  const gardenCards = useMemo(() => {
    const cards: {
      instanceId: string
      plantId: PlantId
      level: number
      statRolls: PlantStatKey[]
      isBase: boolean
      isUnlocked: boolean
      rarity: PlantRarity
      minPrice: number
      rarityColor: string
      inDeck: boolean
    }[] = []

    const unlocked = unlockedPlants || (Object.keys(PLANT_CONFIGS) as PlantId[])

    if (plantInstances && plantInstances.length > 0) {
      plantInstances.forEach((inst) => {
        if (!unlocked.includes(inst.plantId)) return
        const rInfo = getPlantRarityAndMinPrice(inst.plantId)
        const inDeck = Boolean(
          activeDeckInstances?.includes(inst.instanceId) ||
          activeDeck?.includes(inst.plantId)
        )
        cards.push({
          instanceId: inst.instanceId,
          plantId: inst.plantId,
          level: inst.level || 0,
          statRolls: inst.statRolls || [],
          isBase: inst.isBase ?? false,
          isUnlocked: true,
          rarity: rInfo.rarity,
          minPrice: rInfo.minPrice,
          rarityColor: rInfo.color,
          inDeck,
        })
      })
    } else {
      unlocked.forEach((pId) => {
        const rInfo = getPlantRarityAndMinPrice(pId)
        cards.push({
          instanceId: `inst_base_${pId}`,
          plantId: pId,
          level: plantLevels[pId] || 0,
          statRolls: plantStatRolls[pId] || [],
          isBase: true,
          isUnlocked: true,
          rarity: rInfo.rarity,
          minPrice: rInfo.minPrice,
          rarityColor: rInfo.color,
          inDeck: Boolean(activeDeck?.includes(pId)),
        })
      })
    }

    return cards
  }, [plantInstances, unlockedPlants, plantLevels, plantStatRolls, activeDeck, activeDeckInstances])

  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(() => {
    return gardenCards[0]?.instanceId || ''
  })

  useEffect(() => {
    if (gardenCards.length > 0 && (!selectedInstanceId || !gardenCards.some((c) => c.instanceId === selectedInstanceId))) {
      setSelectedInstanceId(gardenCards[0].instanceId)
    }
  }, [gardenCards, selectedInstanceId])

  const selectedInstance = gardenCards.find((c) => c.instanceId === selectedInstanceId) || gardenCards[0]

  const currentMinPrice = selectedInstance ? selectedInstance.minPrice : 5
  const [sellPriceUsd, setSellPriceUsd] = useState<number>(currentMinPrice)

  // Ensure sellPrice is at least the minimum allowed for that rarity
  useEffect(() => {
    if (selectedInstance) {
      setSellPriceUsd((prev) => Math.max(selectedInstance.minPrice, prev))
    }
  }, [selectedInstance?.instanceId, selectedInstance?.minPrice])

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

  // BUY A LISTING (Disponible para todos los usuarios)
  const handleBuyListing = (listing: MarketListing) => {
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
          onReceivePlant(bought.plantId, bought.level, bought.statRolls)
          soundManager.playSound('victory', 1)
          showModalAlert(
            '¡COMPRA EXITOSA!',
            `Has adquirido una instancia de "${bought.plantName}" (Nivel ${bought.level}) por $${bought.priceUsd.toFixed(2)} USD.\nSe ha añadido como una nueva carta a tu inventario de Mi Jardín.`,
            '🎉',
            'success'
          )
          refreshListings()
        }
      },
      `COMPRAR ($${listing.priceUsd.toFixed(2)} USD)`,
      'CANCELAR'
    )
  }

  // SELL / LIST A CARD ON MARKETPLACE
  const handleCreateListing = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedInstance) return

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

    if (sellPriceUsd < currentMinPrice) {
      showModalAlert(
        'PRECIO INFERIOR AL MÍNIMO',
        `El precio mínimo de venta para plantas ${selectedInstance.rarity} es de $${currentMinPrice}.00 USD.\nPor favor asigna un precio de $${currentMinPrice}.00 USD o superior.`,
        '⚠️',
        'warning'
      )
      return
    }

    const pConfig = PLANT_CONFIGS[selectedInstance.plantId]

    showModalConfirm(
      'PUBLICAR OFERTA EN EL MERCADO',
      `¿Confirmas poner en venta "${pConfig.name}" (Nivel ${selectedInstance.level}) por $${sellPriceUsd.toFixed(2)} USD?\n\n⚠️ NOTA: Esta carta se retirará de tu Jardín y de tu Mazo de Batalla mientras esté publicada en el mercado.`,
      '🏷️',
      () => {
        // 1. Remove instance from player inventory
        if (onRemovePlantInstance) {
          onRemovePlantInstance(selectedInstance.instanceId)
        } else {
          onDonatePlant(selectedInstance.plantId)
        }

        // 2. Un-equip from battle deck if in deck
        if (activeDeck && onUpdateDeck) {
          const nextDeck = activeDeck.filter((_, idx) => {
            if (activeDeckInstances && activeDeckInstances[idx] === selectedInstance.instanceId) {
              return false
            }
            return true
          })
          const nextInstIds = activeDeckInstances
            ? activeDeckInstances.filter((id) => id !== selectedInstance.instanceId)
            : undefined
          onUpdateDeck(nextDeck, nextInstIds)
        }

        // 3. Create listing
        MarketplaceManager.createListing(
          playerName,
          selectedInstance.plantId,
          pConfig.name,
          pConfig.packetActive || pConfig.icon,
          selectedInstance.level,
          selectedInstance.statRolls,
          sellPriceUsd
        )

        soundManager.playSound('plantation', 0.9)
        showModalAlert(
          '¡OFERTA PUBLICADA EN EL MERCADO!',
          `"${pConfig.name}" (Nivel ${selectedInstance.level}) ha sido publicada exitosamente por $${sellPriceUsd.toFixed(2)} USD.\nLa carta permanecerá en venta y no podrá usarse en batalla hasta que sea vendida o retires la oferta.`,
          '🏷️',
          'success'
        )
        setActiveTab('browse')
        refreshListings()
      },
      `SÍ, VENDER ($${sellPriceUsd.toFixed(2)} USD)`,
      'CANCELAR'
    )
  }

  // CANCEL MY LISTING
  const handleCancelListing = (listing: MarketListing) => {
    showModalConfirm(
      'RETIRAR OFERTA DEL MERCADO',
      `¿Deseas retirar "${listing.plantName}" del mercado y recuperarla en tu Jardín para volver a usarla en batalla?`,
      '📦',
      () => {
        const canceled = MarketplaceManager.cancelListing(listing.id, playerName)
        if (canceled) {
          onReceivePlant(listing.plantId, listing.level, listing.statRolls)
          soundManager.playSound('plantation', 0.8)
          showModalAlert(
            'OFERTA RETIRADA',
            `Has retirado la oferta de "${listing.plantName}" del mercado. La carta ha vuelto a tu Jardín y ya está disponible para equipar.`,
            '📦',
            'info'
          )
          refreshListings()
        }
      },
      'RETIRAR Y RECUPERAR',
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
      {/* VIP PASS LOCK BANNER IF NOT VIP */}
      {!hasVipPass ? (
        <div className="market-vip-lock-banner">
          <div className="market-vip-lock-icon">👑</div>
          <div className="market-vip-lock-info">
            <h3>VENTA EXCLUSIVA PARA USUARIOS VIP ($10 USD)</h3>
            <p>
              Todos los jugadores pueden comprar cartas libremente en el mercado. Para <strong>vender tus propias plantas</strong> y monetizar builds, activa el Pase VIP.
            </p>
          </div>
          <button className="market-vip-buy-btn" type="button" onClick={handleDirectBuyVip}>
            👑 ACTIVAR PASE VIP ($10.00 USD)
          </button>
        </div>
      ) : (
        <div className="market-vip-active-banner">
          <span className="market-vip-badge">👑 PASE VIP ACTIVO — VENTA Y COMPRA HABILITADAS</span>
          <span>Puedes comprar y vender cartas libremente con saldo real ($USD).</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="market-nav-tabs">
        <button
          type="button"
          className="market-tab-back-btn"
          onClick={() => {
            soundManager.playSound('click', 0.5)
            onBackToMenu()
          }}
        >
          ⬅ MENÚ
        </button>
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'browse' ? 'market-tab-btn--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('browse')
          }}
        >
          🛒 EXPLORAR MERCADO ({listings.length} OFERTAS)
        </button>
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'sell' ? 'market-tab-btn--active' : ''} ${!hasVipPass ? 'market-tab-btn--locked' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            if (!hasVipPass) {
              showModalConfirm(
                'PASE VIP REQUERIDO PARA VENDER',
                'Para poner en venta cartas de tu Jardín y ganar saldo real ($USD) necesitas el Pase de Batalla VIP ($10.00 USD).\n\n¿Deseas activar tu Pase VIP ahora?',
                '👑',
                () => {
                  handleDirectBuyVip()
                },
                'ACTIVAR VIP ($10.00 USD)',
                'CANCELAR'
              )
              return
            }
            setActiveTab('sell')
          }}
          title={!hasVipPass ? 'Requiere Pase VIP para vender plantas' : 'Vender cartas de tu Jardín'}
        >
          {!hasVipPass ? '🔒 VENDER (PASE VIP)' : '🏷️ VENDER'}
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
              const rInfo = getPlantRarityAndMinPrice(item.plantId)
              return (
                <div key={item.id} className="market-item-card">
                  {/* Card Header */}
                  <div className="market-item-card__header">
                    <span className="market-item-level-tag">
                      {item.level > 0 ? `⭐ LVL ${item.level}` : '🌱 BASE'}
                    </span>
                    <span className="market-item-rarity-badge" style={{ color: rInfo.color, borderColor: rInfo.color }}>
                      {rInfo.rarity}
                    </span>
                    <span className="market-item-seller">👤 {isMine ? 'TÚ' : item.sellerName}</span>
                  </div>

                  {/* Image and Name */}
                  <div className="market-item-card__img-wrap">
                    <img src={itemIcon} alt={plantDef?.name || item.plantName} className="market-item-icon" />
                  </div>
                  <h4 className="market-item-name">{plantDef?.name || item.plantName}</h4>

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
      {activeTab === 'sell' && hasVipPass && (
        <div className="market-sell-pane">
          <div className="market-sell-form-grid">
            {/* Column 1: Select Plant from Garden */}
            <div className="market-sell-column">
              <label className="market-sell-label">
                1. Elige la Carta de tu Jardín a Vender ({gardenCards.length} disponibles)
              </label>
              <div className="market-garden-cards-list">
                {gardenCards.length === 0 ? (
                  <div className="market-empty-state">
                    <span>No tienes cartas disponibles para vender en tu Jardín.</span>
                  </div>
                ) : (
                  gardenCards.map((card) => {
                    const pConfig = PLANT_CONFIGS[card.plantId]
                    const isSelected = selectedInstance?.instanceId === card.instanceId
                    return (
                      <div
                        key={card.instanceId}
                        role="button"
                        tabIndex={0}
                        className={`market-garden-card-item ${isSelected ? 'market-garden-card-item--active' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.4)
                          setSelectedInstanceId(card.instanceId)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedInstanceId(card.instanceId)
                          }
                        }}
                      >
                        <img
                          src={pConfig?.packetActive || pConfig?.icon}
                          alt={pConfig?.name || card.plantId}
                          className="market-garden-card-item__img"
                        />
                        <div className="market-garden-card-item__info">
                          <div className="market-garden-card-item__header">
                            <span className="market-item-level-tag">
                              {card.level > 0 ? `⭐ LVL ${card.level}` : '🌱 BASE'}
                            </span>
                            <span
                              className="market-rarity-pill"
                              style={{ color: card.rarityColor, borderColor: card.rarityColor }}
                            >
                              {card.rarity}
                            </span>
                            {card.inDeck && (
                              <span className="market-deck-tag">⚔️ EN MAZO</span>
                            )}
                          </div>
                          <strong className="market-garden-card-item__name">
                            {pConfig?.name || card.plantId}
                          </strong>
                          <div className="market-garden-card-item__stats">
                            {card.statRolls.length > 0 ? (
                              formatStatRolls(card.statRolls)
                            ) : (
                              <span className="market-stat-pill market-stat-pill--none">Stats estándar</span>
                            )}
                          </div>
                        </div>
                        <div className="market-garden-card-item__price-badge">
                          Mín: ${card.minPrice}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Column 2: Configure Price & Publish */}
            <div className="market-sell-column market-sell-column--summary">
              <label className="market-sell-label">2. Fijar Precio y Confirmar Venta</label>

              {selectedInstance && (
                <form className="market-sell-preview-card" onSubmit={handleCreateListing}>
                  <div className="market-sell-preview-header">
                    <span className="market-item-level-tag">
                      {selectedInstance.level > 0 ? `⭐ LVL ${selectedInstance.level}` : '🌱 BASE'}
                    </span>
                    <span
                      className="market-rarity-pill"
                      style={{ color: selectedInstance.rarityColor, borderColor: selectedInstance.rarityColor }}
                    >
                      {selectedInstance.rarity} (Mín ${selectedInstance.minPrice} USD)
                    </span>
                  </div>

                  <img
                    src={
                      PLANT_CONFIGS[selectedInstance.plantId]?.packetActive ||
                      PLANT_CONFIGS[selectedInstance.plantId]?.icon
                    }
                    alt=""
                    className="market-preview-icon"
                  />
                  <h4>{PLANT_CONFIGS[selectedInstance.plantId]?.name}</h4>

                  {selectedInstance.inDeck && (
                    <div className="market-deck-warning">
                      ⚠️ Esta carta está equipada en tu Mazo de Batalla. Se desequipará automáticamente al ponerla en venta.
                    </div>
                  )}

                  <div className="market-item-stats-box">
                    {selectedInstance.statRolls && selectedInstance.statRolls.length > 0 ? (
                      formatStatRolls(selectedInstance.statRolls)
                    ) : (
                      <span className="market-stat-pill market-stat-pill--none">Stats estándar de fábrica</span>
                    )}
                  </div>

                  {/* Price Setting with Steppers */}
                  <div className="market-price-input-group">
                    <label>
                      Precio de Venta ($USD) — <span style={{ color: '#fde047' }}>Mínimo: ${selectedInstance.minPrice}.00 USD</span>
                    </label>
                    <div className="market-price-stepper-wrap">
                      <button
                        type="button"
                        className="market-stepper-btn"
                        disabled={sellPriceUsd <= selectedInstance.minPrice}
                        onClick={() => setSellPriceUsd((p) => Math.max(selectedInstance.minPrice, p - 1))}
                        title="Disminuir $1"
                      >
                        -
                      </button>

                      <div className="market-price-input-wrap">
                        <span>$</span>
                        <input
                          type="number"
                          step="1"
                          min={selectedInstance.minPrice}
                          max="999"
                          value={sellPriceUsd}
                          onChange={(e) => setSellPriceUsd(Math.max(0, Number(e.target.value)))}
                          required
                        />
                        <span>USD</span>
                      </div>

                      <button
                        type="button"
                        className="market-stepper-btn"
                        onClick={() => setSellPriceUsd((p) => p + 1)}
                        title="Aumentar $1"
                      >
                        +
                      </button>
                    </div>

                    {/* Quick Price Shortcuts */}
                    <div className="market-price-shortcuts">
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceUsd(selectedInstance.minPrice)}
                      >
                        MÍN (${selectedInstance.minPrice})
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceUsd((p) => p + 5)}
                      >
                        +$5
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceUsd((p) => p + 10)}
                      >
                        +$10
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!hasVipPass || sellPriceUsd < selectedInstance.minPrice}
                    className={`market-publish-btn ${!hasVipPass ? 'market-publish-btn--locked' : ''}`}
                    title={!hasVipPass ? 'Activa el Pase VIP para vender tus plantas en el mercado' : undefined}
                  >
                    {!hasVipPass
                      ? '🔒 REQUIERE PASE VIP PARA VENDER'
                      : `🏷️ PUBLICAR EN EL MERCADO POR $${sellPriceUsd.toFixed(2)} USD`}
                  </button>

                  {!hasVipPass && (
                    <button
                      type="button"
                      className="market-vip-unlock-cta"
                      onClick={handleDirectBuyVip}
                    >
                      👑 Activar Pase VIP ($10.00 USD) para habilitar ventas
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
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
