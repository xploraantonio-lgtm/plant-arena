import { useState, useEffect, useCallback } from 'react'
import gemaIcon from '../../assets/ico/gema.webp'
import { soundManager } from '../../utils/audioManager'
import { inventoryService } from '../../services/inventoryService'
import './FlashOfferModal.css'

interface FlashOfferModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  onPurchaseSuccess?: (spentGems: number, qty: number) => void
  onRechargeGems?: () => void
}

export default function FlashOfferModal({
  isOpen,
  onClose,
  userTokens,
  onPurchaseSuccess,
  onRechargeGems,
}: FlashOfferModalProps) {
  const [loading, setLoading] = useState(false)
  const [buying, setBuying] = useState(false)
  const [userBought, setUserBought] = useState(0)
  const [remainingPurchases, setRemainingPurchases] = useState(3)
  const [priceGems] = useState(30)
  const [selectedQty, setSelectedQty] = useState(1)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await inventoryService.getFlashOfferStatus('flash_jalapeno_30')
      if (res && res.success) {
        setUserBought(res.userBought)
        setRemainingPurchases(res.remainingPurchases)
        if (res.remainingPurchases > 0 && selectedQty > res.remainingPurchases) {
          setSelectedQty(res.remainingPurchases)
        }
      }
    } catch (e) {
      console.warn('Error al consultar estado de oferta flash:', e)
    } finally {
      setLoading(false)
    }
  }, [selectedQty])

  useEffect(() => {
    if (isOpen) {
      soundManager.playSound('click', 0.5)
      void loadStatus()
      setStatusMessage(null)
    }
  }, [isOpen, loadStatus])

  // Manejo de tecla Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundManager.playSound('click', 0.4)
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const isSoldOut = remainingPurchases <= 0
  const maxCanBuy = Math.min(remainingPurchases, 3)
  const totalCost = priceGems * selectedQty
  const canAfford = userTokens >= totalCost
  const missingGems = Math.max(0, totalCost - userTokens)

  const handleQtySelect = (qty: number) => {
    if (qty < 1 || qty > maxCanBuy || buying) return
    soundManager.playSound('click', 0.4)
    setSelectedQty(qty)
  }

  const handleQtyChange = (delta: number) => {
    soundManager.playSound('click', 0.4)
    setSelectedQty((prev) => {
      const next = prev + delta
      return Math.max(1, Math.min(next, Math.max(1, maxCanBuy)))
    })
  }

  const handleBuy = async () => {
    if (isSoldOut || buying || selectedQty <= 0) return

    if (!canAfford) {
      soundManager.playSound('click', 0.5)
      if (onRechargeGems) {
        onRechargeGems()
        return
      }
      setStatusMessage({
        text: `Gemas insuficientes: necesitas ${totalCost} 💎 y tienes ${userTokens} 💎`,
        type: 'error',
      })
      return
    }

    setBuying(true)
    setStatusMessage(null)

    try {
      const res = await inventoryService.buyFlashOffer('flash_jalapeno_30', selectedQty)

      if (res && res.success) {
        soundManager.playSound('victory', 0.8)
        const newBought = res.userTotalBought ?? (userBought + selectedQty)
        const newRemaining = res.remainingPurchases ?? Math.max(0, 3 - newBought)
        setUserBought(newBought)
        setRemainingPurchases(newRemaining)
        setSelectedQty(Math.max(1, Math.min(1, newRemaining)))

        setStatusMessage({
          text: `¡Felicidades! Has adquirido ${selectedQty} Jalapeño${selectedQty > 1 ? 's' : ''} por ${totalCost} 💎`,
          type: 'success',
        })

        // Notificar al juego para refrescar saldo e inventario de inmediato
        window.dispatchEvent(new Event('refresh_user_balance'))
        window.dispatchEvent(new Event('refresh_user_inventory'))
        onPurchaseSuccess?.(totalCost, selectedQty)
      } else {
        soundManager.playSound('click', 0.5)
        setStatusMessage({
          text: res?.error || 'No se pudo completar la compra.',
          type: 'error',
        })
      }
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || 'Error inesperado al conectar con el servidor',
        type: 'error',
      })
    } finally {
      setBuying(false)
    }
  }

  return (
    <div className="flash-offer-overlay" onClick={onClose}>
      <div className="flash-offer-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="flash-offer-close-btn"
          onClick={onClose}
          title="Cerrar oferta"
        >
          ✕
        </button>

        {/* ENCABEZADO SUPERIOR */}
        <div className="flash-offer-top-header">
          <div className="flash-offer-header-badge">
            <span>🔥</span>
            <span>OFERTA FLASH LIMITADA</span>
            <span>⚡</span>
          </div>
          <div className="flash-offer-timer-tag">
            <span>⏳</span>
            <span>TEMPORADA 1</span>
          </div>
        </div>

        {/* LAYOUT PRINCIPAL DE 2 COLUMNAS (16:9 LANDSCAPE OPTIMIZADO) */}
        <div className="flash-offer-main-layout">
          {/* COLUMNA IZQUIERDA: CARTA SEED PACKET Y STATS DEL JUEGO */}
          <div className="flash-offer-card-showcase">
            <div className="flash-offer-seed-frame">
              <span className="flash-offer-sun-badge">
                ☀️ 125
              </span>
              <img
                src="/game-assets/greenfoot/jalapenopacket1.webp"
                alt="Jalapeño Packet"
                className="flash-offer-packet-img"
                onError={(e) => {
                  e.currentTarget.src = '/game-assets/plants/jalapeno_hd.webp'
                }}
              />
              <span className="flash-offer-card-rarity-badge">
                RARA • FUEGO
              </span>
            </div>

            <div className="flash-offer-stats-grid">
              <div className="flash-offer-stat-item">
                <span className="flash-offer-stat-label">Daño</span>
                <span className="flash-offer-stat-val">1,000 🔥</span>
              </div>
              <div className="flash-offer-stat-item">
                <span className="flash-offer-stat-label">Alcance</span>
                <span className="flash-offer-stat-val">Línea 💥</span>
              </div>
              <div className="flash-offer-stat-item">
                <span className="flash-offer-stat-label">Recarga</span>
                <span className="flash-offer-stat-val">15s ⏱️</span>
              </div>
              <div className="flash-offer-stat-item">
                <span className="flash-offer-stat-label">Tipo</span>
                <span className="flash-offer-stat-val">1 Solo Uso</span>
              </div>
            </div>
          </div>

          {/* COLUMNA DERECHA: DESCRIPCIÓN, TRACKER DE 3 SLOTS, SELECTOR Y ACCIÓN */}
          <div className="flash-offer-details-col">
            <h2 className="flash-offer-title">JALAPEÑO EXPLOSIVO</h2>
            <p className="flash-offer-desc">
              Planta Explosiva de Carril de 1 Solo Uso. Al plantarlo, destruye a todos los
              enemigos de la línea horizontal con 1000 de daño de fuego masivo.
            </p>

            {/* TRACKER VISUAL DE 3 SLOTS DE COMPRA */}
            <div className="flash-offer-slots-tracker">
              <div className="flash-offer-slots-header">
                <span>🛡️ Límite autoritativo (Máx 3 ventas):</span>
                <span className="flash-offer-slots-count">
                  {loading
                    ? 'Verificando…'
                    : isSoldOut
                    ? 'AGOTADO (3/3)'
                    : `${remainingPurchases} de 3 disponibles`}
                </span>
              </div>
              <div className="flash-offer-slots-row">
                {[1, 2, 3].map((slotIdx) => {
                  const isBought = userBought >= slotIdx
                  return (
                    <div
                      key={slotIdx}
                      className={`flash-offer-slot-chip ${
                        isBought
                          ? 'flash-offer-slot-chip--bought'
                          : 'flash-offer-slot-chip--available'
                      }`}
                    >
                      <span>{isBought ? '✅' : '🌶️'}</span>
                      <span>#{slotIdx} {isBought ? 'Comprado' : 'Disponible'}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* SELECTOR DE CANTIDAD A COMPRAR */}
            {!isSoldOut && (
              <div className="flash-offer-qty-row">
                <span className="flash-offer-qty-label">Cantidad a comprar:</span>
                <div className="flash-offer-qty-btns">
                  <button
                    type="button"
                    className="flash-offer-qty-step-btn"
                    onClick={() => handleQtyChange(-1)}
                    disabled={selectedQty <= 1 || buying}
                  >
                    -
                  </button>
                  <span className="flash-offer-qty-num">{selectedQty}</span>
                  <button
                    type="button"
                    className="flash-offer-qty-step-btn"
                    onClick={() => handleQtyChange(1)}
                    disabled={selectedQty >= maxCanBuy || buying}
                  >
                    +
                  </button>
                  {maxCanBuy > 1 && (
                    <>
                      {[1, 2, 3].filter((n) => n <= maxCanBuy).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`flash-offer-qty-pill-btn ${selectedQty === n ? 'flash-offer-qty-pill-btn--active' : ''}`}
                          onClick={() => handleQtySelect(n)}
                          disabled={buying}
                        >
                          x{n}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* FILA DE SALDO, RECARGA Y COSTO TOTAL */}
            <div className="flash-offer-finance-row">
              <div className="flash-offer-user-balance" title="Tus gemas disponibles">
                <span>Tu saldo:</span>
                <img src={gemaIcon} alt="Gemas" style={{ width: 15, height: 15 }} />
                <strong>{userTokens.toLocaleString()}</strong>
                {!canAfford && onRechargeGems && (
                  <button
                    type="button"
                    className="flash-offer-recharge-link-btn"
                    onClick={onRechargeGems}
                    title="Recargar saldo de gemas"
                  >
                    ➕ Recargar
                  </button>
                )}
              </div>
              <div className="flash-offer-total-display">
                <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Total:</span>
                <img src={gemaIcon} alt="Gemas" style={{ width: 17, height: 17 }} />
                <span>{isSoldOut ? 0 : totalCost} 💎</span>
              </div>
            </div>

            {statusMessage && (
              <div className={`flash-offer-status-alert flash-offer-status-alert--${statusMessage.type}`}>
                {statusMessage.text}
              </div>
            )}

            {/* BOTÓN PRINCIPAL DE ACCIÓN */}
            <button
              type="button"
              className={`flash-offer-action-btn ${
                isSoldOut
                  ? 'flash-offer-action-btn--soldout'
                  : !canAfford && onRechargeGems
                  ? 'flash-offer-action-btn--recharge'
                  : ''
              }`}
              onClick={!canAfford && onRechargeGems ? onRechargeGems : handleBuy}
              disabled={isSoldOut || buying || (!canAfford && !onRechargeGems)}
            >
              {buying ? (
                'PROCESANDO COMPRA…'
              ) : isSoldOut ? (
                '🔒 OFERTA AGOTADA (3/3)'
              ) : !canAfford ? (
                onRechargeGems ? (
                  `💎 RECARGAR GEMAS (Faltan ${missingGems} 💎)`
                ) : (
                  `GEMAS INSUFICIENTES (${totalCost} 💎)`
                )
              ) : (
                <>
                  <span>🔥 COMPRAR {selectedQty} JALAPEÑO{selectedQty > 1 ? 'S' : ''}</span>
                  <span>•</span>
                  <span>{totalCost} 💎</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
