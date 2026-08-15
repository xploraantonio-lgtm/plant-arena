import { useState, useEffect, useMemo } from 'react'
import type { PlantId } from '../../types/game'
import {
  PLANT_CONFIGS,
  STAT_LABELS,
  type PlantStatKey,
} from '../../utils/gameConstants'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import type { InventoryPack, PackId } from '../../utils/packDropManager'
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
  plantCopies?: Partial<Record<PlantId, number>>
  plantLevels?: Partial<Record<PlantId, number>>
  plantStatRolls?: Partial<Record<PlantId, PlantStatKey[]>>
  onUpdateDeck: (newDeck: PlantId[]) => void
  onBack: () => void
  onPlay: () => void
  onOpenCollection: () => void
  onOpenShop: () => void
  onOpenPack: (instanceId: string) => void
  onOpenMultiplePacks?: (instanceIds: string[]) => void
  onFusePlant?: (plantId: PlantId) => {
    success: boolean
    newLevel?: number
    rolledStat?: PlantStatKey
    rolledStatLabel?: string
    error?: string
  }
}

export default function Jardin({
  activeDeck,
  unlockedPlants,
  inventoryPacks,
  userTokens,
  plantCopies = {},
  plantLevels = {},
  plantStatRolls = {},
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
    if (!unlockedPlants.includes(plantId)) {
      soundManager.playSound('plantation', 0.2)
      return
    }

    soundManager.playSound('plantation', 0.5)

    if (deck.includes(plantId)) {
      if (deck.length > 3) {
        const next = deck.filter((id) => id !== plantId)
        setDeck(next)
        onUpdateDeck(next)
        setSelectedSlotIndex(null)
      }
    } else {
      if (selectedSlotIndex !== null) {
        const next = [...deck]
        if (selectedSlotIndex < next.length) {
          next[selectedSlotIndex] = plantId
        } else if (next.length < 6) {
          next.push(plantId)
        }
        setDeck(next)
        onUpdateDeck(next)
        setSelectedSlotIndex(null)
      } else {
        if (deck.length < 6) {
          const next = [...deck, plantId]
          setDeck(next)
          onUpdateDeck(next)
        }
      }
    }
  }

  const isDeckValid = deck.length >= 3 && deck.length <= 6

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
          <h1 className="jardin-title">🌱 JARDÍN BOTÁNICO</h1>
          <span className="jardin-subtitle">
            Personaliza tu equipo de batalla, abre tus sobres y mejora tus plantas
          </span>
        </div>
        <div className="jardin-header__right">
          <div className="jardin-token-badge">🪙 {userTokens.toLocaleString()} FICHAS</div>
          <button type="button" className="jardin-btn-shop" onClick={onOpenShop}>
            🛒 TIENDA DE SOBRES
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
        <div className="jardin-packs-section">
          <div className="jardin-section-header">
            <h3 className="jardin-section-title">
              📦 SOBRES PENDIENTES POR ABRIR ({inventoryPacks.length})
            </h3>
            <button type="button" className="jardin-buy-more-btn" onClick={onOpenShop}>
              + Conseguir más sobres en la Tienda
            </button>
          </div>

          {groupedPacks.length === 0 ? (
            <div className="jardin-empty-packs">
              <span className="jardin-empty-icon">🌱</span>
              <div>
                <p className="jardin-empty-txt">No tienes sobres pendientes de apertura.</p>
                <span className="jardin-empty-sub">
                  ¡Gana combates en la Arena o visita la Tienda para conseguir nuevos sobres con cartas!
                </span>
              </div>
            </div>
          ) : (
            <div className="jardin-packs-grid">
              {groupedPacks.map((group) => {
                const maxCount = group.count
                const currentQty = getQty(group.packId, maxCount)

                return (
                  <div key={group.packId} className="jardin-pack-card">
                    {group.count > 1 && (
                      <span className="jardin-pack-card__count-badge">
                        x{group.count}
                      </span>
                    )}
                    <img
                      src={group.first.icon}
                      alt={group.first.name}
                      className="jardin-pack-card__img"
                    />
                    <div className="jardin-pack-card__info">
                      <span
                        className="jardin-pack-card__rarity"
                      >
                        {group.first.rarity === 'common' ? 'Verde Mágico' : group.first.rarity === 'epic' ? 'Místico Púrpura' : 'Legendario Dorado'}
                      </span>
                      <h4 className="jardin-pack-card__name">{group.first.name}</h4>
                    </div>

                    {group.count > 1 ? (
                      <div className="jardin-pack-multi-ctrl">
                        <div className="jardin-pack-qty-picker">
                          <button
                            type="button"
                            className="jardin-pack-qty-btn"
                            onClick={() => setQty(group.packId, currentQty - 1, maxCount)}
                          >
                            −
                          </button>
                          <span className="jardin-pack-qty-val">{currentQty}</span>
                          <button
                            type="button"
                            className="jardin-pack-qty-btn"
                            onClick={() => setQty(group.packId, currentQty + 1, maxCount)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="jardin-pack-qty-max"
                            onClick={() => setQty(group.packId, maxCount, maxCount)}
                          >
                            MÁX
                          </button>
                        </div>
                        <button
                          type="button"
                          className="jardin-pack-card__open-btn"
                          onClick={() => {
                            if (currentQty === 1) {
                              onOpenPack(group.instances[0].instanceId)
                            } else if (onOpenMultiplePacks) {
                              const idsToOpen = group.instances
                                .slice(0, currentQty)
                                .map((inst) => inst.instanceId)
                              onOpenMultiplePacks(idsToOpen)
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

        <div className="jardin-deck-container">
          <div className="jardin-deck-header">
            <span className="jardin-deck-title">
              ⚔️ MAZO DE BATALLA ({deck.length}/6)
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
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemovePlant(plantId)
                          }}
                        >
                          ✖
                        </span>
                      )}
                      <img src={config.icon} alt={config.name} className="jardin-slot__img" />
                    </div>
                  ) : (
                    <div className="jardin-slot__placeholder">
                      <span className="jardin-slot__plus">+</span>
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

        <div className="jardin-inventory-container">
          <h2 className="jardin-inventory-title">
            🌱 PLANTAS DESBLOQUEADAS ({unlockedPlants.length}/{ALL_PLANTS.length})
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
              const rolls = plantStatRolls[plantId] || []
              const groupedBuffs = groupRolls(rolls)
              const canFuse = isUnlocked && copies >= 5 && currentLvl < maxLvl
              const progressPct = Math.min(100, (copies / 5) * 100)

              return (
                <div
                  key={plantId}
                  className={`jardin-card ${
                    !isUnlocked
                      ? 'jardin-card--locked'
                      : inDeck
                      ? 'jardin-card--indeck'
                      : 'jardin-card--unlocked'
                  }`}
                  onClick={() => handleTogglePlant(plantId)}
                >
                  <div className="jardin-card__header">
                    <div className="jardin-card__cost">
                      <img src={sunIcon} alt="Sol" className="jardin-card__sun" />
                      <span>{config.cost}</span>
                    </div>

                    {isUnlocked && currentLvl > 0 ? (
                      <div
                        className={`jardin-card__lvl-tag ${currentLvl === maxLvl ? 'jardin-card__lvl-tag--max' : ''}`}
                        title={`Nivel ${currentLvl} / ${maxLvl}`}
                      >
                        ⭐ LVL {currentLvl}
                      </div>
                    ) : (
                      <span className={`jardin-card__status-chip ${inDeck ? 'jardin-card__status-chip--indeck' : isUnlocked ? 'jardin-card__status-chip--unlocked' : 'jardin-card__status-chip--locked'}`}>
                        {inDeck ? '✓ MAZO' : isUnlocked ? 'LISTA' : '🔒'}
                      </span>
                    )}
                  </div>

                  <div className="jardin-card__img-box">
                    <img
                      src={config.icon}
                      alt={config.name}
                      className={`jardin-card__img ${!isUnlocked ? 'jardin-card__img--locked' : ''}`}
                    />
                  </div>

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

                  <div className="jardin-card-rolls-wrap">
                    {groupedBuffs.length > 0 ? (
                      groupedBuffs.map((b, idx) => (
                        <span
                          key={idx}
                          className="jardin-stat-roll-badge"
                          style={{ color: b.color, borderColor: b.color }}
                          title={`${b.meta.label}: +${b.totalPct}%`}
                        >
                          {b.label}
                        </span>
                      ))
                    ) : (
                      <span className="jardin-stat-roll-placeholder">Stats Base</span>
                    )}
                  </div>

                  {isUnlocked && (
                    <div className="jardin-card-progress-box">
                      <div className="jardin-card-progress-bar">
                        <div
                          className={`jardin-card-progress-fill ${canFuse ? 'jardin-card-progress-fill--ready' : ''}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="jardin-card-progress-txt">
                        {copies}/5 Copias {currentLvl >= maxLvl ? '(MÁX)' : ''}
                      </span>
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
                          const res = onFusePlant(plantId)
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
                      🔥 FUSIONAR ➔ LVL {currentLvl + 1}
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
    </div>
  )
}
