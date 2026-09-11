import React, { useState, useEffect, useMemo } from 'react'
import { soundManager } from '../../utils/audioManager'
import {
  getPlantRarityAndMinPrice,
  FARMING_ITEM_MIN_PRICES,
  type PlantRarity,
} from '../../utils/marketplaceManager'
import {
  FARMING_ITEM_DEFINITIONS,
  type FarmingInventory,
  type FarmingItemId,
} from '../../utils/pvpRewardManager'
import { marketplaceService, type GlobalTransactionItem } from '../../services/marketplaceService'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import type { PlantId, PlantCardInstance } from '../../types/game'
import { PLANT_CONFIGS, STAT_LABELS, VIP_PASS_PRECIO_GEMAS, type PlantStatKey } from '../../utils/gameConstants'
import { evaluateMarketplaceAccess } from '../../utils/marketplaceAccess'
import './Marketplace.css'

function formatTxTime(dateStr?: string): string {
  if (!dateStr) return 'Reciente'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  if (isNaN(diffMs)) return 'Reciente'
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return 'Hace un momento'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `Hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Hace ${days} d`
  return new Date(dateStr).toLocaleDateString()
}


interface MarketplaceProps {
  /** Ya no se usa para cobrar: el saldo lo mueve el servidor. Se deja para
   *  poder avisar de saldo insuficiente antes de llamar. */
  userTokens: number
  userElo?: number
  hasVipPass: boolean
  farmingItems?: FarmingInventory
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
  itemType?: 'plant' | 'farming'
  itemId?: string
  quantity?: number
  plantId?: PlantId
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

export type SellableMarketItem =
  | {
      kind: 'plant'
      id: string
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
      name: string
      icon: string
    }
  | {
      kind: 'farming'
      id: string
      itemId: FarmingItemId
      name: string
      icon: string
      fallbackIcon: string
      minPrice: number
      availableQty: number
      description: string
      rarity: string
      rarityColor: string
    }

export default function Marketplace({
  userTokens,
  userElo,
  hasVipPass,
  farmingItems,
  plantCopies: _plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
  plantInstances = [],
  unlockedPlants,
  activeDeck = [],
  activeDeckInstances = [],
  onDeductTokens,
  onDonatePlant: _onDonatePlant,
  onReceivePlant: _onReceivePlant,
  onRemovePlantInstance: _onRemovePlantInstance,
  onUpdateDeck: _onUpdateDeck,
  onServerChange,
  onBuyVipPass,
  onBackToMenu,
}: MarketplaceProps) {
  const [activeTab, setActiveTab] = useState<'browse' | 'sell' | 'transactions'>('browse')
  const [listings, setListings] = useState<OfertaDelMercado[]>([])
  const [transactions, setTransactions] = useState<GlobalTransactionItem[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txFilter, setTxFilter] = useState<'all' | 'marketplace' | 'withdrawal' | 'shop' | 'reward'>('all')
  /** La comisión la manda el servidor: así el número no vive duplicado aquí. */
  const [comisionPct, setComisionPct] = useState<number>(10)
  const [cargando, setCargando] = useState(true)
  const [activeDialog, setActiveDialog] = useState<MarketModalDialog | null>(null)


  const accessInfo = useMemo(() => {
    return evaluateMarketplaceAccess(hasVipPass, userElo)
  }, [hasVipPass, userElo])

  const canSell = accessInfo.canSell
  const copasActuales = accessInfo.copasActuales


  // Lista unificada de cartas de plantas e ítems de farming vendibles
  const sellableItems = useMemo<SellableMarketItem[]>(() => {
    const items: SellableMarketItem[] = []
    const unlocked = unlockedPlants || (Object.keys(PLANT_CONFIGS) as PlantId[])

    // 1. Cartas de Plantas
    if (plantInstances && plantInstances.length > 0) {
      plantInstances.forEach((inst) => {
        if (!unlocked.includes(inst.plantId)) return
        const rInfo = getPlantRarityAndMinPrice(inst.plantId)
        const inDeck = Boolean(
          activeDeckInstances?.includes(inst.instanceId) ||
          activeDeck?.includes(inst.plantId)
        )
        const pConfig = PLANT_CONFIGS[inst.plantId]
        items.push({
          kind: 'plant',
          id: inst.instanceId,
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
          name: pConfig?.name || inst.plantId,
          icon: pConfig?.packetActive || pConfig?.icon || '',
        })
      })
    } else {
      unlocked.forEach((pId) => {
        const rInfo = getPlantRarityAndMinPrice(pId)
        const pConfig = PLANT_CONFIGS[pId]
        items.push({
          kind: 'plant',
          id: `inst_base_${pId}`,
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
          name: pConfig?.name || pId,
          icon: pConfig?.packetActive || pConfig?.icon || '',
        })
      })
    }

    // 2. Ítems de Farming del jugador
    if (farmingItems) {
      const order: FarmingItemId[] = [
        'water',
        'fertilizer',
        'shovel_fragment',
        'pesticide',
        'scarecrow_fragment',
        'shovel',
        'scarecrow',
      ]
      order.forEach((fId) => {
        const qty = Number(farmingItems[fId] || 0)
        if (qty > 0) {
          const def = FARMING_ITEM_DEFINITIONS[fId]
          const minP = FARMING_ITEM_MIN_PRICES[fId] || 100
          items.push({
            kind: 'farming',
            id: `farming_${fId}`,
            itemId: fId,
            name: def?.label || fId,
            icon: def?.icon || '',
            fallbackIcon: def?.fallback || '🌾',
            minPrice: minP,
            availableQty: qty,
            description: def?.description || 'Recurso oficial de cultivo.',
            rarity: 'FARMING',
            rarityColor: '#4ade80',
          })
        }
      })
    }

    return items
  }, [plantInstances, unlockedPlants, plantLevels, plantStatRolls, activeDeck, activeDeckInstances, farmingItems])

  const [selectedItemId, setSelectedItemId] = useState<string>(() => {
    return sellableItems[0]?.id || ''
  })

  useEffect(() => {
    if (sellableItems.length > 0 && (!selectedItemId || !sellableItems.some((c) => c.id === selectedItemId))) {
      setSelectedItemId(sellableItems[0].id)
    }
  }, [sellableItems, selectedItemId])

  const selectedItem = sellableItems.find((c) => c.id === selectedItemId) || sellableItems[0]

  const currentMinPrice = selectedItem ? selectedItem.minPrice : 100
  const [sellPriceGems, setSellPriceGems] = useState<number>(currentMinPrice)

  // Asegurar que el precio de venta sea al menos el mínimo permitido para este ítem
  useEffect(() => {
    if (selectedItem) {
      setSellPriceGems((prev) => Math.max(selectedItem.minPrice, prev))
    }
  }, [selectedItem?.id, selectedItem?.minPrice])

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
    const tablero = await marketplaceService.marketplaceBoard(60)
    if (tablero) {
      setListings(tablero.ofertas)
      setComisionPct(Number(tablero.comisionPct ?? 10))
    }
    setCargando(false)
  }

  const refreshTransactions = async () => {
    setTxLoading(true)
    try {
      const data = await marketplaceService.getGlobalTransactions(60)
      setTransactions(data || [])
    } catch (e) {
      console.warn('Error cargando transacciones globales:', e)
    } finally {
      setTxLoading(false)
    }
  }

  useEffect(() => {
    void refreshListings()
    void refreshTransactions()
  }, [])

  useEffect(() => {
    if (activeTab === 'transactions') {
      void refreshTransactions()
    }
  }, [activeTab])

  const filteredTransactions = useMemo(() => {
    if (txFilter === 'all') return transactions
    if (txFilter === 'marketplace') return transactions.filter((t) => t.type === 'marketplace_sale')
    if (txFilter === 'withdrawal') return transactions.filter((t) => t.type === 'withdrawal')
    if (txFilter === 'shop') return transactions.filter((t) => t.type === 'shop_pack' || t.type === 'shop_gold')
    if (txFilter === 'reward') return transactions.filter((t) => t.type === 'lottery_win' || t.type === 'reward_code' || t.type === 'tournament_reward')
    return transactions
  }, [transactions, txFilter])

  const txStats = useMemo(() => {
    let totalP2pGems = 0
    let totalWithdrawGems = 0
    transactions.forEach((t) => {
      if (t.type === 'marketplace_sale' && t.amountGems) {
        totalP2pGems += t.amountGems
      }
      if (t.type === 'withdrawal') {
        totalWithdrawGems += t.amountGems || (t.amountUsd ? Math.round(t.amountUsd * 100) : 0)
      }
    })
    return {
      total: transactions.length,
      p2pGems: totalP2pGems,
      withdrawGems: totalWithdrawGems,
    }
  }, [transactions])


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
    // ¡Todos los jugadores pueden comprar! La prohibición de copas/pase es exclusivamente para vender.
    if (userTokens < item.precio) {
      showModalAlert(
        'GEMAS INSUFICIENTES',
        `Necesitas ${item.precio} 💎 y tienes ${userTokens}. Recarga en la Tienda.`,
        '⚠️',
        'warning'
      )
      return
    }

    const isFarming = item.itemType === 'farming' || Boolean(item.itemId && FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId])
    const nombre = isFarming
      ? (FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId]?.label || item.itemId || 'Recurso')
      : (item.plantId && PLANT_CONFIGS[item.plantId as PlantId]?.name || item.plantId || 'Carta')
    const detalle = isFarming
      ? `1x "${nombre}"`
      : `"${nombre}" (Nivel ${item.nivel})`

    showModalConfirm(
      'CONFIRMAR COMPRA',
      `¿Deseas comprar ${detalle} por ${item.precio} 💎 gemas?`,
      '🛒',
      async () => {
        const r = await marketplaceService.buyMarketplaceCard(item.id)
        if (!r.success) {
          showModalAlert('NO SE PUDO COMPRAR', r.error || 'La oferta ya no está disponible.', '⚠️', 'error')
          await refreshListings()
          return
        }
        soundManager.playSound('victory', 1)

        // Refresco inmediato de saldo e inventario en UI y backend
        onDeductTokens?.(item.precio)
        window.dispatchEvent(new Event('refresh_user_balance'))
        window.dispatchEvent(new Event('refresh_user_inventory'))

        if (onServerChange) {
          try {
            await onServerChange()
          } catch (err) {
            console.warn('[Marketplace] Error refrescando estado tras compra:', err)
          }
        }

        showModalAlert(
          '¡COMPRA EXITOSA!',
          `Has adquirido ${detalle} por ${item.precio} 💎.\nYa está en tu ${isFarming ? 'inventario de cultivo' : 'Jardín'}.`,
          '🎉',
          'success'
        )
        await refreshListings()
        void refreshTransactions()
      },
      `COMPRAR (${item.precio} 💎)`,
      'CANCELAR'
    )
  }

  // SELL / LIST A CARD OR FARMING ITEM ON MARKETPLACE
  const handleCreateListing = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return

    if (!canSell) {
      showModalConfirm(
        'VENTAS BLOQUEADAS',
        `Todos los jugadores pueden comprar ofertas en el mercado libremente.\n\nPara poner en venta cartas o ítems de tu Jardín necesitas el Pase PvP o alcanzar 1,350 Copas en la Arena.\n\nTus copas actuales: ${copasActuales} / 1,350.\n\n¿Deseas activar tu Pase PvP (${VIP_PASS_PRECIO_GEMAS} 💎) ahora?`,
        '🔒',
        () => {
          handleDirectBuyVip()
        },
        `ACTIVAR PASE PVP (${VIP_PASS_PRECIO_GEMAS} 💎)`,
        'CANCELAR'
      )
      return
    }

    if (sellPriceGems < selectedItem.minPrice) {
      showModalAlert(
        'PRECIO INFERIOR AL MÍNIMO',
        `El precio mínimo de venta para "${selectedItem.name}" es de ${selectedItem.minPrice} 💎 gemas.`,
        '⚠️',
        'warning'
      )
      return
    }

    const comision = Math.round(sellPriceGems * comisionPct) / 100
    const neto = sellPriceGems - comision

    if (selectedItem.kind === 'farming') {
      showModalConfirm(
        'PUBLICAR ÍTEM EN EL MERCADO',
        `¿Confirmas poner en venta 1x "${selectedItem.name}" por ${sellPriceGems} 💎?\n\n` +
          `El comprador paga ${sellPriceGems} 💎, la comisión del mercado es del ${comisionPct} % (${comision} 💎) y tú recibes ${neto} 💎.\n\n` +
          '⚠️ El recurso se descontará de tu inventario mientras esté publicado en el mercado.',
        '🏷️',
        async () => {
          const r = await marketplaceService.listMarketplaceItem('farming', selectedItem.itemId, sellPriceGems, 1)
          if (!r.success) {
            showModalAlert('NO SE PUDO PUBLICAR', r.error || 'Inténtalo de nuevo.', '⚠️', 'error')
            return
          }

          soundManager.playSound('plantation', 0.9)
          showModalAlert(
            '¡OFERTA PUBLICADA EN EL MERCADO!',
            `1x "${selectedItem.name}" está en venta por ${sellPriceGems} 💎.\nRecibirás ${neto} 💎 cuando se venda.`,
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
      return
    }

    // Carta de Planta
    if (!/^[0-9a-f-]{36}$/i.test(selectedItem.instanceId)) {
      showModalAlert(
        'ESTA CARTA NO SE PUEDE VENDER',
        'Es una carta base del juego, no una instancia de tu inventario. Vende cartas obtenidas en sobres o cofres.',
        '⚠️',
        'warning'
      )
      return
    }

    showModalConfirm(
      'PUBLICAR OFERTA EN EL MERCADO',
      `¿Confirmas poner en venta "${selectedItem.name}" (Nivel ${selectedItem.level}) por ${sellPriceGems} 💎?\n\n` +
        `El comprador paga ${sellPriceGems} 💎, la comisión del mercado es del ${comisionPct} % (${comision} 💎) y tú recibes ${neto} 💎.\n\n` +
        '⚠️ La carta se retira de tu Jardín y de tu Mazo mientras esté publicada.',
      '🏷️',
      async () => {
        const r = await marketplaceService.listMarketplaceItem('plant', selectedItem.instanceId, sellPriceGems, 1)
        if (!r.success) {
          showModalAlert('NO SE PUDO PUBLICAR', r.error || 'Inténtalo de nuevo.', '⚠️', 'error')
          return
        }

        soundManager.playSound('plantation', 0.9)
        showModalAlert(
          '¡OFERTA PUBLICADA EN EL MERCADO!',
          `"${selectedItem.name}" (Nivel ${selectedItem.level}) está en venta por ${sellPriceGems} 💎.\nRecibirás ${neto} 💎 cuando se venda.`,
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
    const isFarming = item.itemType === 'farming' || Boolean(item.itemId && FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId])
    const nombre = isFarming
      ? (FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId]?.label || item.itemId || 'Recurso')
      : (item.plantId && PLANT_CONFIGS[item.plantId as PlantId]?.name || item.plantId || 'Carta')

    showModalConfirm(
      'RETIRAR OFERTA DEL MERCADO',
      `¿Deseas retirar "${nombre}" del mercado y recuperarla en tu ${isFarming ? 'inventario' : 'Jardín'}?`,
      '📦',
      async () => {
        const r = await marketplaceService.cancelMarketplaceListing(item.id)
        if (!r.success) {
          showModalAlert('NO SE PUDO RETIRAR', r.error || 'Inténtalo de nuevo.', '⚠️', 'error')
          return
        }
        soundManager.playSound('plantation', 0.8)
        showModalAlert(
          'OFERTA RETIRADA',
          `"${nombre}" ha vuelto a tu ${isFarming ? 'inventario de cultivo' : 'Jardín'}.`,
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
      {/* ACCESS BANNER */}
      {canSell ? (
        <div className="market-vip-active-banner">
          {hasVipPass ? (
            <span className="market-vip-badge">👑 PASE PVP ACTIVO — COMPRA Y VENTA HABILITADAS</span>
          ) : (
            <span className="market-vip-badge">🏆 MAESTRÍA COMPETITIVA ({copasActuales} COPAS) — COMPRA Y VENTA HABILITADAS</span>
          )}
          <span>Compra y vende cartas con gemas. El mercado retiene un {comisionPct} % de comisión por venta.</span>
        </div>
      ) : (
        <div className="market-vip-active-banner" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(15, 23, 42, 0.95) 100%)', borderColor: '#10b981' }}>
          <span className="market-vip-badge" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff' }}>
            🛒 COMPRA LIBRE
          </span>
          <span style={{ fontSize: '11px', color: '#e2e8f0' }}>
            Todos los jugadores pueden comprar cartas e ítems en el mercado.
            {' '}🔒 <em>Para vender necesitas Pase PvP ({VIP_PASS_PRECIO_GEMAS} 💎) o 1,350 Copas ({copasActuales}/1,350).</em>
          </span>
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
          🛒 COMERCIO ({listings.length})
        </button>
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'sell' ? 'market-tab-btn--active' : ''} ${!canSell ? 'market-tab-btn--locked' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            if (!canSell) {
              showModalConfirm(
                'VENTAS BLOQUEADAS',
                `Todos los jugadores pueden comprar en el mercado libremente.\n\nPara poner en venta cartas o recursos de tu Jardín necesitas el Pase PvP o alcanzar 1,350 Copas en la Arena.\n\nTus copas actuales: ${copasActuales} / 1,350.\n\n¿Deseas activar tu Pase PvP (${VIP_PASS_PRECIO_GEMAS} 💎) ahora?`,
                '🔒',
                () => {
                  handleDirectBuyVip()
                },
                `ACTIVAR PASE PVP (${VIP_PASS_PRECIO_GEMAS} 💎)`,
                'CANCELAR'
              )
              return
            }
            setActiveTab('sell')
          }}
          title={!canSell ? 'Requiere Pase PvP o 1,350 Copas para vender cartas' : 'Vender cartas de tu Jardín'}
        >
          {!canSell ? '🔒 VENDER (PASE PVP / 1,350 COPAS)' : '🏷️ VENDER'}
        </button>
        <button
          type="button"
          className={`market-tab-btn ${activeTab === 'transactions' ? 'market-tab-btn--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('transactions')
          }}
        >
          📜 TRANSACCIONES
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
              const isFarming = item.itemType === 'farming' || Boolean(item.itemId && FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId])
              const farmingDef = isFarming && item.itemId ? FARMING_ITEM_DEFINITIONS[item.itemId as FarmingItemId] : undefined
              const plantDef = !isFarming && item.plantId ? PLANT_CONFIGS[item.plantId as PlantId] : undefined
              const itemIcon = isFarming ? farmingDef?.icon : (plantDef?.packetActive || plantDef?.icon)
              const rInfo = !isFarming && item.plantId
                ? getPlantRarityAndMinPrice(item.plantId as PlantId)
                : { rarity: 'FARMING', minPrice: item.itemId ? (FARMING_ITEM_MIN_PRICES[item.itemId as FarmingItemId] || 100) : 100, color: '#4ade80' }
              const itemName = isFarming ? (farmingDef?.label || item.itemId || 'Recurso') : (plantDef?.name || item.plantId || 'Carta')

              return (
                <div key={item.id} className="market-item-card">
                  {/* Card Header */}
                  <div className="market-item-card__header">
                    <span className="market-item-level-tag">
                      {isFarming ? `🌾 x${item.quantity || 1}` : (item.nivel > 0 ? `⭐ LVL ${item.nivel}` : '🌱 BASE')}
                    </span>
                    <span className="market-item-rarity-badge" style={{ color: rInfo.color, borderColor: rInfo.color }}>
                      {rInfo.rarity}
                    </span>
                    <span className="market-item-seller">👤 {isMine ? 'TÚ' : item.vendedor ?? 'Jugador'}</span>
                  </div>

                  {/* Image and Name */}
                  <div className="market-item-card__img-wrap">
                    {isFarming && itemIcon ? (
                      <img
                        src={itemIcon}
                        alt={itemName}
                        className="market-item-icon"
                        onError={(e) => {
                          const target = e.currentTarget
                          target.style.display = 'none'
                          if (target.parentElement) {
                            const span = document.createElement('span')
                            span.textContent = farmingDef?.fallback || '🌾'
                            span.style.fontSize = '3.5rem'
                            target.parentElement.appendChild(span)
                          }
                        }}
                      />
                    ) : (
                      <img src={itemIcon} alt={itemName} className="market-item-icon" />
                    )}
                  </div>
                  <h4 className="market-item-name">{itemName}</h4>

                  {/* Stat Rolls Pills or Farming Description */}
                  <div className="market-item-stats-box">
                    {isFarming ? (
                      <span className="market-stat-pill market-stat-pill--none">
                        {farmingDef?.description || 'Recurso de cultivo.'}
                      </span>
                    ) : item.statRolls && item.statRolls.length > 0 ? (
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

      {/* TAB 2: SELL MY PLANT OR FARMING ITEM */}
      {activeTab === 'sell' && canSell && (
        <div className="market-sell-pane">
          <div className="market-sell-form-grid">
            {/* Column 1: Select Item to Sell */}
            <div className="market-sell-column">
              <label className="market-sell-label">
                1. Elige la Carta o Ítem a Vender ({sellableItems.length} disponibles)
              </label>
              <div className="market-garden-cards-list">
                {sellableItems.length === 0 ? (
                  <div className="market-empty-state">
                    <span>No tienes cartas ni ítems de farming disponibles para vender.</span>
                  </div>
                ) : (
                  sellableItems.map((item) => {
                    const isSelected = selectedItemId === item.id

                    if (item.kind === 'farming') {
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          className={`market-garden-card-item ${isSelected ? 'market-garden-card-item--active' : ''}`}
                          onClick={() => {
                            soundManager.playSound('click', 0.4)
                            setSelectedItemId(item.id)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedItemId(item.id)
                            }
                          }}
                        >
                          <img
                            src={item.icon}
                            alt={item.name}
                            className="market-garden-card-item__img"
                            onError={(e) => {
                              const target = e.currentTarget
                              target.style.display = 'none'
                              if (target.parentElement) {
                                const span = document.createElement('span')
                                span.textContent = item.fallbackIcon
                                span.style.fontSize = '2.5rem'
                                target.parentElement.appendChild(span)
                              }
                            }}
                          />
                          <div className="market-garden-card-item__info">
                            <div className="market-garden-card-item__header">
                              <span className="market-item-level-tag">
                                🌾 DISP: {item.availableQty}
                              </span>
                              <span
                                className="market-rarity-pill"
                                style={{ color: item.rarityColor, borderColor: item.rarityColor }}
                              >
                                {item.rarity}
                              </span>
                            </div>
                            <strong className="market-garden-card-item__name">
                              {item.name}
                            </strong>
                            <div className="market-garden-card-item__stats">
                              <span className="market-stat-pill market-stat-pill--none">
                                {item.description}
                              </span>
                            </div>
                          </div>
                          <div className="market-garden-card-item__price-badge">
                            Mín: {item.minPrice} 💎
                          </div>
                        </div>
                      )
                    }

                    // Kind === 'plant'
                    const pConfig = PLANT_CONFIGS[item.plantId]
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className={`market-garden-card-item ${isSelected ? 'market-garden-card-item--active' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.4)
                          setSelectedItemId(item.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedItemId(item.id)
                          }
                        }}
                      >
                        <img
                          src={pConfig?.packetActive || pConfig?.icon}
                          alt={pConfig?.name || item.plantId}
                          className="market-garden-card-item__img"
                        />
                        <div className="market-garden-card-item__info">
                          <div className="market-garden-card-item__header">
                            <span className="market-item-level-tag">
                              {item.level > 0 ? `⭐ LVL ${item.level}` : '🌱 BASE'}
                            </span>
                            <span
                              className="market-rarity-pill"
                              style={{ color: item.rarityColor, borderColor: item.rarityColor }}
                            >
                              {item.rarity}
                            </span>
                            {item.inDeck && (
                              <span className="market-deck-tag">⚔️ EN MAZO</span>
                            )}
                          </div>
                          <strong className="market-garden-card-item__name">
                            {pConfig?.name || item.plantId}
                          </strong>
                          <div className="market-garden-card-item__stats">
                            {item.statRolls && item.statRolls.length > 0 ? (
                              formatStatRolls(item.statRolls)
                            ) : (
                              <span className="market-stat-pill market-stat-pill--none">Stats estándar</span>
                            )}
                          </div>
                        </div>
                        <div className="market-garden-card-item__price-badge">
                          Mín: {item.minPrice} 💎
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

              {selectedItem && (
                <form className="market-sell-preview-card" onSubmit={handleCreateListing}>
                  <div className="market-sell-preview-header">
                    <span className="market-item-level-tag">
                      {selectedItem.kind === 'farming'
                        ? `🌾 1x DISP (${selectedItem.availableQty})`
                        : (selectedItem.level > 0 ? `⭐ LVL ${selectedItem.level}` : '🌱 BASE')}
                    </span>
                    <span
                      className="market-rarity-pill"
                      style={{ color: selectedItem.rarityColor, borderColor: selectedItem.rarityColor }}
                    >
                      {selectedItem.rarity} (Mín {selectedItem.minPrice} 💎)
                    </span>
                  </div>

                  {selectedItem.kind === 'farming' ? (
                    <>
                      <img
                        src={selectedItem.icon}
                        alt={selectedItem.name}
                        className="market-preview-icon"
                        onError={(e) => {
                          const target = e.currentTarget
                          target.style.display = 'none'
                          if (target.parentElement) {
                            const span = document.createElement('span')
                            span.textContent = selectedItem.fallbackIcon
                            span.style.fontSize = '4rem'
                            target.parentElement.appendChild(span)
                          }
                        }}
                      />
                      <h4>{selectedItem.name}</h4>
                      <div className="market-item-stats-box">
                        <span className="market-stat-pill market-stat-pill--none">
                          {selectedItem.description}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <img
                        src={
                          PLANT_CONFIGS[selectedItem.plantId]?.packetActive ||
                          PLANT_CONFIGS[selectedItem.plantId]?.icon
                        }
                        alt=""
                        className="market-preview-icon"
                      />
                      <h4>{PLANT_CONFIGS[selectedItem.plantId]?.name}</h4>

                      {selectedItem.inDeck && (
                        <div className="market-deck-warning">
                          ⚠️ Esta carta está equipada en tu Mazo de Batalla. Se desequipará automáticamente al ponerla en venta.
                        </div>
                      )}

                      <div className="market-item-stats-box">
                        {selectedItem.statRolls && selectedItem.statRolls.length > 0 ? (
                          formatStatRolls(selectedItem.statRolls)
                        ) : (
                          <span className="market-stat-pill market-stat-pill--none">Stats estándar de fábrica</span>
                        )}
                      </div>
                    </>
                  )}

                  {/* Price Setting with Steppers */}
                  <div className="market-price-input-group">
                    <label>
                      Precio de Venta (💎 gemas) —{' '}
                      <span style={{ color: '#fde047' }}>Mínimo: {selectedItem.minPrice} 💎</span>
                    </label>
                    <div className="market-price-stepper-wrap">
                      <button
                        type="button"
                        className="market-stepper-btn"
                        disabled={sellPriceGems <= selectedItem.minPrice}
                        onClick={() => setSellPriceGems((p) => Math.max(selectedItem.minPrice, p - 1))}
                        title="Bajar 1 gema"
                      >
                        -
                      </button>

                      <div className="market-price-input-wrap">
                        <span>💎</span>
                        <input
                          type="number"
                          step="1"
                          min={selectedItem.minPrice}
                          max="99999"
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
                        onClick={() => setSellPriceGems(selectedItem.minPrice)}
                      >
                        MÍN ({selectedItem.minPrice} 💎)
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems((p) => p + 25)}
                      >
                        +25 💎
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems((p) => p + 50)}
                      >
                        +50 💎
                      </button>
                      <button
                        type="button"
                        className="market-shortcut-btn"
                        onClick={() => setSellPriceGems((p) => p + 100)}
                      >
                        +100 💎
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!canSell || sellPriceGems < selectedItem.minPrice}
                    className={`market-publish-btn ${!canSell ? 'market-publish-btn--locked' : ''}`}
                    title={!canSell ? 'Requiere Pase PvP o 1,350 Copas para vender en el mercado' : undefined}
                  >
                    {!canSell
                      ? '🔒 REQUIERE PASE PVP O 1,350 COPAS'
                      : `🏷️ PUBLICAR POR ${sellPriceGems} 💎 · recibes ${sellPriceGems - Math.round((sellPriceGems * comisionPct) / 100)} 💎`}
                  </button>

                  {!canSell && (
                    <button
                      type="button"
                      className="market-vip-unlock-cta"
                      onClick={handleDirectBuyVip}
                    >
                      👑 Activar Pase PvP ({VIP_PASS_PRECIO_GEMAS} 💎) o alcanza 1,350 Copas ({copasActuales}/1350)
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SELL LOCKED BANNER: cuando el usuario está en la pestaña VENDER pero no tiene permisos */}
      {activeTab === 'sell' && !canSell && (
        <div className="market-vip-lock-banner" style={{ margin: '20px auto', maxWidth: '750px' }}>
          <div className="market-vip-lock-icon">🔒</div>
          <div className="market-vip-lock-info">
            <h3>VENTAS BLOQUEADAS: ¡ALCANZA 1,350 COPAS O ACTIVA PASE PVP!</h3>
            <p>
              Todos los jugadores pueden comprar ofertas en el mercado libremente. Para <strong>poner en venta cartas o recursos de tu Jardín</strong> necesitas: <strong>alcanzar 1,350 Copas</strong> compitiendo gratis en la Arena, o <strong>activar el Pase PvP ({VIP_PASS_PRECIO_GEMAS} 💎)</strong> para desbloqueo inmediato.
            </p>
            <div className="market-copas-progress-wrap">
              <span className="market-copas-progress-text">
                🏆 Tu rango: <strong>{copasActuales}</strong> / 1,350 Copas
                {copasActuales < 1350 ? ` (faltan ${1350 - copasActuales} copas)` : ' (¡Meta alcanzada!)'}
              </span>
              <div className="market-copas-progress-bar">
                <div
                  className="market-copas-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, Math.round((copasActuales / 1350) * 100)))}%` }}
                />
              </div>
            </div>
          </div>
          <button className="market-vip-buy-btn" type="button" onClick={handleDirectBuyVip}>
            👑 ACTIVAR PASE PVP ({VIP_PASS_PRECIO_GEMAS} 💎)
          </button>
        </div>
      )}

      {/* TAB 3: GLOBAL TRANSACTIONS FEED */}
      {activeTab === 'transactions' && (
        <div className="market-tx-container">
          {/* Header Bar with Stats & Refresh */}
          <div className="market-tx-header-bar">
            <div className="market-tx-summary-chips">
              <div className="market-tx-stat-chip">
                <span className="market-tx-stat-chip__label">ACTIVIDAD TOTAL</span>
                <span className="market-tx-stat-chip__val">{txStats.total}</span>
              </div>
              <div className="market-tx-stat-chip market-tx-stat-chip--gold">
                <span className="market-tx-stat-chip__label">VOLUMEN P2P</span>
                <span className="market-tx-stat-chip__val">{txStats.p2pGems.toLocaleString()} 💎</span>
              </div>
              <div className="market-tx-stat-chip market-tx-stat-chip--emerald">
                <span className="market-tx-stat-chip__label">RETIROS OFICIALES</span>
                <span className="market-tx-stat-chip__val">{txStats.withdrawGems.toLocaleString()} 💎</span>
              </div>
            </div>

            <button
              type="button"
              className="market-tx-refresh-btn"
              onClick={() => {
                soundManager.playSound('click', 0.4)
                void refreshTransactions()
              }}
              disabled={txLoading}
              title="Refrescar transacciones en vivo"
            >
              {txLoading ? '⏳ ACTUALIZANDO...' : '🔄 ACTUALIZAR'}
            </button>
          </div>

          {/* Filter Pills */}
          <div className="market-tx-filter-bar">
            <button
              type="button"
              className={`market-tx-filter-chip ${txFilter === 'all' ? 'market-tx-filter-chip--active' : ''}`}
              onClick={() => setTxFilter('all')}
            >
              🌐 TODOS ({transactions.length})
            </button>
            <button
              type="button"
              className={`market-tx-filter-chip ${txFilter === 'marketplace' ? 'market-tx-filter-chip--active' : ''}`}
              onClick={() => setTxFilter('marketplace')}
            >
              🛒 MERCADO P2P ({transactions.filter((t) => t.type === 'marketplace_sale').length})
            </button>
            <button
              type="button"
              className={`market-tx-filter-chip ${txFilter === 'withdrawal' ? 'market-tx-filter-chip--active' : ''}`}
              onClick={() => setTxFilter('withdrawal')}
            >
              💳 RETIROS VALIDADOS ({transactions.filter((t) => t.type === 'withdrawal').length})
            </button>
            <button
              type="button"
              className={`market-tx-filter-chip ${txFilter === 'shop' ? 'market-tx-filter-chip--active' : ''}`}
              onClick={() => setTxFilter('shop')}
            >
              🎒 TIENDA & ORO ({transactions.filter((t) => t.type === 'shop_pack' || t.type === 'shop_gold').length})
            </button>
            <button
              type="button"
              className={`market-tx-filter-chip ${txFilter === 'reward' ? 'market-tx-filter-chip--active' : ''}`}
              onClick={() => setTxFilter('reward')}
            >
              🎁 PREMIOS & RULETA ({transactions.filter((t) => t.type === 'lottery_win' || t.type === 'reward_code' || t.type === 'tournament_reward').length})
            </button>
          </div>

          {/* Transactions Feed Scroll List */}
          <div className="market-tx-feed-list">
            {txLoading && transactions.length === 0 ? (
              <div className="market-empty-state">
                <span>⏳ Cargando registro de transacciones globales…</span>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="market-empty-state">
                <span>📜 No hay transacciones registradas en esta categoría aún.</span>
              </div>
            ) : (
              filteredTransactions.map((tx) => {
                const plantDef = tx.itemId && PLANT_CONFIGS[tx.itemId as PlantId] ? PLANT_CONFIGS[tx.itemId as PlantId] : null
                const plantIcon = plantDef?.packetActive || plantDef?.icon
                const rInfo = tx.itemId && PLANT_CONFIGS[tx.itemId as PlantId] ? getPlantRarityAndMinPrice(tx.itemId as PlantId) : null

                const isPack =
                  tx.type === 'shop_pack' ||
                  (tx.type === 'shop_gold' &&
                    (tx.description?.toLowerCase().includes('sobre') ||
                      tx.description?.toLowerCase().includes('semilla') ||
                      tx.description?.toLowerCase().includes('pack')))

                const cleanDesc = (() => {
                  const desc = tx.description?.trim() || ''
                  const title = tx.title?.trim() || ''
                  if (desc) {
                    if (
                      title &&
                      title.toLowerCase().includes('oro') &&
                      (desc.toLowerCase().includes('sobre') || desc.toLowerCase().includes('semilla'))
                    ) {
                      return desc.charAt(0).toUpperCase() + desc.slice(1)
                    }
                    if (
                      title &&
                      !desc.toLowerCase().includes(title.toLowerCase()) &&
                      !title.toLowerCase().includes(desc.toLowerCase())
                    ) {
                      return `${title} — ${desc}`
                    }
                    return desc.charAt(0).toUpperCase() + desc.slice(1)
                  }
                  return title
                })()

                return (
                  <div key={tx.id} className={`market-tx-card market-tx-card--${isPack ? 'shop_pack' : tx.type}`}>
                    {/* Left: Type badge & timestamp */}
                    <div className="market-tx-card__left">
                      <span className={`market-tx-badge market-tx-badge--${isPack ? 'shop_pack' : tx.type}`}>
                        {tx.type === 'marketplace_sale' && '🛒 MERCADO P2P'}
                        {tx.type === 'withdrawal' && '💳 RETIRO BNB CHAIN'}
                        {isPack && '🎒 TIENDA · SOBRE'}
                        {!isPack && tx.type === 'shop_gold' && '💰 TIENDA · ORO'}
                        {tx.type === 'lottery_win' && '🎰 RULETA JACKPOT'}
                        {tx.type === 'reward_code' && '🎁 CÓDIGO ESPECIAL'}
                        {tx.type === 'tournament_reward' && '🏆 CÓDIGO SECRETO'}
                      </span>
                      <span className="market-tx-time">{formatTxTime(tx.createdAt)}</span>
                    </div>

                    {/* Center: Event Details */}
                    <div className="market-tx-card__center">
                      {tx.type === 'marketplace_sale' ? (
                        <div className="market-tx-details-p2p">
                          <div className="market-tx-users-flow">
                            <span className="market-tx-buyer-name">{tx.userName}</span>
                            <span className="market-tx-arrow">compró a</span>
                            <span className="market-tx-seller-name">{tx.targetUserName || 'Vendedor'}</span>
                          </div>
                          {plantDef && (
                            <div className="market-tx-plant-preview">
                              {plantIcon && <img src={plantIcon} alt={plantDef.name} className="market-tx-plant-icon" />}
                              <div className="market-tx-plant-text">
                                <span className="market-tx-plant-name">{plantDef.name}</span>
                                <span className="market-tx-plant-sub" style={{ color: rInfo?.color || '#94a3b8' }}>
                                  {rInfo?.rarity || tx.itemRarity || 'Planta'} · Lv. {tx.itemLevel || 0}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : tx.type === 'withdrawal' ? (
                        <div className="market-tx-details-custom">
                          <div className="market-tx-users-flow">
                            <span className="market-tx-user-name">{tx.userName}</span>
                            <span className="market-tx-action-text">realizó un retiro oficial</span>
                          </div>
                          <span className="market-tx-desc-text">{tx.description}</span>
                          <span className="market-tx-validated-tag">✓ Retiro Oficial Validado</span>
                        </div>
                      ) : (
                        <div className="market-tx-details-custom">
                          <div className="market-tx-users-flow">
                            <span className="market-tx-user-name">{tx.userName}</span>
                            <span className="market-tx-action-text">
                              {isPack
                                ? 'compró sobre en Tienda'
                                : tx.type === 'shop_gold'
                                ? 'compró oro en Tienda'
                                : tx.type.startsWith('shop')
                                ? 'compró en Tienda'
                                : tx.type === 'lottery_win'
                                ? 'ganó en la Ruleta'
                                : tx.type === 'reward_code'
                                ? 'canjeó código promocional'
                                : tx.type === 'tournament_reward'
                                ? 'ganó en Código Secreto'
                                : 'recibió recompensa'}
                            </span>
                          </div>
                          <span className="market-tx-desc-text">{cleanDesc}</span>
                        </div>
                      )}
                    </div>

                    {/* Right: Amount in Gems */}
                    <div className="market-tx-card__right">
                      {tx.type === 'withdrawal' ? (
                        <div className="market-tx-amount-box market-tx-amount-box--gems">
                          <span className="market-tx-amount-num" style={{ color: '#f87171' }}>
                            -{(tx.amountGems || (tx.amountUsd ? Math.round(tx.amountUsd * 100) : 0)).toLocaleString()} 💎
                          </span>
                        </div>
                      ) : tx.amountGems ? (
                        <div className="market-tx-amount-box market-tx-amount-box--gems">
                          <span className="market-tx-amount-num">
                            {tx.amountGems.toLocaleString()} 💎
                          </span>
                        </div>
                      ) : (
                        <div className="market-tx-amount-box">
                          <span className="market-tx-amount-tag">OFICIAL</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
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
