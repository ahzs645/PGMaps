import { useState } from 'react'
import { useFetchData } from '@/hooks/useFetchData'
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
        ct: p.ct ?? null,
        da: p.da ?? null,
        db: p.db ?? null,
        healthAuthority: p.healthAuthority ?? null,
        hsda: p.hsda ?? null,
        lha: p.lha ?? null,
        chsa: p.chsa ?? null,
        regionalDistrict: p.regionalDistrict ?? null,
        elementarySchoolCatchment: p.elementarySchoolCatchment ?? null,
        secondarySchoolCatchment: p.secondarySchoolCatchment ?? null,
        majorWatershed: p.majorWatershed ?? null,
        watershedGroup: p.watershedGroup ?? null,
        assessmentWatershed: p.assessmentWatershed ?? null,
        longitude,
        latitude,
        geometry,
      }
    })
}

export function useBcAssessmentData(enabled = true) {
  const { data, loading, error } = useFetchData<Property[]>('/data/bc-assessment/parcels.geojson', {
    enabled,
    transform: (json) => parseFeatures(json as GeoJSON.FeatureCollection),
  })

  // Keep the last loaded properties when `enabled` flips back to false or a
  // refetch fails, matching the previous hook's state-retention behavior.
  const [lastProperties, setLastProperties] = useState<Property[]>([])
  if (data && data !== lastProperties) setLastProperties(data)

  return { properties: data ?? lastProperties, loading, error }
}
