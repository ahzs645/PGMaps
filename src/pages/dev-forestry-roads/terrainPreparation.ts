/** Bounded terrain preparation in source grid metres. Null cells stay unknown. */
import type { LocalRaster } from '../dev-forestry/types'

export const MAX_PREPARED_CELLS = 4_194_304
export const MAX_TERRAIN_SOURCES = 12
export interface TerrainBackgroundLayer {
  id: string
  name: string
  kind: 'canopy' | 'ortho'
  epsg: number
  origin: [number, number]
  pixelSize: [number, number]
  width: number
  height: number
  /** RGBA pixels only for display; never sampled by analysis. */
  rgba: number[]
  sha256: string
  visible: boolean
  opacity: number
}
export function parseTerrainBackgrounds(raw: unknown): TerrainBackgroundLayer[] {
  if (!Array.isArray(raw) || raw.length > 6) throw Error('At most six independent terrain backgrounds are supported.')
  let pixels = 0
  const ids = new Set<string>()
  for (const l of raw as TerrainBackgroundLayer[]) {
    if (
      !l ||
      typeof l.id !== 'string' ||
      l.id.length > 100 ||
      ids.has(l.id) ||
      typeof l.name !== 'string' ||
      l.name.length > 200 ||
      !['canopy', 'ortho'].includes(l.kind) ||
      !Number.isInteger(l.epsg) ||
      !Array.isArray(l.origin) ||
      l.origin.length !== 2 ||
      !l.origin.every(Number.isFinite) ||
      !Array.isArray(l.pixelSize) ||
      l.pixelSize.length !== 2 ||
      !l.pixelSize.every(Number.isFinite) ||
      l.pixelSize[0] <= 0 ||
      l.pixelSize[1] >= 0 ||
      !Number.isInteger(l.width) ||
      !Number.isInteger(l.height) ||
      l.width < 2 ||
      l.height < 2 ||
      !Array.isArray(l.rgba) ||
      l.rgba.length !== l.width * l.height * 4 ||
      !l.rgba.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ||
      !/^[a-f0-9]{64}$/.test(l.sha256) ||
      typeof l.visible !== 'boolean' ||
      !Number.isFinite(l.opacity) ||
      l.opacity < 0 ||
      l.opacity > 1
    )
      throw Error('Invalid independent terrain background.')
    pixels += l.width * l.height
    ids.add(l.id)
  }
  if (pixels > 1_048_576) throw Error('Background stack exceeds 1,048,576 pixels; crop or resample imagery explicitly.')
  return structuredClone(raw) as TerrainBackgroundLayer[]
}
export interface PointPreservation {
  /** Source projected x/y, not longitude/latitude. */
  corridor?: { points: Array<[number, number]>; halfWidthM: number }
  polygons?: Array<Array<[number, number]>>
}
export interface TerrainPreparationRecord {
  operation: 'point-cloud' | 'mosaic' | 'graded-pad' | 'design-surface'
  sources: Array<{ name: string; sha256: string; epsg: number; verticalReference: string }>
  method: string
  parameters: Record<string, string | number | boolean>
  /** Optional retained constrained source TIN, source grid metres. */
  tin?: { coordinates: number[]; elevations: number[]; triangles: number[] }
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function parseTerrainPreparation(raw: unknown): TerrainPreparationRecord {
  if (!raw || typeof raw !== 'object') throw Error('Terrain preparation must be an object.')
  const r = raw as TerrainPreparationRecord
  if (
    !['point-cloud', 'mosaic', 'graded-pad', 'design-surface'].includes(r.operation) ||
    typeof r.method !== 'string' ||
    r.method.length > 500 ||
    !Array.isArray(r.sources) ||
    !r.sources.length ||
    r.sources.length > MAX_TERRAIN_SOURCES ||
    !r.parameters ||
    typeof r.parameters !== 'object' ||
    Object.keys(r.parameters).length > 30
  )
    throw Error('Invalid terrain preparation record.')
  for (const s of r.sources)
    if (
      !s ||
      typeof s.name !== 'string' ||
      s.name.length > 200 ||
      !/^[a-f0-9]{64}$/.test(s.sha256) ||
      !Number.isInteger(s.epsg) ||
      typeof s.verticalReference !== 'string' ||
      !s.verticalReference ||
      s.verticalReference.length > 300
    )
      throw Error('Invalid terrain preparation source.')
  for (const [key, value] of Object.entries(r.parameters))
    if (
      key.length > 100 ||
      (typeof value !== 'boolean' && !(typeof value === 'string' && value.length <= 1000) && !finite(value))
    )
      throw Error('Invalid terrain preparation parameter.')
  if (r.tin) {
    const t = r.tin,
      n = t.elevations?.length
    if (
      !Array.isArray(t.coordinates) ||
      !Array.isArray(t.elevations) ||
      !Array.isArray(t.triangles) ||
      !n ||
      n > 250_000 ||
      t.coordinates.length !== n * 2 ||
      t.triangles.length > 1_500_000 ||
      t.triangles.length % 3 ||
      !t.coordinates.every(finite) ||
      !t.elevations.every(finite) ||
      !t.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < n)
    )
      throw Error('Invalid retained terrain TIN (limit 250,000 vertices).')
  }
  return structuredClone(r)
}

function inRing(x: number, y: number, ring: Array<[number, number]>) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j]
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) inside = !inside
  }
  return inside
}
function segmentDistanceSquared(x: number, y: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    size = dx * dx + dy * dy
  const t = size ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / size)) : 0
  return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2
}
export function preservedPointMask(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  preserve: PointPreservation,
): Uint8Array {
  const corridor = preserve.corridor,
    rings = preserve.polygons ?? []
  const vertices = (corridor?.points.length ?? 0) + rings.reduce((s, r) => s + r.length, 0)
  if (
    x.length !== y.length ||
    vertices > 2_000 ||
    rings.length > 100 ||
    (corridor &&
      (!finite(corridor.halfWidthM) ||
        corridor.halfWidthM < 0 ||
        corridor.halfWidthM > 1000 ||
        corridor.points.length < 2)) ||
    [...(corridor?.points ?? []), ...rings.flat()].some((p) => p.length !== 2 || !p.every(finite))
  )
    throw Error('Invalid preservation regions: at most 2,000 vertices and a 0–1,000 m corridor.')
  if (vertices * x.length > 100_000_000)
    throw Error('Preservation region budget exceeded; simplify the corridor or crop the cloud.')
  const mask = new Uint8Array(x.length)
  for (let i = 0; i < x.length; i++) {
    if (rings.some((r) => inRing(x[i], y[i], r))) mask[i] = 1
    if (!mask[i] && corridor)
      for (let j = 1; j < corridor.points.length; j++)
        if (
          segmentDistanceSquared(x[i], y[i], corridor.points[j - 1], corridor.points[j]) <=
          corridor.halfWidthM ** 2
        ) {
          mask[i] = 1
          break
        }
  }
  return mask
}

/** Keep every protected point; thin outside it. A protected region larger than the budget fails explicitly. */
export function strategicPointIndices(
  points: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>; classification?: ArrayLike<number> },
  maxPoints: number,
  preserve: PointPreservation,
): { indices: number[]; cellM: number | null; preserved: number } {
  const { x, y, z, classification } = points,
    n = x.length
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || y.length !== n || z.length !== n)
    throw Error('Invalid point budget.')
  const mask = preservedPointMask(x, y, preserve),
    preserved = mask.reduce((a, b) => a + b, 0)
  if (preserved > maxPoints)
    throw Error(
      `${preserved.toLocaleString()} protected points exceed the ${maxPoints.toLocaleString()} point budget; crop the source or narrow the preservation region.`,
    )
  if (n <= maxPoints) return { indices: Array.from({ length: n }, (_, i) => i), cellM: null, preserved }
  const remaining = maxPoints - preserved
  if (!remaining) return { indices: Array.from(mask.keys()).filter((i) => mask[i]), cellM: null, preserved }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < n; i++)
    if (!mask[i]) {
      minX = Math.min(minX, x[i])
      minY = Math.min(minY, y[i])
      maxX = Math.max(maxX, x[i])
      maxY = Math.max(maxY, y[i])
    }
  let cellM = Math.max(0.01, Math.sqrt((Math.max(1e-3, maxX - minX) * Math.max(1e-3, maxY - minY)) / remaining))
  const rank = (i: number) => (classification?.[i] === 2 ? 0 : [7, 18].includes(classification?.[i] ?? 0) ? 2 : 1)
  for (let pass = 0; pass < 150; pass++, cellM *= 1.2) {
    const best = new Map<string, number>()
    for (let i = 0; i < n; i++)
      if (!mask[i]) {
        const key = `${Math.floor((x[i] - minX) / cellM)},${Math.floor((y[i] - minY) / cellM)}`,
          j = best.get(key)
        if (j === undefined || rank(i) < rank(j) || (rank(i) === rank(j) && z[i] < z[j])) best.set(key, i)
      }
    if (best.size <= remaining)
      return {
        indices: [...Array.from(mask.keys()).filter((i) => mask[i]), ...best.values()].sort((a, b) => a - b),
        cellM,
        preserved,
      }
  }
  throw Error('The strategic thinning budget could not be met.')
}

export function rasterGridValue(r: LocalRaster, x: number, y: number): number | null {
  const col = (x - r.origin[0]) / r.pixelSize[0],
    row = (y - r.origin[1]) / r.pixelSize[1]
  const eps = 1e-7
  if (col < -eps || row < -eps || col > r.width - 1 + eps || row > r.height - 1 + eps) return null
  const c = Math.min(r.width - 2, Math.max(0, Math.floor(col))),
    q = Math.min(r.height - 2, Math.max(0, Math.floor(row)))
  const u = Math.max(0, Math.min(1, col - c)),
    v = Math.max(0, Math.min(1, row - q))
  let value = 0
  for (const [i, weight] of [
    [q * r.width + c, (1 - u) * (1 - v)],
    [q * r.width + c + 1, u * (1 - v)],
    [(q + 1) * r.width + c, (1 - u) * v],
    [(q + 1) * r.width + c + 1, u * v],
  ]) {
    if (weight < 1e-12) continue
    const z = r.values[i]
    if (z === null || !finite(z)) return null
    value += z * weight
  }
  return value
}
export function mosaicRasters(
  sources: LocalRaster[],
  overlap: 'first' | 'last' = 'first',
): Omit<LocalRaster, 'id' | 'sha256'> {
  if (!sources.length || sources.length > MAX_TERRAIN_SOURCES)
    throw Error(`A mosaic needs 1–${MAX_TERRAIN_SOURCES} sources.`)
  const first = sources[0]
  if (sources.some((r) => r.epsg !== first.epsg || r.verticalReference.trim() !== first.verticalReference.trim()))
    throw Error(
      'Mosaic sources must share the same horizontal CRS and vertical datum; reproject/convert them explicitly first.',
    )
  if (
    sources.some(
      (r) =>
        r.pixelSize[0] <= 0 ||
        r.pixelSize[1] >= 0 ||
        r.width < 2 ||
        r.height < 2 ||
        r.values.length !== r.width * r.height,
    )
  )
    throw Error('Invalid mosaic source grid.')
  const cellX = Math.min(...sources.map((r) => r.pixelSize[0])),
    cellY = Math.min(...sources.map((r) => -r.pixelSize[1]))
  const west = Math.min(...sources.map((r) => r.origin[0])),
    north = Math.max(...sources.map((r) => r.origin[1]))
  const east = Math.max(...sources.map((r) => r.origin[0] + (r.width - 1) * r.pixelSize[0])),
    south = Math.min(...sources.map((r) => r.origin[1] + (r.height - 1) * r.pixelSize[1]))
  const width = Math.ceil((east - west) / cellX - 1e-9) + 1,
    height = Math.ceil((north - south) / cellY - 1e-9) + 1
  if (width * height > MAX_PREPARED_CELLS)
    throw Error(
      'Mosaic exceeds 4,194,304 cells at source resolution; crop the sources. Resolution is not silently reduced.',
    )
  const ordered = overlap === 'last' ? sources.slice().reverse() : sources
  const values = Array.from({ length: width * height }, (_, i) => {
    const x = west + (i % width) * cellX,
      y = north - Math.floor(i / width) * cellY
    for (const r of ordered) {
      const z = rasterGridValue(r, x, y)
      if (z !== null) return z
    }
    return null
  })
  return {
    name: `Mosaic · ${sources.length} sources`,
    kind: 'terrain',
    epsg: first.epsg,
    origin: [west, north],
    pixelSize: [cellX, -cellY],
    width,
    height,
    values,
    acquired: '',
    verticalReference: first.verticalReference,
  }
}
export interface GradedPad {
  name: string
  center: [number, number]
  widthM: number
  lengthM: number
  bearingDegrees: number
  elevationM: number
  crossfallPercent: number
  gradePercent: number
  batterHV: number
}

/** Edit a retained TIN elevation without changing its constrained topology or filling source holes. */
export function editTinElevation(
  r: LocalRaster,
  tin: NonNullable<TerrainPreparationRecord['tin']>,
  vertex: number,
  elevation: number,
) {
  if (
    !Number.isInteger(vertex) ||
    vertex < 0 ||
    vertex >= tin.elevations.length ||
    !finite(elevation) ||
    Math.abs(elevation) > 12000
  )
    throw Error('Select a retained TIN vertex and an elevation between −12,000 and 12,000 m.')
  const edited = {
    coordinates: tin.coordinates.slice(),
    elevations: tin.elevations.slice(),
    triangles: tin.triangles.slice(),
  }
  edited.elevations[vertex] = elevation
  const values: Array<number | null> = new Array(r.values.length).fill(null),
    coords = edited.coordinates
  let work = 0
  for (let i = 0; i < edited.triangles.length; i += 3) {
    const a = edited.triangles[i],
      b = edited.triangles[i + 1],
      c = edited.triangles[i + 2]
    const x0 = coords[2 * a],
      y0 = coords[2 * a + 1],
      x1 = coords[2 * b],
      y1 = coords[2 * b + 1],
      x2 = coords[2 * c],
      y2 = coords[2 * c + 1]
    const ux = x1 - x0,
      uy = y1 - y0,
      vx = x2 - x0,
      vy = y2 - y0,
      det = ux * vy - vx * uy
    if (!det) continue
    const west = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - r.origin[0]) / r.pixelSize[0] - 1e-9)),
      east = Math.min(r.width - 1, Math.floor((Math.max(x0, x1, x2) - r.origin[0]) / r.pixelSize[0] + 1e-9))
    const north = Math.max(0, Math.ceil((r.origin[1] - Math.max(y0, y1, y2)) / -r.pixelSize[1] - 1e-9)),
      south = Math.min(r.height - 1, Math.floor((r.origin[1] - Math.min(y0, y1, y2)) / -r.pixelSize[1] + 1e-9))
    work += Math.max(0, east - west + 1) * Math.max(0, south - north + 1)
    if (work > 100_000_000) throw Error('TIN editing exceeds the 100,000,000 triangle-cell budget; crop the source.')
    for (let row = north; row <= south; row++)
      for (let col = west; col <= east; col++) {
        const index = row * r.width + col
        if (r.values[index] === null) continue
        const dx = r.origin[0] + col * r.pixelSize[0] - x0,
          dy = r.origin[1] + row * r.pixelSize[1] - y0
        const wb = (dx * vy - vx * dy) / det,
          wc = (ux * dy - dx * uy) / det,
          wa = 1 - wb - wc
        if (Math.min(wa, wb, wc) >= -1e-9)
          values[index] = wa * edited.elevations[a] + wb * edited.elevations[b] + wc * edited.elevations[c]
      }
  }
  return { raster: { ...r, name: `${r.name.slice(0, 175)} · edited TIN`, values }, tin: edited }
}
/** Grade a pad and its daylight batters into a checked existing grid; unknown cells remain unknown. */
export function gradePad(r: LocalRaster, pad: GradedPad): LocalRaster {
  if (r.epsg === 4326)
    throw Error('Pad grading requires a projected metre grid. Reproject the geographic source explicitly first.')
  if (
    ![
      ...pad.center,
      pad.widthM,
      pad.lengthM,
      pad.bearingDegrees,
      pad.elevationM,
      pad.crossfallPercent,
      pad.gradePercent,
      pad.batterHV,
    ].every(finite) ||
    pad.widthM <= 0 ||
    pad.widthM > 500 ||
    pad.lengthM <= 0 ||
    pad.lengthM > 1000 ||
    pad.batterHV < 0.1 ||
    pad.batterHV > 10 ||
    Math.abs(pad.elevationM) > 12000 ||
    Math.abs(pad.gradePercent) > 30 ||
    Math.abs(pad.crossfallPercent) > 30
  )
    throw Error('Pad dimensions/slopes exceed the supported bounds.')
  const a = (pad.bearingDegrees * Math.PI) / 180,
    sin = Math.sin(a),
    cos = Math.cos(a)
  let touched = 0
  const values = r.values.map((ground, i) => {
    if (ground === null) return null
    const dx = r.origin[0] + (i % r.width) * r.pixelSize[0] - pad.center[0],
      dy = r.origin[1] + Math.floor(i / r.width) * r.pixelSize[1] - pad.center[1]
    const along = dx * sin + dy * cos,
      across = dx * cos - dy * sin
    const clampedAlong = Math.max(-pad.lengthM / 2, Math.min(pad.lengthM / 2, along)),
      clampedAcross = Math.max(-pad.widthM / 2, Math.min(pad.widthM / 2, across))
    const design =
      pad.elevationM + (clampedAlong * pad.gradePercent) / 100 + (clampedAcross * pad.crossfallPercent) / 100
    const outside = Math.hypot(along - clampedAlong, across - clampedAcross)
    if (outside === 0) {
      touched++
      return design
    }
    const toe = design > ground ? design - outside / pad.batterHV : design + outside / pad.batterHV
    if ((design > ground && toe > ground) || (design < ground && toe < ground)) {
      touched++
      return toe
    }
    return ground
  })
  if (!touched) throw Error('The pad does not intersect known terrain cells.')
  return { ...r, name: pad.name.slice(0, 200) || 'Graded pad', values }
}
const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
export function terrainAscii(r: LocalRaster): string {
  if (Math.abs(r.pixelSize[0] + r.pixelSize[1]) > 1e-8)
    throw Error('ESRI ASCII requires square cells; use LandXML for this grid.')
  return (
    `ncols ${r.width}\nnrows ${r.height}\nxllcenter ${r.origin[0]}\nyllcenter ${r.origin[1] + (r.height - 1) * r.pixelSize[1]}\ncellsize ${r.pixelSize[0]}\nNODATA_value -99999\n` +
    Array.from({ length: r.height }, (_, q) =>
      r.values
        .slice(q * r.width, (q + 1) * r.width)
        .map((z) => (z === null ? '-99999' : String(z)))
        .join(' '),
    ).join('\n') +
    '\n'
  )
}
/** LandXML 1.2 source-grid TIN, including only faces whose three cell vertices are known. */
export function terrainSurfaceLandXml(r: LocalRaster, retained?: TerrainPreparationRecord['tin']): string {
  if (r.epsg === 4326)
    throw Error('Surface LandXML requires projected metre coordinates. Reproject the geographic grid explicitly first.')
  if (r.width * r.height > MAX_PREPARED_CELLS) throw Error('Terrain export exceeds the cell budget.')
  const points: string[] = [],
    faces: string[] = []
  if (retained) {
    parseTerrainPreparation({
      operation: 'point-cloud',
      sources: [{ name: r.name, sha256: r.sha256, epsg: r.epsg, verticalReference: r.verticalReference }],
      method: 'retained TIN',
      parameters: {},
      tin: retained,
    })
    for (let i = 0; i < retained.elevations.length; i++)
      points.push(
        `<P id="${i + 1}">${retained.coordinates[i * 2 + 1]} ${retained.coordinates[i * 2]} ${retained.elevations[i]}</P>`,
      )
    for (let i = 0; i < retained.triangles.length; i += 3)
      faces.push(
        `<F>${retained.triangles[i] + 1} ${retained.triangles[i + 1] + 1} ${retained.triangles[i + 2] + 1}</F>`,
      )
  } else {
    for (let i = 0; i < r.values.length; i++)
      if (r.values[i] !== null)
        points.push(
          `<P id="${i + 1}">${r.origin[1] + Math.floor(i / r.width) * r.pixelSize[1]} ${r.origin[0] + (i % r.width) * r.pixelSize[0]} ${r.values[i]}</P>`,
        )
    for (let row = 0; row < r.height - 1; row++)
      for (let col = 0; col < r.width - 1; col++) {
        const a = row * r.width + col,
          b = a + 1,
          c = a + r.width,
          d = c + 1
        for (const t of [
          [a, c, b],
          [b, c, d],
        ])
          if (t.every((i) => r.values[i] !== null)) faces.push(`<F>${t.map((i) => i + 1).join(' ')}</F>`)
      }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units><CoordinateSystem epsgCode="${r.epsg}" name="EPSG:${r.epsg}"/><!-- Vertical reference: ${xml(r.verticalReference)}; ${r.sha256}. Null cells are omitted; no extrapolation. --><Surfaces><Surface name="${xml(r.name)}"><Definition surfType="TIN"><Pnts>${points.join('')}</Pnts><Faces>${faces.join('')}</Faces></Definition></Surface></Surfaces></LandXML>`
}
