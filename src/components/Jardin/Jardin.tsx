import { useState, useEffect } from 'react'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import './Jardin.css'

const sunIcon = '/game-assets/greenfoot/sun1.png'
const ALL_PLANTS = Object.keys(PLANT_CONFIGS) as PlantId[]

interface JardinProps {
  activeDeck: PlantId[]
  onUpdateDeck: (newDeck: PlantId[]) => void
  onBack: () => void
  onPlay: () => void
  onOpenCollection: () => void
}

export default function Jardin({
  activeDeck,
  onUpdateDeck,
  onBack,
  onPlay,
  onOpenCollection,
}: JardinProps) {
  const [deck, setDeck] = useState<PlantId[]>(activeDeck)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

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
          <h1 className="jardin-title">MI JARDÍN - CONFIGURADOR DE MAZO</h1>
          <span className="jardin-subtitle">
            Mazo dinámico: Elige de 3 a 6 plantas para llevar a la Arena
          </span>
        </div>
        <div className="jardin-header__right">
          <button
            className="jardin-btn-sec"
            type="button"
            onClick={onOpenCollection}
          >
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

      {/* Active Battle Deck (3 to 6 Slots) */}
      <div className="jardin-deck-container">
        <div className="jardin-deck-header">
          <span className="jardin-deck-title">
            ⚔️ MAZO DE BATALLA ({deck.length}/6 PLANTAS)
          </span>
          <span
            className={`jardin-deck-status ${
              isDeckValid ? 'jardin-deck-status--ready' : ''
            }`}
          >
            {isDeckValid
              ? `✅ MAZO LISTO PARA COMBATE (${deck.length}/6 PLANTAS)`
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
                  if (plantId) {
                    // Tap slot to select for swap
                    setSelectedSlotIndex(idx)
                  } else {
                    setSelectedSlotIndex(idx)
                  }
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

      {/* Inventory Catalog Grid */}
      <div className="jardin-inventory-container">
        <h2 className="jardin-inventory-title">
          🌱 INVENTARIO DE PLANTAS DESBLOQUEADAS ({ALL_PLANTS.length})
        </h2>
        <div className="jardin-inventory-grid">
          {ALL_PLANTS.map((plantId) => {
            const config = PLANT_CONFIGS[plantId]
            const inDeck = deck.includes(plantId)

            return (
              <button
                key={plantId}
                type="button"
                className={`jardin-card ${inDeck ? 'jardin-card--indeck' : ''}`}
                onClick={() => handleTogglePlant(plantId)}
              >
                <div className="jardin-card__header">
                  <div className="jardin-card__cost">
                    <img src={sunIcon} alt="Sol" className="jardin-card__sun" />
                    <span>{config.cost}</span>
                  </div>
                  {inDeck && <span className="jardin-card__badge">EN MAZO ✓</span>}
                </div>

                <img src={config.icon} alt={config.name} className="jardin-card__img" />
                <span className="jardin-card__name">{config.name}</span>
                <span className="jardin-card__cat">
                  {config.category === 'producer'
                    ? '☀️ Productora'
                    : config.category === 'ranged'
                    ? '🏹 Atacante'
                    : config.category === 'defensive'
                    ? '🛡️ Tanque'
                    : '🥊 Mele'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
