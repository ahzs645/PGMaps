/**
 * The end haul a design plans, set out for a Coast Engineering Cost Estimate (ECE) Type 6 submission
 * (Coast ECE Procedures, effective 1 January 2025, Type 6, pp. 24–26) or the Interior's item E
 * (Interior ECE Procedures, July 2024, pp. 18–19), and the equipment-hours sheet a builder fills
 * from time cards (ECE Project Equipment Hours Summary, January 2025). Read from the haul
 * allocation's movements; nothing is re-priced, and the qualifying reason is the designer's to state.
 * No DOM or network access.
 *
 * End haul here is cut trucked off the road to a waste site (never side-cast), or moved in the haul
 * plan's end-haul class. A section is a run of calculation intervals that send material that way,
 * joined across gaps shorter than `END_HAUL_JOIN_M`.
 */
import { csvRows } from '@pgmaps/geo-toolkit/export'
import type { HaulMovement } from './engineeringTypes'
import type { AssumedEquipment } from './quantitySchedule'
import type { Alignment, RoadAnalysis } from './types'

/** The 2002 Coast method's shortest end haul section; the current procedures do not restate it. */
export const END_HAUL_MIN_SECTION_M = 20
/** Current Coast procedures: material must be trucked at least this far to count as end haul. */
export const END_HAUL_MIN_TRUCKED_M = 10
/** Sources this close are one section. */
export const END_HAUL_JOIN_M = 10
/** Natural downslope past which side-casting is ruled out: Coast 55% (Type 6), Interior 60% (item E). */
export const END_HAUL_DOWNSLOPE = { coast: 55, interior: 60 } as const

export interface EndHaulSection {
  start: number
  end: number
  lengthM: number
  bankM3: number
  /** Volume-weighted mean haul distance, metres, site access included. */
  meanHaulM: number
  /** Where it goes: waste site names, or "Down the road" for end-haul-class moves to fill. */
  destinations: string[]
  /** Steepest sidehill across the section's stations, % (`roadSidehill`), null where unknown. */
  steepestSidehillPercent: number | null
  /** True when the section is shorter than the 2002 minimum or any move is shorter than 10 m. */
  short: boolean
}

const isEndHaul = (m: HaulMovement) =>
  m.disposalMethod !== 'sidecast' && ((m.kind === 'waste' && m.distanceM > 0) || m.category === 'endhaul')

export function endHaulSections(
  analysis: RoadAnalysis,
  alignment: Pick<Alignment, 'engineering'>,
  sidehill?: readonly { chainage: number; percent: number | null }[],
): EndHaulSection[] {
  const movements = (analysis.engineering?.movements ?? []).filter(isEndHaul)
  if (!movements.length) return []
  const sites = new Map((alignment.engineering?.sites ?? []).map((s) => [s.id, s.name]))
  const stations = analysis.stations
  // Each source is placed on the calculation interval that holds its chainage.
  const intervalOf = (chainage: number) => {
    let k = 1
    while (k < stations.length - 1 && stations[k].chainage < chainage - 1e-6) k++
    return { start: stations[k - 1]?.chainage ?? 0, end: stations[k]?.chainage ?? chainage }
  }
  const sorted = [...movements].sort((a, b) => a.fromChainage - b.fromChainage)
  const sections: (EndHaulSection & { haulM3m: number; shortMove: boolean })[] = []
  for (const m of sorted) {
    const span = intervalOf(m.fromChainage)
    const bank = m.bankVolumeM3 ?? m.transportedVolumeM3
    const destination = m.kind === 'waste' ? (sites.get(m.targetId) ?? 'Waste site') : 'Down the road (end-haul class)'
    const last = sections.at(-1)
    if (last && span.start <= last.end + END_HAUL_JOIN_M) {
      last.end = Math.max(last.end, span.end)
      last.bankM3 += bank
      last.haulM3m += bank * m.distanceM
      last.shortMove ||= m.distanceM < END_HAUL_MIN_TRUCKED_M
      if (!last.destinations.includes(destination)) last.destinations.push(destination)
    } else
      sections.push({
        start: span.start,
        end: span.end,
        lengthM: 0,
        bankM3: bank,
        haulM3m: bank * m.distanceM,
        meanHaulM: 0,
        destinations: [destination],
        steepestSidehillPercent: null,
        short: false,
        shortMove: m.distanceM < END_HAUL_MIN_TRUCKED_M,
      })
  }
  return sections.map(({ haulM3m, shortMove, ...s }) => {
    const slopes = (sidehill ?? [])
      .filter((r) => r.chainage >= s.start - 1e-6 && r.chainage <= s.end + 1e-6 && r.percent !== null)
      .map((r) => r.percent!)
    const lengthM = s.end - s.start
    return {
      ...s,
      lengthM,
      meanHaulM: s.bankM3 > 0 ? haulM3m / s.bankM3 : 0,
      steepestSidehillPercent: slopes.length ? Math.max(...slopes) : null,
      short: lengthM < END_HAUL_MIN_SECTION_M || shortMove,
    }
  })
}

/** What the procedures ask to be supplied with a Type 6 claim, and whether this design has it. */
export function endHaulEvidence(analysis: RoadAnalysis, alignment: Alignment) {
  return [
    { item: 'Plan and profile', ready: analysis.stations.length > 1 && alignment.vertical.length > 1 },
    { item: 'Cross-sections', ready: analysis.coveragePercent > 0 },
    { item: 'Mass haul diagram with balance lines', ready: analysis.stations.some((s) => s.massM3 !== null) },
    { item: 'Cut and fill volumes', ready: analysis.cutVolumeM3 + analysis.fillVolumeM3 > 0 },
    { item: 'Volumes by material type', ready: (analysis.engineering?.materials.length ?? 0) > 0 },
    {
      item: 'Terrain stability assessment, or a qualified professional’s rationale for end haul',
      ready: null as boolean | null,
    },
  ]
}

/** Header fields of the ECE Project Equipment Hours Summary, in its order. */
export const EQUIPMENT_HOURS_HEADER = [
  'Licence',
  'Cutting Permit',
  'ECAS Id',
  'Project Type',
  'Project Identifier',
  'Natural Resource District',
  'Road Name',
  'Development Category (New/RR)',
  'Starting Station',
  'End Station',
  'Road Length',
] as const
/** The form has six equipment columns. */
export const EQUIPMENT_HOURS_MACHINES = 6

/**
 * The equipment-hours sheet as CSV, ready to fill from time cards: the header the design knows
 * (road name, stations, length) and blank fields it does not, the assumed equipment as the machine
 * columns (make and model left for the builder), and dated rows with operating and standby hours
 * per machine, blank. Only `days` rows; the builder adds more.
 */
export function equipmentHoursCsv({
  roadName,
  analysis,
  station,
  equipment,
  days = 31,
}: {
  roadName: string
  analysis: RoadAnalysis
  station: (chainage: number) => string
  equipment: readonly AssumedEquipment[]
  days?: number
}): string {
  const known: Partial<Record<(typeof EQUIPMENT_HOURS_HEADER)[number], string>> = {
    'Road Name': roadName,
    'Starting Station': station(0),
    'End Station': station(analysis.length),
    'Road Length': `${analysis.length.toFixed(1)} m`,
  }
  const machines = Array.from({ length: EQUIPMENT_HOURS_MACHINES }, (_, i) => equipment[i])
  const rows: (string | number | null)[][] = [
    ['ECE Project Equipment Hours Summary — fill from time cards'],
    ...EQUIPMENT_HOURS_HEADER.map((field) => [field, known[field] ?? '']),
    [],
    ['', ...machines.flatMap((m, i) => [`Equipment ${i + 1}: ${m ? `${m.equipment || m.task}` : ''}`, ''])],
    ['Make and Model', ...machines.flatMap(() => ['', ''])],
    ['Date (YYYY/MM/DD)', ...machines.flatMap(() => ['Operating Hours', 'Standby Hours'])],
    ...Array.from({ length: days }, () => ['', ...machines.flatMap(() => ['', ''])]),
    ['Page Total', ...machines.flatMap(() => ['', ''])],
  ]
  return csvRows(rows, { quote: 'needed' }) + '\r\n'
}

export function endHaulCsv(sections: EndHaulSection[], station: (chainage: number) => string): string {
  return (
    csvRows(
      [
        [
          'start_station',
          'end_station',
          'start_m',
          'end_m',
          'length_m',
          'bank_m3',
          'mean_haul_m',
          'destinations',
          'steepest_sidehill_pct',
          'review',
        ],
        ...sections.map((s) => [
          station(s.start),
          station(s.end),
          Number(s.start.toFixed(2)),
          Number(s.end.toFixed(2)),
          Number(s.lengthM.toFixed(2)),
          Number(s.bankM3.toFixed(1)),
          Number(s.meanHaulM.toFixed(0)),
          s.destinations.join('; '),
          s.steepestSidehillPercent === null ? '' : Number(s.steepestSidehillPercent.toFixed(0)),
          s.short ? `Shorter than ${END_HAUL_MIN_SECTION_M} m or trucked under ${END_HAUL_MIN_TRUCKED_M} m` : '',
        ]),
      ],
      { quote: 'needed' },
    ) + '\r\n'
  )
}
