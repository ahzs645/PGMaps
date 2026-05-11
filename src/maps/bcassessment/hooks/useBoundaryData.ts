import { useEffect, useState } from 'react'
import type { AssessmentBoundaryLevel, BoundaryLevel } from '../types'

const BOUNDARY_FILES: Record<AssessmentBoundaryLevel, string> = {
  healthAuthority: '/data/boundaries/BCMoH/simplified/health_authorities.json',
  hsda: '/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json',
  lha: '/data/boundaries/BCMoH/simplified/local_health_areas.json',
  chsa: '/data/boundaries/BCMoH/simplified/community_health_service_areas.json',
  regionalDistrict: '/data/boundaries/BC/regional_districts.geojson',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
  db: '/data/census/prince_george_db.geo.json',
  elementarySchoolCatchment: '/data/boundaries/CityPG/elementary_school_catchments.geojson',
  secondarySchoolCatchment: '/data/boundaries/CityPG/secondary_school_catchments.geojson',
  majorWatershed: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
  watershedGroup: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
  assessmentWatershed: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
}

const BOUNDARY_CODE_PROPERTIES: Record<AssessmentBoundaryLevel, string[]> = {
  healthAuthority: ['HLTH_AUTHORITY_CODE'],
  hsda: ['HLTH_SERVICE_DLVR_AREA_CODE'],
  lha: ['LOCAL_HLTH_AREA_CODE'],
  chsa: ['CMNTY_HLTH_SERV_AREA_CODE'],
  regionalDistrict: ['ADMIN_AREA_ABBREVIATION', 'LGL_ADMIN_AREA_ID'],
  ct: ['id'],
  da: ['id'],
  db: ['id'],
  elementarySchoolCatchment: ['OBJECTID'],
  secondarySchoolCatchment: ['OBJECTID'],
  majorWatershed: ['boundaryCode', 'OBJECTID'],
  watershedGroup: ['boundaryCode', 'OBJECTID'],
  assessmentWatershed: ['boundaryCode', 'OBJECTID'],
}

function boundaryCode(
  feature: GeoJSON.Feature,
  level: AssessmentBoundaryLevel,
): string {
  const properties = feature.properties ?? {}
  for (const key of BOUNDARY_CODE_PROPERTIES[level]) {
    const value = properties[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return feature.id !== undefined ? String(feature.id) : ''
}

function normalizeBoundaryData(
  geojson: GeoJSON.FeatureCollection,
  level: AssessmentBoundaryLevel,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geojson.features
      .filter((feature) => (
        feature.geometry &&
        (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
      ))
      .map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          id: boundaryCode(feature, level),
        },
      })),
  }
}

export function useBoundaryData(level: BoundaryLevel) {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (level === 'none') {
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    fetch(BOUNDARY_FILES[level], { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed: ${res.status}`)
        return res.json()
      })
      .then((geojson: GeoJSON.FeatureCollection) => {
        setData(normalizeBoundaryData(geojson, level))
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load boundary data:', err)
          setData(null)
        }
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [level])

  return { boundaryData: data, boundaryLoading: loading }
}
