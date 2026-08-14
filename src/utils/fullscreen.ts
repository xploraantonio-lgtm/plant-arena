export function toggleFullscreen() {
  if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
    const docEl = document.documentElement as any
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {})
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen()
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen()
    }
  }
}

export function isFullscreen(): boolean {
  return !!(document.fullscreenElement || (document as any).webkitFullscreenElement)
}
