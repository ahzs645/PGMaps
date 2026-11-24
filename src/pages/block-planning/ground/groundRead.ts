/**
 * "On this ground": every legal instrument the catalogue lists (`groundInstruments.ts`) read against
 * a block's footprint on the reviewer's click. Each layer is read once by the footprint's own parts
 * (`INTERSECTS` per part, by POST, through `wfsReads.ts`), never its box; its records are shared out
 * to the catalogue's instruments by their conditions, and each record is clipped to the footprint in
 * BC Albers with the old forest calculation's overlays. Then the precedent (`precedent.ts`) reads
 * what RESULTS records inside each instrument found near the block.
 *
 * What comes back is candidates and what the catalogue says each instrument can reach: it never
 * says an instrument applies, that a block may or may not be cut, or that an exception is met. A
 * layer that could not be read is "Not read", never "none". Only the catalogue's fields are kept:
 * DataBC returns a layer's mandatory attributes whatever `propertyName` asks (the range tenure
 * layer's `CLIENT_NAME`, RESULTS' IDIR users), so every record is cut down to the listed fields as
 * it arrives and nothing else is ever held.
 *
 * DOM- and network-free: `fetch` and the overlays (`groundOverlay`, `oldForest.ts`) are passed in.
 */
import {
  GROUND_CATALOGUE,
  matches,
  layerCql,
  type GroundCatalogue,
  type GroundInstrument,
  type GroundLayer,
} from '@/lib/legal/groundInstruments'
import type { Shape } from '../plan'
import { keepFields, readAcrossParts, wfsRead, type Fetch, type RawFeature } from '../wfsReads'

export { keepFields }
import { readPrecedent, PRECEDENT_RADIUS_METRES, type PrecedentRegion } from './precedent'
import { MAX_GROUND_FEATURES, type GroundFeature, type GroundInstrumentRead, type GroundRead } from './record'

/** Overlaps smaller than a square metre are the overlay's rounding, not ground, and are left out. */
export const MIN_GROUND_OVERLAP_HA = 0.0001

/** The overlays, passed in (`groundOverlay`, `oldForest.ts`). */
export interface GroundOverlay {
  /** Each shape's overlap with the footprint in hectares, and their dissolved total. */
  measure: (footprint: Shape, others: Shape[]) => { footprintHa: number; eachHa: number[]; coveredHa: number }
  /** The footprint grown by `metres`, in WGS84. */
  grow: (footprint: Shape, metres: number) => Shape
  /** The part of `a` inside `b`, or `null`. */
  clip: (a: Shape, b: Shape) => Shape | null
  /** Which items share area with which regions, `[region][item]`. */
  overlaps: (regions: Shape[], items: Shape[]) => boolean[][]
}

const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
const aborted = (signal: AbortSignal | undefined, e: unknown) =>
  Boolean(signal?.aborted) || (e instanceof Error && e.name === 'AbortError')

export const valueText = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
/** A DataBC date ("2014-05-12Z") as YYYY-MM-DD, or `null`. */
export const dayOf = (v: unknown) => {
  const m = typeof v === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(v) : null
  return m ? m[0] : null
}

/** A record as the catalogue names it. Exported for the tests. */
export function describeFeature(layer: GroundLayer, p: Record<string, unknown>) {
  const spec = layer.feature
  const idParts = spec.id.fields.map((f) => valueText(p[f])).filter((v): v is string => v !== null)
  const fallback = valueText(p[spec.id.fallback])
  const id = idParts.length
    ? `${spec.id.label} ${idParts.join(' ')}`
    : `${spec.id.label} (record ${fallback ?? 'not numbered'})`
  const name =
    spec.name
      .map((f) => valueText(p[f]))
      .filter(Boolean)
      .join(' · ') || 'Not named in the layer'
  const details = spec.details.flatMap((d) => {
    const v = d.date ? dayOf(p[d.field]) : valueText(p[d.field])
    return v === null ? [] : [`${d.label}: ${v}${d.unit ? ` ${d.unit}` : ''}`.slice(0, 1000)]
  })
  const identifiers = spec.identifiers.flatMap((i) => {
    const v = valueText(p[i.field])
    return v === null ? [] : [{ label: i.label, value: v.slice(0, 500) }]
  })
  const effective = layer.date ? dayOf(p[layer.date.field]) : null
  return { id: id.slice(0, 200), name: name.slice(0, 500), details, identifiers, ...(effective ? { effective } : {}) }
}

interface LayerAnswer {
  status: 'read' | 'truncated'
  rows: { properties: Record<string, unknown>; geometry: Shape }[]
}

/** One layer read across the footprint's parts, its records cut to the listed fields. */
async function readLayer(
  layer: GroundLayer,
  instruments: GroundInstrument[],
  footprint: Shape,
  fetch: Fetch,
  signal: AbortSignal | undefined,
): Promise<LayerAnswer> {
  let truncated = false
  const where = layerCql(instruments)
  const raw = await readAcrossParts(
    footprint,
    async (intersects) => {
      const answer = await wfsRead({
        fetch,
        signal,
        layer: layer.typeName,
        filter: where ? `${intersects} AND ${where}` : intersects,
        propertyName: [...layer.fields, layer.geometryField].join(','),
        sortBy: layer.key,
        cap: MAX_GROUND_FEATURES,
      })
      truncated ||= answer.truncated
      return answer.features.map((f) => ({ ...f, properties: keepFields(f.properties, layer.fields) }))
    },
    layer.geometryField,
    (f) => valueText(f.properties[layer.key]) ?? JSON.stringify(f.properties),
  )
  if (raw.length > MAX_GROUND_FEATURES) truncated = true
  return {
    status: truncated ? 'truncated' : 'read',
    rows: raw
      .slice(0, MAX_GROUND_FEATURES)
      .filter((f) => isArea(f.geometry))
      .map((f) => ({ properties: f.properties, geometry: f.geometry as Shape })),
  }
}

/** An instrument's share of a layer's records, measured on the footprint. Exported for the tests. */
export function measureInstrument(
  layer: GroundLayer,
  rows: LayerAnswer['rows'],
  footprint: Shape,
  footprintHa: number,
  overlay: GroundOverlay,
): { features: (GroundFeature & { geometry: Shape })[]; coveredHa: number } {
  if (!rows.length) return { features: [], coveredHa: 0 }
  const { eachHa } = overlay.measure(
    footprint,
    rows.map((r) => r.geometry),
  )
  const kept = rows
    .map((r, i) => ({ ...describeFeature(layer, r.properties), geometry: r.geometry, overlapHa: eachHa[i] }))
    .filter((f) => f.overlapHa >= MIN_GROUND_OVERLAP_HA)
    .sort((a, b) => b.overlapHa - a.overlapHa || a.id.localeCompare(b.id))
  const coveredHa =
    kept.length === 1
      ? kept[0].overlapHa
      : overlay.measure(
          footprint,
          kept.map((k) => k.geometry),
        ).coveredHa
  return {
    features: kept.map((f) => ({
      ...f,
      sharePercent: footprintHa > 0 ? Math.min(100, (f.overlapHa / footprintHa) * 100) : 0,
    })),
    coveredHa,
  }
}

export type GroundStage = { kind: 'layer'; layer: GroundLayer } | { kind: 'precedent'; step: string }

/** Reads every layer against one footprint, one after another so a cancel stops at once. */
export async function readGroundInstruments({
  footprint,
  block,
  schedule,
  shape,
  signature,
  fetch,
  signal,
  overlay,
  readOn,
  onProgress,
  catalogue = GROUND_CATALOGUE,
  radiusM = PRECEDENT_RADIUS_METRES,
}: {
  footprint: Shape
  block: string
  schedule: string
  /** The block shape's id and footprint signature, as the read is keyed. */
  shape: string
  signature: string
  fetch: Fetch
  signal?: AbortSignal
  overlay: GroundOverlay
  readOn: string
  onProgress?: (stage: GroundStage) => void
  catalogue?: GroundCatalogue
  radiusM?: number
}): Promise<GroundRead> {
  const { footprintHa } = overlay.measure(footprint, [])
  const reads: GroundInstrumentRead[] = []
  const regions: PrecedentRegion[] = []
  for (const layer of catalogue.layers) {
    const instruments = catalogue.instruments.filter((x) => x.layer === layer.id)
    if (!instruments.length) continue
    onProgress?.({ kind: 'layer', layer })
    let answer: LayerAnswer
    try {
      answer = await readLayer(layer, instruments, footprint, fetch, signal)
    } catch (e) {
      if (aborted(signal, e)) throw e
      const message = e instanceof Error && e.message ? e.message.slice(0, 2000) : 'The read failed.'
      for (const x of instruments)
        reads.push({ instrument: x.id, status: 'failed', message, features: [], coveredHa: 0 })
      continue
    }
    // Each record goes to the first instrument whose conditions it meets, as the catalogue orders them.
    const shares = new Map<string, LayerAnswer['rows']>(instruments.map((x) => [x.id, []]))
    for (const row of answer.rows) {
      const owner = instruments.find((x) => matches(x.where, row.properties))
      if (owner) shares.get(owner.id)!.push(row)
    }
    for (const x of instruments) {
      const { features, coveredHa } = measureInstrument(layer, shares.get(x.id)!, footprint, footprintHa, overlay)
      reads.push({
        instrument: x.id,
        status: answer.status,
        ...(answer.status === 'truncated'
          ? { message: `DataBC holds more than ${MAX_GROUND_FEATURES} records here; only the first are listed.` }
          : {}),
        features: features.map(({ geometry: _geometry, ...f }) => f),
        coveredHa,
      })
      for (const f of features)
        regions.push({ instrument: x.id, feature: f.id, effective: f.effective ?? null, geometry: f.geometry })
    }
  }
  const precedent = regions.length
    ? await readPrecedent({
        footprint,
        regions,
        dated: Object.fromEntries(
          catalogue.instruments.map((x) => [x.id, Boolean(catalogue.layers.find((l) => l.id === x.layer)?.date)]),
        ),
        fetch,
        signal,
        overlay,
        radiusM,
        onProgress: (step) => onProgress?.({ kind: 'precedent', step }),
      })
    : undefined
  return {
    block,
    schedule,
    shape,
    footprint: signature,
    readOn,
    footprintHa,
    catalogue: catalogue.version,
    instruments: reads,
    ...(precedent ? { precedent } : {}),
  }
}
