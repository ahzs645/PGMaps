import type { Camera } from './model'

export function iconemViewUrl(camera: Camera, mode: 'terrain' | 'historical', date?: string): string {
  const url = new URL('https://terrain-viewer.iconem.com/')
  const [lng, lat] = camera.center
  const historical = mode === 'historical'
  const params = new URLSearchParams({
    appMode: mode,
    viewMode: historical ? '2d' : '3d',
    lng: String(lng),
    lat: String(lat),
    zoom: String(camera.zoom),
    bearing: String(camera.bearing),
    pitch: historical ? '0' : String(camera.pitch),
  })
  if (historical) {
    params.set('basemapSourceA', 'historical')
    params.set('historicalActiveSourceA', 'wayback')
    if (date) params.set('dateA', String(Date.parse(date)))
  } else {
    params.set('terrainSourceA', 'aws')
    params.set('showHillshade', 'true')
  }
  url.search = params.toString()
  return url.href
}
