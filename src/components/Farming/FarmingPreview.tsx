import { useEffect, useMemo, useState } from 'react'
import logo from '../../assets/images/logo.webp'
import gema from '../../assets/ico/gema.webp'
import moneda from '../../assets/ico/moneda.webp'
import landCommon from '../../assets/images/farming/lands/common.webp'
import landRare from '../../assets/images/farming/lands/rare.webp'
import landEpic from '../../assets/images/farming/lands/epic.webp'
import landLegendary from '../../assets/images/farming/lands/legendary.webp'
import {
  FARMING_ITEM_DEFINITIONS,
  type FarmingInventory,
  type FarmingItemId,
} from '../../utils/pvpRewardManager'
import {
  farmingLandKey,
  loadFarmingDemoState,
  updateFarmingDemoState,
  type FarmingDemoRarity,
  type FarmingDemoState,
} from './farmingDemoStore'

interface FarmingPreviewProps {
  onClose: () => void
}

type RarityKey = FarmingDemoRarity
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

type OpenWorldDetail = {
  rarity: RarityKey
  label: string
  landNumber: number
  owner: string
  slots: number
  pricePerDay: number
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
  common: { label: 'COMÚN', slots: 8, count: 10, rent: 0.5, buy: 100, image: landCommon, perPage: 4, description: 'Terreno seco y plano' },
  rare: { label: 'RARA', slots: 12, count: 6, rent: 0.8, buy: 180, image: landRare, perPage: 3, description: 'Relieve montañoso' },
  epic: { label: 'ÉPICA', slots: 16, count: 3, rent: 1.2, buy: 350, image: landEpic, perPage: 3, description: 'Fértil y arbolada' },
  legendary: { label: 'LEGENDARIA', slots: 20, count: 1, rent: 2, buy: 700, image: landLegendary, perPage: 1, description: 'Terreno mágico especial' },
}

const DEMO_PLAYER_OWNERS: Partial<Record<RarityKey, Record<number, string>>> = {
  common: { 3: 'Mila', 8: 'Rocco' },
  rare: { 2: 'Xplora' },
  epic: { 2: 'Luna' },
}

function parseLandKey(key: string) {
  const [rarity, number] = key.split(':')
  return { rarity: rarity as RarityKey, landNumber: Number(number) }
}

export default function FarmingPreview({ onClose }: FarmingPreviewProps) {
  const [mode, setMode] = useState<CenterMode>('entry')
  const [rarity, setRarity] = useState<RarityKey>('common')
  const [selectedLand, setSelectedLand] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [demoState, setDemoState] = useState<FarmingDemoState>(() => loadFarmingDemoState())

  useEffect(() => {
    const sync = () => setDemoState(loadFarmingDemoState())
    window.addEventListener('farming-demo-updated', sync)
    return () => window.removeEventListener('farming-demo-updated', sync)
  }, [])

  const rarityData = RARITIES[rarity]
  const pageCount = Math.ceil(rarityData.count / rarityData.perPage)
  const lands = useMemo(() => Array.from({ length: rarityData.count }, (_, index) => index + 1), [rarityData.count])
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

  const ownerFor = (key: RarityKey, landNumber: number) => {
    if (demoState.ownedLands.includes(farmingLandKey(key, landNumber))) return 'TÚ'
    return DEMO_PLAYER_OWNERS[key]?.[landNumber] ?? 'Plant Arena'
  }

  const availableFor = (key: RarityKey, landNumber: number) => {
    const config = RARITIES[key]
    const landKey = farmingLandKey(key, landNumber)
    if (demoState.ownedLands.includes(landKey)) return config.slots
    const mine = Object.values(demoState.rentals).filter((rental) => rental.landKey === landKey).length
    const demoOccupied = landNumber === 1 ? 1 : 0
    return Math.max(0, config.slots - mine - demoOccupied)
  }

  const openWorld = (key: RarityKey, landNumber: number) => {
    const config = RARITIES[key]
    const detail: OpenWorldDetail = {
      rarity: key,
      label: config.label,
      landNumber,
      owner: ownerFor(key, landNumber),
      slots: config.slots,
      pricePerDay: config.rent,
    }
    window.dispatchEvent(new CustomEvent<OpenWorldDetail>('farming-open-world', { detail }))
  }

  const buySelectedLand = () => {
    if (!selectedLand) return
    const landKey = farmingLandKey(rarity, selectedLand)
    const externalOwner = DEMO_PLAYER_OWNERS[rarity]?.[selectedLand]

    if (demoState.ownedLands.includes(landKey)) {
      openWorld(rarity, selectedLand)
      return
    }
    if (externalOwner) {
      window.alert(`Esta Land pertenece a ${externalOwner} y no está a la venta en esta demo.`)
      return
    }
    if (demoState.gems < rarityData.buy) {
      window.alert('No tienes Gems suficientes en la demo.')
      return
    }

    const next = updateFarmingDemoState((state) => ({
      ...state,
      gems: state.gems - rarityData.buy,
      ownedLands: [...state.ownedLands, landKey],
    }))
    setDemoState(next)
    window.alert(`Compra local completada: Genesis ${rarityData.label} #${String(selectedLand).padStart(2, '0')}.`)
  }

  const openFirstOwned = () => {
    const first = demoState.ownedLands[0]
    if (!first) { openExplore('buy'); return }
    const parsed = parseLandKey(first)
    setMode('rent')
    setRarity(parsed.rarity)
    setSelectedLand(parsed.landNumber)
    setPage(Math.floor((parsed.landNumber - 1) / RARITIES[parsed.rarity].perPage))
    setTimeout(() => openWorld(parsed.rarity, parsed.landNumber), 0)
  }

  const openFirstRental = () => {
    const first = Object.values(demoState.rentals)[0]
    if (!first) { openExplore('rent'); return }
    const parsed = parseLandKey(first.landKey)
    setMode('rent')
    setRarity(parsed.rarity)
    setSelectedLand(parsed.landNumber)
    setPage(Math.floor((parsed.landNumber - 1) / RARITIES[parsed.rarity].perPage))
    setTimeout(() => openWorld(parsed.rarity, parsed.landNumber), 0)
  }

  const inventoryQuantity = (id: FarmingItemId) => {
    if (id === 'water') return demoState.water
    if (id === 'fertilizer') return demoState.fertilizer
    if (id === 'pesticide') return demoState.pesticide
    return DEMO_INVENTORY[id]
  }

  return (
    <div className="farming-preview-screen" role="dialog" aria-modal="true" aria-label="Vista previa de Farming">
      <header className="farming-preview-topbar">
        <div className="farming-preview-topbar-left"><button type="button" className="farming-preview-topbtn farming-preview-topbtn--home" onClick={onClose}>← INICIO</button></div>
        <div className="farming-preview-logo-wrap" aria-label="Plant Arena Farming"><img src={logo} alt="Plant Arena" /><span>FARMING · DEMO LOCAL</span></div>
        <div className="farming-preview-topright">
          <div className="farming-preview-wallet" title="Gemas"><img src={gema} alt="Gemas" /><strong>{demoState.gems.toFixed(1)}</strong></div>
          <div className="farming-preview-wallet farming-preview-wallet--gold" title="Oro"><img src={moneda} alt="Oro" /><strong>{demoState.gold}</strong></div>
          <button type="button" className="farming-preview-topbtn" onClick={openFirstOwned}>MIS LANDS ({demoState.ownedLands.length})</button>
          <button type="button" className="farming-preview-topbtn" onClick={openFirstRental}>MIS ALQUILERES ({Object.keys(demoState.rentals).length})</button>
        </div>
      </header>

      <div className="farming-preview-layout">
        <aside className="farming-preview-panel farming-preview-inventory">
          <div className="farming-preview-panel-title">🎒 INVENTARIO DE CULTIVO</div>
          <div className="farming-preview-items">
            <div className="farming-preview-item farming-preview-item--seed"><span aria-hidden="true" style={{ fontSize: 28, textAlign: 'center' }}>🌰</span><div><strong>Semilla misteriosa</strong><small>Se revela después de sembrarla.</small></div><b>{demoState.seeds}</b></div>
            {INVENTORY_ORDER.map((id) => {
              const item = FARMING_ITEM_DEFINITIONS[id]
              return <div className="farming-preview-item" key={id}><img src={item.icon} alt={item.label} /><div><strong>{item.label}</strong><small>{item.description}</small></div><b>{inventoryQuantity(id)}</b></div>
            })}
          </div>
        </aside>

        <main className="farming-preview-center">
          {mode === 'entry' ? (
            <section className="farming-preview-empty-state">
              <div className="farming-preview-seedmark">🌱</div><h1>Prueba completa de Farming</h1><p>Tienes 2 semillas locales para probar compra, alquiler, siembra, riego y fertilizante sin tocar Supabase.</p>
              <div className="farming-preview-entry-actions">
                <button type="button" className="farming-preview-choice farming-preview-choice--rent" onClick={() => openExplore('rent')}><span>🤝</span><div><strong>Alquilar un slot</strong><small>Elige rareza → Land → slot.</small></div><b>BUSCAR SLOT</b></button>
                <button type="button" className="farming-preview-choice farming-preview-choice--buy" onClick={() => openExplore('buy')}><span>🏝️</span><div><strong>Comprar una Land</strong><small>La compra queda guardada solo en este navegador.</small></div><b>VER LANDS</b></button>
              </div>
            </section>
          ) : (
            <section className="farming-preview-explore farming-preview-explore--headers">
              <div className="farming-preview-explore-head"><div><h1>{mode === 'rent' ? 'Explorar Genesis Lands' : 'Genesis Lands en venta'}</h1><p>Demo local: ninguna acción económica de esta pantalla toca el backend.</p></div><button type="button" className="farming-preview-back" onClick={() => setMode('entry')}>← VOLVER</button></div>
              <div className="farming-preview-rarity-tabs">
                {(Object.keys(RARITIES) as RarityKey[]).map((key) => <button type="button" key={key} className={`farming-preview-rarity-tab farming-preview-rarity-tab--${key} ${rarity === key ? 'is-active' : ''}`} onClick={() => selectRarity(key)}>{RARITIES[key].label}</button>)}
              </div>
              <div className={`farming-preview-land-headers farming-preview-land-headers--${rarity}`}>
                {visibleLands.map((landNumber) => {
                  const landKey = farmingLandKey(rarity, landNumber)
                  const owner = ownerFor(rarity, landNumber)
                  const isMine = demoState.ownedLands.includes(landKey)
                  const isSelected = selectedLand === landNumber
                  const available = availableFor(rarity, landNumber)
                  return (
                    <button type="button" key={landNumber} className={`farming-preview-land-header farming-preview-land-header--${rarity} ${isSelected ? 'is-selected' : ''} ${isMine ? 'is-owned' : ''}`} onClick={() => { setSelectedLand(landNumber); if (mode === 'rent') openWorld(rarity, landNumber) }}>
                      <div className="farming-preview-land-header-art"><img src={rarityData.image} alt={`Land ${rarityData.label}`} /></div>
                      <div className="farming-preview-land-header-copy">
                        <div className="farming-preview-land-header-title"><strong>GENESIS {rarityData.label} #{String(landNumber).padStart(2, '0')}</strong><span className={`farming-preview-owner-pill ${owner !== 'Plant Arena' ? 'is-player' : ''} ${isMine ? 'is-mine' : ''}`}>{isMine ? 'TU LAND' : owner === 'Plant Arena' ? 'Plant Arena' : `Propietario: ${owner}`}</span></div>
                        <small>{rarityData.description}</small>
                        <div className="farming-preview-land-header-meta"><span>{rarityData.slots} slots</span><span className="is-available">{available} disponibles</span><span className="is-price">{mode === 'rent' ? isMine ? 'USAR MIS SLOTS' : `desde ${rarityData.rent} 💎 / día` : isMine ? 'YA ES TUYA' : owner !== 'Plant Arena' ? 'No disponible para compra' : `${rarityData.buy} 💎`}</span></div>
                      </div>
                      <span className="farming-preview-land-enter">{mode === 'rent' ? 'ENTRAR' : isMine ? 'TU LAND' : owner !== 'Plant Arena' ? 'VER' : 'SELECCIONAR'}</span>
                    </button>
                  )
                })}
              </div>
              <div className="farming-preview-land-pager" aria-label="Paginación de Lands"><button type="button" onClick={() => changePage(page - 1)} disabled={page === 0}>‹</button><div className="farming-preview-land-dots">{Array.from({ length: pageCount }, (_, index) => <button type="button" key={index} className={index === page ? 'is-active' : ''} onClick={() => changePage(index)} aria-label={`Página ${index + 1}`} />)}</div><span>{page + 1} / {pageCount}</span><button type="button" onClick={() => changePage(page + 1)} disabled={page === pageCount - 1}>›</button></div>
            </section>
          )}
        </main>

        <aside className="farming-preview-panel farming-preview-actions">
          <div className="farming-preview-panel-title">📋 INFORMACIÓN / ACCIONES</div>
          <div className="farming-preview-action-body">
            {selectedLand ? (<><div className="farming-preview-selected-land-art"><img src={rarityData.image} alt={`Genesis ${rarityData.label}`} /></div><h2>GENESIS {rarityData.label} #{String(selectedLand).padStart(2, '0')}</h2><dl><div><dt>Slots</dt><dd>{rarityData.slots}</dd></div><div><dt>Gestión</dt><dd>{ownerFor(rarity, selectedLand)}</dd></div><div><dt>Alquiler base</dt><dd>{rarityData.rent} 💎 / día</dd></div></dl><button type="button" className="farming-preview-primary-action" onClick={() => mode === 'rent' ? openWorld(rarity, selectedLand) : buySelectedLand()}>{mode === 'rent' ? demoState.ownedLands.includes(farmingLandKey(rarity, selectedLand)) ? 'ENTRAR A MI LAND' : 'ENTRAR A LA LAND' : demoState.ownedLands.includes(farmingLandKey(rarity, selectedLand)) ? 'ENTRAR A MI LAND' : `COMPRAR · ${rarityData.buy} 💎`}</button></>) : (<div className="farming-preview-no-selection"><div>＋</div><h2>Selecciona una Land</h2><p>Aquí aparecerán el mundo, el slot seleccionado y las acciones disponibles.</p><button type="button" onClick={() => openExplore('rent')}>🤝 BUSCAR SLOT</button><button type="button" onClick={() => openExplore('buy')}>🏝️ COMPRAR LAND</button></div>)}
          </div>
        </aside>
      </div>

      <footer className="farming-preview-bottom">{(Object.keys(RARITIES) as RarityKey[]).map((key) => <button type="button" key={key} onClick={() => { setMode('rent'); selectRarity(key) }}><img src={RARITIES[key].image} alt={`Land ${RARITIES[key].label}`} /><div><strong>{RARITIES[key].label}</strong><small>{RARITIES[key].slots} slots por Land</small></div></button>)}</footer>
    </div>
  )
}
