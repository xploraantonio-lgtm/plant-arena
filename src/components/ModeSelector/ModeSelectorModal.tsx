import { useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import './ModeSelectorModal.css'

/**
 * Letras y números sin parecidos, igual que en los códigos de referido: un código
 * de sala se dicta por voz o se manda por WhatsApp y se teclea a mano.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRTUVWXY2346789'

function codigoNuevo(): string {
  let c = ''
  for (let i = 0; i < 6; i++) {
    c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  }
  return c
}

interface ModeSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  userElo: number
  userTokens: number
  colosseumTickets: number
  onSelectRanked: () => void
  onSelectColosseum: () => void
  onSelectTournament?: () => void
  /**
   * Entra a un duelo amistoso.
   *
   * El código hace la sala privada: el servidor sólo empareja a quien tenga
   * EXACTAMENTE el mismo, así que a tu sala no entra nadie más. Y la apuesta tiene
   * que ser la misma en los dos — eso ES el acuerdo, sin necesidad de negociar.
   */
  onSelectFriendly?: (roomCode: string, betGems: number) => void
  /**
   * Tope de la apuesta, sólo para el cuadro. El de verdad lo comprueba el
   * servidor (shop_config.amistoso_apuesta_maxima); esto es para no dejar escribir
   * un número que se va a rechazar.
   */
  apuestaMaximaAmistoso?: number
}

export default function ModeSelectorModal({
  isOpen,
  onClose,
  userElo,
  userTokens,
  colosseumTickets,
  onSelectRanked,
  onSelectColosseum,
  onSelectTournament,
  onSelectFriendly,
  apuestaMaximaAmistoso = 100,
}: ModeSelectorModalProps) {
  const [subModal, setSubModal] = useState<'none' | 'friendly'>('none')
  const [codigo, setCodigo] = useState('')
  const [apuesta, setApuesta] = useState(0)
  const [copiado, setCopiado] = useState(false)

  if (!isOpen) return null

  const isColosseumUnlocked = userElo >= 1601
  const eloNeeded = Math.max(0, 1601 - userElo)

  const handleOpenTournament = () => {
    soundManager.playSound('click', 0.4)
    onClose()
    if (onSelectTournament) {
      onSelectTournament()
    }
  }

  return (
    <div className="mode-selector-backdrop" onClick={onClose}>
      <div className="mode-selector-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="mode-selector-header">
          <div className="mode-selector-title-box">
            <span className="mode-selector-icon">⚔️</span>
            <div>
              <h2 className="mode-selector-title">SELECCIONA MODO DE JUEGO</h2>
              <p className="mode-selector-subtitle">
                Tu Rango Actual: <strong>{userElo} 🏆</strong> | Saldo: <strong>{userTokens} 💎</strong> | Tickets: <strong>{colosseumTickets} 🎟️</strong>
              </p>
            </div>
          </div>
          <button type="button" className="mode-selector-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 4 GAME MODES GRID */}
        <div className="mode-selector-grid-4">
          {/* 1. MODO RANKED */}
          <div
            className="mode-card mode-card--ranked"
            onClick={() => {
              soundManager.playSound('click', 0.5)
              onClose()
              onSelectRanked()
            }}
          >
            <div className="mode-card__badge mode-card__badge--free">GRATIS</div>
            <div className="mode-card__icon">🏆</div>
            <h3 className="mode-card__name">RANKED GLOBAL</h3>
            <p className="mode-card__desc">
              Escala en el ranking mundial por copas de ELO, desbloquea nuevas arenas y gana sobres de batalla en tus 4 slots.
            </p>
            <div className="mode-card__perks">
              <span>✅ 100% Gratuito e Ilimitado</span>
              <span>✅ Suma copas para el Ranking ELO</span>
              <span>✅ Gana sobres de batalla</span>
            </div>
            <button type="button" className="mode-card__action-btn mode-card__action-btn--ranked">
              ⚔️ JUGAR RANKED
            </button>
          </div>

          {/* 2. MODO AMISTOSO */}
          <div
            className="mode-card mode-card--friendly"
            onClick={() => {
              soundManager.playSound('click', 0.4)
              // Se propone un código nuevo al abrir: quien crea la sala lo
              // comparte, y quien se une lo escribe encima.
              if (!codigo) setCodigo(codigoNuevo())
              setSubModal('friendly')
            }}
          >
            <div className="mode-card__badge mode-card__badge--friendly">SIN COPAS</div>
            <div className="mode-card__icon">🤝</div>
            <h3 className="mode-card__name">DUELO AMISTOSO</h3>
            <p className="mode-card__desc">
              Reta a un amigo con un código de sala privada. Sin copas en juego, y
              con apuesta si los dos queréis.
            </p>
            <div className="mode-card__perks">
              <span>🔑 Sala privada con código</span>
              <span>🛡️ No mueve tus copas</span>
              <span style={{ color: '#fbbf24' }}>💎 Apuesta opcional, el ganador se lo lleva todo</span>
            </div>
            <button
              type="button"
              className="mode-card__action-btn mode-card__action-btn--friendly"
            >
              🤝 JUGAR CON UN AMIGO
            </button>
          </div>

          {/* 3. MODO TORNEO */}
          <div className="mode-card mode-card--tournament" onClick={handleOpenTournament}>
            <div className="mode-card__badge mode-card__badge--dev">EVENTOS DEV</div>
            <div className="mode-card__icon">🎪</div>
            <h3 className="mode-card__name">TORNEOS OFICIALES</h3>
            <p className="mode-card__desc">
              Copas relámpago y torneos especiales creados y patrocinados por los desarrolladores con premios comunitarios.
            </p>
            <div className="mode-card__perks">
              <span>✅ Torneos de Fin de Semana</span>
              <span>✅ Brackets eliminatorios</span>
              <span>✅ Pozos de la comunidad</span>
            </div>
            <button type="button" className="mode-card__action-btn mode-card__action-btn--tournament">
              🎪 VER TORNEOS
            </button>
          </div>

          {/* 4. EL COLISEO (1601+ COPAS) */}
          <div
            className={`mode-card mode-card--colosseum ${!isColosseumUnlocked ? 'mode-card--locked' : ''}`}
            onClick={() => {
              if (isColosseumUnlocked) {
                soundManager.playSound('click', 0.5)
                onClose()
                onSelectColosseum()
              } else {
                soundManager.playSound('click', 0.3)
              }
            }}
          >
            <div
              className={`mode-card__badge ${
                isColosseumUnlocked ? 'mode-card__badge--comp' : 'mode-card__badge--locked'
              }`}
            >
              {isColosseumUnlocked ? '💎 COMPETITIVO' : '🔒 1,601 🏆'}
            </div>
            <div className="mode-card__icon">{isColosseumUnlocked ? '🏛️' : '🔒'}</div>
            <h3 className="mode-card__name">EL COLISEO</h3>
            <p className="mode-card__desc">
              Duelos PvP de alto nivel por Gemas 💎 y Tickets. El ganador se lleva el 80% del pozo y escala el Top de Rachas.
            </p>
            <div className="mode-card__perks">
              {isColosseumUnlocked ? (
                <>
                  <span>💎 Salas de 0.5, 1.0 y 2.0 Gemas</span>
                  <span>🎟️ Válido con Tickets de Coliseo ({colosseumTickets})</span>
                  <span>🔥 Top 1: 20 💎 | Top 2: 10 💎 | Top 3: 5 💎</span>
                </>
              ) : (
                <>
                  <span style={{ color: '#f87171' }}>🔒 Bloqueado: Requiere 1,601 🏆</span>
                  <span style={{ color: '#fbbf24' }}>Te faltan {eloNeeded} copas de ELO</span>
                  <span>Juega Ranked para desbloquearlo</span>
                </>
              )}
            </div>
            <button
              type="button"
              className={`mode-card__action-btn ${
                isColosseumUnlocked ? 'mode-card__action-btn--colosseum' : 'mode-card__action-btn--disabled'
              }`}
              disabled={!isColosseumUnlocked}
            >
              {isColosseumUnlocked ? '🏛️ ENTRAR AL COLISEO' : `🔒 BLOQUEADO (${eloNeeded} 🏆)`}
            </button>
          </div>
        </div>

        {/* ── EL DUELO AMISTOSO ──────────────────────────────────────────────
            Un código y una cantidad. El código hace la sala privada; la cantidad,
            si es la misma en los dos, es la apuesta.

            No hay un "¿aceptas?" porque no hace falta: el servidor sólo empareja
            a quien puso el MISMO código y la MISMA cantidad. Poner lo mismo es el
            acuerdo. */}
        {subModal === 'friendly' && (
          <div className="friendly-panel">
            <h3 className="friendly-panel__titulo">🤝 Duelo amistoso</h3>
            <p className="friendly-panel__nota">
              Comparte el código con tu amigo. Sólo entrará a tu sala quien lo
              tenga, y tenéis que poner los dos la misma apuesta.
            </p>

            <label className="friendly-panel__etiqueta" htmlFor="codigo-sala">
              Código de la sala
            </label>
            <div className="friendly-panel__fila">
              <input
                id="codigo-sala"
                className="friendly-panel__codigo"
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 12))}
                maxLength={12}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="friendly-panel__btn"
                onClick={() => {
                  setCodigo(codigoNuevo())
                  setCopiado(false)
                }}
                title="Generar otro código"
              >
                🎲
              </button>
              <button
                type="button"
                className="friendly-panel__btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(codigo).then(
                    () => setCopiado(true),
                    // Si el portapapeles se niega, el código está a la vista para
                    // copiarlo a mano: es lo único que hace falta.
                    () => setCopiado(false)
                  )
                }}
              >
                {copiado ? '✓' : '📋'}
              </button>
            </div>

            <label className="friendly-panel__etiqueta" htmlFor="apuesta-sala">
              Apuesta (0 = sin apuesta)
            </label>
            <div className="friendly-panel__fila">
              <input
                id="apuesta-sala"
                className="friendly-panel__apuesta"
                type="number"
                min={0}
                max={Math.min(apuestaMaximaAmistoso, userTokens)}
                step={1}
                value={apuesta}
                onChange={(e) =>
                  setApuesta(
                    Math.max(
                      0,
                      Math.min(
                        Math.floor(Number(e.target.value) || 0),
                        apuestaMaximaAmistoso,
                        userTokens
                      )
                    )
                  )
                }
              />
              <span className="friendly-panel__gemas">💎</span>
            </div>

            {apuesta > 0 && (
              <p className="friendly-panel__aviso">
                Ponéis {apuesta} 💎 cada uno. El que gane se lleva{' '}
                <strong>{apuesta * 2} 💎</strong>; el que pierda, nada. Se te cobra
                al entrar a la sala y se devuelve si la partida no llega a jugarse.
              </p>
            )}

            <div className="friendly-panel__acciones">
              <button
                type="button"
                className="friendly-panel__btn"
                onClick={() => setSubModal('none')}
              >
                Volver
              </button>
              <button
                type="button"
                className="mode-card__action-btn mode-card__action-btn--friendly"
                disabled={codigo.trim().length < 4}
                onClick={() => {
                  soundManager.playSound('click', 0.5)
                  onClose()
                  onSelectFriendly?.(codigo.trim(), apuesta)
                }}
              >
                {apuesta > 0 ? `🤝 ENTRAR Y APOSTAR ${apuesta} 💎` : '🤝 ENTRAR A LA SALA'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
