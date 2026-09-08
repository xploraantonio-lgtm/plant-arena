import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import jardin from '../../assets/images/jardin.webp'
import FarmingFlowV4Enhancements from './FarmingFlowV4Enhancements'
import './FarmingPreview.css'
import './FarmingPreviewFixes.css'
import './FarmingFlowV4Responsive.css'

const FarmingFlowV4 = lazy(() => import('./FarmingFlowV4'))

export default function FarmingPreviewMount() {
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      const slot = document.getElementById('farming-preview-launcher-slot')
      setLauncherHost((prev) => (prev === slot ? prev : slot))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      setLauncherHost(null)
    }
  }, [])

  return (
    <>
      {!open && launcherHost && createPortal(
        <button type="button" className="banner-button farming-preview-menu-banner" onClick={() => setOpen(true)} title="Abrir Farming">
          <img src={jardin} alt="" />
          <span>GRANJA</span>
        </button>,
        launcherHost
      )}
      {open && (
        <Suspense fallback={<div className="farming-preview-loading">CARGANDO FARMING…</div>}>
          <FarmingFlowV4 onClose={() => setOpen(false)} />
          <FarmingFlowV4Enhancements />
        </Suspense>
      )}
    </>
  )
}
