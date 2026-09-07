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
import './FarmingFlowV3.css'

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

function landKey(land: Land) { return `${land.rarity}:${land.number}` }
function slotKey(land: Land, slot: number) { return `${landKey(land)}:${slot}` }
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

export default function FarmingFlowV3({ onClose }: { onClose: () => void }) {
  const [demo, setDemo] = useState<DemoState>(() => loadState())
  const [screen, setScreen] = useState<Screen>('home')
  const [marketMode, setMarketMode] = useState<MarketMode>('rent')
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
    return () => clearTimeout(id)
  }, [toast])

  const conf = RARITIES[rarity]
  const lands = useMemo(() => Array.from({ length: conf.count }, (_, i) => i + 1), [conf.count])
  const landPages = Math.ceil(conf.count / conf.perPage)
  const visibleLands = lands.slice(landPage * conf.perPage, (landPage + 1) * conf.perPage)

  const ownerFor = (land: Land) => demo.ownedLands.includes(landKey(land)) ? 'TÚ' : NPC_OWNERS[land.rarity]?.[land.number] ?? 'Plant Arena'
  const owned = (land: Land) => demo.ownedLands.includes(landKey(land))
  const worldConf = world ? RARITIES[world.rarity] : null
  const slotPages = worldConf ? Math.ceil(worldConf.slots / 4) : 1
  const visibleSlots = worldConf ? Array.from({ length: 4 }, (_, i) => slotPage * 4 + i + 1).filter((n) => n <= worldConf.slots) : []

  const openMarket = (mode: MarketMode) => {
    setMarketMode(mode); setRarity('common'); setLandPage(0); setSelectedLand(null); setScreen('market')
  }
  const openWorld = (land: Land) => {
    setWorld(land); setSelectedLand(land); setSlotPage(0); setSelectedSlot(1); setRentDays(7); setScreen('world')
  }
  const reset = () => {
    localStorage.removeItem(STORAGE_KEY)
    setDemo({ ...START })
    setScreen('home'); setSelectedLand(null); setWorld(null); setPopup({ title: 'Demo reiniciada', body: 'Vuelves a empezar sin Lands ni alquileres, con 2 semillas y recursos de prueba.' })
  }
  const buyLand = (land: Land) => {
    const c = RARITIES[land.rarity]
    const owner = ownerFor(land)
    if (owner !== 'Plant Arena') { setPopup({ title: 'Land no disponible', body: owner === 'TÚ' ? 'Esta Genesis Land ya te pertenece.' : `Esta Land pertenece a ${owner}. Puedes entrar a verla y ayudar en sus cultivos.` }); return }
    if (demo.gems < c.buy) { setPopup({ title: 'Gems insuficientes', body: `Necesitas ${c.buy} Gems para comprar esta Land.` }); return }
    setDemo((s) => ({ ...s, gems: s.gems - c.buy, ownedLands: [...s.ownedLands, landKey(land)] }))
    setPopup({ title: '¡Genesis Land comprada!', body: `${c.label} #${String(land.number).padStart(2, '0')} ahora es tuya. Sus slots pueden ser de uso personal o ponerse en alquiler.` })
  }
  const rentSlot = (land: Land, slot: number) => {
    const c = RARITIES[land.rarity]
    const key = slotKey(land, slot)
    const cost = c.rent * rentDays
    if (demo.gems < cost) { setPopup({ title: 'Gems insuficientes', body: `Necesitas ${cost.toFixed(1)} Gems para este alquiler.` }); return }
    setDemo((s) => ({ ...s, gems: Number((s.gems - cost).toFixed(1)), rentals: { ...s.rentals, [key]: { days: rentDays } } }))
    setPopup({ title: '¡Slot alquilado!', body: `Slot #${String(slot).padStart(2, '0')} por ${rentDays} días. Ahora puedes sembrar tus semillas aquí.` })
  }
  const plant = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    if (demo.seeds < 1) { setPopup({ title: 'Sin semillas', body: 'Ya no te quedan semillas de prueba. Reinicia la demo para volver a tener 2.' }); return }
    if (demo.crops[key]) { setPopup({ title: 'Slot ocupado', body: 'Ya tienes un cultivo activo en este slot.' }); return }
    setDemo((s) => ({ ...s, seeds: s.seeds - 1, crops: { ...s.crops, [key]: { water: 0, fertilizer: 0, crow: false } } }))
    setToast('🌰 Semilla plantada · necesita 5 riegos')
  }
  const waterOwn = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const crop = demo.crops[key]
    if (!crop) { setPopup({ title: 'Primero siembra', body: 'Este slot todavía no tiene una semilla plantada.' }); return }
    if (crop.water >= 5) { setPopup({ title: 'Riego completo', body: 'Este cultivo ya tiene sus 5/5 riegos.' }); return }
    if (demo.water < 1) { setPopup({ title: 'Sin agua', body: 'No te queda agua disponible para seguir regando.' }); return }
    const nextWater = crop.water + 1
    const crow = crop.crow || (nextWater === 3 && slot % 2 === 0)
    setDemo((s) => ({ ...s, water: s.water - 1, crops: { ...s.crops, [key]: { ...crop, water: nextWater, crow } } }))
    setWaterPulse(key); setTimeout(() => setWaterPulse(''), 450)
    setToast(`💧 Riego aplicado ${nextWater}/5${crow && !crop.crow ? ' · ¡apareció un cuervo!' : ''}`)
  }
  const fertilize = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const crop = demo.crops[key]
    if (!crop) { setPopup({ title: 'Primero siembra', body: 'Necesitas un cultivo activo para usar fertilizante.' }); return }
    if (crop.fertilizer >= 2) { setPopup({ title: 'Fertilización completa', body: 'Este cultivo ya tiene 2/2 aplicaciones de fertilizante.' }); return }
    if (demo.fertilizer < 1) { setPopup({ title: 'Sin fertilizante', body: 'No te queda fertilizante disponible.' }); return }
    const next = crop.fertilizer + 1
    setDemo((s) => ({ ...s, fertilizer: s.fertilizer - 1, crops: { ...s.crops, [key]: { ...crop, fertilizer: next } } }))
    setToast(`🌿 Fertilizante aplicado ${next}/2`)
  }
  const waterNpc = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const current = demo.npcWater[key] ?? npcBaseWater(slot)
    if (current >= 5) { setPopup({ title: 'Planta NPC hidratada', body: 'Este cultivo ya tiene el riego completo.' }); return }
    if (demo.water < 1) { setPopup({ title: 'Sin agua', body: 'Necesitas agua para ayudar a otros jugadores.' }); return }
    const next = current + 1
    setDemo((s) => ({ ...s, water: s.water - 1, gold: next === 5 ? s.gold + 20 : s.gold, npcWater: { ...s.npcWater, [key]: next } }))
    setWaterPulse(key); setTimeout(() => setWaterPulse(''), 450)
    if (next === 5) setPopup({ title: '¡Ayuda completada!', body: 'Terminaste de regar la planta de otro jugador.', reward: '+20 Gold · recompensa demo local' })
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
    setPopup({ title: '🐦‍⬛ ¡Cuervo capturado!', body: 'El cultivo queda libre del evento de cuervos.', reward: '+50 Gold · drop demo local' })
  }
  const toggleSlotMode = (land: Land, slot: number) => {
    const key = slotKey(land, slot)
    const current = demo.slotModes[key] ?? 'personal'
    const next = current === 'personal' ? 'listed' : 'personal'
    setDemo((s) => ({ ...s, slotModes: { ...s.slotModes, [key]: next } }))
    setToast(next === 'listed' ? '🏷️ Slot puesto en alquiler al precio fijo de la Land' : '🌱 Slot reservado para tu uso')
  }

  const renderDots = (value: number, max: number) => <span className="ff-dots">{Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? 'on' : ''} />)}</span>

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
    const mine = landIsMine || Boolean(rental)
    const status = landIsMine ? (listed ? 'EN ALQUILER' : 'TU LAND') : rental ? 'TU ALQUILER' : npc ? 'PLANTA NPC' : 'DISPONIBLE'
    const cropLabel = cropStage(crop)
    const art = world.rarity === 'legendary' ? slotLegendary : slotAsset
    return <button key={slot} type="button" className={`ff-slot ${selectedSlot === slot ? 'selected' : ''} ${mine ? 'mine' : ''} ${listed ? 'listed' : ''} ${npc ? 'npc' : ''} ${waterPulse === key ? 'water-pulse' : ''}`} onClick={() => setSelectedSlot(slot)}>
      <div className="ff-slot-art"><img src={art} alt={`Slot ${slot}`} />{crop && <span className="ff-crop">{crop.water < 2 ? '🌰' : crop.water < 5 ? '🌱' : '🌿'}</span>}{npc && <span className="ff-crop npc-crop">🌱</span>}{(crop?.crow || npcCrow) && <span className="ff-crow">🐦‍⬛</span>}</div>
      <div className="ff-slot-copy"><div className="ff-slot-title"><strong>SLOT #{String(slot).padStart(2, '0')}</strong><b>{cropLabel ?? status}</b></div><small>{listed ? `Precio fijo ${worldConf.rent} 💎/día` : npc ? `Propietario: ${ownerFor(world)} · ayuda disponible` : free ? 'Libre para alquilar' : rental ? `Contrato ${rental.days} días` : 'Slot para tu cultivo'}</small><div className="ff-progress"><span>💧 Agua {renderDots(crop ? crop.water : npc ? npcWater : 0, 5)}</span><span>🌿 Abono {renderDots(crop?.fertilizer ?? 0, 2)}</span></div></div>
    </button>
  }

  const selectedSlotInfo = () => {
    if (!world || !worldConf) return null
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
    return <aside className="ff-detail"><div className="ff-detail-kicker">INFORMACIÓN / ACCIONES</div><h2>SLOT #{String(selectedSlot).padStart(2, '0')}</h2><dl><div><dt>Land</dt><dd>{worldConf.label}</dd></div><div><dt>Propietario Land</dt><dd>{ownerFor(world)}</dd></div><div><dt>Precio base</dt><dd>{worldConf.rent} 💎/día</dd></div><div><dt>Tipo de slot</dt><dd>{landIsMine ? (listed ? 'En alquiler' : 'Uso propio') : rental ? 'Tu alquiler' : npc ? 'NPC' : 'Disponible'}</dd></div></dl>
      {landIsMine && <div className="ff-manage"><h3>GESTIÓN DEL SLOT</h3><button className={listed ? 'gold' : 'green'} onClick={() => toggleSlotMode(world, selectedSlot)}>{listed ? '🌱 USAR YO' : '🏷️ PONER EN ALQUILER'}</button><small>Tarifa fija actual: {worldConf.rent} 💎 / día</small></div>}
      {free && <><h3>DURACIÓN DEL ALQUILER</h3><div className="ff-rent-options">{([7,15,30] as const).map((d) => <button key={d} className={rentDays === d ? 'active' : ''} onClick={() => setRentDays(d)}><strong>{d} días</strong><span>{(worldConf.rent*d).toFixed(1)} 💎</span></button>)}</div><button className="ff-action gold" onClick={() => rentSlot(world, selectedSlot)}>🔑 ALQUILAR</button></>}
      {(landIsMine || rental) && !listed && <div className="ff-grow"><h3>GESTIÓN DE CULTIVO</h3>{!crop && <button className="ff-action seed" onClick={() => plant(world, selectedSlot)}>🌰 PLANTAR SEMILLA <span>{demo.seeds}</span></button>}{crop && <><div className="ff-meter"><b>Riego {crop.water}/5</b>{renderDots(crop.water,5)}</div><div className="ff-meter"><b>Fertilizante {crop.fertilizer}/2</b>{renderDots(crop.fertilizer,2)}</div><button className="ff-action blue" onClick={() => waterOwn(world, selectedSlot)}>💧 REGAR <span>{demo.water}</span></button><button className="ff-action green" onClick={() => fertilize(world, selectedSlot)}>🌿 USAR FERTILIZANTE <span>{demo.fertilizer}</span></button>{crop.crow && <button className="ff-action crow" onClick={() => captureCrow(world, selectedSlot, false)}>🐦‍⬛ CAPTURAR CUERVO</button>}</>}</div>}
      {npc && <div className="ff-grow"><h3>AYUDAR A OTRO JUGADOR</h3><div className="ff-meter"><b>Riego NPC {npcWater}/5</b>{renderDots(npcWater,5)}</div><button className="ff-action blue" onClick={() => waterNpc(world, selectedSlot)}>🚿 REGAR + AYUDA <span>{demo.water}</span></button>{npcCrow && <button className="ff-action crow" onClick={() => captureCrow(world, selectedSlot, true)}>🐦‍⬛ CAPTURAR CUERVO</button>}<small>Las recompensas de esta demo son solo locales.</small></div>}
    </aside>
  }

  return <div className="ff-screen">
    <header className="ff-top"><button className="ff-home" onClick={screen === 'home' ? onClose : () => setScreen('home')}>← {screen === 'home' ? 'INICIO' : 'FARMING'}</button><div className="ff-logo"><img src={logo} alt="Plant Arena" /><span>FARMING · DEMO LOCAL</span></div><div className="ff-wallets"><div><img src={gema} alt="" />{demo.gems.toFixed(1)}</div><div><img src={moneda} alt="" />{demo.gold}</div><button onClick={() => demo.ownedLands[0] ? openWorld({ rarity: demo.ownedLands[0].split(':')[0] as Rarity, number: Number(demo.ownedLands[0].split(':')[1]) }) : setPopup({title:'Aún no tienes Lands',body:'Compra una Genesis Land para verla aquí.'})}>MIS LANDS ({demo.ownedLands.length})</button><button onClick={() => { const first = Object.keys(demo.rentals)[0]; if (!first) setPopup({title:'Aún no tienes alquileres',body:'Alquila un slot para verlo aquí.'}); else { const [r,n,s] = first.split(':'); openWorld({rarity:r as Rarity,number:Number(n)}); setSelectedSlot(Number(s)); } }}>MIS ALQUILERES ({Object.keys(demo.rentals).length})</button></div></header>

    {screen === 'home' && <main className="ff-home-screen"><aside className="ff-inventory"><h3>🎒 INVENTARIO</h3><div><span>🌰 Semillas misteriosas</span><b>{demo.seeds}</b></div><div><span><img src={FARMING_ITEM_DEFINITIONS.water.icon} alt="" /> Agua</span><b>{demo.water}</b></div><div><span><img src={FARMING_ITEM_DEFINITIONS.fertilizer.icon} alt="" /> Fertilizante</span><b>{demo.fertilizer}</b></div><div><span><img src={FARMING_ITEM_DEFINITIONS.pesticide.icon} alt="" /> Pesticida</span><b>{demo.pesticide}</b></div></aside><section className="ff-start"><span className="ff-big-seed">🌱</span><h1>Tu granja comienza desde cero</h1><p>No tienes Lands ni alquileres. Puedes comprar, alquilar o entrar a Lands de NPC para ayudar aunque todavía no tengas nada.</p><div className="ff-start-actions"><button onClick={() => openMarket('rent')}>🤝 <b>ALQUILAR UN SLOT</b><small>Consigue un espacio para cultivar</small></button><button onClick={() => openMarket('buy')}>🏝️ <b>COMPRAR UNA LAND</b><small>Administra tus propios slots</small></button><button onClick={() => openMarket('help')}>💧 <b>EXPLORAR Y AYUDAR</b><small>Riega plantas NPC y captura cuervos</small></button></div></section><aside className="ff-help"><h3>🧪 PRUEBA LOCAL</h3><p>2 semillas, 12 aguas y 4 fertilizantes para recorrer todo el ciclo.</p><button onClick={reset}>REINICIAR DEMO</button></aside></main>}

    {screen === 'market' && <main className="ff-market"><section className="ff-market-main"><div className="ff-market-head"><div><h1>{marketMode === 'buy' ? 'Genesis Lands en venta' : marketMode === 'help' ? 'Explorar Lands y ayudar' : 'Buscar un slot'}</h1><p>{marketMode === 'buy' ? 'Compra directamente o entra primero a ver sus slots.' : 'Entra a cualquier Land para revisar slots, NPCs y cultivos.'}</p></div><button onClick={() => setScreen('home')}>← VOLVER</button></div><div className="ff-tabs">{(Object.keys(RARITIES) as Rarity[]).map((r) => <button key={r} className={rarity===r?'active':''} onClick={() => {setRarity(r);setLandPage(0);setSelectedLand(null)}}>{RARITIES[r].label}</button>)}</div><div className="ff-land-list">{visibleLands.map((n) => { const land={rarity,number:n}; const owner=ownerFor(land); const isMine=owned(land); return <article key={n} className={`ff-land ${selectedLand?.number===n?'selected':''} ${isMine?'mine':''}`} onClick={() => setSelectedLand(land)}><img src={conf.image} alt="" /><div className="ff-land-copy"><h2>GENESIS {conf.label} #{String(n).padStart(2,'0')}</h2><span className="ff-owner">{isMine?'TU LAND':owner==='Plant Arena'?'Plant Arena':`Propietario: ${owner}`}</span><p>{conf.description}</p><div className="ff-land-meta"><b>{conf.slots} slots</b><b>{conf.rent} 💎 / día</b>{marketMode==='buy' && <b>{owner==='Plant Arena'?`${conf.buy} 💎`:isMine?'YA ES TUYA':'NO EN VENTA'}</b>}</div></div><div className="ff-land-actions">{marketMode==='buy' ? owner==='Plant Arena' ? <><button className="gold" onClick={(e)=>{e.stopPropagation();buyLand(land)}}>COMPRAR</button><button className="blue" onClick={(e)=>{e.stopPropagation();openWorld(land)}}>ENTRAR</button></> : <button className="blue" onClick={(e)=>{e.stopPropagation();openWorld(land)}}>{isMine?'ENTRAR':'VER'}</button> : <button className="blue" onClick={(e)=>{e.stopPropagation();openWorld(land)}}>ENTRAR</button>}</div></article>})}</div><div className="ff-pager"><button disabled={landPage===0} onClick={()=>setLandPage(Math.max(0,landPage-1))}>‹</button><b>{landPage+1} / {landPages}</b><button disabled={landPage===landPages-1} onClick={()=>setLandPage(Math.min(landPages-1,landPage+1))}>›</button></div></section><aside className="ff-market-side">{selectedLand ? <><img src={RARITIES[selectedLand.rarity].image} alt="" /><h2>GENESIS {RARITIES[selectedLand.rarity].label} #{String(selectedLand.number).padStart(2,'0')}</h2><dl><div><dt>Propietario</dt><dd>{ownerFor(selectedLand)}</dd></div><div><dt>Slots</dt><dd>{RARITIES[selectedLand.rarity].slots}</dd></div><div><dt>Alquiler base</dt><dd>{RARITIES[selectedLand.rarity].rent} 💎/día</dd></div></dl>{marketMode==='buy' && ownerFor(selectedLand)==='Plant Arena' && <button className="ff-action gold" onClick={()=>buyLand(selectedLand)}>COMPRAR · {RARITIES[selectedLand.rarity].buy} 💎</button>}<button className="ff-action blue" onClick={()=>openWorld(selectedLand)}>{ownerFor(selectedLand)==='Plant Arena'?'ENTRAR · VER SLOTS':'VER SLOTS'}</button></> : <div className="ff-no-selection">Selecciona una Land para ver sus acciones.</div>}</aside></main>}

    {screen === 'world' && world && worldConf && <main className="ff-world"><div className="ff-world-head"><button onClick={()=>setScreen('market')}>← MUNDOS</button><div><h1>GENESIS {worldConf.label} #{String(world.number).padStart(2,'0')}</h1><p>{owned(world)?'TU LAND':`Propietario: ${ownerFor(world)}`} · {worldConf.slots} slots</p></div><div className="ff-world-badge">{owned(world)?'🌿 GESTIÓN DE TU LAND':'🤝 MUNDO COMPARTIDO'}</div></div><section className="ff-world-body"><div className="ff-slot-grid">{visibleSlots.map(renderSlot)}</div>{selectedSlotInfo()}</section><div className="ff-pager"><button disabled={slotPage===0} onClick={()=>{setSlotPage(Math.max(0,slotPage-1));setSelectedSlot(Math.max(1,(slotPage-1)*4+1))}}>‹</button><b>{slotPage+1} / {slotPages}</b><button disabled={slotPage===slotPages-1} onClick={()=>{const p=Math.min(slotPages-1,slotPage+1);setSlotPage(p);setSelectedSlot(p*4+1)}}>›</button></div></main>}

    {toast && <div className="ff-toast">{toast}</div>}
    {popup && <div className="ff-modal-wrap"><div className="ff-modal"><button className="ff-modal-x" onClick={()=>setPopup(null)}>×</button><h2>{popup.title}</h2><p>{popup.body}</p>{popup.reward && <strong>{popup.reward}</strong>}<button className="ff-modal-ok" onClick={()=>setPopup(null)}>ENTENDIDO</button></div></div>}
  </div>
}
