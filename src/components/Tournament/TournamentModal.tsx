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

const MONTHS_ES = [
  { value: 1, label: '01 - Enero' },
  { value: 2, label: '02 - Febrero' },
  { value: 3, label: '03 - Marzo' },
  { value: 4, label: '04 - Abril' },
  { value: 5, label: '05 - Mayo' },
  { value: 6, label: '06 - Junio' },
  { value: 7, label: '07 - Julio' },
  { value: 8, label: '08 - Agosto' },
  { value: 9, label: '09 - Septiembre' },
  { value: 10, label: '10 - Octubre' },
  { value: 11, label: '11 - Noviembre' },
  { value: 12, label: '12 - Diciembre' },
]

function formatUtcDateTime(isoOrMs: string | number): string {
  const d = new Date(isoOrMs)
  if (isNaN(d.getTime())) return ''
  const day = d.getUTCDate().toString().padStart(2, '0')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const mon = months[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  const h = d.getUTCHours().toString().padStart(2, '0')
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  return `${day} ${mon} ${year}, ${h}:${m} UTC`
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
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false)
  const [searchParticipant, setSearchParticipant] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'active' | 'ended'>('active')

  // Modals inside Tournament
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false)
  const [showDeckBuilder, setShowDeckBuilder] = useState<boolean>(false)

  // Create form states
  const [createTitle, setCreateTitle] = useState<string>('')
  const [createPrizeGems, setCreatePrizeGems] = useState<number>(1000)
  const [createEntryType, setCreateEntryType] = useState<'free' | 'gems'>('free')
  const [createEntryFeeGems, setCreateEntryFeeGems] = useState<number>(100)
  const [createStartOffsetMin, setCreateStartOffsetMin] = useState<number>(5)
  const [createDurationMin, setCreateDurationMin] = useState<number>(120)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState<boolean>(false)
  const [isReentering, setIsReentering] = useState<boolean>(false)
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false)

  // Custom UTC Date States (Siempre del año actual)
  const [startMode, setStartMode] = useState<'quick' | 'custom_utc'>('quick')
  const currentYear = useMemo(() => new Date().getUTCFullYear(), [])
  const [customMonth, setCustomMonth] = useState<number>(() => new Date().getUTCMonth() + 1)
  const [customDay, setCustomDay] = useState<number>(() => new Date().getUTCDate())
  const [customHour, setCustomHour] = useState<number>(() => {
    const h = new Date().getUTCHours()
    const m = new Date().getUTCMinutes()
    return m >= 50 ? (h + 1) % 24 : h
  })
  const [customMinute, setCustomMinute] = useState<number>(() => {
    const m = new Date().getUTCMinutes() + 15
    return m % 60
  })

  // Días máximos según el mes seleccionado del año actual
  const maxDaysInSelectedMonth = useMemo(() => {
    if (customMonth === 2) {
      const isLeap = (currentYear % 4 === 0 && currentYear % 100 !== 0) || (currentYear % 400 === 0)
      return isLeap ? 29 : 28
    }
    if ([4, 6, 9, 11].includes(customMonth)) return 30
    return 31
  }, [customMonth, currentYear])

  useEffect(() => {
    if (customDay > maxDaysInSelectedMonth) {
      setCustomDay(maxDaysInSelectedMonth)
    }
  }, [maxDaysInSelectedMonth, customDay])

  // Ticker for countdowns
  const [currentTime, setCurrentTime] = useState<number>(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Timestamp meta para la fecha UTC personalizada
  const customUtcTargetMs = useMemo(() => {
    return Date.UTC(currentYear, customMonth - 1, customDay, customHour, customMinute, 0)
  }, [currentYear, customMonth, customDay, customHour, customMinute])

  const isCustomUtcInFuture = customUtcTargetMs > currentTime

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
    setLoadingDetails(true)
    try {
      const res = await tournamentService.getTournamentDetails(tourneyId)
      setDetails(res)
    } catch (err) {
      console.warn('Error loading tournament details:', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      void loadTournaments()
    }
  }, [isOpen, loadTournaments])

  useEffect(() => {
    if (selectedTourneyId) {
      setSearchParticipant('')
      setDetails(null)
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

  const displayedLeaderboard = useMemo(() => {
    if (!details?.leaderboard || details?.tournament?.id !== selectedTourneyId) return []
    const list = details.leaderboard
    if (!searchParticipant.trim()) return list
    const q = searchParticipant.toLowerCase().trim()
    return list.filter((p) =>
      p.username.toLowerCase().includes(q) || (p.is_me && (q === 'tu' || q === 'tú' || q === 'yo'))
    )
  }, [details, selectedTourneyId, searchParticipant])

  const selectedTourney = useMemo(() => {
    if (details?.tournament && details.tournament.id === selectedTourneyId) {
      return details.tournament
    }
    return tournaments.find((t) => t.id === selectedTourneyId) || null
  }, [details, tournaments, selectedTourneyId])

  const myPart = useMemo(() => {
    if (details?.tournament && details.tournament.id === selectedTourneyId) {
      return details.my_participation
    }
    return null
  }, [details, selectedTourneyId])

  if (!isOpen) return null

  // Time calculations for selected tournament
  const startMs = selectedTourney ? new Date(selectedTourney.start_time).getTime() : 0
  const endMs = selectedTourney ? new Date(selectedTourney.end_time).getTime() : 0

  const isLive = selectedTourney ? currentTime >= startMs && currentTime < endMs : false
  const isScheduled = selectedTourney ? currentTime < startMs : false
  const isEnded = selectedTourney ? currentTime >= endMs || selectedTourney.status === 'ended' : false

  const formatCountdown = (targetMs: number) => {
    const diffSecs = Math.max(0, Math.floor((targetMs - currentTime) / 1000))
    const days = Math.floor(diffSecs / 86400)
    const h = Math.floor((diffSecs % 86400) / 3600)
    const m = Math.floor((diffSecs % 3600) / 60)
    const s = diffSecs % 60
    if (days > 0) {
      return `${days}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`
    }
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

  // Reentry handler (200 gems for 2 lives)
  const handleReenter = async () => {
    if (!selectedTourney || !details?.my_participation?.registered) return
    const reentryCost = 200
    if (userTokens < reentryCost) {
      alert(`Necesitas ${reentryCost} 💎 para reentrar al torneo. Tu saldo actual es: ${userTokens} 💎.`)
      return
    }

    setIsReentering(true)
    try {
      soundManager.playSound('victory', 0.8)
      const res = await tournamentService.reenterTournament(selectedTourney.id)
      if (res.success) {
        onDeductTokens(reentryCost)
        await loadDetails(selectedTourney.id)
        await loadTournaments()
      } else {
        alert(res.error || 'No se pudo procesar la reentrada.')
      }
    } catch (err: any) {
      alert(err?.message || 'Error en reentrada')
    } finally {
      setIsReentering(false)
    }
  }

  // Finalize tournament handler (Distribute gems pool to Top 1, 2, 3)
  const handleFinalizeTournament = async () => {
    if (!selectedTourney) return
    const pool = selectedTourney.prize_pool_gems || 0
    const top1 = Number((pool * 0.5).toFixed(1))
    const top2 = Number((pool * 0.3).toFixed(1))
    const top3 = Number((pool * 0.2).toFixed(1))

    const confirmReparto = window.confirm(
      `¿Deseas liquidar y repartir el pozo oficial de ${pool} Gemas entre los ganadores?\n\n` +
      `🥇 1.er Puesto (50%): ${top1} 💎\n` +
      `🥈 2.º Puesto (30%): ${top2} 💎\n` +
      `🥉 3.er Puesto (20%): ${top3} 💎\n\n` +
      `Esta acción acreditará las gemas directamente a los balances de los jugadores ganadores.`
    )
    if (!confirmReparto) return

    setIsFinalizing(true)
    try {
      soundManager.playSound('victory', 0.9)
      const res = await tournamentService.finalizeTournament(selectedTourney.id)
      if (res.success) {
        alert('🎉 ¡Premios en gemas liquidados y repartidos exitosamente a los ganadores del torneo!')
        await loadDetails(selectedTourney.id)
        await loadTournaments()
      } else {
        alert(res.error || 'No se pudieron repartir los premios del torneo.')
      }
    } catch (err: any) {
      alert(err?.message || 'Error al liquidar premios')
    } finally {
      setIsFinalizing(false)
    }
  }

  // Deck save handler (authoritative 5-plant tourney deck)
  const handleSaveDeck = async (newDeck: PlantId[]) => {
    if (!selectedTourney) return
    const res = await tournamentService.updateTournamentDeck(selectedTourney.id, newDeck)
    if (res.success) {
      setShowDeckBuilder(false)
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

    setIsCreating(true)
    try {
      // Calculate start time
      let startTime: string
      if (startMode === 'custom_utc') {
        const targetMs = Date.UTC(currentYear, customMonth - 1, customDay, customHour, customMinute, 0)
        if (targetMs <= Date.now()) {
          setCreateError('La fecha y hora en UTC debe ser en el futuro (posterior al momento actual).')
          setIsCreating(false)
          return
        }
        startTime = new Date(targetMs).toISOString()
      } else {
        startTime = new Date(Date.now() + createStartOffsetMin * 60 * 1000).toISOString()
      }
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
            <div className="tourney-header__title-text">
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>⏳ Inicia en: {formatCountdown(tStart)}</span>
                          <span style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>📅 {formatUtcDateTime(tStart)}</span>
                        </div>
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
                  {isScheduled && (
                    <div style={{ fontSize: '0.66rem', color: '#cbd5e1', marginTop: 2 }}>
                      📅 {formatUtcDateTime(startMs)}
                    </div>
                  )}
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
                                {isReentering ? 'Procesando Reentrada…' : '🔄 Reentrar al Torneo (200 💎 — 2 Vidas)'}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                          <button
                            type="button"
                            className="tourney-btn-battle"
                            disabled
                          >
                            🏁 Torneo Finalizado
                          </button>
                          {isAdmin && !selectedTourney.prizes_distributed && (
                            <button
                              type="button"
                              className="tourney-btn-reentry"
                              style={{
                                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                borderColor: '#fde047',
                                color: '#1a1000',
                                fontWeight: 900,
                                padding: '12px 16px',
                                fontSize: '0.92rem',
                                boxShadow: '0 0 20px rgba(245, 158, 11, 0.45)',
                              }}
                              onClick={handleFinalizeTournament}
                              disabled={isFinalizing}
                            >
                              {isFinalizing ? '⏳ Repartiendo Premios…' : '🏆 Liquidar y Repartir Premios (Gemas)'}
                            </button>
                          )}
                          {selectedTourney.prizes_distributed && (
                            <div style={{ textAlign: 'center', color: '#4ade80', fontSize: '0.85rem', fontWeight: 800, background: 'rgba(74, 222, 128, 0.12)', padding: '8px 12px', borderRadius: 8, border: '1px solid #22c55e' }}>
                              ✅ Premios del pozo liquidados y entregados a los ganadores (Top 1, 2 y 3).
                            </div>
                          )}
                        </div>
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

              {/* LEADERBOARD (CLASIFICACIÓN COMPLETA Y PARTICIPANTES) */}
              <div className="tourney-lb-section">
                <div className="tourney-lb-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>
                      {isLive
                        ? 'Tabla de Clasificación en Vivo'
                        : isEnded
                        ? 'Tabla de Clasificación Final'
                        : 'Participantes Inscritos'}
                    </span>
                    <span
                      style={{
                        background: 'rgba(192, 132, 252, 0.18)',
                        border: '1px solid rgba(192, 132, 252, 0.45)',
                        color: '#e9d5ff',
                        fontSize: '0.72rem',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontWeight: 800,
                      }}
                    >
                      👥 {details?.leaderboard ? `${details.leaderboard.length} participantes` : 'Cargando…'}
                    </span>
                  </div>
                  <span style={{ color: '#c084fc', fontSize: '0.76rem' }}>
                    Ordenado por Victorias DESC
                  </span>
                </div>

                {/* FILTRO DE BÚSQUEDA RÁPIDA DE PARTICIPANTE */}
                {details?.leaderboard && details.leaderboard.length > 5 && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 2px' }}>
                    <input
                      type="text"
                      className="tourney-form-input"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        background: 'rgba(15, 23, 42, 0.85)',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        borderRadius: 8,
                        color: '#fff',
                        width: '100%',
                        maxWidth: 320,
                      }}
                      placeholder={`🔍 Buscar entre los ${details.leaderboard.length} participantes...`}
                      value={searchParticipant}
                      onChange={(e) => setSearchParticipant(e.target.value)}
                    />
                    {searchParticipant && (
                      <button
                        type="button"
                        onClick={() => setSearchParticipant('')}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid #ef4444',
                          color: '#fca5a5',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                        }}
                      >
                        ✕ Limpiar
                      </button>
                    )}
                  </div>
                )}

                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table className="tourney-lb-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Jugador</th>
                        <th>Victorias</th>
                        <th>Derrotas</th>
                        <th>Estado</th>
                        <th>Premio {isEnded ? 'Obtenido' : 'Estimado'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingDetails && !details ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                            ⏳ Cargando participantes inscritos…
                          </td>
                        </tr>
                      ) : displayedLeaderboard.length > 0 ? (
                        displayedLeaderboard.map((row) => {
                          let prizeText = '—'
                          const pool = selectedTourney.prize_pool_gems || 0
                          if (isEnded && row.prize_awarded_gems && row.prize_awarded_gems > 0) {
                            prizeText = `${Number(row.prize_awarded_gems).toFixed(1)} 💎`
                          } else if (pool > 0 && (row.wins > 0 || isEnded)) {
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
                            {searchParticipant
                              ? `No se encontró ningún participante con "${searchParticipant}".`
                              : 'Aún no hay participantes inscritos en este torneo.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="tourney-detail-empty">
              <div className="tourney-detail-empty__icon">🏆</div>
              <h3 className="tourney-detail-empty__title">Panel de Información</h3>
              <p className="tourney-detail-empty__desc">
                Selecciona un torneo de la lista para ver los premios, consultar la clasificación en tiempo real y entrar a la batalla.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  className="tourney-btn-create"
                  style={{ marginTop: 14 }}
                  onClick={() => setShowCreateModal(true)}
                >
                  <span>➕</span>
                  <span>Crear Nuevo Torneo</span>
                </button>
              )}
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
                  <span style={{ fontSize: '0.75rem', color: '#c084fc' }}>
                    💎 Pozo oficial asignado por administración para premiar a los ganadores (Top 1: 50% • Top 2: 30% • Top 3: 20%). No se descuenta de tu saldo personal.
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
                        className={`tourney-quick-btn ${startMode === 'quick' && createStartOffsetMin === opt.min ? 'active' : ''}`}
                        onClick={() => {
                          setStartMode('quick')
                          setCreateStartOffsetMin(opt.min)
                          const target = new Date(Date.now() + opt.min * 60 * 1000)
                          setCustomMonth(target.getUTCMonth() + 1)
                          setCustomDay(target.getUTCDate())
                          setCustomHour(target.getUTCHours())
                          setCustomMinute(target.getUTCMinutes())
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}

                    <button
                      type="button"
                      className={`tourney-quick-btn ${startMode === 'custom_utc' ? 'active' : ''}`}
                      style={
                        startMode === 'custom_utc'
                          ? { background: 'linear-gradient(135deg, #a855f7, #7e22ce)', borderColor: '#c084fc', color: '#fff' }
                          : undefined
                      }
                      onClick={() => setStartMode('custom_utc')}
                    >
                      📅 Fecha y Hora UTC
                    </button>
                  </div>

                  {startMode === 'custom_utc' ? (
                    <div className="tourney-utc-container">
                      <div className="tourney-utc-picker">
                        <div className="tourney-utc-picker__item" style={{ width: 84 }}>
                          <label>Año (Fijo)</label>
                          <div className="tourney-utc-year-pill">{currentYear}</div>
                        </div>

                        <div className="tourney-utc-picker__item" style={{ flex: 1.5, minWidth: 120 }}>
                          <label>Mes</label>
                          <select
                            className="tourney-utc-select"
                            value={customMonth}
                            onChange={(e) => setCustomMonth(Number(e.target.value))}
                          >
                            {MONTHS_ES.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="tourney-utc-picker__item" style={{ width: 68 }}>
                          <label>Día</label>
                          <select
                            className="tourney-utc-select"
                            value={customDay}
                            onChange={(e) => setCustomDay(Number(e.target.value))}
                          >
                            {Array.from({ length: maxDaysInSelectedMonth }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={d}>
                                {d.toString().padStart(2, '0')}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="tourney-utc-picker__item" style={{ width: 75 }}>
                          <label>Hora UTC</label>
                          <select
                            className="tourney-utc-select"
                            value={customHour}
                            onChange={(e) => setCustomHour(Number(e.target.value))}
                          >
                            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                              <option key={h} value={h}>
                                {h.toString().padStart(2, '0')}:00
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="tourney-utc-picker__item" style={{ width: 75 }}>
                          <label>Min UTC</label>
                          <select
                            className="tourney-utc-select"
                            value={customMinute}
                            onChange={(e) => setCustomMinute(Number(e.target.value))}
                          >
                            {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                              <option key={m} value={m}>
                                :{m.toString().padStart(2, '0')}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="tourney-utc-preview">
                        <div className="tourney-utc-preview__date">
                          🌐 Inicio: <strong>{customDay.toString().padStart(2, '0')}/{customMonth.toString().padStart(2, '0')}/{currentYear} {customHour.toString().padStart(2, '0')}:{customMinute.toString().padStart(2, '0')} UTC</strong>
                        </div>
                        <div className={`tourney-utc-preview__countdown ${isCustomUtcInFuture ? 'is-valid' : 'is-invalid'}`}>
                          {isCustomUtcInFuture
                            ? `⏳ Cuenta regresiva: ${formatCountdown(customUtcTargetMs)}`
                            : '⚠️ La fecha debe ser posterior al momento actual.'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.74rem', color: '#cbd5e1', marginTop: 4 }}>
                      🌐 Inicio UTC calculado: <strong>{formatUtcDateTime(Date.now() + createStartOffsetMin * 60 * 1000)}</strong>
                    </div>
                  )}
                </div>

                <div className="tourney-form-group">
                  <label>Duración del Torneo</label>
                  <div className="tourney-quick-times">
                    {[
                      { label: '45 min', min: 45 },
                      { label: '1 hora (60 min)', min: 60 },
                      { label: '🔥 2 Horas (120 min)', min: 120 },
                      { label: '3 Horas (180 min)', min: 180 },
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
