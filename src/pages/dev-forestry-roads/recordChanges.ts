/**
 * A record of changes between the design as issued and the road as built or surveyed, for record
 * drawings (Engineering Manual §5.2.4; EGBC/FPBC Forest Roads §3.9.2, which allows anything from
 * annotations on the original design to a full post-construction survey). The issued design is kept
 * as a copy of the road in the project; the record is the road edited to the field record. This
 * compares the two and lists what moved; it decides nothing about conformance. No DOM or network access.
 */
import type { Alignment, Coordinate, RoadAnalysis, RoadStation } from './types'

/** Plan shifts and level changes smaller than these are not listed as changes. */
export const RECORD_PLAN_TOLERANCE_M = 0.5
export const RECORD_LEVEL_TOLERANCE_M = 0.1
/** Where the comparison samples the record road. */
export const RECORD_SAMPLE_M = 10

export interface RecordRow {
  item: string
  issued: string
  record: string
  change: string
}
export interface RecordStretch {
  start: number
  end: number
  /** Largest plan shift or level change in the stretch, metres. */
  maxM: number
}
export interface RecordChanges {
  rows: RecordRow[]
  /** Stretches of the record road more than the tolerance off the issued centreline. */
  planShifts: RecordStretch[]
  /** Stretches whose formation differs from the issued one by more than the tolerance (signed max). */
  levelChanges: RecordStretch[]
  culverts: { name: string; change: string }[]
}

const R = 6371008.8,
  RAD = Math.PI / 180
/** Local metres about a latitude: good to well under a centimetre over a road's length. */
function planar(lat0: number) {
  const k = Math.cos(lat0 * RAD) * RAD * R
  return (c: Coordinate): [number, number] => [c[0] * k, c[1] * RAD * R]
}

function distanceToPolyline(p: [number, number], line: [number, number][]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1],
      [bx, by] = line[i]
    const dx = bx - ax,
      dy = by - ay
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy))) : 0
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
  }
  return best
}

function designAt(stations: readonly RoadStation[], chainage: number): number | null {
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i]
    if (chainage < a.chainage - 1e-6 || chainage > b.chainage + 1e-6) continue
    if (a.designElevation == null || b.designElevation == null) return null
    const t = b.chainage > a.chainage ? (chainage - a.chainage) / (b.chainage - a.chainage) : 0
    return a.designElevation + t * (b.designElevation - a.designElevation)
  }
  return null
}

function stretches(samples: { chainage: number; value: number | null }[], tolerance: number): RecordStretch[] {
  const out: RecordStretch[] = []
  let open: RecordStretch | null = null
  for (const s of samples) {
    if (s.value !== null && Math.abs(s.value) > tolerance) {
      if (!open) out.push((open = { start: s.chainage, end: s.chainage, maxM: s.value }))
      open.end = s.chainage
      if (Math.abs(s.value) > Math.abs(open.maxM)) open.maxM = s.value
    } else open = null
  }
  return out
}

const m = (v: number, d = 1) => `${v.toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d })} m`
const m3 = (v: number) => `${Math.round(v).toLocaleString('en-CA')} m³`
const delta = (a: number, b: number, unit: (v: number) => string) => {
  const d = b - a
  return Math.abs(d) < 1e-9 ? 'No change' : `${d > 0 ? '+' : '−'}${unit(Math.abs(d))}`
}

export function recordChanges(
  issued: { alignment: Alignment; analysis: RoadAnalysis },
  record: { alignment: Alignment; analysis: RoadAnalysis },
): RecordChanges {
  const lat0 = record.analysis.stations[0]?.coordinate[1] ?? issued.analysis.stations[0]?.coordinate[1] ?? 0
  const xy = planar(lat0)
  const issuedLine = issued.analysis.centerline.map(xy)
  const samples = record.analysis.stations.filter(
    (s, i, all) =>
      i === 0 ||
      i === all.length - 1 ||
      Math.floor(s.chainage / RECORD_SAMPLE_M) !== Math.floor(all[i - 1].chainage / RECORD_SAMPLE_M),
  )
  const plan = samples.map((s) => ({
    chainage: s.chainage,
    value: issuedLine.length > 1 ? distanceToPolyline(xy(s.coordinate), issuedLine) : null,
  }))
  const level = samples.map((s) => {
    const before = designAt(issued.analysis.stations, s.chainage)
    return {
      chainage: s.chainage,
      value: before === null || s.designElevation == null ? null : s.designElevation - before,
    }
  })
  const a = issued.analysis,
    b = record.analysis
  const rows: RecordRow[] = [
    { item: 'Length', issued: m(a.length), record: m(b.length), change: delta(a.length, b.length, m) },
    {
      item: 'Horizontal points',
      issued: String(issued.alignment.points.length),
      record: String(record.alignment.points.length),
      change: delta(issued.alignment.points.length, record.alignment.points.length, String),
    },
    {
      item: 'Vertical points',
      issued: String(issued.alignment.vertical.length),
      record: String(record.alignment.vertical.length),
      change: delta(issued.alignment.vertical.length, record.alignment.vertical.length, String),
    },
    {
      item: 'Cut',
      issued: m3(a.cutVolumeM3),
      record: m3(b.cutVolumeM3),
      change: delta(a.cutVolumeM3, b.cutVolumeM3, m3),
    },
    {
      item: 'Fill',
      issued: m3(a.fillVolumeM3),
      record: m3(b.fillVolumeM3),
      change: delta(a.fillVolumeM3, b.fillVolumeM3, m3),
    },
    {
      item: 'Clearing',
      issued: `${(a.clearingAreaM2 / 10000).toFixed(2)} ha`,
      record: `${(b.clearingAreaM2 / 10000).toFixed(2)} ha`,
      change: delta(a.clearingAreaM2 / 10000, b.clearingAreaM2 / 10000, (v) => `${v.toFixed(2)} ha`),
    },
    {
      item: 'Steepest grade',
      issued: `${a.maxGradePercent.toFixed(1)}%`,
      record: `${b.maxGradePercent.toFixed(1)}%`,
      change: delta(a.maxGradePercent, b.maxGradePercent, (v) => `${v.toFixed(1)}%`),
    },
  ]
  const before = new Map((issued.alignment.engineering?.culverts ?? []).map((c) => [c.id, c]))
  const after = new Map((record.alignment.engineering?.culverts ?? []).map((c) => [c.id, c]))
  const culverts: RecordChanges['culverts'] = []
  for (const [id, c] of after) {
    const old = before.get(id) ?? [...before.values()].find((o) => o.name && o.name === c.name)
    if (!old) {
      culverts.push({ name: c.name, change: `Added at ${m(c.chainage)}, ${Math.round(c.diameterM * 1000)} mm` })
      continue
    }
    before.delete(old.id)
    const parts: string[] = []
    if (Math.abs(c.chainage - old.chainage) > 1) parts.push(`moved ${m(old.chainage)} → ${m(c.chainage)}`)
    if (Math.abs(c.diameterM - old.diameterM) > 1e-6)
      parts.push(`${Math.round(old.diameterM * 1000)} → ${Math.round(c.diameterM * 1000)} mm`)
    if (Math.abs(c.lengthM - old.lengthM) > 0.05) parts.push(`length ${m(old.lengthM)} → ${m(c.lengthM)}`)
    if (parts.length) culverts.push({ name: c.name, change: parts.join('; ') })
  }
  for (const c of before.values()) culverts.push({ name: c.name, change: `Removed (was at ${m(c.chainage)})` })
  return {
    rows,
    planShifts: stretches(plan, RECORD_PLAN_TOLERANCE_M),
    levelChanges: stretches(level, RECORD_LEVEL_TOLERANCE_M),
    culverts,
  }
}
