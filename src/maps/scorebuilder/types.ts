import type { BoundarySource, RegionLevel } from '@/maps/airquality'

export type ScoreMetricKey =
  | 'overallDensity'
  | 'lowCostDensity'
  | 'referenceDensity'
  | 'networkVariety'
  | 'parameterVariety'
  | 'activeShare'
  | 'monitorCount'

export type ScoreMetricFormat = 'density' | 'count' | 'ratio'

export interface ScoreMetricDefinition {
  key: ScoreMetricKey
  label: string
  shortLabel: string
  description: string
  format: ScoreMetricFormat
}

export type ScoreMetricWeightMap = Record<ScoreMetricKey, number>
export type ScoreMetricValueMap = Record<ScoreMetricKey, number>

export interface ScoreBuilderRegion {
  id: string
  code: string
  name: string
  source: BoundarySource
  level: RegionLevel
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bounds: [number, number, number, number]
  areaKm2: number
}

export interface ScorePreset {
  key: string
  label: string
  description: string
  weights: ScoreMetricWeightMap
}

export interface ScoredBoundaryRegion {
  region: ScoreBuilderRegion
  metrics: ScoreMetricValueMap
  normalizedMetrics: ScoreMetricValueMap
  contributions: ScoreMetricValueMap
  counts: {
    monitorCount: number
    lowCostCount: number
    referenceCount: number
    activeCount: number
  }
  score: number
  scoreColor: string
  rank: number
}
