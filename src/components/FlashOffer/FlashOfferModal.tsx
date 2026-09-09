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
}

export default function FlashOfferModal({
  isOpen,
  onClose,
  userTokens,
  onPurchaseSuccess,
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
      void loadStatus()
      setStatusMessage(null)
    }
  }, [isOpen, loadStatus])

  if (!isOpen) return null

  const isSoldOut = remainingPurchases <= 0
  const maxCanBuy = Math.min(remainingPurchases, 3)
  const totalCost = priceGems * selectedQty
  const canAfford = userTokens >= totalCost

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

        // Notificar al juego para refrescar saldo e inventario
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

        <div className="flash-offer-header-badge">
          <span>🔥</span>
          <span>OFERTA FLASH LIMITADA</span>
          <span>⚡</span>
        </div>

        <h2 className="flash-offer-title">JALAPEÑO EXPLOSIVO</h2>

        <div className="flash-offer-art-wrap">
          <div className="flash-offer-glow-ring" />
          <img
            src="/game-assets/greenfoot/jalapeno_hd.webp"
            alt="Jalapeño HD"
            className="flash-offer-plant-img"
            onError={(e) => {
              e.currentTarget.src = '/game-assets/greenfoot/jalapenopacket1.webp'
            }}
          />
          <span className="flash-offer-rarity-pill">RARA • FUEGO</span>
        </div>

        <p className="flash-offer-desc">
          ¡Quema a toda la hilera enemiga con un impacto letal! Adquiere copias exclusivas
          para desbloquear o subir de nivel a tu Jalapeño.
        </p>

        <div className="flash-offer-feature-chips">
          <span className="flash-offer-chip">💥 Explosión de Línea</span>
          <span className="flash-offer-chip">🌶️ Carta Rara</span>
          <span className="flash-offer-chip">💎 30 Gemas c/u</span>
        </div>

        {/* CONTADOR DE VENTAS / DISPONIBILIDAD */}
        <div className="flash-offer-stock-box">
          <span className="flash-offer-stock-label">
            <span>🛡️</span> Límite autoritativo de compras:
          </span>
          <span className={`flash-offer-stock-counter ${isSoldOut ? 'flash-offer-stock-counter--soldout' : ''}`}>
            {loading
              ? 'Verificando…'
              : isSoldOut
              ? 'AGOTADO (3/3)'
              : `${remainingPurchases} de 3 disponibles`}
          </span>
        </div>

        {/* SELECTOR DE CANTIDAD */}
        {!isSoldOut && (
          <div className="flash-offer-qty-section">
            <span className="flash-offer-qty-label">Cantidad a comprar:</span>
            <div className="flash-offer-qty-selector">
              <button
                type="button"
                className="flash-offer-qty-btn"
                onClick={() => handleQtyChange(-1)}
                disabled={selectedQty <= 1 || buying}
              >
                -
              </button>
              <span className="flash-offer-qty-value">{selectedQty}</span>
              <button
                type="button"
                className="flash-offer-qty-btn"
                onClick={() => handleQtyChange(1)}
                disabled={selectedQty >= maxCanBuy || buying}
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* RESUMEN DE SALDO Y PRECIO */}
        <div className="flash-offer-summary-row">
          <div className="flash-offer-my-gems" title="Tus gemas disponibles">
            <span>Tu saldo:</span>
            <img src={gemaIcon} alt="Gemas" style={{ width: 16, height: 16 }} />
            <strong>{userTokens.toLocaleString()}</strong>
          </div>
          <div className="flash-offer-total-cost">
            <span>Total:</span>
            <img src={gemaIcon} alt="Gemas" style={{ width: 18, height: 18 }} />
            <span>{isSoldOut ? 0 : totalCost}</span>
          </div>
        </div>

        {statusMessage && (
          <div className={`flash-offer-alert flash-offer-alert--${statusMessage.type}`}>
            {statusMessage.text}
          </div>
        )}

        {/* BOTÓN DE ACCIÓN GARANTIZADO */}
        <button
          type="button"
          className={`flash-offer-buy-btn ${isSoldOut ? 'flash-offer-buy-btn--soldout' : ''}`}
          onClick={handleBuy}
          disabled={isSoldOut || buying || !canAfford}
        >
          {buying ? (
            'PROCESANDO COMPRA…'
          ) : isSoldOut ? (
            '🔒 OFERTA AGOTADA (3/3)'
          ) : !canAfford ? (
            `GEMAS INSUFICIENTES (${totalCost} 💎)`
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
  )
}
