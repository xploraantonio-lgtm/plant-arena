import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import jardin from '../../assets/images/jardin.png'
import FarmingPreview from './FarmingPreview'
import './FarmingPreview.css'
import './FarmingPreviewFixes.css'

export default function FarmingPreviewMount() {
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let host: HTMLDivElement | null = null

    const sync = () => {
      const panel = document.querySelector<HTMLElement>('.main-menu .panel--left')

      if (!panel) {
        if (host?.parentElement) host.parentElement.removeChild(host)
        host = null
        setLauncherHost(null)
        return
      }

      if (!host || !host.isConnected) {
        host = document.createElement('div')
        host.className = 'farming-preview-launcher-host'
        panel.insertBefore(host, panel.firstChild)
        setLauncherHost(host)
      }
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (host?.parentElement) host.parentElement.removeChild(host)
    }
  }, [])

  return (
    <>
      {!open && launcherHost && createPortal(
        <button
          type="button"
          className="banner-button farming-preview-menu-banner"
          onClick={() => setOpen(true)}
          title="Abrir Farming"
        >
          <img src={jardin} alt="" />
          <span>GRANJA</span>
        </button>,
        launcherHost
      )}
      {open && <FarmingPreview onClose={() => setOpen(false)} />}
    </>
  )
}
