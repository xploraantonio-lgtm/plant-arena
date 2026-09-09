import { useState, useEffect, useRef, useCallback } from 'react'
import type { PlantId } from '../../types/game'
import { msToTicks } from '../../engine/time'
import {
  PLANT_CONFIGS,
  STAT_LABELS,
  getEligibleStatsForPlant,
  getScaledPlantConfig,
  type PlantStatKey,
} from '../../utils/gameConstants'
const sunIcon = '/game-assets/greenfoot/sun1.webp'
const shovelIcon = '/game-assets/images/Interface/shovelIcon.webp'
import './PlantHand.css'

function getSlotCardLevelData(slotIndex: number, plantId: PlantId) {
  let level = 0
  let rolls: PlantStatKey[] = []
  try {
    const savedDeckInstIds = localStorage.getItem('plant_arena_active_deck_instances')
    const savedInstances = localStorage.getItem('plant_arena_plant_instances')
    const savedLvls = localStorage.getItem('plant_arena_plant_levels')
    const savedRolls = localStorage.getItem('plant_arena_plant_stat_rolls')

    const parsedDeckInstIds: string[] = savedDeckInstIds ? JSON.parse(savedDeckInstIds) : []
    const parsedInstances: any[] = savedInstances ? JSON.parse(savedInstances) : []
    const parsedLvls: Record<string, number> = savedLvls ? JSON.parse(savedLvls) : {}
    const parsedRolls: Record<string, PlantStatKey[]> = savedRolls ? JSON.parse(savedRolls) : {}

    if (slotIndex >= 0 && parsedDeckInstIds[slotIndex]) {
      const targetInstId = parsedDeckInstIds[slotIndex]
      const found = parsedInstances.find((i) => i.instanceId === targetInstId)
      if (found) {
        level = found.level || 0
        rolls = found.statRolls && found.statRolls.length > 0 ? found.statRolls : []
      }
    }

    if (level === 0) {
      level = parsedLvls[plantId] || 0
    }

    if (rolls.length === 0 && parsedRolls[plantId] && parsedRolls[plantId].length > 0) {
      rolls = parsedRolls[plantId]
    }

    // Fallback synthesis if level > 0 so bonuses always render
    if (level > 0 && rolls.length === 0) {
      const eligible = getEligibleStatsForPlant(plantId)
      const mockRolls: PlantStatKey[] = []
      for (let i = 0; i < level; i++) {
        mockRolls.push(eligible[i % eligible.length])
      }
      rolls = mockRolls
    }
  } catch {}

  const map = new Map<PlantStatKey, number>()
  rolls.forEach((r) => map.set(r, (map.get(r) || 0) + 1))
  const grouped = Array.from(map.entries()).map(([stat, count]) => {
    const meta = STAT_LABELS[stat]
    const totalPct = count * 15
    const label =
      count > 1
        ? `${meta.icon} +${totalPct}% ${meta.suffix.replace('+15% ', '').replace('-15% ', '')} (x${count})`
        : `${meta.icon} ${meta.suffix}`
    return { stat, count, label, color: meta.color }
  })

  return { level, rolls, grouped }
}

interface PlantHandProps {
  sunBank: number
  selectedCard: PlantId | 'shovel' | null
  selectedSlotIndex?: number | null
  onSelectCard: (id: PlantId | 'shovel' | null, slotIndex?: number | null) => void
  cooldowns: Record<PlantId, number>
  /**
   * El tic actual de la partida.
   *
   * Los enfriamientos guardan el TIC en que expiran, no un instante de reloj.
   * Antes esto se comparaba con Date.now(), que siempre es mayor que cualquier
   * tic, así que isOnCooldown salía siempre falso y el velo de enfriamiento no
   * se pintaba nunca: el jugador pulsaba la carta y no pasaba nada, sin ninguna
   * señal de por qué.
   */
  currentTick?: number
  slotCooldowns?: Record<number, number>
  activeDeck?: PlantId[]
}

const CARDS: PlantId[] = Object.keys(PLANT_CONFIGS) as PlantId[]
const VISIBLE_COUNT = 6

export default function PlantHand({
  sunBank,
  selectedCard,
  selectedSlotIndex,
  onSelectCard,
  cooldowns,
  currentTick,
  slotCooldowns,
  activeDeck,
}: PlantHandProps) {
  // El reloj de la partida son los tics, no Date.now(). Ver currentTick arriba.
  const now = currentTick ?? 0
  const isDeckActive = activeDeck && activeDeck.length > 0
  const cardsToRender = isDeckActive ? activeDeck : CARDS

  const [startIndex, setStartIndex] = useState(0)

  const maxIndex = Math.max(0, cardsToRender.length - VISIBLE_COUNT)
  const safeStartIndex = Math.min(startIndex, maxIndex)

  // Auto-scroll carousel if selected card is out of current view
  useEffect(() => {
    if (selectedCard && selectedCard !== 'shovel') {
      const idx =
        selectedSlotIndex !== null && selectedSlotIndex !== undefined
          ? selectedSlotIndex
          : cardsToRender.indexOf(selectedCard)
      if (idx !== -1) {
        if (idx < safeStartIndex) {
          setStartIndex(idx)
        } else if (idx >= safeStartIndex + VISIBLE_COUNT) {
          setStartIndex(Math.max(0, idx - VISIBLE_COUNT + 1))
        }
      }
    }
  }, [selectedCard, selectedSlotIndex, cardsToRender, safeStartIndex])

  const handlePrev = () => {
    setStartIndex((prev) => Math.max(0, prev - 1))
  }

  const handleNext = () => {
    setStartIndex((prev) => Math.min(maxIndex, prev + 1))
  }

  const visibleCards = cardsToRender.slice(safeStartIndex, safeStartIndex + VISIBLE_COUNT)
  const lastPointerSelectRef = useRef<number>(0)
  const [deniedSlot, setDeniedSlot] = useState<number | null>(null)

  const triggerSelect = useCallback(
    (cardId: PlantId | 'shovel' | null, slotIndex: number | null = null, isDis = false) => {
      if (isDis) {
        // Feedback háptico de rechazo (vibración doble corta)
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate([25, 35, 25])
          } catch {}
        }
        if (slotIndex !== null) {
          setDeniedSlot(slotIndex)
          setTimeout(() => {
            setDeniedSlot((prev) => (prev === slotIndex ? null : prev))
          }, 260)
        }
        return
      }

      // Feedback háptico ligero (confirmación de selección instantánea)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(12)
        } catch {}
      }

      if (cardId === 'shovel') {
        onSelectCard(selectedCard === 'shovel' ? null : 'shovel')
      } else if (cardId) {
        const isCurrentlySelected =
          selectedCard === cardId &&
          (selectedSlotIndex === undefined ||
            selectedSlotIndex === null ||
            selectedSlotIndex === slotIndex)
        onSelectCard(isCurrentlySelected ? null : cardId, isCurrentlySelected ? null : slotIndex)
      } else {
        onSelectCard(null, null)
      }
    },
    [selectedCard, selectedSlotIndex, onSelectCard]
  )

  // Atajos de teclado en PC (Teclas 1 a 6 para cartas visibles, Q o S para pala, Esc para cancelar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return

      if (e.key >= '1' && e.key <= '6') {
        const num = parseInt(e.key, 10) - 1
        if (num < visibleCards.length) {
          const targetCard = visibleCards[num]
          const realSlotIndex = safeStartIndex + num
          const config = PLANT_CONFIGS[targetCard]
          if (config) {
            const slotCd =
              slotCooldowns && slotCooldowns[realSlotIndex] !== undefined
                ? slotCooldowns[realSlotIndex]
                : 0
            const cdTime = isDeckActive ? slotCd : (cooldowns[targetCard] || 0)
            const isOnCooldown = cdTime > now
            const canAfford = sunBank >= config.cost
            const isDis = !canAfford || isOnCooldown
            triggerSelect(targetCard, realSlotIndex, isDis)
          }
        }
      } else if (e.key === 'q' || e.key === 'Q' || e.key === 's' || e.key === 'S') {
        triggerSelect('shovel')
      } else if (e.key === 'Escape') {
        onSelectCard(null, null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    visibleCards,
    safeStartIndex,
    isDeckActive,
    slotCooldowns,
    cooldowns,
    now,
    sunBank,
    triggerSelect,
    onSelectCard,
  ])

  return (
    <div className="plant-hand-container">
      {/* Sun Counter Widget */}
      <div className="sun-counter">
        <img className="sun-counter__icon" src={sunIcon} alt="Sol" />
        <span className="sun-counter__value">{sunBank}</span>
      </div>

      {/* Carousel Container */}
      <div className="plant-hand-carousel">
        {/* Left Arrow */}
        {cardsToRender.length > VISIBLE_COUNT && (
          <button
            type="button"
            className="plant-hand__arrow plant-hand__arrow--left"
            onClick={handlePrev}
            disabled={safeStartIndex === 0}
            title="Ver plantas anteriores"
          >
            ◀
          </button>
        )}

        {/* Visible Plant Cards */}
        <div className="plant-hand">
          {visibleCards.map((cardId, vIdx) => {
            const realSlotIndex = safeStartIndex + vIdx
            const config = PLANT_CONFIGS[cardId]
            if (!config) return null

            const cardData = getSlotCardLevelData(realSlotIndex, cardId)
            const scaledConfig = getScaledPlantConfig(cardId, cardData.rolls)
            const isSelected =
              selectedCard === cardId &&
              (selectedSlotIndex === undefined ||
                selectedSlotIndex === null ||
                selectedSlotIndex === realSlotIndex)

            // Independent slot cooldown: If deck is active, each slot only obeys its own slotCooldowns!
            const slotCd =
              slotCooldowns && slotCooldowns[realSlotIndex] !== undefined
                ? slotCooldowns[realSlotIndex]
                : 0
            const cdTime = isDeckActive ? slotCd : (cooldowns[cardId] || 0)
            const isOnCooldown = cdTime > now
            const cdRemaining = Math.max(0, cdTime - now)
            // Ambos lados en tics: el que queda y el total del enfriamiento.
            const cdTotalTicks = msToTicks(scaledConfig.cooldownMs)
            const cdRatio = isOnCooldown && cdTotalTicks > 0 ? cdRemaining / cdTotalTicks : 0
            const canAfford = sunBank >= config.cost
            const isDisabled = !canAfford || isOnCooldown

            const packetSrc = isDisabled ? config.packetDisabled : config.packetActive

            return (
              <button
                key={`card-${cardId}-${realSlotIndex}`}
                type="button"
                className={`plant-hand__card ${
                  isSelected ? 'plant-hand__card--selected' : ''
                } ${isDisabled ? 'plant-hand__card--disabled' : ''} ${
                  deniedSlot === realSlotIndex ? 'plant-hand__card--denied' : ''
                }`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  lastPointerSelectRef.current = Date.now()
                  triggerSelect(cardId, realSlotIndex, isDisabled)
                }}
                onClick={(e) => {
                  if (Date.now() - lastPointerSelectRef.current < 400) {
                    e.preventDefault()
                    return
                  }
                  triggerSelect(cardId, realSlotIndex, isDisabled)
                }}
              >
                {/* Level Badge in top-right corner of seed packet */}
                {cardData.level > 0 && (
                  <div
                    className={`plant-hand__card-lvl ${cardData.level >= 3 ? 'plant-hand__card-lvl--gold' : ''}`}
                    title={`Nivel ${cardData.level}`}
                  >
                    ⭐{cardData.level}
                  </div>
                )}

                {/* PC Keyboard Hotkey Badge */}
                <span className="plant-hand__hotkey-badge">{vIdx + 1}</span>

                {/* Card Seed Packet */}
                <div className="plant-hand__packet-wrap">
                  <img
                    className="plant-hand__packet-img"
                    src={packetSrc}
                    alt={config.name}
                  />
                </div>

                {/* Cooldown Progress Overlay */}
                {isOnCooldown && (
                  <div
                    className="plant-hand__cooldown-overlay"
                    style={{ height: `${cdRatio * 100}%` }}
                  />
                )}

                {/* Hover Buffs Tooltip */}
                {cardData.level > 0 && (
                  <div className="plant-hand__tooltip">
                    <div className="plant-hand__tooltip-head">
                      <span>{config.name}</span>
                      <span className="plant-hand__tooltip-lvl">⭐ LVL {cardData.level}</span>
                    </div>
                    <div className="plant-hand__tooltip-buffs">
                      {cardData.grouped.map((g, idx) => (
                        <span key={idx} style={{ color: g.color }}>
                          {g.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Right Arrow */}
        {cardsToRender.length > VISIBLE_COUNT && (
          <button
            type="button"
            className="plant-hand__arrow plant-hand__arrow--right"
            onClick={handleNext}
            disabled={startIndex >= maxIndex}
            title="Ver más plantas"
          >
            ▶
          </button>
        )}
      </div>

      {/* Fixed Shovel Tool Widget */}
      <button
        type="button"
        className={`plant-hand__card plant-hand__shovel ${
          selectedCard === 'shovel' ? 'plant-hand__card--selected' : ''
        }`}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          lastPointerSelectRef.current = Date.now()
          triggerSelect('shovel')
        }}
        onClick={(e) => {
          if (Date.now() - lastPointerSelectRef.current < 400) {
            e.preventDefault()
            return
          }
          triggerSelect('shovel')
        }}
        title="Pala (Tecla Q): Haz clic aquí o presiona Q y luego en cualquier planta del campo para quitarla"
      >
        <span className="plant-hand__hotkey-badge">Q</span>
        <img className="plant-hand__shovel-icon" src={shovelIcon} alt="Pala" />
        <span className="plant-hand__shovel-name">PALA</span>
      </button>
    </div>
  )
}
