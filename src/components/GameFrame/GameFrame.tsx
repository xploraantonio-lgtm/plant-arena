import { useEffect, useState, type ReactNode } from 'react'
import './GameFrame.css'

// Resolución lógica del juego: un lienzo fijo en horizontal.
// Todo se diseña sobre este tamaño y luego se escala para llenar
// cualquier pantalla (PC o celular) sin deformarse, igual que un
// juego móvil que siempre se ve "en formato celular".
const STAGE_WIDTH = 960
const STAGE_HEIGHT = 540

function useStageScale() {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    function updateScale() {
      const scaleX = window.innerWidth / STAGE_WIDTH
      const scaleY = window.innerHeight / STAGE_HEIGHT
      setScale(Math.min(scaleX, scaleY))
    }

    updateScale()
    window.addEventListener('resize', updateScale)
    window.addEventListener('orientationchange', updateScale)
    return () => {
      window.removeEventListener('resize', updateScale)
      window.removeEventListener('orientationchange', updateScale)
    }
  }, [])

  return scale
}

export default function GameFrame({ children }: { children: ReactNode }) {
  const scale = useStageScale()

  return (
    <div className="stage-viewport">
      <div
        className="stage"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
