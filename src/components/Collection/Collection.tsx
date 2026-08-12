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
  hp: number
  damage: number | string
  sprite: string
  cardImage: string
  description: string
  lore: string
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

  return {
    id: c.id,
    name: c.name,
    category: c.category,
    categoryLabel: catLabel,
    cost: c.cost,
    cooldownSec: c.cooldownMs / 1000,
    hp: c.maxHp,
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

  return (
    <div className="collection-screen" style={{ backgroundImage: `url(${background})` }}>
      {/* Header Bar */}
      <div className="collection-header">
        <button className="collection-back-btn" type="button" onClick={onBack}>
          ⬅️ MENÚ
        </button>
        <h1 className="collection-title">ALMANAQUE DE PLANTAS</h1>
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
          TODAS ({CATALOG.length})
        </button>
        <button
          type="button"
          className={`collection-tab ${activeTab === 'melee' ? 'collection-tab--active' : ''}`}
          onClick={() => setActiveTab('melee')}
        >
          🥊 MELE / CUERPO A CUERPO
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
                <div className="collection-card__cost">
                  <img src={sunIcon} alt="Sol" className="collection-card__cost-icon" />
                  <span>{plant.cost}</span>
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
            <h2 className="collection-inspector__name">{selectedPlant.name}</h2>
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
              onClick={playPreviewSound}
              title="Probar disparos en el Campo de Batalla (Sandbox)"
            >
              🎯 PROBAR DISPARO EN CAMPO DE BATALLA
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
