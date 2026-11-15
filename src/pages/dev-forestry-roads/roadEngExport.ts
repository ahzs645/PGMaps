/**
 * Roads written as a Softree RoadEng / Location design (`.dsnx`): the parts `roadEngImport.ts`
 * reads, laid out as RoadEng 11 writes them. Each road is one alignment (`Location1`, …) with
 *
 * - `.dsn`: `[Software]` RoadEng 11.0.673.0, `[design] units=10000` (metres) and the terrain file
 *   name when there is one, and the road's name as `[HAlignOptions] Option, 1`;
 * - `.ds2`: a `108` record per intersection point (signed radius, negative turning left, X, Y), a
 *   `109` per vertical PI inside the road (signed vertical-curve radius, positive a sag, station,
 *   elevation), and `110` calculated stations (X, Y, design level, station) every
 *   {@link ROADENG_EXPORT_STATION_M} and at every tangent point, the first and last being its ends;
 * - `.ds1`: three empty index records, as RoadEng 11 leaves them.
 *
 * Geometry is written in a projected grid, metres. Each curve keeps the tangent points the road
 * model gives it: its tangent length is scaled by the smaller grid-to-model ratio of its two legs
 * and its radius is the one that length gives at the grid's deflection, the inverse of
 * `gridAlignmentRoad`, so a design read back lands where it was. A spiralled curve is written as a
 * simple curve through the same tangent points, and a corner the engine leaves sharp as radius 0.
 * Stations are the road's chainage over the ratio of its length to the grid plan's, the ratio the
 * import multiplies by.
 *
 * Pure: no DOM or network access.
 */
import { strToU8, zipSync } from 'fflate'
import { alignmentLength, designProfileAt, horizontalCurveFits, planFrame } from './engine'
import type { XY } from './landXmlImport'
import { rebuildPlan, type RoadEngPi } from './roadEngImport'
import { groundAlong } from './roadSummaryMetrics'
import type { Alignment, Coordinate, RoadAnalysis } from './types'

/** Spacing of the calculated stations written, grid metres. */
export const ROADENG_EXPORT_STATION_M = 10
/** A PVI this close to an end is that end: imported chainages are rounded to the millimetre. */
const END_TOLERANCE_M = 0.002
/** RoadEng's design speed field, project units a second. */
const DEFAULT_DESIGN_SPEED_MS = 50 / 3.6
const VERSION = '11.0.673.0'
const HEADER = `100,103,11,${VERSION}, Softree Technical Systems Inc. - Location Line data file`.padEnd(126, ' ')
/** RoadEng's default overburden, the material every design carries. */
const OVERBURDEN = '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,'

export interface RoadEngExportRoad {
  alignment: Alignment
  /** Its calculated stations; ground levels come from here when the road has no profile. */
  analysis?: Pick<RoadAnalysis, 'stations'>
}

export interface RoadEngExport {
  bytes: Uint8Array
  /** The text parts as written, by name, for a preview. */
  parts: Record<string, string>
  /** What the notice says about the roads written. */
  notes: string[]
}

/** Up to six decimals, no exponent, no trailing zeros. */
function num(value: number): string {
  const text = value.toFixed(6).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

const deflection = (xy: readonly XY[], k: number) => {
  const a = Math.atan2(xy[k][1] - xy[k - 1][1], xy[k][0] - xy[k - 1][0]),
    b = Math.atan2(xy[k + 1][1] - xy[k][1], xy[k + 1][0] - xy[k][0])
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** One road's `.dsn` and `.ds2` text. */
export function roadEngAlignmentParts(
  road: RoadEngExportRoad,
  toGrid: (coordinate: Coordinate) => XY,
  options: { terrainName?: string; designSpeedKmh?: number } = {},
): { dsn: string; ds2: string; notes: string[] } {
  const { alignment } = road
  const notes: string[] = []
  const points = alignment.points
  if (points.length < 2) throw Error(`${alignment.name} needs at least two points to export.`)
  const grid = points.map((p) => toGrid(p.coordinate))
  const plane = planFrame(points[0].coordinate)
  const model = points.map((p) => plane.toXY(p.coordinate))
  const leg = (xy: readonly XY[], k: number) => Math.hypot(xy[k + 1][0] - xy[k][0], xy[k + 1][1] - xy[k][1])
  const fits = new Map(horizontalCurveFits(alignment).map((fit) => [fit.point, fit]))

  const pis: RoadEngPi[] = []
  let spiralled = 0
  for (let k = 1; k < points.length - 1; k++) {
    const fit = fits.get(k + 1)
    const turn = deflection(grid, k)
    let radiusM = 0
    if (fit?.status === 'fitted' && fit.tangentM > 0 && Math.abs(turn) > 1e-9) {
      const scale = Math.min(leg(model, k - 1) / leg(grid, k - 1), leg(model, k) / leg(grid, k))
      radiusM = fit.tangentM / scale / Math.tan(Math.abs(turn) / 2)
      if ((points[k].spiralM ?? 0) > 0) spiralled++
    }
    pis.push({ xy: grid[k], radiusM, turn: turn > 0 ? 'left' : 'right', type: 2 })
  }
  if (spiralled)
    notes.push(
      `${alignment.name}: ${spiralled === 1 ? '1 spiralled curve is written as a simple curve' : `${spiralled} spiralled curves are written as simple curves`} through the same tangent points.`,
    )

  const plan = rebuildPlan({ xy: grid[0], station: 0 }, pis, { xy: grid[grid.length - 1] })
  const length = alignmentLength(alignment)
  const ratio = plan.length > 0 ? length / plan.length : 1
  const profiled = alignment.vertical.length >= 2
  // RoadEng's profile is the finished surface; this workspace's is the subgrade under the courses.
  const surfacing = profiled ? centreSurfacingM(alignment) : 0
  const stations = road.analysis?.stations ?? []
  const ground = (chainage: number) => {
    let best: number | null = null,
      far = Infinity
    for (const s of stations)
      if (s.groundElevation !== null && Math.abs(s.chainage - chainage) < far) {
        far = Math.abs(s.chainage - chainage)
        best = s.groundElevation
      }
    // A design-only road keeps the ground its design file recorded (`fileGround`).
    return best ?? groundAlong(alignment.fileGround?.points ?? [], chainage)
  }
  const level = (station: number) => {
    if (!profiled) return ground(station * ratio)
    const subgrade = designProfileAt(alignment, Math.min(length, station * ratio))?.elevation
    return subgrade === undefined ? null : subgrade + surfacing
  }

  const marks = new Set([0, plan.length, ...plan.tangentPoints])
  for (let s = ROADENG_EXPORT_STATION_M; s < plan.length; s += ROADENG_EXPORT_STATION_M) marks.add(s)
  const tangent = new Set(plan.tangentPoints)
  const rows110: string[] = []
  let skipped = 0
  for (const station of [...marks].sort((a, b) => a - b)) {
    const z = level(station)
    const end = station === 0 || station === plan.length
    if (z === null || !Number.isFinite(z)) {
      if (end) throw Error(`${alignment.name} has no ${profiled ? 'design' : 'ground'} level at its ends to export.`)
      skipped++
      continue
    }
    const [x, y] = plan.at(station)
    const type = end ? 5 : tangent.has(station) ? 2 : 4
    rows110.push(`110,${type},${num(x)},${num(y)},${num(z)},${num(station)},-1,0,0,,,${type === 4 ? 256 : 0}`)
  }
  if (skipped) notes.push(`${alignment.name}: ${skipped} stations without a ground level are left out.`)
  if (!profiled) notes.push(`${alignment.name} has no design profile: its stations carry ground levels.`)
  else if (surfacing > 0)
    notes.push(
      `${alignment.name}'s levels are its finished surface, ${surfacing.toFixed(2)} m of surfacing above the subgrade.`,
    )

  // Vertical PIs inside the road; its ends are the first and last stations' levels.
  const speed = num((options.designSpeedKmh ?? DEFAULT_DESIGN_SPEED_MS * 3.6) / 3.6)
  const rows109: string[] = []
  if (profiled) {
    const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
    const profile = [
      { station: 0, elevation: level(0)!, curveLength: 0 },
      ...vertical
        .filter((p) => p.chainage > END_TOLERANCE_M && p.chainage < length - END_TOLERANCE_M)
        .map((p) => ({
          station: p.chainage / ratio,
          elevation: p.elevation + surfacing,
          curveLength: p.curveLength / ratio,
        })),
      { station: plan.length, elevation: level(plan.length)!, curveLength: 0 },
    ]
    for (let k = 1; k < profile.length - 1; k++) {
      const p = profile[k]
      const into = (p.elevation - profile[k - 1].elevation) / (p.station - profile[k - 1].station)
      const out = (profile[k + 1].elevation - p.elevation) / (profile[k + 1].station - p.station)
      const change = out - into
      const radius = p.curveLength > 0 && Math.abs(change) > 1e-12 ? p.curveLength / change : 0
      rows109.push(`109,${k},4,${num(radius)},${num(p.station)},${num(p.elevation)},0,-1,${speed},0,0,-1`)
    }
  }

  const rows108 = pis.map(
    (p, k) =>
      `108,${k + 1},2,${num(p.turn === 'left' ? -p.radiusM : p.radiusM)},${num(p.xy[0])},${num(p.xy[1])},0,-1,${speed},5590,0.06,0.1,0,0,0.667,0,0,0,0,0`,
  )
  const ds2 = [HEADER, ...rows108, ...rows109, ...rows110, OVERBURDEN, '118,1', ''].join('\r\n')
  const name =
    alignment.name
      .replace(/[\r\n[\]=]+/g, ' ')
      .trim()
      .slice(0, 120) || 'PG Maps road'
  const dsn = [
    '[Software]',
    'Version=11.000',
    `Version2=${VERSION}`,
    '[design]',
    'nAlignments=1,0',
    ...(options.terrainName ? [`surface=${options.terrainName.replace(/[\r\n]+/g, ' ')}`] : []),
    'units=10000',
    'Version=11',
    `Version2=${VERSION}`,
    '[HAlignOptions]',
    `Option, 1=${name}`,
    'Option, 2=1',
    // RoadEng skips sections it does not know. This one lets the design come back to this workspace
    // with its section and its levels on the subgrade (`roadEngImport.ts`, `RoadEngAlignment.pgmaps`).
    '[PGMaps]',
    `SurfacingM=${num(surfacing)}`,
    `Template=${JSON.stringify(alignment.template)}`,
    // Template ranges, materials and horizons, and the curve rule, so the road comes back whole.
    ...(alignment.engineering ? [`Engineering=${JSON.stringify(alignment.engineering)}`] : []),
    ...(alignment.curveDesign ? [`CurveDesign=${JSON.stringify(alignment.curveDesign)}`] : []),
    '',
  ].join('\r\n')
  return { dsn, ds2, notes }
}

/** Surfacing on the centreline, m: the course stack on the left side, or the legacy depth. */
export function centreSurfacingM(alignment: Pick<Alignment, 'template'>): number {
  const t = alignment.template
  if (t.layers?.length) return t.layers.filter((l) => l.side !== 'right').reduce((sum, l) => sum + l.depthM, 0)
  return t.leftSurfaceDepth ?? t.surfaceDepth ?? 0
}

/** Three empty index records, as RoadEng 11 writes `.ds1`. */
function emptyIndex(): Uint8Array {
  const bytes = new Uint8Array(72)
  for (let k = 0; k < 3; k++) {
    bytes[k * 24] = 0x0c
    bytes[k * 24 + 2] = k + 1
  }
  return bytes
}

/** Roads as one `.dsnx` archive, one alignment each, in the order given. */
export function roadEngDesign(
  roads: readonly RoadEngExportRoad[],
  toGrid: (coordinate: Coordinate) => XY,
  options: { terrainName?: string; designSpeedKmh?: number } = {},
): RoadEngExport {
  if (!roads.length) throw Error('Choose at least one road to export.')
  const files: Record<string, Uint8Array> = {}
  const parts: Record<string, string> = {}
  const notes: string[] = []
  roads.forEach((road, k) => {
    const part = `Location${k + 1}`
    const written = roadEngAlignmentParts(road, toGrid, options)
    files[`${part}.ds1`] = emptyIndex()
    files[`${part}.ds2`] = strToU8(written.ds2, true)
    files[`${part}.dsn`] = strToU8(written.dsn, true)
    parts[`${part}.dsn`] = written.dsn
    parts[`${part}.ds2`] = written.ds2
    notes.push(...written.notes)
  })
  return { bytes: zipSync(files, { mtime: new Date(2000, 0, 1) }), parts, notes }
}
