import type { ReactNode } from 'react'

export type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

export type MiscLayerId = 'trees' | 'forests' | 'facilities'
export type CanueYearMode = 'single' | 'month' | 'all' | 'range'
export type CanueV2Cadence = 'annual' | 'monthly'
export type CanueBoundarySource = 'bcHealth' | 'regionalDistrict' | 'census' | 'cityPG' | 'watershed' | 'nrAdmin'
export type CanueBoundaryLevel =
  | 'healthAuthority'
  | 'hsda'
  | 'lha'
  | 'chsa'
  | 'regionalDistrict'
  | 'cd'
  | 'csd'
  | 'ct'
  | 'da'
  | 'db'
  | 'elementarySchoolCatchment'
  | 'secondarySchoolCatchment'
  | 'majorWatershed'
  | 'watershedGroup'
  | 'assessmentWatershed'
  | 'nrArea'
  | 'nrRegion'
  | 'nrDistrict'

export interface CanueFile {
  datasetId: string
  label: string
  category: string
  cadence?: 'annual' | 'monthly'
  year: number
  output: string
  rowCount: number
  coordinateCount: number
  variables: string[]
  compression?: string
  gzipSize?: number
}

export interface CanueManifest {
  generatedAt: string
  province?: string
  boundaryClip?: string | null
  files: CanueFile[]
}

export interface CanueBoundaryResult {
  data: BoundaryFeatureCollection
  loading: boolean
  error: string | null
  minValue: number | null
  maxValue: number | null
  validBoundaryCount: number
  matchedRowCount: number
}

export interface CanueBoundaryFeatureCardData {
  title: string
  metricLabel: ReactNode
  metricValue: string
  recordCount: number
  recordLabel: string
}

export interface CanueDatasetGroup {
  datasetId: string
  label: string
  category: string
  files: CanueFile[]
  years: number[]
}

export interface BoundaryIndexEntry {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bbox: [number, number, number, number]
  id: string
  name: string
}

export interface BoundaryLevelConfig {
  path: string
  idField: string
  nameField: string
  label: string
}

export interface CanuePostalMembershipRecord {
  postalcode: string
  boundaries: Partial<Record<CanueBoundaryLevel, string>>
}

export interface CanuePostalMembership {
  generatedAt: string
  records: CanuePostalMembershipRecord[]
}

export interface CanueV2DatasetMetadataEntry {
  label?: string
  metadata?: {
    portalNames?: string[]
    downloadNames?: string[]
    shortCodes?: string[]
    yearCoverage?: string[]
    samplingFrequency?: string[]
    descriptions?: string[]
  }
}

export interface CanueV2MetadataLookup {
  datasets?: Record<string, CanueV2DatasetMetadataEntry>
}
