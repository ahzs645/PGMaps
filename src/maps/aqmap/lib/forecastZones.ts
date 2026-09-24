import type { AirMonitor } from '@/maps/airquality'
import { isFemMonitor } from '@/maps/airquality/lib/monitorPopup'
import type { ForecastZoneFeatureProperties } from './aqMapTypes'

export type ForecastZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>
type ForecastZoneBounds = [minLng: number, minLat: number, maxLng: number, maxLat: number]

/** Columns of the forecast-zone summary table, in upstream order. */
export const FORECAST_ZONE_COLUMNS = ['FEM', 'PA', 'EGG', 'ALL'] as const
export type ForecastZoneColumn = (typeof FORECAST_ZONE_COLUMNS)[number]

const forecastZoneBoundsCache = new WeakMap<ForecastZoneFeature, ForecastZoneBounds>()

function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = Number(ring[index][0])
    const yi = Number(ring[index][1])
    const xj = Number(ring[previous][0])
    const yj = Number(ring[previous][1])
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonCoordinates(lng: number, lat: number, rings: GeoJSON.Position[][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false
  return !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))
}

function computeForecastZoneBounds(zone: ForecastZoneFeature): ForecastZoneBounds {
  const cached = forecastZoneBoundsCache.get(zone)
  if (cached) return cached

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (coordinates: GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][]) => {
    for (const entry of coordinates) {
      if (typeof entry[0] === 'number') {
        const [lng, lat] = entry as GeoJSON.Position
        minLng = Math.min(minLng, lng)
        minLat = Math.min(minLat, lat)
        maxLng = Math.max(maxLng, lng)
        maxLat = Math.max(maxLat, lat)
      } else {
        visit(entry as GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][])
      }
    }
  }

  visit(zone.geometry.coordinates)
  const bounds: ForecastZoneBounds = [minLng, minLat, maxLng, maxLat]
  forecastZoneBoundsCache.set(zone, bounds)
  return bounds
}

export function pointInForecastZone(monitor: AirMonitor, zone: ForecastZoneFeature): boolean {
  const { longitude, latitude } = monitor
  const [minLng, minLat, maxLng, maxLat] = computeForecastZoneBounds(zone)
  if (longitude < minLng || longitude > maxLng || latitude < minLat || latitude > maxLat) return false

  const { geometry } = zone
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(longitude, latitude, geometry.coordinates)
  }
  return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(longitude, latitude, polygon))
}

/** Monitors tagged with the zone's code, or (when none are tagged) those inside its polygon. */
export function getForecastZoneMonitors(zone: ForecastZoneFeature, monitors: AirMonitor[]): AirMonitor[] {
  const zoneCode = String(zone.properties?.CLC ?? '').trim()
  const monitorsByCode = zoneCode
    ? monitors.filter((monitor) => monitor.forecastZoneCode === zoneCode)
    : []
  return monitorsByCode.length
    ? monitorsByCode
    : monitors.filter((monitor) => pointInForecastZone(monitor, zone))
}

export function getForecastZoneMonitorGroup(monitor: AirMonitor): Exclude<ForecastZoneColumn, 'ALL'> | null {
  if (isFemMonitor(monitor)) return 'FEM'
  if (monitor.network === 'PA') return 'PA'
  if (monitor.network === 'EGG') return 'EGG'
  return null
}

export function groupForecastZoneMonitors(zoneMonitors: AirMonitor[]): Record<ForecastZoneColumn, AirMonitor[]> {
  return {
    FEM: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'FEM'),
    PA: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'PA'),
    EGG: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'EGG'),
    ALL: zoneMonitors,
  }
}

export function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

export function formatForecastZoneMean(value: number | null): string {
  return value === null ? '-' : value.toFixed(1)
}
