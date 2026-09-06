import { useEffect, useMemo, useState } from 'react'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { FARMING_ITEM_DEFINITIONS, type PvpRewardDrop } from '../../utils/pvpRewardManager'
import { soundManager } from '../../utils/audioManager'
import './PvpRewardOpeningModal.css'

interface Props {
  drops: PvpRewardDrop[]
  onClose: () => void
}

function DropContent({ drop }: { drop: PvpRewardDrop }) {
  if (drop.type === 'plant') {
    const plant = PLANT_CONFIGS[drop.plantId]
    if (!plant) return null
    return (
      <>
        <span className={`pvp-drop-rarity pvp-drop-rarity--${drop.rarity}`}>
{drop.rarity === 'uncommon' ? 'POCO COMÚN' : 'COMÚN'}
        </span>
        <img className="pvp-drop-img" src={plant.icon} alt={plant.name} />
        <strong className="pvp-drop-name">{plant.name}</strong>
        <span className="pvp-drop-detail">{drop.isNew ? '✨ NUEVA PLANTA' : '🌱 +1 COPIA'}</span>
      </>
    )
  }

  if (drop.type === 'gold') {
    return (
      <>
        <span className="pvp-drop-rarity pvp-drop-rarity--gold">ORO</span>
        <img
className="pvp-drop-img"
src="/game-assets/farming/gold_coin.webp"
alt="Oro"
onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <strong className="pvp-drop-name">Monedas de Oro</strong>
        <span className="pvp-drop-quantity">+{drop.quantity.toLocaleString()}</span>
      </>
    )
  }

  const item = FARMING_ITEM_DEFINITIONS[drop.itemId]
  return (
    <>
      <span className="pvp-drop-rarity pvp-drop-rarity--resource">RECURSO FARMING</span>
      <div className="pvp-drop-img-wrap">
        <img
className="pvp-drop-img"
src={item.icon}
alt={item.label}
onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <span className="pvp-drop-fallback">{item.fallback}</span>
      </div>
      <strong className="pvp-drop-name">{item.label}</strong>
      <span className="pvp-drop-quantity">+{drop.quantity}</span>
    </>
  )
}

export default function PvpRewardOpeningModal({ drops, onClose }: Props) {
  const safeDrops = useMemo(() => drops.slice(0, 3), [drops])
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    soundManager.playSound('plantation', 1)
    setRevealed(0)
  }, [drops])

  useEffect(() => {
    if (revealed >= safeDrops.length) return
    const timer = window.setTimeout(() => {
      setRevealed((value) => Math.min(safeDrops.length, value + 1))
      soundManager.playSound('click', 0.55)
    }, revealed === 0 ? 650 : 850)
    return () => window.clearTimeout(timer)
  }, [revealed, safeDrops.length])

  if (safeDrops.length === 0) return null

  return (
    <div className="pvp-reward-overlay">
      <div className="pvp-reward-modal">
        <div className="pvp-reward-rays" />
        <div className="pvp-reward-header">
<span>⚔️ SOBRE PvP</span>
<h2>¡RECOMPENSAS DE VICTORIA!</h2>
<p>El servidor ya fijó tus premios. Revelando DROP por DROP…</p>
        </div>

        <div className="pvp-reward-grid">
{safeDrops.map((drop, index) => {
  const visible = index < revealed
  return (
    <div key={index} className={`pvp-drop-card ${visible ? 'pvp-drop-card--revealed' : 'pvp-drop-card--hidden'}`}>
      <span className="pvp-drop-index">DROP {index + 1}</span>
      {visible ? <DropContent drop={drop} /> : <span className="pvp-drop-question">?</span>}
    </div>
  )
})}
        </div>

        {revealed >= safeDrops.length ? (
<button type="button" className="pvp-reward-claim" onClick={onClose}>
  🎒 GUARDAR EN MI JARDÍN
</button>
        ) : (
<span className="pvp-reward-wait">✨ Revelando recompensa {revealed + 1} de {safeDrops.length}…</span>
        )}
      </div>
    </div>
  )
}
