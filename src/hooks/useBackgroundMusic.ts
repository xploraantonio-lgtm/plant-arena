import { useEffect, useRef, useState } from 'react'

// Creamos el <audio> una sola vez (guard en el ref) para que en modo
// desarrollo, donde React monta/desmonta los efectos dos veces, no queden
// dos instancias sonando a la vez — eso era lo que hacía que silenciar no
// funcionara: el botón mutea una instancia mientras la otra sigue sonando.
export function useBackgroundMusic(src: string, volume = 0.5) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio(src)
      audio.loop = true
      audio.volume = volume
      audioRef.current = audio
    }

    // Los navegadores bloquean el play() con sonido hasta que haya un gesto
    // del usuario en la página. En vez de exigir que toque justo el botón de
    // silenciar, arrancamos la música en la primera interacción con lo que
    // sea (click, tecla o toque), para que se sienta automática.
    const audio = audioRef.current
    function startOnFirstInteraction() {
      if (audio.paused) {
        audio
          .play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false))
      }
    }

    window.addEventListener('pointerdown', startOnFirstInteraction, { once: true })
    window.addEventListener('keydown', startOnFirstInteraction, { once: true })

    return () => {
      window.removeEventListener('pointerdown', startOnFirstInteraction)
      window.removeEventListener('keydown', startOnFirstInteraction)
    }
  }, [src, volume])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  return { playing, toggle }
}
