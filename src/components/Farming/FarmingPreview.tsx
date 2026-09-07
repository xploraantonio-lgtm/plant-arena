import { useMemo, useState } from 'react'
import {
  FARMING_ITEM_DEFINITIONS,
  type FarmingInventory,
  type FarmingItemId,
} from '../../utils/pvpRewardManager'

interface FarmingPreviewProps {
  onClose: () => void
}

type RarityKey = 'common' | 'rare' | 'epic' | 'legendary'
type CenterMode = 'entry' | 'rent' | 'buy'

const DEMO_INVENTORY: FarmingInventory = {
  water: 12,
  fertilizer: 4,
  pesticide: 2,
  shovel_fragment: 6,
  scarecrow_fragment: 30,
  shovel: 0,
  scarecrow: 1,
}

const INVENTORY_ORDER: FarmingItemId[] = [
  'water',
  'fertilizer',
  'pesticide',
  'shovel_fragment',
  'scarecrow_fragment',
]

const RARITIES: Record<
  RarityKey,
  { label: string; slots: number; count: number; rent: number; buy: number; visual: string }
> = {
  common: { label: 'COMÚN', slots: 8, count: 10, rent: 0.5, buy: 100, visual: '🌾' },
  rare: { label: 'RARA', slots: 12, count: 6, rent: 0.8, buy: 180, visual: '⛰️' },
  epic: { label: 'ÉPICA', slots: 16, count: 3, rent: 1.2, buy: 350, visual: '🌳' },
  legendary: { label: 'LEGENDARIA', slots: 20, count: 1, rent: 2, buy: 700, visual: '✨' },
}

const DEMO_PLAYER_OWNERS: Partial<Record<RarityKey, Record<number, string>>> = {
  common: { 3: 'Mila', 8: 'Rocco' },
  rare: { 2: 'Xplora' },
  epic: { 2: 'Luna' },
}

export default function FarmingPreview({ onClose }: FarmingPreviewProps) {
  const [mode, setMode] = useState<CenterMode>('entry')
  const [rarity, setRarity] = useState<RarityKey>('common')
  const [selectedLand, setSelectedLand] = useState<number | null>(null)
  const [demoGems] = useState(2500)

  const rarityData = RARITIES[rarity]
  const lands = useMemo(
    () => Array.from({ length: rarityData.count }, (_, index) => index + 1),
    [rarityData.count]
  )

  const openExplore = (nextMode: Exclude<CenterMode, 'entry'>) => {
    setMode(nextMode)
    setSelectedLand(null)
  }

  return (
    <div className="farming-preview-screen" role="dialog" aria-modal="true" aria-label="Vista previa de Farming">
      <header className="farming-preview-topbar">
        <button type="button" className="farming-preview-topbtn" onClick={onClose}>← INICIO</button>
        <div className="farming-preview-brand">PLANT <span>ARENA</span> · FARMING</div>
        <div className="farming-preview-topright">
          <div className="farming-preview-wallet">💎 <strong>{demoGems}</strong></div>
          <button type="button" className="farming-preview-topbtn">MIS LANDS (0)</button>
          <button type="button" className="farming-preview-topbtn">MIS ALQUILERES (0)</button>
        </div>
      </header>

      <div className="farming-preview-layout">
        <aside className="farming-preview-panel farming-preview-inventory">
          <div className="farming-preview-panel-title">🎒 INVENTARIO DE CULTIVO</div>
          <div className="farming-preview-items">
            {INVENTORY_ORDER.map((id) => {
              const item = FARMING_ITEM_DEFINITIONS[id]
              return (
                <div className="farming-preview-item" key={id}>
                  <img src={item.icon} alt={item.label} />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </div>
                  <b>{DEMO_INVENTORY[id]}</b>
                </div>
              )
            })}
          </div>
        </aside>

        <main className="farming-preview-center">
          {mode === 'entry' ? (
            <section className="farming-preview-empty-state">
              <div className="farming-preview-seedmark">🌱</div>
              <h1>Tu granja aún está vacía</h1>
              <p>
                Empieza alquilando un slot o compra una Land. Esta vista usa los assets reales de farming del juego.
              </p>
              <div className="farming-preview-entry-actions">
                <button type="button" className="farming-preview-choice farming-preview-choice--rent" onClick={() => openExplore('rent')}>
                  <span>🤝</span>
                  <div><strong>Alquilar un slot</strong><small>Elige rareza → Land → slot.</small></div>
                  <b>BUSCAR SLOT</b>
                </button>
                <button type="button" className="farming-preview-choice farming-preview-choice--buy" onClick={() => openExplore('buy')}>
                  <span>🏝️</span>
                  <div><strong>Comprar una Land</strong><small>Compra una Genesis administrada por Plant Arena.</small></div>
                  <b>VER LANDS</b>
                </button>
              </div>
            </section>
          ) : (
            <section className="farming-preview-explore">
              <div className="farming-preview-explore-head">
                <div>
                  <h1>{mode === 'rent' ? 'Explorar Lands para alquilar' : 'Genesis Lands en venta'}</h1>
                  <p>Las 20 Lands están separadas por rareza para dar más presencia a cada mundo.</p>
                </div>
                <button type="button" className="farming-preview-back" onClick={() => setMode('entry')}>← VOLVER</button>
              </div>

              <div className="farming-preview-rarity-tabs">
                {(Object.keys(RARITIES) as RarityKey[]).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={`farming-preview-rarity-tab farming-preview-rarity-tab--${key} ${rarity === key ? 'is-active' : ''}`}
                    onClick={() => { setRarity(key); setSelectedLand(null) }}
                  >
                    {RARITIES[key].label}
                  </button>
                ))}
              </div>

              <div className="farming-preview-land-grid">
                {lands.map((landNumber) => {
                  const owner = DEMO_PLAYER_OWNERS[rarity]?.[landNumber]
                  const isSelected = selectedLand === landNumber
                  return (
                    <button
                      type="button"
                      key={landNumber}
                      className={`farming-preview-land-card farming-preview-land-card--${rarity} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedLand(landNumber)}
                    >
                      <div className="farming-preview-land-visual">{rarityData.visual}</div>
                      <div className="farming-preview-land-copy">
                        <strong>GENESIS {rarityData.label} #{String(landNumber).padStart(2, '0')}</strong>
                        <span>{rarityData.slots} slots</span>
                        <small>{owner ? `Propietario: ${owner}` : 'Administrada por Plant Arena'}</small>
                        <em>
                          {mode === 'rent'
                            ? `desde ${rarityData.rent} 💎 / día`
                            : owner
                              ? 'No disponible para compra'
                              : `${rarityData.buy} 💎`}
                        </em>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </main>

        <aside className="farming-preview-panel farming-preview-actions">
          <div className="farming-preview-panel-title">📋 INFORMACIÓN / ACCIONES</div>
          <div className="farming-preview-action-body">
            {selectedLand ? (
              <>
                <div className="farming-preview-selected-icon">{rarityData.visual}</div>
                <h2>GENESIS {rarityData.label} #{String(selectedLand).padStart(2, '0')}</h2>
                <dl>
                  <div><dt>Slots</dt><dd>{rarityData.slots}</dd></div>
                  <div><dt>Gestión</dt><dd>{DEMO_PLAYER_OWNERS[rarity]?.[selectedLand] ?? 'Plant Arena'}</dd></div>
                  <div><dt>Alquiler base</dt><dd>{rarityData.rent} 💎 / día</dd></div>
                </dl>
                <button type="button" className="farming-preview-primary-action">
                  {mode === 'rent' ? 'ENTRAR A LA LAND' : 'VER DETALLE DE COMPRA'}
                </button>
              </>
            ) : (
              <div className="farming-preview-no-selection">
                <div>＋</div>
                <h2>Selecciona una Land</h2>
                <p>Aquí aparecerán el mundo, el slot seleccionado y las acciones disponibles.</p>
                <button type="button" onClick={() => openExplore('rent')}>🤝 BUSCAR SLOT</button>
                <button type="button" onClick={() => openExplore('buy')}>🏝️ COMPRAR LAND</button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="farming-preview-bottom">
        {(Object.keys(RARITIES) as RarityKey[]).map((key) => (
          <button type="button" key={key} onClick={() => { setMode('rent'); setRarity(key); setSelectedLand(null) }}>
            <span>{RARITIES[key].visual}</span>
            <div><strong>{RARITIES[key].label}</strong><small>{RARITIES[key].slots} slots por Land</small></div>
          </button>
        ))}
      </footer>
    </div>
  )
}
