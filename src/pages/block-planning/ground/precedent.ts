/**
 * Precedent for "On this ground": what the public records hold has already happened inside each
 * instrument found on the block, near the block. Openings are read once, by the hull of each part of
 * the footprint grown by `PRECEDENT_RADIUS_METRES`, then kept for an instrument where they share
 * ground with one of its features clipped to that grown footprint, and were harvested on or after
 * that feature's effective date where its layer gives one. Standards units, planting results and site
 * preparation and planting activities are then joined by `OPENING_ID`.
 *
 * Three public signals of an exception sit beside them: openings in the category RESULTS keeps for
 * harvests with no reforestation obligation (`SPEX`), standards units with no regeneration obligation
 * or under an approved variation, and Forest Tenures cut blocks marked exempt from a silviculture
 * prescription (`SP_EXEMPT_IND`), read and kept like the openings. For the Agricultural Land Reserve,
 * the Commission's applications and notices of intent near the block are read as its precedent.
 *
 * It is evidence of what was allowed and done nearby, never a finding that the block may be cut or
 * reforested, and a signal says only what the record says, never why. A read that failed is "Not
 * read", never none. `CLIENT_NAME`, `CLIENT_NUMBER` (a client can be a private person), an ALR
 * application's `APPLICANT_NAME` and every IDIR user field are never requested, and are dropped on
 * arrival where DataBC sends them anyway.
 *
 * DOM- and network-free: `fetch` and the overlays are passed in.
 */
import type { Shape } from '../plan'
import { readAcrossParts, wfsRead, type Fetch, type RawFeature } from '../wfsReads'
import type { GroundOverlay } from './groundRead'
import {
  MAX_PRECEDENT_OPENINGS,
  type GroundPrecedent,
  type PrecedentAlrApplication,
  type PrecedentCutBlock,
  type PrecedentOpening,
  type PrecedentRow,
  type ReadStatus,
} from './record'

/**
 * How far round the block precedent is looked for: 5 km. Near enough that the openings share the
 * block's climate, soils, range use and district office, so what was allowed and done there speaks
 * to the block; wide enough to hold a few dozen openings in settled country (107 within 5.3 km of
 * the test square east of Prince George on 24 November 2026). A stated screen, not a rule.
 */
export const PRECEDENT_RADIUS_METRES = 5000
/** Openings joined to the other RESULTS layers per request. */
export const OPENING_BATCH = 200

export const OPENING_LAYER = 'pub:WHSE_FOREST_VEGETATION.RSLT_OPENING_SVW'
export const STANDARDS_UNIT_LAYER = 'pub:WHSE_FOREST_VEGETATION.RSLT_STANDARDS_UNIT_SVW'
export const PLANTING_LAYER = 'pub:WHSE_FOREST_VEGETATION.RSLT_PLANTING_SVW'
export const ACTIVITY_LAYER = 'pub:WHSE_FOREST_VEGETATION.RSLT_ACTIVITY_TREATMENT_SVW'
export const CUT_BLOCK_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'
export const ALR_APPLICATION_LAYER = 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.OATS_ALR_APPLICATIONS_SVW'
export const ALR_NOTICE_LAYER = 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.OATS_ALR_NOI_SV'

/**
 * Opening categories that carry no obligation to reforest, as the RESULTS information submission
 * specifications (edition 8a, 2025, Table 1) define them. `SPEX`: "Areas under tenure that are exempt
 * from site plan requirements under FPPR s33(1)"; "No reforestation or free-growing obligations
 * exist." No other category in the table says so (NREQ is not under tenure; EXCLU is land taken out
 * of Crown-managed forest).
 */
export const NO_OBLIGATION_CATEGORIES: Record<string, string> = {
  SPEX: 'exempt from site plan requirements under FPPR s. 33(1); no reforestation or free-growing obligation',
}

/** The instruments whose precedent includes the Commission's applications and notices of intent. */
export const ALR_PRECEDENT_INSTRUMENTS = ['alr']

/** Narrow on purpose: never `CLIENT_NAME`, `CLIENT_NUMBER` or a `*_WHO_*`, `*_USER` or `SUBMITTED_BY_USERID` field. */
export const OPENING_FIELDS = [
  'OPENING_ID',
  'MAP_LABEL',
  'OPENING_CATEGORY_CODE',
  'OPENING_STATUS_CODE',
  'FOREST_FILE_ID',
  'FILE_TYPE_CODE',
  'CUTTING_PERMIT_ID',
  'CUT_BLOCK_ID',
  'OPENING_GROSS_AREA',
  'DISTURBANCE_START_DATE',
  'DISTURBANCE_END_DATE',
  'DENUDATION_1_DISTURBANCE_CODE',
  'DENUDATION_1_SILV_SYSTEM_CODE',
  'DENUDATION_1_COMPLETION_DATE',
  'DENUDATION_2_DISTURBANCE_CODE',
  'DENUDATION_2_SILV_SYSTEM_CODE',
  'DENUDATION_2_COMPLETION_DATE',
]
export const STANDARDS_FIELDS = [
  'STOCKING_STANDARD_UNIT_ID',
  'OPENING_ID',
  'STANDARDS_UNIT_ID',
  'NET_AREA',
  'REGEN_OBLIGATION_IND',
  'REGEN_DUE_LATE_DATE',
  'REGEN_DECLARED_IND',
  'REGEN_DECLARED_DATE',
  'FREE_GROW_DUE_EARLY_DATE',
  'FREE_GROW_DUE_LATE_DATE',
  'FREE_GROW_DECLARED_IND',
  'FREE_GROW_DECLARED_DATE',
  'I_MIN_STOCKING_STANDARD',
  'I_MIN_PREF_STOCKING_STANDARD',
  'I_TARGET_STOCKING',
  'I_PREFERRED_SPECIES1',
  'I_PREFERRED_SPECIES2',
  'I_PREFERRED_SPECIES3',
  'I_PREFERRED_SPECIES4',
  'I_PREFERRED_SPECIES5',
  'VARIANCE_IND',
  'STANDARDS_UNIT_TYPE',
  'NO_REGEN_DUE_LATE_DATE',
  'NO_REGEN_DECLARED_IND',
  'NO_REGEN_DECLARED_DATE',
]
/** Narrow on purpose: never `CLIENT_NAME` or `CLIENT_NUMBER`. */
export const CUT_BLOCK_FIELDS = [
  'CUT_BLOCK_SKEY',
  'CUT_BLOCK_FOREST_FILE_ID',
  'TIMBER_MARK',
  'HARVEST_AUTH_CUTTING_PERMIT_ID',
  'CUT_BLOCK_ID',
  'BLOCK_STATUS_CODE',
  'LIFE_CYCLE_STATUS_CODE',
  'OPENING_ID',
  'DISTURBANCE_START_DATE',
  'PLANNED_GROSS_BLOCK_AREA',
  'SP_EXEMPT_IND',
]
/** Never `APPLICANT_NAME`. */
export const ALR_APPLICATION_FIELDS = [
  'ALR_APPLICATION_ID',
  'RECEIVED_DATE',
  'APPLICATION_CLASS_CODE',
  'PROPOSAL_COMPONENT_TYPE',
  'LOCAL_GOVERNMENT',
]
export const PLANTING_FIELDS = [
  'OPENING_ID',
  'ACTIVITY_TREATMENT_UNIT_ID',
  'PLANTING_RESULTS_SEQ_NUMBER',
  'ATU_COMPLETION_DATE',
  'SILV_TREE_SPECIES_CODE',
  'NUMBER_PLANTED',
]
export const ACTIVITY_FIELDS = [
  'OPENING_ID',
  'ACTIVITY_TREATMENT_UNIT_ID',
  'SILV_BASE_CODE',
  'SILV_TECHNIQUE_CODE',
  'SILV_METHOD_CODE',
  'ATU_COMPLETION_DATE',
  'ACTUAL_TREATMENT_AREA',
  'ACTUAL_PLANTED_NUMBER',
]

export interface PrecedentRegion {
  instrument: string
  feature: string
  /** The feature's effective date, `null` where the layer or the record has none. */
  effective: string | null
  geometry: Shape
}

type Props = Record<string, unknown>

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dayOf = (v: unknown) => {
  const m = typeof v === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(v) : null
  return m ? m[0] : null
}
const pick = (p: Props | null | undefined, fields: readonly string[]) => {
  const out: Props = {}
  for (const f of fields) if (p && p[f] !== undefined) out[f] = p[f]
  return out
}
const aborted = (signal: AbortSignal | undefined, e: unknown) =>
  Boolean(signal?.aborted) || (e instanceof Error && e.name === 'AbortError')
const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
const thousands = new Intl.NumberFormat('en-CA')

/** The harvest an opening records: its start, else its first denudation's completion. */
export const harvestedOn = (p: Props) =>
  dayOf(p.DISTURBANCE_START_DATE) ?? dayOf(p.DENUDATION_1_COMPLETION_DATE) ?? undefined

/** Records joined by opening, in batches, kept to the fields listed. */
async function joined(
  fetch: Fetch,
  signal: AbortSignal | undefined,
  layer: string,
  ids: number[],
  fields: readonly string[],
  sortBy: string,
  extra?: string,
): Promise<Props[]> {
  const out: Props[] = []
  for (let i = 0; i < ids.length; i += OPENING_BATCH) {
    const batch = ids.slice(i, i + OPENING_BATCH)
    const { features, truncated } = await wfsRead({
      fetch,
      signal,
      layer,
      filter: `OPENING_ID IN (${batch.join(',')})${extra ? ` AND ${extra}` : ''}`,
      propertyName: fields.join(','),
      sortBy,
      cap: 20_000,
    })
    if (truncated) throw Error(`More than 20,000 ${layer.replace(/^pub:/, '')} records for these openings.`)
    out.push(...features.map((f) => pick(f.properties, fields)))
  }
  return out
}

async function attempt<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (e) {
    if (aborted(signal, e)) throw e
    return null
  }
}

const byOpening = (rows: Props[] | null) => {
  const map = new Map<number, Props[]>()
  for (const r of rows ?? []) {
    const id = numberOf(r.OPENING_ID)
    if (id === null) continue
    if (!map.has(id)) map.set(id, [])
    map.get(id)!.push(r)
  }
  return map
}

function denudations(p: Props): string[] {
  return [1, 2].flatMap((n) => {
    const code = str(p[`DENUDATION_${n}_DISTURBANCE_CODE`])
    if (!code) return []
    const system = str(p[`DENUDATION_${n}_SILV_SYSTEM_CODE`])
    const done = dayOf(p[`DENUDATION_${n}_COMPLETION_DATE`])
    return [[code, system, done ? `completed ${done}` : 'completion not recorded'].filter(Boolean).join(' · ')]
  })
}

/** Trees planted by species, the seedlots of one species added together, in the order RESULTS lists them. */
function bySpecies(species: Props[]): string {
  const totals = new Map<string, number>()
  for (const s of species) {
    const code = str(s.SILV_TREE_SPECIES_CODE) ?? '?'
    totals.set(code, (totals.get(code) ?? 0) + (numberOf(s.NUMBER_PLANTED) ?? 0))
  }
  return [...totals].map(([code, n]) => `${code} ${thousands.format(n)}`).join(', ')
}

function activityLine(a: Props, species?: Props[]): string {
  const what = [str(a.SILV_TECHNIQUE_CODE), str(a.SILV_METHOD_CODE)].filter(Boolean).join(' ') || 'Technique not stated'
  const done = dayOf(a.ATU_COMPLETION_DATE)
  const area = numberOf(a.ACTUAL_TREATMENT_AREA)
  const planted = numberOf(a.ACTUAL_PLANTED_NUMBER)
  // Trees belong to planting only: site preparation records carry a planted number of 0.
  const trees =
    a.SILV_BASE_CODE === 'SP'
      ? null
      : species?.length
        ? bySpecies(species)
        : planted !== null
          ? `${thousands.format(planted)} trees`
          : null
  return [what, done ?? 'not completed', area !== null ? `${area} ha` : null, trees].filter(Boolean).join(' · ')
}

function standardsLine(s: Props): string {
  const id = str(s.STANDARDS_UNIT_ID) ?? '?'
  const net = numberOf(s.NET_AREA)
  const regen =
    s.REGEN_DECLARED_IND === 'Y'
      ? `regeneration declared ${dayOf(s.REGEN_DECLARED_DATE) ?? '(date not recorded)'}`
      : `regeneration not declared${dayOf(s.REGEN_DUE_LATE_DATE) ? ` (due ${dayOf(s.REGEN_DUE_LATE_DATE)})` : ''}`
  const fgDue = [dayOf(s.FREE_GROW_DUE_EARLY_DATE), dayOf(s.FREE_GROW_DUE_LATE_DATE)].filter(Boolean).join(' to ')
  const fg =
    s.FREE_GROW_DECLARED_IND === 'Y'
      ? `free growing declared ${dayOf(s.FREE_GROW_DECLARED_DATE) ?? '(date not recorded)'}`
      : `free growing not declared${fgDue ? ` (due ${fgDue})` : ''}`
  const min = numberOf(s.I_MIN_STOCKING_STANDARD)
  const pref = numberOf(s.I_MIN_PREF_STOCKING_STANDARD)
  const target = numberOf(s.I_TARGET_STOCKING)
  const stocking =
    min !== null || target !== null
      ? `stocking minimum ${min ?? '—'}${pref !== null ? ` (${pref} preferred)` : ''}, target ${target ?? '—'} stems/ha`
      : null
  const species = [1, 2, 3, 4, 5].map((n) => str(s[`I_PREFERRED_SPECIES${n}`])).filter(Boolean)
  const noRegen =
    s.NO_REGEN_DECLARED_IND === 'Y'
      ? `no-regeneration milestone declared ${dayOf(s.NO_REGEN_DECLARED_DATE) ?? '(date not recorded)'}`
      : dayOf(s.NO_REGEN_DUE_LATE_DATE)
        ? `no-regeneration milestone due ${dayOf(s.NO_REGEN_DUE_LATE_DATE)}`
        : null
  return [
    `Standards unit ${id}${net !== null ? ` · ${net} ha` : ''}`,
    s.REGEN_OBLIGATION_IND === 'N'
      ? ['no regeneration obligation (intermediate cut or selection system, FPPR s. 44(4))', noRegen]
          .filter(Boolean)
          .join(' · ')
      : regen,
    s.REGEN_OBLIGATION_IND === 'N' ? null : fg,
    s.VARIANCE_IND === 'Y' ? 'under an approved variation' : null,
    stocking,
    species.length ? `preferred ${species.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Builds each opening's record from the opening and its joins. Exported for the tests. */
export function describeOpening(
  p: Props,
  joins: { standards: Props[] | null; planting: Props[] | null; activities: Props[] | null },
): PrecedentOpening {
  const id = numberOf(p.OPENING_ID) ?? 0
  const activities = joins.activities ?? []
  const sitePrep = activities.filter((a) => a.SILV_BASE_CODE === 'SP').map((a) => activityLine(a))
  const plantingActs = activities.filter((a) => a.SILV_BASE_CODE === 'PL')
  const results = joins.planting ?? []
  const resultsFor = (unit: unknown) => results.filter((r) => r.ACTIVITY_TREATMENT_UNIT_ID === unit)
  const planting = plantingActs.length
    ? plantingActs.map((a) => activityLine(a, resultsFor(a.ACTIVITY_TREATMENT_UNIT_ID)))
    : // Without the activity read, the planting results still say what was planted and when.
      [...new Set(results.map((r) => r.ACTIVITY_TREATMENT_UNIT_ID))].map((unit) =>
        activityLine(
          { SILV_TECHNIQUE_CODE: 'PL', ATU_COMPLETION_DATE: resultsFor(unit)[0]?.ATU_COMPLETION_DATE },
          resultsFor(unit),
        ),
      )
  const completedPlanting = plantingActs.some((a) => dayOf(a.ATU_COMPLETION_DATE)) || results.length > 0
  const standards = joins.standards ?? []
  const out: PrecedentOpening = {
    openingId: id,
    denudation: denudations(p),
    sitePrep,
    planting,
    planted: completedPlanting ? true : joins.activities && joins.planting ? false : null,
    standards: standards.map(standardsLine),
    freeGrowing: standards.some((s) => s.FREE_GROW_DECLARED_IND === 'Y') ? true : joins.standards ? false : null,
  }
  const text = (key: keyof PrecedentOpening, v: unknown) => {
    const s = str(v)
    if (s) (out as unknown as Record<string, unknown>)[key] = s.slice(0, 100)
  }
  text('mapLabel', p.MAP_LABEL)
  text('forestFileId', p.FOREST_FILE_ID)
  text('fileType', p.FILE_TYPE_CODE)
  text('cuttingPermit', p.CUTTING_PERMIT_ID)
  text('cutBlock', p.CUT_BLOCK_ID)
  text('category', p.OPENING_CATEGORY_CODE)
  text('status', p.OPENING_STATUS_CODE)
  const gross = numberOf(p.OPENING_GROSS_AREA)
  if (gross !== null && gross >= 0) out.grossHa = gross
  const harvested = harvestedOn(p)
  if (harvested) out.harvested = harvested
  if (joins.standards) {
    out.noRegenObligation = standards.some((s) => s.REGEN_OBLIGATION_IND === 'N')
    out.variance = standards.some((s) => s.VARIANCE_IND === 'Y')
  }
  return out
}

/** An exempt cut block as the record keeps it. Exported for the tests. */
export function describeCutBlock(p: Props): PrecedentCutBlock {
  const out: PrecedentCutBlock = { key: numberOf(p.CUT_BLOCK_SKEY) ?? 0 }
  const text = (key: keyof PrecedentCutBlock, v: unknown) => {
    const s = str(v)
    if (s) (out as unknown as Record<string, unknown>)[key] = s.slice(0, 100)
  }
  text('forestFileId', p.CUT_BLOCK_FOREST_FILE_ID)
  text('timberMark', p.TIMBER_MARK)
  text('cuttingPermit', p.HARVEST_AUTH_CUTTING_PERMIT_ID)
  text('cutBlock', p.CUT_BLOCK_ID)
  text('status', p.BLOCK_STATUS_CODE)
  text('lifeCycle', p.LIFE_CYCLE_STATUS_CODE)
  const opening = numberOf(p.OPENING_ID)
  if (opening !== null) out.openingId = opening
  const harvested = dayOf(p.DISTURBANCE_START_DATE)
  if (harvested) out.harvested = harvested
  const gross = numberOf(p.PLANNED_GROSS_BLOCK_AREA)
  if (gross !== null && gross >= 0) out.grossHa = gross
  return out
}

/** An ALR application or notice of intent as the record keeps it. Exported for the tests. */
export function describeAlrApplication(p: Props, kind: PrecedentAlrApplication['kind']): PrecedentAlrApplication {
  const out: PrecedentAlrApplication = { id: numberOf(p.ALR_APPLICATION_ID) ?? 0, kind }
  const received = dayOf(p.RECEIVED_DATE)
  if (received) out.received = received
  const text = (key: 'applicationClass' | 'components' | 'localGovernment', v: unknown) => {
    const s = str(v)
    if (s) out[key] = s.slice(0, 300)
  }
  text('applicationClass', p.APPLICATION_CLASS_CODE)
  text('components', p.PROPOSAL_COMPONENT_TYPE)
  text('localGovernment', p.LOCAL_GOVERNMENT)
  return out
}

/**
 * Which openings each instrument holds: inside one of its features near the block and harvested on
 * or after that feature's date (or any, without one; an opening with no harvest date is kept and
 * shows it). Exported for the tests.
 */
export function assignOpenings(
  regions: PrecedentRegion[],
  inRegion: boolean[][],
  openings: Props[],
  dated: Record<string, boolean>,
): PrecedentRow[] {
  const instruments = [...new Set(regions.map((r) => r.instrument))]
  return instruments.map((instrument) => {
    const mine = regions.map((r, i) => ({ r, i })).filter(({ r }) => r.instrument === instrument)
    const dates = mine.map(({ r }) => r.effective).filter((d): d is string => d !== null)
    const { kept, earlier } = insideFrom(mine, inRegion, openings, (o) => numberOf(o.OPENING_ID) ?? 0, harvestedOn)
    return {
      instrument,
      ...(dates.length ? { since: dates.sort()[0] } : {}),
      dated: Boolean(dated[instrument]),
      openings: kept,
      earlier,
    }
  })
}

/**
 * The items inside one instrument's regions, counted from each region's own date (or any, without
 * one; an item with no date is kept), and how many inside were dated before it.
 */
function insideFrom(
  mine: { r: PrecedentRegion; i: number }[],
  inRegion: boolean[][],
  items: Props[],
  idOf: (p: Props) => number,
  dateOf: (p: Props) => string | undefined,
): { kept: number[]; earlier: number } {
  const kept: number[] = []
  let earlier = 0
  items.forEach((o, j) => {
    const inside = mine.filter(({ i }) => inRegion[i]?.[j])
    if (!inside.length) return
    const on = dateOf(o)
    if (inside.some(({ r }) => r.effective === null || !on || on >= r.effective)) kept.push(idOf(o))
    else earlier++
  })
  return { kept, earlier }
}

/** Adds the exempt cut blocks inside each instrument, from its date as the openings are. Exported for the tests. */
export function assignCutBlocks(
  rows: PrecedentRow[],
  regions: PrecedentRegion[],
  inRegion: boolean[][],
  blocks: Props[],
): PrecedentRow[] {
  return rows.map((row) => {
    const mine = regions.map((r, i) => ({ r, i })).filter(({ r }) => r.instrument === row.instrument)
    const { kept, earlier } = insideFrom(
      mine,
      inRegion,
      blocks,
      (b) => numberOf(b.CUT_BLOCK_SKEY) ?? 0,
      (b) => dayOf(b.DISTURBANCE_START_DATE) ?? undefined,
    )
    return { ...row, exemptBlocks: kept, exemptEarlier: earlier }
  })
}

/** Items read by the hull of each part of the grown footprint, cut to the listed fields; `null` when the read failed. */
async function readNear(
  grown: Shape,
  fetch: Fetch,
  signal: AbortSignal | undefined,
  layer: string,
  geometryField: string,
  fields: readonly string[],
  key: string,
  extra?: string,
): Promise<{ properties: Props; geometry: Shape }[] | null> {
  return attempt(signal, async () => {
    const raw = await readAcrossParts(
      grown,
      async (filter) => {
        const answer = await wfsRead({
          fetch,
          signal,
          layer,
          filter: extra ? `${filter} AND ${extra}` : filter,
          propertyName: [...fields, geometryField].join(','),
          sortBy: key,
          cap: MAX_PRECEDENT_OPENINGS,
        })
        if (answer.truncated)
          throw Error(`More than ${MAX_PRECEDENT_OPENINGS} ${layer.replace(/^pub:/, '')} records near the block.`)
        return answer.features.map((f) => ({ ...f, properties: pick(f.properties, fields) }))
      },
      geometryField,
      (f) => String(f.properties[key]),
      true,
    )
    return raw
      .filter((f) => isArea(f.geometry))
      .map((f) => ({ properties: f.properties, geometry: f.geometry as Shape }))
  })
}

/** Reads the openings near the block inside the instruments found, and joins what was done on them. */
export async function readPrecedent({
  footprint,
  regions,
  dated,
  fetch,
  signal,
  overlay,
  radiusM = PRECEDENT_RADIUS_METRES,
  onProgress,
}: {
  footprint: Shape
  regions: PrecedentRegion[]
  /** Whether each instrument's layer gives a date at all. */
  dated: Record<string, boolean>
  fetch: Fetch
  signal?: AbortSignal
  overlay: GroundOverlay
  radiusM?: number
  onProgress?: (step: string) => void
}): Promise<GroundPrecedent> {
  const unread: GroundPrecedent['joins'] = {
    standards: 'failed',
    planting: 'failed',
    activities: 'failed',
    exemptBlocks: 'failed',
    ...(regions.some((r) => ALR_PRECEDENT_INSTRUMENTS.includes(r.instrument))
      ? { alrApplications: 'failed' as const, alrNotices: 'failed' as const }
      : {}),
  }
  const grown = overlay.grow(footprint, radiusM)
  let truncated = false
  let raw: RawFeature[]
  onProgress?.('openings')
  try {
    raw = await readAcrossParts(
      grown,
      async (filter) => {
        const answer = await wfsRead({
          fetch,
          signal,
          layer: OPENING_LAYER,
          filter,
          propertyName: [...OPENING_FIELDS, 'GEOMETRY'].join(','),
          sortBy: 'OPENING_ID',
          cap: MAX_PRECEDENT_OPENINGS,
        })
        truncated ||= answer.truncated
        return answer.features.map((f) => ({ ...f, properties: pick(f.properties, OPENING_FIELDS) }))
      },
      'GEOMETRY',
      (f) => String(f.properties.OPENING_ID),
      // The grown footprint's ring is detailed; its hull asks for a little more, and the test below is exact.
      true,
    )
  } catch (e) {
    if (aborted(signal, e)) throw e
    return {
      status: 'failed',
      message: e instanceof Error && e.message ? e.message.slice(0, 2000) : 'The read failed.',
      radiusM,
      joins: unread,
      openings: [],
      rows: [],
    }
  }
  if (raw.length > MAX_PRECEDENT_OPENINGS) truncated = true
  const openings = raw.slice(0, MAX_PRECEDENT_OPENINGS).filter((f) => isArea(f.geometry))
  const clipped = regions.map((r) => overlay.clip(r.geometry, grown))
  const present = clipped.map((c, i) => ({ c, i })).filter((x): x is { c: Shape; i: number } => x.c !== null)
  const matrix = overlay.overlaps(
    present.map((x) => x.c),
    openings.map((o) => o.geometry as Shape),
  )
  const inRegion: boolean[][] = regions.map(() => [])
  present.forEach((x, k) => (inRegion[x.i] = matrix[k]))
  let rows = assignOpenings(
    regions,
    inRegion,
    openings.map((o) => o.properties),
    dated,
  )
  const ids = [...new Set(rows.flatMap((r) => r.openings))].sort((a, b) => a - b)
  onProgress?.('standards units')
  const standards = await attempt(signal, () =>
    joined(fetch, signal, STANDARDS_UNIT_LAYER, ids, STANDARDS_FIELDS, 'STOCKING_STANDARD_UNIT_ID'),
  )
  onProgress?.('planting')
  const planting = await attempt(signal, () =>
    joined(fetch, signal, PLANTING_LAYER, ids, PLANTING_FIELDS, 'ACTIVITY_TREATMENT_UNIT_ID'),
  )
  onProgress?.('site preparation and planting activities')
  const activities = await attempt(signal, () =>
    joined(
      fetch,
      signal,
      ACTIVITY_LAYER,
      ids,
      ACTIVITY_FIELDS,
      'ACTIVITY_TREATMENT_UNIT_ID',
      "SILV_BASE_CODE IN ('SP','PL')",
    ),
  )
  onProgress?.('cut blocks exempt from a silviculture prescription')
  const exempt = await readNear(
    grown,
    fetch,
    signal,
    CUT_BLOCK_LAYER,
    'GEOMETRY',
    CUT_BLOCK_FIELDS,
    'CUT_BLOCK_SKEY',
    "SP_EXEMPT_IND = 'Y'",
  )
  let exemptBlocks: PrecedentCutBlock[] | undefined
  if (exempt) {
    const m = present.length
      ? overlay.overlaps(
          present.map((x) => x.c),
          exempt.map((b) => b.geometry),
        )
      : []
    const inside: boolean[][] = regions.map(() => [])
    present.forEach((x, k) => (inside[x.i] = m[k]))
    rows = assignCutBlocks(
      rows,
      regions,
      inside,
      exempt.map((b) => b.properties),
    )
    const keys = new Set(rows.flatMap((r) => r.exemptBlocks ?? []))
    exemptBlocks = exempt
      .map((b) => describeCutBlock(b.properties))
      .filter((b) => keys.has(b.key))
      .sort((x, y) => (y.harvested ?? '').localeCompare(x.harvested ?? '') || x.key - y.key)
  }
  const alrRegions = present.filter((x) => ALR_PRECEDENT_INSTRUMENTS.includes(regions[x.i].instrument))
  let alr: { applications: ReadStatus; notices: ReadStatus; kept: PrecedentAlrApplication[] } | undefined
  if (alrRegions.length) {
    onProgress?.('ALR applications and notices of intent')
    const read = async (layer: string, geometryField: string, kind: PrecedentAlrApplication['kind']) => {
      const items = await readNear(
        grown,
        fetch,
        signal,
        layer,
        geometryField,
        ALR_APPLICATION_FIELDS,
        'ALR_APPLICATION_ID',
      )
      if (!items) return null
      const m = overlay.overlaps(
        alrRegions.map((x) => x.c),
        items.map((i) => i.geometry),
      )
      return items.flatMap((item, j) => {
        const inside = alrRegions.filter((_, k) => m[k][j])
        return inside.length ? [{ ...describeAlrApplication(item.properties, kind), inside }] : []
      })
    }
    const applications = await read(ALR_APPLICATION_LAYER, 'GEOMETRY', 'application')
    const notices = await read(ALR_NOTICE_LAYER, 'SHAPE', 'notice of intent')
    const kept = [...(applications ?? []), ...(notices ?? [])]
    rows = rows.map((row) =>
      ALR_PRECEDENT_INSTRUMENTS.includes(row.instrument) && applications && notices
        ? {
            ...row,
            alrApplications: kept
              .filter((a) => a.inside.some((x) => regions[x.i].instrument === row.instrument))
              .map((a) => a.id),
          }
        : row,
    )
    alr = {
      applications: applications ? 'read' : 'failed',
      notices: notices ? 'read' : 'failed',
      kept: kept
        .map(({ inside: _inside, ...a }) => a)
        .sort((x, y) => (y.received ?? '').localeCompare(x.received ?? '') || x.id - y.id),
    }
  }
  const s = byOpening(standards)
  const p = byOpening(planting)
  const a = byOpening(activities)
  const described = openings
    .filter((o) => ids.includes(numberOf(o.properties.OPENING_ID) ?? -1))
    .map((o) => {
      const id = numberOf(o.properties.OPENING_ID)!
      return describeOpening(o.properties, {
        standards: standards ? (s.get(id) ?? []) : null,
        planting: planting ? (p.get(id) ?? []) : null,
        activities: activities ? (a.get(id) ?? []) : null,
      })
    })
    .sort((x, y) => (y.harvested ?? '').localeCompare(x.harvested ?? '') || x.openingId - y.openingId)
  const status = (rows: unknown): ReadStatus => (rows ? 'read' : 'failed')
  return {
    status: truncated ? 'truncated' : 'read',
    ...(truncated
      ? {
          message: `More than ${MAX_PRECEDENT_OPENINGS} openings within ${radiusM / 1000} km; only the first are kept.`,
        }
      : {}),
    radiusM,
    joins: {
      standards: status(standards),
      planting: status(planting),
      activities: status(activities),
      exemptBlocks: status(exempt),
      ...(alr ? { alrApplications: alr.applications, alrNotices: alr.notices } : {}),
    },
    openings: described,
    rows,
    ...(exemptBlocks ? { exemptBlocks } : {}),
    ...(alr ? { alrApplications: alr.kept } : {}),
  }
}

/** One instrument's precedent in a line: what RESULTS holds inside it near the block. */
export function precedentSummary(precedent: GroundPrecedent, instrument: string): string {
  if (precedent.status === 'failed') return `Not read: ${precedent.message ?? 'the read failed.'}`
  const row = precedent.rows.find((r) => r.instrument === instrument)
  const km = `${precedent.radiusM / 1000} km`
  if (!row) return `No part of it lies within ${km} of the block.`
  const mine = precedent.openings.filter((o) => row.openings.includes(o.openingId))
  const since = row.since
    ? `harvested since ${row.since}`
    : row.dated
      ? 'harvested (no feature here records a date)'
      : 'harvested at any date (the layer records none)'
  const parts = [`${mine.length} ${mine.length === 1 ? 'opening' : 'openings'} within ${km} ${since}`]
  if (precedent.joins.activities === 'read' || precedent.joins.planting === 'read')
    parts.push(`${mine.filter((o) => o.planted).length} planted`)
  else parts.push('planting not read')
  parts.push(
    precedent.joins.standards === 'read'
      ? `${mine.filter((o) => o.freeGrowing).length} declared free growing`
      : 'free growing not read',
  )
  if (precedent.joins.activities === 'read' && precedent.joins.planting === 'read')
    parts.push(`${mine.filter((o) => o.planted === false).length} with no planting recorded`)
  const undated = row.since ? mine.filter((o) => !o.harvested).length : 0
  if (undated) parts.push(`${undated} with no harvest date recorded`)
  if (row.earlier) parts.push(`${row.earlier} harvested before its date left out`)
  parts.push(...signalParts(precedent, row, mine))
  const text = parts.join('; ')
  return precedent.status === 'truncated' ? `${text}. Incomplete: ${precedent.message}` : text
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The public signals of an exception inside one instrument: what the records say, never why. A read
 * that failed says so; a read made before a signal was kept says nothing of it.
 */
function signalParts(precedent: GroundPrecedent, row: PrecedentRow, mine: PrecedentOpening[]): string[] {
  const parts: string[] = []
  for (const [code] of Object.entries(NO_OBLIGATION_CATEGORIES)) {
    const n = mine.filter((o) => o.category === code).length
    if (n) parts.push(`${plural(n, 'opening', 'openings')} here carried no obligation to reforest (${code})`)
  }
  if (precedent.joins.standards === 'read') {
    const cut = mine.filter((o) => o.noRegenObligation).length
    if (cut)
      parts.push(
        `${plural(cut, 'opening was', 'openings were')} an intermediate cut or selection harvest with no regeneration obligation (FPPR s. 44(4))`,
      )
    const varied = mine.filter((o) => o.variance).length
    if (varied)
      parts.push(
        `${plural(varied, 'opening has', 'openings have')} a stocking standard under an approved variation (the approval is not public)`,
      )
  }
  if (precedent.joins.exemptBlocks === 'failed')
    parts.push('cut blocks exempt from a silviculture prescription not read')
  else if (row.exemptBlocks?.length)
    parts.push(
      `${plural(row.exemptBlocks.length, 'cut block', 'cut blocks')} marked exempt from a silviculture prescription (Forest Practices Code s. 30)${row.exemptEarlier ? `, ${row.exemptEarlier} earlier left out` : ''}`,
    )
  if (ALR_PRECEDENT_INSTRUMENTS.includes(row.instrument) && precedent.joins.alrApplications !== undefined) {
    if (precedent.joins.alrApplications === 'failed' || precedent.joins.alrNotices === 'failed')
      parts.push('ALR applications and notices of intent not read')
    else {
      const ids = new Set(row.alrApplications ?? [])
      const kept = (precedent.alrApplications ?? []).filter((a) => ids.has(a.id))
      const apps = kept.filter((a) => a.kind === 'application').length
      const notices = kept.length - apps
      parts.push(
        `${plural(apps, 'ALR application', 'ALR applications')} and ${plural(notices, 'notice of intent', 'notices of intent')} mapped within ${precedent.radiusM / 1000} km (the Commission's decisions are not in the layer)`,
      )
    }
  }
  return parts
}
