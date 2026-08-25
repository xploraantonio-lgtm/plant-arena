import React, { useState, useEffect } from 'react'
import {
  STRATEGIC_BOT_DECKS,
  type StrategicPlaytestConfig,
} from '../../engine/strategicPlaytest'
import {
  getPlaytestLogs,
  exportPlaytestLogsJSON,
} from '../../utils/strategicPlaytestStorage'
import type { StrategicStyle } from '../../engine/strategicAsyncBot'
import './StrategicPlaytestLauncherModal.css'

interface StrategicPlaytestLauncherModalProps {
  isOpen: boolean
  onClose: () => void
  onStartPlaytest: (config: StrategicPlaytestConfig) => void
}

const ALL_STYLES: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']

export const StrategicPlaytestLauncherModal: React.FC<StrategicPlaytestLauncherModalProps> = ({
  isOpen,
  onClose,
  onStartPlaytest,
}) => {
  const [selectedStyleOption, setSelectedStyleOption] = useState<string>('random_hidden')
  const [selectedDeckKey, setSelectedDeckKey] = useState<string>('random')
  const [customSeed, setCustomSeed] = useState<string>('')
  const [logs, setLogs] = useState(getPlaytestLogs())

  useEffect(() => {
    if (isOpen) {
      setLogs(getPlaytestLogs())
    }
  }, [isOpen])

  if (!isOpen) return null

  // Contar progreso de las 15 partidas del protocolo
  const countsByStyle: Record<StrategicStyle, number> = {
    balanced: 0,
    aggressive: 0,
    defensive: 0,
    economic: 0,
    opportunistic: 0,
  }

  for (const log of logs) {
    if (log.style && countsByStyle[log.style] !== undefined) {
      countsByStyle[log.style]++
    }
  }

  const totalPlayed = logs.length

  const handleLaunch = () => {
    // Resolver estilo
    let style: StrategicStyle
    let isRandomStyle = false
    if (selectedStyleOption === 'random_hidden') {
      const idx = Math.floor(Math.random() * ALL_STYLES.length)
      style = ALL_STYLES[idx]
      isRandomStyle = true
    } else {
      style = selectedStyleOption as StrategicStyle
    }

    // Resolver mazo del bot
    let deckKey = selectedDeckKey
    if (deckKey === 'random') {
      const keys = Object.keys(STRATEGIC_BOT_DECKS)
      deckKey = keys[Math.floor(Math.random() * keys.length)]
    }
    const botDeckPreset = STRATEGIC_BOT_DECKS[deckKey] || STRATEGIC_BOT_DECKS.balanced

    // Resolver semilla
    const parsedSeed = parseInt(customSeed, 10)
    const seed = Number.isInteger(parsedSeed) && parsedSeed > 0 ? parsedSeed : Math.floor(Math.random() * 900000) + 100000

    const config: StrategicPlaytestConfig = {
      style,
      difficulty: 'hard',
      deckKey,
      botDeck: botDeckPreset.deck,
      seed,
      isRandomStyle,
    }

    onStartPlaytest(config)
  }

  const handleExportLogs = () => {
    const json = exportPlaytestLogsJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `strategic_playtest_logs_${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="strategic-playtest-overlay">
      <div className="strategic-playtest-modal">
        <div className="playtest-header">
          <div>
            <span className="playtest-title-badge">🔬 ENTORNO DE EVALUACIÓN CIENTÍFICA</span>
            <h2 className="playtest-title">Playtest: Rival Estratégico V1 (HARD)</h2>
            <p className="playtest-desc">
              Partida 100% aislada contra la IA de Utilidad determinista en dificultad HARD.
            </p>
          </div>
          <button type="button" className="playtest-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Protocol 15-Match Progress */}
        <div className="playtest-protocol-box">
          <div className="protocol-title">
            <span>📋 PROTOCOLO HUMANO: 15 PARTIDAS</span>
            <span>{totalPlayed} / 15 evaluadas</span>
          </div>
          <div className="protocol-progress-grid">
            {ALL_STYLES.map((st) => {
              const count = countsByStyle[st]
              const isDone = count >= 3
              return (
                <div key={st} className={`protocol-style-chip ${isDone ? 'completed' : ''}`}>
                  <span className="style-name">{st}</span>
                  <strong>{count} / 3</strong>
                </div>
              )
            })}
          </div>
        </div>

        {/* Security / Isolation notice */}
        <div className="playtest-security-note">
          <span>🛡️</span>
          <span>
            <strong>Aislamiento Garantizado:</strong> CERO cambios en ELO, W/L, cofres o bases de datos de producción.
          </span>
        </div>

        {/* Form Controls */}
        <div className="playtest-form-group">
          <label className="playtest-form-label">Estilo del Rival:</label>
          <select
            className="playtest-select"
            value={selectedStyleOption}
            onChange={(e) => setSelectedStyleOption(e.target.value)}
          >
            <option value="random_hidden">🎲 Aleatorio Oculto (Recomendado — Evaluación a ciegas)</option>
            <option value="balanced">⚖️ Balanced (Equilibrado)</option>
            <option value="aggressive">⚔️ Aggressive (Presión rápida y castigo)</option>
            <option value="defensive">🛡️ Defensive (Muros y soporte)</option>
            <option value="economic">💰 Economic (Hiper-economía y artillería)</option>
            <option value="opportunistic">🎯 Opportunistic (Flanqueo y control)</option>
          </select>
        </div>

        <div className="playtest-form-group">
          <label className="playtest-form-label">Mazo del Rival:</label>
          <select
            className="playtest-select"
            value={selectedDeckKey}
            onChange={(e) => setSelectedDeckKey(e.target.value)}
          >
            <option value="random">🎲 Aleatorio (Entre los 5 mazos predefinidos)</option>
            <option value="balanced">Balanceado Estándar (Girasol, Peashooter, Nuez, Bonkchoy, Repetidora, Jalapeño)</option>
            <option value="rush">Rush Ofensivo (Girasol, Ajo, Bonkchoy, Chomper, Repetidora, Jalapeño)</option>
            <option value="defensive">Control y Muros (Girasol, Nuez, Nuez Alta, Repetidora, Aloe, Jalapeño)</option>
            <option value="economic">Hiper-Economía (Girasol, Girasol Doble, Nuez Alta, Melonpult, Tripeadora, Jalapeño)</option>
            <option value="mixed">Mixto Oportunista (Girasol, Ajo, Chomper, Repetidora, Tripeadora, Lechuga Helada)</option>
          </select>
          {selectedDeckKey !== 'random' && STRATEGIC_BOT_DECKS[selectedDeckKey] && (
            <div className="playtest-deck-preview">
              {STRATEGIC_BOT_DECKS[selectedDeckKey].description}
            </div>
          )}
        </div>

        <div className="playtest-form-group">
          <label className="playtest-form-label">Dificultad:</label>
          <input className="playtest-input" value="HARD (Fija para certificación)" disabled />
        </div>

        <div className="playtest-form-group">
          <label className="playtest-form-label">Semilla de Partida (Opcional):</label>
          <input
            className="playtest-input"
            placeholder="Dejar en blanco para semilla aleatoria"
            value={customSeed}
            onChange={(e) => setCustomSeed(e.target.value)}
          />
        </div>

        {/* Action Buttons */}
        <div className="playtest-actions">
          {logs.length > 0 && (
            <button type="button" className="playtest-btn playtest-btn--export" onClick={handleExportLogs}>
              📥 Exportar Logs JSON ({logs.length})
            </button>
          )}
          <button type="button" className="playtest-btn playtest-btn--start" onClick={handleLaunch}>
            ⚔️ INICIAR PARTIDA DE PRUEBA
          </button>
        </div>
      </div>
    </div>
  )
}
