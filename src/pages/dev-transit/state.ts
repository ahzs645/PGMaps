import type { Point, TravelOptions } from './types'

export const DEFAULT_FROM: Point = [-122.74733, 53.91313]
export const BBOX = [-122.94, 53.78, -122.59, 54.045] as const
export function inside(point: Point) {
  return (
    point.every(Number.isFinite) &&
    point[0] >= BBOX[0] &&
    point[0] <= BBOX[2] &&
    point[1] >= BBOX[1] &&
    point[1] <= BBOX[3]
  )
}
function parsePoint(value: string | null): Point | null {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length !== 2 || parts.some((v) => !v.trim())) return null
  const point = parts.map(Number) as Point
  return inside(point) ? point : null
}
export function readTravelState(search: string): TravelOptions & { max: number; contours: number[] } {
  const params = new URLSearchParams(search)
  const time = /^(\d{2}):(\d{2})$/.exec(params.get('time') ?? '')
  const departure = time && +time[1] < 24 && +time[2] < 60 ? +time[1] * 3600 + +time[2] * 60 : 8 * 3600
  const max = Number(params.get('max'))
  const contours = params.has('contours')
    ? (params.get('contours') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => [15, 30, 45, 60].includes(n))
    : [15, 30]
  return {
    from: parsePoint(params.get('from')) ?? DEFAULT_FROM,
    to: parsePoint(params.get('to')),
    departure,
    bus: params.get('bus') !== '0',
    heatFrom: params.get('heat') === 'to' ? 'to' : 'from',
    max: [30, 45, 60, 90].includes(max) ? max : 45,
    contours,
  }
}
export function clockTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
export function writeTravelState(options: ReturnType<typeof readTravelState>) {
  const params = new URLSearchParams({
    from: options.from.map((n) => n.toFixed(6)).join(','),
    time: clockTime(options.departure),
    bus: options.bus ? '1' : '0',
    heat: options.heatFrom,
    max: String(options.max),
    contours: options.contours.join(','),
  })
  if (options.to) params.set('to', options.to.map((n) => n.toFixed(6)).join(','))
  return params.toString()
}
