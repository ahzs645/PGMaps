import type { BBox, MultiPolygonCoords } from '../dev-avast/types'
export type { BBox, MultiPolygonCoords }

export type InputRole = 'areas' | 'official' | 'proxy' | 'vri' | 'deferral' | 'admin'
export type SourceKind = 'official' | 'proxy'
export type Maturity = 'mature' | 'immature' | 'unknown'
export type Fields = { id: string; factor: string; year: string; age: string; name: string }
export type SourceInfo = { role: InputRole; name: string; features: number; fields?: Fields }
export type PolygonInput = {
  key: string
  id: string
  geometry: MultiPolygonCoords
  bbox: BBox
  factor: number | null
  year: number | null
  age: number | null
  name: string
  source: string
}
export type AnalysisInput = Record<InputRole, PolygonInput[]> & {
  assessedRoles?: InputRole[]
  suppliedSources?: SourceInfo[]
}
export type Settings = {
  matureAge: number
  /** Null means affected area only; a percentage is an explicit scenario assumption. */
  reductionPercent: number | null
  demo: boolean
}
export type Piece = {
  areaId: string
  source: string
  kind: SourceKind
  factor: number | null
  year: number | null
  maturity: Maturity
  deferral: 'inside' | 'outside' | 'not assessed'
  admin: string
  areaHa: number
  thlbHa: number | null
  geometry: MultiPolygonCoords
}
export type Summary = {
  id: string
  areaHa: number
  coveredHa: number
  uncoveredHa: number
  unknownFactorHa: number
  officialThlbHa: number
  proxyThlbHa: number
  thlbHa: number
  reductionHa: number | null
  matureThlbHa: number
  immatureThlbHa: number
  unknownAgeThlbHa: number
  deferralThlbHa: number | null
}
export type AnalysisResult = {
  settings: Settings
  rows: Summary[]
  /** The union of all assessment areas: never the sum of overlapping WHAs. */
  combined: Summary
  pieces: Piece[]
  combinedPieces: Piece[]
  warnings: string[]
  sources: SourceInfo[]
  areas: PolygonInput[]
}
