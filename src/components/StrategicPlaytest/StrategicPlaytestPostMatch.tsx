import React, { useState } from 'react'
import {
  type StrategicPlaytestLog,
  type HumanPerceptionRating,
} from '../../engine/strategicPlaytest'
import { updatePlaytestPerception } from '../../utils/strategicPlaytestStorage'
import './StrategicPlaytestPostMatch.css'

interface StrategicPlaytestPostMatchProps {
  log: StrategicPlaytestLog
  onPlayAgain: () => void
  onBackToMenu: () => void
}

export const StrategicPlaytestPostMatch: React.FC<StrategicPlaytestPostMatchProps> = ({
  log,
  onPlayAgain,
  onBackToMenu,
}) => {
  const [difficultyRating, setDifficultyRating] = useState<number>(7)
  const [intelligenceRating, setIntelligenceRating] = useState<number>(7)
  const [funRating, setFunRating] = useState<number>(8)
  const [varietyRating, setVarietyRating] = useState<number>(7)

  const [didDefendProperly, setDidDefendProperly] = useState<boolean>(true)
  const [didPunishOpenLanes, setDidPunishOpenLanes] = useState<boolean>(true)
  const [didChangeLanes, setDidChangeLanes] = useState<boolean>(true)
  const [feltAbsurdMoments, setFeltAbsurdMoments] = useState<boolean>(false)
  const [wasStalemateNoticeable, setWasStalemateNoticeable] = useState<boolean>(log.winner === 'draw')
  const [comments, setComments] = useState<string>('')

  const [showTelemetry, setShowTelemetry] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const [saved, setSaved] = useState<boolean>(false)

  const handleSavePerception = () => {
    const perception: HumanPerceptionRating = {
      difficulty: difficultyRating,
      intelligence: intelligenceRating,
      fun: funRating,
      variety: varietyRating,
      wasStalemateNoticeable,
      didDefendProperly,
      didPunishOpenLanes,
      didChangeLanes,
      feltAbsurdMoments,
      comments,
    }

    updatePlaytestPerception(log.matchId, perception)
    setSaved(true)
  }

  const handleCopyTelemetry = () => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const resultClass = log.winner === 'player' ? 'victory' : log.winner === 'bot' ? 'defeat' : 'draw'
  const resultText =
    log.winner === 'player'
      ? '🏆 ¡VICTORIA HUMANA!'
      : log.winner === 'bot'
      ? '💀 VICTORIA DEL RIVAL ESTRATÉGICO'
      : '⏱️ EMPATE / TIEMPO AGOTADO'

  return (
    <div className="playtest-postmatch-container">
      <div className="playtest-postmatch-card">
        <div className="postmatch-header">
          <span className={`postmatch-result-badge ${resultClass}`}>{resultText}</span>
          <div className="postmatch-metrics-summary">
            <div className="summary-metric-box">
              <span className="metric-label">Daño a Base Bot</span>
              <span className="metric-val">{log.p1DamageDealt} HP</span>
            </div>
            <div className="summary-metric-box">
              <span className="metric-label">Daño Recibido</span>
              <span className="metric-val">{log.p2DamageDealt} HP</span>
            </div>
            <div className="summary-metric-box">
              <span className="metric-label">Duración</span>
              <span className="metric-val">{log.durationSeconds}s</span>
            </div>
          </div>
        </div>

        {/* Human Perception Rating Form */}
        <div className="postmatch-form-section">
          <div className="section-title">📝 EVALUACIÓN DE PERCEPCIÓN HUMANA</div>

          <div className="rating-grid">
            <div className="rating-item">
              <label>Dificultad Percibida (1-10):</label>
              <div className="rating-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`rating-btn ${difficultyRating === v ? 'active' : ''}`}
                    onClick={() => setDifficultyRating(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="rating-item">
              <label>Inteligencia Percibida (1-10):</label>
              <div className="rating-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`rating-btn ${intelligenceRating === v ? 'active' : ''}`}
                    onClick={() => setIntelligenceRating(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="rating-item">
              <label>Diversión / Sensación Humana (1-10):</label>
              <div className="rating-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`rating-btn ${funRating === v ? 'active' : ''}`}
                    onClick={() => setFunRating(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="rating-item">
              <label>Variedad Táctica (1-10):</label>
              <div className="rating-buttons">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`rating-btn ${varietyRating === v ? 'active' : ''}`}
                    onClick={() => setVarietyRating(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="checkbox-grid">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={didDefendProperly}
                onChange={(e) => setDidDefendProperly(e.target.checked)}
              />
              ¿Defendió donde debía?
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={didPunishOpenLanes}
                onChange={(e) => setDidPunishOpenLanes(e.target.checked)}
              />
              ¿Castigó carriles abiertos?
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={didChangeLanes}
                onChange={(e) => setDidChangeLanes(e.target.checked)}
              />
              ¿Cambió de carril activamente?
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={feltAbsurdMoments}
                onChange={(e) => setFeltAbsurdMoments(e.target.checked)}
              />
              ¿Hubo momentos absurdos / pasivos?
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={wasStalemateNoticeable}
                onChange={(e) => setWasStalemateNoticeable(e.target.checked)}
              />
              ¿Sentiste estancamiento o bloqueo?
            </label>
          </div>

          <textarea
            className="comments-textarea"
            placeholder="Observaciones cualitativas (ej. momentos clave, errores tácticos, jugadas inteligentes)..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </div>

        {/* Collapsible Telemetry Inspector */}
        <div className="telemetry-collapsible">
          <button
            type="button"
            className="telemetry-toggle-btn"
            onClick={() => setShowTelemetry(!showTelemetry)}
          >
            <span>🔍 TELEMETRÍA TÁCTICA DEL BOT (REVELAR DATOS)</span>
            <span>{showTelemetry ? '▲ Ocultar' : '▼ Ver'}</span>
          </button>

          {showTelemetry && (
            <div className="telemetry-content">
              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <strong>Estilo Revelado:</strong> {log.style.toUpperCase()} (HARD)
                </div>
                <div className="telemetry-item">
                  <strong>Mazo del Bot:</strong> {log.botDeckKey} ({log.botDeck.map((c) => c.plantId).join(', ')})
                </div>
                <div className="telemetry-item">
                  <strong>Plantas Colocadas:</strong> {log.botPlantsPlaced} (Carriles: {log.lanesUsed.join('/')})
                </div>
                <div className="telemetry-item">
                  <strong>Sol Bot (Recibido / Gastado):</strong> {log.botSunCredited} / {log.botSunSpent}
                </div>
                <div className="telemetry-item">
                  <strong>Stalemates Detectados:</strong> {log.stalemateDetections}
                </div>
                <div className="telemetry-item">
                  <strong>Semilla:</strong> {log.seed}
                </div>
              </div>

              {log.anomaliesDetected.length > 0 && (
                <div>
                  <strong>Anomalías Detectadas Automáticamente:</strong>
                  {log.anomaliesDetected.map((anom, i) => (
                    <span key={i} className="anomaly-tag">
                      ⚠️ {anom}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  style={{
                    background: '#1e293b',
                    border: '1px solid #475569',
                    color: '#38bdf8',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                  onClick={handleCopyTelemetry}
                >
                  {copied ? '✅ ¡Copiado!' : '📋 Copiar Telemetría Completa JSON'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="postmatch-actions">
          <button
            type="button"
            className="postmatch-btn postmatch-btn--save"
            onClick={handleSavePerception}
          >
            {saved ? '✅ EVALUACIÓN GUARDADA' : '💾 GUARDAR EVALUACIÓN'}
          </button>
          <button type="button" className="postmatch-btn postmatch-btn--menu" onClick={onPlayAgain}>
            ⚔️ JUGAR OTRA PARTIDA
          </button>
          <button type="button" className="postmatch-btn postmatch-btn--menu" onClick={onBackToMenu}>
            🏠 VOLVER AL MENÚ
          </button>
        </div>
      </div>
    </div>
  )
}
