/**
 * Parts 1–3 of the AVAST procedure for one candidate: Pairwise Intersect with
 * the volume layer, piece area in hectares, piece volume = density × area,
 * the same against a LiDAR layer and the slope classes, and the AVAST ∩ LiDAR
 * common footprint used for calibration. Pure: no DOM or network access.
 */
import RBush from 'rbush'
import { difference, intersect, multiPolygonArea, squareMetresToHa, union } from './geometry'
import { classifySlope } from './slope'
import type {
  BBox,
  Candidate,
  CandidateRaw,
  ClassTotals,
  CommonPiece,
  DensityFeature,
  GeometrySettings,
  MultiPolygonCoords,
  Piece,
  SlopeClass,
} from './types'

type IndexItem = { minX: number; minY: number; maxX: number; maxY: number; feature: DensityFeature }

export type DensityIndex = {
  search(bbox: BBox): DensityFeature[]
  size: number
}

export function buildDensityIndex(features: DensityFeature[]): DensityIndex {
  const tree = new RBush<IndexItem>()
  tree.load(
    features.map((feature) => ({
      minX: feature.bbox[0],
      minY: feature.bbox[1],
      maxX: feature.bbox[2],
      maxY: feature.bbox[3],
      feature,
    })),
  )
  return {
    size: features.length,
    search: ([minX, minY, maxX, maxY]) =>
      tree
        .search({ minX, minY, maxX, maxY })
        .map((item) => item.feature)
        .sort((a, b) => a.layerIndex - b.layerIndex || a.fid - b.fid),
  }
}

/** Slope classes for one candidate: the DEM's class polygons, or the volume polygon's own average slope. */
export type SlopeContext =
  | { source: 'dem'; classPolygons: Record<SlopeClass, MultiPolygonCoords> }
  | { source: 'attribute' }
  | { source: 'none' }

export type CandidateOverlay = {
  raw: CandidateRaw
  avastPieces: Piece[]
  avastSlopePieces: Piece[]
  lidarPieces: Piece[]
  lidarSlopePieces: Piece[]
  commonPieces: CommonPiece[]
  /** The DEM's slope classes clipped to the candidate, for the Slope_Class_Polygon output. */
  slopeClasses: Record<SlopeClass, MultiPolygonCoords> | null
}

function makePiece(
  candidate: Candidate,
  kind: Piece['kind'],
  feature: DensityFeature,
  geometry: MultiPolygonCoords,
  slopeClass: SlopeClass | null,
): Piece {
  const areaHa = squareMetresToHa(multiPolygonArea(geometry))
  const density = feature.density ?? 0
  return {
    candidateKey: candidate.key,
    kind,
    layerIndex: feature.layerIndex,
    fid: feature.fid,
    density,
    densityMissing: feature.density === null,
    slopeClass,
    slopePercent: feature.slopePercent,
    areaHa,
    // Piece Volume = Piece Area × density. Never Gross Area × one density,
    // and never a sum or simple average of densities.
    volume: density * areaHa,
    geometry,
  }
}

/**
 * Intersects a candidate with every overlapping density polygon. Where two
 * layers cover the same ground (PG and TSN AVAST along their shared edge) the
 * earlier layer keeps it, so no hectare is counted twice.
 */
function intersectLayers(candidate: Candidate, index: DensityIndex, kind: Piece['kind'], minPieceHa: number) {
  const hits = index.search(candidate.bbox)
  const pieces: Piece[] = []
  let overlapHa = 0
  let claimed: MultiPolygonCoords = []
  let region = candidate.geometry
  const layers = [...new Set(hits.map((feature) => feature.layerIndex))]
  layers.forEach((layerIndex, position) => {
    if (position > 0) {
      claimed = union(...pieces.map((piece) => piece.geometry))
      region = difference(candidate.geometry, claimed)
    }
    for (const feature of hits) {
      if (feature.layerIndex !== layerIndex) continue
      if (position > 0 && claimed.length) {
        overlapHa += squareMetresToHa(
          multiPolygonArea(intersect(intersect(candidate.geometry, feature.geometry), claimed)),
        )
      }
      const geometry = intersect(region, feature.geometry)
      if (!geometry.length) continue
      const piece = makePiece(candidate, kind, feature, geometry, null)
      if (piece.areaHa < minPieceHa) continue
      pieces.push(piece)
    }
  })
  return { pieces, overlapHa, layers }
}

function emptyTotals(): ClassTotals {
  return { areaHa: [0, 0, 0], volume: [0, 0, 0], unclassifiedHa: 0, unclassifiedVolume: 0 }
}

/** Splits pieces by slope class and returns the class pieces plus their totals. */
function splitBySlope(
  candidate: Candidate,
  pieces: Piece[],
  slope: SlopeContext,
  candidateClass: Record<SlopeClass, MultiPolygonCoords> | null,
  breaks: readonly [number, number],
  minPieceHa: number,
  features: Map<string, DensityFeature>,
): { slopePieces: Piece[]; totals: ClassTotals | null } {
  if (slope.source === 'none') return { slopePieces: [], totals: null }
  const totals = emptyTotals()
  const slopePieces: Piece[] = []
  for (const piece of pieces) {
    const feature = features.get(`${piece.layerIndex}:${piece.fid}`)!
    if (slope.source === 'attribute') {
      if (piece.slopePercent === null || !Number.isFinite(piece.slopePercent)) {
        totals.unclassifiedHa += piece.areaHa
        totals.unclassifiedVolume += piece.volume
        slopePieces.push(piece)
        continue
      }
      const slopeClass = classifySlope(piece.slopePercent, breaks)
      const classed = { ...piece, slopeClass }
      totals.areaHa[slopeClass - 1] += piece.areaHa
      totals.volume[slopeClass - 1] += piece.volume
      slopePieces.push(classed)
      continue
    }
    let classedHa = 0
    let classedVolume = 0
    for (const slopeClass of [1, 2, 3] as const) {
      const geometry = intersect(piece.geometry, candidateClass![slopeClass])
      if (!geometry.length) continue
      const part = makePiece(candidate, piece.kind, feature, geometry, slopeClass)
      if (part.areaHa < minPieceHa) continue
      totals.areaHa[slopeClass - 1] += part.areaHa
      totals.volume[slopeClass - 1] += part.volume
      classedHa += part.areaHa
      classedVolume += part.volume
      slopePieces.push(part)
    }
    // Cells the DEM could not classify (missing tiles) stay visible in the
    // reconciliation instead of silently vanishing from the total.
    const missingHa = piece.areaHa - classedHa
    if (missingHa > minPieceHa) {
      totals.unclassifiedHa += missingHa
      totals.unclassifiedVolume += piece.volume - classedVolume
    }
  }
  return { slopePieces, totals }
}

function featureLookup(pieces: Piece[], index: DensityIndex, bbox: BBox) {
  const lookup = new Map<string, DensityFeature>()
  if (!pieces.length) return lookup
  for (const feature of index.search(bbox)) lookup.set(`${feature.layerIndex}:${feature.fid}`, feature)
  return lookup
}

export function overlayCandidate(
  candidate: Candidate,
  avast: DensityIndex,
  lidar: DensityIndex | null,
  slope: SlopeContext,
  settings: GeometrySettings,
): CandidateOverlay {
  const warnings: string[] = []
  const candidateClass =
    slope.source === 'dem'
      ? {
          1: intersect(candidate.geometry, slope.classPolygons[1]),
          2: intersect(candidate.geometry, slope.classPolygons[2]),
          3: intersect(candidate.geometry, slope.classPolygons[3]),
        }
      : null

  const avastResult = intersectLayers(candidate, avast, 'avast', settings.minPieceHa)
  const avastFeatures = featureLookup(avastResult.pieces, avast, candidate.bbox)
  const avastSplit = splitBySlope(
    candidate,
    avastResult.pieces,
    slope,
    candidateClass,
    settings.slopeBreaks,
    settings.minPieceHa,
    avastFeatures,
  )
  const avastCovered = avastResult.pieces.reduce((sum, piece) => sum + piece.areaHa, 0)
  const avastVolume = avastResult.pieces.reduce((sum, piece) => sum + piece.volume, 0)
  const nullDensityHa = avastResult.pieces
    .filter((piece) => piece.densityMissing)
    .reduce((sum, piece) => sum + piece.areaHa, 0)
  if (avastCovered > candidate.geometryHa * 1.001 + 0.01) {
    warnings.push(
      `AVAST polygons overlap inside this block: ${avastCovered.toFixed(2)} ha covered of a ${candidate.geometryHa.toFixed(2)} ha polygon.`,
    )
  }
  if (nullDensityHa > 0)
    warnings.push(`${nullDensityHa.toFixed(2)} ha of AVAST has no numeric density and counts as 0 m³/ha.`)

  const operatingAreaHa = new Map<string, number>()
  for (const piece of avastResult.pieces) {
    const name = avastFeatures.get(`${piece.layerIndex}:${piece.fid}`)?.operatingArea ?? ''
    if (name) operatingAreaHa.set(name, (operatingAreaHa.get(name) ?? 0) + piece.areaHa)
  }
  const avastOperatingArea = [...operatingAreaHa.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  let lidarPieces: Piece[] = []
  let lidarSlopePieces: Piece[] = []
  let lidarRaw: CandidateRaw['lidar'] = null
  const commonPieces: CommonPiece[] = []
  let commonRaw: CandidateRaw['common'] = null
  if (lidar) {
    const lidarResult = intersectLayers(candidate, lidar, 'lidar', settings.minPieceHa)
    lidarPieces = lidarResult.pieces
    const lidarSplit = splitBySlope(
      candidate,
      lidarPieces,
      slope,
      candidateClass,
      settings.slopeBreaks,
      settings.minPieceHa,
      featureLookup(lidarPieces, lidar, candidate.bbox),
    )
    lidarSlopePieces = lidarSplit.slopePieces
    lidarRaw = {
      coveredHa: lidarPieces.reduce((sum, piece) => sum + piece.areaHa, 0),
      volume: lidarPieces.reduce((sum, piece) => sum + piece.volume, 0),
      pieceCount: lidarPieces.length,
      byClass: lidarSplit.totals,
    }
    // Part 2's common footprint: candidate ∩ AVAST ∩ LiDAR, so both totals
    // describe exactly the same hectares.
    for (const avastPiece of avastResult.pieces) {
      for (const lidarPiece of lidarPieces) {
        const geometry = intersect(avastPiece.geometry, lidarPiece.geometry)
        if (!geometry.length) continue
        const areaHa = squareMetresToHa(multiPolygonArea(geometry))
        if (areaHa < settings.minPieceHa) continue
        commonPieces.push({
          candidateKey: candidate.key,
          avastDensity: avastPiece.density,
          lidarDensity: lidarPiece.density,
          areaHa,
          avastVolume: avastPiece.density * areaHa,
          lidarVolume: lidarPiece.density * areaHa,
          geometry,
        })
      }
    }
    if (commonPieces.length) {
      commonRaw = {
        areaHa: commonPieces.reduce((sum, piece) => sum + piece.areaHa, 0),
        avastVolume: commonPieces.reduce((sum, piece) => sum + piece.avastVolume, 0),
        lidarVolume: commonPieces.reduce((sum, piece) => sum + piece.lidarVolume, 0),
      }
    }
  }

  return {
    raw: {
      key: candidate.key,
      avast: {
        coveredHa: avastCovered,
        volume: avastVolume,
        pieceCount: avastResult.pieces.length,
        nullDensityHa,
        byClass: avastSplit.totals,
        operatingArea: avastOperatingArea,
        layers: avastResult.layers,
      },
      lidar: lidarRaw,
      common: commonRaw,
      overlapHa: avastResult.overlapHa,
      warnings,
    },
    avastPieces: avastResult.pieces,
    avastSlopePieces: avastSplit.slopePieces,
    lidarPieces,
    lidarSlopePieces,
    commonPieces,
    slopeClasses: candidateClass,
  }
}
