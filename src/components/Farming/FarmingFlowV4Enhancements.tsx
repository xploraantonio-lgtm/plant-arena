import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import './FarmingFlowV4Enhancements.css'

type ConfirmState = {
  title: string
  body: string
  confirmLabel: string
  target: HTMLButtonElement
} | null

const STORAGE_KEY = 'plant-arena-farming-flow-v3'

function currentGems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { gems?: number }
    return typeof parsed.gems === 'number' ? parsed.gems : 0
  } catch {
    return 0
  }
}

function numericPrice(text: string | null | undefined) {
  const match = text?.replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

export default function FarmingFlowV4Enhancements() {
  const [homeHost, setHomeHost] = useState<HTMLElement | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)

  useEffect(() => {
    const syncHome = () => {
      const next = document.querySelector<HTMLElement>('.fv4-home-center')
      setHomeHost((current) => current === next ? current : next)
    }
    syncHome()
    const observer = new MutationObserver(syncHome)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button')
      if (!button || button.dataset.fv4Confirmed === 'true') return

      const label = button.textContent?.trim().toUpperCase() ?? ''
      const isBuy = label.startsWith('COMPRAR')
      const isRent = label.includes('ALQUILAR') && Boolean(button.closest('.fv4-block'))
      if (!isBuy && !isRent) return

      if (isBuy) {
        const card = button.closest<HTMLElement>('.fv4-land')
        const detail = button.closest<HTMLElement>('.fv4-detail-body')
        const priceText = card?.querySelector<HTMLElement>('.fv4-land-meta b:last-child')?.textContent
          ?? button.textContent
        const price = numericPrice(priceText)
        if (price > currentGems()) return

        event.preventDefault()
        event.stopPropagation()
        const landName = card?.querySelector('h2')?.textContent ?? detail?.querySelector('h2')?.textContent ?? 'esta Genesis Land'
        setConfirm({
          title: 'Confirmar compra',
          body: `Vas a comprar ${landName} por ${price} Gems. ¿Deseas continuar?`,
          confirmLabel: `COMPRAR · ${price} 💎`,
          target: button,
        })
        return
      }

      const block = button.closest<HTMLElement>('.fv4-block')
      const active = block?.querySelector<HTMLElement>('.fv4-rent-options button.active span')
      const price = numericPrice(active?.textContent)
      if (price > currentGems()) return

      event.preventDefault()
      event.stopPropagation()
      const days = block?.querySelector<HTMLElement>('.fv4-rent-options button.active b')?.textContent ?? 'el período seleccionado'
      const slot = document.querySelector<HTMLElement>('.fv4-detail-body > h2')?.textContent ?? 'este slot'
      setConfirm({
        title: 'Confirmar alquiler',
        body: `Vas a alquilar ${slot} por ${days} con un costo total de ${price.toFixed(1)} Gems. ¿Deseas continuar?`,
        confirmLabel: `ALQUILAR · ${price.toFixed(1)} 💎`,
        target: button,
      })
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const homePromo = useMemo(() => homeHost ? createPortal(
    <div className="fv4-home-promo">
      <div className="fv4-home-promo-copy" aria-hidden="true" />
      <button className="fv4-home-explore" type="button" onClick={() => {
        const buy = Array.from(document.querySelectorAll<HTMLButtonElement>('.fv4-home-actions button'))
          .find((item) => item.textContent?.includes('COMPRAR'))
        buy?.click()
      }}>
        🌱 EXPLORAR LANDS
      </button>
    </div>,
    homeHost,
  ) : null, [homeHost])

  const approve = () => {
    if (!confirm) return
    const target = confirm.target
    setConfirm(null)
    target.dataset.fv4Confirmed = 'true'
    target.click()
    window.setTimeout(() => delete target.dataset.fv4Confirmed, 0)
  }

  return <>
    {homePromo}
    {confirm && <div className="fv4-confirm-wrap" role="dialog" aria-modal="true">
      <div className="fv4-confirm">
        <h2>{confirm.title}</h2>
        <p>{confirm.body}</p>
        <div>
          <button type="button" className="fv4-confirm-cancel" onClick={() => setConfirm(null)}>CANCELAR</button>
          <button type="button" className="fv4-confirm-ok" onClick={approve}>{confirm.confirmLabel}</button>
        </div>
      </div>
    </div>}
  </>
}
