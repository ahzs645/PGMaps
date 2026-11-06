/** A shareable map view, as `lng,lat,zoom,bearing,pitch` in the `at` URL parameter. */
export interface SharedCamera {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

export const CAMERA_PARAM = 'at'

export function formatCamera({ center, zoom, bearing, pitch }: SharedCamera) {
  return [center[0].toFixed(6), center[1].toFixed(6), zoom.toFixed(2), bearing.toFixed(1), pitch.toFixed(1)].join(',')
}

export function parseCamera(value: string | null): SharedCamera | null {
  const parts = value?.split(',').map(Number)
  if (parts?.length !== 5 || parts.some((part) => !Number.isFinite(part))) return null
  const [lng, lat, zoom, bearing, pitch] = parts
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90 || zoom < 0 || zoom > 24 || pitch < 0 || pitch > 85) return null
  return { center: [lng, lat], zoom, bearing, pitch }
}
