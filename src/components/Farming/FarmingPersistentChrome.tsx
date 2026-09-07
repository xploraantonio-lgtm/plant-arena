import { useEffect, useState } from 'react'
import landCommon from '../../assets/images/farming/lands/common.webp'
import landRare from '../../assets/images/farming/lands/rare.webp'
import landEpic from '../../assets/images/farming/lands/epic.webp'
import landLegendary from '../../assets/images/farming/lands/legendary.webp'
import { FARMING_ITEM_DEFINITIONS } from '../../utils/pvpRewardManager'
import './FarmingPersistentChrome.css'

type DemoSnapshot = {
  seeds: number
  water: number
  fertilizer: number
  pesticide: number
}

const STORAGE_KEY = 'plant-arena-farming-flow-v3'
const FALLBACK: DemoSnapshot = { seeds: 2, water: 12, fertilizer: 4, pesticide: 2 }

const LAND_INFO = [
  { label: 'COMÚN', slots: 8, image: landCommon },
  { label: 'RARA', slots: 12, image: landRare },
  { label: 'ÉPICA', slots: 16, image: landEpic },
  { label: 'LEGENDARIA', slots: 20, image: landLegendary },
]

function readSnapshot(): DemoSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return FALLBACK
    const parsed = JSON.parse(raw) as Partial<DemoSnapshot>
    return {
      seeds: typeof parsed.seeds === 'number' ? parsed.seeds : FALLBACK.seeds,
      water: typeof parsed.water === 'number' ? parsed.water : FALLBACK.water,
      fertilizer: typeof parsed.fertilizer === 'number' ? parsed.fertilizer : FALLBACK.fertilizer,
      pesticide: typeof parsed.pesticide === 'number' ? parsed.pesticide : FALLBACK.pesticide,
    }
  } catch {
    return FALLBACK
  }
}

export default function FarmingPersistentChrome() {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>(() => readSnapshot())

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot())
    sync()
    const id = window.setInterval(sync, 250)
    window.addEventListener('storage', sync)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return (
    <>
      <aside className="ff-persistent-inventory" aria-label="Inventario de Farming">
        <h3>🎒 INVENTARIO</h3>
        <div className="ff-persistent-item ff-persistent-item--seed">
          <span className="ff-persistent-seed">🌰</span>
          <div><strong>Semillas</strong><small>Misteriosas</small></div>
          <b>{snapshot.seeds}</b>
        </div>
        <div className="ff-persistent-item">
          <img src={FARMING_ITEM_DEFINITIONS.water.icon} alt="Agua" />
          <div><strong>Agua</strong><small>Riego</small></div>
          <b>{snapshot.water}</b>
        </div>
        <div className="ff-persistent-item">
          <img src={FARMING_ITEM_DEFINITIONS.fertilizer.icon} alt="Fertilizante" />
          <div><strong>Fertilizante</strong><small>Crecimiento</small></div>
          <b>{snapshot.fertilizer}</b>
        </div>
        <div className="ff-persistent-item">
          <img src={FARMING_ITEM_DEFINITIONS.pesticide.icon} alt="Pesticida" />
          <div><strong>Pesticida</strong><small>Ayuda social</small></div>
          <b>{snapshot.pesticide}</b>
        </div>
        <div className="ff-persistent-item">
          <img src={FARMING_ITEM_DEFINITIONS.shovel_fragment.icon} alt="Fragmento de pala" />
          <div><strong>Frag. pala</strong><small>Crafting</small></div>
          <b>6</b>
        </div>
        <div className="ff-persistent-item">
          <img src={FARMING_ITEM_DEFINITIONS.scarecrow_fragment.icon} alt="Fragmento de espantapájaros" />
          <div><strong>Frag. espant.</strong><small>Crafting</small></div>
          <b>30</b>
        </div>
      </aside>

      <footer className="ff-persistent-landbar" aria-label="Información de Genesis Lands">
        {LAND_INFO.map((land) => (
          <div className="ff-persistent-land" key={land.label}>
            <img src={land.image} alt={`Land ${land.label}`} />
            <div><strong>{land.label}</strong><small>{land.slots} slots por Land</small></div>
          </div>
        ))}
      </footer>
    </>
  )
}
