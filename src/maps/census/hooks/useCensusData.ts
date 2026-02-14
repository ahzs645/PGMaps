import { useEffect, useMemo, useState } from 'react'
import type { CensusArea } from '../types'

interface CensusDataRow {
  GeoUID?: string
  Type?: string
  'Region Name'?: string
  rpid?: string
  rgid?: string
  ruid?: string
  rguid?: string
  'Area (sq km)'?: string
  'Population '?: string
  'Dwellings '?: string
  'Households '?: string
  'v_CA21_1: Population, 2021'?: string
  'v_CA21_4: Total private dwellings'?: string
  'v_CA21_6: Population density per square kilometre'?: string
  'v_CA21_7: Land area in square kilometres'?: string
  'v_CA21_434: Occupied private dwellings by structural type of dwelling data'?: string
}

interface CensusDataResponse {
  data: CensusDataRow[]
  count: number
}

interface CensusGeoFeature {
  type: 'Feature'
  properties: {
    id?: string
    name?: string
    t?: string
    rpid?: string
    rgid?: string
    ruid?: string
    rguid?: string
    pop?: string
    dw?: string
    hh?: string
    a?: string
  }
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon
}

interface CensusGeoResponse {
  type: 'FeatureCollection'
  features: CensusGeoFeature[]
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function chooseNumber(...candidates: Array<string | undefined>): number | null {
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate)
    if (parsed != null) return parsed
  }
  return null
}

export function useCensusData() {
  const [areas, setAreas] = useState<CensusArea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [dataResponse, geoResponse] = await Promise.all([
          fetch('/data/census/prince_george_da_data.json', { signal: controller.signal }),
          fetch('/data/census/prince_george_da_geo.json', { signal: controller.signal })
        ])

        if (!dataResponse.ok) {
          throw new Error(`Failed to load census data (${dataResponse.status})`)
        }
        if (!geoResponse.ok) {
          throw new Error(`Failed to load census geometry (${geoResponse.status})`)
        }

        const dataJson = await dataResponse.json() as CensusDataResponse
        const geoJson = await geoResponse.json() as CensusGeoResponse

        const dataMap = new Map<string, CensusDataRow>()
        ;(dataJson.data || []).forEach((row) => {
          if (row.GeoUID) {
            dataMap.set(row.GeoUID, row)
          }
        })

        const merged: CensusArea[] = (geoJson.features || [])
          .map((feature) => {
            const id = feature.properties?.id || ''
            if (!id) return null

            const row = dataMap.get(id)
            const population = chooseNumber(
              row?.['v_CA21_1: Population, 2021'],
              row?.['Population '],
              feature.properties?.pop
            )
            const dwellings = chooseNumber(
              row?.['v_CA21_4: Total private dwellings'],
              row?.['Dwellings '],
              feature.properties?.dw
            )
            const households = chooseNumber(
              row?.['v_CA21_434: Occupied private dwellings by structural type of dwelling data'],
              row?.['Households '],
              feature.properties?.hh
            )
            const areaSqKm = chooseNumber(
              row?.['v_CA21_7: Land area in square kilometres'],
              row?.['Area (sq km)'],
              feature.properties?.a
            )
            const populationDensity = chooseNumber(
              row?.['v_CA21_6: Population density per square kilometre']
            )

            return {
              id,
              name: row?.['Region Name'] || feature.properties?.name || id,
              type: row?.Type || feature.properties?.t || 'DA',
              rpid: row?.rpid || feature.properties?.rpid || null,
              rgid: row?.rgid || feature.properties?.rgid || null,
              ruid: row?.ruid || feature.properties?.ruid || null,
              rguid: row?.rguid || feature.properties?.rguid || null,
              population,
              populationDensity,
              households,
              dwellings,
              areaSqKm,
              geometry: feature.geometry
            } satisfies CensusArea
          })
          .filter((item): item is CensusArea => item !== null)

        merged.sort((a, b) => a.id.localeCompare(b.id))
        setAreas(merged)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load census data')
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => controller.abort()
  }, [])

  const bounds = useMemo(() => {
    if (!areas.length) return null
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity

    const scanCoordinates = (coords: number[][]) => {
      coords.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })
    }

    areas.forEach((area) => {
      if (area.geometry.type === 'Polygon') {
        area.geometry.coordinates.forEach((ring) => scanCoordinates(ring))
      } else {
        area.geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => scanCoordinates(ring))
        })
      }
    })

    return Number.isFinite(minLng) && Number.isFinite(minLat) && Number.isFinite(maxLng) && Number.isFinite(maxLat)
      ? { minLng, minLat, maxLng, maxLat }
      : null
  }, [areas])

  return { areas, bounds, loading, error }
}
