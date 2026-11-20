/**
 * The station and volume table: its columns, its rows at a reporting interval, its totals and its
 * CSV. No DOM, so the table, the export and the tests read the same numbers.
 */
import { csvRows } from '@pgmaps/geo-toolkit/export'
import { nearestStation } from './engine'
import { refuseInvalidResults } from './inputErrors'
import { formatStationLabel, hasStationing, type RoadStationing } from './roadStationing'
import type { StationExtra } from './stationExtras'
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
  // Reported beside the volumes above, which every cost, mass and haul figure uses.
  curvedCutVolume: (analysis, index) => analysis.stations[index].curvedCutVolumeM3 ?? null,
  curvedFillVolume: (analysis, index) => analysis.stations[index].curvedFillVolumeM3 ?? null,
  // Rock quantities (`rockExcavation.ts`), present once a ground material is marked rock.
  commonVolume: (analysis, index) => analysis.engineering?.stations[index]?.commonCutVolumeM3 ?? null,
  rockVolume: (analysis, index) => analysis.engineering?.stations[index]?.rockCutVolumeM3 ?? null,
  shallowRockVolume: (analysis, index) => analysis.engineering?.stations[index]?.shallowRockVolumeM3 ?? null,
  shallowRockArea: (analysis, index) => analysis.engineering?.stations[index]?.shallowRockAreaM2 ?? null,
  deepRockVolume: (analysis, index) => analysis.engineering?.stations[index]?.deepRockVolumeM3 ?? null,
} satisfies Record<string, (analysis: RoadAnalysis, index: number) => number | null>
export type IntervalQuantity = keyof typeof INTERVAL_QUANTITIES
const QUANTITIES = Object.keys(INTERVAL_QUANTITIES) as IntervalQuantity[]

/**
 * One table row. Each quantity is the known part since the previous row, and null only when none of
 * that road has a value, so the rows always add up to the totals. `unknownM` is the road length
 * since the previous row whose earthwork is unknown and left out.
 */
export type StationRow = {
  station: RoadStation
  span: number
  unknownM: number
  /** The station's builder figures (`stationExtras.ts`), when the table was given them. */
  extra?: StationExtra
  /** Bank cut of each ground material since the previous row, null where none of it is known. */
  materials?: Record<string, number | null>
} & Record<IntervalQuantity, number | null>
export type StationTotals = Record<IntervalQuantity, number | null> & {
  unknownM: number
  materials: Record<string, number | null>
}

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
  /** Needs a ground material marked rock: left out of the table and CSV until there is one. */
  rock?: boolean
  /** Reads the station's builder figures: offered only when the table was given them. */
  extra?: boolean
  /** A ground material's bank cut since the previous row, totalled by material. */
  materialId?: string
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
  {
    id: 'curvedCut',
    label: 'Cut vol (curve)',
    unit: 'm³',
    csv: 'cut_volume_curvature_corrected_bank_m3',
    road: true,
    hidden: true,
    decimals: 1,
    title: `Bank cut ${SINCE}, corrected for plan curvature by its centroid (Pappus). Reported only: cost, mass and haul use Cut vol.`,
    value: (r) => r.curvedCutVolume,
    sum: 'curvedCutVolume',
  },
  {
    id: 'curvedFill',
    label: 'Fill vol (curve)',
    unit: 'm³',
    csv: 'fill_volume_curvature_corrected_compacted_m3',
    road: true,
    hidden: true,
    decimals: 1,
    title: `Compacted fill ${SINCE}, corrected for plan curvature by its centroid (Pappus). Reported only: cost, mass and haul use Fill vol.`,
    value: (r) => r.curvedFillVolume,
    sum: 'curvedFillVolume',
  },
  {
    id: 'common',
    label: 'Common',
    unit: 'bank m³',
    csv: 'common_excavation_bank_m3',
    road: true,
    rock: true,
    hidden: true,
    decimals: 1,
    title: `Cut of earthwork materials that are neither rock nor stripping ${SINCE}. Unclassified excavation is not in it.`,
    value: (r) => r.commonVolume,
    sum: 'commonVolume',
  },
  {
    id: 'rock',
    label: 'Rock',
    unit: 'bank m³',
    csv: 'rock_cut_bank_m3',
    road: true,
    rock: true,
    decimals: 1,
    title: `Rock cut above the subgrade ${SINCE}, shallow rock included. It is part of the cut volume.`,
    value: (r) => r.rockVolume,
    sum: 'rockVolume',
  },
  {
    id: 'shallowRock',
    label: 'Shallow rock',
    unit: 'bank m³',
    csv: 'shallow_rock_bank_m3',
    road: true,
    rock: true,
    decimals: 1,
    title: `The part of the rock cut no thicker than the template's shallow depth down to the blasting level ${SINCE}`,
    value: (r) => r.shallowRockVolume,
    sum: 'shallowRockVolume',
  },
  {
    id: 'shallowRockArea',
    label: 'Shallow rock A',
    unit: 'm²',
    csv: 'shallow_rock_area_m2',
    road: true,
    rock: true,
    hidden: true,
    decimals: 1,
    title: `Horizontal area of the shallow rock cut ${SINCE}`,
    value: (r) => r.shallowRockArea,
    sum: 'shallowRockArea',
  },
  {
    id: 'deepRock',
    label: 'Overbreak',
    unit: 'bank m³',
    csv: 'overbreak_rock_bank_m3',
    road: true,
    rock: true,
    decimals: 1,
    title: `Rock blasted below the subgrade to the blasting level and refilled in place ${SINCE}. Not part of the cut volume.`,
    value: (r) => r.deepRockVolume,
    sum: 'deepRockVolume',
  },
  ...EXTRA_COLUMNS(),
]

/** The builder's columns, read from `stationExtras.ts`: RoadEng's L-line, slope stake and ditch columns. */
function EXTRA_COLUMNS(): StationColumn[] {
  const side = (s: 'left' | 'right') => (s === 'left' ? 'L' : 'R')
  const sided = (
    id: string,
    label: string,
    unit: string,
    csv: string,
    decimals: number,
    title: (s: 'left' | 'right') => string,
    value: (e: StationExtra, s: 'left' | 'right') => number | null,
    hidden = true,
  ): StationColumn[] =>
    (['left', 'right'] as const).map((s) => ({
      id: `${id}${side(s)}`,
      label: `${label} ${side(s)}`,
      unit,
      csv: `${csv}_${s}`,
      road: true,
      extra: true,
      hidden,
      decimals,
      title: title(s),
      value: (r) => (r.extra ? value(r.extra, s) : null),
    }))
  return [
    {
      id: 'centreDepth',
      label: 'CL C/F',
      unit: 'm',
      csv: 'centreline_cut_fill_m',
      road: true,
      extra: true,
      decimals: 2,
      title: 'Centreline cut (+) or fill (−): ground minus formation',
      value: (r) => r.extra?.centreDepthM ?? null,
    },
    {
      id: 'gradeLast',
      label: 'Grd last',
      unit: '%',
      csv: 'design_grade_last_pct',
      road: true,
      extra: true,
      hidden: true,
      decimals: 2,
      title: 'Design grade from the previous calculated station',
      value: (r) => r.extra?.gradeLastPercent ?? null,
    },
    {
      id: 'gradeNext',
      label: 'Grd next',
      unit: '%',
      csv: 'design_grade_next_pct',
      road: true,
      extra: true,
      hidden: true,
      decimals: 2,
      title: 'Design grade to the next calculated station',
      value: (r) => r.extra?.gradeNextPercent ?? null,
    },
    {
      id: 'easting',
      label: 'CL E',
      unit: 'm',
      csv: 'centreline_easting',
      road: true,
      terrain: true,
      extra: true,
      hidden: true,
      decimals: 2,
      title: "Centreline easting in the project's grid",
      value: (r) => r.extra?.easting ?? null,
    },
    {
      id: 'northing',
      label: 'CL N',
      unit: 'm',
      csv: 'centreline_northing',
      road: true,
      terrain: true,
      extra: true,
      hidden: true,
      decimals: 2,
      title: "Centreline northing in the project's grid",
      value: (r) => r.extra?.northing ?? null,
    },
    ...sided(
      'catch',
      'Stake',
      'm',
      'slope_stake_offset_m',
      2,
      (s) => `Slope stake (catch point) horizontal distance from the centreline, ${s}`,
      (e, s) => e.catch[s]?.offsetM ?? null,
      false,
    ),
    ...sided(
      'catchCutFill',
      'Stake C/F',
      'm',
      'slope_stake_cut_fill_m',
      2,
      (s) =>
        `Cut (+) or fill (−) at the ${s} slope stake: catch ground minus the hinge (ditch bottom in cut, else the formation edge)`,
      (e, s) => e.catch[s]?.cutFillM ?? null,
    ),
    ...sided(
      'ditchDepth',
      'Ditch D',
      'm',
      'ditch_depth_m',
      2,
      (s) => `Formation edge minus ditch bottom, ${s}; blank where that side has no constructed ditch`,
      (e, s) => e.ditchDepthM[s],
    ),
    ...sided(
      'ditchGrade',
      'Ditch grd',
      '%',
      'ditch_grade_pct',
      2,
      (s) => `Ditch-bottom grade from the previous calculated station, ${s}`,
      (e, s) => e.ditchGradePercent[s],
    ),
    ...sided(
      'clearing',
      'Clear',
      'm',
      'clearing_offset_m',
      2,
      (s) => `Clearing limit from the centreline, ${s}: the catch plus preparation margins`,
      (e, s) => e.clearingM[s],
    ),
    {
      id: 'clearingWidth',
      label: 'Clear W',
      unit: 'm',
      csv: 'clearing_width_m',
      road: true,
      extra: true,
      decimals: 1,
      title: 'Clearing width, limit to limit',
      value: (r) => r.extra?.clearingWidthM ?? null,
    },
    ...sided(
      'crossfall',
      'X-fall',
      '%',
      'crossfall_pct',
      1,
      (s) => `Running-surface crossfall, ${s}, positive falling away from the centreline; superelevation included`,
      (e, s) => e.crossfallPercent[s],
    ),
  ]
}

/** Each ground material's bank cut as a column, for a road with materials (RoadEng's layer volumes). */
function materialColumns(analysis: RoadAnalysis): StationColumn[] {
  return (analysis.engineering?.materials ?? []).map((m) => ({
    id: `material:${m.materialId}`,
    label: `${m.name} V`,
    unit: 'bank m³',
    csv: `cut_bank_m3_${
      m.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || m.materialId
    }`,
    road: true,
    extra: true,
    hidden: true,
    decimals: 1,
    materialId: m.materialId,
    title: `Bank cut of ${m.name} ${SINCE}. The materials add up to Cut vol, preparation included.`,
    value: (r) => r.materials?.[m.materialId] ?? null,
  }))
}

/** A column's figure in the totals row, or null when it has none. */
export const columnTotal = (c: StationColumn, totals: StationTotals) =>
  c.sum ? totals[c.sum] : c.materialId ? (totals.materials[c.materialId] ?? null) : null

/** With the curvature correction applied, the volume columns say they are corrected. */
const CORRECTED: Record<string, Pick<StationColumn, 'label' | 'title' | 'csv'>> = {
  cutVolume: {
    label: 'Cut vol (curve)',
    csv: 'cut_volume_curvature_corrected_bank_m3',
    title: `Bank cut ${SINCE}, corrected for plan curvature by its centroid (Pappus). Cost, mass and haul use it.`,
  },
  fillVolume: {
    label: 'Fill vol (curve)',
    csv: 'fill_volume_curvature_corrected_compacted_m3',
    title: `Compacted fill ${SINCE}, corrected for plan curvature by its centroid (Pappus). Cost, mass and haul use it.`,
  },
}

/**
 * The columns this road's table offers: borrow and waste only once haul is allocated, rock only once
 * a ground material is marked rock.
 */
export function availableStationColumns(
  analysis: RoadAnalysis,
  terrainOnly = false,
  /** Whether the rows carry builder figures (`stationExtras.ts`); without them those columns are left out. */
  extras = false,
): StationColumn[] {
  const haul = !!analysis.engineering?.haul.enabled
  const rock = !!analysis.engineering?.rock
  const corrected = !!analysis.curvatureCorrection?.applied
  return [...STATION_COLUMNS, ...materialColumns(analysis)]
    .filter(
      (c) =>
        (terrainOnly ? c.terrain : c.road) &&
        (!c.haul || haul) &&
        (!c.rock || rock) &&
        (!c.extra || extras) &&
        // The separate corrected columns repeat the main ones once the correction is applied.
        !(corrected && (c.id === 'curvedCut' || c.id === 'curvedFill')),
    )
    .map((c) => (corrected && CORRECTED[c.id] ? { ...c, ...CORRECTED[c.id] } : c))
}

/**
 * Rows at the chosen reporting interval: the calculated station nearest each multiple, with each
 * quantity summed since the previous reported row. An interval with unknown earthwork adds nothing
 * and is counted in the row's `unknownM`, so a row that holds a gap still reports its known part.
 * The first row starts the table: nothing precedes it, so it sums nothing.
 */
export function reportingRows(
  analysis: RoadAnalysis,
  stations: RoadStation[],
  every: number,
  /** Builder figures by station index (`stationExtras`); rows then carry them and material cut. */
  extras?: StationExtra[] | null,
): StationRow[] {
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
    if (extras) {
      row.extra = extras[s.index]
      const materials: Record<string, number | null> = {}
      for (const m of analysis.engineering?.materials ?? []) {
        let sum: number | null = null
        if (!previous) sum = extras[s.index]?.materialCutM3 ? 0 : null
        else
          for (let i = previous.index + 1; i <= s.index; i++) {
            const v = extras[i]?.materialCutM3?.[m.materialId]
            if (v !== undefined) sum = (sum ?? 0) + v
          }
        materials[m.materialId] = sum
      }
      row.materials = materials
    }
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
  const totals = { unknownM: rows.reduce((sum, row) => sum + row.unknownM, 0), materials: {} } as StationTotals
  for (const key of QUANTITIES)
    totals[key] = rows.some((row) => row[key] !== null) ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) : null
  for (const id of new Set(rows.flatMap((row) => Object.keys(row.materials ?? {}))))
    totals.materials[id] = rows.some((row) => row.materials?.[id] != null)
      ? rows.reduce((sum, row) => sum + (row.materials?.[id] ?? 0), 0)
      : null
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
 * The table as CSV: the given rows with every column the road offers by default, or the selected
 * columns in their requested order. Station identifiers, the road length each row leaves out,
 * flags and a last `total` row are retained. Values are unrounded; totals sum only the given rows.
 */
export function stationReportCsv(
  analysis: RoadAnalysis,
  rows: StationRow[],
  terrainOnly = false,
  /** The road's start station and equations: a `station` column of names follows `station_m`. */
  stationing?: RoadStationing | null,
  /** Omit for the full CSV. Unavailable and duplicate ids are ignored; [] keeps only identifiers and quality. */
  columnIds?: readonly string[],
): string {
  refuseInvalidResults('Station table CSV', analysis)
  const available = availableStationColumns(
    analysis,
    terrainOnly,
    rows.some((row) => row.extra),
  )
  const byId = new Map(available.map((column) => [column.id, column]))
  const columns = columnIds
    ? [...new Set(columnIds)].flatMap((id) => {
        const column = byId.get(id)
        return column ? [column] : []
      })
    : available
  const totals = tableTotals(rows)
  const named = hasStationing(stationing)
  return (
    csvRows(
      [
        [
          'station_m',
          ...(named ? ['station'] : []),
          ...columns.map((c) => c.csv),
          ...(terrainOnly ? [] : ['unknown_earthwork_m']),
          'flags',
        ],
        ...rows.map((row) => [
          row.station.chainage,
          ...(named ? [formatStationLabel(row.station.chainage, stationing, 3)] : []),
          ...columns.map((c) => c.value(row)),
          ...(terrainOnly ? [] : [row.unknownM]),
          (terrainOnly ? row.station.flags : rowFlags(row)).join('; '),
        ]),
        ...(terrainOnly
          ? []
          : [
              [
                'total',
                ...(named ? [null] : []),
                ...columns.map((c) => columnTotal(c, totals)),
                totals.unknownM,
                rows.length ? 'Sum of the rows above' : '',
              ],
            ]),
      ],
      { quote: 'needed' },
    ) + '\r\n'
  )
}
