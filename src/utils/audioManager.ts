type MuteListener = (isMuted: boolean) => void

class AudioManager {
  private isMutedState: boolean = false
  private bgmAudio: HTMLAudioElement | null = null
  private currentBgmTrack: string | null = null
  private listeners: MuteListener[] = []

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        if (this.bgmAudio && this.bgmAudio.paused && !this.isMutedState) {
          this.bgmAudio.play().catch(() => {})
        }
      }
      window.addEventListener('pointerdown', unlock, { passive: true })
      window.addEventListener('click', unlock, { passive: true })
      window.addEventListener('keydown', unlock, { passive: true })
    }
  }

  public isMuted(): boolean {
    return this.isMutedState
  }

  public subscribe(listener: MuteListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l(this.isMutedState))
  }

  public toggleMute(): boolean {
    this.isMutedState = !this.isMutedState

    if (this.bgmAudio) {
      this.bgmAudio.muted = this.isMutedState
    }

    this.notifyListeners()
    return this.isMutedState
  }

  public setMuted(muted: boolean) {
    this.isMutedState = muted
    if (this.bgmAudio) {
      this.bgmAudio.muted = this.isMutedState
    }
    this.notifyListeners()
  }

  public playBgm(track: 'menu' | 'battle') {
    const trackFile = track === 'menu' ? 'introTheme.mp3' : 'theme.mp3'
    if (this.currentBgmTrack === trackFile && this.bgmAudio && !this.bgmAudio.paused) {
      return
    }

    this.stopBgm()

    try {
      const audio = new Audio(`/game-assets/audio/${trackFile}`)
      audio.loop = true
      audio.volume = 0.4
      audio.muted = this.isMutedState
      this.bgmAudio = audio
      this.currentBgmTrack = trackFile
      audio.play().catch(() => {
        // Autoplay policy handle (unlocked on first user interaction)
      })
    } catch {
      // Ignore audio error
    }
  }

  public stopBgm() {
    if (this.bgmAudio) {
      this.bgmAudio.pause()
      this.bgmAudio.currentTime = 0
      this.bgmAudio = null
      this.currentBgmTrack = null
    }
  }

  public playSound(soundName: string, volume: number = 0.5) {
    if (this.isMutedState) return

    try {
      const audio = new Audio(`/game-assets/audio/${soundName}.mp3`)
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.play().catch(() => {
        // Interrupt safely ignored
      })
    } catch {
      // Ignore audio error
    }
  }
}

export const soundManager = new AudioManager()
