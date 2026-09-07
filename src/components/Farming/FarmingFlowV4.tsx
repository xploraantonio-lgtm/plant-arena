import { useEffect, useMemo, useState } from 'react'
import logo from '../../assets/images/logo.webp'
import gema from '../../assets/ico/gema.webp'
import moneda from '../../assets/ico/moneda.webp'
import landCommon from '../../assets/images/farming/lands/common.webp'
import landRare from '../../assets/images/farming/lands/rare.webp'
import landEpic from '../../assets/images/farming/lands/epic.webp'
import landLegendary from '../../assets/images/farming/lands/legendary.webp'
import slotAsset from '../../assets/images/farming/slots/slot.webp'
import slotLegendary from '../../assets/images/farming/slots/slotL.webp'
import { FARMING_ITEM_DEFINITIONS } from '../../utils/pvpRewardManager'
import './FarmingFlowV4.css'

type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
type Screen = 'home' | 'market' | 'world'
type MarketMode = 'rent' | 'buy' | 'help'
type Land = { rarity: Rarity; number: number }
type Crop = { water: number; fertilizer: number; crow: boolean }
type Rental = { days: 7 | 15 | 30 }
type DemoState = {
  gems: number
  gold: number
  seeds: number
  water: number
  fertilizer: number
  pesticide: number
  ownedLands: string[]
  rentals: Record<string, Rental>
  slotModes: Record<string, 'personal' | 'listed'>
  crops: Record<string, Crop>
  npcWater: Record<string, number>
  capturedNpcCrows: string[]
}
type Popup = { title: string; body: string; reward?: string } | null

const STORAGE_KEY = 'plant-arena-farming-flow-v3'
const START: DemoState = {
  gems: 2500,
  gold: 3000,
  seeds: 2,
  water: 12,
  fertilizer: 4,
  pesticide: 2,
  ownedLands: [],
  rentals: {},
  slotModes: {},
  crops: {},
  npcWater: {},
  capturedNpcCrows: [],
}

const RARITIES: Record<Rarity, { label: string; slots: number; count: number; rent: number; buy: number; perPage: number; description: string; image: string }> = {
  common: { label: 'COMÚN', slots: 8, count: 10, rent: 0.5, buy: 100, perPage: 4, description: 'Terreno seco y plano', image: landCommon },
  rare: { label: 'RARA', slots: 12, count: 6, rent: 0.8, buy: 180, perPage: 3, description: 'Relieve montañoso', image: landRare },
  epic: { label: 'ÉPICA', slots: 16, count: 3, rent: 1.2, buy: 350, perPage: 3, description: 'Fértil y arbolada', image: landEpic },
  legendary: { label: 'LEGENDARIA', slots: 20, count: 1, rent: 2, buy: 700, perPage: 1, description: 'Terreno mágico especial', image: landLegendary },
}

const NPC_OWNERS: Partial<Record<Rarity, Record<number, string>>> = {
  common: { 3: 'Mila', 8: 'Rocco' },
  rare: { 2: 'Nori', 5: 'Xplora' },
  epic: { 2: 'Luna' },
}

const LAND_BAR = (Object.keys(RARITIES) as Rarity[]).map((rarity) => ({ rarity, ...RARITIES[rarity] }))

function landKey(land: Land) { return `${land.rarity}:${land.number}` }
function slotKey(land: Land, slot: number) { return `${landKey(land)}:${slot}` }
function parseLandKey(key: string): Land {
  const [rarity, number] = key.split(':')
  return { rarity: rarity as Rarity, number: Number(number) }
}
function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...START, ...JSON.parse(raw) } : { ...START }
  } catch { return { ...START } }
}
function cropStage(crop?: Crop) {
  if (!crop) return null
  if (crop.water >= 5 && crop.fertilizer >= 1) return 'CRECIENDO'
  if (crop.water >= 4) return 'CASI LISTA'
  if (crop.water >= 2) return 'BROTE MISTERIOSO'
  return 'SEMILLA PLANTADA'
}
function npcBaseWater(slot: number) {
  const mod = ((slot - 1) % 4) + 1
  if (mod === 1) return 2
  if (mod === 3) return 1
  if (mod === 4) return 4
  return 0
}

export default function FarmingFlowV4({ onClose }: { onClose: () => void }) {
  const [demo, setDemo] = useState<DemoState>(() => loadState())
  const [screen, setScreen] = useState<Screen>('home')
  const [marketMode, setMarketMode] = useState<MarketMode>('buy')
  const [rarity, setRarity] = useState<Rarity>('common')
  const [landPage, setLandPage] = useState(0)
  const [selectedLand, setSelectedLand] = useState<Land | null>(null)
  const [world, setWorld] = useState<Land | null>(null)
  const [slotPage, setSlotPage] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState(1)
  const [rentDays, setRentDays] = useState<7 | 15 | 30>(7)
  const [popup, setPopup] = useState<Popup>(null)
  const [toast, setToast] = useState('')
  const [waterPulse, setWaterPulse] = useState('')

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(demo)) }, [demo])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 1500)
    return () => window.clearTimeout(id)
  }, [toast])
  useEffect(() => {
    if (demo.ownedLands.length > 0) {
      const land = parseLandKey(demo.ownedLands[0])
      setWorld(land); setSelectedLand(land); setSelectedSlot(1); setSlotPage(0); setScreen('world')
      return
    }
    const firstRental = Object.keys(demo.rentals)[0]
    if (firstRental) {
      const [r, n, s] = firstRental.split(':')
      const land = { rarity: r as Rarity, number: Number(n) }
      const slot = Number(s)
      setWorld(land); setSelectedLand(land); setSelectedSlot(slot); setSlotPage(Math.floor((slot - 1) / 4)); setScreen('world')
    }
  // Solo decide la pantalla inicial al montar Farming.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const conf = RARITIES[rarity]
  const lands = useMemo(() => Array.from({ length: conf.count }, (_, i) => i + 1), [conf.count])
  const landPages = Math.ceil(conf.count / conf.perPage)
  const visibleLands = lands.slice(landPage * conf.perPage, (landPage + 1) * conf.perPage)
  const worldConf = world ? RARITIES[world.rarity] : null
  const slotPages = worldConf ? Math.ceil(worldConf.slots / 4) : 1
  const visibleSlots = worldConf ? Array.from({ length: 4 }, (_, i) => slotPage * 4 + i + 1).filter((n) => n <= worldConf.slots) : []

  const ownerFor = (land: Land) => demo.ownedLands.includes(landKey(land)) ? 'TÚ' : NPC_OWNERS[land.rarity]?.[land.number] ?? 'Plant Arena'
  const owned = (land: Land) => demo.ownedLands.includes(landKey(land))

  const openMarket = (mode: MarketMode) => {
    setMarketMode(mode); setRarity('common'); setLandPage(0); setSelectedLand(null); setScreen('market')
  }
  const openWorld = (land: Land, slot = 1) => {
    setWorld(land); setSelectedLand(land); setSelectedSlot(slot); setSlotPage(Math.floor((slot - 1) / 4)); setRentDays(7); setScreen('world')
  }
  const reset = () => {
    localStorage.removeItem(STORAGE_KEY)
    setDemo({ ...START }); setScreen('home'); setWorld(null); setSelectedLand(null); setSelectedSlot(1); setSlotPage(0)
    setPopup({ title: 'Demo reiniciada', body: 'Empiezas sin Lands ni alquileres, con 2 semillas y recursos de prueba.' })
  }
  const buyLand = (land: Land) => {
    const c = RARITIES[land.rarity]
    const owner = ownerFor(land)
    if (owner !== 'Plant Arena') { setPopup({ title: 'Land no disponible', body: owner === 'TÚ' ? 'Esta Genesis Land ya te pertenece.' : `Esta Land pertenece a ${owner}. Puedes entrar a sus slots.` }); return }
    if (demo.gems < c.buy) { setPopup({ title: 'Gems insuficientes', body: `Necesitas ${c.buy} Gems para comprar esta Land.` }); return }
    setDemo((s) => ({ ...s, gems: s.gems - c.buy, ownedLands: [...s.ownedLands, landKey(land)] }))
    setPopup({ title: '¡Genesis Land comprada!', body: `${c.label} #${String(land.number).padStart(2, '0')} ahora es tuya. Puedes usar cada slot o ponerlo en alquiler.` })
  }
  const rentSlot = (land: Land, slot: number) => {
    const c = RARITIES[land.rarity]
    const key = slotKey(land, slot)
    const cost = c.rent * rentDays
    if (demo.gems < cost) { setPopup({ title: 'Gems insuficientes', body: `Necesitas ${cost.toFixed(1)} Gems para este alquiler.` }); return }
    setDemo((s) => ({ ...s, gems: Number((s.gems - cost).toFixed(1)), rentals: { ...s.rentals, [key]: { days: rentDays } } }))
    setPopup({ title: '¡Slot alquilado!', body: `Slot #${String(slot).padStart(2, '0')} alquilado por ${rentDays} días.` })
  }
  const plant = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    if (demo.seeds < 1) { setPopup({ title: 'Sin semillas', body: 'Ya no te quedan semillas de prueba. Reinicia la demo para recuperar las 2 semillas.' }); return }
    if (demo.crops[key]) { setPopup({ title: 'Slot ocupado', body: 'Este slot ya tiene un cultivo activo.' }); return }
    setDemo((s) => ({ ...s, seeds: s.seeds - 1, crops: { ...s.crops, [key]: { water: 0, fertilizer: 0, crow: false } } }))
    setToast('🌰 Semilla plantada · necesita 5 riegos')
  }
  const waterOwn = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const crop = demo.crops[key]
    if (!crop) { setPopup({ title: 'Primero siembra', body: 'Este slot todavía no tiene una semilla plantada.' }); return }
    if (crop.water >= 5) { setPopup({ title: 'Riego completo', body: 'Este cultivo ya tiene 5/5 riegos.' }); return }
    if (demo.water < 1) { setPopup({ title: 'Sin agua', body: 'No te queda agua disponible.' }); return }
    const nextWater = crop.water + 1
    const crow = crop.crow || (nextWater === 3 && slot % 2 === 0)
    setDemo((s) => ({ ...s, water: s.water - 1, crops: { ...s.crops, [key]: { ...crop, water: nextWater, crow } } }))
    setWaterPulse(key); window.setTimeout(() => setWaterPulse(''), 450)
    setToast(`💧 Riego ${nextWater}/5${crow && !crop.crow ? ' · ¡apareció un cuervo!' : ''}`)
  }
  const fertilize = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const crop = demo.crops[key]
    if (!crop) { setPopup({ title: 'Primero siembra', body: 'Necesitas un cultivo activo para usar fertilizante.' }); return }
    if (crop.fertilizer >= 2) { setPopup({ title: 'Fertilización completa', body: 'Este cultivo ya tiene 2/2 aplicaciones.' }); return }
    if (demo.fertilizer < 1) { setPopup({ title: 'Sin fertilizante', body: 'No te queda fertilizante.' }); return }
    const next = crop.fertilizer + 1
    setDemo((s) => ({ ...s, fertilizer: s.fertilizer - 1, crops: { ...s.crops, [key]: { ...crop, fertilizer: next } } }))
    setToast(`🌿 Fertilizante ${next}/2`)
  }
  const waterNpc = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const current = demo.npcWater[key] ?? npcBaseWater(slot)
    if (current >= 5) { setPopup({ title: 'Planta NPC hidratada', body: 'Este cultivo ya tiene 5/5 riegos.' }); return }
    if (demo.water < 1) { setPopup({ title: 'Sin agua', body: 'Necesitas agua para ayudar a otros jugadores.' }); return }
    const next = current + 1
    setDemo((s) => ({ ...s, water: s.water - 1, gold: next === 5 ? s.gold + 20 : s.gold, npcWater: { ...s.npcWater, [key]: next } }))
    setWaterPulse(key); window.setTimeout(() => setWaterPulse(''), 450)
    if (next === 5) setPopup({ title: '¡Ayuda completada!', body: 'Terminaste de regar la planta de otro jugador.', reward: '+20 Gold · demo local' })
    else setToast(`🤝 Ayuda de riego ${next}/5`)
  }
  const captureCrow = (land: Land, slot: number, npc: boolean) => {
    const key = slotKey(land, slot)
    if (npc) {
      if (demo.capturedNpcCrows.includes(key)) return
      setDemo((s) => ({ ...s, gold: s.gold + 50, capturedNpcCrows: [...s.capturedNpcCrows, key] }))
    } else {
      const crop = demo.crops[key]
      if (!crop?.crow) return
      setDemo((s) => ({ ...s, gold: s.gold + 50, crops: { ...s.crops, [key]: { ...crop, crow: false } } }))
    }
    setPopup({ title: '🐦‍⬛ ¡Cuervo capturado!', body: 'El cultivo queda libre del cuervo.', reward: '+50 Gold · demo local' })
  }
  const toggleSlotMode = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const current = demo.slotModes[key] ?? 'personal'
    const next = current === 'personal' ? 'listed' : 'personal'
    setDemo((s) => ({ ...s, slotModes: { ...s.slotModes, [key]: next } }))
    setToast(next === 'listed' ? '🏷️ Slot puesto en alquiler al precio fijo de la Land' : '🌱 Slot reservado para tu uso')
  }

  const dots = (value: number, max: number) => <span className="fv4-dots">{Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? 'on' : ''} />)}</span>

  const inventory = <aside className="fv4-panel fv4-inventory"><h3>🎒 INVENTARIO</h3><div className="fv4-items">
    <div className="fv4-item"><span className="fv4-seed">🌰</span><div><strong>Semillas</strong><small>Misteriosas</small></div><b>{demo.seeds}</b></div>
    <div className="fv4-item"><img src={FARMING_ITEM_DEFINITIONS.water.icon} alt=""/><div><strong>Agua</strong><small>Riego</small></div><b>{demo.water}</b></div>
    <div className="fv4-item"><img src={FARMING_ITEM_DEFINITIONS.fertilizer.icon} alt=""/><div><strong>Fertilizante</strong><small>Crecimiento</small></div><b>{demo.fertilizer}</b></div>
    <div className="fv4-item"><img src={FARMING_ITEM_DEFINITIONS.pesticide.icon} alt=""/><div><strong>Pesticida</strong><small>Ayuda social</small></div><b>{demo.pesticide}</b></div>
    <div className="fv4-item"><img src={FARMING_ITEM_DEFINITIONS.shovel_fragment.icon} alt=""/><div><strong>Frag. pala</strong><small>Crafting</small></div><b>6</b></div>
    <div className="fv4-item"><img src={FARMING_ITEM_DEFINITIONS.scarecrow_fragment.icon} alt=""/><div><strong>Frag. espant.</strong><small>Crafting</small></div><b>30</b></div>
  </div></aside>

  const landBar = <footer className="fv4-landbar">{LAND_BAR.map((item) => <div className="fv4-landbar-card" key={item.rarity}><img src={item.image} alt=""/><div><strong>{item.label}</strong><small>{item.slots} slots por Land</small></div></div>)}</footer>

  const marketTitle = marketMode === 'buy' ? 'Genesis Lands en venta' : marketMode === 'help' ? 'Explorar Lands y ayudar' : 'Alquila slots y cultiva'

  const renderMarketCenter = () => <section className="fv4-center-card fv4-market-center"><div className="fv4-section-head"><div><h1>{marketTitle}</h1><p>{marketMode === 'buy' ? 'Compra directamente o entra a revisar los slots antes de comprar.' : 'Entra a una Land para alquilar slots, revisar ocupación o ayudar a otros jugadores.'}</p></div><button onClick={() => setScreen('home')}>← VOLVER</button></div><div className="fv4-tabs">{(Object.keys(RARITIES) as Rarity[]).map((r) => <button key={r} className={rarity === r ? 'active' : ''} onClick={() => { setRarity(r); setLandPage(0); setSelectedLand(null) }}>{RARITIES[r].label}</button>)}</div><div className="fv4-land-list">{visibleLands.map((n) => {
    const land = { rarity, number: n }
    const owner = ownerFor(land)
    const mine = owned(land)
    const canBuy = owner === 'Plant Arena'
    return <article key={n} className={`fv4-land ${selectedLand?.rarity === rarity && selectedLand.number === n ? 'selected' : ''} ${mine ? 'mine' : ''}`} onClick={() => setSelectedLand(land)}><img src={conf.image} alt=""/><div className="fv4-land-copy"><h2>GENESIS {conf.label} #{String(n).padStart(2, '0')}</h2><span className="fv4-owner">{mine ? 'TU LAND' : owner}</span><p>{conf.description}</p><div className="fv4-land-meta"><b>{conf.slots} slots</b><b>{conf.rent} 💎 / día</b>{marketMode === 'buy' && <b>{canBuy ? `${conf.buy} 💎` : 'CON DUEÑO'}</b>}</div></div><div className="fv4-land-actions">{marketMode === 'buy' && canBuy && <button className="gold" onClick={(e) => { e.stopPropagation(); buyLand(land) }}>COMPRAR</button>}<button className="blue" onClick={(e) => { e.stopPropagation(); openWorld(land) }}>ENTRAR</button></div></article>
  })}</div><div className="fv4-pager"><button disabled={landPage === 0} onClick={() => setLandPage(Math.max(0, landPage - 1))}>‹</button><b>{landPage + 1} / {landPages}</b><button disabled={landPage === landPages - 1} onClick={() => setLandPage(Math.min(landPages - 1, landPage + 1))}>›</button></div></section>

  const renderMarketDetail = () => <aside className="fv4-panel fv4-detail"><h3>📋 INFORMACIÓN / ACCIONES</h3>{selectedLand ? (() => {
    const c = RARITIES[selectedLand.rarity]
    const owner = ownerFor(selectedLand)
    const canBuy = owner === 'Plant Arena'
    return <div className="fv4-detail-body"><img className="fv4-detail-land" src={c.image} alt=""/><h2>GENESIS {c.label} #{String(selectedLand.number).padStart(2, '0')}</h2><dl><div><dt>Propietario</dt><dd>{owner}</dd></div><div><dt>Slots</dt><dd>{c.slots}</dd></div><div><dt>Alquiler base</dt><dd>{c.rent} 💎/día</dd></div></dl>{marketMode === 'buy' && canBuy && <button className="fv4-action gold" onClick={() => buyLand(selectedLand)}>COMPRAR · {c.buy} 💎</button>}<button className="fv4-action blue" onClick={() => openWorld(selectedLand)}>ENTRAR · VER SLOTS</button></div>
  })() : <div className="fv4-empty-detail"><span>＋</span><strong>Selecciona una Land</strong><small>Aquí verás propietario, precio y acciones.</small></div>}</aside>

  const renderSlot = (slot: number) => {
    if (!world || !worldConf) return null
    const key = slotKey(world, slot)
    const landIsMine = owned(world)
    const rental = demo.rentals[key]
    const crop = demo.crops[key]
    const mod = ((slot - 1) % 4) + 1
    const npc = !landIsMine && !rental && mod !== 2
    const free = !landIsMine && !rental && mod === 2
    const listed = landIsMine && (demo.slotModes[key] ?? 'personal') === 'listed'
    const npcWater = demo.npcWater[key] ?? npcBaseWater(slot)
    const npcCrow = npc && mod === 3 && !demo.capturedNpcCrows.includes(key)
    const status = landIsMine ? (listed ? 'EN ALQUILER' : 'TU LAND') : rental ? 'TU ALQUILER' : npc ? 'PLANTA NPC' : 'DISPONIBLE'
    const art = world.rarity === 'legendary' ? slotLegendary : slotAsset
    return <button key={slot} className={`fv4-slot ${selectedSlot === slot ? 'selected' : ''} ${landIsMine || rental ? 'mine' : ''} ${listed ? 'listed' : ''} ${npc ? 'npc' : ''} ${waterPulse === key ? 'pulse' : ''}`} onClick={() => setSelectedSlot(slot)}><div className="fv4-slot-art"><img src={art} alt={`Slot ${slot}`}/>{crop && <span className="fv4-crop">{crop.water < 2 ? '🌰' : crop.water < 5 ? '🌱' : '🌿'}</span>}{npc && <span className="fv4-crop">🌱</span>}{(crop?.crow || npcCrow) && <span className="fv4-crow">🐦‍⬛</span>}</div><div className="fv4-slot-copy"><div><strong>SLOT #{String(slot).padStart(2, '0')}</strong><b>{cropStage(crop) ?? status}</b></div><small>{listed ? `Publicado a ${worldConf.rent} 💎/día` : npc ? `Propietario: ${ownerFor(world)} · puedes ayudar` : free ? 'Libre para alquilar' : rental ? `Tu contrato: ${rental.days} días` : 'Disponible para tu cultivo'}</small><p>💧 {dots(crop ? crop.water : npc ? npcWater : 0, 5)}</p><p>🌿 {dots(crop?.fertilizer ?? 0, 2)}</p></div></button>
  }

  const renderWorldCenter = () => world && worldConf ? <section className="fv4-center-card fv4-world-center"><div className="fv4-world-head"><button onClick={() => { setScreen('market'); setSelectedLand(world) }}>← MUNDOS</button><div><h1>GENESIS {worldConf.label} #{String(world.number).padStart(2, '0')}</h1><p>{owned(world) ? 'TU LAND' : `Propietario: ${ownerFor(world)}`} · {worldConf.slots} slots</p></div><span>{owned(world) ? '🌿 GESTIÓN DE TU LAND' : '🤝 MUNDO COMPARTIDO'}</span></div><div className="fv4-slot-grid">{visibleSlots.map(renderSlot)}</div><div className="fv4-pager"><button disabled={slotPage === 0} onClick={() => { const p = Math.max(0, slotPage - 1); setSlotPage(p); setSelectedSlot(p * 4 + 1) }}>‹</button><b>{slotPage + 1} / {slotPages}</b><button disabled={slotPage === slotPages - 1} onClick={() => { const p = Math.min(slotPages - 1, slotPage + 1); setSlotPage(p); setSelectedSlot(p * 4 + 1) }}>›</button></div></section> : null

  const renderWorldDetail = () => {
    if (!world || !worldConf) return <aside className="fv4-panel fv4-detail" />
    const key = slotKey(world, selectedSlot)
    const landIsMine = owned(world)
    const rental = demo.rentals[key]
    const crop = demo.crops[key]
    const mod = ((selectedSlot - 1) % 4) + 1
    const npc = !landIsMine && !rental && mod !== 2
    const free = !landIsMine && !rental && mod === 2
    const listed = landIsMine && (demo.slotModes[key] ?? 'personal') === 'listed'
    const npcWater = demo.npcWater[key] ?? npcBaseWater(selectedSlot)
    const npcCrow = npc && mod === 3 && !demo.capturedNpcCrows.includes(key)
    return <aside className="fv4-panel fv4-detail"><h3>📋 INFORMACIÓN / ACCIONES</h3><div className="fv4-detail-body"><h2>SLOT #{String(selectedSlot).padStart(2, '0')}</h2><dl><div><dt>Land</dt><dd>{worldConf.label}</dd></div><div><dt>Propietario</dt><dd>{ownerFor(world)}</dd></div><div><dt>Tarifa base</dt><dd>{worldConf.rent} 💎/día</dd></div><div><dt>Estado</dt><dd>{landIsMine ? (listed ? 'En alquiler' : 'Uso propio') : rental ? 'Tu alquiler' : npc ? 'NPC' : 'Disponible'}</dd></div></dl>
      {landIsMine && <div className="fv4-block"><h4>GESTIÓN DEL SLOT</h4><button className={`fv4-action ${listed ? 'gold' : 'green'}`} onClick={() => toggleSlotMode(world, selectedSlot)}>{listed ? '🌱 USAR YO' : '🏷️ PONER EN ALQUILER'}</button><small>Precio fijo: {worldConf.rent} 💎 / día</small></div>}
      {free && <div className="fv4-block"><h4>DURACIÓN DEL ALQUILER</h4><div className="fv4-rent-options">{([7,15,30] as const).map((d) => <button key={d} className={rentDays === d ? 'active' : ''} onClick={() => setRentDays(d)}><b>{d} días</b><span>{(worldConf.rent * d).toFixed(1)} 💎</span></button>)}</div><button className="fv4-action gold" onClick={() => rentSlot(world, selectedSlot)}>🔑 ALQUILAR</button></div>}
      {(landIsMine || rental) && !listed && <div className="fv4-block"><h4>GESTIÓN DE CULTIVO</h4>{!crop ? <button className="fv4-action seed" onClick={() => plant(world, selectedSlot)}>🌰 PLANTAR SEMILLA · {demo.seeds}</button> : <><div className="fv4-meter"><b>Riego {crop.water}/5</b>{dots(crop.water, 5)}</div><div className="fv4-meter"><b>Fertilizante {crop.fertilizer}/2</b>{dots(crop.fertilizer, 2)}</div><button className="fv4-action blue" onClick={() => waterOwn(world, selectedSlot)}>💧 REGAR · {demo.water}</button><button className="fv4-action green" onClick={() => fertilize(world, selectedSlot)}>🌿 FERTILIZAR · {demo.fertilizer}</button>{crop.crow && <button className="fv4-action crow" onClick={() => captureCrow(world, selectedSlot, false)}>🐦‍⬛ CAPTURAR CUERVO</button>}</>}</div>}
      {npc && <div className="fv4-block"><h4>AYUDAR A OTRO JUGADOR</h4><div className="fv4-meter"><b>Riego NPC {npcWater}/5</b>{dots(npcWater, 5)}</div><button className="fv4-action blue" onClick={() => waterNpc(world, selectedSlot)}>🚿 REGAR + AYUDA · {demo.water}</button>{npcCrow && <button className="fv4-action crow" onClick={() => captureCrow(world, selectedSlot, true)}>🐦‍⬛ CAPTURAR CUERVO</button>}</div>}
    </div></aside>
  }

  const homeCenter = <section className="fv4-center-card fv4-home-center"><span className="fv4-home-mark">🌱</span><h1>Compra una Land o alquila slots y gana</h1><p>Empieza desde cero. Puedes comprar una Genesis Land, alquilar un espacio para cultivar o entrar a Lands de otros jugadores para ayudar.</p></section>
  const homeDetail = <aside className="fv4-panel fv4-detail"><h3>📋 EMPEZAR</h3><div className="fv4-home-actions"><button className="fv4-action blue" onClick={() => openMarket('rent')}>🤝 ALQUILAR UN SLOT</button><button className="fv4-action gold" onClick={() => openMarket('buy')}>🏝️ COMPRAR UNA LAND</button><button className="fv4-action green" onClick={() => openMarket('help')}>💧 EXPLORAR Y AYUDAR</button><div><strong>Tu estado</strong><small>{demo.ownedLands.length} Lands · {Object.keys(demo.rentals).length} alquileres</small></div><button className="fv4-reset" onClick={reset}>REINICIAR DEMO LOCAL</button></div></aside>

  return <div className="fv4-screen">
    <header className="fv4-top"><button className="fv4-home-btn" onClick={screen === 'home' ? onClose : () => setScreen('home')}>← {screen === 'home' ? 'INICIO' : 'FARMING'}</button><div className="fv4-logo"><img src={logo} alt="Plant Arena"/><span>FARMING · DEMO LOCAL</span></div><div className="fv4-wallets"><div><img src={gema} alt=""/><b>{demo.gems.toFixed(1)}</b></div><div><img src={moneda} alt=""/><b>{demo.gold}</b></div><button onClick={() => demo.ownedLands[0] ? openWorld(parseLandKey(demo.ownedLands[0])) : setPopup({ title: 'Aún no tienes Lands', body: 'Compra una Genesis Land para verla aquí.' })}>MIS LANDS ({demo.ownedLands.length})</button><button onClick={() => { const first = Object.keys(demo.rentals)[0]; if (!first) setPopup({ title: 'Aún no tienes alquileres', body: 'Alquila un slot para verlo aquí.' }); else { const [r,n,s] = first.split(':'); openWorld({ rarity: r as Rarity, number: Number(n) }, Number(s)) } }}>MIS ALQUILERES ({Object.keys(demo.rentals).length})</button></div></header>

    <div className="fv4-layout">
      {inventory}
      <main className="fv4-center">{screen === 'home' ? homeCenter : screen === 'market' ? renderMarketCenter() : renderWorldCenter()}</main>
      <div className="fv4-right">{screen === 'home' ? homeDetail : screen === 'market' ? renderMarketDetail() : renderWorldDetail()}</div>
      {landBar}
    </div>

    {toast && <div className="fv4-toast">{toast}</div>}
    {popup && <div className="fv4-modal-wrap"><div className="fv4-modal"><button onClick={() => setPopup(null)}>×</button><h2>{popup.title}</h2><p>{popup.body}</p>{popup.reward && <strong>{popup.reward}</strong>}<button className="fv4-modal-ok" onClick={() => setPopup(null)}>ENTENDIDO</button></div></div>}
  </div>
}
