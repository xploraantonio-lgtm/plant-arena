import { useState, useEffect } from 'react'
import background from '../../assets/images/background.webp'
import monedaImg from '../../assets/ico/moneda.webp'
import type { PlantCardInstance, PlantId } from '../../types/game'
import {
  PACK_DEFINITIONS,
  type InventoryPack,
  type PackId,
} from '../../utils/packDropManager'
import { soundManager } from '../../utils/audioManager'
import { shopService } from '../../services/shopService'
import Marketplace from '../Marketplace/Marketplace'
import { VIP_PASS_PRECIO_GEMAS, ENERGY_PACKAGES, type EnergyPackage, type PlantStatKey } from '../../utils/gameConstants'
import type { FarmingInventory } from '../../utils/pvpRewardManager'
import './Shop.css'

const commonSeedImg = '/game-assets/greenfoot/seed_pack_common_whitebg.webp'
const epicSeedImg = '/game-assets/greenfoot/seed_pack_epic_whitebg.webp'
const legendarySeedImg = '/game-assets/greenfoot/seed_pack_legendary_whitebg.webp'

export interface GoldPackage {
  id: string
  name: string
  goldAmount: number
  priceUsd: number
  badge?: string
  popular?: boolean
  bestValue?: boolean
  description: string
}

export const GOLD_PACKAGES: GoldPackage[] = [
  {
    id: 'gold_100',
    name: 'Bolsa de Monedas',
    goldAmount: 100,
    priceUsd: 100,
    badge: 'BÁSICO',
    description: '100 Monedas de Oro directas a tu cuenta.',
  },
  {
    id: 'gold_250',
    name: 'Cofre de Monedas',
    goldAmount: 250,
    priceUsd: 200,
    badge: 'MÁS POPULAR • +25% EXTRA',
    popular: true,
    description: '250 Monedas de Oro (+50 Oro de regalo).',
  },
  {
    id: 'gold_700',
    name: 'Bóveda Real de Monedas',
    goldAmount: 700,
    priceUsd: 500,
    badge: 'MEJOR VALOR • +40% EXTRA',
    bestValue: true,
    description: '700 Monedas de Oro (+200 Oro de bonificación).',
  },
]

export interface EmoteItem {
  id: string
  name: string
  category: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  priceGold: number
  priceUsd?: number
  gifUrl?: string // Placeholder para insertar el GIF posteriormente
  placeholderEmoji: string
  tagline: string
}

export const EMOTE_ITEMS: EmoteItem[] = [
  {
    id: 'emote_sunflower_gg',
    name: 'Girasol Alegre',
    category: 'Reacción GG',
    rarity: 'common',
    priceGold: 150,
    placeholderEmoji: '🌻✨',
    tagline: '¡Sonrisa radiante de buen juego!',
  },
  {
    id: 'emote_bonkchoy_rage',
    name: 'Bonk Choy Furia',
    category: 'Taunt & Ataque',
    rarity: 'rare',
    priceGold: 250,
    placeholderEmoji: '🥊🔥',
    tagline: '¡Ráfaga de puñetazos sin piedad!',
  },
  {
    id: 'emote_wallnut_cry',
    name: 'Nuez Llorona',
    category: 'Defensa & Súplica',
    rarity: 'common',
    priceGold: 150,
    placeholderEmoji: '🥜😭',
    tagline: '¡Resistiendo hasta el último aliento!',
  },
  {
    id: 'emote_jalapeno_fire',
    name: 'Jalapeño On Fire',
    category: 'Explosivo',
    rarity: 'epic',
    priceGold: 350,
    placeholderEmoji: '🌶️💥',
    tagline: '¡Furia explosiva y ardiente!',
  },
  {
    id: 'emote_iceberg_chill',
    name: 'Lechuga Chill',
    category: 'Control Glacial',
    rarity: 'rare',
    priceGold: 250,
    placeholderEmoji: '🧊😎',
    tagline: '¡Tranquilidad y frescura en la arena!',
  },
  {
    id: 'emote_crown_vip',
    name: 'Corona Campeón',
    category: 'Prestigio VIP',
    rarity: 'legendary',
    priceGold: 500,
    placeholderEmoji: '👑🏆',
    tagline: '¡Lucimiento exclusivo de campeón!',
  },
  {
    id: 'emote_peashooter_cool',
    name: 'Guisante Épico',
    category: 'Flex & Victoria',
    rarity: 'epic',
    priceGold: 450,
    placeholderEmoji: '🌱😎',
    tagline: '¡Gafas oscuras y estilo inigualable!',
  },
]

export const ADS_ENABLED = false

export interface AdRewardSlot {
  id?: string
  slotNumber: number
  rewardGold: number
  title: string
  desc: string
  rewardDescription?: string
  durationText?: string
  icon: string
  badge?: string
}


export const AD_REWARD_SLOTS: AdRewardSlot[] = [
  {
    slotNumber: 1,
    rewardGold: 15,
    title: 'Semillero Inicial',
    desc: 'Bolsa rápida de monedas para mejoras tempranas.',
    icon: '🌱',
    badge: 'NIVEL 1',
  },
  {
    slotNumber: 2,
    rewardGold: 30,
    title: 'Riego Nutritivo',
    desc: 'Impulso intermedio de oro para tu jardín.',
    icon: '💧',
    badge: 'NIVEL 2',
  },
  {
    slotNumber: 3,
    rewardGold: 50,
    title: 'Cosecha Solar',
    desc: 'Buena recompensa para adquirir cartas y pases.',
    icon: '☀️',
    badge: 'NIVEL 3',
  },
  {
    slotNumber: 4,
    rewardGold: 75,
    title: 'Cofre Dorado',
    desc: 'Un botín considerable directo a tu reserva.',
    icon: '💰',
    badge: 'NIVEL 4',
  },
  {
    slotNumber: 5,
    rewardGold: 100,
    title: 'Tesoro del Jardín',
    desc: 'Gran premio para jugadores dedicados.',
    icon: '🏆',
    badge: 'NIVEL 5',
  },
  {
    slotNumber: 6,
    rewardGold: 150,
    title: 'Bóveda Legendaria',
    desc: '¡La máxima recompensa diaria de oro disponible!',
    icon: '💎',
    badge: 'MÁXIMO',
  },
]

export interface ShopProps {
  initialTab?: 'packs' | 'pass' | 'gold' | 'energy' | 'market'
  userTokens: number
  userElo: number
  userGold?: number
  hasVipPass?: boolean
  playerEnergy?: number
  maxPlayerEnergy?: number
  inventoryPacks: InventoryPack[]
  plantCopies?: Partial<Record<PlantId, number>>
  plantLevels?: Partial<Record<PlantId, number>>
  plantStatRolls?: Partial<Record<PlantId, PlantStatKey[]>>
  plantInstances?: PlantCardInstance[]
  farmingItems?: FarmingInventory
  onBack: () => void
  onBuyPack: (packId: PackId, qty?: number) => Promise<{ success: boolean; packs?: InventoryPack[]; error?: string }>
  onBuyGold?: (packageId: string) => Promise<{ success: boolean; goldAdded?: number; error?: string }>
  onBuyEnergyPack?: (packId: string) => Promise<{ success: boolean; energyAdded?: number; spentGems?: number; error?: string }>
  onAddGold?: (amount: number) => void
  onWatchAd?: (slotNumber: number, rewardGold: number) => void
  onOpenJardin: () => void
  onOpenPackImmediately: (packInstanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onBuyVipPass?: () => Promise<{ success: boolean; error?: string }>
  onDeductTokens?: (amountUsd: number) => boolean
  onDonatePlant?: (plantId: PlantId) => boolean
  onReceivePlant?: (plantId: PlantId, level?: number, statRolls?: PlantStatKey[]) => void
  onServerChange?: () => void
}

export default function Shop({
  initialTab = 'packs',
  userTokens,
  userElo,
  userGold = 50000,
  hasVipPass = false,
  playerEnergy = 20,
  maxPlayerEnergy = 20,
  inventoryPacks,
  plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
  plantInstances = [],
  farmingItems,
  onBack,
  onBuyPack,
  onBuyGold,
  onBuyEnergyPack,
  onAddGold: _onAddGold,
  onWatchAd: _onWatchAd,
  onOpenJardin,
  onOpenPackImmediately,
  onOpenMultiplePacks,
  onBuyVipPass,
  onDeductTokens,
  onDonatePlant,
  onReceivePlant,
  onServerChange,
}: ShopProps) {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [activeTab, setActiveTab] = useState<'packs' | 'pass' | 'gold' | 'energy' | 'market'>(initialTab)

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  const [purchasedPacksList, setPurchasedPacksList] = useState<InventoryPack[]>([])
  const [themedAlert, setThemedAlert] = useState<{ title: string; message: string; icon: string } | null>(null)
  const [selectedPackDetails, setSelectedPackDetails] = useState<PackId | null>(null)
  const [goldSlideIndex, setGoldSlideIndex] = useState<number>(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  const [isPurchasingPack, setIsPurchasingPack] = useState<boolean>(false)
  const [buyQuantities, setBuyQuantities] = useState<Record<PackId, number>>({
    basic: 1,
    epic: 1,
    legendary: 1,
  })

  const getPackCount = (packId: PackId) => {
    return inventoryPacks.filter((p) => p.packId === packId).length
  }

  // Precios traídos del servidor (tabla shop_packs). La interfaz tenía los tres
  // precios escritos a mano y uno ya no coincidía con la definición: la tienda
  // anunciaba el sobre épico a 5 gemas y la definición decía 8. Como la compra
  // no cobraba nada, nadie lo notó hasta mover el cobro al servidor.
  //
  // Ahora el número que se muestra es el mismo que se va a cobrar, por
  // construcción: sale de la misma tabla.
  const [serverPackPrices, setServerPackPrices] = useState<Partial<Record<PackId, number>> | null>(null)

  useEffect(() => {
    let mounted = true
    shopService.getShopPackPrices().then((prices) => {
      if (mounted && prices) setServerPackPrices(prices)
    })
    return () => {
      mounted = false
    }
  }, [])

  /** Precio del sobre. Respaldo en PACK_DEFINITIONS si el servidor no responde. */
  const packPrice = (packId: PackId): number =>
    serverPackPrices?.[packId] ?? PACK_DEFINITIONS[packId].priceUsd

  const getQty = (packId: PackId) => buyQuantities[packId] || 1

  const setQty = (packId: PackId, val: number) => {
    const clamped = Math.max(1, Math.min(20, val))
    setBuyQuantities((prev) => ({ ...prev, [packId]: clamped }))
  }

  const handleBuyPacksBatch = async (packId: PackId) => {
    if (isPurchasingPack) return
    const qty = getQty(packId)
    const totalCost = packPrice(packId) * qty

    // Comprobación local sólo para dar feedback inmediato. La que cuenta es la
    // del servidor: antes esto era lo ÚNICO que había, y como buyPack() no
    // descontaba nada, los sobres salían gratis.
    if (userTokens < totalCost) {
      setThemedAlert({
        title: 'GEMAS INSUFICIENTES',
        message: `⚠️ Gemas insuficientes (${userTokens} Gemas 💎 disponibles).\nSe requieren ${totalCost} Gemas 💎 para comprar ${qty} ${qty === 1 ? 'sobre' : 'sobres'}.`,
        icon: '⚠️',
      })
      return
    }

    setIsPurchasingPack(true)
    try {
      // Una sola llamada por lote: el servidor cobra qty × precio de una vez, así
      // que no hay ventana para gastar el saldo a medias.
      const res = await onBuyPack(packId, qty)

      if (!res.success) {
        setThemedAlert({
          title: 'COMPRA RECHAZADA',
          message: res.error || 'El servidor rechazó la compra.',
          icon: '⚠️',
        })
        return
      }

      const bought = res.packs || []
      if (bought.length > 0) {
        soundManager.playSound('plantation', 0.8)
        setPurchasedPacksList(bought)
      }
    } finally {
      setIsPurchasingPack(false)
    }
  }

  const handleBuyGold = async (pkg: GoldPackage) => {
    if (userTokens < pkg.priceUsd) {
      setThemedAlert({
        title: 'GEMAS INSUFICIENTES',
        message: `⚠️ Gemas insuficientes (${userTokens} Gemas 💎 disponibles).\nSe requieren ${pkg.priceUsd} Gemas 💎 para comprar ${pkg.goldAmount.toLocaleString()} Monedas de Oro.`,
        icon: '⚠️',
      })
      return
    }

    if (onBuyGold) {
      // Se manda sólo el ID: cuánto oro entra y cuánto cuesta lo dice
      // shop_gold_packages, no el navegador.
      const res = await onBuyGold(pkg.id)
      if (res.success) {
        soundManager.playSound('plantation', 0.8)
        setThemedAlert({
          title: '¡COMPRA EXITOSA!',
          message: `💰 ¡Has adquirido con éxito +${(res.goldAdded ?? pkg.goldAmount).toLocaleString()} Monedas de Oro por ${pkg.priceUsd} Gemas 💎!`,
          icon: '💰',
        })
      } else {
        setThemedAlert({
          title: 'ERROR EN COMPRA',
          message: res.error || 'No se pudo procesar la compra de oro.',
          icon: '⚠️',
        })
      }
    }
  }

  const handleWatchAd = (_adSlot: AdRewardSlot) => {
    soundManager.playSound('click', 0.5)
    setThemedAlert({
      title: '📺 ANUNCIOS DESACTIVADOS',
      message: 'Los anuncios publicitarios y las recompensas de oro por este medio se encuentran actualmente desactivados.',
      icon: 'ℹ️',
    })
  }

  const handleBuyVipFromShop = async () => {
    if (onBuyVipPass) {
      const { success: ok, error } = await onBuyVipPass()
      if (ok) {
        setThemedAlert({
          title: '¡PASE VIP ACTIVADO!',
          message: '👑 ¡Pase VIP de Temporada activado con éxito!\nAhora puedes reclamar todas las recompensas doradas desde el Menú Principal.',
          icon: '👑',
        })
        setActiveTab('packs')
      } else {
        // El mensaje viene del servidor: distingue entre saldo insuficiente y
        // "ya tienes el pase", que antes se mostraban igual.
        setThemedAlert({
          title: 'NO SE PUDO ACTIVAR',
          message: error || 'El servidor rechazó la compra del pase VIP.',
          icon: '⚠️',
        })
      }
    }
  }

  const handleBuyEnergy = async (pkg: EnergyPackage) => {
    if (userTokens < pkg.priceGems) {
      setThemedAlert({
        title: 'GEMAS INSUFICIENTES',
        message: `⚠️ Gemas insuficientes (${userTokens} Gemas 💎 disponibles).\nSe requieren ${pkg.priceGems} Gemas 💎 para comprar ${pkg.energyAmount} Energías ⚡.`,
        icon: '⚠️',
      })
      return
    }

    if (onBuyEnergyPack) {
      const res = await onBuyEnergyPack(pkg.id)
      if (res.success) {
        soundManager.playSound('plantation', 0.8)
        setThemedAlert({
          title: '¡ENERGÍA RECARGADA!',
          message: `⚡ ¡Has adquirido con éxito +${res.energyAdded ?? pkg.energyAmount} Energías ⚡ por ${pkg.priceGems} Gemas 💎!\nAhora puedes seguir compitiendo en Ranked.`,
          icon: '⚡',
        })
      } else {
        setThemedAlert({
          title: 'ERROR EN COMPRA',
          message: res.error || 'No se pudo procesar la compra de energía.',
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
          <h1 className="shop-title">🛒 TIENDA</h1>
        </div>
        <div className="shop-header__right">
          <div
            className="shop-gold-badge"
            title="Monedas de Oro disponibles"
          >
            <img src={monedaImg} alt="Oro" className="shop-gold-badge-icon" />
            <span className="shop-gold-badge-amount">{userGold.toLocaleString()} ORO</span>
          </div>
          <div className="shop-token-badge">
            <span className="shop-token-icon">💎</span>
            <span className="shop-token-amount">{userTokens} Gemas</span>
          </div>
          <div
            className="shop-energy-badge"
            title={
              userElo <= 1601
                ? '⚡ Energía ilimitada en rango novato (< 1602 copas)'
                : `⚡ Energía diaria: ${playerEnergy}/${maxPlayerEnergy}`
            }
            onClick={() => {
              soundManager.playSound('click', 0.5)
              setActiveTab('energy')
            }}
            style={{ cursor: 'pointer' }}
          >
            <span className="shop-energy-badge-icon">⚡</span>
            <span className="shop-energy-badge-amount">
              {userElo <= 1601 ? '∞' : `${playerEnergy}/${maxPlayerEnergy}`}
            </span>
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
          className={`shop-nav-tab ${activeTab === 'gold' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('gold')
          }}
        >
          {ADS_ENABLED ? '💰 ORO, EMOTES & ADS' : '💰 ORO & EMOTES'}
        </button>

        <button
          type="button"
          className={`shop-nav-tab ${activeTab === 'energy' ? 'shop-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('energy')
          }}
        >
          ⚡ ENERGÍAS
        </button>

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
                  <div className="shop-pack-pricing-col">
                    <span className="shop-pack-price-tag">{packPrice('basic').toLocaleString('en-US')} 💎 Gemas</span>
                    <span className="shop-pack-details-price">💵 Precio: $3.00 USD</span>
                  </div>
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
                  disabled={isPurchasingPack}
                  onClick={() => handleBuyPacksBatch('basic')}
                >
                  {isPurchasingPack
                    ? '⏳ PROCESANDO...'
                    : `COMPRAR (${getQty('basic')}) — ${(packPrice('basic') * getQty('basic')).toLocaleString('en-US')} 💎 Gemas`}
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
                  <div className="shop-pack-pricing-col">
                    <span className="shop-pack-price-tag shop-pack-price-tag--epic">{packPrice('epic').toLocaleString('en-US')} 💎 Gemas</span>
                    <span className="shop-pack-details-price">💵 Precio: $10.00 USD</span>
                  </div>
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
                  disabled={isPurchasingPack}
                  onClick={() => handleBuyPacksBatch('epic')}
                >
                  {isPurchasingPack
                    ? '⏳ PROCESANDO...'
                    : `COMPRAR (${getQty('epic')}) — ${(packPrice('epic') * getQty('epic')).toLocaleString('en-US')} 💎 Gemas`}
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
                  <div className="shop-pack-pricing-col">
                    <span className="shop-pack-price-tag shop-pack-price-tag--legendary">{packPrice('legendary').toLocaleString('en-US')} 💎 Gemas</span>
                    <span className="shop-pack-details-price">💵 Precio: $25.00 USD</span>
                  </div>
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
                  disabled={isPurchasingPack}
                  onClick={() => handleBuyPacksBatch('legendary')}
                >
                  {isPurchasingPack
                    ? '⏳ PROCESANDO...'
                    : `COMPRAR (${getQty('legendary')}) — ${(packPrice('legendary') * getQty('legendary')).toLocaleString('en-US')} 💎 Gemas`}
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
                <div className="shop-pass-hero-badge">⭐ TEMPORADA 1 EXCLUSIVA ⭐</div>

                <div className="shop-pass-hero-header">
                  <span className="shop-pass-hero-crown">👑</span>
                  <h2 className="shop-pass-hero-title">PASE DE BATALLA VIP</h2>
                </div>

                <p className="shop-pass-hero-sub">
                  Desbloquea <strong>20 niveles de recompensas premium</strong>, nick dorado exclusivo, plantas y acceso total al Mercado.
                </p>

                <div className="shop-pass-perks-grid">
                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🎁</span>
                    <div className="shop-pass-perk-info">
                      <strong className="shop-pass-perk-title">20 Niveles VIP</strong>
                      <span className="shop-pass-perk-txt">Premios exclusivos</span>
                    </div>
                  </div>

                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🏷️</span>
                    <div className="shop-pass-perk-info">
                      <strong className="shop-pass-perk-title">Mercado Libre</strong>
                      <span className="shop-pass-perk-txt">Compra y venta</span>
                    </div>
                  </div>

                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">🌟</span>
                    <div className="shop-pass-perk-info">
                      <strong className="shop-pass-perk-title">Sobres PVP</strong>
                    </div>
                  </div>

                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">👑</span>
                    <div className="shop-pass-perk-info">
                      <strong className="shop-pass-perk-title">Nick Dorado VIP</strong>
                      <span className="shop-pass-perk-txt">Insignia y brillo real</span>
                    </div>
                  </div>

                  <div className="shop-pass-perk">
                    <span className="shop-pass-perk-icon">⚡</span>
                    <div className="shop-pass-perk-info">
                      <strong className="shop-pass-perk-title">25 Energías Diarias</strong>
                      <span className="shop-pass-perk-txt">+5 partidas cada día</span>
                    </div>
                  </div>
                </div>


                <button
                  type="button"
                  className="shop-pass-hero-buy-btn"
                  onClick={handleBuyVipFromShop}
                >
                  👑 ACTIVAR PASE VIP — {VIP_PASS_PRECIO_GEMAS.toLocaleString()} 💎 Gemas
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: MONEDAS DE ORO, EMOTES & ANUNCIOS (SLIDER GAMER CON DESLIZAMIENTO LIMPIO) */}
        {activeTab === 'gold' && (
          <div className="shop-tab-pane shop-slider-pane">
            {/* CONTENEDOR SLIDER CON SOPORTE TÁCTIL Y DESLIZAMIENTO */}
            <div
              className="shop-slider-viewport"
              onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
              onTouchEnd={(e) => {
                if (touchStartX === null) return
                const touchEndX = e.changedTouches[0].clientX
                const diff = touchStartX - touchEndX
                const maxSlide = ADS_ENABLED ? 2 : 1
                if (Math.abs(diff) > 45) {
                  soundManager.playSound('click', 0.4)
                  if (diff > 0) {
                    // Swipe Left -> Next slide
                    setGoldSlideIndex((prev) => (prev < maxSlide ? prev + 1 : 0))
                  } else {
                    // Swipe Right -> Prev slide
                    setGoldSlideIndex((prev) => (prev > 0 ? prev - 1 : maxSlide))
                  }
                }
                setTouchStartX(null)
              }}
            >
              <div
                className="shop-slider-track"
                style={{ transform: `translateX(-${goldSlideIndex * 100}%)` }}
              >
                {/* SLIDE 0: 💰 BÓVEDA DE MONEDAS DE ORO */}
                <div className="shop-slide-item">
                  <div className="shop-epic-section shop-epic-section--gold">
                    <div className="shop-epic-section__header">
                      <div className="shop-epic-section__title-wrap">
                        <span className="shop-epic-section__icon">💰</span>
                        <div>
                          <h2 className="shop-epic-section__title">BÓVEDA DE MONEDAS DE ORO</h2>
                        </div>
                      </div>

                      <div className="shop-epic-section__header-actions">
                        <button
                          type="button"
                          className="shop-slide-nav-btn"
                          onClick={() => {
                            soundManager.playSound('click', 0.5)
                            setGoldSlideIndex(1)
                          }}
                          title="Deslizar a Emotes"
                        >
                          {ADS_ENABLED ? 'VER EMOTES (1/3) ▶' : 'VER EMOTES (1/2) ▶'}
                        </button>
                      </div>
                    </div>

                    <div className="shop-epic-gold-grid">
                      {GOLD_PACKAGES.map((pkg) => (
                        <div
                          key={pkg.id}
                          className={`shop-epic-gold-card ${pkg.popular ? 'shop-epic-gold-card--popular' : ''} ${pkg.bestValue ? 'shop-epic-gold-card--best' : ''}`}
                        >
                          {pkg.badge && (
                            <div className={`shop-epic-badge-ribbon ${pkg.popular ? 'shop-epic-badge-ribbon--popular' : ''} ${pkg.bestValue ? 'shop-epic-badge-ribbon--best' : ''}`}>
                              {pkg.badge}
                            </div>
                          )}

                          <div className="shop-epic-gold-card__glow-bg" />

                          <div className="shop-epic-gold-card__art">
                            <img src={monedaImg} alt="Oro" className="shop-epic-gold-card__img" />
                            <span className="shop-epic-gold-card__amount">+{pkg.goldAmount.toLocaleString()}</span>
                            <span className="shop-epic-gold-card__currency">MONEDAS DE ORO</span>
                          </div>

                          <button
                            type="button"
                            className={`shop-epic-buy-btn ${pkg.popular ? 'shop-epic-buy-btn--popular' : ''} ${pkg.bestValue ? 'shop-epic-buy-btn--best' : ''}`}
                            onClick={() => handleBuyGold(pkg)}
                          >
                            <span>🛒 COMPRAR</span>
                            <strong className="shop-epic-buy-price">{pkg.priceUsd} 💎 Gemas</strong>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* SLIDE 1: 🎭 SALÓN DE EMOTES & REACCIONES ANIMADAS */}
                <div className="shop-slide-item">
                  <div className="shop-epic-section shop-epic-section--emotes">
                    <div className="shop-epic-section__header">
                      <div className="shop-epic-section__title-wrap">
                        <span className="shop-epic-section__icon">🎭</span>
                        <div>
                          <h2 className="shop-epic-section__title">SALÓN DE EMOTES & REACCIONES ANIMADAS</h2>
                          <span className="shop-epic-section__subtitle">
                            Animaciones y taunts para reaccionar en tiempo real en tus batallas PvP de la Arena.
                          </span>
                        </div>
                      </div>

                      <div className="shop-epic-section__header-actions">
                        <button
                          type="button"
                          className="shop-slide-nav-btn shop-slide-nav-btn--prev"
                          onClick={() => {
                            soundManager.playSound('click', 0.5)
                            setGoldSlideIndex(0)
                          }}
                          title="Volver a Oro"
                        >
                          {ADS_ENABLED ? '◀ ORO' : '◀ ORO (1/2)'}
                        </button>
                        {ADS_ENABLED ? (
                          <button
                            type="button"
                            className="shop-slide-nav-btn"
                            onClick={() => {
                              soundManager.playSound('click', 0.5)
                              setGoldSlideIndex(2)
                            }}
                            title="Deslizar a Anuncios Gratis"
                          >
                            VER ADS (2/3) ▶
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="shop-slide-nav-btn shop-slide-nav-btn--gold"
                            onClick={() => {
                              soundManager.playSound('click', 0.5)
                              setGoldSlideIndex(0)
                            }}
                            title="Volver a Bóveda de Oro"
                          >
                            VOLVER A ORO (2/2) 💰
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="shop-epic-emotes-grid">
                      {EMOTE_ITEMS.map((emote) => (
                        <div key={emote.id} className={`shop-epic-emote-card shop-epic-emote-card--${emote.rarity}`}>
                          <div className="shop-epic-emote-card__top">
                            <span className={`shop-epic-rarity-badge shop-epic-rarity-badge--${emote.rarity}`}>
                              {emote.rarity.toUpperCase()}
                            </span>
                            <span className="shop-epic-emote-cat">{emote.category}</span>
                          </div>

                          {/* CONTENEDOR AMPLIO PARA INSERTAR EL GIF ANIMADO */}
                          <div className="shop-epic-gif-frame" title={`Emote Animado: ${emote.name}`}>
                            {emote.gifUrl ? (
                              <img src={emote.gifUrl} alt={emote.name} className="shop-epic-gif-media" />
                            ) : (
                              <div className="shop-epic-gif-placeholder">
                                <span className="shop-epic-gif-emoji">{emote.placeholderEmoji}</span>
                                <span className="shop-epic-gif-tag">ESPACIO PARA GIF</span>
                              </div>
                            )}
                          </div>

                          <div className="shop-epic-emote-card__info">
                            <h4 className="shop-epic-emote-card__name">{emote.name}</h4>
                            <p className="shop-epic-emote-card__tagline">"{emote.tagline}"</p>
                          </div>

                          <div className="shop-epic-emote-card__footer">
                            <div className="shop-epic-emote-price">
                              <img src={monedaImg} alt="Oro" className="shop-epic-coin-ico-sm" />
                              <span>{emote.priceGold} Oro</span>
                            </div>
                            <button
                              type="button"
                              className="shop-epic-emote-action-btn"
                              onClick={() => {
                                setThemedAlert({
                                  title: '🎭 PRÓXIMAMENTE',
                                  message: `¡El emote "${emote.name}" (${emote.category}) estará disponible para adquirir por ${emote.priceGold} Monedas de Oro en la próxima actualización de animaciones PvP!`,
                                  icon: '🎭',
                                })
                              }}
                            >
                              PRÓXIMAMENTE
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* SLIDE 2: 📺 3 ANUNCIOS RECOMPENSADOS (CONDICIONADO POR ADS_ENABLED) */}
                {ADS_ENABLED && (
                  <div className="shop-slide-item">
                    <div className="shop-epic-section shop-epic-section--ads">
                      <div className="shop-epic-section__header">
                        <div className="shop-epic-section__title-wrap">
                          <span className="shop-epic-section__icon">📺</span>
                          <div>
                            <h2 className="shop-epic-section__title">ZONA DE ANUNCIOS RECOMPENSADOS (GRATIS)</h2>
                            <span className="shop-epic-section__subtitle">
                              Mira videos publicitarios cortos y acumula monedas de oro diariamente sin costo.
                            </span>
                          </div>
                        </div>

                        <div className="shop-epic-section__header-actions">
                          <button
                            type="button"
                            className="shop-slide-nav-btn shop-slide-nav-btn--prev"
                            onClick={() => {
                              soundManager.playSound('click', 0.5)
                              setGoldSlideIndex(1)
                            }}
                            title="Volver a Emotes"
                          >
                            ◀ EMOTES
                          </button>
                          <button
                            type="button"
                            className="shop-slide-nav-btn shop-slide-nav-btn--gold"
                            onClick={() => {
                              soundManager.playSound('click', 0.5)
                              setGoldSlideIndex(0)
                            }}
                            title="Volver a Bóveda de Oro"
                          >
                            VOLVER A ORO (3/3) 💰
                          </button>
                        </div>
                      </div>

                      <div className="shop-epic-ads-grid">
                        {AD_REWARD_SLOTS.map((ad) => (
                          <div key={ad.id} className="shop-ad-card">
                            {/* 1. PANTALLA DE CINE / VIDEO PLAYER PREVIEW */}
                            <div className="shop-ad-card__screen" title="Reproductor de Video Recompensado">
                              <div className="shop-ad-card__screen-glow" />
                              <div className="shop-ad-card__screen-icon-box">
                                <span className="shop-ad-card__screen-emoji">{ad.icon}</span>
                                <span className="shop-ad-card__screen-slot">CANAL #{ad.slotNumber}</span>
                              </div>
                              <div className="shop-ad-card__screen-overlay">
                                <span className="shop-ad-card__screen-reward-tag">💰 +{ad.rewardGold} ORO</span>
                              </div>
                            </div>

                            {/* 2. INFORMACIÓN Y DETALLES DEL ANUNCIO */}
                            <div className="shop-ad-card__content">
                              <h4 className="shop-ad-card__title">{ad.title}</h4>
                              <p className="shop-ad-card__desc">{ad.rewardDescription}</p>
                              <div className="shop-ad-card__meta-bar">
                                <span className="shop-ad-card__limit">⏳ {ad.durationText}</span>
                                <div className="shop-ad-card__limit-pills">
                                  <span className="shop-ad-card__limit-dot active" />
                                  <span className="shop-ad-card__limit-dot active" />
                                  <span className="shop-ad-card__limit-dot active" />
                                </div>
                              </div>
                            </div>

                            {/* 3. BOTÓN DE ACCIÓN TÁCTICO */}
                            <button
                              type="button"
                              className="shop-ad-card__btn"
                              onClick={() => handleWatchAd(ad)}
                            >
                              <span>▶ VER ANUNCIO</span>
                              <strong className="shop-ad-card__btn-gain">+{ad.rewardGold} ORO</strong>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* INDICADOR INFERIOR DE PUNTOS Y GUÍA */}
            <div className="shop-slider-footer">
              <div className="shop-slider-dots">
                {(ADS_ENABLED ? [0, 1, 2] : [0, 1]).map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`shop-slider-dot ${goldSlideIndex === idx ? 'shop-slider-dot--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.5)
                      setGoldSlideIndex(idx)
                    }}
                    title={`Ir a sección ${idx + 1}`}
                  />
                ))}
              </div>
              <span className="shop-slider-hint">
                {ADS_ENABLED ? (
                  <>💡 Desliza la pantalla o pulsa los botones de navegación para alternar entre <strong>Oro</strong>, <strong>Emotes</strong> y <strong>Ads</strong></>
                ) : (
                  <>💡 Desliza la pantalla o pulsa los botones de navegación para alternar entre <strong>Oro</strong> y <strong>Emotes</strong></>
                )}
              </span>
            </div>
          </div>
        )}

        {/* TAB: ENERGÍAS ⚡ (RECARGAS ANTI-SPAM PARA RANKED COMPETITIVO) */}
        {activeTab === 'energy' && (
          <div className="shop-tab-pane shop-energy-pane">
            <div className="shop-packs-section-bar">
              <span className="shop-section-tagline">
                ⚡ Gestión y Recarga de Energías para Ranked Competitivo (≥ 1602 Copas). Recarga automática a las 00:00 UTC.
              </span>
            </div>

            {/* Banner de Estado de Energía */}
            <div className="shop-energy-status-card">
              <div className="shop-energy-status-left">
                <div className="shop-energy-status-bolt">⚡</div>
                <div className="shop-energy-status-details">
                  <div className="shop-energy-status-heading">
                    Energía Diaria:{' '}
                    <span className="shop-energy-status-val">
                      {userElo <= 1601 ? '∞ (ILIMITADA)' : `${playerEnergy} / ${maxPlayerEnergy}`}
                    </span>
                    {hasVipPass && (
                      <span className="shop-energy-vip-pill">
                        👑 PASE VIP {userElo <= 1601 ? '(+5 DIARIAS EN RANKED)' : '(+5 DIARIAS)'}
                      </span>
                    )}
                  </div>
                  <p className="shop-energy-status-subtext">
                    {userElo <= 1601
                      ? `Estás en Arena 1 (< 1602 copas). Todas tus partidas son gratuitas y no consumen energía. Al alcanzar 1602 copas (Ranked Competitivo) contarás con tus ${maxPlayerEnergy} energías diarias (${hasVipPass ? '25 por tu Pase VIP' : '20 estándar'}).`
                      : hasVipPass
                      ? 'Cuentas con 25 energías diarias (+5 por Pase VIP). Las partidas en rango competitivo (≥ 1602 copas) consumen 1 ⚡ por juego.'
                      : 'Cuentas con 20 energías diarias. Las partidas en rango competitivo (≥ 1602 copas) consumen 1 ⚡ por juego. Activa el Pase VIP para obtener 25 diarias.'}
                  </p>
                </div>
              </div>
              <div className="shop-energy-status-right">
                <span className="shop-energy-reset-label">🔄 Recarga Automática:</span>
                <span className="shop-energy-reset-time">00:00 UTC</span>
                <span className="shop-energy-reset-note">* Reseteo estricto (no acumulable)</span>
              </div>
            </div>

            {/* Grid de Paquetes de Energía */}
            <div className="shop-energy-grid">
              {ENERGY_PACKAGES.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`shop-energy-card ${pkg.popular ? 'shop-energy-card--popular' : ''} ${pkg.bestValue ? 'shop-energy-card--best' : ''}`}
                >
                  {pkg.badge && <div className="shop-energy-badge-ribbon">{pkg.badge}</div>}

                  <div className="shop-energy-card-icon-box">
                    <span className="shop-energy-card-icon">⚡</span>
                    <span className="shop-energy-card-qty">+{pkg.energyAmount}</span>
                  </div>

                  <h3 className="shop-energy-card-name">{pkg.name}</h3>
                  <p className="shop-energy-card-desc">{pkg.description}</p>

                  <div className="shop-energy-card-price-tag">
                    <span className="shop-energy-gem">💎</span>
                    <span className="shop-energy-price-num">{pkg.priceGems.toLocaleString()} Gemas</span>
                    <span className="shop-energy-price-usd">(${(pkg.priceGems / 100).toFixed(2)} USD)</span>
                  </div>

                  <button
                    type="button"
                    className="shop-energy-card-buy-btn"
                    onClick={() => handleBuyEnergy(pkg)}
                  >
                    ⚡ RECARGAR
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: COMERCIO */}
        {activeTab === 'market' && (

          <div className="shop-tab-pane" style={{ padding: 0, height: '100%' }}>
            <Marketplace
              userTokens={userTokens}
              userElo={userElo}
              hasVipPass={hasVipPass}
              plantCopies={plantCopies as Record<PlantId, number>}
              plantLevels={plantLevels as Record<PlantId, number>}
              plantStatRolls={plantStatRolls as Record<PlantId, PlantStatKey[]>}
              plantInstances={plantInstances}
              farmingItems={farmingItems}
              onDeductTokens={onDeductTokens || (() => false)}
              onDonatePlant={onDonatePlant || (() => false)}
              onReceivePlant={onReceivePlant || (() => {})}
              onBuyVipPass={onBuyVipPass || (async () => ({ success: false, error: 'Compra no disponible' }))}
              onServerChange={onServerChange}
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
              <div className="main-menu-dialog-header">
                <div className="main-menu-dialog-icon">{themedAlert.icon}</div>
                <h3 className="main-menu-dialog-title">{themedAlert.title}</h3>
                <button
                  type="button"
                  className="main-menu-dialog-close"
                  onClick={() => setThemedAlert(null)}
                >
                  ✕
                </button>
              </div>
              <p className="main-menu-dialog-msg">{themedAlert.message}</p>
              <div className="main-menu-dialog-actions">
                <button
                  type="button"
                  className="main-menu-dialog-btn"
                  onClick={() => setThemedAlert(null)}
                >
                  ENTENDIDO
                </button>
              </div>
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
                  alt="Sobre de semillas"
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
                      ? '10.00'
                      : '25.00'}{' '}
                    USD
                  </span>
                  <span className="shop-pack-details-gems-val">
                    💎 {packPrice(selectedPackDetails).toLocaleString('en-US')} Gemas
                  </span>
                </div>
              </div>

              <p className="shop-pack-details-desc">
                {selectedPackDetails === 'basic'
                  ? 'Contiene 3 cartas de plantas. Probabilidades equilibradas para ampliar tu equipo inicial de combate.'
                  : selectedPackDetails === 'epic'
                  ? 'Contiene 4 cartas de plantas para potenciar tu jardín con altas probabilidades de cartas especiales.'
                  : 'Contiene 4 cartas de plantas de gran poder, sin cartas comunes y con probabilidad de legendaria.'}
              </p>

              <div className="shop-pack-details-odds">
                <strong>🎯 PROBABILIDADES DE DROP (POR CARTA):</strong>
                <p>
                  {selectedPackDetails === 'basic'
                    ? '70% Común | 20% Poco Común | 10% Rara'
                    : selectedPackDetails === 'epic'
                    ? '30% Común | 40% Poco Común | 20% Rara | 8% Épica | 2% Legendaria'
                    : '40% Poco Común | 30% Rara | 20% Épica | 10% Legendaria'}
                </p>
              </div>

              <div className="shop-pack-details-actions">
                <button
                  type="button"
                  className="shop-pack-btn"
                  disabled={isPurchasingPack}
                  onClick={() => {
                    const target = selectedPackDetails
                    setSelectedPackDetails(null)
                    handleBuyPacksBatch(target)
                  }}
                >
                  {isPurchasingPack
                    ? '⏳ PROCESANDO...'
                    : `🛒 COMPRAR (${getQty(selectedPackDetails)}) — ${(packPrice(selectedPackDetails) * getQty(selectedPackDetails)).toLocaleString('en-US')} 💎 Gemas`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
