/**
 * A D-line's supports as the plan, the exports and the D-line sheet show them: from the support
 * layout's current result where there is one (with ground, forces and anchors), else from the
 * layout saved on the line (stations and heights; ground read from the line's own ground). Also
 * the stake-out table: each support's ground point in the project grid and in longitude/latitude.
 * Pure: no DOM or network access.
 */
import { intermediateSupports, type CableLayoutResult, type LayoutSupportKind } from '../cableLayout/cableLayout'
import { DEFAULT_SUPPORT_LAYOUT } from '../cableLayout/settings'
import type { CableLine, Coordinate, TerrainSource } from '../types'
import { dLineFrame, type DLineFrame } from './frame'

export interface DLineSupportRow {
  /** Short label on the chart, plan and sheet: Y yarder, S start support, 1… intermediate, E end, A anchor. */
  label: string
  /** The label in words. */
  name: string
  kind: LayoutSupportKind
  /** From the yarder, m; anchors behind the yarder are negative. */
  stationM: number
  /** Saddle (or tower top) height above the ground, m. */
  heightM: number
  groundM: number | null
  /** Ground + height: the saddle's elevation, m. */
  saddleM: number | null
  fixed: boolean
  coordinate: Coordinate
  /** From a current result only. */
  emptyBreakDeg: number | null
  loadedBreakDeg: number | null
  maxForceKN: number | null
}

export interface DLineSupportSet {
  /** `result`: the support search or check that is current for the line; `saved`: the layout saved on it. */
  source: 'result' | 'saved'
  status: 'complete' | 'incomplete'
  preTensionKN: number | null
  rows: DLineSupportRow[]
  intermediate: number
}

function labelled(
  supports: { kind: LayoutSupportKind; stationM: number }[],
  middle: Set<number>,
): { label: string; name: string }[] {
  let n = 0
  return supports.map((s, i) => {
    if (middle.has(i)) {
      n++
      return { label: String(n), name: `Support ${n}` }
    }
    if (s.kind === 'yarder') return { label: 'Y', name: 'Yarder' }
    if (s.kind === 'anchor') return { label: 'A', name: s.stationM < 0 ? 'Anchor behind the start' : 'Anchor' }
    const start = i === 0 || supports[i - 1].kind === 'anchor'
    return start
      ? { label: 'S', name: s.kind === 'ground-anchor' ? 'Start ground anchor' : 'Start support' }
      : { label: 'E', name: s.kind === 'ground-anchor' ? 'End ground anchor' : 'End support' }
  })
}

const finiteOrNull = (v: number) => (Number.isFinite(v) ? v : null)

/**
 * The D-line's supports, or null when it has no layout to show. `result` is the layout result that
 * is current for this line (it wins over the saved layout); `ground` is the ground the line reads.
 */
export function dLineSupports(
  line: CableLine,
  options: { result?: CableLayoutResult | null; ground?: TerrainSource } = {},
): DLineSupportSet | null {
  const frame = dLineFrame(line)
  if (!frame) return null
  const { result, ground } = options
  if (result && result.status !== 'no-layout' && result.supports.length) {
    const middleSupports = new Set(intermediateSupports(result))
    const middle = new Set(result.supports.flatMap((s, i) => (middleSupports.has(s) ? [i] : [])))
    const names = labelled(result.supports, middle)
    return {
      source: 'result',
      status: result.status,
      preTensionKN: result.preTensionKN,
      intermediate: middle.size,
      rows: result.supports.map((s, i) => ({
        ...names[i],
        kind: s.kind,
        stationM: s.stationM,
        heightM: s.heightM,
        groundM: finiteOrNull(s.groundM),
        saddleM: Number.isFinite(s.groundM) ? s.groundM + s.heightM : null,
        fixed: s.fixed,
        coordinate: frame.at(s.stationM),
        emptyBreakDeg: s.emptyBreakDeg,
        loadedBreakDeg: s.loadedBreakDeg,
        maxForceKN: s.maxForceKN,
      })),
    }
  }
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  const saved = line.supportLayout?.saved
  if (!saved || saved.supports.length < 2) return null
  const last = saved.supports.length - 1
  const kinds = saved.supports.map((_, i): LayoutSupportKind => {
    if (i === 0)
      return settings.startKind === 'yarder' ? 'yarder' : settings.startKind === 'anchor' ? 'ground-anchor' : 'support'
    if (i === last && saved.complete) return settings.endKind === 'anchor' ? 'ground-anchor' : 'support'
    return 'support'
  })
  const middle = new Set(saved.supports.flatMap((_, i) => (i > 0 && (i < last || !saved.complete) ? [i] : [])))
  const names = labelled(
    saved.supports.map((s, i) => ({ kind: kinds[i], stationM: s.stationM })),
    middle,
  )
  return {
    source: 'saved',
    status: saved.complete ? 'complete' : 'incomplete',
    preTensionKN: saved.preTensionKN,
    intermediate: middle.size,
    rows: saved.supports.map((s, i) => {
      // The ends follow the line as it is now, as a check of the saved layout does.
      const heightM = i === 0 && kinds[0] === 'yarder' ? line.startHeight : kinds[i] === 'ground-anchor' ? 0 : s.heightM
      const coordinate = frame.at(s.stationM)
      const groundM = ground ? finiteOrNull(ground.elevationAt(...coordinate)) : null
      return {
        ...names[i],
        kind: kinds[i],
        stationM: s.stationM,
        heightM,
        groundM,
        saddleM: groundM === null ? null : groundM + heightM,
        fixed: settings.fixedSupports.some((f) => Math.abs(f.stationM - s.stationM) < 0.5),
        coordinate,
        emptyBreakDeg: null,
        loadedBreakDeg: null,
        maxForceKN: null,
      }
    }),
  }
}

export interface StakeoutRow {
  point: number
  label: string
  name: string
  stationM: number
  /** Always 0: supports stand on the D-line. */
  offsetM: number
  easting: number
  northing: number
  longitude: number
  latitude: number
  groundM: number | null
  heightM: number
  saddleM: number | null
}

/** One stake per support or anchor, in station order, with grid and geographic coordinates. */
export function supportStakeout(
  set: DLineSupportSet,
  toGrid: (coordinate: Coordinate) => [number, number],
): StakeoutRow[] {
  return [...set.rows]
    .sort((a, b) => a.stationM - b.stationM)
    .map((row, i) => {
      const [easting, northing] = toGrid(row.coordinate)
      return {
        point: i + 1,
        label: row.label,
        name: row.name,
        stationM: row.stationM,
        offsetM: 0,
        easting,
        northing,
        longitude: row.coordinate[0],
        latitude: row.coordinate[1],
        groundM: row.groundM,
        heightM: row.heightM,
        saddleM: row.saddleM,
      }
    })
}

const STAKEOUT_COLUMNS = [
  'point',
  'd_line',
  'label',
  'support',
  'station_from_yarder_m',
  'offset_m',
  'easting',
  'northing',
  'epsg',
  'longitude',
  'latitude',
  'ground_elevation_m',
  'support_height_m',
  'saddle_elevation_m',
  'layout_source',
] as const

const cell = (v: string | number | null, digits = 3) => {
  if (v === null || (typeof v === 'number' && !Number.isFinite(v))) return ''
  if (typeof v === 'number') return v.toFixed(digits)
  const guarded = /^\s*[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** The stake-out table as CSV, numbers only beside a guarded D-line name. */
export function supportStakeoutCsv(lineName: string, set: DLineSupportSet, rows: StakeoutRow[], epsg: number): string {
  const out = [STAKEOUT_COLUMNS.join(',')]
  for (const r of rows)
    out.push(
      [
        String(r.point),
        cell(lineName),
        cell(r.label),
        cell(r.name),
        cell(r.stationM, 2),
        cell(r.offsetM, 2),
        cell(r.easting),
        cell(r.northing),
        String(epsg),
        cell(r.longitude, 8),
        cell(r.latitude, 8),
        cell(r.groundM, 2),
        cell(r.heightM, 2),
        cell(r.saddleM, 2),
        set.source,
      ].join(','),
    )
  return out.join('\n') + '\n'
}

export const DLINE_SUPPORT_COLOR = '#6d28d9'

/**
 * Plan dots for every D-line's saved intermediate supports, labelled on hover. A click hands back
 * the D-line and the support's chart distance (`cableId`, `chartDistance`).
 */
export function dLineSupportPlanFeatures(cables: readonly CableLine[]): GeoJSON.Feature<GeoJSON.Point>[] {
  const out: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const line of cables) {
    const set = dLineSupports(line)
    const frame: DLineFrame | null = set ? dLineFrame(line) : null
    if (!set || !frame) continue
    for (const row of set.rows) {
      if (!/^\d+$/.test(row.label)) continue
      out.push({
        type: 'Feature',
        id: `dline-support-${line.id}-${row.label}`,
        geometry: { type: 'Point', coordinates: row.coordinate },
        properties: {
          kind: 'dline-support',
          marker: 'dot',
          color: DLINE_SUPPORT_COLOR,
          cableId: line.id,
          chartDistance: frame.chartDistance(row.stationM),
          label: `${line.name} · support ${row.label} · ${row.stationM.toFixed(0)} m from the yarder · ${row.heightM.toFixed(1)} m tall${row.fixed ? ' (fixed)' : ''}`,
        },
      })
    }
  }
  return out
}
