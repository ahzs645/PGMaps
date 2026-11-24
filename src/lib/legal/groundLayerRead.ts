/**
 * One ground catalogue layer (`groundInstruments.ts`) read against a footprint: the one reader the
 * block planner's *On this ground* and the visual quality page's land status checks share, so a
 * layer, its fields, its filter and its margin are defined once, in the catalogue.
 *
 * The layer is read by the footprint's own parts (`INTERSECTS` with each part's outer ring, by POST,
 * through `src/lib/forestry/wfsReads.ts`; by each part's hull for a layer of a few very detailed
 * polygons), never its box, with every instrument's conditions joined by OR (a context layer, which
 * no instrument names, is read whole). A line or point layer is read against the footprint grown by
 * its stated margin. Every record is cut to the catalogue's fields as it arrives (`keepFields`):
 * DataBC returns a layer's mandatory attributes whatever `propertyName` asks, and nothing else is
 * ever held. What a tool measures on the records it gets back is its own.
 *
 * A read DataBC does not answer throws; the caller reads that as *Not read*, never as none.
 *
 * DOM- and network-free: `fetch` and the footprint's growing are passed in.
 */
import type { LineString, MultiLineString, MultiPoint, Point } from 'geojson'
import { keepFields, readAcrossParts, wfsRead, type Fetch, type RawFeature, type Shape } from '@/lib/forestry/wfsReads'
import {
  GROUND_CATALOGUE,
  layerCql,
  matches,
  type GroundCatalogue,
  type GroundInstrument,
  type GroundLayer,
} from './groundInstruments'

/** A line or point layer is asked for a little more than its margin: the ring is rounded to about a metre. */
export const NEAR_READ_SLACK_METRES = 2

export type Lines = LineString | MultiLineString
export type Points = Point | MultiPoint
export type GroundGeometry = Shape | Lines | Points

export const isArea = (g: RawFeature['geometry']): g is Shape => g?.type === 'Polygon' || g?.type === 'MultiPolygon'
export const isLine = (g: RawFeature['geometry']): g is Lines =>
  g?.type === 'LineString' || g?.type === 'MultiLineString'
export const isPoint = (g: RawFeature['geometry']): g is Points => g?.type === 'Point' || g?.type === 'MultiPoint'
const ofKind = (layer: GroundLayer) =>
  layer.geometry === 'line' ? isLine : layer.geometry === 'point' ? isPoint : isArea

/** A value as text: a trimmed string or a finite number, else `null`. */
export const valueText = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null

/** The instruments the catalogue reads from a layer, in its order; none for a context layer. */
export const layerInstruments = (layer: GroundLayer, catalogue: GroundCatalogue = GROUND_CATALOGUE) =>
  catalogue.instruments.filter((x) => x.layer === layer.id)

export interface GroundRow<G = GroundGeometry> {
  properties: Record<string, unknown>
  geometry: G
}

export interface GroundLayerAnswer<G = GroundGeometry> {
  /** `truncated`: DataBC holds more records against the footprint than `cap`; only the first are kept. */
  status: 'read' | 'truncated'
  rows: GroundRow<G>[]
}

/**
 * Reads one layer against a footprint: the records of `instruments` (all of a context layer's),
 * each kept once across the footprint's parts, cut to the layer's fields, of the layer's geometry
 * kind, at most `cap`.
 */
export async function readGroundLayer({
  layer,
  instruments,
  footprint,
  fetch,
  signal,
  grow,
  cap,
}: {
  layer: GroundLayer
  /** The instruments to read the layer for; empty only for a context layer. */
  instruments: readonly GroundInstrument[]
  footprint: Shape
  fetch: Fetch
  signal?: AbortSignal
  /** The footprint grown by `metres`, WGS84: needed only for a line or point layer. */
  grow?: (footprint: Shape, metres: number) => Shape
  cap: number
}): Promise<GroundLayerAnswer> {
  if (!layer.context && !instruments.length) throw Error(`No instrument reads ${layer.id}.`)
  if (layer.context && instruments.length) throw Error(`${layer.id} is a context layer: no instrument reads it.`)
  if (instruments.some((x) => x.layer !== layer.id)) throw Error(`An instrument given is not read from ${layer.id}.`)
  if (layer.near && !grow) throw Error(`${layer.id} is read within ${layer.near.metres} m: pass grow.`)
  const where = instruments.length ? layerCql(instruments) : null
  const asked = layer.near && grow ? grow(footprint, layer.near.metres + NEAR_READ_SLACK_METRES) : footprint
  let truncated = false
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
        cap,
      })
      truncated ||= answer.truncated
      return answer.features.map((f) => ({ ...f, properties: keepFields(f.properties, layer.fields) }))
    },
    layer.geometryField,
    (f) => valueText(f.properties[layer.key]) ?? JSON.stringify(f.properties),
    layer.byHull === true,
  )
  if (raw.length > cap) truncated = true
  const kind = ofKind(layer)
  return {
    status: truncated ? 'truncated' : 'read',
    rows: raw
      .slice(0, cap)
      .filter((f) => kind(f.geometry))
      .map((f) => ({ properties: f.properties, geometry: f.geometry as GroundGeometry })),
  }
}

/** Each record to the first instrument whose conditions it meets, in the order given; a record none meets is left out. */
export function shareRows<R extends { properties: Record<string, unknown> }>(
  instruments: readonly GroundInstrument[],
  rows: readonly R[],
): Map<string, R[]> {
  const shares = new Map<string, R[]>(instruments.map((x) => [x.id, []]))
  for (const row of rows) {
    const owner = instruments.find((x) => matches(x.where, row.properties))
    if (owner) shares.get(owner.id)!.push(row)
  }
  return shares
}
