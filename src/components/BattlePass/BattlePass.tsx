import { soundManager } from '../../utils/audioManager'
import { BATTLE_PASS_LEVELS, type PassLevel } from '../../utils/battlePassManager'
import './BattlePass.css'

interface BattlePassProps {
  userElo: number
  hasVipPass: boolean
  claimedVipLevels: number[]
  onBuyVipPass: () => void
  onClaimReward: (level: PassLevel) => void
}

export default function BattlePass({
  userElo,
  hasVipPass,
  claimedVipLevels,
  onBuyVipPass,
  onClaimReward,
}: BattlePassProps) {
  // Determine highest reached level
  const highestLevelReached = BATTLE_PASS_LEVELS.filter((l) => userElo >= l.requiredElo).length
  const nextLevel = BATTLE_PASS_LEVELS.find((l) => userElo < l.requiredElo)

  return (
    <div className="battle-pass-container">
      {/* Top Banner Status */}
      <div className="battle-pass-banner">
        <div className="battle-pass-banner__info">
          <span className="battle-pass-banner__season">🔥 TEMPORADA 1: REBELIÓN BOTÁNICA</span>
          <h2 className="battle-pass-banner__title">
            PASE DE TEMPORADA VIP ($10.00 USD) — NIVEL {highestLevelReached}/20
          </h2>
          <p className="battle-pass-banner__desc">
            {nextLevel
              ? `🏆 Tu ELO actual es de ${userElo} Copas. Alcanza ${nextLevel.requiredElo} Copas para desbloquear el Nivel ${nextLevel.level}.`
              : `🏆 ¡HAS ALCANZADO EL NIVEL MÁXIMO 20 (4,000+ COPAS)!`}
          </p>
        </div>

        <div className="battle-pass-banner__actions">
          {hasVipPass ? (
            <div className="battle-pass-vip-badge">
              <span>👑 PASE VIP ACTIVADO ✓</span>
            </div>
          ) : (
            <button className="battle-pass-buy-btn" type="button" onClick={onBuyVipPass}>
              👑 ACTIVAR PASE VIP ($10.00 USD)
            </button>
          )}
        </div>
      </div>

      {/* SINGLE-ROW HORIZONTAL 20-LEVEL TIMELINE SCROLLER */}
      <div className="battle-pass-road-scroll">
        <div className="battle-pass-road-track">
          {BATTLE_PASS_LEVELS.map((passLvl) => {
            const isUnlocked = userElo >= passLvl.requiredElo
            const isClaimed = claimedVipLevels.includes(passLvl.level)

            return (
              <div
                key={passLvl.level}
                className={`pass-level-column ${
                  isUnlocked ? 'pass-level-column--unlocked' : 'pass-level-column--locked'
                }`}
              >
                {/* LEVEL & COPAS BADGE HEADER */}
                <div className="pass-node-badge">
                  <span className="pass-node-num">NIVEL {passLvl.level}</span>
                  <span className="pass-node-elo">🏆 {passLvl.requiredElo} COPAS</span>
                </div>

                {/* VIP REWARD BOX */}
                <div
                  className={`pass-reward-box pass-reward-box--vip ${
                    isClaimed
                      ? 'pass-reward-box--claimed'
                      : hasVipPass && isUnlocked
                      ? 'pass-reward-box--ready'
                      : ''
                  }`}
                >
                  <span className="pass-box-tag pass-box-tag--vip">👑 EXCLUSIVO VIP</span>
                  <img src={passLvl.reward.icon} alt="" className="pass-box-icon" />
                  <span className="pass-box-label">{passLvl.reward.label}</span>

                  {isClaimed ? (
                    <span className="pass-box-status pass-box-status--claimed">✅ RECLAMADO</span>
                  ) : hasVipPass && isUnlocked ? (
                    <button
                      type="button"
                      className="pass-box-claim-btn pass-box-claim-btn--vip"
                      onClick={() => {
                        soundManager.playSound('plantation', 0.9)
                        onClaimReward(passLvl)
                      }}
                    >
                      👑 RECLAMAR
                    </button>
                  ) : !hasVipPass ? (
                    <span className="pass-box-status pass-box-status--vip">🔒 PASE VIP</span>
                  ) : (
                    <span className="pass-box-status">🔒 {passLvl.requiredElo} 🏆</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
