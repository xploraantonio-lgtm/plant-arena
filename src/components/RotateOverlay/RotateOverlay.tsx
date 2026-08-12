import { useEffect } from 'react'
import './RotateOverlay.css'

export default function RotateOverlay() {
  useEffect(() => {
    // Intento "best effort": el bloqueo de orientación solo funciona en
    // Chrome/Android y requiere pantalla completa o app instalada (PWA/APK).
    // Safari/iOS no lo soporta, por eso el overlay de abajo (vía CSS) es
    // el mecanismo real que obliga a girar el celular en el navegador.
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined
    orientation?.lock?.('landscape')?.catch(() => {})
  }, [])

  return (
    <div className="rotate-overlay">
      <div className="rotate-overlay__icon">📱</div>
      <p>Gira tu celular para jugar</p>
    </div>
  )
}
