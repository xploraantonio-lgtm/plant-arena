import { useState, useEffect } from 'react'
import {
  TOURNAMENT_CATALOG,
  TournamentManager,
  type TournamentDefinition,
  type ActiveTournamentSession,
} from '../../utils/tournamentManager'
import { soundManager } from '../../utils/audioManager'
import './TournamentModal.css'

interface TournamentModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  onDeductTokens: (amount: number) => boolean
  onStartTournamentMatch: (opponentName: string, tournamentId: string) => void
}

export default function TournamentModal({
  isOpen,
  onClose,
  userTokens,
  onDeductTokens,
  onStartTournamentMatch,
}: TournamentModalProps) {
  const [selectedTourneyId, setSelectedTourneyId] = useState<string>('tourney_free_1')
  const [activeSession, setActiveSession] = useState<ActiveTournamentSession | null>(() =>
    TournamentManager.getSession('tourney_free_1')
  )

  const [inputCode, setInputCode] = useState<string>('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showCodeModal, setShowCodeModal] = useState<boolean>(false)
  const [showPayModal, setShowPayModal] = useState<boolean>(false)
  const [showDevConfigModal, setShowDevConfigModal] = useState<boolean>(false)
  const [isSearchingMatch, setIsSearchingMatch] = useState<boolean>(false)
  const [foundOpponent, setFoundOpponent] = useState<{ name: string; avatar: string } | null>(null)

  // Dev configuration code states
  const [devCode1, setDevCode1] = useState<string>(() => TournamentManager.getAccessCode('tourney_free_1'))
  const [devCode2, setDevCode2] = useState<string>(() => TournamentManager.getAccessCode('tourney_free_2'))
  const [devSaveNotice, setDevSaveNotice] = useState<string | null>(null)

  // Ticker for timers
  const [currentTime, setCurrentTime] = useState<number>(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setActiveSession(TournamentManager.getSession(selectedTourneyId))
  }, [isOpen, selectedTourneyId])

  if (!isOpen) return null

  const selectedTourneyDef = TOURNAMENT_CATALOG.find((t) => t.id === selectedTourneyId) || TOURNAMENT_CATALOG[0]

  // Time calculations
  const isStarted = activeSession ? currentTime >= activeSession.startTimeMs : false
  const isEnded = activeSession ? currentTime >= activeSession.endTimeMs : false
  const secondsUntilStart = activeSession ? Math.max(0, Math.floor((activeSession.startTimeMs - currentTime) / 1000)) : 0
  const secondsUntilEnd = activeSession ? Math.max(0, Math.floor((activeSession.endTimeMs - currentTime) / 1000)) : 0

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleOpenRegistration = (tourney: TournamentDefinition) => {
    soundManager.playSound('click', 0.4)
    setSelectedTourneyId(tourney.id)
    setCodeError(null)
    setInputCode('')

    if (tourney.type === 'free_code') {
      setShowCodeModal(true)
    } else {
      setShowPayModal(true)
    }
  }

  const handleValidateCode = () => {
    const isValid = TournamentManager.validateAccessCode(selectedTourneyDef.id, inputCode)
    if (isValid) {
      soundManager.playSound('victory', 0.8)
      const session = TournamentManager.registerPlayer(selectedTourneyDef)
      setActiveSession(session)
      setShowCodeModal(false)
    } else {
      soundManager.playSound('error', 0.5)
      setCodeError('⚠️ Código de acceso incorrecto. Verifica el código o cámbialo en "⚙️ Códigos Dev".')
    }
  }

  const handleConfirmPaidEntry = () => {
    if (userTokens < selectedTourneyDef.entryCostGems) {
      alert(`Gemas insuficientes. Necesitas ${selectedTourneyDef.entryCostGems} Gemas 💎 para registrarte.`)
      return
    }

    const deducted = onDeductTokens(selectedTourneyDef.entryCostGems)
    if (!deducted) return

    soundManager.playSound('plantation', 0.8)
    const session = TournamentManager.registerPlayer(selectedTourneyDef)
    setActiveSession(session)
    setShowPayModal(false)
  }

  const handleSaveDevCodes = () => {
    TournamentManager.setAccessCode('tourney_free_1', devCode1)
    TournamentManager.setAccessCode('tourney_free_2', devCode2)
    soundManager.playSound('click', 0.5)
    setDevSaveNotice('✅ ¡Códigos actualizados!')
    setTimeout(() => setDevSaveNotice(null), 3000)
  }

  const handleForceStartDev = () => {
    soundManager.playSound('click', 0.5)
    const updated = TournamentManager.forceStartTournament(selectedTourneyDef.id)
    setActiveSession(updated)
  }

  const handleStartMatchmaking = () => {
    if (!activeSession || activeSession.isEliminated || !isStarted || isEnded) return
    soundManager.playSound('click', 0.5)
    setIsSearchingMatch(true)
    setFoundOpponent(null)

    // Simulate 2.5s matchmaking lookup
    setTimeout(() => {
      const opp = TournamentManager.getActiveMatchOpponent(activeSession)
      setFoundOpponent(opp)
      soundManager.playSound('victory', 0.7)

      setTimeout(() => {
        setIsSearchingMatch(false)
        onClose()
        onStartTournamentMatch(opp.name, activeSession.tournamentId)
      }, 1500)
    }, 2200)
  }

  const userRank = activeSession ? TournamentManager.getUserRank(activeSession) : 0

  return (
    <div className="tourney-backdrop" onClick={onClose}>
      <div className="tourney-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="tourney-header">
          <div className="tourney-header__title-box">
            <span className="tourney-header__icon">🎪</span>
            <div>
              <h2 className="tourney-header__title">TORNEOS OFICIALES EN VIVO</h2>
              <p className="tourney-header__subtitle">
                1 Hora de Matchmaking • Máximo 3 Derrotas • Ranking por Victorias (Premios anunciados aparte)
              </p>
            </div>
          </div>

          <div className="tourney-header__stats">
            <div className="tourney-badge tourney-badge--gems" title="Gemas Disponibles">
              <span>💎</span>
              <strong>{userTokens}</strong>
            </div>
            <button
              type="button"
              className="tourney-dev-code-btn"
              onClick={() => setShowDevConfigModal(true)}
              title="Configurar códigos de torneos gratuitos (Panel Dev)"
            >
              ⚙️ Códigos Dev
            </button>
            <button type="button" className="tourney-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* TOURNAMENT TABS SELECTOR */}
        <div className="tourney-tabs-row">
          {TOURNAMENT_CATALOG.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tourney-tab-btn ${selectedTourneyId === t.id ? 'tourney-tab-btn--active' : ''}`}
              onClick={() => {
                soundManager.playSound('click', 0.3)
                setSelectedTourneyId(t.id)
              }}
            >
              <span>{t.icon}</span>
              <span>{t.name.split(' (')[0]}</span>
              <small>{t.entryCostGems === 0 ? 'GRATIS' : `${t.entryCostGems} 💎`}</small>
            </button>
          ))}
        </div>

        {/* MAIN BODY: ACTIVE SESSION HUB OR REGISTRATION */}
        {activeSession && activeSession.registered ? (
          <div className="tourney-live-layout">
            {/* TOP BAR STATUS & MATCHMAKING */}
            <div className="tourney-live-banner">
              <div className="tourney-banner-left">
                <span className="tourney-banner-name">{activeSession.tournamentName}</span>
                <div className="tourney-banner-meta">
                  <span className="tourney-podium-chip">👑 TOP 3 CLASIFICATORIO</span>
                  <span>•</span>
                  <span>📢 Premios a ser anunciados y entregados aparte por el organizador</span>
                </div>
              </div>

              {/* TIMERS & HEARTS */}
              <div className="tourney-banner-right">
                {!isStarted ? (
                  <div className="tourney-timer-box tourney-timer-box--waiting">
                    <span className="tourney-timer-lbl">⏳ INICIA EN:</span>
                    <strong className="tourney-timer-val">{formatCountdown(secondsUntilStart)}</strong>
                    <button
                      type="button"
                      className="tourney-force-start-btn"
                      onClick={handleForceStartDev}
                      title="Forzar inicio del torneo ahora (Acceso Desarrollador)"
                    >
                      ⚡ Iniciar Ya (Dev)
                    </button>
                  </div>
                ) : !isEnded ? (
                  <div className="tourney-timer-box tourney-timer-box--live">
                    <span className="tourney-timer-lbl">🔴 TIEMPO RESTANTE:</span>
                    <strong className="tourney-timer-val">{formatCountdown(secondsUntilEnd)}</strong>
                  </div>
                ) : (
                  <div className="tourney-timer-box tourney-timer-box--ended">
                    <span className="tourney-timer-lbl">🏁 TORNEO FINALIZADO</span>
                  </div>
                )}

                {/* HEARTS & WINS ROW */}
                <div className="tourney-player-status-row">
                  <div className="tourney-hearts-box" title="Vidas Restantes (Máximo 3 Derrotas)">
                    <span>Vidas:</span>
                    <div className="tourney-hearts-list">
                      {Array.from({ length: activeSession.maxLosses }).map((_, i) => (
                        <span key={i} className="tourney-heart">
                          {i < activeSession.maxLosses - activeSession.userLosses ? '❤️' : '💔'}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="tourney-user-wins-badge">
                    <span>Victorias:</span>
                    <strong>🔥 {activeSession.userWins}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* MATCHMAKING ACTION BAR */}
            <div className="tourney-matchmaking-bar">
              {activeSession.isEliminated ? (
                <div className="tourney-eliminated-notice">
                  <span className="tourney-elim-icon">💀</span>
                  <div>
                    <strong>HAS SIDO ELIMINADO DEL TORNEO</strong>
                    <p>Alcanzaste el límite de 3 derrotas. Tu récord final de {activeSession.userWins} victorias queda registrado en la tabla.</p>
                  </div>
                </div>
              ) : isEnded ? (
                <div className="tourney-ended-notice">
                  <span>🏁 ¡La hora del torneo ha finalizado! Los premios del Top 3 serán anunciados y entregados por los organizadores.</span>
                </div>
              ) : !isStarted ? (
                <div className="tourney-waiting-notice">
                  <span>⏳ Esperando la cuenta regresiva. Prepara tu mazo en el Jardín para cuando empiece el torneo.</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="tourney-find-match-btn"
                  onClick={handleStartMatchmaking}
                  disabled={isSearchingMatch}
                >
                  ⚔️ BUSCAR PARTIDA (MATCHMAKING)
                </button>
              )}
            </div>

            {/* LIVE LEADERBOARD TABLE */}
            <div className="tourney-leaderboard-card">
              <div className="tourney-leaderboard-header">
                <h3>🏆 RANKING EN VIVO (POR VICTORIAS)</h3>
                <span className="tourney-leaderboard-sub">
                  Tu Posición Actual: <strong>#{userRank}</strong> ({activeSession.userWins} Victorias)
                </span>
              </div>

              <div className="tourney-leaderboard-table">
                <div className="tourney-table-row tourney-table-row--head">
                  <span className="col-rank">Puesto</span>
                  <span className="col-player">Jugador</span>
                  <span className="col-wins">Victorias</span>
                  <span className="col-losses">Vidas</span>
                  <span className="col-prize">Clasificación</span>
                </div>

                {activeSession.leaderboard.map((entry) => {
                  const isTop1 = entry.rank === 1
                  const isTop2 = entry.rank === 2
                  const isTop3 = entry.rank === 3

                  return (
                    <div
                      key={entry.name}
                      className={`tourney-table-row ${entry.isUser ? 'tourney-table-row--me' : ''} ${
                        isTop1 ? 'tourney-table-row--top1' : isTop2 ? 'tourney-table-row--top2' : isTop3 ? 'tourney-table-row--top3' : ''
                      }`}
                    >
                      <span className="col-rank">
                        {isTop1 ? '👑 #1' : isTop2 ? '🥈 #2' : isTop3 ? '🥉 #3' : `#${entry.rank}`}
                      </span>
                      <span className="col-player">
                        <strong>{entry.name}</strong> {entry.isUser && <small>(Tú)</small>}
                        {entry.isEliminated && <span className="tourney-elim-badge">ELIMINADO</span>}
                      </span>
                      <span className="col-wins">
                        <strong>🔥 {entry.wins}</strong>
                      </span>
                      <span className="col-losses">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <span key={i}>{i < 3 - entry.losses ? '❤️' : '💔'}</span>
                        ))}
                      </span>
                      <span className="col-prize">
                        {isTop1 ? (
                          <span style={{ color: '#facc15', fontWeight: 800 }}>👑 1er Lugar</span>
                        ) : isTop2 ? (
                          <span style={{ color: '#e2e8f0', fontWeight: 800 }}>🥈 2do Lugar</span>
                        ) : isTop3 ? (
                          <span style={{ color: '#fb923c', fontWeight: 800 }}>🥉 3er Lugar</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>Clasificado</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* REGISTRATION SCREEN */
          <div className="tourney-register-box">
            <div className="tourney-reg-icon">{selectedTourneyDef.icon}</div>
            <h3 className="tourney-reg-title">{selectedTourneyDef.name}</h3>
            <p className="tourney-reg-desc">{selectedTourneyDef.description}</p>

            <div className="tourney-podium-banner">
              <div className="tourney-podium-tag">👑 TOP 3 CLASIFICATORIO</div>
              <p>Compite en matchmaking durante 1 hora y consigue el mayor número de victorias.</p>
              <div className="tourney-podium-notice">
                📢 Los premios oficiales para los ganadores del Top 3 se anunciarán aparte por el organizador.
              </div>
            </div>

            <div className="tourney-reg-rules">
              <span>⏱️ <strong>Duración:</strong> 1 Hora de combates libres</span>
              <span>💔 <strong>Regla de Vidas:</strong> Máximo 3 derrotas (al perder 3 combates quedas eliminado)</span>
              <span>🌱 <strong>Mazo:</strong> Se utilizan tus plantas e inventario actual</span>
            </div>

            <button
              type="button"
              className="tourney-reg-action-btn"
              onClick={() => handleOpenRegistration(selectedTourneyDef)}
            >
              {selectedTourneyDef.type === 'free_code'
                ? '🔑 INSCRIBIRSE CON CÓDIGO GRATIS'
                : `💎 INSCRIBIRSE POR ${selectedTourneyDef.entryCostGems} GEMAS`}
            </button>
          </div>
        )}

        {/* MATCHMAKING SEARCHING POPUP */}
        {isSearchingMatch && (
          <div className="tourney-submodal-overlay">
            <div className="tourney-submodal-box tourney-matchmaking-modal">
              <div className="tourney-search-spinner" />
              <h3>BUSCANDO RIVAL EN EL TORNEO...</h3>
              <p>Emparejando con un competidor activo del torneo</p>
              {foundOpponent && (
                <div className="tourney-opponent-found-box">
                  <span>¡RIVAL ENCONTRADO!</span>
                  <strong>⚔️ {foundOpponent.name} ⚔️</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODAL: INGRESO DE CÓDIGO */}
        {showCodeModal && (
          <div className="tourney-submodal-overlay" onClick={() => setShowCodeModal(false)}>
            <div className="tourney-submodal-box" onClick={(e) => e.stopPropagation()}>
              <div className="tourney-submodal-icon">🔑</div>
              <h3>CÓDIGO DE ACCESO AL TORNEO</h3>
              <p>
                Introduce el código configurado por el desarrollador para participar en <strong>{selectedTourneyDef.name}</strong>:
              </p>

              <input
                type="text"
                placeholder="Ingresar código (ej: ARENA2026)"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                className="tourney-code-input"
                autoFocus
              />

              {codeError && <div className="tourney-code-error">{codeError}</div>}

              <div className="tourney-code-hint">
                💡 <em>Código por defecto:</em> <strong>{TournamentManager.getAccessCode(selectedTourneyDef.id)}</strong> (puedes cambiarlo en el botón &quot;⚙️ Códigos Dev&quot;).
              </div>

              <div className="tourney-submodal-actions">
                <button type="button" className="tourney-submodal-btn--cancel" onClick={() => setShowCodeModal(false)}>
                  CANCELAR
                </button>
                <button type="button" className="tourney-submodal-btn--confirm" onClick={handleValidateCode}>
                  VALIDAR Y ENTRAR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: PAGO DE ENTRADA */}
        {showPayModal && (
          <div className="tourney-submodal-overlay" onClick={() => setShowPayModal(false)}>
            <div className="tourney-submodal-box" onClick={(e) => e.stopPropagation()}>
              <div className="tourney-submodal-icon">💎</div>
              <h3>CONFIRMAR ENTRADA AL TORNEO</h3>
              <p>
                ¿Deseas pagar <strong>{selectedTourneyDef.entryCostGems} Gemas 💎</strong> de tu saldo para registrarte en el torneo?
              </p>

              <div className="tourney-confirm-balance">
                Saldo actual: <strong>{userTokens} Gemas 💎</strong>
              </div>

              <div className="tourney-submodal-actions">
                <button type="button" className="tourney-submodal-btn--cancel" onClick={() => setShowPayModal(false)}>
                  CANCELAR
                </button>
                <button type="button" className="tourney-submodal-btn--confirm" onClick={handleConfirmPaidEntry}>
                  PAGAR Y ENTRAR ({selectedTourneyDef.entryCostGems} 💎)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: CONFIGURACIÓN DE CÓDIGOS DEV */}
        {showDevConfigModal && (
          <div className="tourney-submodal-overlay" onClick={() => setShowDevConfigModal(false)}>
            <div className="tourney-submodal-box tourney-submodal-box--wide" onClick={(e) => e.stopPropagation()}>
              <div className="tourney-submodal-icon">⚙️</div>
              <h3>PANEL DEV: CONFIGURAR CÓDIGOS DE ACCESO</h3>
              <p>Define las claves de acceso para los torneos gratuitos organizados por el desarrollador:</p>

              <div className="tourney-dev-fields">
                <div className="tourney-dev-row">
                  <label>🏆 Copa Botánica (Torneo 1):</label>
                  <input
                    type="text"
                    value={devCode1}
                    onChange={(e) => setDevCode1(e.target.value.toUpperCase())}
                    placeholder="Código Torneo 1"
                  />
                </div>

                <div className="tourney-dev-row">
                  <label>🌱 Torneo Relámpago (Torneo 2):</label>
                  <input
                    type="text"
                    value={devCode2}
                    onChange={(e) => setDevCode2(e.target.value.toUpperCase())}
                    placeholder="Código Torneo 2"
                  />
                </div>
              </div>

              {devSaveNotice && <div className="tourney-save-notice">{devSaveNotice}</div>}

              <div className="tourney-submodal-actions">
                <button type="button" className="tourney-submodal-btn--cancel" onClick={() => setShowDevConfigModal(false)}>
                  CERRAR
                </button>
                <button type="button" className="tourney-submodal-btn--confirm" onClick={handleSaveDevCodes}>
                  💾 GUARDAR CÓDIGOS
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
