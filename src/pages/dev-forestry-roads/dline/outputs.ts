/**
 * What a D-line's CSV and HTML report carry beyond the profile: its supports and their stake-out
 * table, the multi-span load path of a current layout result, the rigging set it uses, and the
 * field-measured ground with its difference to the terrain. Every column is appended after the
 * existing ones and only when the line has the thing it reports, so a D-line without supports or
 * a field profile exports exactly as before. Pure: no DOM or network access.
 */
import { resolvedCableLine } from '../cableGeometry'
import type { CableLayoutResult } from '../cableLayout/cableLayout'
import { distance, offsetCoordinate } from '../engine'
import type { CableAnalysis, CableLine, Coordinate, TerrainSource } from '../types'
import {
  activeFieldShots,
  compareFieldProfile,
  FIELD_DIFFERENCE_FLAG_M,
  fieldElevationAt,
  type FieldComparison,
} from './fieldProfile'
import { bearingDeg, dLineFrame } from './frame'
import { matchingRiggingSet, type RiggingSet } from './riggingSets'
import { dLineSupports, supportStakeout, type DLineSupportSet, type StakeoutRow } from './supports'

export interface DLineExtras {
  supports: DLineSupportSet | null
  /** The current layout result, when the supports come from one. */
  layout: CableLayoutResult | null
  stakeout: { rows: StakeoutRow[]; epsg: number } | null
  field: {
    comparison: FieldComparison
    /** Per profile sample: the terrain under it, and whether the field shots gave its ground. */
    terrainM: (number | null)[]
    fromField: boolean[]
  } | null
  riggingSet: string | null
}

/**
 * Everything the exports add for one D-line. `terrain` is the terrain itself (not the line's field
 * ground); `analysis` is the profile calculated on the line's own ground.
 */
export function dLineExtras({
  line,
  analysis,
  terrain,
  ground,
  layout,
  grid,
  riggingSets,
}: {
  line: CableLine
  analysis: CableAnalysis
  terrain: TerrainSource
  ground: TerrainSource
  layout?: CableLayoutResult | null
  grid?: { epsg: number; toGrid: (coordinate: Coordinate) => [number, number] }
  riggingSets?: readonly RiggingSet[]
}): DLineExtras {
  const current = layout && layout.status !== 'no-layout' ? layout : null
  const supports = dLineSupports(line, { result: current, ground })
  const shots = activeFieldShots(line)
  const comparison = shots ? compareFieldProfile(line, terrain) : null
  let field: DLineExtras['field'] = null
  if (shots && comparison) {
    const resolved = resolvedCableLine(line)
    const frame = dLineFrame(line)!
    const heading = bearingDeg(resolved.start, resolved.end)
    const terrainM = analysis.samples.map((sample) => {
      const z = terrain.elevationAt(...offsetCoordinate(resolved.start, heading, sample.distance))
      return Number.isFinite(z) ? z : null
    })
    const length = distance(resolved.start, resolved.end)
    const fromField = analysis.samples.map(
      (sample) => fieldElevationAt(shots, frame.yarderAtEnd ? length - sample.distance : sample.distance) !== null,
    )
    field = { comparison, terrainM, fromField }
  }
  return {
    supports,
    layout: supports?.source === 'result' ? current : null,
    stakeout: supports && grid ? { rows: supportStakeout(supports, grid.toGrid), epsg: grid.epsg } : null,
    field,
    riggingSet: line.sagModel === 'mechanics' ? (matchingRiggingSet(riggingSets, line.rigging)?.name ?? null) : null,
  }
}

type Value = string | number | null

/** Interpolates a layout sample column at a station from the yarder. */
function layoutAt(layout: CableLayoutResult, stationM: number, key: 'loadM' | 'emptyM'): number | null {
  const s = layout.samples
  if (!s.length || stationM < s[0].stationM - 1e-6 || stationM > s.at(-1)!.stationM + 1e-6) return null
  let i = 1
  while (i < s.length - 1 && s[i].stationM < stationM) i++
  const a = s[i - 1],
    b = s[i] ?? a
  const za = a[key],
    zb = b[key]
  if (za === null || zb === null) return null
  const t = b.stationM > a.stationM ? (stationM - a.stationM) / (b.stationM - a.stationM) : 0
  return za + (zb - za) * Math.max(0, Math.min(1, t))
}

/** CSV headers appended after the existing D-line columns (and the mechanics columns). */
export function dLineCsvHeaders(extras: DLineExtras | undefined): string[] {
  if (!extras) return []
  return [
    ...(extras.riggingSet !== null ? ['rigging_set'] : []),
    ...(extras.supports
      ? [
          'support_layout_source',
          'support_layout_status',
          'support_layout_pre_tension_kn',
          'intermediate_supports',
          'supports_station_height_m',
        ]
      : []),
    ...(extras.layout
      ? ['layout_load_path_elevation_m', 'layout_empty_skyline_elevation_m', 'layout_load_clearance_m']
      : []),
    ...(extras.field ? ['ground_source', 'terrain_elevation_m', 'field_minus_terrain_m'] : []),
  ]
}

/** One profile sample's appended values, in `dLineCsvHeaders` order. */
export function dLineCsvValues(
  extras: DLineExtras | undefined,
  analysis: CableAnalysis,
  index: number,
  yarderAtEnd: boolean,
): Value[] {
  if (!extras) return []
  const sample = analysis.samples[index]
  const station = yarderAtEnd ? analysis.length - sample.distance : sample.distance
  const out: Value[] = []
  if (extras.riggingSet !== null) out.push(extras.riggingSet)
  if (extras.supports) {
    const s = extras.supports
    out.push(
      s.source,
      s.status,
      s.preTensionKN,
      s.intermediate,
      s.rows
        .filter((r) => r.kind !== 'anchor')
        .map((r) => `${r.stationM.toFixed(1)}@${r.heightM.toFixed(1)}`)
        .join(';'),
    )
  }
  if (extras.layout) {
    const load = layoutAt(extras.layout, station, 'loadM')
    out.push(
      load,
      layoutAt(extras.layout, station, 'emptyM'),
      load === null || sample.ground === null ? null : load - sample.ground,
    )
  }
  if (extras.field) {
    const terrainM = extras.field.terrainM[index]
    const fromField = extras.field.fromField[index]
    out.push(
      fromField ? 'field' : 'terrain',
      terrainM,
      fromField && terrainM !== null && sample.ground !== null ? sample.ground - terrainM : null,
    )
  }
  return out
}

const html = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'Unknown' : value.toFixed(digits)
const dash = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(digits)

export const STAKEOUT_NOTE =
  'Stations are horizontal from the yarder along the D-line; every support stands on the line (offset 0). ' +
  'Ground is the D-line’s own ground (the field profile where one is used), not a survey of the stake. ' +
  'Saddle elevation is ground plus support height. Check each site on the ground before it is rigged.'

/** Sections appended to the D-line HTML report, after the sample schedule. Empty when there are none. */
export function dLineExtrasHtml(extras: DLineExtras | undefined): string {
  if (!extras) return ''
  const parts: string[] = []
  if (extras.riggingSet !== null)
    parts.push(`<h2>Rigging set</h2><p>${html(extras.riggingSet)} (the project&rsquo;s own set; not a rating).</p>`)
  const s = extras.supports
  if (s) {
    const sourceText =
      s.source === 'result'
        ? 'From the support layout found or checked for the D-line as it is now.'
        : 'From the layout saved on the D-line; it has not been checked against the D-line as it is now, so no forces or angles are given.'
    parts.push(
      `<h2>Intermediate supports</h2><p>${s.status === 'complete' ? 'Complete layout' : 'Layout stops short of the far end'} · ${s.intermediate} intermediate support${s.intermediate === 1 ? '' : 's'} · pre-tension ${fmt(s.preTensionKN, 0)} kN. ${sourceText}</p>` +
        `<table><thead><tr><th>Support</th><th>Station from yarder (m)</th><th>Ground (m)</th><th>Height (m)</th><th>Saddle elevation (m)</th><th>Break empty / loaded (°)</th><th>Max force (kN)</th></tr></thead><tbody>${s.rows
          .map(
            (r) =>
              `<tr><td>${html(`${r.label} · ${r.name}${r.fixed ? ' (fixed)' : ''}`)}</td><td>${fmt(r.stationM, 1)}</td><td>${fmt(r.groundM)}</td><td>${fmt(r.heightM, 1)}</td><td>${fmt(r.saddleM)}</td><td>${r.emptyBreakDeg === null ? '–' : `${dash(r.emptyBreakDeg)} / ${dash(r.loadedBreakDeg)}`}</td><td>${dash(r.maxForceKN)}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    )
  }
  if (extras.stakeout) {
    const { rows, epsg } = extras.stakeout
    parts.push(
      `<h2>Support stake-out</h2><p class="muted">${STAKEOUT_NOTE} Grid coordinates are EPSG:${epsg}; geographic coordinates are WGS84.</p>` +
        `<table><thead><tr><th>Point</th><th>Support</th><th>Station (m)</th><th>Offset (m)</th><th>Easting</th><th>Northing</th><th>Longitude</th><th>Latitude</th><th>Ground (m)</th><th>Height (m)</th><th>Saddle (m)</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${r.point}</td><td>${html(`${r.label} · ${r.name}`)}</td><td>${fmt(r.stationM, 1)}</td><td>${fmt(r.offsetM, 1)}</td><td>${fmt(r.easting, 2)}</td><td>${fmt(r.northing, 2)}</td><td>${fmt(r.longitude, 7)}</td><td>${fmt(r.latitude, 7)}</td><td>${fmt(r.groundM)}</td><td>${fmt(r.heightM, 1)}</td><td>${fmt(r.saddleM)}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    )
  }
  if (extras.field) {
    const c = extras.field.comparison
    parts.push(
      `<h2>Field-measured ground</h2><p>The profile above uses field shots from ${fmt(c.coveredFromM, 1)} to ${fmt(c.coveredToM, 1)} m from the yarder in place of the terrain${c.coversLine ? '' : `; outside that range, on this ${fmt(c.lengthM, 1)} m line, the terrain is used`}. Field minus terrain over ${c.compared} shot${c.compared === 1 ? '' : 's'}: mean ${fmt(c.meanDifferenceM)} m, RMS ${fmt(c.rmsDifferenceM)} m, largest ${fmt(c.largestDifferenceM)} m at ${fmt(c.largestAtM, 1)} m; ${c.flagged} shot${c.flagged === 1 ? '' : 's'} differ by more than ${FIELD_DIFFERENCE_FLAG_M} m.</p>` +
        `<table><thead><tr><th>Station from yarder (m)</th><th>Field (m)</th><th>Terrain (m)</th><th>Field − terrain (m)</th></tr></thead><tbody>${c.rows
          .map(
            (r) =>
              `<tr><td>${fmt(r.stationM, 1)}</td><td>${fmt(r.elevationM)}</td><td>${fmt(r.terrainM)}</td><td>${fmt(r.differenceM)}${r.flagged ? ' ⚑' : ''}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    )
  }
  return parts.join('')
}
