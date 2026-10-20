/**
 * The geodatabase layers, named by the procedure's convention
 * ([Project]_AVAST_Volume_Intersect, [Project]_Slope_Volume_Summary, …).
 * Pure: builds BC Albers GeoJSON features; gdal.ts writes them.
 */
import { slopeClassLabel } from './slope'
import { reportRows } from './report'
import type { OutputLayer } from './gdal'
import type { AvastSettings, Candidate, CommonPiece, MultiPolygonCoords, Piece, RunSummary, SlopeClass } from './types'

export type RunPieces = {
  avastPieces: Piece[]
  avastSlopePieces: Piece[]
  lidarPieces: Piece[]
  lidarSlopePieces: Piece[]
  commonPieces: CommonPiece[]
  slopeClasses: Map<string, Record<SlopeClass, MultiPolygonCoords>>
}

/** A File Geodatabase name: letters, digits and underscores, starting with a letter. */
export function datasetName(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `P_${cleaned || 'Project'}`
}

const feature = (geometry: MultiPolygonCoords | null, properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: geometry ? { type: 'MultiPolygon', coordinates: geometry } : (null as unknown as GeoJSON.Geometry),
  properties,
})

const round = (value: number | null | undefined, digits = 4) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits))

export function geodatabaseLayers(options: {
  project: string
  candidates: Candidate[]
  summary: RunSummary
  pieces: RunPieces
  settings: AvastSettings
  densityField: string
  lidarDensityField: string | null
  avastLayerNames: string[]
  lidarLayerNames: string[]
}): OutputLayer[] {
  const { candidates, summary, pieces, settings } = options
  const p = datasetName(options.project)
  const breaks = settings.slopeBreaks
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]))
  const rows = new Map(summary.candidates.map((row) => [row.key, row]))
  const owner = (key: string) => {
    const row = rows.get(key)
    return { Candidate_ID: row?.id ?? byKey.get(key)?.id ?? '', Operating_Area: row?.operatingArea ?? byKey.get(key)?.operatingArea ?? '' }
  }
  const factor = summary.factor
  const lt = `Vol_lt${breaks[0]}_m3`
  const mid = `Vol_${breaks[0]}_${breaks[1]}_m3`
  const gt = `Vol_gt${breaks[1]}_m3`
  const density = datasetName(options.densityField || 'CMM_m3ha')
  const lidarDensity = datasetName(options.lidarDensityField || 'LiDAR_m3ha')
  const layers: OutputLayer[] = []

  layers.push({
    name: `${p}_Candidates`,
    features: reportRows(summary, settings).map((row) => feature(byKey.get(row.key)?.geometry ?? null, {
      Candidate_ID: row.id,
      Operating_Area: row.operatingArea,
      Source_Type: row.sourceType,
      Source_File: row.sourceName,
      Gross_HA: round(row.grossHa),
      AVAST_Covered_HA: round(row.avastCoveredHa),
      AVAST_Coverage_Pct: round(row.avastCoveragePct, 2),
      AVAST_Raw_Volume_m3: round(row.avastRawVolume, 2),
      Weighted_AVAST_m3ha: round(row.weightedAvastM3ha, 2),
      LiDAR_Covered_HA: round(row.lidarCoveredHa),
      LiDAR_Volume_m3: round(row.lidarVolume, 2),
      LiDAR_Factor: round(row.factor),
      Final_Planning_Volume_m3: round(row.finalVolume, 2),
      Volume_Source: row.volumeSource,
      [lt]: round(row.classVolume?.[0], 2),
      [mid]: round(row.classVolume?.[1], 2),
      [gt]: round(row.classVolume?.[2], 2),
      Reported_Volume_m3: round(row.reportedVolume, 2),
      Preferred_VPH: round(row.preferredVph, 2),
      Coverage_Class: row.coverageClass,
      Estimate_Source: row.estimateSource,
      Notes: row.notes,
      Duplicate_Check: row.duplicate ? 'DUPLICATE' : 'OK',
    })),
  })

  layers.push({
    name: `${p}_AVAST_Volume_Intersect`,
    integers: ['AVAST_FID'],
    features: pieces.avastPieces.map((piece) => feature(piece.geometry, {
      ...owner(piece.candidateKey),
      AVAST_Source: options.avastLayerNames[piece.layerIndex] ?? '',
      AVAST_FID: piece.fid,
      [density]: round(piece.density),
      Piece_HA: round(piece.areaHa, 6),
      AVAST_Vol_m3: round(piece.volume, 3),
    })),
  })

  if (pieces.avastSlopePieces.length) {
    layers.push({
      name: `${p}_AVAST_Slope_Intersect`,
      integers: ['AVAST_FID', 'Slope_Class'],
      features: pieces.avastSlopePieces.map((piece) => feature(piece.geometry, {
        ...owner(piece.candidateKey),
        AVAST_FID: piece.fid,
        [density]: round(piece.density),
        Slope_Class: piece.slopeClass,
        Slope_Range: piece.slopeClass ? slopeClassLabel(piece.slopeClass, breaks) : 'No slope data',
        Piece_HA: round(piece.areaHa, 6),
        Raw_Vol_m3: round(piece.volume, 3),
        Adjusted_Vol_m3: factor === null ? null : round(piece.volume * factor, 3),
      })),
    })
  }

  if (pieces.slopeClasses.size) {
    layers.push({
      name: `${p}_Slope_Class_Polygon`,
      integers: ['Slope_Class'],
      features: [...pieces.slopeClasses.entries()].flatMap(([key, classes]) =>
        ([1, 2, 3] as const).filter((slopeClass) => classes[slopeClass].length).map((slopeClass) => feature(classes[slopeClass], {
          ...owner(key),
          Slope_Class: slopeClass,
          Slope_Range: slopeClassLabel(slopeClass, breaks),
        }))),
    })
  }

  if (pieces.lidarPieces.length) {
    layers.push({
      name: `${p}_LiDAR_Volume_Intersect`,
      integers: ['LiDAR_FID'],
      features: pieces.lidarPieces.map((piece) => feature(piece.geometry, {
        ...owner(piece.candidateKey),
        LiDAR_Source: options.lidarLayerNames[piece.layerIndex] ?? '',
        LiDAR_FID: piece.fid,
        [lidarDensity]: round(piece.density),
        Piece_HA: round(piece.areaHa, 6),
        LiDAR_Vol_m3: round(piece.volume, 3),
      })),
    })
  }
  if (pieces.lidarSlopePieces.length) {
    layers.push({
      name: `${p}_LiDAR_Slope_Intersect`,
      integers: ['LiDAR_FID', 'Slope_Class'],
      features: pieces.lidarSlopePieces.map((piece) => feature(piece.geometry, {
        ...owner(piece.candidateKey),
        LiDAR_FID: piece.fid,
        [lidarDensity]: round(piece.density),
        Slope_Class: piece.slopeClass,
        Slope_Range: piece.slopeClass ? slopeClassLabel(piece.slopeClass, breaks) : 'No slope data',
        Piece_HA: round(piece.areaHa, 6),
        LiDAR_Vol_m3: round(piece.volume, 3),
      })),
    })
  }
  if (pieces.commonPieces.length) {
    layers.push({
      name: `${p}_LiDAR_AVAST_Common_Footprint`,
      features: pieces.commonPieces.map((piece) => feature(piece.geometry, {
        ...owner(piece.candidateKey),
        [density]: round(piece.avastDensity),
        [lidarDensity]: round(piece.lidarDensity),
        Piece_HA: round(piece.areaHa, 6),
        AVAST_Vol_m3: round(piece.avastVolume, 3),
        LiDAR_Vol_m3: round(piece.lidarVolume, 3),
      })),
    })
  }

  if (summary.candidates.some((row) => row.classVolume)) {
    layers.push({
      name: `${p}_Slope_Volume_Summary`,
      table: true,
      features: reportRows(summary, settings).map((row) => feature(null, {
        Candidate_ID: row.id,
        Operating_Area: row.operatingArea,
        Source_Type: row.sourceType,
        Gross_HA: round(row.grossHa),
        Volume_Source: row.volumeSource,
        LiDAR_Adjustment_Factor: round(row.factor),
        [lt]: round(row.classVolume?.[0], 2),
        [mid]: round(row.classVolume?.[1], 2),
        [gt]: round(row.classVolume?.[2], 2),
        No_Slope_Data_m3: round(row.unclassifiedVolume, 2),
        Total_Planning_Vol_m3: round(row.finalVolume, 2),
      })),
    })
  }
  if (summary.calibration?.rows.length) {
    const calibration = summary.calibration
    layers.push({
      name: `${p}_LiDAR_Calibration_Summary`,
      table: true,
      features: [
        ...calibration.rows.map((row) => feature(null, {
          Calibration_Area: row.id,
          Operating_Area: row.operatingArea,
          Common_Area_HA: round(row.commonAreaHa),
          AVAST_Volume_m3: round(row.avastVolume, 2),
          AVAST_Weighted_m3ha: round(row.commonAreaHa > 0 ? row.avastVolume / row.commonAreaHa : null, 2),
          LiDAR_Volume_m3: round(row.lidarVolume, 2),
          LiDAR_Weighted_m3ha: round(row.commonAreaHa > 0 ? row.lidarVolume / row.commonAreaHa : null, 2),
          LiDAR_Factor: round(row.factor),
        })),
        feature(null, {
          Calibration_Area: 'TOTAL (aggregate)',
          Operating_Area: '',
          Common_Area_HA: round(calibration.commonAreaHa),
          AVAST_Volume_m3: round(calibration.avastVolume, 2),
          AVAST_Weighted_m3ha: round(calibration.avastWeighted, 2),
          LiDAR_Volume_m3: round(calibration.lidarVolume, 2),
          LiDAR_Weighted_m3ha: round(calibration.lidarWeighted, 2),
          LiDAR_Factor: round(calibration.factor),
        }),
      ],
    })
  }
  return layers
}
