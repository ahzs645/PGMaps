/**
 * Every rate a record or a saved build-up can inform, with the basis its figure is entered on and
 * the work it is meant to price. Project rates (`settings`) keep their bare keys (`cutRate`), so files
 * saved before this registry still read; a road's rates are keyed by the road
 * (`<alignmentId>/haul.borrowRate`, `<alignmentId>/material:<id>.cutRate`), and a project-budget
 * item by `schedule:<id>`.
 *
 * `prices` lists the parts of the work a rate is meant to cover. A quoted price that bundles more
 * (excavation that includes haul, borrow that includes placement, as BC's 2025 standard
 * specifications section 201 pays them) is checked against the lines that already price those
 * parts, so a bundled price is not counted twice without the estimator saying so. Free of DOM and
 * network access.
 */
import type { EvidenceCurrency } from './costEvidence'
import type { Alignment, RoadProject } from '../types'
import type { AlignmentEngineering } from '../engineeringTypes'
import {
  GENERIC_SCHEDULE_ITEMS,
  SCHEDULE_BASES,
  withEntry,
  type ScheduleBasis,
  type ScheduleEntry,
  type ScheduleTemplateItem,
} from '../costSchedule'

/** A part of the work a price can cover. */
export type WorkPart =
  | 'excavation'
  | 'supply'
  | 'processing'
  | 'loading'
  | 'haul'
  | 'placement'
  | 'compaction'
  | 'disposal'
  | 'clearing'
  | 'installation'
  | 'mobilization'

export const WORK_PARTS: Record<WorkPart, string> = {
  excavation: 'Excavation',
  supply: 'Material supply or royalty',
  processing: 'Crushing or screening',
  loading: 'Loading',
  haul: 'Haul',
  placement: 'Placing',
  compaction: 'Compaction',
  disposal: 'Disposal',
  clearing: 'Clearing and grubbing',
  installation: 'Installation',
  mobilization: 'Mobilization',
}

/** What a figure is measured on. A price on one basis does not read on another without a factor. */
export type MeasureBasis =
  | 'bank-m3'
  | 'loose-m3'
  | 'compacted-m3'
  | 'transported-m3'
  | 'm3-km'
  | 'tonne'
  | 'm'
  | 'm2'
  | 'km'
  | 'hour'
  | 'each'
  | 'lump-sum'
  | 'percent'

export const MEASURE_BASES: Record<MeasureBasis, string> = {
  'bank-m3': 'Bank m³ (in the ground)',
  'loose-m3': 'Loose m³ (in the truck)',
  'compacted-m3': 'Compacted m³ (in place)',
  'transported-m3': 'Transported m³',
  'm3-km': 'm³ per km hauled',
  tonne: 'Tonne',
  m: 'Lineal metre',
  m2: 'Square metre',
  km: 'Kilometre of road',
  hour: 'Hour',
  each: 'Each',
  'lump-sum': 'Lump sum',
  percent: 'Percent of other lines',
}

export interface AdoptionTarget {
  key: string
  label: string
  /** Where it sits: "Project rates", "Haul · Spur A", "Ground materials · Spur A". */
  group: string
  /** Reads after the amount: "/m³", "/m³·km", "" for a lump sum, "%". */
  unit: string
  basis: MeasureBasis
  /** "per bank m³ excavated", in words, with the currency put in front. */
  basisText: string
  specification: string
  prices: readonly WorkPart[]
  max: number
  /** The value the project holds now; null where it has none yet (a budget item not priced). */
  value: number | null
}

export const SETTINGS_TARGET_KEYS = ['cutRate', 'fillRate', 'surfacingRate', 'clearingRate'] as const
export type SettingsTargetKey = (typeof SETTINGS_TARGET_KEYS)[number]

const SETTINGS_TARGETS: Record<SettingsTargetKey, Omit<AdoptionTarget, 'key' | 'group' | 'value'>> = {
  cutRate: {
    label: 'Cut rate',
    unit: '/m³',
    basis: 'bank-m3',
    basisText: 'per bank m³ excavated',
    specification: 'excavation of this ground, measured in the bank, with the same loading and disposal',
    prices: ['excavation'],
    max: 10000,
  },
  fillRate: {
    label: 'Fill rate',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per m³ of fill placed',
    specification: 'placing and compacting fill, without the supply or haul priced on other lines',
    prices: ['placement', 'compaction'],
    max: 10000,
  },
  surfacingRate: {
    label: 'Surfacing rate',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per m³ of surfacing in place',
    specification: 'this aggregate specification, supplied, hauled and placed as the rate is meant to cover',
    prices: ['supply', 'processing', 'loading', 'haul', 'placement', 'compaction'],
    max: 10000,
  },
  clearingRate: {
    label: 'Clearing rate',
    unit: '/m²',
    basis: 'm2',
    basisText: 'per m² cleared',
    specification: 'the same clearing, grubbing and disposal work on comparable timber',
    prices: ['clearing'],
    max: 10000,
  },
}

type HaulKey =
  | 'freeHaulRate'
  | 'overhaulRate'
  | 'endHaulRate'
  | 'freeHaulLoadingRate'
  | 'overhaulLoadingRate'
  | 'endHaulLoadingRate'
  | 'borrowRate'
  | 'wasteRate'
  | 'mobilizationCost'

const HAUL_TARGETS: Record<HaulKey, Omit<AdoptionTarget, 'key' | 'group' | 'value'>> = {
  freeHaulRate: {
    label: 'Free-haul rate',
    unit: '/m³·km',
    basis: 'm3-km',
    basisText: 'per transported m³ per km, over the whole free-haul distance',
    specification: 'moving material inside the free-haul distance, without loading',
    prices: ['haul'],
    max: 1e6,
  },
  overhaulRate: {
    label: 'Overhaul rate',
    unit: '/m³·km',
    basis: 'm3-km',
    basisText: 'per transported m³ per km beyond the free-haul distance',
    specification: 'moving material beyond the free-haul distance, without loading',
    prices: ['haul'],
    max: 1e6,
  },
  endHaulRate: {
    label: 'Endhaul rate',
    unit: '/m³·km',
    basis: 'm3-km',
    basisText: 'per transported m³ per km beyond the free-haul distance',
    specification: 'trucking material past the overhaul limit, without loading',
    prices: ['haul'],
    max: 1e6,
  },
  freeHaulLoadingRate: {
    label: 'Free-haul loading rate',
    unit: '/m³',
    basis: 'transported-m3',
    basisText: 'per transported m³ loaded',
    specification: 'loading for a free-haul move',
    prices: ['loading'],
    max: 1e6,
  },
  overhaulLoadingRate: {
    label: 'Overhaul loading rate',
    unit: '/m³',
    basis: 'transported-m3',
    basisText: 'per transported m³ loaded',
    specification: 'loading for an overhaul move',
    prices: ['loading'],
    max: 1e6,
  },
  endHaulLoadingRate: {
    label: 'Endhaul loading rate',
    unit: '/m³',
    basis: 'transported-m3',
    basisText: 'per transported m³ loaded',
    specification: 'loading trucks for endhaul',
    prices: ['loading'],
    max: 1e6,
  },
  borrowRate: {
    label: 'Default borrow rate',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per compacted m³ supplied',
    specification: 'borrow material supplied where no entered site has capacity, without its haul',
    prices: ['supply'],
    max: 1e6,
  },
  wasteRate: {
    label: 'Default waste rate',
    unit: '/m³',
    basis: 'bank-m3',
    basisText: 'per bank m³ disposed',
    specification: 'disposal where no entered site has capacity, without its haul',
    prices: ['disposal'],
    max: 1e6,
  },
  mobilizationCost: {
    label: 'Mobilization',
    unit: '',
    basis: 'lump-sum',
    basisText: 'lump sum for the road',
    specification: 'moving the spread to and from this road',
    prices: ['mobilization'],
    max: 1e9,
  },
}

const SUPPLY_TARGETS: Record<
  'acquisitionRate' | 'processingRate' | 'loadingRate' | 'haulRate' | 'placementRate',
  Omit<AdoptionTarget, 'key' | 'group' | 'value'>
> = {
  acquisitionRate: {
    label: 'Aggregate acquisition',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per compacted m³ of surfacing',
    specification: 'buying the aggregate at the source, or its royalty',
    prices: ['supply'],
    max: 1e6,
  },
  processingRate: {
    label: 'Aggregate processing',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per compacted m³ of surfacing',
    specification: 'crushing and screening to this specification',
    prices: ['processing'],
    max: 1e6,
  },
  loadingRate: {
    label: 'Aggregate loading',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per compacted m³ of surfacing',
    specification: 'loading at the source',
    prices: ['loading'],
    max: 1e6,
  },
  haulRate: {
    label: 'Aggregate haul',
    unit: '/m³·km',
    basis: 'm3-km',
    basisText: 'per compacted m³ per one-way km',
    specification: 'trucking the aggregate from the source',
    prices: ['haul'],
    max: 1e6,
  },
  placementRate: {
    label: 'Aggregate placement',
    unit: '/m³',
    basis: 'compacted-m3',
    basisText: 'per compacted m³ placed',
    specification: 'spreading and compacting the surfacing',
    prices: ['placement', 'compaction'],
    max: 1e6,
  },
}

const SCHEDULE_PRICES: Partial<Record<string, WorkPart[]>> = { mobilization: ['mobilization'] }

const scheduleTarget = (
  item: { id: string; label: string },
  basis: ScheduleBasis,
): Omit<AdoptionTarget, 'key' | 'group' | 'value'> => ({
  label: item.label,
  unit: SCHEDULE_BASES[basis].unit,
  basis: basis === 'percent' ? 'percent' : basis === 'per-km' ? 'km' : 'lump-sum',
  basisText:
    basis === 'percent' ? 'percent of the construction estimate' : basis === 'per-km' ? 'per km of road' : 'lump sum',
  specification: `the work the budget item “${item.label}” stands for`,
  prices: SCHEDULE_PRICES[item.id] ?? [],
  max: basis === 'percent' ? 200 : 1e10,
})

/** The rates the active road and the project can take, with their present values. */
export function adoptionTargets(
  project: RoadProject,
  scheduleItems: readonly ScheduleTemplateItem[] = [],
): AdoptionTarget[] {
  const targets: AdoptionTarget[] = SETTINGS_TARGET_KEYS.map((key) => ({
    ...SETTINGS_TARGETS[key],
    key,
    group: 'Project rates',
    value: project.settings[key],
  }))
  const road = project.alignments.find((a) => a.id === project.activeAlignmentId)
  const e = road?.engineering
  if (road && e) targets.push(...roadTargets(road, e))
  const entries = new Map((project.costSchedule?.entries ?? []).map((entry) => [entry.id, entry]))
  const items: { id: string; label: string; basis?: ScheduleBasis }[] = [
    ...GENERIC_SCHEDULE_ITEMS.filter((item) => item.group !== 'future'),
    ...scheduleItems.filter((item) => item.group !== 'future'),
    ...(project.costSchedule?.entries ?? []).flatMap((entry) =>
      entry.label && entry.group && entry.group !== 'future' ? [{ id: entry.id, label: entry.label }] : [],
    ),
  ]
  for (const item of items) {
    const entry = entries.get(item.id)
    const basis = entry?.basis ?? item.basis ?? 'lump-sum'
    targets.push({
      ...scheduleTarget(item, basis),
      key: `schedule:${item.id}`,
      group: 'Project budget',
      value: entry ? scheduleValue(entry, basis) : null,
    })
  }
  return targets
}

function scheduleValue(entry: ScheduleEntry, basis: ScheduleBasis): number | null {
  if (entry.status !== 'priced' && entry.status !== 'allowance') return null
  return (basis === 'percent' ? entry.percent : entry.amount) ?? null
}

function roadTargets(road: Alignment, e: AlignmentEngineering): AdoptionTarget[] {
  const out: AdoptionTarget[] = []
  const prefix = `${road.id}/`
  for (const key of Object.keys(HAUL_TARGETS) as HaulKey[])
    out.push({ ...HAUL_TARGETS[key], key: `${prefix}haul.${key}`, group: `Haul · ${road.name}`, value: e.haul[key] })
  for (const m of e.materials) {
    const base = {
      unit: '/m³',
      basis: 'bank-m3' as const,
      basisText: 'per bank m³ excavated',
      prices: ['excavation'] as WorkPart[],
      max: 10000,
      group: `Ground materials · ${road.name}`,
    }
    out.push({
      ...base,
      key: `${prefix}material:${m.id}.cutRate`,
      label: `${m.name} excavation`,
      specification: `excavating ${m.name} in the bank, with the same loading and disposal`,
      value: m.cutRate,
    })
    if (m.rock) {
      out.push({
        ...base,
        key: `${prefix}material:${m.id}.shallowCutRate`,
        label: `${m.name} shallow rock`,
        specification: `shallow ${m.name} cut, ripped or drilled as the template's shallow depth allows`,
        value: m.shallowCutRate ?? null,
      })
      out.push({
        ...base,
        key: `${prefix}material:${m.id}.overbreakRate`,
        label: `${m.name} overbreak`,
        specification: `${m.name} blasted below subgrade to the blasting level`,
        value: m.overbreakRate ?? null,
      })
    }
  }
  for (const site of e.sites) {
    const borrow = site.kind === 'borrow'
    out.push({
      key: `${prefix}site:${site.id}.unitRate`,
      label: `${site.name} ${borrow ? 'borrow' : 'waste'} rate`,
      group: `Material sites · ${road.name}`,
      unit: '/m³',
      basis: borrow ? 'compacted-m3' : 'bank-m3',
      basisText: borrow ? 'per compacted m³ supplied' : 'per bank m³ accepted',
      specification: borrow
        ? `material from ${site.name}, at the pit, without the haul priced on other lines`
        : `disposal at ${site.name}, without the haul priced on other lines`,
      prices: [borrow ? 'supply' : 'disposal'],
      max: 1e6,
      value: site.unitRate,
    })
    out.push({
      key: `${prefix}site:${site.id}.fixedCost`,
      label: `${site.name} opening cost`,
      group: `Material sites · ${road.name}`,
      unit: '',
      basis: 'lump-sum',
      basisText: 'lump sum to open and close the site',
      specification: `opening, developing and reclaiming ${site.name}`,
      prices: [],
      max: 1e9,
      value: site.fixedCost,
    })
  }
  if (e.surfacingSupply)
    for (const [key, target] of Object.entries(SUPPLY_TARGETS))
      out.push({
        ...target,
        key: `${prefix}supply.${key}`,
        group: `Surfacing source · ${road.name}`,
        value: e.surfacingSupply[key as keyof typeof SUPPLY_TARGETS],
      })
  for (const c of e.culverts)
    out.push({
      key: `${prefix}culvert:${c.id}.unitCost`,
      label: `${c.name} installed cost`,
      group: `Culverts · ${road.name}`,
      unit: '/m',
      basis: 'm',
      basisText: 'per installed barrel metre',
      specification: `supplying and installing a ${Math.round(c.diameterM * 1000)} mm culvert of this kind`,
      prices: ['supply', 'installation'],
      max: 1e6,
      value: c.unitCost,
    })
  return out
}

const ROAD_KEY =
  /^([^/]+)\/(?:haul\.(\w+)|material:([^.]+)\.(cutRate|shallowCutRate|overbreakRate)|site:([^.]+)\.(unitRate|fixedCost)|supply\.(\w+)|culvert:([^.]+)\.unitCost)$/

/** Whether a stored key is one this registry writes; an unknown key is refused when a file is read. */
export function isTargetKey(key: string): boolean {
  if ((SETTINGS_TARGET_KEYS as readonly string[]).includes(key)) return true
  if (/^schedule:[\w-]{1,80}$/.test(key)) return true
  const m = ROAD_KEY.exec(key)
  if (!m) return false
  if (m[2] !== undefined) return m[2] in HAUL_TARGETS
  if (m[7] !== undefined) return m[7] in SUPPLY_TARGETS
  return true
}

/** The target for a key in this project, or null when what it names is gone (a deleted material). */
export function targetFor(
  project: RoadProject,
  key: string,
  scheduleItems: readonly ScheduleTemplateItem[] = [],
): AdoptionTarget | null {
  if ((SETTINGS_TARGET_KEYS as readonly string[]).includes(key)) {
    const k = key as SettingsTargetKey
    return { ...SETTINGS_TARGETS[k], key, group: 'Project rates', value: project.settings[k] }
  }
  if (key.startsWith('schedule:')) {
    const id = key.slice('schedule:'.length)
    const entry = project.costSchedule?.entries.find((item) => item.id === id)
    const template = [...GENERIC_SCHEDULE_ITEMS, ...scheduleItems].find((item) => item.id === id)
    const label = template?.label ?? entry?.label
    if (!label) return null
    const basis = entry?.basis ?? template?.basis ?? 'lump-sum'
    return {
      ...scheduleTarget({ id, label }, basis),
      key,
      group: 'Project budget',
      value: entry ? scheduleValue(entry, basis) : null,
    }
  }
  const m = ROAD_KEY.exec(key)
  const road = m && project.alignments.find((a) => a.id === m[1])
  if (!road?.engineering) return null
  return roadTargets(road, road.engineering).find((target) => target.key === key) ?? null
}

/** The project with one target set to `value`. Budget items become priced on their own basis. */
export function writeTarget(
  project: RoadProject,
  key: string,
  value: number,
  scheduleItems: readonly ScheduleTemplateItem[] = [],
): RoadProject {
  if ((SETTINGS_TARGET_KEYS as readonly string[]).includes(key))
    return { ...project, settings: { ...project.settings, [key]: value } }
  if (key.startsWith('schedule:')) {
    const id = key.slice('schedule:'.length)
    const target = targetFor(project, key, scheduleItems)
    if (!target) throw Error('That budget item is no longer in the project.')
    const entry = project.costSchedule?.entries.find((item) => item.id === id)
    const basis = entry?.basis ?? [...GENERIC_SCHEDULE_ITEMS, ...scheduleItems].find((i) => i.id === id)?.basis
    const resolved = basis ?? 'lump-sum'
    const next: ScheduleEntry = {
      ...entry,
      id,
      status: entry?.status === 'allowance' ? 'allowance' : 'priced',
      basis: resolved,
      ...(resolved === 'percent' ? { percent: value } : { amount: value }),
    }
    return { ...project, costSchedule: withEntry(project.costSchedule, next) }
  }
  const m = ROAD_KEY.exec(key)
  if (!m) throw Error(`Unknown rate ${key}.`)
  if (!targetFor(project, key)) throw Error('What this rate was for is no longer in the road.')
  return {
    ...project,
    alignments: project.alignments.map((road) => {
      if (road.id !== m[1] || !road.engineering) return road
      const e = road.engineering
      const engineering: AlignmentEngineering =
        m[2] !== undefined
          ? { ...e, haul: { ...e.haul, [m[2]]: value } }
          : m[3] !== undefined
            ? { ...e, materials: e.materials.map((x) => (x.id === m[3] ? { ...x, [m[4]]: value } : x)) }
            : m[5] !== undefined
              ? { ...e, sites: e.sites.map((x) => (x.id === m[5] ? { ...x, [m[6]]: value } : x)) }
              : m[7] !== undefined
                ? { ...e, surfacingSupply: { ...e.surfacingSupply!, [m[7]]: value } }
                : { ...e, culverts: e.culverts.map((x) => (x.id === m[8] ? { ...x, unitCost: value } : x)) }
      return { ...road, engineering }
    }),
  }
}

/** "CAD per bank m³ excavated" for the target in the project's currency. */
export const targetBasisText = (target: Pick<AdoptionTarget, 'basisText'>, currency: EvidenceCurrency) =>
  `${currency} ${target.basisText}`

/**
 * Where else this project prices a part of the work, for a price that includes it. Each line is
 * one finding: "Haul: the road's haul rates price it (overhaul 1.2/m³·km)".
 */
export function pricedElsewhere(project: RoadProject, part: WorkPart, exceptKey: string): string[] {
  const found: string[] = []
  const s = project.settings
  const road = project.alignments.find((a) => a.id === project.activeAlignmentId)
  const e = road?.engineering
  const add = (key: string, text: string, value: number | undefined | null) => {
    if (key !== exceptKey && (value ?? 0) > 0) found.push(text)
  }
  const roadKey = (k: string) => `${road?.id}/${k}`
  switch (part) {
    case 'excavation':
      add('cutRate', `the cut rate (${s.cutRate}/m³)`, s.cutRate)
      for (const m of e?.materials ?? [])
        add(roadKey(`material:${m.id}.cutRate`), `${m.name} excavation (${m.cutRate}/m³)`, m.cutRate)
      break
    case 'placement':
    case 'compaction':
      add('fillRate', `the fill rate (${s.fillRate}/m³)`, s.fillRate)
      add(roadKey('supply.placementRate'), 'the surfacing source’s placement', e?.surfacingSupply?.placementRate)
      break
    case 'haul':
      if (e?.haul.enabled)
        for (const k of ['freeHaulRate', 'overhaulRate', 'endHaulRate'] as const)
          add(roadKey(`haul.${k}`), `the road’s ${HAUL_TARGETS[k].label.toLowerCase()} (${e.haul[k]}/m³·km)`, e.haul[k])
      add(roadKey('supply.haulRate'), 'the surfacing source’s haul', e?.surfacingSupply?.haulRate)
      break
    case 'loading':
      if (e?.haul.enabled)
        for (const k of ['freeHaulLoadingRate', 'overhaulLoadingRate', 'endHaulLoadingRate'] as const)
          add(roadKey(`haul.${k}`), `the road’s ${HAUL_TARGETS[k].label.toLowerCase()}`, e.haul[k])
      add(roadKey('supply.loadingRate'), 'the surfacing source’s loading', e?.surfacingSupply?.loadingRate)
      break
    case 'supply':
      add(roadKey('haul.borrowRate'), 'the default borrow rate', e?.haul.borrowRate)
      for (const site of e?.sites ?? [])
        if (site.kind === 'borrow')
          add(roadKey(`site:${site.id}.unitRate`), `${site.name}’s borrow rate`, site.unitRate)
      add(roadKey('supply.acquisitionRate'), 'the surfacing source’s acquisition', e?.surfacingSupply?.acquisitionRate)
      break
    case 'processing':
      add(roadKey('supply.processingRate'), 'the surfacing source’s processing', e?.surfacingSupply?.processingRate)
      break
    case 'disposal':
      add(roadKey('haul.wasteRate'), 'the default waste rate', e?.haul.wasteRate)
      for (const site of e?.sites ?? [])
        if (site.kind === 'waste') add(roadKey(`site:${site.id}.unitRate`), `${site.name}’s waste rate`, site.unitRate)
      break
    case 'clearing':
      add('clearingRate', `the clearing rate (${s.clearingRate}/m²)`, s.clearingRate)
      break
    case 'installation':
      for (const c of e?.culverts ?? [])
        add(roadKey(`culvert:${c.id}.unitCost`), `${c.name}’s installed cost`, c.unitCost)
      break
    case 'mobilization':
      add(roadKey('haul.mobilizationCost'), 'the road’s mobilization line', e?.haul.mobilizationCost)
      {
        const entry = project.costSchedule?.entries.find((item) => item.id === 'mobilization')
        if (entry && (entry.status === 'priced' || entry.status === 'allowance'))
          add('schedule:mobilization', 'the budget’s mobilization item', entry.amount ?? entry.percent)
      }
      break
  }
  return found
}

/**
 * The overlaps a bundled price makes: each part it includes beyond what the target prices, that
 * another line of this project already prices. Empty when nothing is counted twice.
 */
export function adoptionOverlaps(
  project: RoadProject,
  target: AdoptionTarget,
  includes: readonly WorkPart[],
): string[] {
  return includes
    .filter((part) => !target.prices.includes(part))
    .flatMap((part) => {
      const lines = pricedElsewhere(project, part, target.key)
      return lines.length ? [`${WORK_PARTS[part]} is in this price and also in ${lines.join(', ')}.`] : []
    })
}
