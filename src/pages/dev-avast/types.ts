/**
 * Shared shapes for the AVAST volume utility. Every coordinate here is BC
 * Albers (EPSG:3005) metres: GDAL reprojects the inputs on read, so piece
 * areas are planar equal-area hectares — what ArcGIS's Calculate Geometry
 * Attributes reports for a BC Albers feature class.
 */

export type Position = [number, number]
export type Ring = Position[]
export type PolygonCoords = Ring[]
export type MultiPolygonCoords = PolygonCoords[]
export type BBox = [minX: number, minY: number, maxX: number, maxY: number]

/** Slope category: 1 = below the first break, 2 = between the breaks inclusive, 3 = above the second. */
export type SlopeClass = 1 | 2 | 3

export type Candidate = {
  /** Unique within a run; Block IDs can repeat or be blank, so they cannot key anything. */
  key: string
  id: string
  operatingArea: string
  sourceType: string
  /** Gross / merchantable area from the attribute table, when it holds a positive number. */
  fieldHa: number | null
  geometryHa: number
  geometry: MultiPolygonCoords
  bbox: BBox
  sourceName: string
}

/** One polygon of a volume-density layer (AVAST TimberAnalysis_Base or a LiDAR volume layer). */
export type DensityFeature = {
  fid: number
  /** m³/ha. `null` when the source value is missing or not numeric. */
  density: number | null
  /** Polygon-average percent slope, when the layer carries one. */
  slopePercent: number | null
  operatingArea: string
  /** Index into the run's list of volume layers; lower wins where layers overlap. */
  layerIndex: number
  geometry: MultiPolygonCoords
  bbox: BBox
}

export type VolumeLayerSummary = {
  name: string
  kind: 'avast' | 'lidar'
  featureCount: number
  nullDensityCount: number
}

/** A candidate ∩ volume polygon (∩ slope class) piece. */
export type Piece = {
  candidateKey: string
  kind: 'avast' | 'lidar'
  layerIndex: number
  fid: number
  density: number
  densityMissing: boolean
  slopeClass: SlopeClass | null
  slopePercent: number | null
  areaHa: number
  volume: number
  geometry: MultiPolygonCoords
}

/** AVAST ∩ LiDAR over one candidate — the common calibration footprint of Part 2. */
export type CommonPiece = {
  candidateKey: string
  avastDensity: number
  lidarDensity: number
  areaHa: number
  avastVolume: number
  lidarVolume: number
  geometry: MultiPolygonCoords
}

export type ClassTotals = { areaHa: [number, number, number]; volume: [number, number, number]; unclassifiedHa: number; unclassifiedVolume: number }

/** Geometry results for one candidate, before any factor or reporting choice is applied. */
export type CandidateRaw = {
  key: string
  avast: {
    coveredHa: number
    volume: number
    pieceCount: number
    nullDensityHa: number
    byClass: ClassTotals | null
    /** The AVAST operating area covering most of the block, for blocks whose own attribute is blank. */
    operatingArea: string
    /** Volume layers that contributed pieces. */
    layers: number[]
  }
  lidar: { coveredHa: number; volume: number; pieceCount: number; byClass: ClassTotals | null } | null
  common: { areaHa: number; avastVolume: number; lidarVolume: number } | null
  /** Hectares of the candidate that more than one AVAST layer covered; the earlier layer was used. */
  overlapHa: number
  warnings: string[]
}

export type SlopeSource = 'dem' | 'attribute' | 'none'
export type LidarMode = 'none' | 'factor' | 'calibrate'
export type VolumeBasis = 'total' | 'class1' | 'class12'
export type VolumeSource = 'LiDAR' | 'AVAST - LiDAR Adjusted' | 'AVAST Raw'

/** Settings that change the geometry. Changing one means re-running the overlay. */
export type GeometrySettings = {
  slopeSource: SlopeSource
  slopeBreaks: [number, number]
  demZoom: number
  slopeCellMeters: number
  /** Pieces smaller than this are slivers from coincident edges and are dropped. */
  minPieceHa: number
}

/** Settings applied after the overlay; changing these re-summarises instantly. */
export type ReportSettings = {
  projectName: string
  sourceType: string
  grossArea: 'field' | 'geometry'
  coverageGoodPct: number
  coverageModeratePct: number
  coverageLowPct: number
  lidarMode: LidarMode
  lidarFactor: number
  lidarFactorNote: string
  directLidarMinCoveragePct: number
  calibrationMinCoveragePct: number
  /** Operating areas whose blocks feed the calibration; empty means every eligible block. */
  calibrationOperatingAreas: string[]
  volumeBasis: VolumeBasis
  vphDecimals: number
  referenceTargetM3: number | null
  pasteStartRow: number
  notesIncludeSlope: boolean
  duplicates: 'flag' | 'drop'
  /** Operating areas left out of the report, e.g. Gaffney in the Dunkley workbook. */
  excludedOperatingAreas: string[]
}

export type AvastSettings = GeometrySettings & ReportSettings

export type CandidateSummary = {
  key: string
  id: string
  operatingArea: string
  sourceType: string
  sourceName: string
  grossHa: number
  grossFromGeometry: boolean
  avastCoveredHa: number
  avastCoveragePct: number
  avastRawVolume: number
  weightedAvastM3ha: number | null
  lidarCoveredHa: number | null
  lidarCoveragePct: number | null
  lidarVolume: number | null
  factor: number | null
  volumeSource: VolumeSource
  finalVolume: number
  /** Final (source-adjusted) volume by slope class, or null when slope was not assessed. */
  classVolume: [number, number, number] | null
  classAreaHa: [number, number, number] | null
  unclassifiedVolume: number
  reportedVolume: number
  preferredVph: number | null
  coverageClass: 'good' | 'moderate' | 'low' | 'none'
  estimateSource: string
  notes: string
  duplicate: boolean
  excluded: boolean
  warnings: string[]
}

export type CalibrationRow = {
  key: string
  id: string
  operatingArea: string
  commonAreaHa: number
  avastVolume: number
  lidarVolume: number
  factor: number | null
}

export type Calibration = {
  rows: CalibrationRow[]
  commonAreaHa: number
  avastVolume: number
  lidarVolume: number
  avastWeighted: number | null
  lidarWeighted: number | null
  factor: number | null
}

export type RunSummary = {
  candidates: CandidateSummary[]
  calibration: Calibration | null
  factor: number | null
  byOperatingArea: Array<{ operatingArea: string; blocks: number; volume: number; class1: number | null }>
  totals: { blocks: number; volume: number; avastRawVolume: number; grossHa: number; coveredHa: number }
  qa: string[]
}
