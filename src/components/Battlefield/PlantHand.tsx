import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
const sunIcon = '/game-assets/greenfoot/sun1.png'
const shovelIcon = '/game-assets/images/Interface/shovelIcon.png'
import './PlantHand.css'

interface PlantHandProps {
  sunBank: number
  selectedCard: PlantId | 'shovel' | null
  onSelectCard: (id: PlantId | 'shovel' | null) => void
  cooldowns: Record<PlantId, number>
  activeDeck?: PlantId[]
}

const CARDS: PlantId[] = Object.keys(PLANT_CONFIGS) as PlantId[]

export default function PlantHand({
  sunBank,
  selectedCard,
  onSelectCard,
  cooldowns,
  activeDeck,
}: PlantHandProps) {
  const now = Date.now()
  const cardsToRender = activeDeck && activeDeck.length > 0 ? activeDeck : CARDS

  return (
    <div className="plant-hand-container">
      {/* Sun Counter Widget */}
      <div className="sun-counter">
        <img className="sun-counter__icon" src={sunIcon} alt="Sol" />
        <span className="sun-counter__value">{sunBank}</span>
      </div>

      {/* Plant Cards */}
      <div className="plant-hand">
        {cardsToRender.map((cardId) => {
          const config = PLANT_CONFIGS[cardId]
          const isSelected = selectedCard === cardId
          const cdTime = cooldowns[cardId] || 0
          const isOnCooldown = cdTime > now
          const cdRemaining = Math.max(0, cdTime - now)
          const cdRatio = isOnCooldown ? cdRemaining / config.cooldownMs : 0
          const canAfford = sunBank >= config.cost
          const isDisabled = !canAfford || isOnCooldown

          const packetSrc = isDisabled ? config.packetDisabled : config.packetActive

          return (
            <button
              key={cardId}
              type="button"
              className={`plant-hand__card ${
                isSelected ? 'plant-hand__card--selected' : ''
              } ${isDisabled ? 'plant-hand__card--disabled' : ''}`}
              onClick={() => {
                if (isSelected) onSelectCard(null)
                else if (!isDisabled) onSelectCard(cardId)
              }}
              title={`${config.name} (${config.cost} soles)\n${config.description}`}
            >
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
            </button>
          )
        })}

        {/* Shovel Tool */}
        <button
          type="button"
          className={`plant-hand__card plant-hand__shovel ${
            selectedCard === 'shovel' ? 'plant-hand__card--selected' : ''
          }`}
          onClick={() =>
            onSelectCard(selectedCard === 'shovel' ? null : 'shovel')
          }
          title="Pala: Quita una planta del terreno"
        >
          <img className="plant-hand__shovel-icon" src={shovelIcon} alt="Pala" />
          <span className="plant-hand__shovel-name">Pala</span>
        </button>
      </div>
    </div>
  )
}
