/**
 * Land status checks for the proposal: does a block (or the landform) overlap treaty land, an
 * Indian reserve, private land, a park or protected area, a community watershed, a legal old growth
 * management area, ungulate winter range, a wildlife habitat area or a recreation site? Each layer
 * is read live from DataBC's WFS for the box around the blocks and landform, and the overlap is
 * measured here. A check is a screen for the reviewer, never a legal determination and never an
 * input to the run: nothing here writes a mask or changes a figure.
 *
 * As in `bcVegetationInventory.ts`, the box goes in `CQL_FILTER`, longitude first, never the
 * latitude-first WFS `bbox` parameter, and `propertyName` stays narrow but must name the geometry
 * field, or the features come back without shapes. `fetch` is passed in: no DOM or network access
 * of its own.
 */
import type { MetricSummaryItem } from '@/components/ui/metric-summary'

import { overlapAreaMeters } from './resultsReserves'
import { polygonBounds, type PolygonGeometry } from './visibility'

export const LAND_CHECK_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
/** Widest box asked for, degrees, as for ParcelMap BC: a landform's surroundings, not a district. */
export const MAX_LAND_CHECK_DEGREES = 0.4
/** Most features one layer's answer holds. */
export const MAX_LAND_CHECK_FEATURES = 300

export type LandCheckId =
  | 'treaty'
  | 'reserve'
  | 'private'
  | 'park'
  | 'watershed'
  | 'ogma'
  | 'uwr'
  | 'wha'
  | 'recreation'

type Props = Record<string, unknown>

export type LandCheckLayer = {
  id: LandCheckId
  /** The card's label. */
  label: string
  typeName: string
  geometryField: string
  fields: string[]
  /** An extra CQL condition, ANDed with the box. */
  filter?: string
  /** A feature's name as the note lists it. */
  name: (props: Props) => string
  /** Why it matters to a cutblock, for the card's note. */
  why: string
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
const titleCase = (value: string) => value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())

export const LAND_CHECKS: readonly LandCheckLayer[] = [
  {
    id: 'treaty',
    label: 'Treaty land',
    typeName: 'WHSE_LEGAL_ADMIN_BOUNDARIES.FNT_TREATY_LAND_SP',
    geometryField: 'GEOMETRY',
    fields: ['FIRST_NATION_NAME', 'TREATY', 'LAND_TYPE'],
    name: (p) => [text(p.FIRST_NATION_NAME), text(p.LAND_TYPE)].filter(Boolean).join(' · ') || 'Treaty land',
    why: 'Modern treaty settlement land: the First Nation owns it, and provincial forest tenure does not apply',
  },
  {
    id: 'reserve',
    label: 'Indian reserve',
    typeName: 'WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES',
    geometryField: 'GEOMETRY',
    fields: ['ENGLISH_NAME'],
    name: (p) => (text(p.ENGLISH_NAME) ? titleCase(text(p.ENGLISH_NAME)!) : 'Indian reserve'),
    why: 'Federal reserve land (Canada Lands Survey): outside provincial forest tenure',
  },
  {
    id: 'private',
    label: 'Private land',
    typeName: 'WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW',
    geometryField: 'SHAPE',
    fields: ['PID_FORMATTED', 'PLAN_NUMBER', 'OWNER_TYPE'],
    filter: "OWNER_TYPE='Private'",
    name: (p) =>
      text(p.PID_FORMATTED)
        ? `PID ${text(p.PID_FORMATTED)}`
        : text(p.PLAN_NUMBER)
          ? `Plan ${text(p.PLAN_NUMBER)}`
          : 'Private parcel',
    why: 'ParcelMap BC private parcels: not Crown land; in a landform it can leave the denominator (step 3, Private land)',
  },
  {
    id: 'park',
    label: 'Park or protected area',
    typeName: 'WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW',
    geometryField: 'SHAPE',
    fields: ['PROTECTED_LANDS_NAME', 'PROTECTED_LANDS_DESIGNATION'],
    name: (p) => (text(p.PROTECTED_LANDS_NAME) ? titleCase(text(p.PROTECTED_LANDS_NAME)!) : 'Park or protected area'),
    why: 'Provincial parks, ecological reserves and protected areas: no timber harvesting',
  },
  {
    id: 'watershed',
    label: 'Community watershed',
    typeName: 'WHSE_WATER_MANAGEMENT.WLS_COMMUNITY_WS_PUB_SVW',
    geometryField: 'SHAPE',
    fields: ['CW_NAME', 'CW_CODE'],
    name: (p) => text(p.CW_NAME) ?? text(p.CW_CODE) ?? 'Community watershed',
    why: 'A designated community watershed: FRPA water-quality objectives apply',
  },
  {
    id: 'ogma',
    label: 'Old growth management area',
    typeName: 'WHSE_LAND_USE_PLANNING.RMP_OGMA_LEGAL_CURRENT_SVW',
    geometryField: 'GEOMETRY',
    fields: ['LEGAL_OGMA_PROVID', 'OGMA_TYPE'],
    name: (p) => (text(p.LEGAL_OGMA_PROVID) ? `OGMA ${text(p.LEGAL_OGMA_PROVID)}` : 'Legal OGMA'),
    why: 'Legal old growth management area: harvest is restricted',
  },
  {
    id: 'uwr',
    label: 'Ungulate winter range',
    typeName: 'WHSE_WILDLIFE_MANAGEMENT.WCP_UNGULATE_WINTER_RANGE_SP',
    geometryField: 'GEOMETRY',
    fields: ['UWR_NUMBER', 'UWR_UNIT_NUMBER', 'SPECIES_1', 'TIMBER_HARVEST_CODE'],
    name: (p) =>
      [text(p.UWR_NUMBER), text(p.UWR_UNIT_NUMBER), text(p.SPECIES_1), text(p.TIMBER_HARVEST_CODE)]
        .filter(Boolean)
        .join(' · ') || 'Ungulate winter range',
    why: 'Approved ungulate winter range: its general wildlife measures limit harvest (timber harvest code)',
  },
  {
    id: 'wha',
    label: 'Wildlife habitat area',
    typeName: 'WHSE_WILDLIFE_MANAGEMENT.WCP_WILDLIFE_HABITAT_AREA_POLY',
    geometryField: 'GEOMETRY',
    fields: ['TAG', 'COMMON_SPECIES_NAME', 'TIMBER_HARVEST_CODE'],
    name: (p) =>
      [text(p.TAG), text(p.COMMON_SPECIES_NAME), text(p.TIMBER_HARVEST_CODE)].filter(Boolean).join(' · ') ||
      'Wildlife habitat area',
    why: 'Approved wildlife habitat area: its general wildlife measures limit harvest (timber harvest code)',
  },
  {
    id: 'recreation',
    label: 'Recreation site or trail',
    typeName: 'WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW',
    geometryField: 'GEOMETRY',
    fields: ['PROJECT_NAME', 'FOREST_FILE_ID', 'RETIREMENT_DATE'],
    filter: 'RETIREMENT_DATE IS NULL',
    name: (p) =>
      text(p.PROJECT_NAME) ? titleCase(text(p.PROJECT_NAME)!) : (text(p.FOREST_FILE_ID) ?? 'Recreation site'),
    why: 'An established recreation site or trail (FTEN): a sensitive viewpoint and a FRPA s. 56 objective',
  },
]

export const findLandCheck = (id: LandCheckId) => LAND_CHECKS.find((check) => check.id === id)!

export type Box = [number, number, number, number]

export function landCheckUrl(check: LandCheckLayer, bounds: Box, maxFeatures = MAX_LAND_CHECK_FEATURES): string {
  const [w, s, e, n] = bounds.map((value) => Number(value.toFixed(6)))
  if (!(e > w && n > s)) throw new Error('Choose an area to check.')
  const box = `BBOX(${check.geometryField},${w},${s},${e},${n},'EPSG:4326')`
  return `${LAND_CHECK_WFS}?${new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: check.typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    propertyName: [...check.fields, check.geometryField].join(','),
    CQL_FILTER: check.filter ? `${check.filter} AND ${box}` : box,
  }).toString()}`
}

export type LandFeature = { name: string; geometry: PolygonGeometry }

export function parseLandFeatures(
  check: LandCheckLayer,
  payload: unknown,
  maxFeatures = MAX_LAND_CHECK_FEATURES,
): { features: LandFeature[]; truncated: boolean } {
  const collection = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(collection?.features)) return { features: [], truncated: false }
  const features = collection.features.flatMap((entry): LandFeature[] => {
    const feature = entry as { geometry?: PolygonGeometry | null; properties?: Props }
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []
    return [{ name: check.name(feature.properties ?? {}), geometry }]
  })
  const matched = typeof collection.numberMatched === 'number' ? collection.numberMatched : null
  return { features, truncated: features.length >= maxFeatures || (matched !== null && matched > features.length) }
}

/** The box a check reads: the blocks and the landform, or the blocks alone when the landform is too wide. */
export function landCheckBounds(blocks: readonly PolygonGeometry[], landform: PolygonGeometry | null): Box | null {
  const union = (shapes: readonly PolygonGeometry[]) =>
    shapes.reduce<Box | null>((box, shape) => {
      const [w, s, e, n] = polygonBounds(shape)
      return box ? [Math.min(box[0], w), Math.min(box[1], s), Math.max(box[2], e), Math.max(box[3], n)] : [w, s, e, n]
    }, null)
  const fits = (box: Box | null) =>
    !!box && box[2] - box[0] <= MAX_LAND_CHECK_DEGREES && box[3] - box[1] <= MAX_LAND_CHECK_DEGREES
  const all = union([...blocks, ...(landform ? [landform] : [])])
  if (fits(all)) return all
  const blocksOnly = union(blocks)
  return fits(blocksOnly) ? blocksOnly : null
}

export type LandCheckResult = {
  id: LandCheckId
  /** Hectares of each block over the layer, with the features it overlaps; only blocks that do. */
  blocks: Array<{ name: string; areaHa: number; features: string[] }>
  /** Hectares of the landform over the layer, when the landform was read; null when it was not. */
  landformHa: number | null
  /** The landform's overlapping features, when the blocks have none. */
  landformFeatures: string[]
  /** The layer held more features than one answer returns: the check may have missed some. */
  truncated: boolean
}

/** Smallest overlap counted, hectares: slivers from boundaries drawn at different scales are not overlaps. */
export const MIN_OVERLAP_HA = 0.05

const boxesMeet = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** How much of each block, and of the landform, a layer's features cover. */
export function measureLandCheck(
  id: LandCheckId,
  features: readonly LandFeature[],
  blocks: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>,
  landform: PolygonGeometry | null,
  truncated = false,
): LandCheckResult {
  const boxed = features.map((feature) => ({ ...feature, box: polygonBounds(feature.geometry) as Box }))
  const overlap = (shape: PolygonGeometry) => {
    const box = polygonBounds(shape) as Box
    let meters = 0
    const names = new Set<string>()
    for (const feature of boxed) {
      if (!boxesMeet(box, feature.box)) continue
      const shared = overlapAreaMeters(shape, feature.geometry)
      if (shared / 10_000 >= MIN_OVERLAP_HA) {
        meters += shared
        names.add(feature.name)
      }
    }
    return { areaHa: meters / 10_000, names: [...names] }
  }
  const blockResults = blocks.flatMap((block) => {
    const { areaHa, names } = overlap(block.geometry)
    return areaHa >= MIN_OVERLAP_HA ? [{ name: block.name, areaHa, features: names }] : []
  })
  const landformOverlap = landform ? overlap(landform) : null
  return {
    id,
    blocks: blockResults,
    landformHa: landformOverlap ? landformOverlap.areaHa : null,
    landformFeatures: landformOverlap?.names ?? [],
    truncated,
  }
}

/** Reads one layer for the box and measures it against the blocks and landform. */
export async function runLandCheck(
  check: LandCheckLayer,
  bounds: Box,
  blocks: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>,
  landform: PolygonGeometry | null,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<LandCheckResult> {
  const response = await fetcher(landCheckUrl(check, bounds), { signal })
  if (!response.ok) throw new Error(`DataBC answered ${response.status}.`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('DataBC refused the query.')
  const { features, truncated } = parseLandFeatures(check, payload)
  return measureLandCheck(check.id, features, blocks, landform, truncated)
}

export type LandCheckState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; result: LandCheckResult }

const ha = (value: number) =>
  `${value.toLocaleString('en-CA', { minimumFractionDigits: value < 10 ? 1 : 0, maximumFractionDigits: value < 10 ? 1 : 0 })} ha`

/** Names in a note: the first few, then how many more. */
const listNames = (names: readonly string[], shown = 4) =>
  names.length > shown ? `${names.slice(0, shown).join(', ')} and ${names.length - shown} more` : names.join(', ')

/** A check as a card reads it: a short value, a tone, and the note that says what was found. */
export function landCheckSummary(check: LandCheckLayer, state: LandCheckState | undefined) {
  if (!state || state.status === 'loading') return { value: 'Checking…', tone: 'muted' as const, note: check.why }
  if (state.status === 'error')
    return { value: 'Not read', tone: 'warning' as const, note: `${check.label} could not be read: ${state.error}` }
  const { result } = state
  const partial = result.truncated ? ' More features than one answer holds: some may be missing.' : ''
  if (result.blocks.length) {
    const total = result.blocks.reduce((sum, block) => sum + block.areaHa, 0)
    return {
      value: `${ha(total)} in ${result.blocks.length === 1 ? result.blocks[0].name : `${result.blocks.length} blocks`}`,
      tone: 'warning' as const,
      note: `${result.blocks
        .map((block) => `${block.name}: ${ha(block.areaHa)} over ${listNames(block.features)}`)
        .join('; ')}. ${check.why}.${partial}`,
    }
  }
  if (result.landformHa !== null && result.landformHa >= MIN_OVERLAP_HA)
    return {
      value: `In the landform · ${ha(result.landformHa)}`,
      tone: 'default' as const,
      note: `No block overlaps it; the landform holds ${listNames(result.landformFeatures)}. ${check.why}.${partial}`,
    }
  return {
    value: 'None',
    tone: 'default' as const,
    note: `No block${result.landformHa !== null ? ' or landform' : ''} overlaps it. ${check.why}.${partial}`,
  }
}

/**
 * The checks as Viewpoint summary cards: `checks` sums them up, and each check has a card of its
 * own (`check-<id>`), hidden until the reviewer shows it in the summary's settings.
 */
export function landCheckMetrics(
  states: Partial<Record<LandCheckId, LandCheckState>>,
  context: { unchecked: string | null },
): MetricSummaryItem[] {
  if (context.unchecked)
    return [
      {
        key: 'checks',
        label: 'Land checks',
        qualifier: 'blocks and landform',
        value: 'Not checked',
        note: context.unchecked,
        tone: 'muted',
      },
    ]
  const summaries = LAND_CHECKS.map((check) => ({ check, ...landCheckSummary(check, states[check.id]) }))
  const loading = LAND_CHECKS.filter((check) => !states[check.id] || states[check.id]!.status === 'loading').length
  const overlaps = LAND_CHECKS.filter((check) => {
    const state = states[check.id]
    return state?.status === 'ready' && state.result.blocks.length > 0
  })
  const failed = LAND_CHECKS.filter((check) => states[check.id]?.status === 'error').length
  const value = overlaps.length
    ? `${overlaps.length} to review`
    : loading
      ? 'Checking…'
      : failed
        ? `Clear · ${failed} not read`
        : 'Clear'
  return [
    {
      key: 'checks',
      label: 'Land checks',
      qualifier: 'blocks and landform',
      value,
      note: `${summaries.map((entry) => `${entry.check.label}: ${entry.value}`).join(' · ')}. A screen from DataBC, not a legal determination.`,
      tone: overlaps.length || failed ? 'warning' : loading ? 'muted' : 'success',
    },
    ...summaries.map((entry) => ({
      key: `check-${entry.check.id}`,
      label: entry.check.label,
      qualifier: 'overlap',
      value: entry.value,
      note: entry.note,
      tone: entry.tone,
    })),
  ]
}
