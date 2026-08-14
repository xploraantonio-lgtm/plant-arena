import { useState, useEffect, useMemo } from 'react'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import type { InventoryPack, PackId } from '../../utils/packDropManager'
import './Jardin.css'

const sunIcon = '/game-assets/greenfoot/sun1.png'
const ALL_PLANTS = Object.keys(PLANT_CONFIGS) as PlantId[]

interface JardinProps {
  activeDeck: PlantId[]
  unlockedPlants: PlantId[]
  inventoryPacks: InventoryPack[]
  userTokens: number
  plantCopies?: Partial<Record<PlantId, number>>
  plantLevels?: Partial<Record<PlantId, number>>
  onUpdateDeck: (newDeck: PlantId[]) => void
  onBack: () => void
  onPlay: () => void
  onOpenCollection: () => void
  onOpenShop: () => void
  onOpenPack: (instanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onFusePlant?: (plantId: PlantId) => void
}

export default function Jardin({
  activeDeck,
  unlockedPlants,
  inventoryPacks,
  userTokens,
  plantCopies = {},
  plantLevels = {},
  onUpdateDeck,
  onBack,
  onPlay,
  onOpenCollection,
  onOpenShop,
  onOpenPack,
  onOpenMultiplePacks,
  onFusePlant,
}: JardinProps) {
  const [deck, setDeck] = useState<PlantId[]>(activeDeck)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())

  const [openQuantities, setOpenQuantities] = useState<Record<string, number>>({})

  // Group inventory packs by packId
  const groupedPacks = useMemo(() => {
    const map = new Map<PackId, InventoryPack[]>()
    inventoryPacks.forEach((p) => {
      if (!map.has(p.packId)) map.set(p.packId, [])
      map.get(p.packId)!.push(p)
    })
    return Array.from(map.entries()).map(([packId, instances]) => ({
      packId,
      first: instances[0],
      count: instances.length,
      instances,
    }))
  }, [inventoryPacks])

  const getQty = (packId: string, maxCount: number) => {
    const val = openQuantities[packId] ?? 1
    return Math.max(1, Math.min(maxCount, val))
  }

  const setQty = (packId: string, val: number, maxCount: number) => {
    const clamped = Math.max(1, Math.min(maxCount, val))
    setOpenQuantities((prev) => ({ ...prev, [packId]: clamped }))
  }

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  // Sync internal deck with activeDeck prop if activeDeck changes
  useEffect(() => {
    setDeck(activeDeck)
  }, [activeDeck])

  const handleRemovePlant = (plantId: PlantId) => {
    soundManager.playSound('plantation', 0.4)
    if (deck.length > 3) {
      const next = deck.filter((id) => id !== plantId)
      setDeck(next)
      onUpdateDeck(next)
      setSelectedSlotIndex(null)
    }
  }

  const handleTogglePlant = (plantId: PlantId) => {
    // If plant is locked, notify user
    if (!unlockedPlants.includes(plantId)) {
      soundManager.playSound('plantation', 0.2)
      alert(`🔒 ¡Planta Bloqueada!\nConsigue "${PLANT_CONFIGS[plantId].name}" abriendo Sobres de Semillas en la Tienda o en tu Inventario.`)
      return
    }

    soundManager.playSound('plantation', 0.5)

    if (deck.includes(plantId)) {
      // Remove from deck if > 3 plants
      if (deck.length > 3) {
        const next = deck.filter((id) => id !== plantId)
        setDeck(next)
        onUpdateDeck(next)
      }
    } else {
      // Add or Swap
      if (selectedSlotIndex !== null && selectedSlotIndex < deck.length) {
        const next = [...deck]
        next[selectedSlotIndex] = plantId
        setDeck(next)
        onUpdateDeck(next)
        setSelectedSlotIndex(null)
      } else if (deck.length < 6) {
        const next = [...deck, plantId]
        setDeck(next)
        onUpdateDeck(next)
      } else {
        // Deck full (6/6): replace last card
        const next = [...deck.slice(0, 5), plantId]
        setDeck(next)
        onUpdateDeck(next)
      }
    }
  }

  const isDeckValid = deck.length >= 3 && deck.length <= 6

  return (
    <div className="jardin-screen" style={{ backgroundImage: `url(${background})` }}>
      {/* Top Navigation Bar */}
      <div className="jardin-header">
        <button className="jardin-back-btn" type="button" onClick={onBack}>
          ⬅️ MENÚ
        </button>
        <div className="jardin-header__center">
          <h1 className="jardin-title">MI JARDÍN - INVENTARIO REAL & DECK BUILDER</h1>
          <span className="jardin-subtitle">
            🪴 Tu Jardín determina lo que posees: sobres guardados y plantas desbloqueadas
          </span>
        </div>
        <div className="jardin-header__right">
          <div className="jardin-token-badge">
            <span>💵 ${userTokens}.00</span>
          </div>
          <button className="jardin-btn-shop" type="button" onClick={onOpenShop}>
            🛒 TIENDA
          </button>
          <button className="jardin-btn-sec" type="button" onClick={onOpenCollection}>
            📖 ALMANAQUE
          </button>
          <button
            className="jardin-mute-btn"
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

      {/* Main Content Area */}
      <div className="jardin-scroll-area">
        {/* UNOPENED PACKS INVENTORY SECTION */}
        <div className="jardin-packs-section">
          <div className="jardin-section-header">
            <h2 className="jardin-section-title">
              🎒 INVENTARIO DE SOBRES SIN ABRIR ({inventoryPacks.length})
            </h2>
            <button className="jardin-buy-more-btn" type="button" onClick={onOpenShop}>
              🛒 COMPRAR MÁS SOBRES EN TIENDA
            </button>
          </div>

          {groupedPacks.length === 0 ? (
            <div className="jardin-empty-packs">
              <span className="jardin-empty-icon">🎒</span>
              <div className="jardin-empty-info">
                <strong>No tienes sobres en tu inventario.</strong>
                <p>Compra sobres de semillas en la Tienda para guardarlos y abrirlos en tu Jardín.</p>
              </div>
              <button className="jardin-empty-btn" type="button" onClick={onOpenShop}>
                🛒 IR A LA TIENDA
              </button>
            </div>
          ) : (
            <div className="jardin-packs-grid">
              {groupedPacks.map((group) => {
                const currentQty = getQty(group.packId, group.count)
                return (
                  <div key={group.packId} className={`jardin-pack-card jardin-pack-card--${group.first.rarity}`}>
                    <div className="jardin-pack-stack-badge">
                      <span>x{group.count} SOBRES</span>
                    </div>
                    <img src={group.first.icon} alt={group.first.name} className="jardin-pack-card__img" />
                    <div className="jardin-pack-card__info">
                      <span className="jardin-pack-card__name">{group.first.name}</span>
                      <span className="jardin-pack-card__rarity">
                        {group.first.rarity === 'common' ? 'Verde Mágico' : group.first.rarity === 'epic' ? 'Místico Púrpura' : 'Legendario Dorado'}
                      </span>
                    </div>

                    {group.count > 1 ? (
                      <div className="jardin-pack-controls-wrap">
                        <div className="jardin-pack-qty-picker">
                          <span className="jardin-pack-qty-label">ABRIR:</span>
                          <button
                            type="button"
                            className="jardin-pack-qty-btn"
                            onClick={() => setQty(group.packId, currentQty - 1, group.count)}
                          >
                            -
                          </button>
                          <span className="jardin-pack-qty-num">{currentQty}</span>
                          <button
                            type="button"
                            className="jardin-pack-qty-btn"
                            onClick={() => setQty(group.packId, currentQty + 1, group.count)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="jardin-pack-qty-max"
                            onClick={() => setQty(group.packId, group.count, group.count)}
                          >
                            MÁX
                          </button>
                        </div>
                        <button
                          type="button"
                          className="jardin-pack-card__open-btn"
                          onClick={() => {
                            const targetIds = group.instances.slice(0, currentQty).map((i: InventoryPack) => i.instanceId)
                            if (currentQty === 1) {
                              onOpenPack(targetIds[0])
                            } else if (onOpenMultiplePacks) {
                              onOpenMultiplePacks(targetIds)
                            }
                          }}
                        >
                          💥 ABRIR {currentQty} {currentQty === 1 ? 'SOBRE' : 'SOBRES'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="jardin-pack-card__open-btn"
                        onClick={() => onOpenPack(group.instances[0].instanceId)}
                      >
                        ✨ ABRIR 1 SOBRE
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ACTIVE BATTLE DECK (3 TO 6 SLOTS) */}
        <div className="jardin-deck-container">
          <div className="jardin-deck-header">
            <span className="jardin-deck-title">
              ⚔️ MAZO DE BATALLA DE MI JARDÍN ({deck.length}/6 PLANTAS)
            </span>
            <span
              className={`jardin-deck-status ${
                isDeckValid ? 'jardin-deck-status--ready' : ''
              }`}
            >
              {isDeckValid
                ? `✅ LISTO PARA COMBATE (${deck.length}/6 PLANTAS)`
                : `⚠️ MÍNIMO 3 PLANTAS REQUERIDAS (TIENES ${deck.length})`}
            </span>
          </div>

          <div className="jardin-slots-grid">
            {Array.from({ length: 6 }).map((_, idx) => {
              const plantId = deck[idx]
              const config = plantId ? PLANT_CONFIGS[plantId] : null
              const isSelectedSlot = selectedSlotIndex === idx

              return (
                <button
                  key={idx}
                  type="button"
                  className={`jardin-slot ${config ? 'jardin-slot--filled' : 'jardin-slot--empty'} ${
                    isSelectedSlot ? 'jardin-slot--active' : ''
                  }`}
                  onClick={() => {
                    soundManager.playSound('plantation', 0.4)
                    setSelectedSlotIndex(idx)
                  }}
                >
                  <span className="jardin-slot__num">SLOT {idx + 1}</span>

                  {config ? (
                    <div className="jardin-slot__content">
                      {deck.length > 3 && (
                        <span
                          className="jardin-slot__remove-btn"
                          title="Quitar esta planta del mazo"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemovePlant(plantId)
                          }}
                        >
                          ✖
                        </span>
                      )}
                      <div className="jardin-slot__cost">
                        <img src={sunIcon} alt="Sol" className="jardin-slot__sun" />
                        <span>{config.cost}</span>
                      </div>
                      <img src={config.icon} alt={config.name} className="jardin-slot__img" />
                      <span className="jardin-slot__name">{config.name}</span>
                    </div>
                  ) : (
                    <div className="jardin-slot__placeholder">
                      <span className="jardin-slot__plus">+</span>
                      <span className="jardin-slot__hint">ELIGE PLANTA</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <div className="jardin-action-bar">
            <button
              type="button"
              className="jardin-play-btn"
              disabled={!isDeckValid}
              onClick={onPlay}
            >
              🎮 IR A BATALLA CON ESTE EQUIPO ({deck.length} PLANTAS)
            </button>
          </div>
        </div>

        {/* INVENTORY CATALOG GRID (UNLOCKED VS LOCKED) */}
        <div className="jardin-inventory-container">
          <h2 className="jardin-inventory-title">
            🌱 PLANTAS DESBLOQUEADAS Y DISPONIBLES EN TU JARDÍN ({unlockedPlants.length}/{ALL_PLANTS.length})
          </h2>
          <div className="jardin-inventory-grid">
            {ALL_PLANTS.map((plantId) => {
              const config = PLANT_CONFIGS[plantId]
              const isUnlocked = unlockedPlants.includes(plantId)
              const inDeck = deck.includes(plantId)
              const copies = plantCopies[plantId] || (isUnlocked ? 1 : 0)
              const currentLvl = plantLevels[plantId] || 0
              const isLegendary = plantId === 'threepeater' || plantId === 'iceberglettuce'
              const maxLvl = isLegendary ? 3 : 5

              return (
                <button
                  key={plantId}
                  type="button"
                  className={`jardin-card ${
                    !isUnlocked
                      ? 'jardin-card--locked'
                      : inDeck
                      ? 'jardin-card--indeck'
                      : 'jardin-card--unlocked'
                  }`}
                  onClick={() => handleTogglePlant(plantId)}
                >
                  {/* CIRCULAR LEVEL BADGE */}
                  {isUnlocked && (
                    <div
                      className={`jardin-level-circle ${currentLvl === maxLvl ? 'jardin-level-circle--max' : ''}`}
                      title={`Nivel ${currentLvl}`}
                    >
                      {currentLvl > 0 ? `LVL ${currentLvl}` : 'N0'}
                    </div>
                  )}

                  <div className="jardin-card__header">
                    <div className="jardin-card__cost">
                      <img src={sunIcon} alt="Sol" className="jardin-card__sun" />
                      <span>{config.cost}</span>
                    </div>
                    {inDeck && <span className="jardin-card__badge">EN MAZO ✓</span>}
                    {isUnlocked && !inDeck && (
                      <span className="jardin-card__badge" style={{ color: '#60a5fa', borderColor: '#60a5fa' }}>
                        OBTENIDA ✓
                      </span>
                    )}
                    {!isUnlocked && <span className="jardin-card__badge-locked">🔒 BLOQUEADA</span>}
                  </div>

                  <img
                    src={config.icon}
                    alt={config.name}
                    className={`jardin-card__img ${!isUnlocked ? 'jardin-card__img--locked' : ''}`}
                  />

                  <span className="jardin-card__name">{config.name}</span>
                  <span className="jardin-card__cat">
                    {!isUnlocked
                      ? '🔒 Abrir sobre en Tienda'
                      : config.category === 'producer'
                      ? '☀️ Productora'
                      : config.category === 'ranged'
                      ? '🏹 Atacante'
                      : config.category === 'defensive'
                      ? '🛡️ Tanque'
                      : '🥊 Mele'}
                  </span>

                  {isUnlocked && (
                    <div className="jardin-card-copies-tag">
                      COPIAS: {copies}/5 {currentLvl >= maxLvl ? '(MÁX)' : ''}
                    </div>
                  )}

                  {isUnlocked && copies >= 5 && currentLvl < maxLvl && (
                    <button
                      type="button"
                      className="jardin-fuse-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onFusePlant) {
                          soundManager.playSound('plantation', 0.9)
                          onFusePlant(plantId)
                        }
                      }}
                    >
                      🔥 FUSIONAR (5/5) ➔ LVL {currentLvl + 1}
                    </button>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
