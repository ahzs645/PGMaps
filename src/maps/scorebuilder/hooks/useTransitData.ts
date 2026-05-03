import { useEffect, useState } from 'react'

export interface TransitStop {
  id: string
  name: string
  longitude: number
  latitude: number
  status: string
  subtype: number | null
  accessible: boolean
  hasShelter: boolean
}

type TransitStopFeature = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>

const TRANSIT_STOPS_PATH = '/data/citypg/transit_bus_stops.geojson'

function parseNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseTransitAccessible(properties: Record<string, unknown>): boolean {
  const accessible = parseNumber(properties.Accessible)
  if (accessible !== null) return accessible === 1

  // Most CityPG stop records leave Accessible blank; sidewalk/ROW flags are the best available proxy.
  return parseNumber(properties.Sidewalk) === 1 || parseNumber(properties.ROW) === 1
}

function parseTransitStops(geojson: GeoJSON.FeatureCollection): TransitStop[] {
  return geojson.features
    .map((feature): TransitStop | null => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return null

      const item = feature as TransitStopFeature
      const properties = item.properties ?? {}
      const [longitude, latitude] = item.geometry.coordinates
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null

      const objectId = String(properties.OBJECTID ?? '').trim()
      const stopId = String(properties.StopID ?? '').trim()
      const subtype = parseNumber(properties.SubType)
      const fallbackName = stopId || objectId || 'Transit stop'

      return {
        id: stopId || objectId || `${longitude},${latitude}`,
        name: String(properties.StopName ?? properties.Location ?? fallbackName).trim(),
        longitude,
        latitude,
        status: String(properties.LifeCycleStatus ?? '').trim(),
        subtype,
        accessible: parseTransitAccessible(properties),
        hasShelter: subtype === 3 || subtype === 4,
      }
    })
    .filter((stop): stop is TransitStop => stop !== null)
}

export function useTransitData(enabled = true) {
  const [stops, setStops] = useState<TransitStop[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(TRANSIT_STOPS_PATH, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch transit stops: ${response.status}`)
        const geojson: GeoJSON.FeatureCollection = await response.json()
        if (!controller.signal.aborted) setStops(parseTransitStops(geojson))
      } catch (err) {
        if (controller.signal.aborted) return
        setError((err as Error).message || 'Unable to load transit stops')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [enabled])

  return { stops, loading, error }
}
