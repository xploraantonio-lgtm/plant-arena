import { useEffect, useState, type ReactNode } from 'react'
import './GameFrame.css'

// Resolución lógica fija (16:9) estilo Plants vs Zombies.
// Garantiza que en celulares con pantallas horizontales "chatas" o muy anchas (20:9),
// las plantas, soles y casillas mantengan SIEMPRE su forma perfecta sin aplastarse.
const STAGE_WIDTH = 960
const STAGE_HEIGHT = 540

function useStageScale() {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    function updateScale() {
      const scaleX = window.innerWidth / STAGE_WIDTH
      const scaleY = window.innerHeight / STAGE_HEIGHT
      // Escala contenedora: usa el menor factor para no deformar nunca el lienzo 16:9
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

