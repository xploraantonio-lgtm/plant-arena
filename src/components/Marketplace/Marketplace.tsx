import React, { useState, useEffect, useMemo } from 'react'
import { soundManager } from '../../utils/audioManager'
import {
  getPlantRarityAndMinPrice,
  type PlantRarity,
} from '../../utils/marketplaceManager'
import { SupabaseService } from '../../services/supabaseService'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import type { PlantId, PlantCardInstance } from '../../types/game'
import { PLANT_CONFIGS, STAT_LABELS, VIP_PASS_PRECIO_GEMAS, type PlantStatKey } from '../../utils/gameConstants'
import './Marketplace.css'

interface MarketplaceProps {
  /** Ya no se usa para cobrar: el saldo lo mueve el servidor. Se deja para
   *  poder avisar de saldo insuficiente antes de llamar. */
  userTokens: number
  hasVipPass: boolean
  plantCopies: Partial<Record<PlantId, number>>
  plantLevels: Partial<Record<PlantId, number>>
  plantStatRolls: Partial<Record<PlantId, PlantStatKey[]>>
  plantInstances?: PlantCardInstance[]
  unlockedPlants?: PlantId[]
  activeDeck?: PlantId[]
  activeDeckInstances?: string[]
  /**
   * Estos cinco movían el inventario y el saldo EN EL NAVEGADOR. Ya no se usan:
   * comprar, publicar y retirar los hace el servidor, que es el único que sabe
   * de quién es cada carta. Se mantienen en la interfaz del componente para no
   * tocar App.tsx, y el prefijo _ dice que están de más.
   */
  onDeductTokens?: (amountUsd: number) => boolean
  onDonatePlant?: (plantId: PlantId) => boolean
  onReceivePlant?: (plantId: PlantId, level?: number, statRolls?: PlantStatKey[]) => void
  onRemovePlantInstance?: (instanceId: string) => boolean
  onUpdateDeck?: (plantIds: PlantId[], instanceIds?: string[]) => void
  /** Para recargar el inventario y el saldo del servidor tras una operación. */
  onServerChange?: () => void
  onBuyVipPass: () => Promise<{ success: boolean; error?: string }>
  onBackToMenu: () => void
}

/**
 * Una oferta tal como la devuelve marketplace_board().
 *
 * Antes esta pantalla leía las ofertas de localStorage y cobraba en dólares de
 * mentira: las RPC de comprar, publicar y cancelar existían desde la primera
 * migración y NADIE las llamaba. O sea que ni el vendedor cobraba de verdad ni
 * la comisión del 10 % se aplicaba a nada, porque no había ventas reales.
 *
 * Ahora el mercado es del servidor: los precios van en GEMAS, el saldo lo mueve
 * buy_marketplace_card y cada venta deja su fila en el registro del panel.
 */
interface OfertaDelMercado {
  id: string
  plantId: PlantId
  nivel: number
  statRolls: PlantStatKey[]
  precio: number
  vendedor: string | null
  esMia: boolean
  desde: string
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
  onDeductTokens: _onDeductTokens,
  onDonatePlant: _onDonatePlant,
  onReceivePlant: _onReceivePlant,
  onRemovePlantInstance: _onRemovePlantInstance,
  onUpdateDeck: _onUpdateDeck,
  onServerChange,
  onBuyVipPass,
  onBackToMenu,
}: MarketplaceProps) {
  const [activeTab, setActiveTab] = useState<'browse' | 'sell'>('browse')
  const [listings, setListings] = useState<OfertaDelMercado[]>([])
  /** La comisión la manda el servidor: así el número no vive duplicado aquí. */
  const [comisionPct, setComisionPct] = useState<number>(10)
  const [cargando, setCargando] = useState(true)
  const [activeDialog, setActiveDialog] = useState<MarketModalDialog | null>(null)


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
  const [sellPriceGems, setSellPriceGems] = useState<number>(currentMinPrice)

  // Ensure sellPrice is at least the minimum allowed for that rarity
  useEffect(() => {
    if (selectedInstance) {
      setSellPriceGems((prev) => Math.max(selectedInstance.minPrice, prev))
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

  const refreshListings = async () => {
    const tablero = await SupabaseService.marketplaceBoard(60)
    if (tablero) {
      setListings(tablero.ofertas)
      setComisionPct(Number(tablero.comisionPct ?? 10))
    }
    setCargando(false)
  }

  useEffect(() => {
    void refreshListings()
  }, [])

  // Sin servidor no hay mercado. Antes había una versión en localStorage y eso
  // era peor que nada: cada jugador veía sus propias ofertas inventadas.
  const sinServidor = !isSupabaseConfigured()

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

  // COMPRAR UNA OFERTA
  //
  // El saldo lo mueve el servidor, no esta pantalla: cobra al comprador, paga al
  // vendedor su 90 %, reparte el trozo del ranking de referidos y apunta la venta
  // en el registro. Aquí sólo se pide y se recarga.
  const handleBuyListing = (item: OfertaDelMercado) => {
    if (item.esMia) {
      showModalAlert('OFERTA PROPIA', 'No puedes comprar tu propia oferta puesta en el mercado.', '⚠️', 'warning')
      return
    }
    if (userTokens < item.precio) {
      showModalAlert(
        'GEMAS INSUFICIENTES',
        `Necesitas ${item.precio} 💎 y tienes ${userTokens}. Recarga en la Tienda.`,
        '⚠️',
        'warning'
      )
      return
    }
    const nombre = PLANT_CONFIGS[item.plantId]?.name || item.plantId

    showModalConfirm(
      'CONFIRMAR COMPRA',
      `¿Deseas comprar "${nombre}" (Nivel ${item.nivel}) por ${item.precio} 💎 gemas?`,
      '🛒',
      async () => {
        const r = await SupabaseService.buyMarketplaceCard(item.id)
        if (!r.success) {
          showModalAlert('NO SE PUDO COMPRAR', r.error || 'La carta ya no está disponible.', '⚠️', 'error')
          await refreshListings()
          return
        }
        soundManager.playSound('victory', 1)
        showModalAlert(
          '¡COMPRA EXITOSA!',
          `Has adquirido "${nombre}" (Nivel ${item.nivel}) por ${item.precio} 💎.
Ya está en tu Jardín.`,
          '🎉',
          'success'
        )
        await refreshListings()
        onServerChange?.()
      },
      `COMPRAR (${item.precio} 💎)`,
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
        `El Mercado de Comercio es exclusivo para miembros con Pase VIP (${VIP_PASS_PRECIO_GEMAS} 💎 gemas).\n¿Deseas activar tu Pase VIP ahora para vender cartas y builds?`,
        '👑',
        () => {
          void onBuyVipPass()
        },
        `ACTIVAR VIP (${VIP_PASS_PRECIO_GEMAS} 💎)`,
        'CANCELAR'
      )
      return
    }

    if (sellPriceGems < currentMinPrice) {
      showModalAlert(
        'PRECIO INFERIOR AL MÍNIMO',
        `El precio mínimo de venta para plantas ${selectedInstance.rarity} es de ${currentMinPrice} 💎 gemas.`,
        '⚠️',
        'warning'
      )
      return
    }

    // Las cartas base no son instancias del servidor: no tienen fila propia en
    // plant_instances y por tanto no se pueden vender. Se dice aquí en lugar de
    // dejar que el servidor conteste «no eres el propietario», que no explica nada.
    if (!/^[0-9a-f-]{36}$/i.test(selectedInstance.instanceId)) {
      showModalAlert(
        'ESTA CARTA NO SE PUEDE VENDER',
        'Es una carta base del juego, no una instancia de tu inventario. Vende cartas obtenidas en sobres o cofres.',
        '⚠️',
        'warning'
      )
      return
    }

    const pConfig = PLANT_CONFIGS[selectedInstance.plantId]
    const comision = Math.round(sellPriceGems * comisionPct) / 100
    const neto = sellPriceGems - comision

    showModalConfirm(
      'PUBLICAR OFERTA EN EL MERCADO',
      `¿Confirmas poner en venta "${pConfig.name}" (Nivel ${selectedInstance.level}) por ${sellPriceGems} 💎?

` +
        `El comprador paga ${sellPriceGems} 💎, la comisión del mercado es del ${comisionPct} % (${comision} 💎) y tú recibes ${neto} 💎.

` +
        '⚠️ La carta se retira de tu Jardín y de tu Mazo mientras esté publicada.',
      '🏷️',
      async () => {
        // El servidor mueve la carta: la marca en venta y la saca del mazo. Esta
        // pantalla ya no toca el inventario — cuando lo hacía, una publicación
        // fallida dejaba la carta perdida en el navegador.
        const r = await SupabaseService.listMarketplaceCard(selectedInstance.instanceId, sellPriceGems)
        if (!r.success) {
          showModalAlert('NO SE PUDO PUBLICAR', r.error || 'Inténtalo de nuevo.', '⚠️', 'error')
          return
        }

        soundManager.playSound('plantation', 0.9)
        showModalAlert(
          '¡OFERTA PUBLICADA EN EL MERCADO!',
          `"${pConfig.name}" (Nivel ${selectedInstance.level}) está en venta por ${sellPriceGems} 💎.
Recibirás ${neto} 💎 cuando se venda.`,
          '🏷️',
          'success'
        )
        setActiveTab('browse')
        await refreshListings()
        onServerChange?.()
      },
      `SÍ, VENDER (${sellPriceGems} 💎)`,
      'CANCELAR'
    )
  }

  // RETIRAR MI OFERTA
  const handleCancelListing = (item: OfertaDelMercado) => {
    const nombre = PLANT_CONFIGS[item.plantId]?.name || item.plantId
    showModalConfirm(
      'RETIRAR OFERTA DEL MERCADO',
      `¿Deseas retirar "${nombre}" del mercado y recuperarla en tu Jardín?`,
      '📦',
      async () => {
        const r = await SupabaseService.cancelMarketplaceListing(item.id)
        if (!r.success) {
          showModalAlert('NO SE PUDO RETIRAR', r.error || 'Inténtalo de nuevo.', '⚠️', 'error')
          return
        }
        soundManager.playSound('plantation', 0.8)
        showModalAlert(
          'OFERTA RETIRADA',
          `"${nombre}" ha vuelto a tu Jardín y ya se puede equipar.`,
          '📦',
          'info'
        )
        await refreshListings()
        onServerChange?.()
      },
      'RETIRAR Y RECUPERAR',
      'MANTENER EN VENTA'
    )
  }

  const handleDirectBuyVip = () => {
    showModalConfirm(
      'ACTIVAR PASE VIP',
      `¿Deseas pagar ${VIP_PASS_PRECIO_GEMAS} 💎 gemas para activar tu Pase VIP de Temporada?\nDesbloquearás el Mercado de Comercio y todas las recompensas exclusivas del Pase de Batalla.`,
      '👑',
      async () => {
        const { success, error } = await onBuyVipPass()
        if (success) {
          showModalAlert('¡PASE VIP ACTIVADO!', '¡Bienvenido a la Zona VIP!\nAhora tienes acceso total al Mercado para comprar y vender cartas libremente.', '🎉', 'success')
        } else {
          // Mensaje del servidor: distingue saldo insuficiente de "ya lo tienes".
          showModalAlert('NO SE PUDO ACTIVAR', error || 'El servidor rechazó la compra del pase VIP.', '⚠️', 'warning')
        }
      },
      `ACTIVAR (${VIP_PASS_PRECIO_GEMAS} 💎)`,
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
            <h3>VENTA EXCLUSIVA PARA USUARIOS VIP ({VIP_PASS_PRECIO_GEMAS} 💎)</h3>
            <p>
              Todos los jugadores pueden comprar cartas libremente en el mercado. Para <strong>vender tus propias plantas</strong> y monetizar builds, activa el Pase VIP.
            </p>
          </div>
          <button className="market-vip-buy-btn" type="button" onClick={handleDirectBuyVip}>
            👑 ACTIVAR PASE VIP ({VIP_PASS_PRECIO_GEMAS} 💎)
          </button>
        </div>
      ) : (
        <div className="market-vip-active-banner">
          <span className="market-vip-badge">👑 PASE VIP ACTIVO — VENTA Y COMPRA HABILITADAS</span>
          <span>Compra y vende cartas con gemas. El mercado se queda un {comisionPct} % de cada venta.</span>
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
                `Para poner en venta cartas de tu Jardín y ganar gemas necesitas el Pase de Batalla VIP (${VIP_PASS_PRECIO_GEMAS} 💎).\n\n¿Deseas activar tu Pase VIP ahora?`,
                '👑',
                () => {
                  handleDirectBuyVip()
                },
                `ACTIVAR VIP (${VIP_PASS_PRECIO_GEMAS} 💎)`,
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
          {sinServidor ? (
            <div className="market-empty-state">
              <span>
                🔌 El mercado necesita conexión con el servidor: es él quien mueve
                las gemas y las cartas. Vuelve a entrar cuando haya conexión.
              </span>
            </div>
          ) : cargando ? (
            <div className="market-empty-state"><span>Cargando ofertas…</span></div>
          ) : listings.length === 0 ? (
            <div className="market-empty-state">
              <span>🛒 No hay ofertas en el mercado en este momento. ¡Sé el primero en vender una carta!</span>
            </div>
          ) : (
            listings.map((item) => {
              const isMine = item.esMia
              const plantDef = PLANT_CONFIGS[item.plantId]
              const itemIcon = plantDef?.packetActive || plantDef?.icon
              const rInfo = getPlantRarityAndMinPrice(item.plantId)
              return (
                <div key={item.id} className="market-item-card">
                  {/* Card Header */}
                  <div className="market-item-card__header">
                    <span className="market-item-level-tag">
                      {item.nivel > 0 ? `⭐ LVL ${item.nivel}` : '🌱 BASE'}
                    </span>
                    <span className="market-item-rarity-badge" style={{ color: rInfo.color, borderColor: rInfo.color }}>
                      {rInfo.rarity}
                    </span>
                    <span className="market-item-seller">👤 {isMine ? 'TÚ' : item.vendedor ?? 'Jugador'}</span>
                  </div>

                  {/* Image and Name */}
                  <div className="market-item-card__img-wrap">
                    <img src={itemIcon} alt={plantDef?.name || item.plantId} className="market-item-icon" />
                  </div>
                  <h4 className="market-item-name">{plantDef?.name || item.plantId}</h4>

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
                      <span className="market-price-val">{item.precio} 💎</span>
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
                      {selectedInstance.rarity} (Mín {selectedInstance.minPrice} 💎)
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
                      Precio de Venta (💎 gemas) —{' '}
                      <span style={{ color: '#fde047' }}>Mínimo: {selectedInstance.minPrice} 💎</span>
                    </label>
                    <div className="market-price-stepper-wrap">
                      <button
                        type="button"
                        className="market-stepper-btn"
                        disabled={sellPriceGems <= selectedInstance.minPrice}
                        onClick={() => setSellPriceGems((p) => Math.max(selectedInstance.minPrice, p - 1))}
                        title="Bajar 1 gema"
                      >
                        -
                      </button>

                      <div className="market-price-input-wrap">
                        <span>💎</span>
                        <input
                          type="number"
                          step="1"
                          min={selectedInstance.minPrice}
                          max="999"
                          value={sellPriceGems}
                          onChange={(e) => setSellPriceGems(Math.max(0, Number(e.target.value)))}
                          required
                        />
                        <span>gemas</span>
                      </div>

                      <button
                        type="button"
                        className="market-stepper-btn"
                        onClick={() => setSellPriceGems((p) => p + 1)}
                        title="Subir 1 gema"
                      >
                        +
                      </button>
                    </div>

                    {/* Quick Price Shortcuts */}
                    <div className="market-price-shortcuts">
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems(selectedInstance.minPrice)}
                      >
                        MÍN (${selectedInstance.minPrice})
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems((p) => p + 5)}
                      >
                        +5 💎
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems((p) => p + 10)}
                      >
                        +10 💎
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!hasVipPass || sellPriceGems < selectedInstance.minPrice}
                    className={`market-publish-btn ${!hasVipPass ? 'market-publish-btn--locked' : ''}`}
                    title={!hasVipPass ? 'Activa el Pase VIP para vender tus plantas en el mercado' : undefined}
                  >
                    {!hasVipPass
                      ? '🔒 REQUIERE PASE VIP PARA VENDER'
                      : `🏷️ PUBLICAR POR ${sellPriceGems} 💎 · recibes ${sellPriceGems - Math.round(sellPriceGems * comisionPct) / 100} 💎`}
                  </button>

                  {!hasVipPass && (
                    <button
                      type="button"
                      className="market-vip-unlock-cta"
                      onClick={handleDirectBuyVip}
                    >
                      👑 Activar Pase VIP ({VIP_PASS_PRECIO_GEMAS} 💎) para habilitar ventas
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
