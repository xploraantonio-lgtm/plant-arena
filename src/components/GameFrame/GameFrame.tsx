import { useEffect, useState, type ReactNode } from 'react'
import './GameFrame.css'

// Base logical height used for uniform responsive scaling across all screen sizes
const BASE_HEIGHT = 540

function useStageDimensions() {
  const [dim, setDim] = useState({ width: 960, height: 540, scale: 1 })

  useEffect(() => {
    function updateDimensions() {
      const vW = window.innerWidth
      const vH = window.innerHeight

      // Scale factor based on viewport height relative to 540px base height
      const scale = vH / BASE_HEIGHT

      // Unscaled logical stage width required to fill full viewport width seamlessly
      const logicalWidth = Math.max(960, vW / Math.max(0.1, scale))

      setDim({
        width: logicalWidth,
        height: BASE_HEIGHT,
        scale,
      })
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    window.addEventListener('orientationchange', updateDimensions)
    return () => {
      window.removeEventListener('resize', updateDimensions)
      window.removeEventListener('orientationchange', updateDimensions)
    }
  }, [])

  return dim
}

export default function GameFrame({ children }: { children: ReactNode }) {
  const { width, height, scale } = useStageDimensions()

  return (
    <div className="stage-viewport">
      <div
        className="stage"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

