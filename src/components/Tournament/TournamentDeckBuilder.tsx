import { useState } from 'react'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { soundManager } from '../../utils/audioManager'
import './TournamentDeckBuilder.css'

interface TournamentDeckBuilderProps {
  isOpen: boolean
  currentDeck: PlantId[]
  onSaveDeck: (newDeck: PlantId[]) => Promise<void> | void
  onClose: () => void
}

const ALL_PLANT_IDS = Object.keys(PLANT_CONFIGS) as PlantId[]

export default function TournamentDeckBuilder({
  isOpen,
  currentDeck,
  onSaveDeck,
  onClose,
}: TournamentDeckBuilderProps) {
  const [selectedDeck, setSelectedDeck] = useState<PlantId[]>(() => {
    if (currentDeck && currentDeck.length >= 5) {
      return currentDeck.slice(0, 5)
    }
    return ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater']
  })
  const [isSaving, setIsSaving] = useState(false)

  if (!isOpen) return null

  const handleAddCard = (plantId: PlantId) => {
    soundManager.playSound('click', 0.4)
    if (selectedDeck.includes(plantId)) {
      // Si ya está en el mazo, la quitamos
      setSelectedDeck((prev) => prev.filter((id) => id !== plantId))
      return
    }

    if (selectedDeck.length >= 5) {
      // Mazo lleno: reemplaza la última o avisa
      setSelectedDeck((prev) => [...prev.slice(0, 4), plantId])
    } else {
      setSelectedDeck((prev) => [...prev, plantId])
    }
  }

  const handleRemoveSlot = (index: number) => {
    soundManager.playSound('click', 0.3)
    setSelectedDeck((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (selectedDeck.length !== 5) {
      alert('Debes seleccionar exactamente 5 plantas para tu mazo de torneo.')
      return
    }
    soundManager.playSound('plantation', 0.8)
    setIsSaving(true)
    try {
      await onSaveDeck(selectedDeck)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="tourney-deck-builder-overlay" onClick={onClose}>
      <div
        className="tourney-deck-builder-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tourney-deck-header">
          <div className="tourney-deck-title-area">
            <h2>Mazo de Torneo</h2>
            <span className="tourney-deck-badge">15 Cartas Libres</span>
          </div>
          <button
            type="button"
            className="tourney-deck-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="tourney-deck-body">
          <div className="tourney-deck-notice">
            <span className="tourney-deck-notice-icon">🌱</span>
            <div>
              <strong>¡Todas las cartas desbloqueadas para el torneo!</strong>
              <div style={{ marginTop: 2, opacity: 0.9 }}>
                En el torneo compites en igualdad de condiciones. Puedes probar cualquier planta sin necesidad de tenerla en tu inventario real.
              </div>
            </div>
          </div>

          <div className="tourney-deck-slots-section">
            <div className="tourney-deck-slots-header">
              <span>Tu Mazo Activo de Torneo ({selectedDeck.length} / 5)</span>
              {selectedDeck.length === 5 ? (
                <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Mazo Completo</span>
              ) : (
                <span style={{ color: '#f59e0b', fontSize: 13 }}>Elige 5 plantas</span>
              )}
            </div>

            <div className="tourney-deck-slots-grid">
              {[0, 1, 2, 3, 4].map((slotIdx) => {
                const plantId = selectedDeck[slotIdx]
                const config = plantId ? PLANT_CONFIGS[plantId] : null

                if (config) {
                  return (
                    <div
                      key={`slot_${slotIdx}`}
                      className="tourney-deck-slot filled"
                      onClick={() => handleRemoveSlot(slotIdx)}
                      title={`Quitar ${config.name}`}
                    >
                      <div className="tourney-slot-cost">☀️ {config.cost}</div>
                      <button
                        type="button"
                        className="tourney-slot-remove"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveSlot(slotIdx)
                        }}
                      >
                        ✕
                      </button>
                      <img
                        src={config.icon}
                        alt={config.name}
                        className="tourney-slot-img"
                      />
                      <span className="tourney-slot-name">{config.name}</span>
                    </div>
                  )
                }

                return (
                  <div
                    key={`slot_empty_${slotIdx}`}
                    className="tourney-deck-slot"
                    title="Espacio vacío. Selecciona una planta abajo."
                  >
                    <span className="tourney-slot-empty-label">
                      + Ranura {slotIdx + 1}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="tourney-catalog-section">
            <div className="tourney-catalog-header">
              <span>Catálogo Disponible (15 Plantas)</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                Haz clic en una planta para añadirla o quitarla
              </span>
            </div>

            <div className="tourney-catalog-grid">
              {ALL_PLANT_IDS.map((id) => {
                const plant = PLANT_CONFIGS[id]
                const isSelected = selectedDeck.includes(id)

                return (
                  <div
                    key={id}
                    className={`tourney-catalog-card ${isSelected ? 'in-deck' : ''}`}
                    onClick={() => handleAddCard(id)}
                    title={plant.description}
                  >
                    <span className="tourney-catalog-cost">☀️ {plant.cost}</span>
                    <img
                      src={plant.icon}
                      alt={plant.name}
                      className="tourney-catalog-card-img"
                    />
                    <span className="tourney-catalog-card-name">{plant.name}</span>
                    <span className="tourney-catalog-card-category">{plant.category}</span>
                    {isSelected && (
                      <span className="tourney-catalog-card-status">✓ En Mazo</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="tourney-deck-footer">
          <button
            type="button"
            className="tourney-btn-secondary"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="tourney-btn-primary"
            disabled={selectedDeck.length !== 5 || isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Guardando…' : '✓ Guardar Mazo de Torneo'}
          </button>
        </div>
      </div>
    </div>
  )
}
