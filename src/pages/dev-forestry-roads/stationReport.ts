/**
 * The station and volume table: its columns, its rows at a reporting interval, its totals and its
 * CSV. No DOM, so the table, the export and the tests read the same numbers.
 */
import { csvRows } from '@pgmaps/geo-toolkit/export'
import { nearestStation } from './engine'
import type { RoadAnalysis, RoadStation } from './types'

/**
 * Quantities that belong to the interval ending at a calculation station. A reporting row sums each
 * over the intervals since the previous row; null is an interval where it is unknown.
 */
const INTERVAL_QUANTITIES = {
  cutVolume: (analysis, index) => analysis.stations[index].cutVolumeM3,
  fillVolume: (analysis, index) => analysis.stations[index].fillVolumeM3,
  surfacingVolume: (analysis, index) => analysis.stations[index].surfaceVolumeM3 ?? null,
  // A road without ground materials strips nothing where its earthwork is known.
  strippingVolume: (analysis, index) =>
    analysis.engineering
      ? (analysis.engineering.stations[index]?.strippingCutVolumeM3 ?? null)
      : analysis.stations[index].cutVolumeM3 === null
        ? null
        : 0,
  borrowVolume: (analysis, index) => analysis.engineering?.stations[index]?.borrowVolumeM3 ?? null,
  wasteVolume: (analysis, index) => analysis.engineering?.stations[index]?.wasteVolumeM3 ?? null,
} satisfies Record<string, (analysis: RoadAnalysis, index: number) => number | null>
export type IntervalQuantity = keyof typeof INTERVAL_QUANTITIES
const QUANTITIES = Object.keys(INTERVAL_QUANTITIES) as IntervalQuantity[]

/**
 * One table row. Each quantity is the known part since the previous row, and null only when none of
 * that road has a value, so the rows always add up to the totals. `unknownM` is the road length
 * since the previous row whose earthwork is unknown and left out.
 */
export type StationRow = { station: RoadStation; span: number; unknownM: number } & Record<
  IntervalQuantity,
  number | null
>
export type StationTotals = Record<IntervalQuantity, number | null> & { unknownM: number }

export interface StationColumn {
  id: string
  label: string
  unit: string
  /** Header of the column in the CSV. */
  csv: string
  title?: string
  /** Shown for a designed road. */
  road?: boolean
  /** Shown for a ground-only terrain profile. */
  terrain?: boolean
  /** Needs a haul allocation: left out of the table until haul is on. */
  haul?: boolean
  /** Hidden until chosen in the Columns menu. */
  hidden?: boolean
  value: (row: StationRow) => number | null
  /** A quantity summed down the table into the totals row. */
  sum?: IntervalQuantity
  decimals: number
}

const SINCE = 'since the previous row'
export const STATION_COLUMNS: StationColumn[] = [
  {
    id: 'ground',
    label: 'Ground',
    unit: 'm',
    csv: 'ground_elevation_m',
    road: true,
    terrain: true,
    decimals: 2,
    value: (r) => r.station.groundElevation,
  },
  {
    id: 'formation',
    label: 'Formation',
    unit: 'm',
    csv: 'design_elevation_m',
    road: true,
    decimals: 2,
    value: (r) => r.station.designElevation,
  },
  {
    id: 'grade',
    label: 'Grade',
    unit: '%',
    csv: 'design_grade_pct',
    road: true,
    decimals: 1,
    value: (r) => r.station.gradePercent,
  },
  {
    id: 'groundGrade',
    label: 'Gnd grade',
    unit: '%',
    csv: 'ground_grade_pct',
    terrain: true,
    decimals: 1,
    value: (r) => r.station.groundGradePercent,
  },
  { id: 'interval', label: 'Interval', unit: 'm', csv: 'interval_m', terrain: true, decimals: 1, value: (r) => r.span },
  {
    id: 'cutArea',
    label: 'Cut A',
    unit: 'm²',
    csv: 'cut_area_m2',
    road: true,
    decimals: 1,
    value: (r) => r.station.cutAreaM2,
  },
  {
    id: 'fillArea',
    label: 'Fill A',
    unit: 'm²',
    csv: 'fill_area_m2',
    road: true,
    decimals: 1,
    value: (r) => r.station.fillAreaM2,
  },
  {
    id: 'cutVolume',
    label: 'Cut vol',
    unit: 'm³',
    csv: 'cut_volume_bank_m3',
    road: true,
    decimals: 1,
    title: `Bank cut ${SINCE}`,
    value: (r) => r.cutVolume,
    sum: 'cutVolume',
  },
  {
    id: 'fillVolume',
    label: 'Fill vol',
    unit: 'm³',
    csv: 'fill_volume_compacted_m3',
    road: true,
    decimals: 1,
    title: `Compacted fill ${SINCE}`,
    value: (r) => r.fillVolume,
    sum: 'fillVolume',
  },
  {
    id: 'surfacing',
    label: 'Surfacing',
    unit: 'm³',
    csv: 'surfacing_volume_m3',
    road: true,
    decimals: 1,
    title: `Surfacing placed above the formation ${SINCE}`,
    value: (r) => r.surfacingVolume,
    sum: 'surfacingVolume',
  },
  {
    id: 'stripping',
    label: 'Stripping',
    unit: 'bank m³',
    csv: 'stripping_volume_bank_m3',
    road: true,
    hidden: true,
    decimals: 1,
    title: `Cut of materials marked as stripping ${SINCE}. It is part of the cut volume.`,
    value: (r) => r.strippingVolume,
    sum: 'strippingVolume',
  },
  {
    id: 'borrow',
    label: 'Borrow',
    unit: 'compacted m³',
    csv: 'borrow_volume_compacted_m3',
    road: true,
    haul: true,
    decimals: 1,
    title: `Fill the allocation brings from off the road ${SINCE}, a site found or not`,
    value: (r) => r.borrowVolume,
    sum: 'borrowVolume',
  },
  {
    id: 'waste',
    label: 'Waste',
    unit: 'bank m³',
    csv: 'waste_volume_bank_m3',
    road: true,
    haul: true,
    decimals: 1,
    title: `Cut the allocation takes off the road or sidecasts ${SINCE}, a site found or not`,
    value: (r) => r.wasteVolume,
    sum: 'wasteVolume',
  },
  {
    id: 'mass',
    label: 'Mass',
    unit: 'm³',
    csv: 'mass_balance_m3',
    road: true,
    hidden: true,
    decimals: 0,
    title: 'Cumulative mass ordinate: the known earthwork so far',
    value: (r) => r.station.massM3,
  },
  {
    id: 'width',
    label: 'Width L+R',
    unit: 'm',
    csv: 'formation_width_m',
    road: true,
    hidden: true,
    decimals: 1,
    value: (r) => r.station.leftWidth + r.station.rightWidth,
  },
  {
    id: 'longitude',
    label: 'Longitude',
    unit: '°',
    csv: 'longitude',
    road: true,
    terrain: true,
    hidden: true,
    decimals: 6,
    value: (r) => r.station.coordinate[0],
  },
  {
    id: 'latitude',
    label: 'Latitude',
    unit: '°',
    csv: 'latitude',
    road: true,
    terrain: true,
    hidden: true,
    decimals: 6,
    value: (r) => r.station.coordinate[1],
  },
]

/** The columns this road's table offers: borrow and waste only once haul is allocated. */
export function availableStationColumns(analysis: RoadAnalysis, terrainOnly = false): StationColumn[] {
  const haul = !!analysis.engineering?.haul.enabled
  return STATION_COLUMNS.filter((c) => (terrainOnly ? c.terrain : c.road) && (!c.haul || haul))
}

/**
 * Rows at the chosen reporting interval: the calculated station nearest each multiple, with each
 * quantity summed since the previous reported row. An interval with unknown earthwork adds nothing
 * and is counted in the row's `unknownM`, so a row that holds a gap still reports its known part.
 * The first row starts the table: nothing precedes it, so it sums nothing.
 */
export function reportingRows(analysis: RoadAnalysis, stations: RoadStation[], every: number): StationRow[] {
  const picked = every > 0 ? new Set<number>() : null
  if (picked && stations.length) {
    const first = stations[0].chainage,
      last = stations[stations.length - 1].chainage
    for (let chainage = Math.ceil(first / every) * every; chainage <= last + 1e-6; chainage += every)
      picked.add(nearestStation(stations, chainage)!.index)
    picked.add(stations[0].index)
    picked.add(stations[stations.length - 1].index)
  }
  const rows: StationRow[] = []
  let previous: RoadStation | null = null
  for (const s of stations) {
    if (picked && !picked.has(s.index)) continue
    const row = {
      station: s,
      span: previous
        ? s.chainage - previous.chainage
        : s.index
          ? s.chainage - analysis.stations[s.index - 1].chainage
          : 0,
      unknownM: 0,
    } as StationRow
    for (const key of QUANTITIES) {
      const value = INTERVAL_QUANTITIES[key]
      row[key] = null
      if (!previous) {
        if (value(analysis, s.index) !== null) row[key] = 0
        continue
      }
      for (let i = previous.index + 1; i <= s.index; i++) {
        const volume = value(analysis, i)
        if (volume !== null) row[key] = (row[key] ?? 0) + volume
      }
    }
    if (previous)
      for (let i = previous.index + 1; i <= s.index; i++) {
        const x = analysis.stations[i]
        if (x.cutVolumeM3 === null || x.fillVolumeM3 === null)
          row.unknownM += x.chainage - analysis.stations[i - 1].chainage
      }
    rows.push(row)
    previous = s
  }
  return rows
}

/** The totals row: each quantity summed down the rows, and the road length they leave out. */
export function tableTotals(rows: StationRow[]): StationTotals {
  const totals = { unknownM: rows.reduce((sum, row) => sum + row.unknownM, 0) } as StationTotals
  for (const key of QUANTITIES)
    totals[key] = rows.some((row) => row[key] !== null) ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) : null
  return totals
}

const metres = (value: number) => Number(value.toFixed(1)).toLocaleString('en-CA')

/** What a row says about itself besides its station's own flags. */
export function rowFlags(row: StationRow): string[] {
  if (row.unknownM <= 1e-6) return row.station.flags
  return [
    row.unknownM >= row.span - 1e-6
      ? 'Earthwork unknown since the previous row'
      : `Partial: leaves out ${metres(row.unknownM)} m with unknown earthwork`,
    ...row.station.flags,
  ]
}

/** What the totals row says about the road length it leaves out, or nothing. */
export const totalsNote = (totals: StationTotals) =>
  totals.unknownM > 1e-6 ? `Leaves out ${metres(totals.unknownM)} m with unknown earthwork` : ''

/**
 * The table as CSV: the given rows with every column the road offers, whether or not the table is
 * showing it, the road length each row leaves out, its flags, and a last `total` row. Values are
 * unrounded.
 */
export function stationReportCsv(analysis: RoadAnalysis, rows: StationRow[], terrainOnly = false): string {
  const columns = availableStationColumns(analysis, terrainOnly)
  const totals = tableTotals(rows)
  return (
    csvRows(
      [
        ['station_m', ...columns.map((c) => c.csv), ...(terrainOnly ? [] : ['unknown_earthwork_m']), 'flags'],
        ...rows.map((row) => [
          row.station.chainage,
          ...columns.map((c) => c.value(row)),
          ...(terrainOnly ? [] : [row.unknownM]),
          (terrainOnly ? row.station.flags : rowFlags(row)).join('; '),
        ]),
        ...(terrainOnly
          ? []
          : [
              [
                'total',
                ...columns.map((c) => (c.sum ? totals[c.sum] : null)),
                totals.unknownM,
                rows.length ? 'Sum of the rows above' : '',
              ],
            ]),
      ],
      { quote: 'needed' },
    ) + '\r\n'
  )
}
