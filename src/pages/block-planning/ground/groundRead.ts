/**
 * "On this ground": every legal instrument the catalogue lists (`groundInstruments.ts`) read against
 * a block's footprint on the reviewer's click. Each layer is read once by the footprint's own parts
 * (`INTERSECTS` per part, by POST, through `wfsReads.ts`; by each part's hull for a layer of a few
 * very detailed polygons), never its box; its records are shared out to the catalogue's instruments
 * by their conditions. An area record is clipped to the footprint in BC Albers with the old forest
 * calculation's overlays; a line is measured and a point counted inside the footprint and within the
 * layer's stated margin of it, read against the footprint grown by that margin. Then the precedent
 * (`precedent.ts`) reads what RESULTS and the other public records hold inside each area instrument
 * found near the block.
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
import type { LineString, MultiLineString, MultiPoint, Point } from 'geojson'
import type { Shape } from '../plan'
import { keepFields, readAcrossParts, wfsRead, type Fetch, type RawFeature } from '../wfsReads'

export { keepFields }
import { readPrecedent, PRECEDENT_RADIUS_METRES, type PrecedentRegion } from './precedent'
import {
  MAX_GROUND_FEATURES,
  type GroundFeature,
  type GroundInstrumentRead,
  type GroundRead,
  type NearMeasure,
} from './record'

/** Overlaps smaller than a square metre are the overlay's rounding, not ground, and are left out. */
export const MIN_GROUND_OVERLAP_HA = 0.0001
/** Shorter stretches of a line are the overlay's rounding, not a line on the ground, and are left out. */
export const MIN_NEAR_LENGTH_M = 0.01
/** A line or point layer is asked for a little more than its margin: the ring is rounded to about a metre. */
const NEAR_READ_SLACK_METRES = 2

type Lines = LineString | MultiLineString
type Points = Point | MultiPoint

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
  /** Each line's length inside the footprint and within `metres` of it, and the same for all joined. */
  lines: (
    footprint: Shape,
    metres: number,
    lines: Lines[],
  ) => { each: { insideM: number; nearM: number }[]; insideM: number; nearM: number }
  /** How many of each record's points lie inside the footprint and within `metres` of it. */
  points: (footprint: Shape, metres: number, points: Points[]) => { insideCount: number; nearCount: number }[]
}

const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
const isLine = (g: RawFeature['geometry']): g is Lines => g?.type === 'LineString' || g?.type === 'MultiLineString'
const isPoint = (g: RawFeature['geometry']): g is Points => g?.type === 'Point' || g?.type === 'MultiPoint'
const ofKind = (layer: GroundLayer) =>
  layer.geometry === 'line' ? isLine : layer.geometry === 'point' ? isPoint : isArea
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

interface LayerAnswer<G = Shape> {
  status: 'read' | 'truncated'
  rows: { properties: Record<string, unknown>; geometry: G }[]
}

/** One layer read across the footprint's parts (grown by its margin for lines and points), its records cut to the listed fields. */
async function readLayer(
  layer: GroundLayer,
  instruments: GroundInstrument[],
  footprint: Shape,
  fetch: Fetch,
  signal: AbortSignal | undefined,
  overlay: GroundOverlay,
): Promise<LayerAnswer<Shape | Lines | Points>> {
  let truncated = false
  const where = layerCql(instruments)
  const asked = layer.near ? overlay.grow(footprint, layer.near.metres + NEAR_READ_SLACK_METRES) : footprint
  const raw = await readAcrossParts(
    asked,
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
    layer.byHull === true,
  )
  if (raw.length > MAX_GROUND_FEATURES) truncated = true
  const kind = ofKind(layer)
  return {
    status: truncated ? 'truncated' : 'read',
    rows: raw
      .slice(0, MAX_GROUND_FEATURES)
      .filter((f) => kind(f.geometry))
      .map((f) => ({ properties: f.properties, geometry: f.geometry as Shape | Lines | Points })),
  }
}

/**
 * A line or point instrument's share of a layer's records, measured inside the footprint and within
 * the layer's margin of it. Exported for the tests.
 */
export function measureNear(
  layer: GroundLayer,
  rows: LayerAnswer<Lines | Points>['rows'],
  footprint: Shape,
  overlay: GroundOverlay,
): { features: GroundFeature[]; near: NearMeasure } {
  const metres = layer.near?.metres ?? 0
  if (layer.geometry === 'line') {
    const lines = rows.filter((r) => isLine(r.geometry)) as LayerAnswer<Lines>['rows']
    if (!lines.length) return { features: [], near: { metres, insideM: 0, nearM: 0 } }
    const { each } = overlay.lines(
      footprint,
      metres,
      lines.map((r) => r.geometry),
    )
    const kept = lines
      .map((r, i) => ({ r, m: each[i] }))
      .filter(({ m }) => m.nearM >= MIN_NEAR_LENGTH_M)
      .sort((a, b) => b.m.nearM - a.m.nearM)
    const joined = kept.length
      ? overlay.lines(
          footprint,
          metres,
          kept.map(({ r }) => r.geometry),
        )
      : { insideM: 0, nearM: 0 }
    return {
      features: kept.map(({ r, m }) => ({
        ...describeFeature(layer, r.properties),
        overlapHa: 0,
        sharePercent: 0,
        near: { metres, insideM: m.insideM, nearM: m.nearM },
      })),
      near: { metres, insideM: joined.insideM, nearM: joined.nearM },
    }
  }
  const points = rows.filter((r) => isPoint(r.geometry)) as LayerAnswer<Points>['rows']
  const counts = points.length
    ? overlay.points(
        footprint,
        metres,
        points.map((r) => r.geometry),
      )
    : []
  const kept = points
    .map((r, i) => ({ r, c: counts[i] }))
    .filter(({ c }) => c.nearCount > 0)
    .sort((a, b) => b.c.insideCount - a.c.insideCount || b.c.nearCount - a.c.nearCount)
  return {
    features: kept.map(({ r, c }) => ({
      ...describeFeature(layer, r.properties),
      overlapHa: 0,
      sharePercent: 0,
      near: { metres, insideCount: c.insideCount, nearCount: c.nearCount },
    })),
    near: {
      metres,
      insideCount: kept.reduce((n, { c }) => n + c.insideCount, 0),
      nearCount: kept.reduce((n, { c }) => n + c.nearCount, 0),
    },
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
    let answer: LayerAnswer<Shape | Lines | Points>
    try {
      answer = await readLayer(layer, instruments, footprint, fetch, signal, overlay)
    } catch (e) {
      if (aborted(signal, e)) throw e
      const message = e instanceof Error && e.message ? e.message.slice(0, 2000) : 'The read failed.'
      for (const x of instruments)
        reads.push({ instrument: x.id, status: 'failed', message, features: [], coveredHa: 0 })
      continue
    }
    // Each record goes to the first instrument whose conditions it meets, as the catalogue orders them.
    const shares = new Map<string, LayerAnswer<Shape | Lines | Points>['rows']>(instruments.map((x) => [x.id, []]))
    for (const row of answer.rows) {
      const owner = instruments.find((x) => matches(x.where, row.properties))
      if (owner) shares.get(owner.id)!.push(row)
    }
    const incomplete =
      answer.status === 'truncated'
        ? { message: `DataBC holds more than ${MAX_GROUND_FEATURES} records here; only the first are listed.` }
        : {}
    for (const x of instruments) {
      if (layer.geometry !== 'area') {
        const { features, near } = measureNear(
          layer,
          shares.get(x.id)! as LayerAnswer<Lines | Points>['rows'],
          footprint,
          overlay,
        )
        reads.push({ instrument: x.id, status: answer.status, ...incomplete, features, coveredHa: 0, near })
        continue
      }
      const { features, coveredHa } = measureInstrument(
        layer,
        shares.get(x.id)! as LayerAnswer['rows'],
        footprint,
        footprintHa,
        overlay,
      )
      reads.push({
        instrument: x.id,
        status: answer.status,
        ...incomplete,
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
