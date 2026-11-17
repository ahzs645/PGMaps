/**
 * The schedule of quantities the Engineering Manual asks a geometric design for (§3.5.3: clearing,
 * grubbing, excavation in rock and other material, gravel, with the swell and shrink factors and the
 * planned material movement), and the construction equipment assumed for moving material. Every
 * figure is the analysis's own; nothing is recalculated except the grubbing area, which is stated as
 * an assumption (the ground between the catch points). No DOM or network access.
 */
import type { RoadAnalysis, RoadSettings, RoadStation } from './types'

export interface QuantityLine {
  id: string
  item: string
  quantity: number | null
  unit: string
  /** What the figure is measured on, or why it is blank. */
  basis: string
}

/** Construction tasks equipment is assumed for, in the order a road is built. */
export const EQUIPMENT_TASKS = [
  'Clearing',
  'Grubbing and stripping',
  'Common excavation',
  'Rock excavation',
  'Push and side cast (free haul)',
  'Truck haul (overhaul and end haul)',
  'Fill placement and compaction',
  'Ditching',
  'Culvert installation',
  'Surfacing',
] as const
export type EquipmentTask = (typeof EQUIPMENT_TASKS)[number]

export interface AssumedEquipment {
  id: string
  task: EquipmentTask
  /** The machine as the designer names it: "Excavator, 30 t class", "D6 dozer", "Tandem dump". */
  equipment: string
  notes?: string
}

export const MAX_ASSUMED_EQUIPMENT = 40

/** Reads a saved list; anything unusable is refused rather than read as an assumption. */
export function parseAssumedEquipment(raw: unknown): AssumedEquipment[] {
  if (!Array.isArray(raw)) throw Error('Assumed equipment must be a list.')
  if (raw.length > MAX_ASSUMED_EQUIPMENT) throw Error(`List at most ${MAX_ASSUMED_EQUIPMENT} pieces of equipment.`)
  return raw.map((item) => {
    if (!item || typeof item !== 'object') throw Error('Each assumed machine must be an object.')
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || r.id.length > 80) throw Error('Each assumed machine needs an id.')
    if (!EQUIPMENT_TASKS.includes(r.task as EquipmentTask)) throw Error(`Unknown equipment task: ${String(r.task)}.`)
    if (typeof r.equipment !== 'string' || r.equipment.length > 200)
      throw Error('Equipment must be text of at most 200 characters.')
    if (r.notes !== undefined && (typeof r.notes !== 'string' || r.notes.length > 500))
      throw Error('Equipment notes must be text of at most 500 characters.')
    return {
      id: r.id,
      task: r.task as EquipmentTask,
      equipment: r.equipment,
      ...(r.notes ? { notes: r.notes as string } : {}),
    }
  })
}

/**
 * The ground disturbed between the catch points, by average end widths over complete intervals,
 * as the clearing area is measured (`engine.ts`). Grubbing is taken as that footprint: a stated
 * assumption, since a specification may grub a margin beyond it or none under deep fill.
 */
export function grubbingAreaM2(stations: readonly RoadStation[]): number {
  let area = 0
  const width = (s: RoadStation) => Math.abs(s.leftDaylightM ?? 0) + Math.abs(s.rightDaylightM ?? 0)
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i]
    if (a.complete && b.complete) area += ((width(a) + width(b)) / 2) * (b.chainage - a.chainage)
  }
  return area
}

export function quantitySchedule(analysis: RoadAnalysis, settings: Pick<RoadSettings, 'shrinkFactor'>): QuantityLine[] {
  const e = analysis.engineering
  const covered = `${analysis.coveragePercent.toFixed(0)}% of the road has complete sections`
  const rock = e?.rock
  const lines: QuantityLine[] = [
    {
      id: 'clearing',
      item: 'Clearing',
      quantity: analysis.clearingAreaM2 / 10000,
      unit: 'ha',
      basis: 'Catch to catch plus preparation margins, station by station',
    },
    {
      id: 'grubbing',
      item: 'Grubbing',
      quantity: grubbingAreaM2(analysis.stations) / 10000,
      unit: 'ha',
      basis: 'Assumed: the road footprint between the catch points',
    },
    {
      id: 'stripping',
      item: 'Stripping',
      quantity: e ? e.strippingCutM3 : null,
      unit: 'bank m³',
      basis: e ? 'Cut of ground materials marked as stripping' : 'No ground materials entered',
    },
    {
      id: 'rock',
      item: 'Rock excavation',
      quantity: rock ? rock.cutM3 : null,
      unit: 'bank m³',
      basis: rock
        ? `Above the subgrade, shallow rock included; overbreak ${Math.round(rock.deepM3).toLocaleString('en-CA')} m³ below it is separate`
        : 'No ground material is marked rock',
    },
    {
      id: 'common',
      item: rock ? 'Other excavation' : 'Excavation (unclassified)',
      quantity: rock ? Math.max(0, analysis.cutVolumeM3 - rock.cutM3) : analysis.cutVolumeM3,
      unit: 'bank m³',
      basis: rock ? 'All cut less rock, stripping included' : 'All cut; mark a material rock to split it',
    },
    {
      id: 'embankment',
      item: 'Embankment',
      quantity: analysis.fillVolumeM3,
      unit: 'compacted m³',
      basis: covered,
    },
    {
      id: 'gravel',
      item: 'Surfacing gravel',
      quantity: analysis.surfaceVolumeM3,
      unit: 'm³',
      basis: 'Placed above the formation',
    },
  ]
  if (e?.haul.enabled) {
    const h = e.haul
    lines.push(
      { id: 'freehaul', item: 'Free haul', quantity: h.freeHaulM3, unit: 'compacted m³', basis: 'Planned movement' },
      { id: 'overhaul', item: 'Overhaul', quantity: h.overhaulM3, unit: 'compacted m³', basis: 'Planned movement' },
      { id: 'endhaul', item: 'End haul', quantity: h.endHaulM3, unit: 'compacted m³', basis: 'Planned movement' },
      { id: 'borrow', item: 'Borrow', quantity: h.borrowCompactedM3, unit: 'compacted m³', basis: 'From pits' },
      { id: 'waste', item: 'Waste', quantity: h.wasteBankM3, unit: 'bank m³', basis: 'To spoil sites or side cast' },
    )
  }
  if (e?.culverts.length)
    lines.push({
      id: 'culverts',
      item: 'Culverts',
      quantity: e.culverts.length,
      unit: 'each',
      basis: 'See the culvert schedule for sizes and lengths',
    })
  lines.push({
    id: 'shrink',
    item: 'Cut-to-fill factor',
    quantity: settings.shrinkFactor,
    unit: 'compacted per bank',
    basis: e ? "Each ground material's own reuse and compaction factors apply where entered" : 'Road-wide factor',
  })
  return lines
}

/** The quantity a task's equipment works on, for the equipment table, or null where there is none. */
export function taskQuantity(task: EquipmentTask, lines: QuantityLine[]): QuantityLine | null {
  const id: Partial<Record<EquipmentTask, string>> = {
    Clearing: 'clearing',
    'Grubbing and stripping': 'stripping',
    'Common excavation': 'common',
    'Rock excavation': 'rock',
    'Push and side cast (free haul)': 'freehaul',
    'Fill placement and compaction': 'embankment',
    'Culvert installation': 'culverts',
    Surfacing: 'gravel',
  }
  if (task === 'Truck haul (overhaul and end haul)') {
    const over = lines.find((l) => l.id === 'overhaul'),
      end = lines.find((l) => l.id === 'endhaul')
    if (!over || !end) return null
    return {
      id: 'truck-haul',
      item: 'Overhaul and end haul',
      quantity: (over.quantity ?? 0) + (end.quantity ?? 0),
      unit: 'compacted m³',
      basis: 'Planned movement',
    }
  }
  return lines.find((l) => l.id === id[task]) ?? null
}
