/**
 * What the haul plan looks like drawn along the road, as RoadEng draws it under a profile: the mass
 * curve shaded by haul class with the direction material moves, and a haul diagram where each
 * movement is a band from where it is dug to where it is placed, as thick as its volume.
 *
 * Both read only the allocation's own movements (`RoadEngineeringSummary.movements`) and the curve
 * the mass-haul chart already draws; neither feeds a quantity, a cost or an export. No DOM: the
 * chart draws these numbers and the tests check them.
 */
import type { HaulMovement } from './engineeringTypes'

const EPS = 1e-7

export type HaulClass = HaulMovement['category']
export const HAUL_CLASS_ORDER: readonly HaulClass[] = ['freehaul', 'overhaul', 'endhaul']

/** One class's share of the curve over one stretch: a trapezoid from `from` to `to` of the ordinate. */
export interface HaulShadePart {
  category: HaulClass | 'unassigned'
  /** Fractions of the ordinate, 0 at the zero line and 1 on the curve. */
  from: number
  to: number
}

/** A stretch of the curve between two of its vertices that does not cross zero. */
export interface HaulShadeSegment {
  x0: number
  y0: number
  x1: number
  y1: number
  parts: HaulShadePart[]
}

/** Volume a movement carries in the compacted m³ the mass curve is drawn in, where it is known. */
const curveVolume = (m: HaulMovement) => m.compactedVolumeM3 ?? m.transportedVolumeM3

/**
 * Movements that carry material along the road past `chainage` in direction `sign` (+1 up-station).
 * Sidecast and unresolved external parcels never travel along the road.
 */
function crossing(movements: readonly HaulMovement[], chainage: number, sign: 1 | -1) {
  return movements.filter((m) => {
    if (m.disposalMethod === 'sidecast' || m.externalUnresolved) return false
    const up = m.toChainage > m.fromChainage
    if ((up ? 1 : -1) !== sign) return false
    const lo = Math.min(m.fromChainage, m.toChainage),
      hi = Math.max(m.fromChainage, m.toChainage)
    return lo < chainage && chainage < hi && hi - lo > EPS
  })
}

/**
 * The mass curve shaded by haul class. The ordinate at a station is the net material crossing it
 * (positive moving up-station), so each stretch is split between the classes of the movements that
 * cross its middle in that direction, each taking its volume's share of the ordinate from the zero
 * line out. What no movement accounts for (surplus or deficit with no site, carried on) is
 * `unassigned`, nearest the curve.
 *
 * `line` is the curve the chart draws: the balance after borrow and waste when sites took some, else
 * the balance itself. A vertical step (a pit) has no width and gets no segment.
 */
export function haulShading(
  line: readonly (readonly [number, number])[],
  movements: readonly HaulMovement[],
): HaulShadeSegment[] {
  const segments: HaulShadeSegment[] = []
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 - x0 <= EPS) return
    const sign = y0 + y1 >= 0 ? 1 : -1
    if (Math.abs(y0) <= EPS && Math.abs(y1) <= EPS) return
    const flows = crossing(movements, (x0 + x1) / 2, sign)
    const moved = flows.reduce((sum, m) => sum + curveVolume(m), 0)
    // The ordinate counts surplus carried on with no site as well as what the plan moves, so a class
    // takes only its own volume's share of it; the rest stays unassigned. Where crossing flows exceed
    // the net (two materials passing), the classes share the whole ordinate.
    const total = Math.max(moved, Math.abs((y0 + y1) / 2))
    const parts: HaulShadePart[] = []
    let at = 0
    if (total > EPS)
      for (const category of HAUL_CLASS_ORDER) {
        const share = flows.filter((m) => m.category === category).reduce((sum, m) => sum + curveVolume(m), 0) / total
        if (share <= EPS) continue
        parts.push({ category, from: at, to: Math.min(1, at + share) })
        at += share
      }
    if (at < 1 - EPS) parts.push({ category: 'unassigned', from: at, to: 1 })
    segments.push({ x0, y0, x1, y1, parts })
  }
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1],
      [x1, y1] = line[i]
    if (y0 * y1 < 0) {
      // Split where the curve crosses zero, so a stretch never straddles both directions.
      const xz = x0 + ((x1 - x0) * y0) / (y0 - y1)
      add(x0, y0, xz, 0)
      add(xz, 0, x1, y1)
    } else add(x0, y0, x1, y1)
  }
  return segments
}

/** A run of the curve on one side of zero: material in it moves one way. */
export interface HaulDirectionRun {
  start: number
  end: number
  /** +1: net haul up-station (curve above zero); −1: down-station. */
  sign: 1 | -1
  /** Where the run is farthest from zero, and that ordinate. */
  peakChainage: number
  peakM3: number
}

/**
 * Where the net haul runs one way, for the chart's direction arrows. Runs whose peak is under
 * `minPeakM3` (a curve hugging zero) are left out.
 */
export function haulDirectionRuns(line: readonly (readonly [number, number])[], minPeakM3 = 0): HaulDirectionRun[] {
  // The curve with a vertex added wherever it crosses zero, so every run starts and ends on zero
  // (or at the road's ends).
  const points: [number, number][] = []
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i]
    if (i > 0) {
      const [px, py] = line[i - 1]
      if (py * y < 0) points.push([px + ((x - px) * py) / (py - y), 0])
    }
    points.push([x, y])
  }
  const runs: HaulDirectionRun[] = []
  let current: HaulDirectionRun | null = null
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]
    const sign = y > EPS ? 1 : y < -EPS ? -1 : 0
    if (sign !== 0 && !current) {
      // A run starts at the zero just before it, or at the road's start.
      const start = i > 0 && Math.abs(points[i - 1][1]) <= EPS ? points[i - 1][0] : x
      current = { start, end: x, sign, peakChainage: x, peakM3: y }
    }
    if (!current) continue
    if (sign === current.sign) {
      current.end = x
      if (Math.abs(y) > Math.abs(current.peakM3)) {
        current.peakChainage = x
        current.peakM3 = y
      }
    } else {
      current.end = x
      if (Math.abs(current.peakM3) > Math.max(EPS, minPeakM3)) runs.push(current)
      current = null
      if (sign !== 0) i-- // this vertex starts the next run
    }
  }
  if (current && Math.abs(current.peakM3) > Math.max(EPS, minPeakM3)) runs.push(current)
  return runs
}

/** One row of the haul diagram: a haul class, or the material sidecast beside the road. */
export type HaulDiagramRowKey = HaulClass | 'sidecast'
export const HAUL_DIAGRAM_ROW_LABELS: Record<HaulDiagramRowKey, string> = {
  freehaul: 'Free haul',
  overhaul: 'Overhaul',
  endhaul: 'End haul',
  sidecast: 'Sidecast',
}

export interface HaulDiagramBand {
  movement: HaulMovement
  /** Lane within its row, 0 at the top; bands in one lane never overlap along the road. */
  lane: number
  start: number
  end: number
  /** +1 when material moves up-station. */
  direction: 1 | -1
  /** Band thickness as a share of the thickest band in the diagram, 0–1. */
  weight: number
}

export interface HaulDiagramRow {
  key: HaulDiagramRowKey
  label: string
  lanes: number
  bands: HaulDiagramBand[]
  /** Volume in the row: compacted m³ (cut-to-fill and borrow) and bank m³ (waste), never added. */
  compactedM3: number
  bankM3: number
}

export interface HaulDiagramPit {
  siteId: string
  kind: 'borrow' | 'waste'
  chainage: number
}

export interface HaulDiagram {
  rows: HaulDiagramRow[]
  pits: HaulDiagramPit[]
  /** Movements drawn overlapping in their row's last lane because the row ran out of lanes. */
  folded: number
  /** Material ids present, in first-seen order, for the material filter (null: no material named). */
  materials: (string | null)[]
}

/** The most lanes one row of the haul diagram stacks before folding the rest into its last lane. */
export const HAUL_DIAGRAM_MAX_LANES = 6

/**
 * The haul diagram (RoadEng's Opti-Haul diagram): each movement a band from its source station to
 * its destination, in the row of its haul class (sidecast in its own row), packed into lanes so
 * bands in a lane do not overlap. Borrow starts at its site's access station and waste ends at
 * its own; those stations are returned as pits. `materialId` keeps only that material's movements
 * (`undefined` keeps all; `null` keeps those with no material named).
 */
export function haulDiagram(
  movements: readonly HaulMovement[],
  { materialId, minLengthM = 0 }: { materialId?: string | null; minLengthM?: number } = {},
): HaulDiagram {
  const materials: (string | null)[] = []
  for (const m of movements)
    if (!m.externalUnresolved && !materials.includes(m.materialId)) materials.push(m.materialId)
  const kept = movements.filter(
    (m) => !m.externalUnresolved && (materialId === undefined || m.materialId === materialId),
  )
  const maxVolume = Math.max(EPS, ...kept.map((m) => m.transportedVolumeM3))
  let folded = 0
  const rows: HaulDiagramRow[] = []
  for (const key of [...HAUL_CLASS_ORDER, 'sidecast'] as const) {
    const inRow = kept
      .filter((m) =>
        key === 'sidecast' ? m.disposalMethod === 'sidecast' : m.disposalMethod !== 'sidecast' && m.category === key,
      )
      .map((m) => {
        const lo = Math.min(m.fromChainage, m.toChainage),
          hi = Math.max(m.fromChainage, m.toChainage)
        // A movement shorter than `minLengthM` (sidecast moves across the road, not along it) is
        // widened about its middle so it still shows.
        const pad = Math.max(0, (minLengthM - (hi - lo)) / 2)
        return { m, start: lo - pad, end: hi + pad }
      })
      .sort((a, b) => a.start - b.start || b.m.transportedVolumeM3 - a.m.transportedVolumeM3)
    if (!inRow.length) continue
    const laneEnds: number[] = []
    const bands: HaulDiagramBand[] = inRow.map(({ m, start, end }) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start + EPS)
      if (lane < 0) {
        if (laneEnds.length < HAUL_DIAGRAM_MAX_LANES) lane = laneEnds.push(end) - 1
        else {
          lane = HAUL_DIAGRAM_MAX_LANES - 1
          folded++
        }
      }
      laneEnds[lane] = Math.max(laneEnds[lane] ?? end, end)
      return {
        movement: m,
        lane,
        start,
        end,
        direction: m.toChainage >= m.fromChainage ? 1 : -1,
        weight: m.transportedVolumeM3 / maxVolume,
      }
    })
    rows.push({
      key,
      label: HAUL_DIAGRAM_ROW_LABELS[key],
      lanes: laneEnds.length,
      bands,
      compactedM3: inRow
        .filter(({ m }) => m.volumeBasis === 'compacted')
        .reduce((s, { m }) => s + m.transportedVolumeM3, 0),
      bankM3: inRow.filter(({ m }) => m.volumeBasis === 'bank').reduce((s, { m }) => s + m.transportedVolumeM3, 0),
    })
  }
  const pits = new Map<string, HaulDiagramPit>()
  for (const m of kept) {
    if (m.kind === 'borrow')
      pits.set(`b-${m.sourceId}`, { siteId: m.sourceId, kind: 'borrow', chainage: m.fromChainage })
    else if (m.kind === 'waste' && m.disposalMethod !== 'sidecast')
      pits.set(`w-${m.targetId}`, { siteId: m.targetId, kind: 'waste', chainage: m.toChainage })
  }
  return { rows, pits: [...pits.values()].sort((a, b) => a.chainage - b.chainage), folded, materials }
}
