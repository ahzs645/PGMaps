/**
 * Land status checks for the proposal: does a block (or the landform) overlap treaty land, an
 * Indian reserve, private land, a park or protected area, a community watershed, a legal old growth
 * management area, ungulate winter range, a wildlife habitat area or a recreation site? A check is a
 * screen for the reviewer, never a legal determination and never an input to the run: nothing here
 * writes a mask or changes a figure.
 *
 * Each check is a layer of the ground catalogue (`packages/legal-rules/ground/instruments.json`),
 * read through the catalogue's own reader (`src/lib/legal/groundLayerRead.ts`), the one the block
 * planner's *On this ground* uses: its layer, fields, filter (the instruments it holds; a context
 * layer, treaty land and reserves, read whole) and the cut of every record to those fields are the
 * catalogue's, defined once. The layer is read live from DataBC by the blocks' and the landform's own
 * parts (`INTERSECTS` per part, by POST), never their box, with the geometry field named in
 * `propertyName`; the overlap is measured here. What stays here is the page's: the cards' labels,
 * how a feature is named in a note and why it matters, and the measuring against each block.
 *
 * `fetch` is passed in: no DOM or network access of its own.
 */
import type { MetricSummaryItem } from '@/components/ui/metric-summary'
import type { Fetch } from '@/lib/forestry/wfsReads'
import { groundLayer, matches, type GroundLayer } from '@/lib/legal/groundInstruments'
import { layerInstruments, readGroundLayer } from '@/lib/legal/groundLayerRead'

import { overlapAreaMeters } from './resultsReserves'
import { polygonBounds, type PolygonGeometry } from './visibility'

/** Widest span read at once, degrees, as for ParcelMap BC: a landform's surroundings, not a district. */
export const MAX_LAND_CHECK_DEGREES = 0.4
/** Most features one layer's read keeps. */
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
  /**
   * The ground catalogue layer it reads (`groundLayer`). The check counts the records of every
   * instrument the layer holds, or the whole layer when it is a context layer.
   */
  layer: string
  /** A feature's name as the note lists it; reads only fields the catalogue layer keeps. */
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
    layer: 'treaty-lands',
    name: (p) => [text(p.FIRST_NATION_NAME), text(p.LAND_TYPE)].filter(Boolean).join(' · ') || 'Treaty land',
    why: 'Modern treaty settlement land: the First Nation owns it, and provincial forest tenure does not apply',
  },
  {
    id: 'reserve',
    label: 'Indian reserve',
    layer: 'indian-reserves',
    name: (p) => (text(p.ENGLISH_NAME) ? titleCase(text(p.ENGLISH_NAME)!) : 'Indian reserve'),
    why: 'Federal reserve land (Canada Lands Survey): outside provincial forest tenure',
  },
  {
    id: 'private',
    label: 'Private land',
    layer: 'private',
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
    layer: 'parks',
    name: (p) => (text(p.PROTECTED_LANDS_NAME) ? titleCase(text(p.PROTECTED_LANDS_NAME)!) : 'Park or protected area'),
    why: 'Provincial parks, ecological reserves and protected areas: no timber harvesting',
  },
  {
    id: 'watershed',
    label: 'Community watershed',
    layer: 'community-watersheds',
    name: (p) => text(p.CW_NAME) ?? text(p.CW_CODE) ?? 'Community watershed',
    why: 'A designated community watershed: FRPA water-quality objectives apply',
  },
  {
    id: 'ogma',
    label: 'Old growth management area',
    layer: 'ogma',
    name: (p) => (text(p.LEGAL_OGMA_PROVID) ? `OGMA ${text(p.LEGAL_OGMA_PROVID)}` : 'Legal OGMA'),
    why: 'Legal old growth management area: harvest is restricted',
  },
  {
    id: 'uwr',
    label: 'Ungulate winter range',
    layer: 'uwr',
    name: (p) =>
      [text(p.UWR_NUMBER), text(p.UWR_UNIT_NUMBER), text(p.SPECIES_1), text(p.TIMBER_HARVEST_CODE)]
        .filter(Boolean)
        .join(' · ') || 'Ungulate winter range',
    why: 'Approved ungulate winter range: its general wildlife measures limit harvest (timber harvest code)',
  },
  {
    id: 'wha',
    label: 'Wildlife habitat area',
    layer: 'wha',
    name: (p) =>
      [text(p.TAG), text(p.COMMON_SPECIES_NAME), text(p.TIMBER_HARVEST_CODE)].filter(Boolean).join(' · ') ||
      'Wildlife habitat area',
    why: 'Approved wildlife habitat area: its general wildlife measures limit harvest (timber harvest code)',
  },
  {
    id: 'recreation',
    label: 'Recreation site or trail',
    layer: 'recreation',
    name: (p) =>
      text(p.PROJECT_NAME) ? titleCase(text(p.PROJECT_NAME)!) : (text(p.FOREST_FILE_ID) ?? 'Recreation site'),
    why: 'An established recreation site or trail (FTEN): a sensitive viewpoint and a FRPA s. 56 objective',
  },
]

export const findLandCheck = (id: LandCheckId) => LAND_CHECKS.find((check) => check.id === id)!

/** The catalogue layer a check reads. */
export function landCheckLayer(check: LandCheckLayer): GroundLayer {
  const layer = groundLayer(check.layer)
  if (!layer) throw Error(`The ground catalogue has no layer ${check.layer}.`)
  return layer
}

/** Every DataBC layer the checks read, as the catalogue names it (`typeNames`). */
export const landCheckTypeNames = () => LAND_CHECKS.map((check) => landCheckLayer(check).typeName)

export type Box = [number, number, number, number]

export type LandFeature = { name: string; geometry: PolygonGeometry }

/**
 * One check's layer read against the shapes: the records of every instrument its catalogue layer
 * holds (the whole of a context layer), named as the note lists them. A read DataBC does not answer
 * throws; the card reads it as *Not read*.
 */
export async function readLandCheck(
  check: LandCheckLayer,
  footprint: PolygonGeometry,
  fetcher: Fetch,
  signal?: AbortSignal,
  maxFeatures = MAX_LAND_CHECK_FEATURES,
): Promise<{ features: LandFeature[]; truncated: boolean }> {
  const layer = landCheckLayer(check)
  const instruments = layerInstruments(layer)
  const answer = await readGroundLayer({ layer, instruments, footprint, fetch: fetcher, signal, cap: maxFeatures })
  const features = answer.rows.flatMap((row): LandFeature[] =>
    (row.geometry.type === 'Polygon' || row.geometry.type === 'MultiPolygon') &&
    (!instruments.length || instruments.some((x) => matches(x.where, row.properties)))
      ? [{ name: check.name(row.properties), geometry: row.geometry }]
      : [],
  )
  return { features, truncated: answer.status === 'truncated' }
}

const partsOf = (shape: PolygonGeometry) => (shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates)

/**
 * The shapes a check reads, as one footprint: the blocks and the landform, or the blocks alone when
 * the landform takes them past `MAX_LAND_CHECK_DEGREES` (then `landform` is `null`: it was not
 * read, and no figure is given for it). `null` when the blocks alone are too wide.
 */
export function landCheckFootprint(
  blocks: readonly PolygonGeometry[],
  landform: PolygonGeometry | null,
): { footprint: PolygonGeometry; landform: PolygonGeometry | null } | null {
  const union = (shapes: readonly PolygonGeometry[]) =>
    shapes.reduce<Box | null>((box, shape) => {
      const [w, s, e, n] = polygonBounds(shape)
      return box ? [Math.min(box[0], w), Math.min(box[1], s), Math.max(box[2], e), Math.max(box[3], n)] : [w, s, e, n]
    }, null)
  const fits = (box: Box | null) =>
    !!box && box[2] - box[0] <= MAX_LAND_CHECK_DEGREES && box[3] - box[1] <= MAX_LAND_CHECK_DEGREES
  const read = (shapes: readonly PolygonGeometry[]): PolygonGeometry => ({
    type: 'MultiPolygon',
    coordinates: shapes.flatMap(partsOf),
  })
  if (!blocks.length) return null
  if (landform && fits(union([...blocks, landform]))) return { footprint: read([...blocks, landform]), landform }
  return fits(union(blocks)) ? { footprint: read(blocks), landform: null } : null
}

export type LandCheckResult = {
  id: LandCheckId
  /** Hectares of each block over the layer, with the features it overlaps; only blocks that do. */
  blocks: Array<{ name: string; areaHa: number; features: string[] }>
  /** Hectares of the landform over the layer, when the landform was read; null when it was not. */
  landformHa: number | null
  /** The landform's overlapping features, when the blocks have none. */
  landformFeatures: string[]
  /** The layer held more features than one read keeps (`MAX_LAND_CHECK_FEATURES`): the check may have missed some. */
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

/** Reads one layer for the shapes (`landCheckFootprint`) and measures it against the blocks and landform. */
export async function runLandCheck(
  check: LandCheckLayer,
  footprint: PolygonGeometry,
  blocks: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>,
  landform: PolygonGeometry | null,
  fetcher: Fetch,
  signal?: AbortSignal,
): Promise<LandCheckResult> {
  const { features, truncated } = await readLandCheck(check, footprint, fetcher, signal)
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

/** What a printed file says about the checks, in every place it carries them. */
export const LAND_CHECK_CAVEAT =
  'A screen read live from DataBC when this file was written, not a legal determination. Not read means the layer could not be read: check it by hand.'

export type LandCheckReportRow = {
  label: string
  value: string
  note: string
  /** Overlaps a block, or could not be read: the reviewer looks at it. */
  review: boolean
  /** Still reading: the file would print it as Not read. */
  reading: boolean
}

/**
 * The checks as a file prints them: one row per layer, in the cards' order. A layer still reading
 * when the file is written reads *Not read*, as a failed one does, never *None*.
 */
export function landCheckReportRows(
  states: Partial<Record<LandCheckId, LandCheckState>>,
  context: { unchecked: string | null },
): LandCheckReportRow[] {
  if (context.unchecked)
    return [{ label: 'Land checks', value: 'Not checked', note: context.unchecked, review: true, reading: false }]
  return LAND_CHECKS.map((check) => {
    const state = states[check.id]
    if (!state || state.status === 'loading')
      return {
        label: check.label,
        value: 'Not read',
        note: 'Still reading when this file was written.',
        review: true,
        reading: true,
      }
    const summary = landCheckSummary(check, state)
    return {
      label: check.label,
      value: summary.value,
      note: summary.note,
      review: state.status === 'error' || state.result.blocks.length > 0,
      reading: false,
    }
  })
}

/** How many layers are still reading. */
export const landChecksPending = (states: Partial<Record<LandCheckId, LandCheckState>>) =>
  LAND_CHECKS.filter((check) => !states[check.id] || states[check.id]!.status === 'loading').length
