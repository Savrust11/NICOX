const KEY = 'nicox:mapView'

export const DEFAULT_CENTER = [35.6814, 139.7670]
export const DEFAULT_ZOOM = 13

export function loadView() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.center) && parsed.center.length === 2 && typeof parsed.zoom === 'number') {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

export function saveView(center, zoom) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ center, zoom }))
  } catch {
    // ignore (private mode, full storage, etc.)
  }
}

export function getInitialView() {
  return loadView() || { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
}

// Try to get GPS position quickly. Returns null on error / timeout / denial.
export function tryGeolocate(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        resolve({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 15 })
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60 * 60 * 1000 }
    )
  })
}
