/**
 * Mapped evidence for a block's Crown grazing and reforestation review: three DataBC layers read
 * against the block shape the review is for, each feature clipped to that footprint. What comes
 * back is a list of candidates the reviewer weighs when answering the review's facts; it never
 * answers a fact, never enters the rule evaluation and never starts the patch run.
 *
 * - **ADA/SRA polygons** of the 2006 Land Act s. 93.4 orders (`RMP_PLAN_LEGAL_POLY_SVW`): the
 *   Omineca order for Fort St. James, Vanderhoof, Prince George and Mackenzie, and the Robson Valley
 *   order for the Headwaters Forest District (its enabling document is
 *   `robsonvalley_lrmp_luor_23nov2006.pdf`), both legalised 2006-11-21. The orders' own maps are
 *   "a visual representation and not to be used for legal purposes": the legal description and the
 *   district decide.
 * - **Range tenures** (`FTEN_RANGE_POLY_SVW`): the RAN file and map block, its type and status
 *   as the dataset's own column comments define them. The holder's name is never read.
 * - **Tantalis grazing tenures** (`TA_CROWN_TENURES_SVW`, sub-purpose GRAZING): an issued lease
 *   apart from an application and from a reserve or notation. No holder is read.
 *
 * Each read follows the footprint's own polygons (`INTERSECTS` per part, by POST), never its box. A
 * layer that could not be read says "Not read", never "none".
 *
 * DOM- and network-free: `fetch` and the overlay (`measure`, JSTS in `oldForest.ts`) are passed in.
 */
import { ORDER_UNITS_LAYER } from '../orderUnits'
import {
  MAX_MAPPED_FEATURES,
  MAPPED_GROUPS,
  type MappedEvidence,
  type MappedFeature,
  type MappedGroup,
  type MappedLayer,
  type MappedLayerId,
  type RangeReview,
  type Shape,
} from '../plan'
import { quote, readAcrossParts, wfsRead, type Fetch, type RawFeature } from '../wfsReads'

export const RANGE_TENURE_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_RANGE_POLY_SVW'
export const CROWN_TENURE_LAYER = 'pub:WHSE_TANTALIS.TA_CROWN_TENURES_SVW'

/** The two s. 93.4 orders' plan names on DataBC's legal planning layer, and the order each is. */
export const ADA_SRA_PLANS: Record<string, MappedGroup> = {
  'Agricultural Development Areas and Settlement Reserve Areas within 4 Forest Districts - Extent': 'omineca-order',
  'Agricultural Development Areas within 1 Forest District - Extent': 'robson-valley-order',
}

/** `FILE_TYPE_CODE` as the Range Tenure dataset's column comment defines it. */
export const RANGE_FILE_TYPES: Record<string, string> = {
  E01: 'Grazing licence',
  E02: 'Grazing permit',
  E03: 'Non-replaceable grazing permit',
  H01: 'Haycutting licence',
  H02: 'Haycutting permit',
  H03: 'Non-replaceable haycutting permit',
}

/** `FILE_STATUS_CODE` as the column comment lists it; other codes print as DataBC gives them. */
export const RANGE_FILE_STATUSES: Record<string, string> = {
  A: 'Active',
  AR: 'Archived',
  CA: 'Cancelled',
  I: 'Inactive',
  P: 'Pending',
  SU: 'Suspended',
}

/** Overlaps smaller than a square metre are the overlay's rounding, not ground, and are left out. */
export const MIN_OVERLAP_HA = 0.0001

/** Tantalis subtypes of the Land Act's designations (the 2021 operational policy's table, §3). */
export const DESIGNATION_SUBTYPES: Record<string, MappedGroup> = {
  'SEC 15 OIC RESERVE': 'section-15',
  'SEC 16 MAP RESERVE': 'section-16',
  'SEC 17 DESIGNATED USE AREA': 'section-17',
}

export const GROUP_LABELS: Record<MappedGroup, string> = {
  'omineca-order': '2006 Omineca order (Fort St. James, Vanderhoof, Prince George, Mackenzie)',
  'robson-valley-order': '2006 Robson Valley order (Headwaters Forest District)',
  active: 'Active',
  pending: 'Pending',
  retired: 'Retired',
  lease: 'Issued lease',
  'section-15': 'Land Act §15 reserve',
  'section-16': 'Land Act §16 withdrawal',
  'section-17': 'Land Act §17 designated use area',
  application: 'Application',
  reserve: 'Reserve or notation',
  other: 'Other',
}

export interface MappedLayerInfo {
  title: string
  layer: string
  catalogue: string
  /** The review fact the layer informs, and what to say about it. */
  fact: string
  /** A second fact some of the layer's features inform. */
  alsoFact?: string
  informs: string
}

export const MAPPED_LAYER_INFO: Record<MappedLayerId, MappedLayerInfo> = {
  'ada-sra': {
    title: 'Agriculture development and settlement reserve areas',
    layer: ORDER_UNITS_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/2c02040c-d7c5-4960-8d04-dea01d6d3e9f',
    fact: 'ada-sra-applicable',
    informs:
      'A polygon here is a candidate. The order’s maps are a visual representation, not for legal purposes: the order’s legal description and the district decide. Only the Omineca order’s polygons bear on this fact; the Robson Valley order is a separate order of the same date.',
  },
  'range-tenure': {
    title: 'Range tenures',
    layer: RANGE_TENURE_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/10b1b187-1ef5-421f-8aa2-f716379fdb99',
    fact: 'range-act-agreement',
    informs:
      'Confirm the agreement, pasture and season on the RAN file. A digital boundary can take in private land or water that is not part of the grazing area, and retired boundaries are no longer in force.',
  },
  'crown-grazing': {
    title: 'Crown land grazing tenures and Land Act designations (Tantalis)',
    layer: CROWN_TENURE_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/3544ad91-0cf2-4926-a08a-bfe42d9a031d',
    fact: 'land-act-lease',
    alsoFact: 'land-act-designation',
    informs:
      'Only an issued lease is a lease; an application or a reserve is not. Confirm the Crown lands file against the signed lease and its legal description. A §15 reserve, §16 withdrawal or §17 designated use area of any purpose is listed too: read its effective date and history in GATOR by the Crown lands file, and its terms in the signed notice.',
  },
}

const textOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const dayOf = (v: unknown) => {
  const m = typeof v === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(v) : null
  return m ? m[0] : null
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const detail = (label: string, value: unknown) => {
  const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : textOf(value)
  return v === null ? [] : [clip(`${label}: ${v}`, 1000)]
}

interface LayerRead {
  layer: MappedLayerId
  typeName: string
  geometryField: string
  /** Narrow on purpose: the layers carry holders' names, which are never read. */
  fields: string[]
  filter?: string
  key: (p: Record<string, unknown>) => string
  feature: (p: Record<string, unknown>) => Omit<MappedFeature, 'overlapHa' | 'sharePercent'>
}

export const LAYER_READS: LayerRead[] = [
  {
    layer: 'ada-sra',
    typeName: ORDER_UNITS_LAYER,
    geometryField: 'GEOMETRY',
    fields: [
      'OBJECTID',
      'LEGAL_FEAT_PROVID',
      'STRGC_LAND_RSRCE_PLAN_NAME',
      'LEGAL_FEAT_OBJECTIVE',
      'LEGALIZATION_DATE',
      'LEGAL_FEAT_ATRB_1_NAME',
      'LEGAL_FEAT_ATRB_1_VALUE',
      'ENABLING_DOCUMENT_URL',
    ],
    filter: `STRGC_LAND_RSRCE_PLAN_NAME IN (${Object.keys(ADA_SRA_PLANS).map(quote).join(', ')})`,
    key: (p) => String(p.OBJECTID ?? p.LEGAL_FEAT_PROVID),
    feature: (p) => ({
      id: textOf(p.LEGAL_FEAT_PROVID) ?? String(p.OBJECTID),
      name: textOf(p.LEGAL_FEAT_OBJECTIVE) ?? 'Order polygon',
      group: ADA_SRA_PLANS[String(p.STRGC_LAND_RSRCE_PLAN_NAME)] ?? 'other',
      details: [
        ...detail('Plan', p.STRGC_LAND_RSRCE_PLAN_NAME),
        ...detail('Legalised', dayOf(p.LEGALIZATION_DATE)),
        ...(p.LEGAL_FEAT_ATRB_1_NAME === 'STATUS' ? detail('Status', p.LEGAL_FEAT_ATRB_1_VALUE) : []),
        ...detail('Enabling document', p.ENABLING_DOCUMENT_URL),
      ],
    }),
  },
  {
    layer: 'range-tenure',
    typeName: RANGE_TENURE_LAYER,
    geometryField: 'GEOMETRY',
    fields: [
      'OBJECTID',
      'FOREST_FILE_ID',
      'MAP_BLOCK_ID',
      'FILE_TYPE_CODE',
      'FILE_STATUS_CODE',
      'LIFE_CYCLE_STATUS_CODE',
      'AUTHORIZED_USE',
      'RETIREMENT_DATE',
      'ADMIN_DISTRICT_CODE',
    ],
    key: (p) => String(p.OBJECTID ?? `${String(p.FOREST_FILE_ID)} ${String(p.MAP_BLOCK_ID)}`),
    feature: (p) => {
      const type = textOf(p.FILE_TYPE_CODE)
      const status = textOf(p.FILE_STATUS_CODE)
      const life = textOf(p.LIFE_CYCLE_STATUS_CODE)
      const unit = type?.startsWith('E') ? ' AUM a year' : type?.startsWith('H') ? ' tonnes a year' : ''
      const use = typeof p.AUTHORIZED_USE === 'number' && Number.isFinite(p.AUTHORIZED_USE) ? p.AUTHORIZED_USE : null
      return {
        id: [textOf(p.FOREST_FILE_ID), textOf(p.MAP_BLOCK_ID)].filter(Boolean).join(' ') || String(p.OBJECTID),
        name: type ? (RANGE_FILE_TYPES[type] ? `${RANGE_FILE_TYPES[type]} (${type})` : type) : 'Type not stated',
        group: life === 'ACTIVE' ? 'active' : life === 'PENDING' ? 'pending' : life === 'RETIRED' ? 'retired' : 'other',
        details: [
          ...detail('Boundary', life),
          ...detail(
            'File status',
            status && RANGE_FILE_STATUSES[status] ? `${RANGE_FILE_STATUSES[status]} (${status})` : status,
          ),
          ...detail('Authorized use', use === null ? null : `${use}${unit} (whole tenure)`),
          ...detail('Retired', dayOf(p.RETIREMENT_DATE)),
          ...detail('District', p.ADMIN_DISTRICT_CODE),
        ],
      }
    },
  },
  {
    layer: 'crown-grazing',
    typeName: CROWN_TENURE_LAYER,
    geometryField: 'SHAPE',
    fields: [
      'OBJECTID',
      'INTRID_SID',
      'CROWN_LANDS_FILE',
      'TENURE_STAGE',
      'TENURE_STATUS',
      'TENURE_TYPE',
      'TENURE_SUBTYPE',
      'TENURE_PURPOSE',
      'TENURE_SUBPURPOSE',
      'TENURE_DOCUMENT',
      'TENURE_EXPIRY',
      'APPLICATION_TYPE_CDE',
      'TENURE_LEGAL_DESCRIPTION',
    ],
    filter: `(TENURE_SUBPURPOSE = 'GRAZING' OR TENURE_SUBTYPE IN (${Object.keys(DESIGNATION_SUBTYPES)
      .map((t) => `'${t}'`)
      .join(', ')}))`,
    key: (p) => String(p.INTRID_SID ?? p.OBJECTID),
    feature: (p) => {
      const stage = textOf(p.TENURE_STAGE)
      const type = textOf(p.TENURE_TYPE)
      const file = textOf(p.CROWN_LANDS_FILE)
      return {
        id: file ? `File ${file}` : `Interest ${String(p.INTRID_SID ?? p.OBJECTID)}`,
        name: [type, textOf(p.TENURE_SUBTYPE)].filter(Boolean).join(' · ') || 'Type not stated',
        group:
          DESIGNATION_SUBTYPES[textOf(p.TENURE_SUBTYPE) ?? ''] ??
          (stage === 'APPLICATION'
            ? 'application'
            : type === 'RESERVE/NOTATION'
              ? 'reserve'
              : type === 'LEASE' && stage === 'TENURE'
                ? 'lease'
                : 'other'),
        details: [
          ...detail('Purpose', [textOf(p.TENURE_PURPOSE), textOf(p.TENURE_SUBPURPOSE)].filter(Boolean).join(' · ')),
          ...detail('Document', p.TENURE_DOCUMENT),
          ...detail('Stage', stage),
          ...detail('Status', p.TENURE_STATUS),
          ...detail('Expires', dayOf(p.TENURE_EXPIRY)),
          ...detail('Application type', p.APPLICATION_TYPE_CDE),
          ...detail('Legal description', clip(textOf(p.TENURE_LEGAL_DESCRIPTION) ?? '', 300)),
        ],
      }
    },
  },
]

/** The overlay, passed in: each shape's overlap with the footprint, and their dissolved total. */
export type Measure = (
  footprint: Shape,
  others: Shape[],
) => { footprintHa: number; eachHa: number[]; coveredHa: number }

const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
const aborted = (signal: AbortSignal | undefined, e: unknown) =>
  Boolean(signal?.aborted) || (e instanceof Error && e.name === 'AbortError')
const groupOrder = (g: MappedGroup) => MAPPED_GROUPS.indexOf(g)

/** One layer against the footprint. Exported for the tests. */
export async function readMappedLayer({
  read,
  footprint,
  footprintHa,
  fetch,
  signal,
  measure,
}: {
  read: LayerRead
  footprint: Shape
  footprintHa: number
  fetch: Fetch
  signal?: AbortSignal
  measure: Measure
}): Promise<MappedLayer> {
  try {
    let truncated = false
    const rows = await readAcrossParts(
      footprint,
      async (filter) => {
        const answer = await wfsRead({
          fetch,
          signal,
          layer: read.typeName,
          filter: read.filter ? `${filter} AND ${read.filter}` : filter,
          propertyName: [...read.fields, read.geometryField].join(','),
          sortBy: 'OBJECTID',
          cap: MAX_MAPPED_FEATURES,
        })
        truncated ||= answer.truncated
        return answer.features
      },
      read.geometryField,
      (f) => read.key(f.properties ?? {}),
    )
    const areas = rows.filter((f) => isArea(f.geometry)).slice(0, MAX_MAPPED_FEATURES)
    if (rows.length > MAX_MAPPED_FEATURES) truncated = true
    const kept = areas.map((f) => ({ feature: read.feature(f.properties ?? {}), geometry: f.geometry as Shape }))
    const { eachHa } = measure(
      footprint,
      kept.map((k) => k.geometry),
    )
    const overlapping = kept
      .map((k, i) => ({ ...k, ha: eachHa[i] }))
      .filter((k) => k.ha >= MIN_OVERLAP_HA)
      .sort((a, b) => groupOrder(a.feature.group) - groupOrder(b.feature.group) || b.ha - a.ha)
    const features: MappedFeature[] = overlapping.map((k) => ({
      ...k.feature,
      overlapHa: k.ha,
      sharePercent: footprintHa > 0 ? Math.min(100, (k.ha / footprintHa) * 100) : 0,
    }))
    const covered = MAPPED_GROUPS.flatMap((group) => {
      const inGroup = overlapping.filter((k) => k.feature.group === group)
      if (!inGroup.length) return []
      const ha =
        inGroup.length === 1
          ? inGroup[0].ha
          : measure(
              footprint,
              inGroup.map((k) => k.geometry),
            ).coveredHa
      return [{ group, ha }]
    })
    return {
      layer: read.layer,
      status: truncated ? 'truncated' : 'read',
      ...(truncated
        ? { message: `DataBC holds more than ${MAX_MAPPED_FEATURES} records here; only the first are listed.` }
        : {}),
      features,
      covered,
    }
  } catch (e) {
    if (aborted(signal, e)) throw e
    return {
      layer: read.layer,
      status: 'failed',
      message: e instanceof Error && e.message ? e.message.slice(0, 2000) : 'The read failed.',
      features: [],
      covered: [],
    }
  }
}

/** Reads the three layers against one footprint, one after another so a cancel stops at once. */
export async function readMappedEvidence({
  footprint,
  shape,
  signature,
  fetch,
  signal,
  measure,
  readOn,
  onProgress,
}: {
  footprint: Shape
  /** The block shape's id and footprint signature, as the review records them. */
  shape: string
  signature: string
  fetch: Fetch
  signal?: AbortSignal
  measure: Measure
  readOn: string
  onProgress?: (layer: MappedLayerId) => void
}): Promise<MappedEvidence> {
  const { footprintHa } = measure(footprint, [])
  const layers: MappedLayer[] = []
  for (const read of LAYER_READS) {
    onProgress?.(read.layer)
    layers.push(await readMappedLayer({ read, footprint, footprintHa, fetch, signal, measure }))
  }
  return { readOn, shape, footprint: signature, footprintHa, layers }
}

/** Whether the mapped read describes the footprint the review is for. */
export const mappedCurrent = (record: Pick<RangeReview, 'shape' | 'footprint' | 'mapped'>) =>
  Boolean(record.mapped && record.mapped.shape === record.shape && record.mapped.footprint === record.footprint)

/** The layer's answer in one line: what overlaps, or "Not read" when it could not be read. */
export function layerSummary(layer: MappedLayer): string {
  if (layer.status === 'failed') return `Not read: ${layer.message ?? 'the read failed.'}`
  const counts = MAPPED_GROUPS.flatMap((g) => {
    const n = layer.features.filter((f) => f.group === g).length
    const ha = layer.covered.find((c) => c.group === g)?.ha
    return n ? [`${GROUP_LABELS[g].replace(/ \(.*\)$/, '')}: ${n} (${formatHa(ha ?? 0)} ha)`] : []
  })
  const listed = counts.length ? counts.join(' · ') : 'Nothing mapped overlaps the footprint'
  return layer.status === 'truncated' ? `${listed}. Incomplete: ${layer.message}` : listed
}

export const formatHa = (ha: number) => (ha > 0 && ha < 0.01 ? '<0.01' : ha.toFixed(2))
