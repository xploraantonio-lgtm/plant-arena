import { useEffect } from 'react'

const SYSTEM_SLOT_TOTALS: Record<string, number> = {
  'COMÚN': 8,
  'RARA': 12,
  'ÉPICA': 16,
  'LEGENDARIA': 20,
}

export default function FarmingPreviewCorrections() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>('.farming-preview-land-header').forEach((header) => {
        const owner = header.querySelector('.farming-preview-owner-pill')?.textContent?.trim()
        if (owner !== 'Plant Arena') return

        const title = header.querySelector('strong')?.textContent ?? ''
        const rarity = Object.keys(SYSTEM_SLOT_TOTALS).find((key) => title.includes(key))
        const available = header.querySelector<HTMLElement>('.is-available')
        if (!rarity || !available) return

        const nextText = `${SYSTEM_SLOT_TOTALS[rarity]} disponibles`
        if (available.textContent !== nextText) available.textContent = nextText
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
