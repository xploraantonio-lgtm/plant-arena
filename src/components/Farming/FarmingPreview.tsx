import { useMemo, useState } from 'react'
import logo from '../../assets/images/logo.png'
import gema from '../../assets/ico/gema.png'
import moneda from '../../assets/ico/moneda.png'
import landCommon from '../../assets/images/farming/lands/common.webp'
import landRare from '../../assets/images/farming/lands/rare.webp'
import landEpic from '../../assets/images/farming/lands/epic.webp'
import landLegendary from '../../assets/images/farming/lands/legendary.webp'
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

type RarityConfig = {
  label: string
  slots: number
  count: number
  rent: number
  buy: number
  image: string
  perPage: number
  description: string
}

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

const RARITIES: Record<RarityKey, RarityConfig> = {
  common: {
    label: 'COMÚN',
    slots: 8,
    count: 10,
    rent: 0.5,
    buy: 100,
    image: landCommon,
    perPage: 4,
    description: 'Terreno seco y plano',
  },
  rare: {
    label: 'RARA',
    slots: 12,
    count: 6,
    rent: 0.8,
    buy: 180,
    image: landRare,
    perPage: 3,
    description: 'Relieve montañoso',
  },
  epic: {
    label: 'ÉPICA',
    slots: 16,
    count: 3,
    rent: 1.2,
    buy: 350,
    image: landEpic,
    perPage: 3,
    description: 'Fértil y arbolada',
  },
  legendary: {
    label: 'LEGENDARIA',
    slots: 20,
    count: 1,
    rent: 2,
    buy: 700,
    image: landLegendary,
    perPage: 1,
    description: 'Terreno mágico especial',
  },
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
  const [page, setPage] = useState(0)
  const [demoGems] = useState(2500)
  const [demoGold] = useState(3000)

  const rarityData = RARITIES[rarity]
  const pageCount = Math.ceil(rarityData.count / rarityData.perPage)
  const lands = useMemo(
    () => Array.from({ length: rarityData.count }, (_, index) => index + 1),
    [rarityData.count]
  )
  const visibleLands = lands.slice(page * rarityData.perPage, (page + 1) * rarityData.perPage)

  const openExplore = (nextMode: Exclude<CenterMode, 'entry'>) => {
    setMode(nextMode)
    setRarity('common')
    setPage(0)
    setSelectedLand(null)
  }

  const selectRarity = (nextRarity: RarityKey) => {
    setRarity(nextRarity)
    setPage(0)
    setSelectedLand(null)
  }

  const changePage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, nextPage)))
    setSelectedLand(null)
  }

  return (
    <div className="farming-preview-screen" role="dialog" aria-modal="true" aria-label="Vista previa de Farming">
      <header className="farming-preview-topbar">
        <div className="farming-preview-topbar-left">
          <button type="button" className="farming-preview-topbtn farming-preview-topbtn--home" onClick={onClose}>← INICIO</button>
        </div>

        <div className="farming-preview-logo-wrap" aria-label="Plant Arena Farming">
          <img src={logo} alt="Plant Arena" />
          <span>FARMING</span>
        </div>

        <div className="farming-preview-topright">
          <div className="farming-preview-wallet" title="Gemas">
            <img src={gema} alt="Gemas" />
            <strong>{demoGems}</strong>
          </div>
          <div className="farming-preview-wallet farming-preview-wallet--gold" title="Oro">
            <img src={moneda} alt="Oro" />
            <strong>{demoGold}</strong>
          </div>
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
              <p>Empieza alquilando un slot o compra una Land. Las Lands Genesis son mundos compartidos con sus propios slots.</p>
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
            <section className="farming-preview-explore farming-preview-explore--headers">
              <div className="farming-preview-explore-head">
                <div>
                  <h1>{mode === 'rent' ? 'Explorar Genesis Lands' : 'Genesis Lands en venta'}</h1>
                  <p>Elige una rareza y entra a un mundo. Los precios siguen siendo demostrativos.</p>
                </div>
                <button type="button" className="farming-preview-back" onClick={() => setMode('entry')}>← VOLVER</button>
              </div>

              <div className="farming-preview-rarity-tabs">
                {(Object.keys(RARITIES) as RarityKey[]).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={`farming-preview-rarity-tab farming-preview-rarity-tab--${key} ${rarity === key ? 'is-active' : ''}`}
                    onClick={() => selectRarity(key)}
                  >
                    {RARITIES[key].label}
                  </button>
                ))}
              </div>

              <div className={`farming-preview-land-headers farming-preview-land-headers--${rarity}`}>
                {visibleLands.map((landNumber) => {
                  const owner = DEMO_PLAYER_OWNERS[rarity]?.[landNumber]
                  const isSelected = selectedLand === landNumber
                  const available = Math.max(1, rarityData.slots - (landNumber % 4))
                  return (
                    <button
                      type="button"
                      key={landNumber}
                      className={`farming-preview-land-header farming-preview-land-header--${rarity} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedLand(landNumber)}
                    >
                      <div className="farming-preview-land-header-art">
                        <img src={rarityData.image} alt={`Land ${rarityData.label}`} />
                      </div>
                      <div className="farming-preview-land-header-copy">
                        <div className="farming-preview-land-header-title">
                          <strong>GENESIS {rarityData.label} #{String(landNumber).padStart(2, '0')}</strong>
                          <span className={`farming-preview-owner-pill ${owner ? 'is-player' : ''}`}>
                            {owner ? `Propietario: ${owner}` : 'Plant Arena'}
                          </span>
                        </div>
                        <small>{rarityData.description}</small>
                        <div className="farming-preview-land-header-meta">
                          <span>{rarityData.slots} slots</span>
                          <span className="is-available">{available} disponibles</span>
                          <span className="is-price">
                            {mode === 'rent'
                              ? `desde ${rarityData.rent} 💎 / día`
                              : owner
                                ? 'No disponible para compra'
                                : `${rarityData.buy} 💎`}
                          </span>
                        </div>
                      </div>
                      <span className="farming-preview-land-enter">
                        {mode === 'rent' ? 'ENTRAR' : owner ? 'VER' : 'COMPRAR'}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="farming-preview-land-pager" aria-label="Paginación de Lands">
                <button type="button" onClick={() => changePage(page - 1)} disabled={page === 0}>‹</button>
                <div className="farming-preview-land-dots">
                  {Array.from({ length: pageCount }, (_, index) => (
                    <button
                      type="button"
                      key={index}
                      className={index === page ? 'is-active' : ''}
                      onClick={() => changePage(index)}
                      aria-label={`Página ${index + 1}`}
                    />
                  ))}
                </div>
                <span>{page + 1} / {pageCount}</span>
                <button type="button" onClick={() => changePage(page + 1)} disabled={page === pageCount - 1}>›</button>
              </div>
            </section>
          )}
        </main>

        <aside className="farming-preview-panel farming-preview-actions">
          <div className="farming-preview-panel-title">📋 INFORMACIÓN / ACCIONES</div>
          <div className="farming-preview-action-body">
            {selectedLand ? (
              <>
                <div className="farming-preview-selected-land-art">
                  <img src={rarityData.image} alt={`Genesis ${rarityData.label}`} />
                </div>
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
          <button type="button" key={key} onClick={() => { setMode('rent'); selectRarity(key) }}>
            <img src={RARITIES[key].image} alt={`Land ${RARITIES[key].label}`} />
            <div><strong>{RARITIES[key].label}</strong><small>{RARITIES[key].slots} slots por Land</small></div>
          </button>
        ))}
      </footer>
    </div>
  )
}
