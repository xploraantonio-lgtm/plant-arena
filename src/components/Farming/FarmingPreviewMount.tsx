import { useEffect, useState } from 'react'
import FarmingPreview from './FarmingPreview'
import './FarmingPreview.css'

export default function FarmingPreviewMount() {
  const [menuVisible, setMenuVisible] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = () => setMenuVisible(Boolean(document.querySelector('.main-menu')))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  if (!menuVisible && !open) return null

  return (
    <>
      {!open && menuVisible && (
        <button
          type="button"
          className="farming-preview-launcher"
          onClick={() => setOpen(true)}
          title="Abrir vista previa de Farming"
        >
          <span className="farming-preview-launcher__icon">🌾</span>
          <span>GRANJA</span>
        </button>
      )}
      {open && <FarmingPreview onClose={() => setOpen(false)} />}
    </>
  )
}
