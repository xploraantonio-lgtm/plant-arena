import { useState, useMemo } from 'react'
import { soundManager } from '../../utils/audioManager'
import { BATTLE_PASS_LEVELS, type PassLevel } from '../../utils/battlePassManager'
import './BattlePass.css'
import { VIP_PASS_PRECIO_GEMAS } from '../../utils/gameConstants'

interface BattlePassProps {
  userElo: number
  hasVipPass: boolean
  claimedVipLevels: number[]
  onBuyVipPass: () => void
  onClaimReward: (level: PassLevel) => void
  onClaimAllRewards?: (levels: PassLevel[]) => void
}

export default function BattlePass({
  userElo,
  hasVipPass,
  claimedVipLevels,
  onBuyVipPass,
  onClaimReward,
  onClaimAllRewards,
}: BattlePassProps) {
  // Determine highest reached level and next target
  const highestLevelReached = BATTLE_PASS_LEVELS.filter((l) => userElo >= l.requiredElo).length
  const nextLevel = BATTLE_PASS_LEVELS.find((l) => userElo < l.requiredElo)

  // List of all levels currently ready to be claimed
  const claimableLevels = useMemo(() => {
    return hasVipPass
      ? BATTLE_PASS_LEVELS.filter(
          (l) => userElo >= l.requiredElo && !claimedVipLevels.includes(l.level)
        )
      : []
  }, [hasVipPass, userElo, claimedVipLevels])

  // Default selected level: first ready level, or current level, or level 1
  const [selectedLevelNum, setSelectedLevelNum] = useState<number>(() => {
    if (claimableLevels.length > 0) return claimableLevels[0].level
    if (highestLevelReached > 0) return Math.min(20, highestLevelReached)
    return 1
  })

  const selectedPassLvl =
    BATTLE_PASS_LEVELS.find((l) => l.level === selectedLevelNum) || BATTLE_PASS_LEVELS[0]

  const isSelectedUnlocked = userElo >= selectedPassLvl.requiredElo
  const isSelectedClaimed = claimedVipLevels.includes(selectedPassLvl.level)
  const isSelectedReady = hasVipPass && isSelectedUnlocked && !isSelectedClaimed
  const isSelectedNeedsVip = !hasVipPass && isSelectedUnlocked

  const handleClaimAll = () => {
    if (claimableLevels.length === 0) return
    soundManager.playSound('plantation', 1)
    if (onClaimAllRewards) {
      onClaimAllRewards(claimableLevels)
    } else {
      claimableLevels.forEach((lvl) => onClaimReward(lvl))
    }
  }

  return (
    <div className="battle-pass-container">
      {/* Top Banner Status */}
      <div className="battle-pass-banner">
        <div className="battle-pass-banner__info">
          <div className="battle-pass-banner__season-badge">
            <span>🔥 TEMPORADA 1: REBELIÓN BOTÁNICA</span>
          </div>
          <h2 className="battle-pass-banner__title">
            PASE DE TEMPORADA VIP — NIVEL {highestLevelReached}/20
          </h2>
          <p className="battle-pass-banner__desc">
            {nextLevel
              ? `🏆 Tienes ${userElo} Copas. Alcanza ${nextLevel.requiredElo} Copas para desbloquear el Nivel ${nextLevel.level}.`
              : `🏆 ¡HAS ALCANZADO EL NIVEL MÁXIMO 20 (4,000+ COPAS)!`}
          </p>
        </div>

        <div className="battle-pass-banner__actions">
          {claimableLevels.length > 1 && (
            <button
              type="button"
              className="battle-pass-claim-all-btn"
              onClick={handleClaimAll}
            >
              ✨ RECLAMAR TODO ({claimableLevels.length})
            </button>
          )}

          {hasVipPass ? (
            <div className="battle-pass-vip-badge">
              <span className="battle-pass-vip-crown">👑</span>
              <span>PASE VIP ACTIVADO ✓</span>
            </div>
          ) : (
            <button className="battle-pass-buy-btn" type="button" onClick={onBuyVipPass}>
              👑 ACTIVAR PASE VIP ({VIP_PASS_PRECIO_GEMAS} 💎)
            </button>
          )}
        </div>
      </div>

      {/* DUAL-PANEL SHOWCASE GAMING LAYOUT */}
      <div className="battle-pass-showcase-layout">
        {/* LEFT PANEL: 20 LEVEL SELECTOR GRID */}
        <div className="pass-selector-panel">
          <div className="pass-selector-header">
            <span className="pass-selector-title">🛣️ CAMINO DE RECOMPENSAS (20 NIVELES)</span>
            <span className="pass-selector-sub">Toca un nivel para inspeccionar su premio</span>
          </div>

          <div className="pass-grid-selector">
            {BATTLE_PASS_LEVELS.map((passLvl) => {
              const isUnlocked = userElo >= passLvl.requiredElo
              const isClaimed = claimedVipLevels.includes(passLvl.level)
              const isReady = hasVipPass && isUnlocked && !isClaimed
              const isSelected = passLvl.level === selectedLevelNum

              let stateClass = 'pass-grid-node--locked'
              if (isClaimed) stateClass = 'pass-grid-node--claimed'
              else if (isReady) stateClass = 'pass-grid-node--ready'
              else if (isUnlocked) stateClass = 'pass-grid-node--unlocked'

              return (
                <button
                  key={passLvl.level}
                  type="button"
                  className={`pass-grid-node ${stateClass} ${
                    isSelected ? 'pass-grid-node--selected' : ''
                  }`}
                  onClick={() => {
                    soundManager.playSound('plantation', 0.3)
                    setSelectedLevelNum(passLvl.level)
                  }}
                >
                  <div className="pass-grid-node__top">
                    <span className="pass-grid-node__lvl">LVL {passLvl.level}</span>
                    <span className="pass-grid-node__status">
                      {isClaimed ? '✅' : isReady ? '✨' : !isUnlocked ? '🔒' : '👑'}
                    </span>
                  </div>

                  <img
                    src={passLvl.reward.icon}
                    alt={passLvl.reward.label}
                    className="pass-grid-node__icon"
                  />

                  <span className="pass-grid-node__elo">{passLvl.requiredElo} 🏆</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* RIGHT PANEL: 3D GLOWING PEDESTAL SHOWCASE */}
        <div className="pass-pedestal-showcase">
          <div className="pass-pedestal-header">
            <span className="pass-pedestal-tier-badge">
              🏆 NIVEL {selectedPassLvl.level} — {selectedPassLvl.requiredElo} COPAS
            </span>
            <h3 className="pass-pedestal-title">{selectedPassLvl.reward.label}</h3>
            <span className="pass-pedestal-subtitle">Recompensa Exclusiva del Pase de Temporada</span>
          </div>

          {/* Glowing Pedestal & Floating 3D Reward */}
          <div className="pass-pedestal-stage">
            <div className="pass-pedestal-light-beams" />
            <div className="pass-pedestal-halo" />

            <div className="pass-pedestal-floating-item">
              <img
                src={selectedPassLvl.reward.icon}
                alt={selectedPassLvl.reward.label}
                className={`pass-pedestal-img ${
                  isSelectedReady ? 'pass-pedestal-img--ready' : isSelectedClaimed ? 'pass-pedestal-img--claimed' : ''
                }`}
              />
            </div>

            {/* 3D Pedestal Base */}
            <div className="pass-pedestal-base">
              <div className="pass-pedestal-base-top" />
              <div className="pass-pedestal-base-body" />
            </div>
          </div>

          {/* Action Button Section */}
          <div className="pass-pedestal-action-box">
            {isSelectedClaimed ? (
              <div className="pass-pedestal-status-btn pass-pedestal-status-btn--claimed">
                ✅ RECOMPENSA RECLAMADA
              </div>
            ) : isSelectedReady ? (
              <button
                type="button"
                className="pass-pedestal-claim-btn"
                onClick={() => {
                  soundManager.playSound('plantation', 0.9)
                  onClaimReward(selectedPassLvl)
                }}
              >
                ✨ RECLAMAR RECOMPENSA
              </button>
            ) : isSelectedNeedsVip ? (
              <button
                type="button"
                className="pass-pedestal-vip-btn"
                onClick={onBuyVipPass}
              >
                👑 ACTIVAR PASE VIP ({VIP_PASS_PRECIO_GEMAS} 💎)
              </button>
            ) : (
              <div className="pass-pedestal-status-btn pass-pedestal-status-btn--locked">
                🔒 REQUIERE {selectedPassLvl.requiredElo} COPAS (TIENES {userElo})
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
