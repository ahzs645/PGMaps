/**
 * Vegetation evidence for road finding: per-cell counts and heights from an **unthinned** point
 * cloud, aggregated before the cloud is thinned to its lowest point per cell for the ground model.
 * Thinning keeps one point per cell, which drops exactly the returns these layers count.
 *
 * Per 1 m cell (`VEGETATION_CELL_M`), on a lattice of whole metres in the cloud's projected CRS:
 * returns, ground returns and the spread of their elevations, the highest return above the ground,
 * returns 0.5–3 m above the ground (low vegetation), 0.5–5 m (brush) and below 5 m, and the range
 * of the (flight-line normalised) intensity. Heights are taken above a ground surface built from the
 * cloud's own ground returns (ASPRS class 2), so a cloud without ground classes is refused by name.
 *
 * These are the point-cloud inputs of the road conductivity in Roussel, Bourdon, Morley, Coops &
 * Achim (2022), "Correction, update, and enhancement of vectorial forestry road maps using ALS data,
 * a pathfinder, and seven metrics", IJAEOG 114, 103020 (doi:10.1016/j.jag.2022.103020), and of its
 * cross-section vegetation profile. Written from a functional specification of ALSroads 0.2.0 and
 * the paper; no code from ALSroads (GPL-3) was used.
 *
 * Pure: no DOM or network access. The worker (`pointCloud.worker.ts`) feeds it the decoded cloud.
 */
import type { GridFrame, XY } from './roadGrid'

/** Cell of every evidence layer, m. The conductivity terms are tuned at 1 m. */
export const VEGETATION_CELL_M = 1
/** Largest evidence grid, cells (the same budget as an imported terrain raster). */
export const MAX_VEGETATION_CELLS = 4_194_304
/** Low vegetation ("bottom layer") band above the ground, m. */
export const VEG_LOW_BAND_M: readonly [number, number] = [0.5, 3]
/** Brush band above the ground for the drivable share, m; returns below its top are the denominator. */
export const VEG_BRUSH_BAND_M: readonly [number, number] = [0.5, 5]
/** Below this density (all returns per m²) the vegetation figures are not reliable. */
export const VEG_ADVISED_DENSITY = 5
/** Cells a missing ground cell may be filled across when taking heights. */
export const VEG_GROUND_FILL_CELLS = 3
/** Below this share of above-ground returns a cloud reads as thinned to the ground. */
export const VEG_MIN_ABOVE_GROUND_SHARE = 0.01
/** Flight lines with their own intensity histogram; more read as unknown. */
export const VEG_MAX_FLIGHT_LINES = 256
const NOISE = new Set([7, 18])
const MAX_COUNT = 65_535

/** The full decoded cloud, before thinning. Intensity and point source are optional. */
export interface FullPointCloud {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  classification: Uint8Array
  intensity?: Uint16Array | null
  /** Point Source ID (flight line), when the reader could supply it. */
  pointSource?: Uint16Array | null
}

export interface VegetationEvidenceInfo {
  /** Non-noise returns aggregated. */
  points: number
  /** Over cells with returns. */
  pointsPerM2: number
  groundPerM2: number
  coveredCells: number
  intensity: 'none' | 'raw' | 'normalised-by-flight-line'
  /** Distinct flight lines seen, or null when no file stated them. */
  flightLines: number | null
  /** Below `VEG_ADVISED_DENSITY`: the figures are unreliable. */
  lowDensity: boolean
  /** Files aggregated. */
  sources: number
}

export interface VegetationEvidence {
  /** Centre of the top-left cell, projected metres (as `SurfaceGrid`). */
  origin: [number, number]
  cellM: number
  width: number
  height: number
  /** Non-noise returns per cell, every height. */
  returns: Uint16Array
  /** Ground returns (class 2). */
  ground: Uint16Array
  /** Standard deviation of the ground returns' elevations, m; NaN with fewer than two. */
  groundSdM: Float32Array
  /** Highest return above the ground, m; NaN where no return had a known ground under it. */
  canopyM: Float32Array
  /** Returns strictly between 0.5 and 3 m above the ground. */
  low: Uint16Array
  /** Returns strictly between 0.5 and 5 m above the ground. */
  brush: Uint16Array
  /** Returns below 5 m above the ground, ground returns included. */
  under5: Uint16Array
  /** max − min of the normalised intensity per cell; NaN without returns. Null without intensity. */
  intensityRange: Float32Array | null
  info: VegetationEvidenceInfo
}

export type VegetationEvidenceOutcome = { evidence: VegetationEvidence } | { refused: string }

/** Running sums for one evidence grid, fed one file at a time. */
export interface VegetationAccumulator {
  frame: GridFrame
  col0: number
  row0: number
  returns: Uint16Array
  ground: Uint16Array
  groundMean: Float64Array
  groundM2: Float64Array
  canopy: Float32Array
  low: Uint16Array
  brush: Uint16Array
  under5: Uint16Array
  intensityMin: Float32Array
  intensityMax: Float32Array
  points: number
  groundPoints: number
  aboveGround: number
  hasIntensity: boolean
  /** Files with intensity; intensity is used only when every file has it. */
  intensityFiles: number
  normalised: boolean
  flightLines: Set<number>
  flightLinesKnown: boolean
  sources: number
  refusal: string | null
}

/** The whole-metre lattice cell holding x (column) or y (row, counted from the top). */
const latticeCol = (x: number, cellM: number) => Math.floor(x / cellM)
const latticeRow = (y: number, cellM: number) => Math.floor(y / cellM)

/** An empty accumulator covering `bounds` ([minX, minY, maxX, maxY]), or why it cannot. */
export function vegetationAccumulator(
  bounds: readonly [number, number, number, number],
  cellM = VEGETATION_CELL_M,
): VegetationAccumulator | { refused: string } {
  const [minX, minY, maxX, maxY] = bounds
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX < minX || maxY < minY)
    return { refused: 'The point cloud has no extent to grid vegetation evidence over.' }
  const col0 = latticeCol(minX, cellM),
    col1 = latticeCol(maxX, cellM),
    rowTop = latticeRow(maxY, cellM),
    rowBottom = latticeRow(minY, cellM)
  const width = col1 - col0 + 1,
    height = rowTop - rowBottom + 1
  if (width * height > MAX_VEGETATION_CELLS)
    return {
      refused: `The cloud covers ${((width * height * cellM * cellM) / 1e6).toFixed(1)} km²; vegetation evidence is kept for at most ${(MAX_VEGETATION_CELLS / 1e6).toFixed(1)} km² at ${cellM} m. Crop the cloud to the road corridor.`,
    }
  const n = width * height
  return {
    frame: { origin: [(col0 + 0.5) * cellM, (rowTop + 0.5) * cellM], cellM, width, height },
    col0,
    row0: rowTop,
    returns: new Uint16Array(n),
    ground: new Uint16Array(n),
    groundMean: new Float64Array(n),
    groundM2: new Float64Array(n),
    canopy: new Float32Array(n).fill(-Infinity),
    low: new Uint16Array(n),
    brush: new Uint16Array(n),
    under5: new Uint16Array(n),
    intensityMin: new Float32Array(n).fill(Infinity),
    intensityMax: new Float32Array(n).fill(-Infinity),
    points: 0,
    groundPoints: 0,
    aboveGround: 0,
    hasIntensity: false,
    intensityFiles: 0,
    normalised: false,
    flightLines: new Set(),
    flightLinesKnown: true,
    sources: 0,
    refusal: null,
  }
}

const inc = (a: Uint16Array, i: number) => {
  if (a[i] < MAX_COUNT) a[i]++
}

/**
 * Intensities normalised between flight lines: each line's values are divided by its median over
 * the median of the line with the most points, then everything above twice the 98th percentile is
 * clipped there. A single line, or no point source, is left unscaled and only clipped. A line whose
 * factor is 0 is left unscaled.
 */
export function normaliseIntensity(
  intensity: Uint16Array,
  pointSource: Uint16Array | null | undefined,
  include: (i: number) => boolean = () => true,
): { values: Float32Array; flightLines: number | null; normalised: boolean } {
  const n = intensity.length
  const values = new Float32Array(n)
  const lines = new Map<number, Uint32Array>()
  const counts = new Map<number, number>()
  let known = !!pointSource && pointSource.length === n
  if (known)
    for (let i = 0; i < n; i++) {
      if (!include(i)) continue
      const s = pointSource![i]
      let h = lines.get(s)
      if (!h) {
        if (lines.size >= VEG_MAX_FLIGHT_LINES) {
          known = false
          break
        }
        h = new Uint32Array(65_536)
        lines.set(s, h)
        counts.set(s, 0)
      }
      h[intensity[i]]++
      counts.set(s, counts.get(s)! + 1)
    }
  const factors = new Map<number, number>()
  if (known && lines.size > 1) {
    const median = (h: Uint32Array, total: number) => {
      let seen = 0
      for (let v = 0; v < h.length; v++) {
        seen += h[v]
        if (seen * 2 >= total) return v
      }
      return 0
    }
    let reference = -1,
      most = -1
    for (const [s, c] of counts) if (c > most) [reference, most] = [s, c]
    const refMedian = median(lines.get(reference)!, most)
    for (const [s, h] of lines) {
      const f = refMedian > 0 ? median(h, counts.get(s)!) / refMedian : 0
      factors.set(s, f > 0 ? f : 1)
    }
  }
  const scale = factors.size > 0
  for (let i = 0; i < n; i++) values[i] = scale ? intensity[i] / factors.get(pointSource![i])! : intensity[i]
  // 98th percentile of the included values, then clip at twice it.
  const included: number[] = []
  const stride = Math.max(1, Math.floor(n / 200_000))
  for (let i = 0; i < n; i += stride) if (include(i)) included.push(values[i])
  if (included.length) {
    included.sort((a, b) => a - b)
    const cap = 2 * included[Math.min(included.length - 1, Math.floor(0.98 * (included.length - 1)))]
    if (cap > 0) for (let i = 0; i < n; i++) if (values[i] > cap) values[i] = cap
  }
  return { values, flightLines: known && lines.size ? lines.size : null, normalised: scale }
}

/**
 * Adds one decoded file to the accumulator. Heights are taken above this file's own ground
 * returns (cell means, gaps of up to `VEG_GROUND_FILL_CELLS` filled), so tiles stay independent.
 * Returns the refusal, if this file makes the evidence unusable; the accumulator then holds it.
 */
export function addVegetationCloud(acc: VegetationAccumulator, cloud: FullPointCloud): string | null {
  if (acc.refusal) return acc.refusal
  const { x, y, z, classification } = cloud
  const n = x.length
  const { cellM } = acc.frame
  let groundCount = 0,
    nearZero = 0
  for (let i = 0; i < n; i++)
    if (classification[i] === 2) {
      groundCount++
      if (Math.abs(z[i]) < 1) nearZero++
    }
  if (!groundCount)
    return (acc.refusal =
      'The cloud has no ground-classified returns (ASPRS class 2), so heights above the ground are unknown. Vegetation evidence needs the source ground classes; the ground filter here runs only on the thinned cloud.')
  if (groundCount >= 1000 && nearZero === groundCount)
    return (acc.refusal =
      'Every ground return is within 1 m of zero: the cloud looks height-normalised. Vegetation evidence needs absolute elevations.')
  // Ground surface for heights, on the accumulator's lattice over this file's ground extent.
  let minC = Infinity,
    maxC = -Infinity,
    minR = Infinity,
    maxR = -Infinity
  for (let i = 0; i < n; i++) {
    if (classification[i] !== 2) continue
    const c = latticeCol(x[i], cellM),
      r = latticeRow(y[i], cellM)
    if (c < minC) minC = c
    if (c > maxC) maxC = c
    if (r < minR) minR = r
    if (r > maxR) maxR = r
  }
  const gw = maxC - minC + 1,
    gh = maxR - minR + 1
  const gsum = new Float64Array(gw * gh),
    gn = new Uint32Array(gw * gh)
  for (let i = 0; i < n; i++) {
    if (classification[i] !== 2) continue
    const k = (maxR - latticeRow(y[i], cellM)) * gw + (latticeCol(x[i], cellM) - minC)
    gsum[k] += z[i]
    gn[k]++
  }
  let surface = new Float64Array(gw * gh)
  for (let k = 0; k < surface.length; k++) surface[k] = gn[k] ? gsum[k] / gn[k] : NaN
  for (let pass = 0; pass < VEG_GROUND_FILL_CELLS; pass++) {
    const next = new Float64Array(surface)
    let filled = 0
    for (let r = 0; r < gh; r++)
      for (let c = 0; c < gw; c++) {
        const k = r * gw + c
        if (!Number.isNaN(surface[k])) continue
        let s = 0,
          m = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr,
              cc = c + dc
            if (rr < 0 || cc < 0 || rr >= gh || cc >= gw) continue
            const v = surface[rr * gw + cc]
            if (!Number.isNaN(v)) {
              s += v
              m++
            }
          }
        if (m) {
          next[k] = s / m
          filled++
        }
      }
    surface = next
    if (!filled) break
  }
  // Bilinear between cell centres, as `sampleBilinear`; NaN off the surface or beside a hole.
  const groundAt = (px: number, py: number) => {
    const fx = px / cellM - 0.5 - minC,
      fy = maxR + 0.5 - py / cellM
    if (!(fx >= -0.5 && fy >= -0.5 && fx <= gw - 0.5 && fy <= gh - 0.5)) return NaN
    const c0 = Math.max(0, Math.min(gw - 1, Math.floor(fx))),
      r0 = Math.max(0, Math.min(gh - 1, Math.floor(fy)))
    const c1 = Math.min(gw - 1, c0 + 1),
      r1 = Math.min(gh - 1, r0 + 1)
    const tx = Math.max(0, Math.min(1, fx - c0)),
      ty = Math.max(0, Math.min(1, fy - r0))
    const top = surface[r0 * gw + c0] * (1 - tx) + surface[r0 * gw + c1] * tx,
      bottom = surface[r1 * gw + c0] * (1 - tx) + surface[r1 * gw + c1] * tx
    return top * (1 - ty) + bottom * ty
  }
  const include = (i: number) => !NOISE.has(classification[i])
  const intensity =
    cloud.intensity && cloud.intensity.length === n
      ? normaliseIntensity(cloud.intensity, cloud.pointSource, include)
      : null
  if (intensity) {
    acc.intensityFiles++
    acc.normalised ||= intensity.normalised
    if (intensity.flightLines === null) acc.flightLinesKnown = false
  } else acc.flightLinesKnown = false
  if (intensity && cloud.pointSource)
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 100_000))) acc.flightLines.add(cloud.pointSource[i])
  const { width, height } = acc.frame
  for (let i = 0; i < n; i++) {
    if (!include(i)) continue
    const c = latticeCol(x[i], cellM) - acc.col0,
      r = acc.row0 - latticeRow(y[i], cellM)
    if (c < 0 || r < 0 || c >= width || r >= height) continue
    const k = r * width + c
    acc.points++
    inc(acc.returns, k)
    if (classification[i] === 2) {
      acc.groundPoints++
      inc(acc.ground, k)
      // Welford's running mean and sum of squares, per cell.
      const m = acc.ground[k],
        d = z[i] - acc.groundMean[k]
      acc.groundMean[k] += d / m
      acc.groundM2[k] += d * (z[i] - acc.groundMean[k])
    } else acc.aboveGround++
    if (intensity) {
      const v = intensity.values[i]
      if (v < acc.intensityMin[k]) acc.intensityMin[k] = v
      if (v > acc.intensityMax[k]) acc.intensityMax[k] = v
    }
    const h = z[i] - groundAt(x[i], y[i])
    if (Number.isNaN(h)) continue
    if (h > acc.canopy[k]) acc.canopy[k] = h
    if (h > VEG_LOW_BAND_M[0] && h < VEG_LOW_BAND_M[1]) inc(acc.low, k)
    if (h > VEG_BRUSH_BAND_M[0] && h < VEG_BRUSH_BAND_M[1]) inc(acc.brush, k)
    if (h < VEG_BRUSH_BAND_M[1]) inc(acc.under5, k)
  }
  acc.sources++
  acc.hasIntensity = acc.intensityFiles === acc.sources
  return null
}

/** The evidence grid the accumulator adds up to, or why there is none. */
export function finishVegetationEvidence(acc: VegetationAccumulator): VegetationEvidenceOutcome {
  if (acc.refusal) return { refused: acc.refusal }
  if (!acc.sources || !acc.points) return { refused: 'No returns fell inside the evidence grid.' }
  if (acc.aboveGround < VEG_MIN_ABOVE_GROUND_SHARE * acc.points)
    return {
      refused: `Only ${acc.aboveGround.toLocaleString('en-CA')} of ${acc.points.toLocaleString('en-CA')} returns are above the ground: the cloud looks thinned to its ground points, which carries no vegetation evidence.`,
    }
  const { frame } = acc
  const n = frame.width * frame.height
  const groundSdM = new Float32Array(n),
    canopyM = acc.canopy
  let covered = 0
  for (let k = 0; k < n; k++) {
    if (acc.returns[k]) covered++
    groundSdM[k] = acc.ground[k] >= 2 ? Math.sqrt(acc.groundM2[k] / acc.ground[k]) : NaN
    if (canopyM[k] === -Infinity) canopyM[k] = NaN
  }
  let intensityRange: Float32Array | null = null
  if (acc.hasIntensity) {
    intensityRange = acc.intensityMax
    for (let k = 0; k < n; k++)
      intensityRange[k] =
        acc.returns[k] && acc.intensityMin[k] !== Infinity ? intensityRange[k] - acc.intensityMin[k] : NaN
  }
  const area = covered * frame.cellM * frame.cellM
  const pointsPerM2 = area ? acc.points / area : 0
  return {
    evidence: {
      origin: [frame.origin[0], frame.origin[1]],
      cellM: frame.cellM,
      width: frame.width,
      height: frame.height,
      returns: acc.returns,
      ground: acc.ground,
      groundSdM,
      canopyM,
      low: acc.low,
      brush: acc.brush,
      under5: acc.under5,
      intensityRange,
      info: {
        points: acc.points,
        pointsPerM2,
        groundPerM2: area ? acc.groundPoints / area : 0,
        coveredCells: covered,
        intensity: !acc.hasIntensity ? 'none' : acc.normalised ? 'normalised-by-flight-line' : 'raw',
        flightLines: acc.hasIntensity && acc.flightLinesKnown ? acc.flightLines.size : null,
        lowDensity: pointsPerM2 < VEG_ADVISED_DENSITY,
        sources: acc.sources,
      },
    },
  }
}

/** One cloud, start to finish. */
export function vegetationEvidence(cloud: FullPointCloud, cellM = VEGETATION_CELL_M): VegetationEvidenceOutcome {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < cloud.x.length; i++) {
    if (NOISE.has(cloud.classification[i])) continue
    minX = Math.min(minX, cloud.x[i])
    maxX = Math.max(maxX, cloud.x[i])
    minY = Math.min(minY, cloud.y[i])
    maxY = Math.max(maxY, cloud.y[i])
  }
  const acc = vegetationAccumulator([minX, minY, maxX, maxY], cellM)
  if ('refused' in acc) return acc
  addVegetationCloud(acc, cloud)
  return finishVegetationEvidence(acc)
}

/** The typed arrays of an evidence grid, to transfer from a worker without copying. */
export function vegetationBuffers(evidence: VegetationEvidence): ArrayBuffer[] {
  const arrays = [
    evidence.returns,
    evidence.ground,
    evidence.groundSdM,
    evidence.canopyM,
    evidence.low,
    evidence.brush,
    evidence.under5,
    ...(evidence.intensityRange ? [evidence.intensityRange] : []),
  ]
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))]
}

/** The evidence cell index holding a projected point, or -1 outside the grid. */
export function evidenceCellAt(evidence: Pick<VegetationEvidence, 'origin' | 'cellM' | 'width' | 'height'>, p: XY) {
  const c = Math.round((p[0] - evidence.origin[0]) / evidence.cellM),
    r = Math.round((evidence.origin[1] - p[1]) / evidence.cellM)
  if (c < 0 || r < 0 || c >= evidence.width || r >= evidence.height) return -1
  return r * evidence.width + c
}

/** The point-cloud layers on a search frame, nearest evidence cell to each frame cell. */
export interface EvidenceOnFrame {
  /** 1 where the evidence cell has at least one return. */
  known: Uint8Array
  /** Ground returns per m². */
  groundDensity: Float64Array
  canopyM: Float64Array
  low: Float64Array
  /** Null when the cloud had no intensity. */
  intensityRange: Float64Array | null
}

/**
 * Samples the evidence onto `frame`. A frame cell with no return beside cells with returns (a
 * random dropout at a few points per m²) takes the largest canopy, low-vegetation and intensity
 * range of its known 3×3 neighbours: no returns is never read as an open bed.
 */
export function evidenceOnFrame(evidence: VegetationEvidence, frame: GridFrame): EvidenceOnFrame {
  const { width, height, cellM } = frame
  const n = width * height
  const known = new Uint8Array(n)
  const groundDensity = new Float64Array(n),
    canopyM = new Float64Array(n).fill(NaN),
    low = new Float64Array(n).fill(NaN),
    intensityRange = evidence.intensityRange ? new Float64Array(n).fill(NaN) : null
  const area = evidence.cellM * evidence.cellM
  for (let r = 0; r < height; r++) {
    const y = frame.origin[1] - r * cellM
    for (let c = 0; c < width; c++) {
      const k = evidenceCellAt(evidence, [frame.origin[0] + c * cellM, y])
      const i = r * width + c
      if (k < 0 || !evidence.returns[k]) continue
      known[i] = 1
      groundDensity[i] = evidence.ground[k] / area
      canopyM[i] = evidence.canopyM[k]
      low[i] = evidence.low[k]
      if (intensityRange) intensityRange[i] = evidence.intensityRange![k]
    }
  }
  const fill = (layer: Float64Array) => {
    const out = new Float64Array(layer)
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const i = r * width + c
        if (!Number.isNaN(layer[i])) continue
        let best = NaN
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr,
              cc = c + dc
            if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue
            const v = layer[rr * width + cc]
            if (!Number.isNaN(v) && !(v <= best)) best = v
          }
        out[i] = best
      }
    return out
  }
  return {
    known,
    groundDensity,
    canopyM: fill(canopyM),
    low: fill(low),
    intensityRange: intensityRange ? fill(intensityRange) : null,
  }
}

/** Share of `samples` that fall in evidence cells with returns. */
export function evidenceCoverage(evidence: VegetationEvidence, samples: readonly XY[]): number {
  if (!samples.length) return 0
  let hit = 0
  for (const p of samples) {
    const k = evidenceCellAt(evidence, p)
    if (k >= 0 && evidence.returns[k]) hit++
  }
  return hit / samples.length
}

/** One line for an import summary or a result card. */
export function describeVegetationEvidence(info: VegetationEvidenceInfo, cellM = VEGETATION_CELL_M): string {
  const intensity =
    info.intensity === 'none'
      ? 'no intensity'
      : info.intensity === 'raw'
        ? 'intensity (one flight line or none stated, not normalised)'
        : `intensity normalised over ${info.flightLines ?? '?'} flight lines`
  return (
    `${cellM} m, ${info.pointsPerM2.toFixed(1)} returns per m² (${info.groundPerM2.toFixed(1)} ground), ${intensity}` +
    (info.lowDensity ? `; below ${VEG_ADVISED_DENSITY} per m², so the vegetation figures are unreliable` : '')
  )
}
