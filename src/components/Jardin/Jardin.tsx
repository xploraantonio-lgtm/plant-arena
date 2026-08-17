import { useState, useEffect, useMemo } from 'react'
import type { PlantCardInstance, PlantId } from '../../types/game'
import {
  PLANT_CONFIGS,
  STAT_LABELS,
  type PlantStatKey,
} from '../../utils/gameConstants'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import type { InventoryPack, PackId } from '../../utils/packDropManager'
import LotteryModal from '../Lottery/LotteryModal'
import './Jardin.css'

const sunIcon = '/game-assets/greenfoot/sun1.png'
const ALL_PLANTS = Object.keys(PLANT_CONFIGS) as PlantId[]

function groupRolls(rolls: PlantStatKey[]) {
  const map = new Map<PlantStatKey, number>()
  rolls.forEach((r) => {
    map.set(r, (map.get(r) || 0) + 1)
  })
  return Array.from(map.entries()).map(([stat, count]) => {
    const meta = STAT_LABELS[stat]
    const totalPct = count * 15
    const label = count > 1 ? `${meta.icon} +${totalPct}% ${meta.suffix.replace('+15% ', '').replace('-15% ', '')} (x${count})` : `${meta.icon} ${meta.suffix}`
    return {
      stat,
      count,
      totalPct,
      label,
      color: meta.color,
      meta,
    }
  })
}

interface JardinProps {
  activeDeck: PlantId[]
  unlockedPlants: PlantId[]
  inventoryPacks: InventoryPack[]
  userTokens: number
  userGold?: number
  plantCopies?: Partial<Record<PlantId, number>>
  plantLevels?: Partial<Record<PlantId, number>>
  plantStatRolls?: Partial<Record<PlantId, PlantStatKey[]>>
  plantInstances?: PlantCardInstance[]
  onUpdateDeck: (newDeck: PlantId[], instanceIds?: string[]) => void
  onBack: () => void
  onPlay: () => void
  onOpenCollection: () => void
  onOpenShop: () => void
  onOpenPack: (instanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onFusePlant?: (plantId: PlantId, instanceId?: string) => {
    success: boolean
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    error?: string
  }
  onDeductTokens?: (amountUsd: number) => boolean
  onAddTokens?: (amountUsd: number) => void
  onAddGold?: (amount: number) => void
  onAddPacks?: (packId: 'basic' | 'epic' | 'legendary', qty: number) => void
  onReceivePlant?: (plantId: PlantId, qty: number) => void
}

export default function Jardin({
  activeDeck,
  unlockedPlants,
  inventoryPacks,
  userTokens,
  userGold = 0,
  plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
  plantInstances = [],
  onUpdateDeck,
  onBack,
  onPlay,
  onOpenCollection,
  onOpenShop,
  onOpenPack,
  onOpenMultiplePacks,
  onFusePlant,
  onDeductTokens,
  onAddTokens,
  onAddGold,
  onAddPacks,
  onReceivePlant,
}: JardinProps) {
  const [deck, setDeck] = useState<PlantId[]>(activeDeck)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [showLotteryModal, setShowLotteryModal] = useState(false)
  const [upgradeModal, setUpgradeModal] = useState<{
    plantId: PlantId
    newLevel: number
    rolledStat: PlantStatKey
  } | null>(null)

  const [openQuantities, setOpenQuantities] = useState<Record<string, number>>({})

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

  const isDeckValid = deck.length >= 3 && deck.length <= 6

  // Computes all cards to display: Base cards + separate purchased/upgraded instances
  const displayedCards = useMemo(() => {
    const cards: {
      instanceId: string
      plantId: PlantId
      level: number
      statRolls: PlantStatKey[]
      isBase: boolean
      isUnlocked: boolean
    }[] = []

    ALL_PLANTS.forEach((plantId) => {
      const isUnlocked = unlockedPlants.includes(plantId)
      if (!isUnlocked) {
        cards.push({
          instanceId: `locked_${plantId}`,
          plantId,
          level: 0,
          statRolls: [],
          isBase: true,
          isUnlocked: false,
        })
        return
      }

      const instances = plantInstances.filter((i) => i.plantId === plantId)
      if (instances.length > 0) {
        instances.forEach((inst) => {
          cards.push({
            instanceId: inst.instanceId,
            plantId: inst.plantId,
            level: inst.level,
            statRolls: inst.statRolls || [],
            isBase: inst.isBase ?? false,
            isUnlocked: true,
          })
        })
      } else {
        // Fallback base card
        cards.push({
          instanceId: `inst_base_${plantId}`,
          plantId,
          level: plantLevels[plantId] || 0,
          statRolls: plantStatRolls[plantId] || [],
          isBase: true,
          isUnlocked: true,
        })
      }
    })

    return cards
  }, [unlockedPlants, plantInstances, plantLevels, plantStatRolls])

  // We track the array of instance IDs currently selected in the deck (up to 6)
  const [deckInstanceIds, setDeckInstanceIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('plant_arena_active_deck_instances')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((id) => displayedCards.some((c) => c.instanceId === id && c.isUnlocked))
          if (valid.length > 0) return valid
        }
      }
    } catch {}

    const result: string[] = []
    const used = new Set<string>()
    activeDeck.forEach((pId) => {
      const inst = displayedCards.find((c) => c.plantId === pId && !used.has(c.instanceId) && c.isUnlocked)
      if (inst) {
        result.push(inst.instanceId)
        used.add(inst.instanceId)
      }
    })
    return result
  })

  // Synchronize with activeDeck changes and persist
  useEffect(() => {
    try {
      localStorage.setItem('plant_arena_active_deck_instances', JSON.stringify(deckInstanceIds))
    } catch {}
  }, [deckInstanceIds])

  useEffect(() => {
    setDeck(activeDeck)
  }, [activeDeck])

  const handleRemoveSlotInstance = (slotIdx: number) => {
    soundManager.playSound('plantation', 0.4)
    const next = deckInstanceIds.filter((_, idx) => idx !== slotIdx)
    setDeckInstanceIds(next)
    const plantIds = next
      .map((id) => displayedCards.find((c) => c.instanceId === id)?.plantId)
      .filter(Boolean) as PlantId[]
    setDeck(plantIds)
    onUpdateDeck(plantIds, next)
    setSelectedSlotIndex(null)
  }

  const handleToggleCardInstance = (card: typeof displayedCards[0]) => {
    if (!card.isUnlocked) {
      soundManager.playSound('plantation', 0.2)
      return
    }

    soundManager.playSound('plantation', 0.5)

    const inDeck = deckInstanceIds.includes(card.instanceId)

    if (inDeck) {
      const next = deckInstanceIds.filter((id) => id !== card.instanceId)
      setDeckInstanceIds(next)
      const plantIds = next
        .map((id) => displayedCards.find((c) => c.instanceId === id)?.plantId)
        .filter(Boolean) as PlantId[]
      setDeck(plantIds)
      onUpdateDeck(plantIds, next)
      setSelectedSlotIndex(null)
    } else {
      if (selectedSlotIndex !== null) {
        const next = [...deckInstanceIds]
        if (selectedSlotIndex < next.length) {
          next[selectedSlotIndex] = card.instanceId
        } else if (next.length < 6) {
          next.push(card.instanceId)
        }
        setDeckInstanceIds(next)
        const plantIds = next
          .map((id) => displayedCards.find((c) => c.instanceId === id)?.plantId)
          .filter(Boolean) as PlantId[]
        setDeck(plantIds)
        onUpdateDeck(plantIds, next)
        setSelectedSlotIndex(null)
      } else {
        if (deckInstanceIds.length < 6) {
          const next = [...deckInstanceIds, card.instanceId]
          setDeckInstanceIds(next)
          const plantIds = next
            .map((id) => displayedCards.find((c) => c.instanceId === id)?.plantId)
            .filter(Boolean) as PlantId[]
          setDeck(plantIds)
          onUpdateDeck(plantIds, next)
        }
      }
    }
  }

  const handlePlayClick = () => {
    const currentPlantIds = deckInstanceIds
      .map((id) => displayedCards.find((c) => c.instanceId === id)?.plantId)
      .filter(Boolean) as PlantId[]
    if (currentPlantIds.length >= 3) {
      onUpdateDeck(currentPlantIds, deckInstanceIds)
      try {
        localStorage.setItem('plant_arena_active_deck', JSON.stringify(currentPlantIds))
        localStorage.setItem('plant_arena_active_deck_instances', JSON.stringify(deckInstanceIds))
      } catch {}
      onPlay()
    }
  }

  return (
    <div
      className="jardin-screen"
      style={{ backgroundImage: `url(${background})` }}
    >
      <div className="jardin-header">
        <button type="button" className="jardin-back-btn" onClick={onBack}>
          ⬅ VOLVER AL MENÚ
        </button>
        <div className="jardin-header__center">
          <h1 className="jardin-title">🌱 JARDÍN BOTÁNICO & CARTAS</h1>
          <span className="jardin-subtitle">
            Personaliza tu equipo de batalla, fusiona copas y gestiona tus instancias mejoradas
          </span>
        </div>
        <div className="jardin-header__right">
          <button
            type="button"
            className="jardin-btn-lottery"
            onClick={() => {
              soundManager.playSound('click', 0.4)
              setShowLotteryModal(true)
            }}
          >
            🎰 LOTERÍA
          </button>
          <button type="button" className="jardin-btn-shop" onClick={onOpenShop}>
            🛒 TIENDA
          </button>
          <button type="button" className="jardin-btn-sec" onClick={onOpenCollection}>
            📖 ÁLBUM
          </button>
          <button
            type="button"
            className="jardin-mute-btn"
            onClick={() => soundManager.toggleMute()}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      <div className="jardin-scroll-area">
        {inventoryPacks.length > 0 && (
          <div className="jardin-packs-section">
            <div className="jardin-section-header">
              <h3 className="jardin-section-title">
                📦 SOBRES PENDIENTES POR ABRIR ({inventoryPacks.length})
              </h3>
              <button type="button" className="jardin-buy-more-btn" onClick={onOpenShop}>
                + Conseguir más sobres en la Tienda
              </button>
            </div>

            <div className="jardin-packs-grid">
              {groupedPacks.map((group) => {
                const maxCount = group.count
                const currentQty = getQty(group.packId, maxCount)
                const rarityClass =
                  group.first.rarity === 'legendary'
                    ? 'jardin-pack-card--legendary'
                    : group.first.rarity === 'epic'
                    ? 'jardin-pack-card--epic'
                    : 'jardin-pack-card--common'

                return (
                  <div key={group.packId} className={`jardin-pack-card ${rarityClass}`}>
                    {group.count > 1 && (
                      <span className="jardin-pack-stack-badge">
                        x{group.count}
                      </span>
                    )}
                    <img
                      src={group.first.icon}
                      alt={group.first.name}
                      className="jardin-pack-card__img"
                    />
                    <div className="jardin-pack-card__info">
                      <span className="jardin-pack-card__rarity">
                        {group.first.rarity === 'common'
                          ? '🌱 Verde Mágico'
                          : group.first.rarity === 'epic'
                          ? '🔮 Místico Púrpura'
                          : '👑 Legendario Dorado'}
                      </span>
                      <h4 className="jardin-pack-card__name">{group.first.name}</h4>
                    </div>

                    <div className="jardin-pack-controls-wrap">
                      <div className="jardin-pack-qty-picker">
                        <button
                          type="button"
                          className="jardin-pack-qty-btn"
                          disabled={currentQty <= 1}
                          onClick={() => {
                            soundManager.playSound('click', 0.4)
                            setQty(group.packId, currentQty - 1, maxCount)
                          }}
                          title="Disminuir cantidad"
                        >
                          -
                        </button>
                        <span className="jardin-pack-qty-num">{currentQty}</span>
                        <button
                          type="button"
                          className="jardin-pack-qty-btn"
                          disabled={currentQty >= maxCount}
                          onClick={() => {
                            soundManager.playSound('click', 0.4)
                            setQty(group.packId, currentQty + 1, maxCount)
                          }}
                          title="Aumentar cantidad"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="jardin-pack-qty-max"
                          disabled={currentQty >= maxCount}
                          onClick={() => {
                            soundManager.playSound('click', 0.4)
                            setQty(group.packId, maxCount, maxCount)
                          }}
                          title="Abrir todos"
                        >
                          MÁX
                        </button>
                      </div>

                      <button
                        type="button"
                        className="jardin-pack-card__open-btn"
                        onClick={() => {
                          soundManager.playSound('plantation', 0.8)
                          if (currentQty === 1) {
                            onOpenPack(group.instances[0].instanceId)
                          } else if (onOpenMultiplePacks) {
                            const ids = group.instances.slice(0, currentQty).map((p) => p.instanceId)
                            onOpenMultiplePacks(ids)
                          }
                        }}
                      >
                        {currentQty === 1 ? '✨ ABRIR SOBRE' : `✨ ABRIR (${currentQty})`}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ACTIVE BATTLE DECK (3 TO 6 SLOTS) */}
        <div className="jardin-deck-container">
          <div className="jardin-deck-header">
            <span className="jardin-deck-title">
              ⚔️ MAZO DE BATALLA DE MI JARDÍN ({deckInstanceIds.length}/6 PLANTAS)
            </span>
            <span
              className={`jardin-deck-status ${
                isDeckValid ? 'jardin-deck-status--ready' : ''
              }`}
            >
              {isDeckValid
                ? `✅ LISTO PARA COMBATE (${deckInstanceIds.length}/6 PLANTAS)`
                : `⚠️ MÍNIMO 3 PLANTAS REQUERIDAS (TIENES ${deckInstanceIds.length})`}
            </span>
          </div>

          <div className="jardin-slots-grid">
            {Array.from({ length: 6 }).map((_, slotIdx) => {
              const instanceId = deckInstanceIds[slotIdx]
              const card = displayedCards.find((c) => c.instanceId === instanceId)
              const config = card ? PLANT_CONFIGS[card.plantId] : null
              const isSelected = selectedSlotIndex === slotIdx

              return (
                <button
                  key={slotIdx}
                  type="button"
                  className={`jardin-slot ${config ? 'jardin-slot--filled' : 'jardin-slot--empty'} ${
                    isSelected ? 'jardin-slot--active' : ''
                  }`}
                  onClick={() => {
                    soundManager.playSound('plantation', 0.4)
                    setSelectedSlotIndex(isSelected ? null : slotIdx)
                  }}
                >
                  <span className="jardin-slot__num">SLOT {slotIdx + 1}</span>

                  {config && card ? (
                    <div className="jardin-slot__content">
                      <span
                        className="jardin-slot__remove-btn"
                        title="Quitar esta planta del mazo"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveSlotInstance(slotIdx)
                        }}
                      >
                        ✖
                      </span>
                      <div className="jardin-slot__cost">
                        <img src={sunIcon} alt="Sol" className="jardin-slot__sun" />
                        <span>{config.cost}</span>
                      </div>
                      <img src={config.icon} alt={config.name} className="jardin-slot__img" />
                      <span className="jardin-slot__name">
                        {config.name} {card.level > 0 ? `(L${card.level})` : ''}
                      </span>
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
              onClick={handlePlayClick}
            >
              🎮 IR A BATALLA CON ESTE EQUIPO ({deckInstanceIds.length} PLANTAS)
            </button>
          </div>
        </div>

        {/* INVENTORY CATALOG GRID (UNLOCKED VS LOCKED) */}
        <div className="jardin-inventory-container">
          <h2 className="jardin-inventory-title">
            🌱 PLANTAS DESBLOQUEADAS Y DISPONIBLES EN TU JARDÍN ({displayedCards.filter((c) => c.isUnlocked).length} ACTIVAS)
          </h2>
          <div className="jardin-inventory-grid">
            {displayedCards.map((card) => {
              const { instanceId, plantId, level, statRolls, isUnlocked } = card
              const config = PLANT_CONFIGS[plantId]
              const inDeck = deckInstanceIds.includes(instanceId)
              const copies = plantCopies[plantId] || (isUnlocked ? 1 : 0)
              const isLegendary = plantId === 'threepeater' || plantId === 'iceberglettuce'
              const maxLvl = isLegendary ? 3 : 5
              const groupedBuffs = groupRolls(statRolls)
              const canFuse = isUnlocked && copies >= 5 && level < maxLvl

              return (
                <div
                  key={instanceId}
                  role="button"
                  tabIndex={0}
                  className={`jardin-card ${
                    !isUnlocked
                      ? 'jardin-card--locked'
                      : inDeck
                      ? 'jardin-card--indeck'
                      : 'jardin-card--unlocked'
                  }`}
                  onClick={() => handleToggleCardInstance(card)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleToggleCardInstance(card)
                    }
                  }}
                >
                  {/* CIRCULAR LEVEL BADGE (ONLY NUMBER) */}
                  {isUnlocked && level > 0 && (
                    <div
                      className={`jardin-level-circle ${level === maxLvl ? 'jardin-level-circle--max' : ''}`}
                      title={`Nivel ${level}`}
                    >
                      {level}
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
                      ? '🔒 Bloqueada'
                      : config.category === 'producer'
                      ? '☀️ Productora'
                      : config.category === 'ranged'
                      ? '🏹 Atacante'
                      : config.category === 'defensive'
                      ? '🛡️ Tanque'
                      : '🥊 Mele'}
                  </span>

                  {groupedBuffs.length > 0 && (
                    <div className="jardin-card-rolls-wrap">
                      {groupedBuffs.map((b, idx) => (
                        <span
                          key={idx}
                          className="jardin-stat-roll-badge"
                          style={{ color: b.color, borderColor: b.color }}
                        >
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {isUnlocked && (
                    <div className="jardin-card-copies-tag">
                      COPIAS: {copies}/5 {level >= maxLvl ? '(MÁX)' : ''}
                    </div>
                  )}

                  {canFuse && (
                    <button
                      type="button"
                      className="jardin-fuse-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onFusePlant) {
                          soundManager.playSound('plantation', 0.9)
                          const res = onFusePlant(plantId, instanceId)
                          if (res && res.success && res.newLevel && res.rolledStat) {
                            setUpgradeModal({
                              plantId,
                              newLevel: res.newLevel,
                              rolledStat: res.rolledStat,
                            })
                          }
                        }
                      }}
                    >
                      🔥 FUSIONAR (5/5) ➔ LVL {level + 1}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* UPGRADE CELEBRATION MODAL */}
      {upgradeModal && (
        <div className="jardin-upgrade-modal-overlay" onClick={() => setUpgradeModal(null)}>
          <div className="jardin-upgrade-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="jardin-upgrade-modal-sparkle">✨ 🎲 ✨</div>
            <h3 className="jardin-upgrade-modal-title">¡MEJORA EXITOSA!</h3>
            <span className="jardin-upgrade-modal-level">NIVEL {upgradeModal.newLevel}</span>

            <img
              src={PLANT_CONFIGS[upgradeModal.plantId].icon}
              alt={PLANT_CONFIGS[upgradeModal.plantId].name}
              className="jardin-upgrade-modal-img"
            />
            <h4 className="jardin-upgrade-modal-name">{PLANT_CONFIGS[upgradeModal.plantId].name}</h4>

            <div
              className="jardin-upgrade-modal-rolled-box"
              style={{ borderColor: STAT_LABELS[upgradeModal.rolledStat].color }}
            >
              <span className="jardin-upgrade-modal-stat-icon">
                {STAT_LABELS[upgradeModal.rolledStat].icon}
              </span>
              <span
                className="jardin-upgrade-modal-stat-val"
                style={{ color: STAT_LABELS[upgradeModal.rolledStat].color }}
              >
                {STAT_LABELS[upgradeModal.rolledStat].suffix}
              </span>
              <span className="jardin-upgrade-modal-stat-name">
                {STAT_LABELS[upgradeModal.rolledStat].label}
              </span>
            </div>

            <p className="jardin-upgrade-modal-desc">
              ¡Esta planta acaba de obtener un <strong>+15% aleatorio</strong> en este atributo! Cada planta mejorará de forma única.
            </p>

            <button
              type="button"
              className="jardin-upgrade-modal-btn"
              onClick={() => setUpgradeModal(null)}
            >
              ¡ENTENDIDO! 🚀
            </button>
          </div>
        </div>
      )}

      {/* LOTTERY POPUP MODAL */}
      {showLotteryModal && (
        <LotteryModal
          isOpen={showLotteryModal}
          onClose={() => setShowLotteryModal(false)}
          userTokens={userTokens}
          userGold={userGold}
          onDeductTokens={onDeductTokens || (() => true)}
          onAddTokens={onAddTokens || (() => {})}
          onAddGold={onAddGold}
          onAddPacks={onAddPacks}
          onReceivePlant={onReceivePlant}
        />
      )}
    </div>
  )
}
