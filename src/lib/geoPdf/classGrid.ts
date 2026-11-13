/** Published map classes, never continuous elevations. DOM/network free. */
import { zlibSync, unzlibSync } from 'fflate'
import proj4 from 'proj4'
import type { Converter } from 'proj4'
import polygonClipping from 'polygon-clipping'
import { PDF_LIMITS, type Matrix, type PdfClassGrid, type PdfRasterClass, type XY } from './types'

export const UNKNOWN = {
  absent: 0,
  color: 240,
  ambiguous: 241,
  alpha: 242,
  lossyNeutral: 243,
  conflict: 244,
  clipped: 245,
  overlay: 246,
  outside: 247,
} as const
export const UNKNOWN_LABELS: Record<number, string> = {
  0: 'No mapped class / transparent',
  240: 'Colour outside the legend tolerance',
  241: 'Ambiguous colour',
  242: 'Unexpected transparency',
  243: 'Dark neutral colour in a lossy tile',
  244: 'Conflicting image overlap',
  245: 'Outside the registered map frame',
  246: 'Slope overlay inconsistent with base class',
  247: 'Outside raster coverage',
}
/** Pixels the sheet painted whose colour did not give an exact class (JPEG damage, off-legend). */
export const DRAWN_UNCLASSIFIED: readonly number[] = [UNKNOWN.color, UNKNOWN.ambiguous, UNKNOWN.lossyNeutral]
export const knownClass = (code: number, grid: Pick<PdfClassGrid, 'legend'>) => code > 0 && code <= grid.legend.length
/** A JPEG match remains an estimate even when its colour is close to a legend swatch. */
export const estimatedClass = (code: number, grid: Pick<PdfClassGrid, 'legend'>) =>
  code > 64 && code <= 64 + grid.legend.length
export const applyMatrix = (m: Matrix, [x, y]: XY): XY => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw Error('The raster placement is singular.')
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ]
}
export function cellChecksum(data: Uint8Array): string {
  let hash = 2166136261
  for (const value of data) hash = Math.imul(hash ^ value, 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
export function encodeCells(data: Uint8Array): string {
  const bytes = zlibSync(data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
const decoded = new WeakMap<PdfClassGrid, Uint8Array>()
export function decodeCells(grid: PdfClassGrid): Uint8Array {
  const old = decoded.get(grid)
  if (old) return old
  const binary = atob(grid.cells)
  const out = new Uint8Array(grid.width * grid.height)
  const data = unzlibSync(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    { out },
  )
  if (
    data.length !== out.length ||
    cellChecksum(data) !== grid.checksum ||
    data.some((code) => !knownClass(code, grid) && !estimatedClass(code, grid) && !(code in UNKNOWN_LABELS))
  )
    throw Error('The saved class raster is corrupt.')
  decoded.set(grid, data)
  return data
}

/** Nearest palette colour with a rejection radius and a runner-up margin. No filling or smoothing. */
export function colorClassifier(
  legend: PdfRasterClass[],
  lossy: boolean,
  expectedAlpha: number,
  excluded = -1,
  lossyDistance: number = PDF_LIMITS.lossyColorDistance,
) {
  const cache = new Map<number, number>()
  const maxDistance = lossy ? lossyDistance : PDF_LIMITS.losslessColorDistance
  return (r: number, g: number, b: number, alpha: number): number => {
    if (alpha === 0) return UNKNOWN.absent
    if (Math.abs(alpha - expectedAlpha) > 1) return UNKNOWN.alpha
    const key = (r << 16) | (g << 8) | b
    const old = cache.get(key)
    if (old !== undefined) return old
    let best = Infinity,
      second = Infinity,
      code = UNKNOWN.color as number
    for (let i = 0; i < legend.length; i++) {
      if (i === excluded) continue
      let distance = Infinity
      for (const [lr, lg, lb] of [legend[i].color, ...(legend[i].aliases ?? [])])
        distance = Math.min(distance, (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2)
      if (distance < best) {
        second = best
        best = distance
        code = i + 1
      } else second = Math.min(second, distance)
    }
    if (best > maxDistance ** 2) code = UNKNOWN.color
    else if (Math.sqrt(second) - Math.sqrt(best) < PDF_LIMITS.colorSeparation) code = UNKNOWN.ambiguous
    else if (lossy && legend[code - 1].color.every((c) => c < 3)) code = UNKNOWN.lossyNeutral
    if (cache.size < 131072) cache.set(key, code)
    return code
  }
}

const projections = new WeakMap<PdfClassGrid, Converter>()
export function gridProjection(grid: PdfClassGrid) {
  let p = projections.get(grid)
  if (!p) {
    p = proj4('EPSG:4326', grid.wkt)
    projections.set(grid, p)
  }
  return p
}
export function gridCorners(grid: PdfClassGrid): [XY, XY, XY, XY] {
  const p = gridProjection(grid)
  return (
    [
      [0, 0],
      [grid.width, 0],
      [grid.width, grid.height],
      [0, grid.height],
    ] as XY[]
  ).map((xy) => p.inverse(applyMatrix(grid.transform, xy)) as XY) as [XY, XY, XY, XY]
}
export function sampleClass(grid: PdfClassGrid, coordinate: XY) {
  const xy = applyMatrix(invertMatrix(grid.transform), gridProjection(grid).forward(coordinate) as XY)
  const col = Math.floor(xy[0]),
    row = Math.floor(xy[1])
  const code =
    col < 0 || row < 0 || col >= grid.width || row >= grid.height
      ? UNKNOWN.outside
      : decodeCells(grid)[row * grid.width + col]
  const estimated = estimatedClass(code, grid)
  return {
    code,
    col,
    row,
    estimated,
    range: knownClass(code, grid) || estimated ? grid.legend[(estimated ? code - 64 : code) - 1] : null,
    reason: estimated
      ? 'JPEG estimate; one pixel is uncertain, area shares are the reliable reading'
      : codeLabel(code, grid),
  }
}

/** Lowest printed bound of the legend, e.g. 5 (m) or 20 (%). */
const lowestPrinted = (grid: Pick<PdfClassGrid, 'legend'>) => Math.min(...grid.legend.map((c) => c.minimum))
/** Plain words for a non-class code, using what the transparency mask states exactly. */
export function codeLabel(code: number, grid: Pick<PdfClassGrid, 'legend' | 'undrawn' | 'unit'>): string {
  if (code === UNKNOWN.absent && grid.undrawn)
    return `${grid.undrawn.label} ${grid.unit}: not drawn on the sheet (below the lowest printed class, or no data)`
  if (DRAWN_UNCLASSIFIED.includes(code) && grid.undrawn)
    return `Drawn, so ${lowestPrinted(grid)} ${grid.unit} or more; class not exact (${UNKNOWN_LABELS[code].toLowerCase()})`
  return UNKNOWN_LABELS[code] ?? 'Unknown'
}

export interface ClassAreaBreakdown {
  areaM2: number
  /** Lossless palette matches, per legend class. */
  exactClassM2: number[]
  /** JPEG estimates, per legend class. Never part of exact totals. */
  estimatedClassM2: number[]
  /** Transparent inside the raster: the unpainted class below the lowest printed range. Exact. */
  undrawnM2: number
  /** Painted, so at or above the lowest printed range, without an exact class. Includes the JPEG estimates. */
  drawnNotExactM2: number
  /** Not even the drawn/not drawn split is known: outside the raster or frame, conflicts, odd alpha. */
  otherUnknownM2: number
}
/**
 * Regroups a summary by what is known exactly. The drawn/not drawn split comes from the lossless
 * soft mask, so `undrawnM2` and the drawn total are exact in every tile; only the class within the
 * drawn part can be uncertain. Grids saved before the unpainted class was recorded keep code 0 unknown.
 */
export function classAreaBreakdown(
  summary: ClassAreaSummary,
  grid: Pick<PdfClassGrid, 'legend' | 'undrawn'>,
): ClassAreaBreakdown {
  const unknown = summary.unknownAreasM2
  const estimatedTotal = summary.estimatedClassAreasM2.reduce((s, n) => s + n, 0)
  const undrawnM2 = grid.undrawn ? (unknown[UNKNOWN.absent] ?? 0) : 0
  const drawnUnclassified = grid.undrawn ? DRAWN_UNCLASSIFIED.reduce((s, code) => s + (unknown[code] ?? 0), 0) : 0
  const exact = summary.classAreasM2.reduce((s, n) => s + n, 0)
  return {
    areaM2: summary.areaM2,
    exactClassM2: summary.classAreasM2,
    estimatedClassM2: summary.estimatedClassAreasM2,
    undrawnM2,
    drawnNotExactM2: estimatedTotal + drawnUnclassified,
    otherUnknownM2: Math.max(0, summary.areaM2 - exact - estimatedTotal - undrawnM2 - drawnUnclassified),
  }
}

const checked = new WeakSet<object>()
export function parseClassGrid(raw: unknown): PdfClassGrid | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') throw Error('Invalid class raster.')
  if (checked.has(raw)) return raw as PdfClassGrid
  const r = raw as PdfClassGrid
  if (
    r.version !== 1 ||
    !['slope', 'canopy'].includes(r.kind) ||
    r.unit !== (r.kind === 'slope' ? '%' : 'm') ||
    !Number.isInteger(r.width) ||
    !Number.isInteger(r.height) ||
    r.width < 1 ||
    r.height < 1 ||
    r.width * r.height > PDF_LIMITS.rasterCells
  )
    throw Error('Invalid class raster dimensions or units.')
  if (
    !Array.isArray(r.transform) ||
    r.transform.length !== 6 ||
    !r.transform.every(Number.isFinite) ||
    typeof r.wkt !== 'string' ||
    r.wkt.length > 5000 ||
    !/^PROJCS\[/i.test(r.wkt) ||
    !/UNIT\["(?:Meter|Metre)",\s*1(?:\.0)?\]\s*\]\s*$/i.test(r.wkt)
  )
    throw Error('Invalid class raster registration.')
  invertMatrix(r.transform)
  if (gridCorners(r).some((p) => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85))
    throw Error('The class raster lies outside the supported map extent.')
  if (
    !Array.isArray(r.legend) ||
    !r.legend.length ||
    r.legend.length > 32 ||
    r.legend.some(
      (c) =>
        typeof c.label !== 'string' ||
        c.label.length > 100 ||
        !Number.isFinite(c.minimum) ||
        c.minimum < 0 ||
        !(c.maximum === null || (Number.isFinite(c.maximum) && c.maximum > c.minimum)) ||
        !Array.isArray(c.color) ||
        c.color.length !== 3 ||
        c.color.some((v) => !Number.isInteger(v) || v < 0 || v > 255) ||
        (c.aliases !== undefined &&
          (!Array.isArray(c.aliases) ||
            c.aliases.length > 8 ||
            c.aliases.some(
              (a) => !Array.isArray(a) || a.length !== 3 || a.some((v) => !Number.isInteger(v) || v < 0 || v > 255),
            ))),
    )
  )
    throw Error('Invalid class raster legend.')
  if (
    r.undrawn !== undefined &&
    (!r.undrawn ||
      typeof r.undrawn.label !== 'string' ||
      r.undrawn.label.length > 100 ||
      !Number.isFinite(r.undrawn.maximum) ||
      r.undrawn.maximum !== Math.min(...r.legend.map((c) => c.minimum)))
  )
    throw Error('Invalid class raster legend.')
  if (
    typeof r.cells !== 'string' ||
    r.cells.length > (PDF_LIMITS.rasterCompressedBytes * 4) / 3 + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(r.cells) ||
    !/^[a-f0-9]{8}$/.test(r.checksum) ||
    !Array.isArray(r.counts) ||
    r.counts.length !== 256 ||
    r.counts.some((n) => !Number.isInteger(n) || n < 0) ||
    r.counts.reduce((s, n) => s + n, 0) !== r.width * r.height
  )
    throw Error('Invalid class raster cells.')
  if (
    !Array.isArray(r.sourceImages) ||
    r.sourceImages.length > PDF_LIMITS.rasterImages ||
    r.sourceImages.some(
      (i) =>
        typeof i.reference !== 'string' ||
        i.reference.length > 100 ||
        typeof i.layer !== 'string' ||
        i.layer.length > 200 ||
        !Number.isInteger(i.width) ||
        !Number.isInteger(i.height) ||
        i.width < 1 ||
        i.height < 1 ||
        typeof i.lossy !== 'boolean',
    ) ||
    !Array.isArray(r.notes) ||
    r.notes.length > 20 ||
    r.notes.some((n) => typeof n !== 'string' || n.length > 2000)
  )
    throw Error('Invalid class raster source information.')
  const values = decodeCells(r),
    counts = Array(256).fill(0) as number[]
  for (const code of values) counts[code]++
  if (counts.some((n, i) => n !== r.counts[i])) throw Error('Class raster counts do not match its cells.')
  checked.add(r)
  return r
}

type Multi = polygonClipping.MultiPolygon
const rectangle = (x0: number, y0: number, x1: number, y1: number): polygonClipping.Polygon => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
]
function signedArea(ring: number[][]) {
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  return Math.abs(sum) / 2
}
function polygonArea(polys: Multi): number {
  return polys.reduce((s, p) => s + signedArea(p[0]) - p.slice(1).reduce((a, r) => a + signedArea(r), 0), 0)
}
export interface ClassAreaSummary {
  areaM2: number
  classAreasM2: number[]
  estimatedClassAreasM2: number[]
  unknownAreasM2: Record<number, number>
  pixelAreaM2: number
  method: 'fractional-native-pixels'
}

/** Exact fractional boundary pixels in the source projection; interior rows are counted directly. */
export function* summarizeClassSteps(
  grid: PdfClassGrid,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): Generator<number, ClassAreaSummary> {
  const inverse = invertMatrix(grid.transform),
    projection = gridProjection(grid)
  const raw = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const polygons = raw.map((p) =>
    p.map((r) => r.map((xy) => applyMatrix(inverse, projection.forward(xy as XY) as XY))),
  ) as Multi
  const inside = polygonClipping.intersection(polygons, rectangle(0, 0, grid.width, grid.height))
  const pixelAreaM2 = Math.abs(grid.transform[0] * grid.transform[3] - grid.transform[1] * grid.transform[2])
  const totalArea = polygonArea(polygons),
    insideArea = polygonArea(inside)
  if (!(totalArea > 1e-12)) throw Error('Select a polygon with positive area.')
  const areas = Array(256).fill(0) as number[]
  areas[UNKNOWN.outside] = Math.max(0, totalArea - insideArea)
  const data = decodeCells(grid)
  const rings = inside.flatMap((p) => p)
  let minY = grid.height,
    maxY = 0
  for (const ring of rings)
    for (const p of ring) {
      minY = Math.min(minY, p[1])
      maxY = Math.max(maxY, p[1])
    }
  let work = 0
  for (let row = Math.max(0, Math.floor(minY)); row < Math.min(grid.height, Math.ceil(maxY)); row++) {
    const y = row + 0.5,
      crossings: number[] = [],
      boundary = new Set<number>()
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i]
        if (a[1] > y !== b[1] > y) crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
        if (Math.max(a[1], b[1]) < row || Math.min(a[1], b[1]) > row + 1) continue
        const edgeX = (v: number) => a[0] + ((v - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
        const xs =
          a[1] === b[1]
            ? [a[0], b[0]]
            : [edgeX(Math.max(row, Math.min(a[1], b[1]))), edgeX(Math.min(row + 1, Math.max(a[1], b[1])))]
        for (
          let col = Math.max(0, Math.floor(Math.min(...xs)));
          col <= Math.min(grid.width - 1, Math.floor(Math.max(...xs)));
          col++
        )
          boundary.add(col)
      }
    crossings.sort((a, b) => a - b)
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (
        let col = Math.max(0, Math.ceil(crossings[i] - 0.5));
        col < Math.min(grid.width, Math.ceil(crossings[i + 1] - 0.5));
        col++
      ) {
        if (!boundary.has(col)) areas[data[row * grid.width + col]]++
        if (++work % 8192 === 0) yield row
      }
    }
    if (boundary.size) {
      const strip = polygonClipping.intersection(inside, rectangle(0, row, grid.width, row + 1))
      for (const col of boundary) {
        const area = polygonArea(polygonClipping.intersection(strip, rectangle(col, row, col + 1, row + 1)))
        if (area > 1e-12) areas[data[row * grid.width + col]] += area
        if (++work % 256 === 0) yield row
      }
    }
    yield row
  }
  const measured = areas.reduce((s, a) => s + a, 0)
  if (Math.abs(measured - totalArea) > Math.max(1e-5, totalArea * 1e-7))
    throw Error('Class areas do not reconcile with the selected polygon.')
  return {
    areaM2: totalArea * pixelAreaM2,
    classAreasM2: grid.legend.map((_, i) => areas[i + 1] * pixelAreaM2),
    estimatedClassAreasM2: grid.legend.map((_, i) => areas[i + 65] * pixelAreaM2),
    unknownAreasM2: Object.fromEntries(
      areas.flatMap((area, code) => (area > 0 && !knownClass(code, grid) ? [[code, area * pixelAreaM2]] : [])),
    ),
    pixelAreaM2,
    method: 'fractional-native-pixels',
  }
}
