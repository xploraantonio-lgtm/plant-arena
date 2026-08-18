import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { soundManager } from '../../utils/audioManager'
import type { Database } from '../../types/database.types'
import './AdminPanel.css'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type SeasonRow = Database['public']['Tables']['seasons']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

interface AdminPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function AdminPanel({ isOpen, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'tournaments' | 'seasons' | 'players'>('tournaments')
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [players, setPlayers] = useState<ProfileRow[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  // Tournament Form state
  const [tourneyTitle, setTourneyTitle] = useState('')
  const [tourneyType, setTourneyType] = useState<'free_code' | 'paid'>('free_code')
  const [tourneyCode, setTourneyCode] = useState('ARENA2026')
  const [tourneyEntryGems, setTourneyEntryGems] = useState(0)
  const [tourneyDurationMins, setTourneyDurationMins] = useState(60)
  const [tourneyStartsInMins, setTourneyStartsInMins] = useState(5)

  // Season Form state
  const [seasonNumber, setSeasonNumber] = useState(1)
  const [seasonName, setSeasonName] = useState('Temporada 1: Cosecha de Gloria')
  const [seasonDurationDays, setSeasonDurationDays] = useState(30)
  const [top1EloReward, setTop1EloReward] = useState(100)
  const [top2EloReward, setTop2EloReward] = useState(50)
  const [top3EloReward, setTop3EloReward] = useState(25)
  const [top1ColoReward, setTop1ColoReward] = useState(50)
  const [top2ColoReward, setTop2ColoReward] = useState(25)
  const [top3ColoReward, setTop3ColoReward] = useState(10)

  // Player search
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<ProfileRow | null>(null)
  const [adjustGems, setAdjustGems] = useState(0)
  const [adjustGold, setAdjustGold] = useState(0)
  const [adjustElo, setAdjustElo] = useState(0)

  useEffect(() => {
    if (isOpen) {
      loadAllData()
    }
  }, [isOpen])

  const showNotice = (msg: string) => {
    setStatusNotice(msg)
    setTimeout(() => setStatusNotice(null), 3500)
  }

  const loadAllData = async () => {
    if (!isSupabaseConfigured()) {
      showNotice('⚠️ Supabase no está conectado todavía. Usando modo de prueba local.')
      return
    }
    setIsLoading(true)
    try {
      const [tRes, sRes, pRes] = await Promise.all([
        supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
        supabase.from('seasons').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(20),
      ])

      if (tRes.data) setTournaments(tRes.data)
      if (sRes.data) {
        setSeasons(sRes.data)
        if (sRes.data.length > 0) {
          const cur = sRes.data[0]
          setSeasonNumber(cur.season_number)
          setSeasonName(cur.name)
          setTop1EloReward(cur.top1_elo_reward)
          setTop2EloReward(cur.top2_elo_reward)
          setTop3EloReward(cur.top3_elo_reward)
          setTop1ColoReward(cur.top1_colosseum_reward)
          setTop2ColoReward(cur.top2_colosseum_reward)
          setTop3ColoReward(cur.top3_colosseum_reward)
        }
      }
      if (pRes.data) setPlayers(pRes.data)
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  // CREATE TOURNAMENT IN SUPABASE
  const handleCreateTournament = async () => {
    if (!tourneyTitle.trim()) {
      alert('Ingresa un título para el torneo')
      return
    }
    const startsAt = new Date(Date.now() + tourneyStartsInMins * 60 * 1000).toISOString()
    const endsAt = new Date(Date.now() + (tourneyStartsInMins + tourneyDurationMins) * 60 * 1000).toISOString()

    const newTourney: Database['public']['Tables']['tournaments']['Insert'] = {
      title: tourneyTitle,
      type: tourneyType,
      access_code: tourneyType === 'free_code' ? tourneyCode.toUpperCase() : null,
      entry_cost_gems: tourneyType === 'paid' ? tourneyEntryGems : 0,
      duration_minutes: tourneyDurationMins,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'scheduled',
    }

    if (isSupabaseConfigured()) {
      setIsLoading(true)
      const { error } = await (supabase.from('tournaments') as any).insert(newTourney)
      if (error) {
        alert('Error al crear torneo: ' + error.message)
      } else {
        soundManager.playSound('victory', 0.8)
        showNotice('✅ ¡Torneo publicado exitosamente en Supabase!')
        setTourneyTitle('')
        loadAllData()
      }
      setIsLoading(false)
    } else {
      showNotice('✅ Torneo guardado en memoria local.')
    }
  }

  // UPDATE TOURNAMENT STATUS (LIVE / FINISHED)
  const handleUpdateTournamentStatus = async (id: string, newStatus: 'scheduled' | 'live' | 'finished') => {
    if (!isSupabaseConfigured()) return
    setIsLoading(true)
    const { error } = await (supabase.from('tournaments') as any)
      .update({ status: newStatus })
      .eq('id', id)
    if (!error) {
      showNotice(`✅ Estado del torneo actualizado a: ${newStatus.toUpperCase()}`)
      loadAllData()
    }
    setIsLoading(false)
  }

  // SAVE OR CREATE SEASON IN SUPABASE
  const handleSaveSeason = async () => {
    const startsAt = new Date().toISOString()
    const endsAt = new Date(Date.now() + seasonDurationDays * 24 * 60 * 60 * 1000).toISOString()

    const seasonData: Database['public']['Tables']['seasons']['Insert'] = {
      season_number: seasonNumber,
      name: seasonName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'active',
      top1_elo_reward: top1EloReward,
      top2_elo_reward: top2EloReward,
      top3_elo_reward: top3EloReward,
      top1_colosseum_reward: top1ColoReward,
      top2_colosseum_reward: top2ColoReward,
      top3_colosseum_reward: top3ColoReward,
      is_current: true,
    }

    if (isSupabaseConfigured()) {
      setIsLoading(true)
      const { error } = await (supabase.from('seasons') as any).insert(seasonData)
      if (error) {
        alert('Error al guardar temporada: ' + error.message)
      } else {
        soundManager.playSound('victory', 0.8)
        showNotice('✅ ¡Temporada y Premios actualizados en Supabase!')
        loadAllData()
      }
      setIsLoading(false)
    } else {
      showNotice('✅ Temporada guardada en memoria local.')
    }
  }

  // SAVE PLAYER ADJUSTMENTS
  const handleSavePlayerChanges = async () => {
    if (!selectedPlayer || !isSupabaseConfigured()) return
    setIsLoading(true)
    const updates: Database['public']['Tables']['profiles']['Update'] = {
      gems_balance: Number((selectedPlayer.gems_balance + adjustGems).toFixed(2)),
      gold_balance: selectedPlayer.gold_balance + adjustGold,
      elo_rating: Math.max(0, selectedPlayer.elo_rating + adjustElo),
    }

    const { error } = await (supabase.from('profiles') as any)
      .update(updates)
      .eq('id', selectedPlayer.id)

    if (!error) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ Saldo actualizado para ${selectedPlayer.username}`)
      setAdjustGems(0)
      setAdjustGold(0)
      setAdjustElo(0)
      setSelectedPlayer(null)
      loadAllData()
    }
    setIsLoading(false)
  }

  if (!isOpen) return null

  return (
    <div className="admin-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="admin-header">
          <div className="admin-header__title-box">
            <span className="admin-header__icon">🛡️</span>
            <div>
              <h2 className="admin-header__title">PANEL DE ADMINISTRACIÓN CENTRAL</h2>
              <p className="admin-header__subtitle">
                Gestión en tiempo real de Torneos, Fechas, Premios de Temporada y Economía
              </p>
            </div>
          </div>

          <div className="admin-header__actions">
            <span className={`admin-status-badge ${isSupabaseConfigured() ? 'admin-status-badge--online' : 'admin-status-badge--offline'}`}>
              {isSupabaseConfigured() ? '🟢 Supabase Conectado' : '🟡 Modo Local (Sin .env)'}
            </span>
            <button type="button" className="admin-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* STATUS NOTICE */}
        {statusNotice && <div className="admin-alert-banner">{statusNotice}</div>}

        {/* NAVIGATION TABS */}
        <div className="admin-tabs">
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'tournaments' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('tournaments')}
          >
            🎪 Torneos Oficiales ({tournaments.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'seasons' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('seasons')}
          >
            🏆 Temporadas y Premios ({seasons.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'players' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('players')}
          >
            👥 Jugadores y Economía
          </button>
        </div>

        {/* TAB 1: TOURNAMENTS */}
        {activeTab === 'tournaments' && (
          <div className="admin-content-section">
            <div className="admin-grid-2col">
              {/* CREATE FORM */}
              <div className="admin-card">
                <h3>➕ Crear Nuevo Torneo</h3>
                <div className="admin-form-group">
                  <label>Título del Torneo:</label>
                  <input
                    type="text"
                    placeholder="ej: Copa Verano 2026"
                    value={tourneyTitle}
                    onChange={(e) => setTourneyTitle(e.target.value)}
                  />
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label>Tipo de Entrada:</label>
                    <select
                      value={tourneyType}
                      onChange={(e) => setTourneyType(e.target.value as any)}
                    >
                      <option value="free_code">Gratis (Con Código)</option>
                      <option value="paid">De Pago (Gemas 💎)</option>
                    </select>
                  </div>

                  {tourneyType === 'free_code' ? (
                    <div className="admin-form-group">
                      <label>Código de Acceso:</label>
                      <input
                        type="text"
                        value={tourneyCode}
                        onChange={(e) => setTourneyCode(e.target.value.toUpperCase())}
                      />
                    </div>
                  ) : (
                    <div className="admin-form-group">
                      <label>Costo de Entrada (Gemas):</label>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={tourneyEntryGems}
                        onChange={(e) => setTourneyEntryGems(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label>Inicia en (Minutos):</label>
                    <input
                      type="number"
                      min="1"
                      value={tourneyStartsInMins}
                      onChange={(e) => setTourneyStartsInMins(Number(e.target.value))}
                    />
                  </div>

                  <div className="admin-form-group">
                    <label>Duración (Minutos):</label>
                    <input
                      type="number"
                      min="10"
                      value={tourneyDurationMins}
                      onChange={(e) => setTourneyDurationMins(Number(e.target.value))}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="admin-submit-btn"
                  onClick={handleCreateTournament}
                  disabled={isLoading}
                >
                  🚀 PUBLICAR TORNEO EN SUPABASE
                </button>
              </div>

              {/* LIST OF ACTIVE TOURNAMENTS */}
              <div className="admin-card">
                <h3>📋 Torneos en Base de Datos</h3>
                <div className="admin-tourney-list">
                  {tournaments.length === 0 ? (
                    <p className="admin-empty-text">No hay torneos registrados en Supabase.</p>
                  ) : (
                    tournaments.map((t) => (
                      <div key={t.id} className="admin-tourney-item">
                        <div className="admin-tourney-item__info">
                          <strong>{t.title}</strong>
                          <small>
                            Tipo: {t.type === 'free_code' ? `Código: ${t.access_code}` : `${t.entry_cost_gems} Gemas`} | Estado: <span className={`status-${t.status}`}>{t.status.toUpperCase()}</span>
                          </small>
                        </div>
                        <div className="admin-tourney-item__actions">
                          {t.status === 'scheduled' && (
                            <button
                              type="button"
                              className="admin-action-btn--green"
                              onClick={() => handleUpdateTournamentStatus(t.id, 'live')}
                            >
                              🔴 Forzar En Vivo
                            </button>
                          )}
                          {t.status === 'live' && (
                            <button
                              type="button"
                              className="admin-action-btn--red"
                              onClick={() => handleUpdateTournamentStatus(t.id, 'finished')}
                            >
                              🏁 Finalizar
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SEASONS & PRIZES */}
        {activeTab === 'seasons' && (
          <div className="admin-content-section">
            <div className="admin-card">
              <h3>🏆 Configuración de Temporada y Premios Oficiales</h3>
              <p className="admin-card-desc">
                Define las fechas de apertura/cierre y las recompensas oficiales que se mostrarán en la tabla de clasificación.
              </p>

              <div className="admin-form-row">
                <div className="admin-form-group">
                  <label>Número de Temporada:</label>
                  <input
                    type="number"
                    min="1"
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(Number(e.target.value))}
                  />
                </div>
                <div className="admin-form-group" style={{ flex: 2 }}>
                  <label>Nombre de la Temporada:</label>
                  <input
                    type="text"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                  />
                </div>
                <div className="admin-form-group">
                  <label>Duración (Días):</label>
                  <input
                    type="number"
                    min="1"
                    value={seasonDurationDays}
                    onChange={(e) => setSeasonDurationDays(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="admin-rewards-grid">
                <div className="admin-reward-box">
                  <h4>🎖️ Premios del Ranking ELO (Copas)</h4>
                  <div className="admin-reward-row">
                    <span>🥇 Top 1 ELO:</span>
                    <input
                      type="number"
                      value={top1EloReward}
                      onChange={(e) => setTop1EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥈 Top 2 ELO:</span>
                    <input
                      type="number"
                      value={top2EloReward}
                      onChange={(e) => setTop2EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥉 Top 3 ELO:</span>
                    <input
                      type="number"
                      value={top3EloReward}
                      onChange={(e) => setTop3EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                </div>

                <div className="admin-reward-box">
                  <h4>🏛️ Premios del Coliseo (Racha Máxima)</h4>
                  <div className="admin-reward-row">
                    <span>🥇 Top 1 Coliseo:</span>
                    <input
                      type="number"
                      value={top1ColoReward}
                      onChange={(e) => setTop1ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥈 Top 2 Coliseo:</span>
                    <input
                      type="number"
                      value={top2ColoReward}
                      onChange={(e) => setTop2ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥉 Top 3 Coliseo:</span>
                    <input
                      type="number"
                      value={top3ColoReward}
                      onChange={(e) => setTop3ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="admin-submit-btn"
                onClick={handleSaveSeason}
                disabled={isLoading}
                style={{ marginTop: 16 }}
              >
                💾 GUARDAR TEMPORADA Y PREMIOS EN SUPABASE
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: PLAYERS & ECONOMY */}
        {activeTab === 'players' && (
          <div className="admin-content-section">
            <div className="admin-card">
              <h3>👥 Gestión de Jugadores y Saldo</h3>
              <div className="admin-search-row">
                <input
                  type="text"
                  placeholder="Buscar jugador por username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="admin-players-table">
                <div className="admin-table-row admin-table-row--head">
                  <span>Username</span>
                  <span>Copas ELO</span>
                  <span>Gemas 💎</span>
                  <span>Oro 🪙</span>
                  <span>Acción</span>
                </div>
                {players
                  .filter((p) => p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((p) => (
                    <div key={p.id} className="admin-table-row">
                      <span><strong>{p.username}</strong></span>
                      <span>{p.elo_rating} 🏆</span>
                      <span style={{ color: '#c084fc' }}>{p.gems_balance} 💎</span>
                      <span style={{ color: '#fbbf24' }}>{p.gold_balance} 🪙</span>
                      <span>
                        <button
                          type="button"
                          className="admin-edit-player-btn"
                          onClick={() => setSelectedPlayer(p)}
                        >
                          Ajustar Saldo
                        </button>
                      </span>
                    </div>
                  ))}
              </div>

              {selectedPlayer && (
                <div className="admin-adjust-box">
                  <h4>Ajustar saldo para: <strong>{selectedPlayer.username}</strong></h4>
                  <div className="admin-adjust-grid">
                    <div className="admin-form-group">
                      <label>Sumar/Restar Gemas 💎:</label>
                      <input
                        type="number"
                        value={adjustGems}
                        onChange={(e) => setAdjustGems(Number(e.target.value))}
                      />
                    </div>
                    <div className="admin-form-group">
                      <label>Sumar/Restar Oro 🪙:</label>
                      <input
                        type="number"
                        value={adjustGold}
                        onChange={(e) => setAdjustGold(Number(e.target.value))}
                      />
                    </div>
                    <div className="admin-form-group">
                      <label>Sumar/Restar Copas ELO:</label>
                      <input
                        type="number"
                        value={adjustElo}
                        onChange={(e) => setAdjustElo(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="admin-adjust-actions">
                    <button
                      type="button"
                      className="admin-cancel-btn"
                      onClick={() => setSelectedPlayer(null)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="admin-submit-btn"
                      onClick={handleSavePlayerChanges}
                    >
                      Guardar Cambios en Supabase
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
