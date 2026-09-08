import { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import jardin from '../../assets/images/jardin.webp'
import FarmingFlowV4Enhancements from './FarmingFlowV4Enhancements'
import { checkLocalIsXplora, checkSupabaseIsXplora } from '../../utils/farmingAccess'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import './FarmingPreview.css'
import './FarmingPreviewFixes.css'
import './FarmingFlowV4Responsive.css'

const FarmingFlowV4 = lazy(() => import('./FarmingFlowV4'))

export default function FarmingPreviewMount() {
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [isAllowed, setIsAllowed] = useState<boolean>(() => checkLocalIsXplora())

  const evaluateAccess = useCallback(async () => {
    if (checkLocalIsXplora()) {
      setIsAllowed(true)
      return
    }

    const allowedSupabase = await checkSupabaseIsXplora()
    setIsAllowed(allowedSupabase)
  }, [])

  useEffect(() => {
    void evaluateAccess()

    const onProfileUpdate = () => {
      void evaluateAccess()
    }

    window.addEventListener('player_profile_updated', onProfileUpdate)
    window.addEventListener('storage', onProfileUpdate)

    let authSubscription: { unsubscribe: () => void } | null = null
    if (isSupabaseConfigured()) {
      const { data } = supabase.auth.onAuthStateChange(() => {
        void evaluateAccess()
      })
      authSubscription = data.subscription
    }

    return () => {
      window.removeEventListener('player_profile_updated', onProfileUpdate)
      window.removeEventListener('storage', onProfileUpdate)
      authSubscription?.unsubscribe()
    }
  }, [evaluateAccess])

  useEffect(() => {
    if (!isAllowed) {
      setLauncherHost(null)
      return
    }

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
  }, [isAllowed])

  if (!isAllowed) {
    return null
  }

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

