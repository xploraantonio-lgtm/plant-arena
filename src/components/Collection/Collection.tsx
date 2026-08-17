import { useState, useEffect } from 'react'
import background from '../../assets/images/background.png'
const sunIcon = '/game-assets/greenfoot/sun1.png'
import { soundManager } from '../../utils/audioManager'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import type { PlantId } from '../../types/game'
import './Collection.css'

export interface CollectionPlant {
  id: string
  name: string
  category: 'producer' | 'ranged' | 'defensive' | 'special' | 'melee'
  categoryLabel: string
  cost: number
  cooldownSec: number
  hp: number | string
  damage: number | string
  sprite: string
  cardImage: string
  description: string
  lore: string
}

export const PLANT_RARITIES: Record<string, { label: string; short: string; color: string; bg: string }> = {
  // Comunes (4) -> C
  sunflower: { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' },
  peashooter: { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' },
  wallnut: { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' },
  chomper: { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' },

  // Poco Comunes (5) -> PC
  garlic: { label: 'POCO COMÚN', short: 'PC', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.2)' },
  bonkchoy: { label: 'POCO COMÚN', short: 'PC', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.2)' },
  repeater: { label: 'POCO COMÚN', short: 'PC', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.2)' },
  melonpult: { label: 'POCO COMÚN', short: 'PC', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.2)' },
  squash: { label: 'POCO COMÚN', short: 'PC', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.2)' },

  // Raras (2) -> R
  twinsunflower: { label: 'RARA', short: 'R', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.2)' },
  jalapeno: { label: 'RARA', short: 'R', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.2)' },

  // Épicas (2) -> E
  aloe: { label: 'ÉPICA', short: 'E', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.2)' },
  tallnut: { label: 'ÉPICA', short: 'E', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.2)' },

  // Legendarias (2) -> L
  iceberglettuce: { label: 'LEGENDARIA', short: 'L', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.2)' },
  threepeater: { label: 'LEGENDARIA', short: 'L', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.2)' },
}

const LORE_MAP: Record<string, string> = {
  sunflower: 'Sunflower es vital para mantener una sólida economía de soles. Le encanta sonreír y bailar con la brisa.',
  peashooter: '¿Qué se siente ser la primera línea de defensa? Peashooter lo sabe bien. Eficiente, directa y confiable.',
  repeater: 'Repeater es feroz. Dispara dos guisantes a la vez porque no le gusta dejar trabajo a medias.',
  wallnut: 'Wall-nut tiene una cáscara dura como el acero. Protege la retaguardia mientras tus atacantes hacen su trabajo.',
  melonpult: 'Melon-pult no duda en lanzar sandías pesadas por los aires. Aplasta e inflige daño a múltiples enemigos.',
  chomper: 'Cactus avanza continuamente hacia las líneas enemigas disparando espinas.',
  bonkchoy: 'Bonk Choy entrena a diario. Sus puños veloces no dejan títere con cabeza a corta distancia.',
  garlic: 'Squash está siempre listo. En cuanto ve un enemigo cerca: ¡BAM! Lo aplasta por completo.',
  squash: 'Potato Mine necesita tiempo para armarse bajo tierra. Una vez lista, explota al menor contacto con el enemigo.',
  twinsunflower: 'Dos cabezas producen mejor que una. Twin Sunflower ilumina el terreno con energía solar multiplicada.',
  threepeater: 'Threepeater vigila tres líneas a la vez brindando cobertura de fuego múltiple.',
  tallnut: 'Tall-nut es un muro gigante inamovible. Su gran altura imposibilita el avance enemigo y resiste el doble de daño.',
  jalapeno: 'Jalapeño es de 1 solo uso. Desata una bola de fuego ardiente que quema la fila entera limpiando el carril.',
  iceberglettuce: 'Iceberg Lettuce cuesta 0 Soles y es de 1 solo uso. Al colocarse en el campo, congela a todos los enemigos durante 7 segundos.',
  aloe: 'Aloe Curandera escanea el carril y cura con ondas de luz mística a las plantas heridas aliadas.',
}

export const CATALOG: CollectionPlant[] = (Object.keys(PLANT_CONFIGS) as PlantId[]).map((id) => {
  const c = PLANT_CONFIGS[id]
  const catLabel =
    c.category === 'producer'
      ? 'Productora'
      : c.category === 'ranged'
      ? 'Ataque a Distancia'
      : c.category === 'defensive'
      ? 'Tanque Defensivo'
      : 'Mele / Cuerpo a Cuerpo'

  const isInstant = c.id === 'jalapeno' || c.id === 'iceberglettuce' || c.id === 'squash'

  return {
    id: c.id,
    name: c.name,
    category: c.category,
    categoryLabel: catLabel,
    cost: c.cost,
    cooldownSec: c.cooldownMs / 1000,
    hp: isInstant ? 'Un Solo Uso' : c.maxHp,
    damage: c.damage !== undefined ? c.damage : (c.category === 'producer' ? '0 (Produce Soles)' : 'Especial'),
    sprite: c.sprite,
    cardImage: c.packetActive || c.icon,
    description: c.description,
    lore: LORE_MAP[c.id] || `${c.name} es una valiosa planta aliada lista para defender el jardín.`,
  }
})

export default function Collection({
  onBack,
  onPracticePlant,
}: {
  onBack: () => void
  onPracticePlant?: (plantId: string) => void
}) {
  const [selectedPlant, setSelectedPlant] = useState<CollectionPlant>(CATALOG[0])
  const [activeTab, setActiveTab] = useState<'all' | 'producer' | 'ranged' | 'defensive' | 'special' | 'melee'>('all')
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())

  useEffect(() => {
    soundManager.playBgm('menu')
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  const filteredCatalog = CATALOG.filter((p) => {
    if (activeTab === 'all') return true
    return p.category === activeTab
  })

  const playPreviewSound = () => {
    soundManager.playSound('pea_shoot', 0.6)
    if (onPracticePlant) {
      onPracticePlant(selectedPlant.id)
    }
  }

  const selectedRarity = PLANT_RARITIES[selectedPlant.id] || { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' }

  return (
    <div className="collection-screen" style={{ backgroundImage: `url(${background})` }}>
      {/* Header Bar */}
      <div className="collection-header">
        <button className="collection-back-btn" type="button" onClick={onBack}>
          ⬅️ MENÚ
        </button>
        <div style={{ textAlign: 'center' }}>
          <h1 className="collection-title">📖 Colección de Plantas</h1>
        </div>
        <button
          className="collection-mute-btn"
          type="button"
          onClick={() => {
            soundManager.toggleMute()
            setIsMuted(soundManager.isMuted())
          }}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Category Tabs */}
      <div className="collection-tabs">
        <button
          type="button"
          className={`collection-tab ${activeTab === 'all' ? 'collection-tab--active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          🌟 TODAS ({CATALOG.length})
        </button>
        <button
          type="button"
          className={`collection-tab ${activeTab === 'producer' ? 'collection-tab--active' : ''}`}
          onClick={() => setActiveTab('producer')}
        >
          ☀️ PRODUCTORAS
        </button>
        <button
          type="button"
          className={`collection-tab ${activeTab === 'ranged' ? 'collection-tab--active' : ''}`}
          onClick={() => setActiveTab('ranged')}
        >
          🏹 ATACANTES
        </button>
        <button
          type="button"
          className={`collection-tab ${activeTab === 'defensive' ? 'collection-tab--active' : ''}`}
          onClick={() => setActiveTab('defensive')}
        >
          🛡️ TANQUES
        </button>
      </div>

      {/* Main Body Grid & Detail Inspector */}
      <div className="collection-body">
        {/* Grid Catalog */}
        <div className="collection-grid">
          {filteredCatalog.map((plant) => {
            const isSelected = selectedPlant.id === plant.id
            const rarity = PLANT_RARITIES[plant.id] || { label: 'COMÚN', short: 'C', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)' }

            return (
              <button
                key={plant.id}
                type="button"
                className={`collection-card ${isSelected ? 'collection-card--selected' : ''}`}
                onClick={() => {
                  setSelectedPlant(plant)
                  soundManager.playSound('plantation', 0.4)
                }}
              >
                <div className="collection-card__header-row">
                  <div className="collection-card__cost">
                    <img src={sunIcon} alt="Sol" className="collection-card__cost-icon" />
                    <span>{plant.cost}</span>
                  </div>

                  <span
                    className="collection-card__rarity-tag"
                    style={{
                      color: rarity.color,
                      borderColor: rarity.color,
                      backgroundColor: rarity.bg,
                    }}
                  >
                    {rarity.short}
                  </span>
                </div>

                <img src={plant.cardImage} alt={plant.name} className="collection-card__img" />
                <span className="collection-card__name">{plant.name}</span>
              </button>
            )
          })}
        </div>

        {/* Plant Detail Inspector Side Panel */}
        <div className="collection-inspector">
          <div className="collection-inspector__preview">
            <img
              src={selectedPlant.sprite}
              alt={selectedPlant.name}
              className="collection-inspector__sprite"
            />
          </div>

          <div className="collection-inspector__info">
            <div className="collection-inspector__title-row">
              <h2 className="collection-inspector__name">{selectedPlant.name}</h2>
              <span
                className="collection-inspector__rarity-badge"
                style={{
                  color: selectedRarity.color,
                  borderColor: selectedRarity.color,
                  backgroundColor: selectedRarity.bg,
                }}
              >
                {selectedRarity.label}
              </span>
            </div>

            <span className="collection-inspector__badge">{selectedPlant.categoryLabel}</span>

            {/* Stats Row */}
            <div className="collection-stats">
              <div className="collection-stat">
                <span className="collection-stat__label">COSTO DE SOL</span>
                <span className="collection-stat__val collection-stat__val--sun">
                  ☀️ {selectedPlant.cost}
                </span>
              </div>

              <div className="collection-stat">
                <span className="collection-stat__label">RECARGA</span>
                <span className="collection-stat__val">⏱️ {selectedPlant.cooldownSec}s</span>
              </div>

              <div className="collection-stat">
                <span className="collection-stat__label">SALUD (HP)</span>
                <span className="collection-stat__val collection-stat__val--hp">
                  ❤️ {selectedPlant.hp}
                </span>
              </div>

              <div className="collection-stat">
                <span className="collection-stat__label">DAÑO / EFECTO</span>
                <span className="collection-stat__val collection-stat__val--dmg">
                  ⚔️ {selectedPlant.damage}
                </span>
              </div>
            </div>

            {/* Description & Lore */}
            <div className="collection-inspector__text-box">
              <p className="collection-inspector__desc">{selectedPlant.description}</p>
              <blockquote className="collection-inspector__lore">
                "{selectedPlant.lore}"
              </blockquote>
            </div>

            {/* Sound & Practice Test Button */}
            <button
              type="button"
              className="collection-inspector__sound-btn"
              onClick={() => {
                playPreviewSound()
                if (onPracticePlant) {
                  onPracticePlant(selectedPlant.id)
                }
              }}
              title="Probar disparos y explosiones en el Campo de Batalla"
            >
              🎯 Probar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
