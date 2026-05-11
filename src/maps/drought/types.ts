export interface DroughtYearInfo {
  year: number
  file: string
  sourceUrl: string
  layerUrl: string
  featureCount: number
  expectedFeatureCount: number
  startDate: string | null
  endDate: string | null
}

export interface DroughtManifest {
  title: string
  source: string
  catalogUrl: string
  generatedAt: string
  years: DroughtYearInfo[]
}

export interface DroughtProperties {
  sourceYear: number
  sourceObjectId: number | string
  basinName: string
  basinId: number | string | null
  droughtLevel: number | null
  droughtLevelRaw: string | number | null
  droughtColor: string
  startDate: string | null
  endDate: string | null
  startDateMs: number | null
  endDateMs: number | null
}

export type DroughtFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, DroughtProperties>
export type DroughtFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, DroughtProperties>
