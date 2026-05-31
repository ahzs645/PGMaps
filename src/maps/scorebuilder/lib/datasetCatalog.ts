import type { MetricRecipeSource } from './metricRecipes'

export interface ScoreBuilderDataset {
  id: MetricRecipeSource
  label: string
  description: string
  sourceGroup: string
  path?: string
}

export interface DatasetFieldProfile {
  field: string
  count: number
  sampleValues: Array<string | number | boolean>
  valueCounts: Array<{ value: string; count: number }>
}

export interface DatasetProfile {
  rowCount: number
  pointCount: number
  geometryTypes: Array<{ type: string; count: number }>
  coordinateValidity: {
    validPoints: number
    invalidPoints: number
  }
  fields: DatasetFieldProfile[]
}

export const SCORE_BUILDER_DATASETS: ScoreBuilderDataset[] = [
  {
    id: 'healthyplanPg.businessPois',
    label: 'HealthyPlan PG business POIs',
    description: 'OSM/CityPG POIs classified for food, retail, and services.',
    sourceGroup: 'HealthyPlan PG',
    path: '/data/healthyplan-pg/business_pois.geojson',
  },
  {
    id: 'healthyplanPg.educationFacilities',
    label: 'HealthyPlan PG education facilities',
    description: 'K-12 schools, childcare, and post-secondary facilities.',
    sourceGroup: 'HealthyPlan PG',
    path: '/data/healthyplan-pg/education_facilities.geojson',
  },
  {
    id: 'healthyplanPg.businessLicencesBcGeocoded',
    label: 'CityPG business licences geocoded',
    description: 'CityPG business licence records geocoded with the BC Address Geocoder.',
    sourceGroup: 'HealthyPlan PG',
    path: '/data/healthyplan-pg/business_licences_bc_geocoded.geojson',
  },
  {
    id: 'restaurants',
    label: 'Food premises inspections',
    description: 'Northern Health/food map restaurant inspection points already loaded by PGMaps.',
    sourceGroup: 'Food map',
  },
  {
    id: 'census',
    label: '2021 Census variables',
    description: 'Create population-group metrics from local 2021 Census vectors.',
    sourceGroup: 'Census',
    path: '/data/census/variables/catalog.json',
  },
  {
    id: 'custom',
    label: 'Formula from existing metrics',
    description: 'Build a composite or transformed metric from metrics already in the Index Lab.',
    sourceGroup: 'Custom',
  },
]

export function profileFeatureCollection(collection: GeoJSON.FeatureCollection | null | undefined): DatasetProfile {
  const features = collection?.features ?? []
  const geometryCounts = new Map<string, number>()
  const fieldValues = new Map<string, unknown[]>()
  let validPoints = 0
  let invalidPoints = 0

  features.forEach((feature) => {
    const type = feature.geometry?.type ?? 'None'
    geometryCounts.set(type, (geometryCounts.get(type) ?? 0) + 1)
    if (feature.geometry?.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      if (Number.isFinite(lng) && Number.isFinite(lat)) validPoints += 1
      else invalidPoints += 1
    }
    Object.entries(feature.properties ?? {}).forEach(([field, value]) => {
      if (!fieldValues.has(field)) fieldValues.set(field, [])
      const values = fieldValues.get(field)
      if (values && values.length < 500) values.push(value)
    })
  })

  const fields = Array.from(fieldValues.entries())
    .map(([field, values]) => {
      const counts = new Map<string, number>()
      const samples: Array<string | number | boolean> = []
      values.forEach((value) => {
        if (value == null || typeof value === 'object') return
        const primitive = value as string | number | boolean
        if (samples.length < 8 && !samples.includes(primitive)) samples.push(primitive)
        const key = String(primitive)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      })
      return {
        field,
        count: values.length,
        sampleValues: samples,
        valueCounts: Array.from(counts.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
          .slice(0, 8),
      }
    })
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
    .slice(0, 24)

  return {
    rowCount: features.length,
    pointCount: geometryCounts.get('Point') ?? 0,
    geometryTypes: Array.from(geometryCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    coordinateValidity: { validPoints, invalidPoints },
    fields,
  }
}
