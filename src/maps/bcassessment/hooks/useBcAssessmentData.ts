import { useEffect, useState } from 'react'
import type { Property, PropertyCategory } from '../types'

function centroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const coords =
    geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat(2)
      : geometry.coordinates.flat(1)

  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of coords) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / coords.length, sumLat / coords.length]
}

function parseFeatures(geojson: GeoJSON.FeatureCollection): Property[] {
  return geojson.features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f) => {
      const p = f.properties ?? {}
      const geometry = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
      const [longitude, latitude] = centroid(geometry)

      return {
        id: p.oid_evbc ?? '',
        address: p.address ?? '',
        roll: p.roll ?? '',
        description: p.desc ?? '',
        category: (p.cat ?? 'other') as PropertyCategory,
        totalAssessed: p.val ?? 0,
        totalLand: p.land ?? 0,
        totalBuilding: p.bldg ?? 0,
        yearBuilt: p.yr ?? null,
        bedrooms: p.bed ?? null,
        bathrooms: p.bath ?? null,
        landSize: p.sz ?? null,
        totalFinishedArea: p.tfa ?? null,
        pid: p.pid ?? null,
        salePrice: p.sale ?? null,
        saleDate: p.saleDate ?? null,
        histValues: p.hist ?? null,
        longitude,
        latitude,
        geometry,
      }
    })
}

export function useBcAssessmentData() {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/data/bc-assessment/parcels.geojson', {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Failed to load: ${response.status}`)
        const geojson: GeoJSON.FeatureCollection = await response.json()
        setProperties(parseFeatures(geojson))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load BC Assessment data')
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [])

  return { properties, loading, error }
}
