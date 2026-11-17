/**
 * The builder's schedules read from `stationExtras.ts`: the slope-stake book (Engineering Manual
 * §5.6.5, Table 5-10) and the station-by-station clearing-width schedule (§3.5.3 asks for clearing
 * widths "generally tabular"). Their rows and CSVs; no DOM or network access.
 */
import { csvRows } from '@pgmaps/geo-toolkit/export'
import { horizontalCurveSummary, nearestStation, verticalCurveSummary } from './engine'
import { refuseInvalidResults } from './inputErrors'
import { formatStationLabel, hasStationing, type RoadStationing } from './roadStationing'
import {
  STAKE_REASON_TEXT,
  stakeStations,
  type StakeReason,
  type StakeStation,
  type StationExtra,
} from './stationExtras'
import type { Alignment, RoadAnalysis, RoadStation } from './types'

/** Curve points and culverts the stake book stakes, as Table 5-10 lists them. */
export function stakeControlPoints(alignment: Alignment): { chainage: number; reason: StakeReason }[] {
  const points: { chainage: number; reason: StakeReason }[] = []
  try {
    for (const c of horizontalCurveSummary(alignment))
      points.push({ chainage: c.fullStart, reason: 'BC' }, { chainage: c.fullEnd, reason: 'EC' })
  } catch {
    /* Invalid intermediate geometry is reported by the workspace. */
  }
  try {
    for (const c of verticalCurveSummary(alignment))
      if (c && c.end > c.start) points.push({ chainage: c.start, reason: 'BVC' }, { chainage: c.end, reason: 'EVC' })
  } catch {
    /* As above. */
  }
  for (const culvert of alignment.engineering?.culverts ?? [])
    points.push({ chainage: culvert.chainage, reason: 'culvert' })
  return points
}

export function slopeStakeBook(alignment: Alignment, analysis: RoadAnalysis, extras: StationExtra[], intervalM = 20) {
  return stakeStations(analysis, extras, stakeControlPoints(alignment), intervalM)
}

/** A stake as written on the lath: C or F, the height to the hinge, and the distance out. */
export function stakeText(side: StakeStation['extra']['catch']['left']) {
  if (!side) return '—'
  const out = side.offsetM.toFixed(1)
  if (side.cutFillM === null) return `? / ${out}`
  return `${side.cutFillM >= 0 ? 'C' : 'F'} ${Math.abs(side.cutFillM).toFixed(1)} / ${out}`
}

const label = (chainage: number, stationing?: RoadStationing | null) =>
  hasStationing(stationing) ? formatStationLabel(chainage, stationing, 3) : chainage.toFixed(3)
const cell = (v: number | null | undefined, decimals = 3) =>
  v == null || !Number.isFinite(v) ? '' : Number(v.toFixed(decimals))

export function slopeStakeCsv(
  analysis: RoadAnalysis,
  rows: StakeStation[],
  stationing?: RoadStationing | null,
  epsg?: number | null,
): string {
  refuseInvalidResults('Slope-stake book', analysis)
  const header = [
    'station_m',
    'station',
    'reasons',
    'centreline_ground_m',
    'formation_m',
    'centreline_cut_fill_m',
    'grade_last_pct',
    'grade_next_pct',
  ]
  for (const side of ['left', 'right'])
    header.push(
      `${side}_hinge`,
      `${side}_hinge_offset_m`,
      `${side}_hinge_elevation_m`,
      `${side}_catch_offset_m`,
      `${side}_catch_ground_m`,
      `${side}_catch_cut_fill_m`,
    )
  header.push('easting', 'northing', 'epsg', 'flags')
  return (
    csvRows(
      [
        header,
        ...rows.map(({ station: s, extra: e, reasons }) => [
          cell(s.chainage),
          label(s.chainage, analysis.stationing ?? stationing),
          reasons.map((r) => STAKE_REASON_TEXT[r]).join('; '),
          cell(s.groundElevation),
          cell(s.designElevation),
          cell(e.centreDepthM),
          cell(e.gradeLastPercent),
          cell(e.gradeNextPercent),
          ...(['left', 'right'] as const).flatMap((side) => {
            const c = e.catch[side]
            return [
              c?.hinge ?? '',
              cell(c?.hingeOffsetM),
              cell(c?.hingeElevationM),
              cell(c?.offsetM),
              cell(c?.groundM),
              cell(c?.cutFillM),
            ]
          }),
          cell(e.easting),
          cell(e.northing),
          e.easting === null ? '' : (epsg ?? ''),
          s.flags.join('; '),
        ]),
      ],
      { quote: 'needed' },
    ) + '\r\n'
  )
}

export interface ClearingRow {
  station: RoadStation
  extra: StationExtra
  /** Clearing area since the previous row, by average end widths over complete intervals. */
  areaM2: number | null
  /** Whether the width is over the job's clearing limit, when one is entered. */
  over: boolean
}

/**
 * Clearing at the calculated station nearest each multiple of `everyM` (every station at 0), with the
 * area since the previous row. The areas add up to `analysis.clearingAreaM2` over the same range.
 */
export function clearingSchedule(
  analysis: RoadAnalysis,
  extras: StationExtra[],
  everyM = 20,
  limitM: number | null = null,
): ClearingRow[] {
  const stations = analysis.stations
  if (!stations.length) return []
  const picked = new Set<number>([0, stations.length - 1])
  if (everyM > 0) {
    const last = stations[stations.length - 1].chainage
    for (let c = Math.ceil(stations[0].chainage / everyM) * everyM; c <= last + 1e-6; c += everyM)
      picked.add(nearestStation(stations, c)!.index)
  } else stations.forEach((s) => picked.add(s.index))
  const width = (s: RoadStation) => s.clearingWidthM ?? (s.leftDaylightM ?? 0) + (s.rightDaylightM ?? 0)
  const rows: ClearingRow[] = []
  let previous: number | null = null
  for (const index of [...picked].sort((a, b) => a - b)) {
    let area: number | null = previous === null ? 0 : null
    if (previous !== null)
      for (let i = previous + 1; i <= index; i++) {
        const a = stations[i - 1],
          b = stations[i]
        if (!a.complete || !b.complete) continue
        area = (area ?? 0) + ((width(a) + width(b)) / 2) * (b.chainage - a.chainage)
      }
    const w = extras[index].clearingWidthM
    rows.push({
      station: stations[index],
      extra: extras[index],
      areaM2: area,
      over: limitM !== null && w !== null && w > limitM + 1e-6,
    })
    previous = index
  }
  return rows
}

export function clearingCsv(analysis: RoadAnalysis, rows: ClearingRow[], stationing?: RoadStationing | null): string {
  refuseInvalidResults('Clearing schedule', analysis)
  return (
    csvRows(
      [
        [
          'station_m',
          'station',
          'sidehill_pct',
          'uphill_side',
          'subgrade_width_m',
          'left_catch_m',
          'right_catch_m',
          'left_clearing_m',
          'right_clearing_m',
          'clearing_width_m',
          'clearing_area_since_previous_m2',
          'over_limit',
        ],
        ...rows.map(({ station: s, extra: e, areaM2, over }) => [
          cell(s.chainage),
          label(s.chainage, analysis.stationing ?? stationing),
          cell(e.sidehillPercent, 1),
          e.uphill ?? '',
          cell(s.leftWidth + s.rightWidth),
          cell(e.catch.left?.offsetM),
          cell(e.catch.right?.offsetM),
          cell(e.clearingM.left),
          cell(e.clearingM.right),
          cell(e.clearingWidthM),
          cell(areaM2, 1),
          over ? 'yes' : '',
        ]),
        [
          'total',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          cell(
            rows.reduce((sum, r) => sum + (r.areaM2 ?? 0), 0),
            1,
          ),
          '',
        ],
      ],
      { quote: 'needed' },
    ) + '\r\n'
  )
}
