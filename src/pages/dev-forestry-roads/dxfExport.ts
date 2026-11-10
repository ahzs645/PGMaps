/**
 * A road as an AutoCAD R12 ASCII DXF drawing, written here: plan linework in the terrain's projected
 * grid (centreline with true arcs, 3D feature lines along every section code, station ticks and
 * labels), and a profile and cross-sections drawn at true scale below the plan.
 *
 * Implements the DXF R12 group-code format (Autodesk, _AutoCAD Release 12 DXF reference_): HEADER,
 * TABLES (LTYPE, LAYER) and ENTITIES with LINE, ARC, POLYLINE/VERTEX/SEQEND (2D and 3D) and TEXT.
 * A missing elevation breaks a line rather than being bridged, as in the LandXML export.
 *
 * Pure: projection is passed in, no DOM or network access.
 *
 * Written from a functional specification (Lima VVA §8.2, gap G5; RFLTools §11); no code from
 * Lima VVA or RFLTools (GPL-3.0) was used.
 */
import { centrelineSamples, horizontalGeometry } from './engine'
import { sectionFeatureLines, sectionStations, stationOffsetCoordinate, type ToGrid } from './designExports'
import { refuseInvalidResults } from './inputErrors'
import type { Alignment, RoadAnalysis, TerrainMetadata } from './types'

export interface DxfOptions {
  plan: boolean
  profile: boolean
  sections: boolean
  /** Spacing of section drawings, m. */
  sectionIntervalM: number
  /** Spacing of station ticks and labels on the plan and profile, m. */
  labelIntervalM: number
}
export const DEFAULT_DXF_OPTIONS: DxfOptions = {
  plan: true,
  profile: true,
  sections: true,
  sectionIntervalM: 20,
  labelIntervalM: 20,
}
/** Sections are laid out this many to a row. */
export const DXF_SECTIONS_PER_ROW = 5
/** At most this many section drawings; past it the interval is widened. */
export const MAX_DXF_SECTIONS = 500
const TEXT_HEIGHT_M = 2

/** Layers and their AutoCAD colour numbers. Names use capitals, digits and underscores only. */
export const DXF_LAYERS: Record<string, number> = {
  CL: 1,
  CL_3D: 1,
  EDGE_L: 3,
  EDGE_R: 3,
  DITCH_L: 5,
  DITCH_R: 5,
  CATCH_L: 6,
  CATCH_R: 6,
  STATIONS: 7,
  LABELS: 7,
  PROF_GROUND: 32,
  PROF_DESIGN: 1,
  PROF_GRID: 8,
  PROF_TEXT: 7,
  SECT_GROUND: 32,
  SECT_DESIGN: 1,
  SECT_GRID: 8,
  SECT_TEXT: 7,
}

type XY = [number, number]
type XYZ = [number, number, number]

/** A DXF number: fixed decimals, never "-0", never NaN. */
const num = (value: number, digits = 3) => {
  const text = value.toFixed(digits)
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}
/** R12 text is one line of the ANSI code page: other characters become "?". */
const text = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '?')
const stationText = (chainage: number) => {
  const metres = Math.round(chainage)
  return `${Math.floor(metres / 1000)}+${String(metres % 1000).padStart(3, '0')}`
}

/** Collects group-code pairs; `toString` joins them with CRLF, as R12 readers expect. */
class DxfWriter {
  private lines: string[] = []
  pair(code: number, value: string | number) {
    this.lines.push(String(code), typeof value === 'number' ? num(value) : value)
  }
  line(layer: string, a: XYZ, b: XYZ) {
    this.pair(0, 'LINE')
    this.pair(8, layer)
    this.xyz(10, a)
    this.xyz(11, b)
  }
  arc(layer: string, centre: XY, radius: number, startDegrees: number, endDegrees: number) {
    this.pair(0, 'ARC')
    this.pair(8, layer)
    this.xyz(10, [centre[0], centre[1], 0])
    this.pair(40, radius)
    this.pair(50, num(startDegrees, 6))
    this.pair(51, num(endDegrees, 6))
  }
  /** A polyline; a 3D one when its points carry elevations. Fewer than two points draw nothing. */
  polyline(layer: string, points: readonly (XY | XYZ)[], threeD = false) {
    if (points.length < 2) return
    this.pair(0, 'POLYLINE')
    this.pair(8, layer)
    this.pair(66, '1')
    this.xyz(10, [0, 0, 0])
    this.pair(70, threeD ? '8' : '0')
    for (const p of points) {
      this.pair(0, 'VERTEX')
      this.pair(8, layer)
      this.xyz(10, [p[0], p[1], threeD ? (p[2] ?? 0) : 0])
      if (threeD) this.pair(70, '32')
    }
    this.pair(0, 'SEQEND')
    this.pair(8, layer)
  }
  text(layer: string, at: XY, value: string, height = TEXT_HEIGHT_M, rotationDegrees = 0) {
    this.pair(0, 'TEXT')
    this.pair(8, layer)
    this.xyz(10, [at[0], at[1], 0])
    this.pair(40, height)
    this.pair(1, text(value))
    if (rotationDegrees) this.pair(50, num(rotationDegrees, 3))
  }
  private xyz(code: number, [x, y, z]: XYZ) {
    this.pair(code, x)
    this.pair(code + 10, y)
    this.pair(code + 20, z)
  }
  toString() {
    return this.lines.join('\r\n') + '\r\n'
  }
}

/** Splits a run of points at missing values: a gap in the data is a gap in the line. */
function runs<T>(items: readonly (T | null)[]): T[][] {
  const out: T[][] = []
  let current: T[] = []
  for (const item of items) {
    if (item === null) {
      if (current.length) out.push(current)
      current = []
    } else current.push(item)
  }
  if (current.length) out.push(current)
  return out
}
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/**
 * The DXF drawing. Refused while the road's results leave out an invalid input. Plan coordinates
 * are grid metres in `epsg`; the profile and sections are drawn in their own frames below the plan.
 */
export function roadDxf({
  name,
  alignment,
  analysis,
  terrain,
  toGrid,
  epsg,
  options = DEFAULT_DXF_OPTIONS,
}: {
  name: string
  alignment: Alignment
  analysis: RoadAnalysis
  terrain: Pick<TerrainMetadata, 'name' | 'verticalReference'>
  toGrid: ToGrid
  epsg: number
  options?: DxfOptions
}): string {
  refuseInvalidResults('DXF drawing', analysis)
  if (!analysis.stations.length) throw Error('The road has no calculated stations to draw.')
  const w = new DxfWriter()
  const stations = analysis.stations

  // Plan extent, to place the profile and sections below it.
  const planPoints = stations.map((s) => toGrid(s.coordinate))
  const minX = Math.min(...planPoints.map((p) => p[0])),
    maxX = Math.max(...planPoints.map((p) => p[0])),
    minY = Math.min(...planPoints.map((p) => p[1]))

  // ---- Plan ----
  if (options.plan) {
    let dense: ReturnType<typeof centrelineSamples> | null = null
    for (const piece of horizontalGeometry(alignment)) {
      const start = toGrid(piece.start),
        end = toGrid(piece.end)
      if (piece.kind === 'line') w.line('CL', [start[0], start[1], 0], [end[0], end[1], 0])
      else if (piece.kind === 'arc') {
        // Kept a true arc in the grid: the chord between the projected ends and the model's
        // deflection give the grid radius and centre, as in the LandXML export.
        const delta = piece.length / piece.radius
        const chord = Math.hypot(end[0] - start[0], end[1] - start[1])
        const radius = chord / (2 * Math.sin(delta / 2))
        const toCentre = (piece.rotation === 'ccw' ? 1 : -1) * radius * Math.cos(delta / 2)
        const centre: XY = [
          (start[0] + end[0]) / 2 - ((end[1] - start[1]) / chord) * toCentre,
          (start[1] + end[1]) / 2 + ((end[0] - start[0]) / chord) * toCentre,
        ]
        const angle = (p: XY) => (Math.atan2(p[1] - centre[1], p[0] - centre[0]) * 180) / Math.PI
        // DXF arcs run counter-clockwise from the start angle to the end angle.
        const [from, to] = piece.rotation === 'ccw' ? [start, end] : [end, start]
        w.arc('CL', centre, radius, (angle(from) + 360) % 360, (angle(to) + 360) % 360)
      } else {
        const line = (dense ??= centrelineSamples(alignment, 1))
        const points = line.samples
          .filter((s) => s.s >= piece.station - 1e-6 && s.s <= piece.station + piece.length + 1e-6)
          .map((s) => toGrid(line.toCoordinate(s.x, s.y)))
        w.polyline('CL', [start, ...points, end])
      }
    }
    // 3D feature lines along each section code.
    for (const line of sectionFeatureLines(alignment, analysis, toGrid))
      for (const part of line.parts) w.polyline(line.layer, part, true)
    // Station ticks and labels.
    for (let chainage = 0; chainage <= analysis.length + 1e-6; chainage += options.labelIntervalM) {
      const s = stations.reduce((best, x) =>
        Math.abs(x.chainage - chainage) < Math.abs(best.chainage - chainage) ? x : best,
      )
      if (Math.abs(s.chainage - chainage) > options.labelIntervalM / 2) continue
      const left = toGrid(stationOffsetCoordinate(s, -(s.leftWidth + 2))),
        right = toGrid(stationOffsetCoordinate(s, s.rightWidth + 2))
      w.line('STATIONS', [left[0], left[1], 0], [right[0], right[1], 0])
      // Text along the tick, reading from the left edge outward.
      const rotation = (Math.atan2(left[1] - right[1], left[0] - right[0]) * 180) / Math.PI
      w.text('LABELS', left, stationText(s.chainage), TEXT_HEIGHT_M, rotation)
    }
  }

  // ---- Profile, true scale, below the plan ----
  const elevations = stations.flatMap((s) => [s.groundElevation, s.designElevation]).filter(finite)
  const low = elevations.length ? Math.floor(Math.min(...elevations) / 5) * 5 - 5 : 0
  const high = elevations.length ? Math.ceil(Math.max(...elevations) / 5) * 5 + 5 : 10
  const profileHeight = high - low
  const profileOrigin: XY = [minX, minY - 100 - profileHeight]
  const px = (chainage: number) => profileOrigin[0] + chainage,
    py = (elevation: number) => profileOrigin[1] + (elevation - low)
  if (options.profile) {
    w.text('PROF_TEXT', [px(0), py(high) + 6], `${name}: profile, true scale (1:1), ${terrain.verticalReference}`)
    for (let e = low; e <= high + 1e-6; e += 5) {
      w.line('PROF_GRID', [px(0), py(e), 0], [px(analysis.length), py(e), 0])
      w.text('PROF_TEXT', [px(0) - 12, py(e) - 0.5], num(e, 0), 1)
    }
    for (let chainage = 0; chainage <= analysis.length + 1e-6; chainage += options.labelIntervalM) {
      w.line('PROF_GRID', [px(chainage), py(low), 0], [px(chainage), py(high), 0])
      w.text('PROF_TEXT', [px(chainage), py(low) - 4], stationText(chainage), 1.5)
    }
    for (const run of runs(
      stations.map((s) => (finite(s.groundElevation) ? ([px(s.chainage), py(s.groundElevation)] as XY) : null)),
    ))
      w.polyline('PROF_GROUND', run)
    for (const run of runs(
      stations.map((s) => (finite(s.designElevation) ? ([px(s.chainage), py(s.designElevation)] as XY) : null)),
    ))
      w.polyline('PROF_DESIGN', run)
  }

  // ---- Cross-sections, a grid of true-scale drawings below the profile ----
  if (options.sections) {
    const interval = Math.max(options.sectionIntervalM, analysis.length / MAX_DXF_SECTIONS)
    const picked = sectionStations(analysis, interval)
    const halfWidth = Math.max(10, ...picked.flatMap((s) => s.section.map((p) => Math.abs(p.offset))))
    const cellWidth = 2 * halfWidth + 10
    const heights = picked.map((s) => {
      const values = s.section.flatMap((p) => [p.ground, p.design]).filter(finite)
      return values.length ? Math.max(...values) - Math.min(...values) : 0
    })
    const cellHeight = Math.max(20, ...heights) + 15
    const top = profileOrigin[1] - 40
    picked.forEach((s, index) => {
      const column = index % DXF_SECTIONS_PER_ROW,
        row = Math.floor(index / DXF_SECTIONS_PER_ROW)
      const centreX = minX + halfWidth + column * cellWidth
      const values = s.section.flatMap((p) => [p.ground, p.design]).filter(finite)
      const base = values.length ? Math.min(...values) : 0
      const baseY = top - (row + 1) * cellHeight + 8
      const sx = (offset: number) => centreX + offset,
        sy = (elevation: number) => baseY + (elevation - base)
      w.text('SECT_TEXT', [sx(-halfWidth), baseY - 6], `${stationText(s.chainage)} (${num(s.chainage, 1)} m)`, 1.5)
      w.line('SECT_GRID', [sx(0), baseY - 2, 0], [sx(0), baseY + cellHeight - 12, 0])
      for (const run of runs(s.section.map((p) => (finite(p.ground) ? ([sx(p.offset), sy(p.ground)] as XY) : null))))
        w.polyline('SECT_GROUND', run)
      for (const run of runs(s.section.map((p) => (finite(p.design) ? ([sx(p.offset), sy(p.design)] as XY) : null))))
        w.polyline('SECT_DESIGN', run)
    })
  }
  const entities = w.toString()

  // ---- Header and tables ----
  const head = new DxfWriter()
  head.pair(
    999,
    text(
      `PG Maps forest road design: ${name}. Plan in EPSG:${epsg} grid metres; preliminary planning geometry, not a construction design.`,
    ),
  )
  head.pair(0, 'SECTION')
  head.pair(2, 'HEADER')
  head.pair(9, '$ACADVER')
  head.pair(1, 'AC1009')
  head.pair(9, '$EXTMIN')
  head.pair(10, minX)
  head.pair(20, profileOrigin[1] - 1000)
  head.pair(30, 0)
  head.pair(9, '$EXTMAX')
  head.pair(10, maxX + 1000)
  head.pair(20, Math.max(...planPoints.map((p) => p[1])))
  head.pair(30, 0)
  head.pair(0, 'ENDSEC')
  head.pair(0, 'SECTION')
  head.pair(2, 'TABLES')
  head.pair(0, 'TABLE')
  head.pair(2, 'LTYPE')
  head.pair(70, '1')
  head.pair(0, 'LTYPE')
  head.pair(2, 'CONTINUOUS')
  head.pair(70, '0')
  head.pair(3, 'Solid line')
  head.pair(72, '65')
  head.pair(73, '0')
  head.pair(40, 0)
  head.pair(0, 'ENDTAB')
  head.pair(0, 'TABLE')
  head.pair(2, 'LAYER')
  head.pair(70, String(Object.keys(DXF_LAYERS).length))
  for (const [layer, colour] of Object.entries(DXF_LAYERS)) {
    head.pair(0, 'LAYER')
    head.pair(2, layer)
    head.pair(70, '0')
    head.pair(62, String(colour))
    head.pair(6, 'CONTINUOUS')
  }
  head.pair(0, 'ENDTAB')
  head.pair(0, 'ENDSEC')
  head.pair(0, 'SECTION')
  head.pair(2, 'ENTITIES')
  return head.toString() + entities + ['0', 'ENDSEC', '0', 'EOF'].join('\r\n') + '\r\n'
}
