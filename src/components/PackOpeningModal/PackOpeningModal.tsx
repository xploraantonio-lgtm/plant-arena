import { useEffect } from 'react'
import type { PackDropResult } from '../../utils/packDropManager'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { soundManager } from '../../utils/audioManager'
import './PackOpeningModal.css'

interface PackOpeningModalProps {
  result: PackDropResult | PackDropResult[]
  onClose: () => void
  onOpenAnother?: () => void
  hasMorePacks?: boolean
}

export default function PackOpeningModal({
  result,
  onClose,
  onOpenAnother,
  hasMorePacks = false,
}: PackOpeningModalProps) {
  useEffect(() => {
    soundManager.playSound('plantation', 1.0)
  }, [])

  const isMulti = Array.isArray(result)
  const resultsList: PackDropResult[] = isMulti ? result : [result]

  if (resultsList.length === 0) return null

  if (!isMulti) {
    const single = resultsList[0]
    const config = PLANT_CONFIGS[single.plantId]
    if (!config) return null

    return (
      <div className="pack-reveal-overlay">
        <div className="pack-reveal-card">
          <div className="pack-reveal-card__rays" />

          <div className="pack-reveal-card__header">
            <span
              className="pack-reveal-card__rarity"
              style={{
                backgroundColor: `${single.rarityColor}33`,
                borderColor: single.rarityColor,
                color: single.rarityColor,
                border: `1px solid ${single.rarityColor}`,
              }}
            >
              ⭐ PLANTA {single.rarityLabel} ⭐
            </span>

            {single.isNew ? (
              <div className="pack-reveal-card__new-tag">
                ✨ ¡NUEVA PLANTA DESBLOQUEADA EN MI JARDÍN!
              </div>
            ) : (
              <div className="pack-reveal-card__new-tag" style={{ borderColor: '#60a5fa', color: '#60a5fa' }}>
                🌱 +1 COPIA ALMACENADA (LISTO PARA FUSIÓN)
              </div>
            )}
          </div>

          <div className="pack-reveal-card__img-wrap">
            <img
              src={config.sprite || config.icon}
              alt={config.name}
              className="pack-reveal-card__sprite"
            />
          </div>

          <h2 className="pack-reveal-card__name">{config.name}</h2>
          <span className="pack-reveal-card__cat">
            {config.category === 'producer'
              ? '☀️ Productora de Soles'
              : config.category === 'ranged'
              ? '🏹 Atacante a Distancia'
              : config.category === 'defensive'
              ? '🛡️ Tanque Defensivo'
              : '🥊 Atacante Mele'}
          </span>

          <div className="pack-reveal-card__stats">
            <div className="pack-reveal-stat">
              <span className="pack-reveal-stat__label">COSTO</span>
              <span className="pack-reveal-stat__val">☀️ {config.cost}</span>
            </div>
            <div className="pack-reveal-stat">
              <span className="pack-reveal-stat__label">SALUD</span>
              <span className="pack-reveal-stat__val">❤️ {config.maxHp} HP</span>
            </div>
            <div className="pack-reveal-stat">
              <span className="pack-reveal-stat__label">DAÑO</span>
              <span className="pack-reveal-stat__val">
                ⚔️ {config.damage ?? (config.category === 'producer' ? '0' : 'Especial')}
              </span>
            </div>
          </div>

          <div className="pack-reveal-card__actions">
            {hasMorePacks && onOpenAnother && (
              <button
                type="button"
                className="pack-reveal-btn pack-reveal-btn--sec"
                onClick={onOpenAnother}
              >
                ✨ ABRIR OTRO SOBRE
              </button>
            )}

            <button
              type="button"
              className="pack-reveal-btn pack-reveal-btn--primary"
              onClick={onClose}
            >
              🎒 RECLAMAR Y GUARDAR EN MI JARDÍN
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Multi-Open Reveal Grid Modal
  const newCount = resultsList.filter((r) => r.isNew).length

  return (
    <div className="pack-reveal-overlay">
      <div className="pack-reveal-card pack-reveal-card--multi">
        <div className="pack-reveal-card__rays" />

        <div className="pack-reveal-card__header">
          <span className="pack-reveal-card__rarity" style={{ backgroundColor: '#fbbf2433', color: '#fbbf24', borderColor: '#fbbf24' }}>
            💥 ¡APERTURA MÚLTIPLE DE {resultsList.length} SOBRES! 💥
          </span>
          <div className="pack-reveal-card__new-tag">
            {newCount > 0
              ? `✨ ¡${newCount} NUEVAS PLANTAS DESBLOQUEADAS!`
              : `🌱 ${resultsList.length * 10} SEMILLAS RECOLECTADAS`}
          </div>
        </div>

        {/* Grid of opened rewards */}
        <div className="pack-reveal-multi-grid">
          {resultsList.map((drop, idx) => {
            const cfg = PLANT_CONFIGS[drop.plantId]
            if (!cfg) return null

            return (
              <div key={idx} className="pack-reveal-multi-item">
                <span
                  className="pack-reveal-multi-rarity"
                  style={{ color: drop.rarityColor, borderColor: drop.rarityColor }}
                >
                  {drop.rarityLabel}
                </span>
                <img src={cfg.icon} alt={cfg.name} className="pack-reveal-multi-img" />
                <span className="pack-reveal-multi-name">{cfg.name}</span>
                {drop.isNew ? (
                  <span className="pack-reveal-multi-new">✨ ¡NUEVA!</span>
                ) : (
                  <span className="pack-reveal-multi-dup">+10 Semillas</span>
                )}
              </div>
            )
          })}
        </div>

        <div className="pack-reveal-card__actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="pack-reveal-btn pack-reveal-btn--primary"
            onClick={onClose}
          >
            🎒 RECLAMAR TODOS LOS RECOMPENSAS ({resultsList.length})
          </button>
        </div>
      </div>
    </div>
  )
}
