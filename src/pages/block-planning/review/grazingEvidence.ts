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
 * - **Tantalis grazing tenures and Land Act designations** (`TA_CROWN_TENURES_SVW`, sub-purpose
 *   GRAZING, or a §15 reserve, §16 withdrawal or §17 designated use area of any purpose): an issued
 *   lease apart from an application, a reserve or notation, and each kind of designation. No holder
 *   is read.
 * - **The public parts of the range plan** (`WHSE_FOREST_VEGETATION`): range pastures, as areas;
 *   range developments (fences, gates, cattleguards, water developments, corrals, crossings, stock
 *   trails) as lines and points; and natural range barriers as lines. Lines are measured by their
 *   length and points counted, inside the footprint and within `NEAR_FOOTPRINT_METRES` of it, since
 *   a fence on the block's edge is as much in the way as one inside it.
 *
 * Each read follows the footprint's own polygons (`INTERSECTS` per part, by POST), never its box;
 * lines and points are read against the footprint grown by the margin. A layer that could not be
 * read says "Not read", never "none".
 *
 * DOM- and network-free: `fetch` and the overlays (`measure` and `near`, JSTS in `oldForest.ts`) are
 * passed in.
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
import type { LineString, MultiLineString, MultiPoint, Point } from 'geojson'
import { keepFields, quote, readAcrossParts, wfsRead, type Fetch, type RawFeature } from '../wfsReads'

export const RANGE_TENURE_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_RANGE_POLY_SVW'
export const CROWN_TENURE_LAYER = 'pub:WHSE_TANTALIS.TA_CROWN_TENURES_SVW'
export const RANGE_PASTURE_LAYER = 'pub:WHSE_FOREST_VEGETATION.RANGE_PASTURE_POLY_SVW'
export const RANGE_IMPROVEMENT_LINE_LAYER = 'pub:WHSE_FOREST_VEGETATION.RANGE_IMP_FEATURE_LINE_SVW'
export const RANGE_IMPROVEMENT_POINT_LAYER = 'pub:WHSE_FOREST_VEGETATION.RANGE_IMP_FEATURE_PNT_SVW'
export const NATURAL_BARRIER_LAYER = 'pub:WHSE_FOREST_VEGETATION.RANGE_NATURAL_BARRIER_LINE_SVW'

/**
 * How far past the footprint's edge range developments and natural barriers are measured. A fence or
 * barrier along the block boundary is cut, moved or opened by the falling and yarding beside it, and
 * the layers are drawn from air photos, TRIM and sketch maps, which can put a line on the boundary
 * a few tens of metres to either side of it.
 */
export const NEAR_FOOTPRINT_METRES = 50
/** The read asks for a little more than the margin: its ring is rounded to about a metre. The clip is exact. */
const NEAR_READ_SLACK_METRES = 2
/** Shorter stretches are the overlay's rounding, not a line on the ground, and are left out. */
export const MIN_NEAR_LENGTH_M = 0.01

/**
 * A range development's kind, from `IMPROVEMENT_FEATURE_CODE` as the layer gives it (upper-cased,
 * `_` read as a space). The catalogue lists cattleguards, corrals, fences, cabins, crossings (e.g.
 * stock bridge, underpass), exclosures, gates, salt blocks, stock trails and water developments;
 * the kinds not listed here (cabin, exclosure, salt and the like) go under Other, named as given.
 */
export const IMPROVEMENT_KINDS: Record<string, MappedGroup> = {
  FENCE: 'fence',
  GATE: 'gate',
  CATTLEGUARD: 'cattleguard',
  'WATER DEVELOPMENT': 'water-development',
  CORRAL: 'corral',
  CROSSING: 'crossing',
  BRIDGE: 'crossing',
  'STOCK TRAIL': 'stock-trail',
}

/**
 * `FEATURE_CODE`, read only where `IMPROVEMENT_FEATURE_CODE` is blank: the kind the layers' own
 * records give each code most often (24 November 2026: FI91600370 on 23,630 fences, FI91600070 on
 * 4,979 cattleguards, FI19600010 on 3,550 water developments but also on 237 gates and 28
 * cattleguards, which is why it is only the fallback). A code spelt otherwise (`Fl91600370` with a
 * lower-case L, `F191600070`) is not matched: it prints as given, under Other.
 */
export const IMPROVEMENT_FEATURE_CODES: Record<string, string> = {
  FI91600370: 'FENCE',
  FI91600120: 'GATE',
  FI91600070: 'CATTLEGUARD',
  FI19600010: 'WATER DEVELOPMENT',
  FI91600080: 'CORRAL',
  FA00000003: 'CROSSING',
  DC31700700: 'STOCK TRAIL',
}

/** `BARRIER_FEATURE_GROUP_CODE`, the barrier's feature group as the column comment defines it. */
export const BARRIER_GROUPS: Record<string, MappedGroup> = {
  TOPOLOGICAL: 'barrier-topological',
  VEGETATION: 'barrier-vegetation',
  WATER: 'barrier-water',
}

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
  pasture: 'Pasture',
  fence: 'Fence',
  gate: 'Gate',
  cattleguard: 'Cattleguard',
  'water-development': 'Water development',
  corral: 'Corral',
  crossing: 'Crossing (stock bridge, underpass)',
  'stock-trail': 'Stock trail',
  'barrier-topological': 'Topological barrier',
  'barrier-vegetation': 'Vegetation barrier',
  'barrier-water': 'Water barrier',
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
  'range-pasture': {
    title: 'Range pastures',
    layer: RANGE_PASTURE_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/f78133a4-f69b-487f-ad85-e7cef6515028',
    fact: 'range-act-agreement',
    informs:
      'Which pastures the block lies in, to find in the range use plan or range plan and its schedule of grazing. Pastures are administrative, not legal boundaries: confirm the pasture, its season and the agreement on the RAN file.',
  },
  'range-improvement-lines': {
    title: 'Range developments: fences, stock trails and other lines',
    layer: RANGE_IMPROVEMENT_LINE_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/946b09a4-c63e-48eb-b322-3701c8ba161d',
    fact: 'range-development-affected',
    informs: `Length inside the footprint and within ${NEAR_FOOTPRINT_METRES} m of it. A mapped development is a candidate: removing, damaging or modifying one needs the minister’s written authorization (FRPA §51). Confirm it on the ground and through the district; a development that is not mapped can still be there.`,
  },
  'range-improvement-points': {
    title: 'Range developments: gates, cattleguards, water developments, corrals and crossings',
    layer: RANGE_IMPROVEMENT_POINT_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/06988856-0c2d-4467-abd4-8061fb02f309',
    fact: 'range-development-affected',
    informs: `Counted inside the footprint and within ${NEAR_FOOTPRINT_METRES} m of it. A mapped development is a candidate: removing, damaging or modifying one needs the minister’s written authorization (FRPA §51). Confirm it on the ground and through the district; a development that is not mapped can still be there.`,
  },
  'natural-barriers': {
    title: 'Natural range barriers',
    layer: NATURAL_BARRIER_LAYER,
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/e7310565-1ccc-4196-9e75-0600c5c2b29d',
    fact: 'barrier-impact',
    informs: `Length inside the footprint and within ${NEAR_FOOTPRINT_METRES} m of it. A mapped barrier is a candidate for FRPA §48 and the forest stewardship plan’s FPPR §18 measure. An unmapped barrier is not evidence that none exists: the public layer is mostly topological barriers (vegetation and water barriers have their own restricted datasets), little of it has been updated since 2010, and the absence of mapped barriers proves nothing. Ask the agreement holder and the district.`,
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

type FeatureText = Pick<MappedFeature, 'id' | 'name' | 'group' | 'details'>

interface LayerRead {
  layer: MappedLayerId
  /** Areas are clipped to the footprint; lines are measured and points counted near it too. */
  kind: 'area' | 'line' | 'point'
  typeName: string
  geometryField: string
  /** Narrow on purpose: the layers carry holders' names, which are never read. */
  fields: string[]
  filter?: string
  key: (p: Record<string, unknown>) => string
  feature: (p: Record<string, unknown>) => FeatureText
}

const IMPROVEMENT_FIELDS = [
  'OBJECTID',
  'FEATURE_CODE',
  'IMPROVEMENT_FEATURE_CODE',
  'IMPROVEMENT_TYPE_CODE',
  'FIELD_CONDITION_CODE',
  'FIELD_OBSERVATION_DATE',
  'OWNERSHIP_CODE',
  'DISTRICT_RESPONSIBLE_CODE',
  'CAPTURE_DATE',
]

/** A range development as the layer names it: its kind and type, with the feature code beside them. */
function improvement(p: Record<string, unknown>): FeatureText {
  const named = textOf(p.IMPROVEMENT_FEATURE_CODE)
  const code = textOf(p.FEATURE_CODE)
  const kind = named ?? (code ? IMPROVEMENT_FEATURE_CODES[code.toUpperCase()] : undefined) ?? null
  const observed = dayOf(p.FIELD_OBSERVATION_DATE)
  const condition = textOf(p.FIELD_CONDITION_CODE)
  return {
    id: `OBJECTID ${String(p.OBJECTID)}`,
    name: [kind ?? code ?? 'Kind not stated', textOf(p.IMPROVEMENT_TYPE_CODE)].filter(Boolean).join(' · '),
    group: (kind && IMPROVEMENT_KINDS[kind.toUpperCase().replace(/_/g, ' ')]) || 'other',
    details: [
      ...detail(
        'Feature code',
        named || !kind ? code : `${code} (no improvement code; kind read from the feature code)`,
      ),
      ...detail('Condition', condition && observed ? `${condition} (observed ${observed})` : condition),
      ...(condition ? [] : detail('Observed', observed)),
      ...detail('Ownership', p.OWNERSHIP_CODE),
      ...detail('District', p.DISTRICT_RESPONSIBLE_CODE),
      ...detail('Captured', dayOf(p.CAPTURE_DATE)),
    ],
  }
}

export const LAYER_READS: LayerRead[] = [
  {
    layer: 'ada-sra',
    kind: 'area',
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
    kind: 'area',
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
    kind: 'area',
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
  {
    layer: 'range-pasture',
    kind: 'area',
    typeName: RANGE_PASTURE_LAYER,
    geometryField: 'GEOMETRY',
    fields: [
      'OBJECTID',
      'RANGE_UNIT_ID',
      'RANGE_PASTURE_ID',
      'PASTURE_NAME',
      'DISTRICT_RESPONSIBLE_CODE',
      'OWNERSHIP_CODE',
      'CAPTURE_DATE',
    ],
    key: (p) => String(p.OBJECTID),
    feature: (p) => {
      const unit = typeof p.RANGE_UNIT_ID === 'number' ? String(p.RANGE_UNIT_ID) : textOf(p.RANGE_UNIT_ID)
      const pasture = textOf(p.RANGE_PASTURE_ID)
      return {
        id:
          [unit && `Range unit ${unit}`, pasture && `pasture ${pasture}`].filter(Boolean).join(', ') ||
          `OBJECTID ${String(p.OBJECTID)}`,
        name: textOf(p.PASTURE_NAME) ?? 'Pasture not named',
        group: 'pasture',
        details: [
          ...detail('Ownership', p.OWNERSHIP_CODE),
          ...detail('District', p.DISTRICT_RESPONSIBLE_CODE),
          ...detail('Captured', dayOf(p.CAPTURE_DATE)),
        ],
      }
    },
  },
  {
    layer: 'range-improvement-lines',
    kind: 'line',
    typeName: RANGE_IMPROVEMENT_LINE_LAYER,
    geometryField: 'GEOMETRY',
    fields: IMPROVEMENT_FIELDS,
    key: (p) => String(p.OBJECTID),
    feature: improvement,
  },
  {
    layer: 'range-improvement-points',
    kind: 'point',
    typeName: RANGE_IMPROVEMENT_POINT_LAYER,
    geometryField: 'GEOMETRY',
    fields: IMPROVEMENT_FIELDS,
    key: (p) => String(p.OBJECTID),
    feature: improvement,
  },
  {
    layer: 'natural-barriers',
    kind: 'line',
    typeName: NATURAL_BARRIER_LAYER,
    geometryField: 'GEOMETRY',
    fields: [
      'OBJECTID',
      'FEATURE_CODE',
      'BARRIER_FEATURE_GROUP_CODE',
      'BARRIER_FEATURE_CODE',
      'BARRIER_DEPTH',
      'FIELD_CONDITION_CODE',
      'FIELD_OBSERVATION_DATE',
      'DISTRICT_RESPONSIBLE_CODE',
      'CAPTURE_DATE',
    ],
    key: (p) => String(p.OBJECTID),
    feature: (p) => {
      const group = textOf(p.BARRIER_FEATURE_GROUP_CODE)
      const depth = typeof p.BARRIER_DEPTH === 'number' && Number.isFinite(p.BARRIER_DEPTH) ? p.BARRIER_DEPTH : null
      return {
        id: `OBJECTID ${String(p.OBJECTID)}`,
        name: [group ?? 'Group not stated', textOf(p.BARRIER_FEATURE_CODE)].filter(Boolean).join(' · '),
        group: (group && BARRIER_GROUPS[group.toUpperCase()]) || 'other',
        details: [
          ...detail('Depth', depth === null ? null : `${depth} m`),
          ...detail('Condition', p.FIELD_CONDITION_CODE),
          ...detail('Observed', dayOf(p.FIELD_OBSERVATION_DATE)),
          ...detail('District', p.DISTRICT_RESPONSIBLE_CODE),
          ...detail('Captured', dayOf(p.CAPTURE_DATE)),
          ...detail('Feature code', p.FEATURE_CODE),
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

export type LineShape = LineString | MultiLineString
export type PointShape = Point | MultiPoint

/** The overlays for lines and points near the footprint, passed in (`nearFootprint`, `oldForest.ts`). */
export interface NearOverlay {
  /** The footprint grown by `metres`, in WGS84: what a read near it asks for. */
  grow: (footprint: Shape, metres: number) => Shape
  /** Each line's metres inside and within `metres` of the footprint, and the same for them all joined. */
  lines: (
    footprint: Shape,
    metres: number,
    lines: LineShape[],
  ) => { each: { insideM: number; nearM: number }[]; insideM: number; nearM: number }
  /** How many of each record's points lie inside and within `metres` of the footprint. */
  points: (footprint: Shape, metres: number, points: PointShape[]) => { insideCount: number; nearCount: number }[]
}

const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
const isLine = (g: RawFeature['geometry']): g is LineShape => g?.type === 'LineString' || g?.type === 'MultiLineString'
const isPoint = (g: RawFeature['geometry']): g is PointShape => g?.type === 'Point' || g?.type === 'MultiPoint'
const aborted = (signal: AbortSignal | undefined, e: unknown) =>
  Boolean(signal?.aborted) || (e instanceof Error && e.name === 'AbortError')
const groupOrder = (g: MappedGroup) => MAPPED_GROUPS.indexOf(g)

interface Measured {
  layer: Pick<MappedLayer, 'covered' | 'marginM' | 'lengths' | 'counts'>
  features: MappedFeature[]
}

function measureAreas(
  rows: RawFeature[],
  read: LayerRead,
  footprint: Shape,
  footprintHa: number,
  measure: Measure,
): Measured {
  const kept = rows
    .filter((f) => isArea(f.geometry))
    .map((f) => ({ feature: read.feature(f.properties ?? {}), geometry: f.geometry as Shape }))
  const { eachHa } = measure(
    footprint,
    kept.map((k) => k.geometry),
  )
  const overlapping = kept
    .map((k, i) => ({ ...k, ha: eachHa[i] }))
    .filter((k) => k.ha >= MIN_OVERLAP_HA)
    .sort((a, b) => groupOrder(a.feature.group) - groupOrder(b.feature.group) || b.ha - a.ha)
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
    layer: { covered },
    features: overlapping.map((k) => ({
      ...k.feature,
      overlapHa: k.ha,
      sharePercent: footprintHa > 0 ? Math.min(100, (k.ha / footprintHa) * 100) : 0,
    })),
  }
}

function measureLines(rows: RawFeature[], read: LayerRead, footprint: Shape, near: NearOverlay): Measured {
  const metres = NEAR_FOOTPRINT_METRES
  const kept = rows
    .filter((f) => isLine(f.geometry))
    .map((f) => ({ feature: read.feature(f.properties ?? {}), geometry: f.geometry as LineShape }))
  const { each } = near.lines(
    footprint,
    metres,
    kept.map((k) => k.geometry),
  )
  const close = kept
    .map((k, i) => ({ ...k, ...each[i] }))
    .filter((k) => k.nearM >= MIN_NEAR_LENGTH_M)
    .sort((a, b) => groupOrder(a.feature.group) - groupOrder(b.feature.group) || b.nearM - a.nearM)
  const lengths = MAPPED_GROUPS.flatMap((group) => {
    const inGroup = close.filter((k) => k.feature.group === group)
    if (!inGroup.length) return []
    const joined =
      inGroup.length === 1
        ? inGroup[0]
        : near.lines(
            footprint,
            metres,
            inGroup.map((k) => k.geometry),
          )
    return [{ group, lengthM: joined.nearM, insideLengthM: Math.min(joined.insideM, joined.nearM) }]
  })
  return {
    layer: { covered: [], marginM: metres, lengths },
    features: close.map((k) => ({ ...k.feature, lengthM: k.nearM, insideLengthM: Math.min(k.insideM, k.nearM) })),
  }
}

function countPoints(rows: RawFeature[], read: LayerRead, footprint: Shape, near: NearOverlay): Measured {
  const metres = NEAR_FOOTPRINT_METRES
  const kept = rows
    .filter((f) => isPoint(f.geometry))
    .map((f) => ({ feature: read.feature(f.properties ?? {}), geometry: f.geometry as PointShape }))
  const counted = near.points(
    footprint,
    metres,
    kept.map((k) => k.geometry),
  )
  const close = kept
    .map((k, i) => ({ ...k, ...counted[i] }))
    .filter((k) => k.nearCount > 0)
    .sort(
      (a, b) =>
        groupOrder(a.feature.group) - groupOrder(b.feature.group) ||
        b.insideCount - a.insideCount ||
        a.feature.id.localeCompare(b.feature.id),
    )
  const counts = MAPPED_GROUPS.flatMap((group) => {
    const inGroup = close.filter((k) => k.feature.group === group)
    if (!inGroup.length) return []
    const sum = (key: 'nearCount' | 'insideCount') => inGroup.reduce((n, k) => n + k[key], 0)
    return [{ group, count: sum('nearCount'), insideCount: sum('insideCount') }]
  })
  return {
    layer: { covered: [], marginM: metres, counts },
    features: close.map((k) => ({ ...k.feature, count: k.nearCount, insideCount: k.insideCount })),
  }
}

/** One layer against the footprint. Exported for the tests. */
export async function readMappedLayer({
  read,
  footprint,
  footprintHa,
  fetch,
  signal,
  measure,
  near,
}: {
  read: LayerRead
  footprint: Shape
  footprintHa: number
  fetch: Fetch
  signal?: AbortSignal
  measure: Measure
  near: NearOverlay
}): Promise<MappedLayer> {
  try {
    let truncated = false
    // Lines and points are asked for near the footprint too; areas only where they meet it.
    const asked =
      read.kind === 'area' ? footprint : near.grow(footprint, NEAR_FOOTPRINT_METRES + NEAR_READ_SLACK_METRES)
    const rows = await readAcrossParts(
      asked,
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
        return answer.features.map((f) => ({ ...f, properties: keepFields(f.properties, read.fields) }))
      },
      read.geometryField,
      (f) => read.key(f.properties ?? {}),
    )
    if (rows.length > MAX_MAPPED_FEATURES) truncated = true
    const kept = rows.slice(0, MAX_MAPPED_FEATURES)
    const measured =
      read.kind === 'area'
        ? measureAreas(kept, read, footprint, footprintHa, measure)
        : read.kind === 'line'
          ? measureLines(kept, read, footprint, near)
          : countPoints(kept, read, footprint, near)
    return {
      layer: read.layer,
      status: truncated ? 'truncated' : 'read',
      ...(truncated
        ? { message: `DataBC holds more than ${MAX_MAPPED_FEATURES} records here; only the first are listed.` }
        : {}),
      features: measured.features,
      ...measured.layer,
    }
  } catch (e) {
    if (aborted(signal, e)) throw e
    return {
      layer: read.layer,
      status: 'failed',
      message: e instanceof Error && e.message ? e.message.slice(0, 2000) : 'The read failed.',
      features: [],
      covered: [],
      ...(read.kind === 'area' ? {} : { marginM: NEAR_FOOTPRINT_METRES }),
    }
  }
}

/** Reads the layers against one footprint, one after another so a cancel stops at once. */
export async function readMappedEvidence({
  footprint,
  shape,
  signature,
  fetch,
  signal,
  measure,
  near,
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
  near: NearOverlay
  readOn: string
  onProgress?: (layer: MappedLayerId) => void
}): Promise<MappedEvidence> {
  const { footprintHa } = measure(footprint, [])
  const layers: MappedLayer[] = []
  for (const read of LAYER_READS) {
    onProgress?.(read.layer)
    layers.push(await readMappedLayer({ read, footprint, footprintHa, fetch, signal, measure, near }))
  }
  return { readOn, shape, footprint: signature, footprintHa, layers }
}

/** Whether the mapped read describes the footprint the review is for. */
export const mappedCurrent = (record: Pick<RangeReview, 'shape' | 'footprint' | 'mapped'>) =>
  Boolean(record.mapped && record.mapped.shape === record.shape && record.mapped.footprint === record.footprint)

export const formatHa = (ha: number) => (ha > 0 && ha < 0.01 ? '<0.01' : ha.toFixed(2))

/** What a layer's measure column is called: an area's overlap, a line's length, a point's count. */
export function measureLabel(layer: MappedLayerId) {
  const kind = LAYER_READS.find((r) => r.layer === layer)?.kind
  return kind === 'line' ? 'Length' : kind === 'point' ? 'Count' : 'Overlap'
}

export const formatMetres = (m: number) => (m > 0 && m < 1 ? '<1' : Math.round(m).toLocaleString('en-CA'))

/** A feature's measure as it prints: overlap and share, length, or count, each inside and near. */
export function featureMeasure(feature: MappedFeature, marginM = NEAR_FOOTPRINT_METRES): string {
  if (feature.lengthM !== undefined)
    return `${formatMetres(feature.insideLengthM ?? 0)} m inside · ${formatMetres(feature.lengthM)} m within ${marginM} m`
  if (feature.count !== undefined) return `${feature.insideCount ?? 0} inside · ${feature.count} within ${marginM} m`
  return `${formatHa(feature.overlapHa ?? 0)} ha · ${(feature.sharePercent ?? 0).toFixed(1)}%`
}

/** The layer's answer in one line: what is there, or "Not read" when it could not be read. */
export function layerSummary(layer: MappedLayer): string {
  if (layer.status === 'failed') return `Not read: ${layer.message ?? 'the read failed.'}`
  const margin = layer.marginM ?? NEAR_FOOTPRINT_METRES
  const counts = MAPPED_GROUPS.flatMap((g) => {
    const n = layer.features.filter((f) => f.group === g).length
    if (!n) return []
    const label = GROUP_LABELS[g].replace(/ \(.*\)$/, '')
    const length = layer.lengths?.find((c) => c.group === g)
    if (length)
      return [
        `${label}: ${formatMetres(length.insideLengthM)} m inside, ${formatMetres(length.lengthM)} m within ${margin} m (${n} ${n === 1 ? 'record' : 'records'})`,
      ]
    const count = layer.counts?.find((c) => c.group === g)
    if (count) return [`${label}: ${count.insideCount} inside, ${count.count} within ${margin} m`]
    const ha = layer.covered.find((c) => c.group === g)?.ha
    return [`${label}: ${n} (${formatHa(ha ?? 0)} ha)`]
  })
  const nothing =
    layer.marginM === undefined
      ? 'Nothing mapped overlaps the footprint'
      : `Nothing mapped inside the footprint or within ${margin} m of it`
  const listed = counts.length ? counts.join(' · ') : nothing
  return layer.status === 'truncated' ? `${listed}. Incomplete: ${layer.message}` : listed
}
