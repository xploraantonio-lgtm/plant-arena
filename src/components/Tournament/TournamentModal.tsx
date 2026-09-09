import { useState, useEffect, useCallback, useMemo } from 'react'
import type { PlantId, TournamentModel, TournamentDetailsResponse } from '../../types/game'
import { tournamentService } from '../../services/tournamentService'
import { soundManager } from '../../utils/audioManager'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import TournamentDeckBuilder from './TournamentDeckBuilder'
import './TournamentModal.css'

interface TournamentModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  isAdmin?: boolean
  onDeductTokens: (amount: number) => boolean
  onStartTournamentMatch: (
    opponentName: string,
    tournamentId: string,
    tournamentDeck?: PlantId[]
  ) => void
}

export default function TournamentModal({
  isOpen,
  onClose,
  userTokens,
  isAdmin = false,
  onDeductTokens,
  onStartTournamentMatch,
}: TournamentModalProps) {
  const [tournaments, setTournaments] = useState<TournamentModel[]>([])
  const [selectedTourneyId, setSelectedTourneyId] = useState<string | null>(null)
  const [details, setDetails] = useState<TournamentDetailsResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'active' | 'ended'>('active')

  // Modals inside Tournament
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false)
  const [showDeckBuilder, setShowDeckBuilder] = useState<boolean>(false)

  // Create form states
  const [createTitle, setCreateTitle] = useState<string>('')
  const [createPrizeGems, setCreatePrizeGems] = useState<number>(10)
  const [createEntryType, setCreateEntryType] = useState<'free' | 'gems'>('free')
  const [createEntryFeeGems, setCreateEntryFeeGems] = useState<number>(5)
  const [createStartOffsetMin, setCreateStartOffsetMin] = useState<number>(5)
  const [createDurationMin, setCreateDurationMin] = useState<number>(60)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState<boolean>(false)
  const [isReentering, setIsReentering] = useState<boolean>(false)

  // Ticker for countdowns
  const [currentTime, setCurrentTime] = useState<number>(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Load tournaments list
  const loadTournaments = useCallback(async () => {
    setLoading(true)
    try {
      const list = await tournamentService.listTournaments()
      setTournaments(list)
      if (list.length > 0 && !selectedTourneyId) {
        setSelectedTourneyId(list[0].id)
      }
    } catch (err) {
      console.warn('Error loading tournaments:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedTourneyId])

  // Load selected tournament details
  const loadDetails = useCallback(async (tourneyId: string) => {
    try {
      const res = await tournamentService.getTournamentDetails(tourneyId)
      setDetails(res)
    } catch (err) {
      console.warn('Error loading tournament details:', err)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      void loadTournaments()
    }
  }, [isOpen, loadTournaments])

  useEffect(() => {
    if (selectedTourneyId) {
      void loadDetails(selectedTourneyId)
    }
  }, [selectedTourneyId, loadDetails])

  // Active or ended filtered lists
  const filteredTournaments = useMemo(() => {
    if (activeTab === 'active') {
      return tournaments.filter((t) => t.status === 'live' || t.status === 'scheduled')
    }
    return tournaments.filter((t) => t.status === 'ended' || t.status === 'cancelled')
  }, [tournaments, activeTab])

  const selectedTourney = useMemo(() => {
    if (details?.tournament) return details.tournament
    return tournaments.find((t) => t.id === selectedTourneyId) || null
  }, [details, tournaments, selectedTourneyId])

  if (!isOpen) return null

  // Time calculations for selected tournament
  const startMs = selectedTourney ? new Date(selectedTourney.start_time).getTime() : 0
  const endMs = selectedTourney ? new Date(selectedTourney.end_time).getTime() : 0

  const isLive = selectedTourney ? currentTime >= startMs && currentTime < endMs : false
  const isScheduled = selectedTourney ? currentTime < startMs : false
  const isEnded = selectedTourney ? currentTime >= endMs || selectedTourney.status === 'ended' : false

  const formatCountdown = (targetMs: number) => {
    const diffSecs = Math.max(0, Math.floor((targetMs - currentTime) / 1000))
    const h = Math.floor(diffSecs / 3600)
    const m = Math.floor((diffSecs % 3600) / 60)
    const s = diffSecs % 60
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Registration handler (Free entry or Gems)
  const handleRegister = async () => {
    if (!selectedTourney) return
    const fee = selectedTourney.entry_fee_gems || 0
    if (fee > 0 && userTokens < fee) {
      alert(`No tienes suficientes Gemas (${fee} 💎 requeridas) para inscribirte. Tu saldo actual es: ${userTokens} 💎.`)
      return
    }

    soundManager.playSound('victory', 0.7)
    const res = await tournamentService.registerParticipant(selectedTourney.id)
    if (res.success) {
      if (fee > 0) {
        onDeductTokens(fee)
      }
      await loadDetails(selectedTourney.id)
      await loadTournaments()
    } else {
      alert(res.error || 'No se pudo completar la inscripción.')
    }
  }

  // Reentry handler (3 gems for 2 lives)
  const handleReenter = async () => {
    if (!selectedTourney || !details?.my_participation?.registered) return
    const reentryCost = 3
    if (userTokens < reentryCost) {
      alert(`Necesitas ${reentryCost} 💎 para reentrar al torneo. Tu saldo actual es: ${userTokens} 💎.`)
      return
    }

    setIsReentering(true)
    try {
      soundManager.playSound('click', 0.5)
      const res = await tournamentService.reenterTournament(selectedTourney.id)
      if (res.success) {
        onDeductTokens(reentryCost)
        soundManager.playSound('victory', 0.7)
        await loadDetails(selectedTourney.id)
        await loadTournaments()
      } else {
        alert(res.error || 'No se pudo procesar la reentrada.')
      }
    } catch (err: any) {
      alert(err?.message || 'Error al procesar reentrada')
    } finally {
      setIsReentering(false)
    }
  }

  // Deck save handler
  const handleSaveDeck = async (newDeck: PlantId[]) => {
    if (!selectedTourney) return
    const res = await tournamentService.updateTournamentDeck(selectedTourney.id, newDeck)
    if (res.success) {
      await loadDetails(selectedTourney.id)
    } else {
      alert(res.error || 'No se pudo guardar el mazo.')
    }
  }

  // Start matchmaking handler
  const handleStartMatchmaking = () => {
    if (!selectedTourney || !details?.my_participation?.registered) return
    const myPart = details.my_participation
    if (myPart.is_eliminated || (myPart.losses && myPart.losses >= 3)) {
      alert('Has quedado eliminado de este torneo tras alcanzar 3 derrotas.')
      return
    }
    if (!isLive) {
      alert('El torneo aún no ha comenzado o ya ha finalizado.')
      return
    }

    soundManager.playSound('click', 0.5)

    const myDeck: PlantId[] = myPart.deck && myPart.deck.length >= 5
      ? (myPart.deck as PlantId[])
      : ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater']

    // Cerramos el modal de torneos y activamos la búsqueda autoritativa en tiempo real (0 bots)
    onClose()
    onStartTournamentMatch('', selectedTourney.id, myDeck)
  }

  // Create tournament submit
  const handleConfirmCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    if (!createTitle.trim()) {
      setCreateError('Por favor escribe un título para el torneo.')
      return
    }

    if (createPrizeGems > 0 && userTokens < createPrizeGems) {
      setCreateError(`No tienes suficientes Gemas (${createPrizeGems} 💎 requeridas). Tu saldo es: ${userTokens} 💎.`)
      return
    }

    setIsCreating(true)
    try {
      // Calculate start time
      const startTime = new Date(Date.now() + createStartOffsetMin * 60 * 1000).toISOString()
      const entryFee = createEntryType === 'gems' ? createEntryFeeGems : 0

      const res = await tournamentService.createTournament({
        title: createTitle,
        prize_pool_gems: createPrizeGems,
        entry_fee_gems: entryFee,
        start_time: startTime,
        duration_minutes: createDurationMin,
        prize_distribution: { top1: 50, top2: 30, top3: 20 },
      })

      if (!res.success) {
        setCreateError(res.error || 'Error al crear torneo')
        return
      }

      if (createPrizeGems > 0) {
        onDeductTokens(createPrizeGems)
      }

      soundManager.playSound('plantation', 0.8)
      setShowCreateModal(false)
      setCreateTitle('')
      await loadTournaments()
      if (res.tournament_id) {
        setSelectedTourneyId(res.tournament_id)
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Error inesperado')
    } finally {
      setIsCreating(false)
    }
  }

  const myPart = details?.my_participation
  const myLosses = myPart?.losses ?? 0
  const isMyPartEliminated = myPart?.is_eliminated || myLosses >= 3
  const activeDeckList = myPart?.deck || ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater']

  return (
    <div className="tourney-backdrop" onClick={onClose}>
      <div className="tourney-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="tourney-header">
          <div className="tourney-header__title-box">
            <span className="tourney-header__icon">🏆</span>
            <div>
              <h2 className="tourney-header__title">Lobby de Torneos</h2>
              <p className="tourney-header__subtitle">
                Entrada gratuita • Todos contra todos • Todas las cartas desbloqueadas • Límite 3 derrotas
              </p>
            </div>
          </div>

          <div className="tourney-header__actions">
            <div className="tourney-badge--gems">
              <span>💎</span>
              <span>{userTokens.toFixed(2)} Gemas</span>
            </div>

            {isAdmin && (
              <button
                type="button"
                className="tourney-btn-create"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowCreateModal(true)
                }}
              >
                <span>➕</span>
                <span>Crear Torneo</span>
              </button>
            )}

            <button
              type="button"
              className="tourney-close-btn"
              onClick={onClose}
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="tourney-tabs">
          <button
            type="button"
            className={`tourney-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.3)
              setActiveTab('active')
            }}
          >
            🔥 En Vivo / Próximos
          </button>
          <button
            type="button"
            className={`tourney-tab-btn ${activeTab === 'ended' ? 'active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.3)
              setActiveTab('ended')
            }}
          >
            🏁 Finalizados
          </button>
        </div>

        {/* MAIN LAYOUT */}
        <div className="tourney-layout">
          {/* TOURNAMENT LIST PANEL */}
          <div className="tourney-list-panel">
            {loading && tournaments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                Cargando torneos…
              </div>
            ) : filteredTournaments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: '#94a3b8', fontSize: '0.9rem' }}>
                No hay torneos en esta sección.
                {isAdmin && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="tourney-btn-create"
                      style={{ margin: '0 auto', fontSize: '0.8rem' }}
                      onClick={() => setShowCreateModal(true)}
                    >
                      ➕ ¡Crea el primer torneo!
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredTournaments.map((t) => {
                const isSel = t.id === selectedTourneyId
                const tStart = new Date(t.start_time).getTime()
                const tEnd = new Date(t.end_time).getTime()
                const tLive = currentTime >= tStart && currentTime < tEnd
                const tSched = currentTime < tStart

                return (
                  <div
                    key={t.id}
                    className={`tourney-card-item ${isSel ? 'selected' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.3)
                      setSelectedTourneyId(t.id)
                    }}
                  >
                    <div className="tourney-card-top">
                      <span
                        className={`tourney-status-badge ${
                          tLive ? 'live' : tSched ? 'scheduled' : 'ended'
                        }`}
                      >
                        {tLive ? '● EN VIVO' : tSched ? '⏳ PROGRAMADO' : '🏁 FINALIZADO'}
                      </span>
                      {t.entry_fee_gems > 0 ? (
                        <span className="tourney-fee-badge">💎 ENTRADA {t.entry_fee_gems} 💎</span>
                      ) : (
                        <span className="tourney-free-badge">ENTRADA FREE</span>
                      )}
                    </div>

                    <h4 className="tourney-card-title">{t.title}</h4>

                    <div className="tourney-card-meta">
                      <span style={{ color: '#c084fc', fontWeight: 700 }}>
                        💎 Pozo: {t.prize_pool_gems} Gemas
                      </span>
                      <span style={{ color: '#94a3b8' }}>
                        👥 {t.participants_count || 1}
                      </span>
                    </div>

                    <div className="tourney-card-countdown">
                      {tLive ? (
                        <>🔥 Termina en: {formatCountdown(tEnd)}</>
                      ) : tSched ? (
                        <>⏳ Inicia en: {formatCountdown(tStart)}</>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Torneo concluido</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* TOURNAMENT DETAIL PANEL */}
          {selectedTourney ? (
            <div className="tourney-detail-panel">
              {/* BANNER WITH REALTIME CLOCK */}
              <div className="tourney-detail-banner">
                <div className="tourney-banner-info">
                  <h3>{selectedTourney.title}</h3>
                  <p>
                    Organizado por <strong>{selectedTourney.creator_name}</strong> •{' '}
                    {selectedTourney.entry_fee_gems > 0
                      ? `Entrada: ${selectedTourney.entry_fee_gems} 💎`
                      : 'Entrada 100% Gratuita'}
                  </p>
                  <p style={{ color: '#c084fc', fontSize: '0.85rem', marginTop: 4 }}>
                    💎 Pozo de Premios: <strong>{selectedTourney.prize_pool_gems} Gemas</strong> (Top 1: 50% • Top 2: 30% • Top 3: 20%)
                  </p>
                </div>

                <div className="tourney-timer-big">
                  <div className="tourney-timer-big__label">
                    {isLive ? 'Tiempo Restante' : isScheduled ? 'Comienza En' : 'Estado'}
                  </div>
                  <div className="tourney-timer-big__time">
                    {isLive
                      ? formatCountdown(endMs)
                      : isScheduled
                      ? formatCountdown(startMs)
                      : 'FINALIZADO'}
                  </div>
                </div>
              </div>

              {/* PLAYER CARD (STATUS, 3 LOSSES, DECK, SEARCH MATCH) */}
              <div className="tourney-player-card">
                <div className="tourney-player-header">
                  <h4>Tu Estado en el Torneo</h4>
                  {myPart?.registered ? (
                    <span style={{ color: '#4ade80', fontSize: '0.8rem', fontWeight: 700 }}>
                      ✓ Inscrito
                    </span>
                  ) : (
                    <span style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 700 }}>
                      No inscrito
                    </span>
                  )}
                </div>

                {!myPart?.registered ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <p style={{ color: '#cbd5e1', fontSize: '0.9rem', marginBottom: 12 }}>
                      {selectedTourney.entry_fee_gems > 0
                        ? `Costo de Inscripción: ${selectedTourney.entry_fee_gems} Gemas. Tu saldo: ${userTokens.toFixed(2)} 💎. ¡15 cartas desbloqueadas para competir!`
                        : '¡La entrada es completamente gratis! Inscríbete para armar tu mazo con todas las cartas desbloqueadas y competir.'}
                    </p>
                    <button
                      type="button"
                      className="tourney-btn-create"
                      style={{ margin: '0 auto', padding: '10px 24px', fontSize: '0.95rem' }}
                      onClick={handleRegister}
                    >
                      {selectedTourney.entry_fee_gems > 0
                        ? `🎟️ Inscribirme al Torneo (${selectedTourney.entry_fee_gems} 💎)`
                        : '📝 Inscribirme Gratis al Torneo'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="tourney-stats-row">
                      {/* VICTORIAS */}
                      <div className="tourney-stat-box">
                        <div className="tourney-stat-box__label">Victorias</div>
                        <div className="tourney-stat-box__value" style={{ color: '#4ade80' }}>
                          {myPart.wins || 0} 🏆
                        </div>
                      </div>

                      {/* 3 VIDAS / DERROTAS */}
                      <div className="tourney-stat-box">
                        <div className="tourney-stat-box__label">
                          Vidas (Límite 3 Derrotas)
                        </div>
                        <div className="tourney-lives-indicator">
                          {[1, 2, 3].map((lifeNum) => {
                            const isLost = myLosses >= lifeNum
                            return (
                              <span
                                key={lifeNum}
                                className={`tourney-life-badge ${isLost ? 'lost' : 'active'}`}
                                title={isLost ? `Derrota #${lifeNum}` : 'Vida disponible'}
                              >
                                {isLost ? '❌' : '💚'}
                              </span>
                            )
                          })}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
                          {myLosses} / 3 derrotas
                        </div>
                      </div>

                      {/* MAZO MINI PREVIEW */}
                      <div className="tourney-deck-preview">
                        <div className="tourney-deck-preview__plants">
                          {activeDeckList.map((pid, idx) => {
                            const cfg = PLANT_CONFIGS[pid]
                            return (
                              <img
                                key={idx}
                                src={cfg?.icon}
                                alt={cfg?.name || pid}
                                className="tourney-deck-mini-icon"
                                title={cfg?.name}
                              />
                            )
                          })}
                        </div>
                        <button
                          type="button"
                          className="tourney-btn-deck"
                          onClick={() => setShowDeckBuilder(true)}
                        >
                          🃏 Mazo
                        </button>
                      </div>
                    </div>

                    {/* PLAY MATCH BUTTON OR ELIMINATED BANNER */}
                    <div className="tourney-play-box">
                      {isMyPartEliminated ? (
                        <div className="tourney-eliminated-box">
                          <div className="tourney-eliminated-banner">
                            🚫 Has quedado eliminado del torneo (3/3 derrotas acumuladas).
                          </div>
                          {isLive && (
                            <div className="tourney-reentry-box">
                              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: '4px 0 10px' }}>
                                ¡El torneo sigue en vivo! Puedes hacer una <strong>Reentrada</strong> conservando todas tus victorias previas.
                              </p>
                              <button
                                type="button"
                                className="tourney-btn-reentry"
                                onClick={handleReenter}
                                disabled={isReentering}
                              >
                                {isReentering ? 'Procesando Reentrada…' : '🔄 Reentrar al Torneo (3 💎 — 2 Vidas)'}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isScheduled ? (
                        <button
                          type="button"
                          className="tourney-btn-battle"
                          disabled
                        >
                          ⏳ Esperando Hora de Inicio ({formatCountdown(startMs)})
                        </button>
                      ) : isEnded ? (
                        <button
                          type="button"
                          className="tourney-btn-battle"
                          disabled
                        >
                          🏁 Torneo Finalizado
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="tourney-btn-battle"
                          onClick={handleStartMatchmaking}
                        >
                          <span>⚔️</span>
                          <span>Buscar Rival de Torneo</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* LEADERBOARD (CLASIFICACIÓN EN VIVO) */}
              <div className="tourney-lb-section">
                <div className="tourney-lb-header">
                  <span>Tabla de Clasificación en Vivo</span>
                  <span style={{ color: '#c084fc', fontSize: '0.78rem' }}>
                    Ordenado por Victorias DESC
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="tourney-lb-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Jugador</th>
                        <th>Victorias</th>
                        <th>Derrotas</th>
                        <th>Estado</th>
                        <th>Premio Estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details?.leaderboard && details.leaderboard.length > 0 ? (
                        details.leaderboard.map((row) => {
                          let prizeText = '—'
                          const pool = selectedTourney.prize_pool_gems || 0
                          if (pool > 0 && row.wins > 0) {
                            if (row.rank === 1) prizeText = `${(pool * 0.5).toFixed(1)} 💎`
                            else if (row.rank === 2) prizeText = `${(pool * 0.3).toFixed(1)} 💎`
                            else if (row.rank === 3) prizeText = `${(pool * 0.2).toFixed(1)} 💎`
                          }

                          return (
                            <tr key={row.user_id} className={row.is_me ? 'is-me' : ''}>
                              <td>
                                {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `${row.rank}º`}
                              </td>
                              <td>
                                {row.username} {row.is_me ? '⭐ (TÚ)' : ''}
                              </td>
                              <td style={{ color: '#4ade80', fontWeight: 800 }}>
                                {row.wins}
                              </td>
                              <td style={{ color: row.losses >= 3 ? '#ef4444' : '#f59e0b' }}>
                                {row.losses} / 3
                              </td>
                              <td>
                                {row.is_eliminated ? (
                                  <span style={{ color: '#f87171', fontSize: '0.75rem' }}>Eliminado</span>
                                ) : (
                                  <span style={{ color: '#4ade80', fontSize: '0.75rem' }}>Activo</span>
                                )}
                              </td>
                              <td style={{ color: '#fbbf24', fontWeight: 700 }}>
                                {prizeText}
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 16 }}>
                            Aún no hay partidas disputadas en este torneo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
              Selecciona un torneo de la lista.
            </div>
          )}
        </div>

        {/* MODAL CREAR TORNEO */}
        {showCreateModal && (
          <div className="tourney-create-modal" onClick={() => setShowCreateModal(false)}>
            <div className="tourney-create-card" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f3e8ff' }}>
                  🏆 Crear Nuevo Torneo
                </h3>
                <button
                  type="button"
                  className="tourney-close-btn"
                  onClick={() => setShowCreateModal(false)}
                >
                  ✕
                </button>
              </div>

              {createError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', padding: '8px 12px', borderRadius: 8, color: '#fca5a5', fontSize: '0.82rem' }}>
                  {createError}
                </div>
              )}

              <form onSubmit={handleConfirmCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="tourney-form-group">
                  <label>Título del Torneo</label>
                  <input
                    type="text"
                    className="tourney-form-input"
                    placeholder="Ej: Copa Relámpago de la Comunidad"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="tourney-form-group">
                  <label>Pozo Inicial de Gemas a Repartir</label>
                  <input
                    type="number"
                    className="tourney-form-input"
                    min="0"
                    step="1"
                    value={createPrizeGems}
                    onChange={(e) => setCreatePrizeGems(Number(e.target.value))}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Se descontará de tu saldo ({userTokens} 💎 disponibles) para garantizar el premio inicial (Top 1, 2 y 3).
                  </span>
                </div>

                <div className="tourney-form-group">
                  <label>Tipo de Entrada para Jugadores</label>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      type="button"
                      className={`tourney-quick-btn ${createEntryType === 'free' ? 'active' : ''}`}
                      style={{ flex: 1, padding: '8px 10px', fontSize: '0.82rem' }}
                      onClick={() => setCreateEntryType('free')}
                    >
                      🎉 Entrada Libre (Free)
                    </button>
                    <button
                      type="button"
                      className={`tourney-quick-btn ${createEntryType === 'gems' ? 'active' : ''}`}
                      style={{ flex: 1, padding: '8px 10px', fontSize: '0.82rem' }}
                      onClick={() => setCreateEntryType('gems')}
                    >
                      💎 Entrada con Gemas
                    </button>
                  </div>
                </div>

                {createEntryType === 'gems' && (
                  <div className="tourney-form-group">
                    <label>Costo de Entrada por Jugador (Gemas)</label>
                    <input
                      type="number"
                      className="tourney-form-input"
                      min="1"
                      step="1"
                      value={createEntryFeeGems}
                      onChange={(e) => setCreateEntryFeeGems(Math.max(1, Number(e.target.value)))}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#c084fc' }}>
                      Las gemas cobradas a cada jugador se sumarán automáticamente al pozo total de premios.
                    </span>
                  </div>
                )}

                <div className="tourney-form-group">
                  <label>Hora de Inicio Programada (Cuenta Regresiva)</label>
                  <div className="tourney-quick-times">
                    {[
                      { label: 'En 1 min', min: 1 },
                      { label: 'En 5 min', min: 5 },
                      { label: 'En 15 min', min: 15 },
                      { label: 'En 30 min', min: 30 },
                      { label: 'En 1 hora', min: 60 },
                    ].map((opt) => (
                      <button
                        key={opt.min}
                        type="button"
                        className={`tourney-quick-btn ${createStartOffsetMin === opt.min ? 'active' : ''}`}
                        onClick={() => setCreateStartOffsetMin(opt.min)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tourney-form-group">
                  <label>Duración del Torneo</label>
                  <div className="tourney-quick-times">
                    {[
                      { label: '30 min', min: 30 },
                      { label: '45 min', min: 45 },
                      { label: '60 min', min: 60 },
                      { label: '120 min', min: 120 },
                    ].map((opt) => (
                      <button
                        key={opt.min}
                        type="button"
                        className={`tourney-quick-btn ${createDurationMin === opt.min ? 'active' : ''}`}
                        onClick={() => setCreateDurationMin(opt.min)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: 10, borderRadius: 8, fontSize: '0.78rem', color: '#d8b4fe' }}>
                  ℹ️ Reglas: 15 plantas 100% desbloqueadas para todos, eliminación a las 3 derrotas y reentrada disponible por 3 💎 (2 vidas).
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    className="tourney-btn-secondary"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="tourney-btn-create"
                    disabled={isCreating}
                  >
                    {isCreating ? 'Creando…' : '✓ Publicar Torneo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* DECK BUILDER MODAL */}
        <TournamentDeckBuilder
          isOpen={showDeckBuilder}
          currentDeck={activeDeckList}
          onSaveDeck={handleSaveDeck}
          onClose={() => setShowDeckBuilder(false)}
        />
      </div>
    </div>
  )
}
