import type { InteractFeature, OpenInTarget } from './types'

export function getOpenInUrl(target: OpenInTarget, point: [number, number], feature: InteractFeature): string {
  const [lng, lat] = point
  const params = new URLSearchParams({
    lng: lng.toFixed(6),
    lat: lat.toFixed(6),
    feature: feature.properties.id,
  })

  if (target === 'pgdata') return `/pgdata?${params.toString()}`
  if (target === 'explorer') return `/explorer?${params.toString()}`
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=15/${lat.toFixed(6)}/${lng.toFixed(6)}`
}
