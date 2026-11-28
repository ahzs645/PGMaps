/**
 * The block's own tenure records, read on the reviewer's click for the session, and the public
 * signals in them that bear on an exception a rule lists: a harvesting authority marked
 * catastrophic or salvage (FPPR §64(2), on `limit-60` and `limit-40`), a cutting permit's issue date
 * (FRPA §3(1.1), on `fdu`), and a cut block marked SP exempt or an opening in RESULTS' `SPEX`
 * category (FPPR §33(1), on `site-plan`).
 *
 * A signal says what the record says, never why, and is never a fact or a claim: the review offers
 * it beside the exception, and only the reviewer's click puts it in a claim's evidence
 * (`ExceptionClaim.tsx`). The records are the ones sharing more than a sliver of ground with the
 * block's footprint (`MIN_RECORD_OVERLAP_HA`), each part read by its own ring, never a box. A layer
 * that failed is listed as not read, never as holding nothing.
 *
 * No holder's or client's name is requested or kept: `CLIENT_NAME` and `CLIENT_NUMBER` are sent by
 * DataBC whatever `propertyName` asks, and every record is cut to its listed fields on arrival
 * (`keepFields`).
 *
 * DOM- and network-free: `fetch` and the overlay's measure are passed in.
 */
import { keepFields, readAcrossParts, wfsRead, type Fetch, type RawFeature, type Shape } from '../wfsReads'
import { CUT_BLOCK_LAYER, NO_OBLIGATION_CATEGORIES, OPENING_LAYER } from '../ground/precedent'
import { SLIVER_HA } from './landCandidates'

export const HARVEST_AUTHORITY_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_HARVEST_AUTH_POLY_SVW'

/** Narrow on purpose: never `CLIENT_NAME`, `CLIENT_NUMBER` or `CLIENT_LOCATION_CODE`. */
export const AUTHORITY_FIELDS = [
  'OBJECTID',
  'FOREST_FILE_ID',
  'CUTTING_PERMIT_ID',
  'HARVEST_TYPE_CODE',
  'HARVEST_TYPE_DESCRIPTION',
  'HARVEST_AUTH_STATUS_CODE',
  'ISSUE_DATE',
  'EXPIRY_DATE',
  'SALVAGE_TYPE_CODE',
  'SALVAGE_TYPE_DESCRIPTION',
  'CATASTROPHIC_IND',
  'FILE_TYPE_DESCRIPTION',
  'LIFE_CYCLE_STATUS_CODE',
] as const
export const BLOCK_FIELDS = [
  'OBJECTID',
  'CUT_BLOCK_FOREST_FILE_ID',
  'HARVEST_AUTH_CUTTING_PERMIT_ID',
  'CUT_BLOCK_ID',
  'OPENING_ID',
  'BLOCK_STATUS_CODE',
  'SP_EXEMPT_IND',
  'LIFE_CYCLE_STATUS_CODE',
] as const
export const OPENING_SIGNAL_FIELDS = [
  'OPENING_ID',
  'OPENING_CATEGORY_CODE',
  'OPENING_STATUS_CODE',
  'FOREST_FILE_ID',
  'CUTTING_PERMIT_ID',
  'CUT_BLOCK_ID',
] as const

/**
 * A record sharing less ground than this with the block (100 m², the land status candidates' sliver)
 * is two drawn boundaries meeting, not the block's own record, and offers nothing.
 */
export const MIN_RECORD_OVERLAP_HA = SLIVER_HA
/** Records read per layer; more is an error, never a partial list. */
export const MAX_TENURE_RECORDS = 200

export type TenureRecordKind = 'authority' | 'cut-block' | 'opening'

export interface TenureRecord {
  kind: TenureRecordKind
  /** How the record is named: "TSL A12345 · CP 1", "Cut block A12345 · CP 1 · 3", "Opening 123". */
  id: string
  overlapHa: number
  /** Share of the block's footprint, in percent. */
  sharePercent: number
  /** The listed fields as the record holds them, text only. */
  fields: Record<string, string>
}

/** A public record bearing on an exception a release lists: what it says, and its date when it has one. */
export interface ExceptionSignal {
  /** The instrument whose rules list the exception (`bc.fppr`, `bc.forest-permits`). */
  pack: string
  exception: string
  /** The record it comes from, as `TenureRecord.id` names it. */
  record: string
  text: string
  date?: string
}

export interface TenureSignalsRead {
  readOn: string
  records: TenureRecord[]
  signals: ExceptionSignal[]
  /** Layers that could not be read, with why: never read as holding nothing. */
  failed: { layer: TenureRecordKind; message: string }[]
  /** Records touching the block by less than `MIN_RECORD_OVERLAP_HA`, left out. */
  slivers: number
}

const LAYERS: {
  kind: TenureRecordKind
  layer: string
  fields: readonly string[]
  key: string
}[] = [
  { kind: 'authority', layer: HARVEST_AUTHORITY_LAYER, fields: AUTHORITY_FIELDS, key: 'OBJECTID' },
  { kind: 'cut-block', layer: CUT_BLOCK_LAYER, fields: BLOCK_FIELDS, key: 'OBJECTID' },
  { kind: 'opening', layer: OPENING_LAYER, fields: OPENING_SIGNAL_FIELDS, key: 'OPENING_ID' },
]

const KIND_LABEL: Record<TenureRecordKind, string> = {
  authority: 'harvesting authorities',
  'cut-block': 'cut blocks',
  opening: 'RESULTS openings',
}
export const tenureKindLabel = (kind: TenureRecordKind) => KIND_LABEL[kind]

const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? undefined : String(v).replace(/Z$/, '').trim() || undefined
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v)

function recordId(kind: TenureRecordKind, f: Record<string, string>) {
  if (kind === 'authority')
    return [f.FOREST_FILE_ID, f.CUTTING_PERMIT_ID ? `CP ${f.CUTTING_PERMIT_ID}` : ''].filter(Boolean).join(' · ')
  if (kind === 'cut-block')
    return [
      'Cut block',
      f.CUT_BLOCK_FOREST_FILE_ID,
      f.HARVEST_AUTH_CUTTING_PERMIT_ID ? `CP ${f.HARVEST_AUTH_CUTTING_PERMIT_ID}` : '',
      f.CUT_BLOCK_ID ? `block ${f.CUT_BLOCK_ID}` : '',
    ]
      .filter(Boolean)
      .join(' ')
  return `Opening ${f.OPENING_ID ?? '?'}`
}

/**
 * The signals the records hold, each worded as the record states it. Pure: the records come from
 * `readTenureSignals` or a test.
 */
export function signalsOf(records: TenureRecord[]): ExceptionSignal[] {
  const out: ExceptionSignal[] = []
  for (const r of records) {
    const f = r.fields
    if (r.kind === 'authority') {
      const salvage = f.SALVAGE_TYPE_CODE
        ? `salvage type ${f.SALVAGE_TYPE_CODE}${f.SALVAGE_TYPE_DESCRIPTION ? ` (${f.SALVAGE_TYPE_DESCRIPTION})` : ''}`
        : ''
      if (f.CATASTROPHIC_IND === 'Y' || salvage)
        out.push({
          pack: 'bc.fppr',
          exception: 'salvage-or-natural',
          record: r.id,
          text: `Forest Tenures records harvesting authority ${r.id} as ${[
            f.CATASTROPHIC_IND === 'Y' ? 'catastrophic (CATASTROPHIC_IND = Y)' : '',
            salvage,
          ]
            .filter(Boolean)
            .join(', ')}. The record does not say what was damaged or that the opening resembles a natural one.`,
          ...(day(f.ISSUE_DATE) ? { date: day(f.ISSUE_DATE) } : {}),
        })
      if (f.ISSUE_DATE && f.CUTTING_PERMIT_ID)
        out.push({
          pack: 'bc.forest-permits',
          exception: 'earlier-permit',
          record: r.id,
          text: `Forest Tenures records cutting permit ${r.id} as issued on ${day(f.ISSUE_DATE)}${
            f.HARVEST_AUTH_STATUS_CODE ? ` (status ${f.HARVEST_AUTH_STATUS_CODE})` : ''
          }. The record does not say which forest stewardship plan covered it or when that plan expired.`,
          date: day(f.ISSUE_DATE),
        })
    } else if (r.kind === 'cut-block' && f.SP_EXEMPT_IND === 'Y')
      out.push({
        pack: 'bc.forest-permits',
        exception: 'fppr-33-cutblock',
        record: r.id,
        text: `Forest Tenures marks ${r.id} SP exempt (SP_EXEMPT_IND = Y). The record does not say which circumstance exempts it.`,
      })
    else if (r.kind === 'opening' && f.OPENING_CATEGORY_CODE && NO_OBLIGATION_CATEGORIES[f.OPENING_CATEGORY_CODE])
      out.push({
        pack: 'bc.forest-permits',
        exception: 'fppr-33-cutblock',
        record: r.id,
        text: `RESULTS holds ${r.id} in category ${f.OPENING_CATEGORY_CODE}, which its submission specifications describe as ${
          NO_OBLIGATION_CATEGORIES[f.OPENING_CATEGORY_CODE]
        }. The record does not say which circumstance exempts it.`,
      })
  }
  return out
}

const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'

/**
 * Reads the harvesting authorities, cut blocks and openings sharing ground with the block, and the
 * signals in them. Each layer is read by the footprint's own parts; one failing leaves the others.
 */
export async function readTenureSignals({
  footprint,
  fetch,
  signal,
  measure,
  readOn,
}: {
  footprint: Shape
  fetch: Fetch
  signal?: AbortSignal
  /** Each shape's overlap with the footprint in hectares, and the footprint's own area (`groundOverlay.measure`). */
  measure: (footprint: Shape, others: Shape[]) => { footprintHa: number; eachHa: number[] }
  readOn: string
}): Promise<TenureSignalsRead> {
  const records: TenureRecord[] = []
  const failed: TenureSignalsRead['failed'] = []
  let slivers = 0
  const { footprintHa } = measure(footprint, [])
  for (const { kind, layer, fields, key } of LAYERS) {
    let raw: RawFeature[]
    try {
      raw = await readAcrossParts(
        footprint,
        async (filter) => {
          const answer = await wfsRead({
            fetch,
            signal,
            layer,
            filter,
            propertyName: [...fields, 'GEOMETRY'].join(','),
            sortBy: key,
            cap: MAX_TENURE_RECORDS,
          })
          if (answer.truncated) throw Error(`More than ${MAX_TENURE_RECORDS} records over the block.`)
          return answer.features.map((f) => ({ ...f, properties: keepFields(f.properties, fields) }))
        },
        'GEOMETRY',
        (f) => String(f.properties[key]),
      )
    } catch (e) {
      if (signal?.aborted) throw e
      failed.push({
        layer: kind,
        message: e instanceof Error && e.message ? e.message.slice(0, 500) : 'The read failed.',
      })
      continue
    }
    const areas = raw.filter((f) => isArea(f.geometry))
    const { eachHa } = measure(
      footprint,
      areas.map((f) => f.geometry as Shape),
    )
    areas.forEach((f, i) => {
      const overlapHa = eachHa[i] ?? 0
      if (overlapHa < MIN_RECORD_OVERLAP_HA) {
        if (overlapHa > 0) slivers++
        return
      }
      const values: Record<string, string> = {}
      for (const field of fields) {
        const v = text(f.properties[field])
        if (v !== undefined) values[field] = v
      }
      records.push({
        kind,
        id: recordId(kind, values),
        overlapHa,
        sharePercent: footprintHa > 0 ? Math.min(100, (overlapHa / footprintHa) * 100) : 0,
        fields: values,
      })
    })
  }
  records.sort((a, b) => b.overlapHa - a.overlapHa || a.id.localeCompare(b.id))
  return { readOn, records, signals: signalsOf(records), failed, slivers }
}
