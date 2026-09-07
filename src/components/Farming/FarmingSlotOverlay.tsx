import { useEffect, useMemo, useState } from 'react'
import slotAsset from '../../assets/images/farming/slots/slot.webp'
import slotLegendary from '../../assets/images/farming/slots/slotL.webp'
import {
  farmingLandKey,
  farmingSlotKey,
  loadFarmingDemoState,
  resetFarmingDemoState,
  updateFarmingDemoState,
  type FarmingDemoRarity,
  type FarmingDemoState,
} from './farmingDemoStore'
import './FarmingSlotOverlay.css'
import './FarmingDemoFlow.css'

type RarityKey = FarmingDemoRarity

type OpenWorld = {
  rarity: RarityKey
  label: string
  landNumber: number
  owner: string
  slots: number
  pricePerDay: number
}

const META: Record<RarityKey, { slots: number; benefit: string }> = {
  common: { slots: 8, benefit: 'Terreno estable para comenzar a cultivar' },
  rare: { slots: 12, benefit: 'Más capacidad y relieve especial' },
  epic: { slots: 16, benefit: 'Land fértil con mayor capacidad de farming' },
  legendary: { slots: 20, benefit: 'Land mágica premium con 20 slots' },
}

function stageLabel(stage?: 'seeded' | 'watered' | 'fertilized') {
  if (stage === 'seeded') return 'SEMILLA PLANTADA'
  if (stage === 'watered') return 'REGADA'
  if (stage === 'fertilized') return 'CRECIENDO'
  return null
}

export default function FarmingSlotOverlay() {
  const [world, setWorld] = useState<OpenWorld | null>(null)
  const [page, setPage] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState(1)
  const [days, setDays] = useState<7 | 15 | 30>(7)
  const [demoState, setDemoState] = useState<FarmingDemoState>(() => loadFarmingDemoState())
  const [message, setMessage] = useState('')

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<OpenWorld>).detail
      if (!detail) return
      setWorld(detail)
      setPage(0)
      setSelectedSlot(1)
      setDays(7)
      setMessage('')
      setDemoState(loadFarmingDemoState())
    }
    const sync = () => setDemoState(loadFarmingDemoState())
    window.addEventListener('farming-open-world', open)
    window.addEventListener('farming-demo-updated', sync)
    return () => {
      window.removeEventListener('farming-open-world', open)
      window.removeEventListener('farming-demo-updated', sync)
    }
  }, [])

  const pageCount = world ? Math.ceil(world.slots / 4) : 1
  const slots = useMemo(() => {
    if (!world) return []
    return Array.from({ length: 4 }, (_, index) => page * 4 + index + 1).filter((slot) => slot <= world.slots)
  }, [page, world])

  if (!world) return null

  const landKey = farmingLandKey(world.rarity, world.landNumber)
  const landOwned = demoState.ownedLands.includes(landKey)
  const selectedSlotKey = farmingSlotKey(landKey, selectedSlot)
  const selectedRental = demoState.rentals[selectedSlotKey]
  const selectedCrop = demoState.crops[selectedSlotKey]
  const demoOccupied = !landOwned && selectedSlot === 2 && !selectedRental
  const canUseSelectedSlot = landOwned || Boolean(selectedRental)
  const total = world.pricePerDay * days
  const slotImage = world.rarity === 'legendary' ? slotLegendary : slotAsset

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(0, Math.min(pageCount - 1, nextPage))
    setPage(safePage)
    setSelectedSlot(Math.min(world.slots, safePage * 4 + 1))
    setMessage('')
  }

  const rentSelected = () => {
    if (demoOccupied) { setMessage('Ese slot está ocupado por otro jugador en esta demo.'); return }
    if (selectedRental || landOwned) { setMessage(landOwned ? 'Este slot pertenece a tu Land.' : 'Este slot ya está alquilado por ti.'); return }
    if (demoState.gems < total) { setMessage('No tienes Gems suficientes para este alquiler.'); return }

    const next = updateFarmingDemoState((state) => ({
      ...state,
      gems: Number((state.gems - total).toFixed(1)),
      rentals: {
        ...state.rentals,
        [selectedSlotKey]: { landKey, slot: selectedSlot, days, expiresAt: Date.now() + days * 24 * 60 * 60 * 1000 },
      },
    }))
    setDemoState(next)
    setMessage(`Slot #${String(selectedSlot).padStart(2, '0')} alquilado por ${days} días.`)
  }

  const plantSeed = () => {
    if (!canUseSelectedSlot) { setMessage('Primero alquila este slot o entra a una Land que sea tuya.'); return }
    if (selectedCrop) { setMessage('Este slot ya tiene un cultivo en curso.'); return }
    if (demoState.seeds < 1) { setMessage('Ya no te quedan semillas de prueba.'); return }

    const next = updateFarmingDemoState((state) => ({
      ...state,
      seeds: state.seeds - 1,
      crops: {
        ...state.crops,
        [selectedSlotKey]: { landKey, slot: selectedSlot, stage: 'seeded', plantedAt: Date.now() },
      },
    }))
    setDemoState(next)
    setMessage('Semilla misteriosa plantada. Ahora necesita agua.')
  }

  const waterCrop = () => {
    if (!selectedCrop || selectedCrop.stage !== 'seeded') { setMessage('Primero planta una semilla en este slot.'); return }
    if (demoState.water < 1) { setMessage('No te queda agua.'); return }

    const next = updateFarmingDemoState((state) => {
      const current = state.crops[selectedSlotKey]
      if (!current) return state
      return { ...state, water: state.water - 1, crops: { ...state.crops, [selectedSlotKey]: { ...current, stage: 'watered' } } }
    })
    setDemoState(next)
    setMessage('Cultivo regado. Ahora puedes usar fertilizante.')
  }

  const fertilizeCrop = () => {
    if (!selectedCrop || selectedCrop.stage !== 'watered') { setMessage('El cultivo debe estar regado antes de fertilizar.'); return }
    if (demoState.fertilizer < 1) { setMessage('No te queda fertilizante.'); return }

    const next = updateFarmingDemoState((state) => {
      const current = state.crops[selectedSlotKey]
      if (!current) return state
      return { ...state, fertilizer: state.fertilizer - 1, crops: { ...state.crops, [selectedSlotKey]: { ...current, stage: 'fertilized' } } }
    })
    setDemoState(next)
    setMessage('Fertilizante aplicado. El cultivo queda en estado CRECIENDO para la prueba.')
  }

  const resetDemo = () => {
    const next = resetFarmingDemoState()
    setDemoState(next)
    setMessage('Demo reiniciada: 2 semillas, 2500 Gems, 12 aguas y 4 fertilizantes.')
  }

  const selectedStatus = landOwned ? selectedCrop ? stageLabel(selectedCrop.stage) ?? 'TU LAND' : 'TU LAND' : selectedRental ? selectedCrop ? stageLabel(selectedCrop.stage) ?? 'TU ALQUILER' : 'TU ALQUILER' : demoOccupied ? 'ALQUILADO' : 'DISPONIBLE'

  return (
    <div className="farming-world-overlay" role="dialog" aria-modal="true" aria-label={`Slots de Genesis ${world.label}`}>
      <section className={`farming-world-shell farming-world-shell--${world.rarity}`}>
        <header className="farming-world-head">
          <button type="button" className="farming-world-back" onClick={() => setWorld(null)}>← MUNDOS</button>
          <div className="farming-world-heading"><strong>GENESIS {world.label} #{String(world.landNumber).padStart(2, '0')}</strong><small>{landOwned ? 'TU LAND' : world.owner === 'Plant Arena' ? 'Administrada por Plant Arena' : `Propietario: ${world.owner}`} · {world.slots} slots</small></div>
          <div className="farming-world-head-right"><div className="farming-world-benefit">★ {META[world.rarity].benefit}</div><div className="farming-world-demo-wallet">💎 {demoState.gems.toFixed(1)} · 🌰 {demoState.seeds} · 💧 {demoState.water} · 🌿 {demoState.fertilizer}</div></div>
        </header>

        <div className="farming-world-body">
          <div className="farming-world-slots">
            {slots.map((slotNumber) => {
              const slotKey = farmingSlotKey(landKey, slotNumber)
              const rental = demoState.rentals[slotKey]
              const crop = demoState.crops[slotKey]
              const isSelected = selectedSlot === slotNumber
              const occupied = !landOwned && slotNumber === 2 && !rental
              const mine = landOwned || Boolean(rental)
              const cropStage = stageLabel(crop?.stage)
              return (
                <button type="button" key={slotNumber} className={`farming-slot-card ${isSelected ? 'is-selected' : ''} ${world.rarity === 'legendary' ? 'is-legendary' : ''} ${mine ? 'is-mine' : ''}`} onClick={() => { setSelectedSlot(slotNumber); setMessage('') }}>
                  <div className="farming-slot-art"><img src={slotImage} alt={`Slot ${slotNumber}`} />{crop && <span className={`farming-slot-crop farming-slot-crop--${crop.stage}`} aria-label={cropStage ?? 'Cultivo'}>{crop.stage === 'seeded' ? '🌰' : crop.stage === 'watered' ? '🌱' : '🌿'}</span>}<span className={`farming-slot-socket farming-slot-socket--left ${crop?.stage === 'watered' || crop?.stage === 'fertilized' ? 'is-active' : ''}`}>💧</span><span className={`farming-slot-socket farming-slot-socket--right ${crop?.stage === 'fertilized' ? 'is-active' : ''}`}>🌿</span></div>
                  <div className="farming-slot-copy"><div className="farming-slot-title-row"><strong>SLOT #{String(slotNumber).padStart(2, '0')}</strong><span className={`farming-slot-status ${mine ? 'mine' : occupied ? 'occupied' : 'free'} ${crop ? 'crop' : ''}`}>{cropStage ?? (landOwned ? 'TU LAND' : rental ? 'TU ALQUILER' : occupied ? 'ALQUILADO' : 'DISPONIBLE')}</span></div><small>{cropStage ? crop?.stage === 'seeded' ? 'La semilla necesita agua' : crop?.stage === 'watered' ? 'Lista para fertilizante' : 'Cultivo creciendo' : landOwned ? 'Slot disponible para tu propio cultivo' : rental ? `Tu contrato de ${rental.days} días está activo` : occupied ? 'Ocupado por otro jugador' : 'Listo para alquilar'}</small><div className="farming-slot-mini-meta"><span>{landOwned ? 'PROPIEDAD' : `${world.pricePerDay} 💎 / día`}</span><span>{landOwned ? 'TÚ' : world.owner}</span></div></div>
                </button>
              )
            })}
          </div>

          <aside className="farming-world-detail">
            <div className="farming-world-detail-kicker">SLOT SELECCIONADO</div><h2>Slot #{String(selectedSlot).padStart(2, '0')}</h2>
            <dl><div><dt>Land</dt><dd>{world.label}</dd></div><div><dt>Propietario</dt><dd>{landOwned ? 'TÚ' : world.owner}</dd></div><div><dt>Precio base</dt><dd>{landOwned ? 'Propio' : `${world.pricePerDay} 💎/día`}</dd></div><div><dt>Estado</dt><dd>{selectedStatus}</dd></div></dl>

            {!canUseSelectedSlot && !demoOccupied && <><div className="farming-rent-title">DURACIÓN DEL ALQUILER</div><div className="farming-rent-options">{([7, 15, 30] as const).map((value) => <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => setDays(value)}><strong>{value} días</strong><small>{value === 7 ? 'Corto' : value === 15 ? 'Medio' : 'Largo'}</small><b>{(world.pricePerDay * value).toFixed(1)} 💎</b></button>)}</div><button type="button" className="farming-world-rent-cta" onClick={rentSelected}>ALQUILAR · {total.toFixed(1)} 💎</button></>}

            {demoOccupied && <div className="farming-world-occupied-note">Este slot está ocupado por otro jugador para que puedas ver claramente la diferencia visual.</div>}

            {canUseSelectedSlot && <div className="farming-grow-actions"><div className="farming-rent-title">ACCIONES DE CULTIVO</div>{!selectedCrop && <button type="button" className="farming-grow-btn farming-grow-btn--seed" onClick={plantSeed}>🌰 PLANTAR SEMILLA <span>{demoState.seeds} disponibles</span></button>}{selectedCrop?.stage === 'seeded' && <button type="button" className="farming-grow-btn farming-grow-btn--water" onClick={waterCrop}>💧 REGAR <span>{demoState.water} disponibles</span></button>}{selectedCrop?.stage === 'watered' && <button type="button" className="farming-grow-btn farming-grow-btn--fertilizer" onClick={fertilizeCrop}>🌿 USAR FERTILIZANTE <span>{demoState.fertilizer} disponibles</span></button>}{selectedCrop?.stage === 'fertilized' && <div className="farming-grow-complete">🌱 <strong>CRECIENDO</strong><small>Secuencia local completada: sembrar → regar → fertilizar.</small></div>}</div>}

            <div className="farming-world-item-note">Demo local persistente en este navegador. No crea contratos reales, no descuenta Gems del backend y no entrega recompensas.</div>
            {message && <div className="farming-world-message">{message}</div>}
            <button type="button" className="farming-world-reset" onClick={resetDemo}>REINICIAR DEMO LOCAL</button>
          </aside>
        </div>

        <footer className="farming-world-pager"><button type="button" disabled={page === 0} onClick={() => goToPage(page - 1)}>‹</button><div>{Array.from({ length: pageCount }, (_, index) => <span key={index} className={index === page ? 'is-active' : ''} />)}</div><b>{page + 1} / {pageCount}</b><button type="button" disabled={page === pageCount - 1} onClick={() => goToPage(page + 1)}>›</button></footer>
      </section>
    </div>
  )
}
