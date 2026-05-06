import { useEffect, useMemo, useState } from 'react'
import type { CensusBounds, CensusHierarchyLevel, CensusUnit } from '../types'

interface RawGeoFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry?: GeoJSON.Geometry | null
}

interface RawGeoResponse {
  type: 'FeatureCollection'
  features?: RawGeoFeature[]
}

const LEVEL_FILES: Record<CensusHierarchyLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: '/data/census/prince_george_csd.geo.json',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
  db: '/data/census/prince_george_db.geo.json'
}

function emptyUnitsByLevel(): Record<CensusHierarchyLevel, CensusUnit[]> {
  return {
    cd: [],
    csd: [],
    ct: [],
    da: [],
    db: []
  }
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null
  const cleaned = String(value).replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function readUnit(feature: RawGeoFeature, fallbackLevel: CensusHierarchyLevel): CensusUnit | null {
  const geometry = feature.geometry
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return null
  }

  const properties = feature.properties || {}
  const id = parseString(properties.id)
  if (!id) return null

  const levelRaw = parseString(properties.level)
  const level = (levelRaw || fallbackLevel) as CensusHierarchyLevel
  const daCount = parseNumber(properties.daCount)
  const dbCount = parseNumber(properties.dbCount)

  return {
    id,
    level,
    name: parseString(properties.name) || `${level.toUpperCase()} ${id}`,
    population: parseNumber(properties.population),
    populationDensity: parseNumber(properties.populationDensity),
    households: parseNumber(properties.households),
    dwellings: parseNumber(properties.dwellings),
    areaSqKm: parseNumber(properties.areaSqKm),
    daCount: Number.isFinite(daCount) ? Math.round(daCount || 0) : 0,
    dbCount: Number.isFinite(dbCount) ? Math.round(dbCount || 0) : 0,
    parentCdId: parseString(properties.parentCdId),
    parentCsdId: parseString(properties.parentCsdId),
    parentCtId: parseString(properties.parentCtId),
    parentDaId: parseString(properties.parentDaId),
    geometry
  }
}

function scanCoordinates(ring: number[][], accumulator: CensusBounds) {
  ring.forEach(([lng, lat]) => {
    if (lng < accumulator.minLng) accumulator.minLng = lng
    if (lng > accumulator.maxLng) accumulator.maxLng = lng
    if (lat < accumulator.minLat) accumulator.minLat = lat
    if (lat > accumulator.maxLat) accumulator.maxLat = lat
  })
}

function computeBounds(units: CensusUnit[]): CensusBounds | null {
  if (!units.length) return null

  const bounds: CensusBounds = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  }

  units.forEach((unit) => {
    if (unit.geometry.type === 'Polygon') {
      unit.geometry.coordinates.forEach((ring) => scanCoordinates(ring, bounds))
    } else {
      unit.geometry.coordinates.forEach((polygon) => {
        polygon.forEach((ring) => scanCoordinates(ring, bounds))
      })
    }
  })

  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) {
    return null
  }

  return bounds
}

function getPrimaryBounds(
  boundsByLevel: Record<CensusHierarchyLevel, CensusBounds | null>
): CensusBounds | null {
  return boundsByLevel.csd || boundsByLevel.da || boundsByLevel.ct || boundsByLevel.db || boundsByLevel.cd || null
}

export function useCensusData(enabled = true) {
  const [unitsByLevel, setUnitsByLevel] = useState<Record<CensusHierarchyLevel, CensusUnit[]>>(emptyUnitsByLevel)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const levelEntries = Object.entries(LEVEL_FILES) as Array<[CensusHierarchyLevel, string]>
        const responses = await Promise.all(
          levelEntries.map(async ([level, file]) => {
            const response = await fetch(file, { signal: controller.signal })
            if (!response.ok) {
              throw new Error(`Failed to load ${level.toUpperCase()} geometry (${response.status})`)
            }
            const json = await response.json() as RawGeoResponse
            const units = (json.features || [])
              .map((feature) => readUnit(feature, level))
              .filter((unit): unit is CensusUnit => unit !== null)
              .sort((a, b) => a.id.localeCompare(b.id))
            return [level, units] as const
          })
        )

        const next = emptyUnitsByLevel()
        responses.forEach(([level, units]) => {
          next[level] = units
        })

        setUnitsByLevel(next)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load census data')
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [enabled])

  const boundsByLevel = useMemo(() => {
    return {
      cd: computeBounds(unitsByLevel.cd),
      csd: computeBounds(unitsByLevel.csd),
      ct: computeBounds(unitsByLevel.ct),
      da: computeBounds(unitsByLevel.da),
      db: computeBounds(unitsByLevel.db)
    } satisfies Record<CensusHierarchyLevel, CensusBounds | null>
  }, [unitsByLevel])

  const bounds = useMemo(() => getPrimaryBounds(boundsByLevel), [boundsByLevel])

  return { unitsByLevel, boundsByLevel, bounds, loading, error }
}
