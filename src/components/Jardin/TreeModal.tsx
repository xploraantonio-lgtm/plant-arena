import React, { useState, useEffect } from 'react'
import { soundManager } from '../../utils/audioManager'
import { supabaseService } from '../../services/supabaseService'
import type { FarmingInventory } from '../../utils/pvpRewardManager'
import './TreeModal.css'

interface TreeModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  userGold: number
  farmingItems: FarmingInventory
  onRewardsChanged?: () => void | Promise<void>
}

type FeedResource = 'water' | 'fertilizer' | 'gold' | 'gems'

const MOTHER_TREE_IMAGE = '/game-assets/greenfoot/mothertree_whitebg.webp'

const LEVEL_NAMES = [
  'Brote Inicial',
  'Árbol Joven',
  'Árbol Fuerte',
  'Árbol Ancestral',
  'Árbol Titánico',
  'Árbol Sagrado Supremo',
]

const LEVEL_XP_REQS = [500, 1200, 1800, 2500, 3000]

export default function TreeModal({
  isOpen,
  onClose,
  userTokens,
  userGold,
  farmingItems,
  onRewardsChanged,
}: TreeModalProps) {
  const [treeLevel, setTreeLevel] = useState<number>(0)
  const [treeXp, setTreeXp] = useState<number>(0)
  const [nextLevelXp, setNextLevelXp] = useState<number>(500)
  const [selectedResource, setSelectedResource] = useState<FeedResource>('water')
  const [amount, setAmount] = useState<number>(1)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [feedbackNotice, setFeedbackNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [leveledUpCelebration, setLeveledUpCelebration] = useState<boolean>(false)

  // Cargar estado del Árbol al abrir
  useEffect(() => {
    if (!isOpen) return
    let active = true

    void supabaseService.getMotherTreeState().then((res) => {
      if (!active) return
      setTreeLevel(res.treeLevel)
      setTreeXp(res.treeXp)
      setNextLevelXp(res.nextLevelXp || 500)
    })

    return () => {
      active = false
    }
  }, [isOpen])

  // Ajustar cantidad predeterminada cuando cambia de recurso
  useEffect(() => {
    if (selectedResource === 'gold') {
      setAmount(50)
    } else {
      setAmount(1)
    }
  }, [selectedResource])

  if (!isOpen) return null

  // Saldos actuales
  const curWater = farmingItems.water || 0
  const curFert = farmingItems.fertilizer || 0
  const curGold = userGold || 0
  const curGems = userTokens || 0

  const getAvailableBalance = (res: FeedResource): number => {
    switch (res) {
      case 'water':
        return curWater
      case 'fertilizer':
        return curFert
      case 'gold':
        return curGold
      case 'gems':
        return curGems
    }
  }

  // Cálculo de XP que aportará la cantidad seleccionada
  const getCalculatedXp = (res: FeedResource, qty: number): number => {
    switch (res) {
      case 'water':
        return qty * 8
      case 'fertilizer':
        return qty * 30
      case 'gold':
        return Math.floor(qty / 10) * 2
      case 'gems':
        return qty * 2
    }
  }

  const currentAvailable = getAvailableBalance(selectedResource)
  const previewXp = getCalculatedXp(selectedResource, amount)
  const isMaxLevel = treeLevel >= 5

  const handleQuickAdd = (delta: number) => {
    soundManager.playSound('click', 0.3)
    setAmount((prev) => {
      const next = Math.max(selectedResource === 'gold' ? 10 : 1, prev + delta)
      return Math.min(next, currentAvailable > 0 ? currentAvailable : next)
    })
  }

  const handleSetMax = () => {
    soundManager.playSound('click', 0.4)
    if (selectedResource === 'gold') {
      const maxGold = Math.floor(currentAvailable / 10) * 10
      setAmount(Math.max(10, maxGold))
    } else {
      setAmount(Math.max(1, currentAvailable))
    }
  }

  const handleFeed = async () => {
    if (isMaxLevel) {
      alert('¡El Árbol Madre ya está en su Nivel Máximo (Nivel 5)!')
      return
    }

    if (amount <= 0) {
      setFeedbackNotice({ type: 'error', msg: 'Ingresa una cantidad mayor a 0.' })
      return
    }

    if (currentAvailable < amount) {
      setFeedbackNotice({
        type: 'error',
        msg: `No tienes suficiente saldo de este recurso (Disponible: ${currentAvailable}).`,
      })
      return
    }

    if (selectedResource === 'gold' && amount < 10) {
      setFeedbackNotice({ type: 'error', msg: 'El aporte mínimo de Oro es de 10.' })
      return
    }

    setIsLoading(true)
    setFeedbackNotice(null)
    soundManager.playSound('click', 0.4)

    const res = await supabaseService.feedMotherTree(selectedResource, amount)
    setIsLoading(false)

    if (!res.success) {
      setFeedbackNotice({ type: 'error', msg: res.error || 'No se pudo nutrir el Árbol.' })
      return
    }

    // Actualizar estado local
    if (typeof res.treeLevel === 'number') setTreeLevel(res.treeLevel)
    if (typeof res.treeXp === 'number') setTreeXp(res.treeXp)
    if (typeof res.nextLevelXp === 'number') setNextLevelXp(res.nextLevelXp)

    // Notificar subida de nivel
    if (res.leveledUp) {
      soundManager.playSound('victory', 0.8)
      setLeveledUpCelebration(true)
      setTimeout(() => setLeveledUpCelebration(false), 4000)
      setFeedbackNotice({
        type: 'success',
        msg: `🎉 ¡EL ÁRBOL MADRE HA SUBIDO AL NIVEL ${res.treeLevel}! (+${(res.treeLevel ?? 0) * 50} HP de Base en combate)`,
      })
    } else {
      soundManager.playSound('select', 0.5)
      setFeedbackNotice({
        type: 'success',
        msg: `🌿 Has nutrido el Árbol (+${res.xpGained ?? previewXp} XP de Savia).`,
      })
    }

    // Resetear cantidad según saldo restante
    if (selectedResource === 'gold') {
      setAmount(Math.min(50, Math.max(10, (currentAvailable - amount))))
    } else {
      setAmount(1)
    }

    // Refrescar inventario y balance global del usuario
    try {
      await onRewardsChanged?.()
    } catch (_) {}
  }

  const currentHp = 600 + treeLevel * 50
  const nextHp = currentHp + 50
  const progressPct = isMaxLevel ? 100 : Math.min(100, Math.max(0, (treeXp / (nextLevelXp || 100)) * 100))

  return (
    <div className="tree-modal-backdrop" onClick={onClose}>
      <div className="tree-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="tree-modal-header">
          <div className="tree-modal-header__info">
            <h2 className="tree-modal-title">🌳 ÁRBOL MADRE ANCESTRAL</h2>
            <p className="tree-modal-subtitle">
              Nutre las raíces sagradas con tus recursos para aumentar la vida de tu base en el campo de batalla.
            </p>
          </div>
          <button type="button" className="tree-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Notificación de feedback */}
        {feedbackNotice && (
          <div className={`tree-modal-notice tree-modal-notice--${feedbackNotice.type}`}>
            {feedbackNotice.msg}
          </div>
        )}

        {/* Banner de subida de nivel */}
        {leveledUpCelebration && (
          <div className="tree-level-up-banner">
            <span className="tree-level-up-banner__glow">✨ ¡ASCENSO SAGRADO! ✨</span>
            <h3>¡ÁRBOL MADRE NIVEL {treeLevel}!</h3>
            <p>Tu base ahora cuenta con <strong>{currentHp} HP</strong> en combate (+50 HP permanente).</p>
          </div>
        )}

        <div className="tree-modal-body">
          {/* COLUMNA IZQUIERDA: ALTAR DE NUTRICIÓN */}
          <div className="tree-modal-left">
            <div className="tree-section-header">
              <h3>🧪 ALTAR DE OFRENDAS</h3>
              <span className="tree-section-sub">Selecciona qué recurso deseas quemar</span>
            </div>

            {/* Selector de los 4 recursos */}
            <div className="tree-resource-grid">
              <button
                type="button"
                className={`tree-res-card ${selectedResource === 'water' ? 'is-active' : ''}`}
                onClick={() => setSelectedResource('water')}
              >
                <div className="tree-res-card__top">
                  <span className="tree-res-card__icon">💧</span>
                  <span className="tree-res-card__name">Agua</span>
                </div>
                <div className="tree-res-card__xp">+8 XP c/u</div>
                <div className="tree-res-card__balance">Saldo: <b>{curWater}</b></div>
              </button>

              <button
                type="button"
                className={`tree-res-card ${selectedResource === 'fertilizer' ? 'is-active' : ''}`}
                onClick={() => setSelectedResource('fertilizer')}
              >
                <div className="tree-res-card__top">
                  <span className="tree-res-card__icon">🌱</span>
                  <span className="tree-res-card__name">Fertilizante</span>
                </div>
                <div className="tree-res-card__xp">+30 XP c/u</div>
                <div className="tree-res-card__balance">Saldo: <b>{curFert}</b></div>
              </button>

              <button
                type="button"
                className={`tree-res-card ${selectedResource === 'gold' ? 'is-active' : ''}`}
                onClick={() => setSelectedResource('gold')}
              >
                <div className="tree-res-card__top">
                  <span className="tree-res-card__icon">💰</span>
                  <span className="tree-res-card__name">Oro</span>
                </div>
                <div className="tree-res-card__xp">+2 XP / 10 Oro</div>
                <div className="tree-res-card__balance">Saldo: <b>{curGold.toLocaleString()}</b></div>
              </button>

              <button
                type="button"
                className={`tree-res-card ${selectedResource === 'gems' ? 'is-active' : ''}`}
                onClick={() => setSelectedResource('gems')}
              >
                <div className="tree-res-card__top">
                  <span className="tree-res-card__icon">💎</span>
                  <span className="tree-res-card__name">Gemas</span>
                </div>
                <div className="tree-res-card__xp">+2 XP c/u</div>
                <div className="tree-res-card__balance">Saldo: <b>{curGems}</b></div>
              </button>
            </div>

            {/* Selector de cantidad */}
            {!isMaxLevel ? (
              <div className="tree-feed-controls">
                <div className="tree-amount-header">
                  <span>Cantidad a entregar:</span>
                  <span className="tree-amount-preview">
                    {previewXp > 0 ? `⚡ Aportará +${previewXp} XP` : '0 XP'}
                  </span>
                </div>

                <div className="tree-amount-row">
                  <input
                    type="number"
                    min={selectedResource === 'gold' ? 10 : 1}
                    max={currentAvailable}
                    step={selectedResource === 'gold' ? 10 : 1}
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 0))}
                    className="tree-amount-input"
                  />
                  <div className="tree-quick-buttons">
                    {selectedResource === 'gold' ? (
                      <>
                        <button type="button" onClick={() => handleQuickAdd(10)}>+10</button>
                        <button type="button" onClick={() => handleQuickAdd(50)}>+50</button>
                        <button type="button" onClick={() => handleQuickAdd(250)}>+250</button>
                        <button type="button" onClick={() => handleQuickAdd(1000)}>+1K</button>
                      </>
                    ) : selectedResource === 'gems' ? (
                      <>
                        <button type="button" onClick={() => handleQuickAdd(1)}>+1</button>
                        <button type="button" onClick={() => handleQuickAdd(5)}>+5</button>
                        <button type="button" onClick={() => handleQuickAdd(10)}>+10</button>
                        <button type="button" onClick={() => handleQuickAdd(25)}>+25</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => handleQuickAdd(1)}>+1</button>
                        <button type="button" onClick={() => handleQuickAdd(2)}>+2</button>
                        <button type="button" onClick={() => handleQuickAdd(5)}>+5</button>
                        <button type="button" onClick={() => handleQuickAdd(10)}>+10</button>
                      </>
                    )}
                    <button type="button" className="tree-btn-max" onClick={handleSetMax}>
                      MÁX
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="tree-submit-feed-btn"
                  onClick={handleFeed}
                  disabled={isLoading || currentAvailable < amount || amount <= 0}
                >
                  {isLoading ? 'NUTRINDO ÁRBOL...' : `🌿 NUTRIR ÁRBOL (+${previewXp} XP)`}
                </button>
              </div>
            ) : (
              <div className="tree-maxed-box">
                <span className="tree-maxed-badge">👑 ÁRBOL SAGRADO AL MÁXIMO</span>
                <p>Has alcanzado el Nivel 5. Tu base cuenta con la máxima bendición ancestral (+250 HP).</p>
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA: EL ÁRBOL SAGRADO & ESTADÍSTICAS */}
          <div className="tree-modal-right">
            <div className="tree-visual-card">
              <div className="tree-badge-pill">
                <span className="tree-badge-lvl">NIVEL {treeLevel} / 5</span>
                <span className="tree-badge-title">{LEVEL_NAMES[treeLevel] || 'Árbol Sagrado'}</span>
              </div>

              {/* Imagen del árbol base del campo de batalla */}
              <div className="tree-img-container">
                <div className={`tree-aura-glow tree-aura-glow--lvl${treeLevel}`} />
                <img
                  src={MOTHER_TREE_IMAGE}
                  alt="Árbol Madre"
                  className={`tree-display-img tree-display-img--lvl${treeLevel}`}
                />
              </div>

              {/* Barra de progreso de XP */}
              <div className="tree-progress-wrap">
                <div className="tree-progress-labels">
                  <span>Savia Acumulada</span>
                  <span>
                    {isMaxLevel ? 'MAX' : `${treeXp} / ${nextLevelXp} XP (${Math.round(progressPct)}%)`}
                  </span>
                </div>
                <div className="tree-progress-bar">
                  <div
                    className="tree-progress-fill"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Estadísticas de combate */}
              <div className="tree-stats-row">
                <div className="tree-stat-box">
                  <span className="tree-stat-label">Vida Actual en Base</span>
                  <span className="tree-stat-val tree-stat-val--hp">
                    ❤️ {currentHp} HP
                  </span>
                  <small>Base 600 + {treeLevel * 50} Extra</small>
                </div>

                <div className="tree-stat-box">
                  <span className="tree-stat-label">Próximo Nivel</span>
                  {isMaxLevel ? (
                    <span className="tree-stat-val tree-stat-val--max">👑 MÁXIMO</span>
                  ) : (
                    <span className="tree-stat-val tree-stat-val--bonus">
                      🛡️ +50 HP ({nextHp} HP)
                    </span>
                  )}
                  <small>{isMaxLevel ? 'Poder completado' : `Requiere ${nextLevelXp - treeXp} XP más`}</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
