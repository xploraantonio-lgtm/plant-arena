import { useEffect, useMemo, useState } from 'react'
import slotAsset from '../../assets/images/farming/slots/slot.webp'
import slotLegendary from '../../assets/images/farming/slots/slotL.webp'
import './FarmingSlotOverlay.css'

type RarityKey = 'common' | 'rare' | 'epic' | 'legendary'

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

function rarityFromLabel(label: string): RarityKey {
  if (label.includes('LEGENDARIA')) return 'legendary'
  if (label.includes('ÉPICA')) return 'epic'
  if (label.includes('RARA')) return 'rare'
  return 'common'
}

export default function FarmingSlotOverlay() {
  const [world, setWorld] = useState<OpenWorld | null>(null)
  const [page, setPage] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState(1)
  const [days, setDays] = useState<7 | 15 | 30>(7)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const header = target?.closest<HTMLElement>('.farming-preview-land-header')
      if (!header) return

      const enter = header.querySelector<HTMLElement>('.farming-preview-land-enter')
      if (enter?.textContent?.trim() !== 'ENTRAR') return

      const title = header.querySelector('strong')?.textContent?.trim() ?? ''
      const match = title.match(/GENESIS\s+(.+?)\s+#(\d+)/)
      if (!match) return

      const label = match[1]
      const rarity = rarityFromLabel(label)
      const owner = header.querySelector('.farming-preview-owner-pill')?.textContent?.trim() || 'Plant Arena'
      const priceText = header.querySelector('.is-price')?.textContent ?? ''
      const parsedPrice = Number(priceText.match(/[\d.]+/)?.[0] ?? 0)

      event.preventDefault()
      event.stopPropagation()
      setWorld({
        rarity,
        label,
        landNumber: Number(match[2]),
        owner: owner.replace('Propietario:', '').trim(),
        slots: META[rarity].slots,
        pricePerDay: parsedPrice || ({ common: 0.5, rare: 0.8, epic: 1.2, legendary: 2 } as const)[rarity],
      })
      setPage(0)
      setSelectedSlot(1)
      setDays(7)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const pageCount = world ? Math.ceil(world.slots / 4) : 1
  const slots = useMemo(() => {
    if (!world) return []
    return Array.from({ length: 4 }, (_, index) => page * 4 + index + 1).filter((slot) => slot <= world.slots)
  }, [page, world])

  if (!world) return null

  const total = world.pricePerDay * days
  const slotImage = world.rarity === 'legendary' ? slotLegendary : slotAsset

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(0, Math.min(pageCount - 1, nextPage))
    setPage(safePage)
    setSelectedSlot(Math.min(world.slots, safePage * 4 + 1))
  }

  return (
    <div className="farming-world-overlay" role="dialog" aria-modal="true" aria-label={`Slots de Genesis ${world.label}`}>
      <section className={`farming-world-shell farming-world-shell--${world.rarity}`}>
        <header className="farming-world-head">
          <button type="button" className="farming-world-back" onClick={() => setWorld(null)}>← MUNDOS</button>
          <div className="farming-world-heading">
            <strong>GENESIS {world.label} #{String(world.landNumber).padStart(2, '0')}</strong>
            <small>{world.owner === 'Plant Arena' ? 'Administrada por Plant Arena' : `Propietario: ${world.owner}`} · {world.slots} slots</small>
          </div>
          <div className="farming-world-benefit">★ {META[world.rarity].benefit}</div>
        </header>

        <div className="farming-world-body">
          <div className="farming-world-slots">
            {slots.map((slotNumber) => {
              const isSelected = selectedSlot === slotNumber
              const occupied = slotNumber === 2 && page === 0
              const mine = slotNumber === 3 && page === 0
              return (
                <button
                  type="button"
                  key={slotNumber}
                  className={`farming-slot-card ${isSelected ? 'is-selected' : ''} ${world.rarity === 'legendary' ? 'is-legendary' : ''}`}
                  onClick={() => setSelectedSlot(slotNumber)}
                >
                  <div className="farming-slot-art">
                    <img src={slotImage} alt={`Slot ${slotNumber}`} />
                    <span className="farming-slot-socket farming-slot-socket--left">💧</span>
                    <span className="farming-slot-socket farming-slot-socket--right">🪹</span>
                  </div>
                  <div className="farming-slot-copy">
                    <div className="farming-slot-title-row">
                      <strong>SLOT #{String(slotNumber).padStart(2, '0')}</strong>
                      <span className={`farming-slot-status ${mine ? 'mine' : occupied ? 'occupied' : 'free'}`}>
                        {mine ? 'TU ALQUILER' : occupied ? 'ALQUILADO' : 'DISPONIBLE'}
                      </span>
                    </div>
                    <small>{mine ? 'Contrato demo activo' : occupied ? 'Ocupado por otro jugador' : 'Listo para alquilar y plantar'}</small>
                    <div className="farming-slot-mini-meta">
                      <span>{world.pricePerDay} 💎 / día</span>
                      <span>{world.owner}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <aside className="farming-world-detail">
            <div className="farming-world-detail-kicker">SLOT SELECCIONADO</div>
            <h2>Slot #{String(selectedSlot).padStart(2, '0')}</h2>
            <dl>
              <div><dt>Land</dt><dd>{world.label}</dd></div>
              <div><dt>Propietario</dt><dd>{world.owner}</dd></div>
              <div><dt>Precio base</dt><dd>{world.pricePerDay} 💎/día</dd></div>
              <div><dt>Estado</dt><dd>Disponible</dd></div>
            </dl>

            <div className="farming-rent-title">DURACIÓN DEL ALQUILER</div>
            <div className="farming-rent-options">
              {([7, 15, 30] as const).map((value) => (
                <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => setDays(value)}>
                  <strong>{value} días</strong>
                  <small>{value === 7 ? 'Corto' : value === 15 ? 'Medio' : 'Largo'}</small>
                  <b>{(world.pricePerDay * value).toFixed(1)} 💎</b>
                </button>
              ))}
            </div>

            <div className="farming-world-item-note">Los laterales del slot quedan libres para agua, espantapájaros, cuervos y futuros efectos.</div>
            <button type="button" className="farming-world-rent-cta" onClick={() => alert(`Preview: alquilar Slot #${selectedSlot} por ${days} días · ${total.toFixed(1)} Gems`)}>
              ALQUILAR · {total.toFixed(1)} 💎
            </button>
          </aside>
        </div>

        <footer className="farming-world-pager">
          <button type="button" disabled={page === 0} onClick={() => goToPage(page - 1)}>‹</button>
          <div>{Array.from({ length: pageCount }, (_, index) => <span key={index} className={index === page ? 'is-active' : ''} />)}</div>
          <b>{page + 1} / {pageCount}</b>
          <button type="button" disabled={page === pageCount - 1} onClick={() => goToPage(page + 1)}>›</button>
        </footer>
      </section>
    </div>
  )
}
