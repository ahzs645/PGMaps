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
  canonical?: {
    basinFile: string
    timeseriesFile: string
    canonicalYear: number
    basinCount: number
    recordCount: number
    note: string
  }
  years: DroughtYearInfo[]
}

export interface DroughtProperties {
  sourceYear?: number
  sourceObjectId?: number | string
  basinName: string
  basinId: number | string | null
  droughtLevel: number | null
  droughtLevelRaw: string | number | null
  droughtColor: string
  startDate: string | null
  endDate: string | null
  startDateMs: number | null
  endDateMs: number | null
  activeRecordId?: string | null
  sourceBasinName?: string | null
}

export interface DroughtTimeSeriesYearInfo {
  year: number
  sourceFeatureCount: number
  canonicalRecordCount: number
  unmappedSourceFeatureCount: number
  startDate: string | null
  endDate: string | null
}

export interface DroughtTimeSeriesRecord {
  id: string
  year: number
  basinId: string
  basinName: string
  sourceBasinName: string | null
  sourceObjectId: number | string | null
  droughtLevel: number | null
  droughtLevelRaw: string | number | null
  droughtColor: string
  startDate: string | null
  endDate: string | null
  startDateMs: number | null
  endDateMs: number | null
}

export interface DroughtTimeSeries {
  title: string
  source: string
  canonicalYear: number
  generatedAt: string
  basinCount: number
  recordCount: number
  years: DroughtTimeSeriesYearInfo[]
  records: DroughtTimeSeriesRecord[]
}

export type DroughtFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, DroughtProperties>
export type DroughtFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, DroughtProperties>
