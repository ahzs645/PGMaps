/**
 * Design surfaces as LandXML 1.2 TINs for CAD and machine control: the **subgrade** (the section's
 * design line, which is this workspace's profile) and the **finished surface** (the surfacing
 * courses' top across the running surface, the subgrade beyond it). Guide:
 * `docs/forestry-road-design/exports-and-project-files.md`, **Design surfaces**.
 *
 * Built only from the engineering sections at the calculated stations (`RoadStation.section` and
 * `sectionCodePoints`): consecutive sections are joined by explicit faces, and the named points
 * (centreline, formation edges, ditch bottoms, catch points) are matched across each pair so those
 * break lines are triangle edges. An interval with an incomplete section at either end is never
 * bridged: the surface breaks there into separate pieces, each its own `<Surface>` with an outer
 * boundary, and the result says where. Nothing is interpolated between stations.
 *
 * Faces wind counter-clockwise seen from above in grid easting/northing. A TIN cannot hold a vertical
 * face, so a square-edged course and any vertical step in a design line are drawn
 * `VERTICAL_FACE_INSET_M` wide, the upper (inner) point moved toward the centreline; the file says
 * how many. Pure: no DOM or network access.
 */
import { refuseInvalidResults } from './inputErrors'
import { formatStationLabel } from './roadStationing'
import { stationOffsetCoordinate, type ToGrid } from './designExports'
import { sectionCodePoints } from './sectionGeometry'
import { courseStack } from './sectionStructures'
import type { Alignment, ResolvedTemplate, RoadAnalysis, RoadStation, RoadTemplate, TerrainMetadata } from './types'

export type DesignSurfaceKind = 'subgrade' | 'finished'

/** How wide a vertical face (a square course edge, a wall step in a design line) is drawn, m. */
export const VERTICAL_FACE_INSET_M = 0.01
/** Section points closer than this across the road are one point, m. */
const SAME_OFFSET_M = 0.001
/** A face whose plan area is at or below this is degenerate and left out, m². */
const MIN_FACE_AREA_M2 = 1e-6
/** Named points matched from section to section, so their lines are triangle edges. */
const BREAK_CODES = [
  'left-daylight',
  'left-ditch-bottom',
  'left-formation-edge',
  'centreline',
  'right-formation-edge',
  'right-ditch-bottom',
  'right-daylight',
] as const

const SURFACE_LABEL: Record<DesignSurfaceKind, string> = { subgrade: 'Subgrade', finished: 'Finished surface' }

interface SectionVertex {
  offset: number
  z: number
  code?: string
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)
const templateOf = (t: RoadTemplate | ResolvedTemplate): RoadTemplate => ('template' in t ? t.template : t)

/** The design line of a section as one run of points ordered across the road, or a reason it has none. */
function subgradeLine(station: RoadStation, template: RoadTemplate | ResolvedTemplate): SectionVertex[] | string {
  const samples = [...station.section].sort((a, b) => a.offset - b.offset)
  const first = samples.findIndex((s) => finite(s.design)),
    last = samples.length - 1 - [...samples].reverse().findIndex((s) => finite(s.design))
  if (first < 0) return 'no design section'
  const run = samples.slice(first, last + 1)
  if (run.some((s) => !finite(s.design))) return 'design section has a gap'
  const line: SectionVertex[] = run.map((s) => ({ offset: s.offset, z: s.design! }))
  // The named points become vertices, so they can be matched to the next section's.
  for (const p of sectionCodePoints(station, template)) {
    if (!(BREAK_CODES as readonly string[]).includes(p.code) || !finite(p.design)) continue
    const at = line.find((v) => Math.abs(v.offset - p.offset) < SAME_OFFSET_M)
    if (at) at.code ??= p.code
    else if (p.offset > line[0].offset && p.offset < line[line.length - 1].offset)
      line.push({ offset: p.offset, z: p.design, code: p.code })
  }
  return line.sort((a, b) => a.offset - b.offset)
}

/** Linear interpolation of a line's level at an offset inside it. */
function levelAt(line: SectionVertex[], offset: number): number {
  for (let i = 1; i < line.length; i++)
    if (offset <= line[i].offset + 1e-12) {
      const a = line[i - 1],
        b = line[i]
      const span = b.offset - a.offset
      return span > 0 ? a.z + ((b.z - a.z) * (offset - a.offset)) / span : b.z
    }
  return line[line.length - 1].z
}

/**
 * The courses' outer outline on one side as (distance from the centreline, height above the subgrade),
 * from the centreline outward and ending at the formation edge on the subgrade. Square edges are
 * drawn `VERTICAL_FACE_INSET_M` wide.
 */
function courseOutline(t: RoadTemplate, side: 'left' | 'right', widthM: number): [number, number][] {
  const stack = t.layers
    ? courseStack(t.layers, side, widthM).filter((c) => c.layer.depthM > 0)
    : [
        {
          topWidthM: widthM,
          bottomWidthM: widthM,
          baseDepthM: 0,
          layer: { depthM: (side === 'left' ? t.leftSurfaceDepth : t.rightSurfaceDepth) ?? t.surfaceDepth },
        },
      ].filter((c) => c.layer.depthM > 0)
  if (!stack.length || !(widthM > 0)) return []
  const total = stack.reduce((sum, c) => sum + c.layer.depthM, 0)
  const outline: [number, number][] = [[0, total]]
  for (let k = stack.length - 1; k >= 0; k--) {
    const c = stack[k]
    const top = c.baseDepthM + c.layer.depthM
    let topAt = Math.min(c.topWidthM, widthM)
    const previous = outline[outline.length - 1][0]
    if (c.bottomWidthM - topAt < VERTICAL_FACE_INSET_M) topAt = c.bottomWidthM - VERTICAL_FACE_INSET_M
    if (topAt > previous + SAME_OFFSET_M) outline.push([topAt, top])
    else outline[outline.length - 1] = [outline[outline.length - 1][0], top]
    outline.push([c.bottomWidthM, c.baseDepthM])
  }
  return outline
}

/**
 * The finished surface's line: the subgrade raised by the courses across the running surface, the
 * subgrade itself beyond the formation edges.
 */
function finishedLine(station: RoadStation, template: RoadTemplate, subgrade: SectionVertex[]): SectionVertex[] {
  const left = courseOutline(template, 'left', station.leftWidth),
    right = courseOutline(template, 'right', station.rightWidth)
  const heightOn = (outline: [number, number][], d: number) => {
    if (!outline.length || d >= outline[outline.length - 1][0]) return 0
    for (let i = 1; i < outline.length; i++)
      if (d <= outline[i][0]) {
        const [d0, h0] = outline[i - 1],
          [d1, h1] = outline[i]
        return d1 > d0 ? h0 + ((h1 - h0) * (d - d0)) / (d1 - d0) : h1
      }
    return 0
  }
  const centreStep = (left[0]?.[1] ?? 0) !== (right[0]?.[1] ?? 0)
  const height = (x: number) => {
    if (x <= 0) return heightOn(left, -x)
    // Courses of different depth either side meet `VERTICAL_FACE_INSET_M` right of the centreline.
    if (centreStep && x < VERTICAL_FACE_INSET_M)
      return (
        heightOn(left, 0) + ((heightOn(right, VERTICAL_FACE_INSET_M) - heightOn(left, 0)) * x) / VERTICAL_FACE_INSET_M
      )
    return heightOn(right, x)
  }
  const lo = subgrade[0].offset,
    hi = subgrade[subgrade.length - 1].offset
  const offsets = new Map<number, string | undefined>()
  for (const v of subgrade) offsets.set(v.offset, v.code)
  const extra = [
    ...left.map(([d]) => -d),
    ...right.map(([d]) => d),
    ...(centreStep ? [VERTICAL_FACE_INSET_M] : []),
  ].filter((x) => x > lo && x < hi && ![...offsets.keys()].some((o) => Math.abs(o - x) < SAME_OFFSET_M / 2))
  for (const x of extra) offsets.set(x, undefined)
  return [...offsets]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, code]) => ({ offset, z: levelAt(subgrade, offset) + height(offset), ...(code ? { code } : {}) }))
}

/**
 * Makes offsets strictly increase: a point on (or within a millimetre of) its outer neighbour is the
 * upper step of a vertical face and moves `VERTICAL_FACE_INSET_M` toward the centreline. Returns the
 * number of faces moved; a point with no room to move is dropped.
 */
function separateVerticalSteps(line: SectionVertex[]): number {
  let moved = 0
  // Right of the centreline the inner point is the earlier one; left of it, the later one.
  for (let i = line.length - 1; i > 0; i--) {
    const a = line[i - 1],
      b = line[i]
    if (b.offset - a.offset >= SAME_OFFSET_M) continue
    if (Math.abs(a.z - b.z) < SAME_OFFSET_M) {
      b.code ??= a.code
      line.splice(i - 1, 1)
      continue
    }
    moved++
    if (a.offset >= 0) a.offset = b.offset - VERTICAL_FACE_INSET_M
    else b.offset = a.offset + VERTICAL_FACE_INSET_M
  }
  for (let i = line.length - 1; i > 0; i--)
    if (line[i].offset - line[i - 1].offset < SAME_OFFSET_M) line.splice(line[i - 1].code ? i : i - 1, 1)
  return moved
}

/** Faces between two section lines, as index pairs [line, vertex], matching shared break codes. */
function strip(a: SectionVertex[], b: SectionVertex[]): [number, number][][] {
  const shared = BREAK_CODES.filter((code) => a.some((v) => v.code === code) && b.some((v) => v.code === code))
  const anchors: [number, number][] = [[0, 0]]
  for (const code of shared) {
    const i = a.findIndex((v) => v.code === code),
      j = b.findIndex((v) => v.code === code)
    const [pi, pj] = anchors[anchors.length - 1]
    // Keep the matching in order across the road; a code out of order is not matched.
    if (i > pi && j > pj) anchors.push([i, j])
    else if (i === pi && j === pj) continue
  }
  const [li, lj] = anchors[anchors.length - 1]
  if (li < a.length - 1 || lj < b.length - 1) {
    if (li === a.length - 1 || lj === b.length - 1) anchors[anchors.length - 1] = [a.length - 1, b.length - 1]
    else anchors.push([a.length - 1, b.length - 1])
  }
  // Collapsing the last anchor can leave a span with no vertex left on one side; merge stays valid.
  const faces: [number, number][][] = []
  for (let k = 1; k < anchors.length; k++) {
    const [i0, j0] = anchors[k - 1],
      [i1, j1] = anchors[k]
    const ta = (i: number) => (a[i].offset - a[i0].offset) / (a[i1].offset - a[i0].offset || 1),
      tb = (j: number) => (b[j].offset - b[j0].offset) / (b[j1].offset - b[j0].offset || 1)
    let i = i0,
      j = j0
    while (i < i1 || j < j1) {
      if (j === j1 || (i < i1 && ta(i + 1) <= tb(j + 1))) {
        faces.push([
          [0, i],
          [0, i + 1],
          [1, j],
        ])
        i++
      } else {
        faces.push([
          [0, i],
          [1, j + 1],
          [1, j],
        ])
        j++
      }
    }
  }
  return faces
}

export interface DesignSurfacePiece {
  /** First and last chainage of the piece, m. */
  from: number
  to: number
  /** Grid easting, northing and level of each point. */
  points: [number, number, number][]
  /** Faces as zero-based point indices, counter-clockwise seen from above. */
  faces: [number, number, number][]
  /** Outer boundary as point indices, counter-clockwise, first point not repeated. */
  boundary: number[]
  /** Faces that fold over (clockwise in plan), on the inside of a curve tighter than the section's reach. */
  folded: number
}

export interface DesignSurfaceGap {
  from: number
  to: number
  reason: string
}

export interface DesignSurface {
  kind: DesignSurfaceKind
  pieces: DesignSurfacePiece[]
  /** Stretches of the road with no surface, with the section builder's reason. */
  gaps: DesignSurfaceGap[]
  /** Vertical faces drawn `VERTICAL_FACE_INSET_M` wide. */
  verticalFaces: number
}

/** A station's section line for one surface, or the reason it has none. */
function sectionLine(
  kind: DesignSurfaceKind,
  station: RoadStation,
  template: RoadTemplate | ResolvedTemplate,
): { line: SectionVertex[]; moved: number } | string {
  if (!station.complete) return station.incompleteReasons?.[0] ?? 'incomplete section'
  const subgrade = subgradeLine(station, template)
  if (typeof subgrade === 'string') return subgrade
  const line = kind === 'subgrade' ? subgrade : finishedLine(station, templateOf(template), subgrade)
  const moved = separateVerticalSteps(line)
  return line.length >= 2 ? { line, moved } : 'design section has fewer than two points'
}

/**
 * The subgrade or finished surface of a road as TIN pieces in grid coordinates. Refuses a road whose
 * results leave out an invalid input, as every contractor file does.
 */
export function designSurface(
  kind: DesignSurfaceKind,
  alignment: Alignment,
  analysis: RoadAnalysis,
  toGrid: ToGrid,
): DesignSurface {
  refuseInvalidResults(`${SURFACE_LABEL[kind]} surface`, analysis)
  const templates = new Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
  const stations = [...analysis.stations].sort((a, b) => a.chainage - b.chainage)
  const lines = stations.map((s) => sectionLine(kind, s, templates.get(s.chainage) ?? alignment.template))
  let verticalFaces = 0
  for (const entry of lines) if (typeof entry !== 'string') verticalFaces += entry.moved
  // Runs of consecutive stations with a complete section; a run of two or more is a piece.
  const runs: number[][] = []
  lines.forEach((entry, k) => {
    if (typeof entry === 'string') return
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === k - 1) last.push(k)
    else runs.push([k])
  })
  const pieces = runs
    .filter((run) => run.length >= 2)
    .map((run) =>
      buildPiece(
        run.map((k) => ({ station: stations[k], line: (lines[k] as { line: SectionVertex[] }).line })),
        toGrid,
      ),
    )
  // Everything between the road's first and last station that no piece covers, with the first reason in it.
  const gaps: DesignSurfaceGap[] = []
  const start = stations[0]?.chainage,
    end = stations[stations.length - 1]?.chainage
  if (start !== undefined && end !== undefined) {
    const bounds = [start, ...pieces.flatMap((p) => [p.from, p.to]), end]
    for (let i = 0; i < bounds.length; i += 2) {
      const from = bounds[i],
        to = bounds[i + 1]
      if (!(to > from + 1e-9)) continue
      const reason = stations
        .map((s, k) => (s.chainage >= from - 1e-9 && s.chainage <= to + 1e-9 ? lines[k] : null))
        .find((entry): entry is string => typeof entry === 'string')
      gaps.push({ from, to, reason: reason ?? 'only one complete section' })
    }
  }
  return { kind, pieces, gaps, verticalFaces }
}

function buildPiece(sections: { station: RoadStation; line: SectionVertex[] }[], toGrid: ToGrid): DesignSurfacePiece {
  const points: [number, number, number][] = []
  const ids = sections.map(({ station, line }) =>
    line.map((v) => {
      const [x, y] = toGrid(stationOffsetCoordinate(station, v.offset))
      points.push([x, y, v.z])
      return points.length - 1
    }),
  )
  const faces: [number, number, number][] = []
  let folded = 0
  for (let k = 1; k < sections.length; k++)
    for (const face of strip(sections[k - 1].line, sections[k].line)) {
      const tri = face.map(([which, i]) => ids[k - 1 + which][i]) as [number, number, number]
      const [p, q, r] = tri.map((i) => points[i])
      const area = ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2
      if (Math.abs(area) <= MIN_FACE_AREA_M2) continue
      if (area < 0) folded++
      faces.push(tri)
    }
  // Counter-clockwise: along the first section, up the right ends, back along the last, down the left ends.
  const firstIds = ids[0],
    lastIds = ids[ids.length - 1]
  const boundary = [
    ...firstIds,
    ...ids.slice(1, -1).map((row) => row[row.length - 1]),
    ...[...lastIds].reverse(),
    ...ids
      .slice(1, -1)
      .reverse()
      .map((row) => row[0]),
  ]
  return {
    from: sections[0].station.chainage,
    to: sections[sections.length - 1].station.chainage,
    points,
    faces,
    boundary,
    folded,
  }
}

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const num = (value: number, digits = 3) => {
  const text = value.toFixed(digits)
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}

/** Where the surface is and is not, in the road's own stations: the export's notice. */
export function designSurfaceNotice(surface: DesignSurface, alignment: Pick<Alignment, 'stationing'>): string {
  const at = (chainage: number) => formatStationLabel(chainage, alignment.stationing)
  const label = SURFACE_LABEL[surface.kind]
  const pieces = surface.pieces.map((p) => `${at(p.from)} to ${at(p.to)}`)
  const parts = [
    `${label} surface exported in ${pieces.length === 1 ? 'one piece' : `${pieces.length} pieces`}: ${pieces.join(', ')}.`,
  ]
  if (surface.gaps.length)
    parts.push(
      `No surface ${surface.gaps.map((g) => `from ${at(g.from)} to ${at(g.to)} (${g.reason})`).join(', ')}: incomplete sections are not bridged.`,
    )
  const folded = surface.pieces.reduce((sum, p) => sum + p.folded, 0)
  if (folded)
    parts.push(
      `${folded} face${folded === 1 ? ' folds' : 's fold'} over on the inside of a curve tighter than the section reaches.`,
    )
  return parts.join(' ')
}

/**
 * The surface as a LandXML 1.2 file: one `<Surface>` (TIN) per piece with its points, faces and outer
 * boundary, in the same CRS, units and vertical datum statement as the alignment's LandXML. Throws
 * when no stretch of the road has two complete sections in a row.
 */
export function designSurfaceLandXml({
  kind,
  name,
  alignment,
  analysis,
  terrain,
  toGrid,
  epsg,
  date = new Date(),
}: {
  kind: DesignSurfaceKind
  name: string
  alignment: Alignment
  analysis: RoadAnalysis
  terrain: TerrainMetadata
  toGrid: ToGrid
  epsg: number
  date?: Date
}): { xml: string; notice: string; surface: DesignSurface } {
  const surface = designSurface(kind, alignment, analysis, toGrid)
  if (!surface.pieces.length)
    throw Error(
      `${alignment.name} has no two complete sections in a row, so there is no ${SURFACE_LABEL[kind].toLowerCase()} surface to export.`,
    )
  const label = SURFACE_LABEL[kind]
  const at = (chainage: number) => formatStationLabel(chainage, alignment.stationing)
  const surfaces = surface.pieces
    .map((piece, index) => {
      const pnts = piece.points.map(([x, y, z], i) => `<P id="${i + 1}">${num(y)} ${num(x)} ${num(z)}</P>`).join('')
      const faces = piece.faces.map((f) => `<F>${f.map((i) => i + 1).join(' ')}</F>`).join('')
      const ring = [...piece.boundary, piece.boundary[0]]
        .map((i) => piece.points[i])
        .map(([x, y, z]) => `${num(y)} ${num(x)} ${num(z)}`)
        .join(' ')
      const pieceName = `${alignment.name} ${label}${surface.pieces.length > 1 ? ` part ${index + 1}` : ''}`
      return `    <Surface name="${xml(pieceName)}" desc="${xml(`${label}, ${at(piece.from)} to ${at(piece.to)}`)}">
      <SourceData>
        <Boundaries>
          <Boundary name="${xml(`${pieceName} outer`)}" bndType="outer" edgeTrim="true"><PntList3D>${ring}</PntList3D></Boundary>
        </Boundaries>
      </SourceData>
      <Definition surfType="TIN"><Pnts>${pnts}</Pnts><Faces>${faces}</Faces></Definition>
    </Surface>`
    })
    .join('\n')
  const pad = (v: number) => String(v).padStart(2, '0')
  const what =
    kind === 'subgrade'
      ? 'The subgrade: the design line of each calculated section (the profile is the subgrade).'
      : 'The finished surface: the top of the surfacing courses across the running surface, the subgrade beyond the formation edges.'
  const gaps = surface.gaps.length
    ? ` No surface ${surface.gaps.map((g) => `from ${at(g.from)} to ${at(g.to)} (${g.reason})`).join('; ')}: incomplete sections are never bridged.`
    : ''
  const steps = surface.verticalFaces
    ? ` ${surface.verticalFaces} vertical face${surface.verticalFaces === 1 ? ' is' : 's are'} drawn ${VERTICAL_FACE_INSET_M * 1000} mm wide, the upper point moved toward the centreline.`
    : ''
  const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}" time="${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}">
  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>
  <CoordinateSystem epsgCode="${epsg}" name="EPSG:${epsg}" verticalDatum="${xml(terrain.verticalReference)}"/>
  <Project name="${xml(name)}" desc="Preliminary planning geometry; not a construction design"/>
  <Application name="PG Maps forest road design" manufacturer="PG Maps" version="1"/>
  <!-- ${xml(what)} Points are grid northing, easting and level in EPSG:${epsg}, placed at each calculated station's section offsets (negative left looking up-station); faces join consecutive sections only, counter-clockwise seen from above, with each piece's outer boundary.${xml(gaps)}${xml(steps)} -->
  <Surfaces name="${xml(`${alignment.name} ${label}`)}">
${surfaces}
  </Surfaces>
</LandXML>
`
  return { xml: xmlText, notice: designSurfaceNotice(surface, alignment), surface }
}
