import { useEffect, useRef } from 'react'
import './FarmingFlowUXCorrections.css'

const STORAGE_KEY = 'plant-arena-farming-flow-v3'

function readProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { owned: 0, rentals: 0 }
    const parsed = JSON.parse(raw) as { ownedLands?: unknown[]; rentals?: Record<string, unknown> }
    return {
      owned: Array.isArray(parsed.ownedLands) ? parsed.ownedLands.length : 0,
      rentals: parsed.rentals ? Object.keys(parsed.rentals).length : 0,
    }
  } catch {
    return { owned: 0, rentals: 0 }
  }
}

export default function FarmingFlowUXCorrections() {
  const bootstrapped = useRef(false)

  useEffect(() => {
    const sync = () => {
      const screen = document.querySelector<HTMLElement>('.ff-screen')
      if (!screen) return

      const home = screen.querySelector<HTMLElement>('.ff-start')
      if (home) {
        const heading = home.querySelector('h1')
        const paragraph = home.querySelector('p')
        if (heading) heading.textContent = 'Compra una Land o alquila slots y gana'
        if (paragraph) paragraph.textContent = 'Empieza desde cero: compra una Genesis Land, alquila un slot para cultivar o entra a mundos de otros jugadores para ayudar.'
      }

      const helpPanel = screen.querySelector<HTMLElement>('.ff-help')
      const originalHelp = screen.querySelector<HTMLButtonElement>('.ff-start-actions > button:nth-child(3)')
      if (helpPanel && originalHelp && !helpPanel.querySelector('[data-ff-help-entry]')) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.ffHelpEntry = 'true'
        button.className = 'ff-help-entry'
        button.innerHTML = '<strong>💧 EXPLORAR Y AYUDAR</strong><small>Riega cultivos NPC y captura cuervos</small>'
        button.addEventListener('click', () => originalHelp.click())
        helpPanel.insertBefore(button, helpPanel.lastElementChild)
      }

      screen.querySelectorAll<HTMLButtonElement>('.ff-land-actions button, .ff-market-side .ff-action').forEach((button) => {
        const text = button.textContent?.trim()
        if (text === 'VER' || text === 'VER SLOTS') button.textContent = 'ENTRAR'
      })

      if (!bootstrapped.current) {
        const { owned, rentals } = readProgress()
        if (owned > 0) {
          const button = Array.from(screen.querySelectorAll<HTMLButtonElement>('.ff-wallets button')).find((item) => item.textContent?.includes('MIS LANDS'))
          if (button) {
            bootstrapped.current = true
            window.setTimeout(() => button.click(), 0)
          }
        } else if (rentals > 0) {
          const button = Array.from(screen.querySelectorAll<HTMLButtonElement>('.ff-wallets button')).find((item) => item.textContent?.includes('MIS ALQUILERES'))
          if (button) {
            bootstrapped.current = true
            window.setTimeout(() => button.click(), 0)
          }
        } else {
          bootstrapped.current = true
        }
      }
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
