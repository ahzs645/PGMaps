/**
 * Reads a route card's layers and measures each row against a subject (a block or a road).
 *
 * Rows that read the same layer with the same filter share one read (the TAP rows, the operating
 * area twice, the non-legal OGMAs twice), asked for the subject's box grown by the widest search
 * among them. Every read is served in EPSG:3005 so distances are measured in metres on the frame
 * DataBC keeps; the box goes in `CQL_FILTER` (x first in 3005), never the WFS `bbox` parameter, and
 * `propertyName` names the geometry field, or DataBC returns features without shapes. `fetch` is
 * passed in: no DOM or network access of its own.
 */
import {
  distanceToSubject,
  growBounds,
  planarFromGeoJson,
  type Planar,
  type PlanarBounds,
  type PreparedSubject,
} from './geometry'
import { estimateNestRank } from './birdRank'
import type { ArcgisSource, RouteCardRow, WfsSource } from './rows'

export const ROUTE_CARD_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'

export type RouteCardRead = {
  /** Stable key: the layer and its filter. */
  key: string
  source: WfsSource | ArcgisSource
  /** Every field any of its rows needs. */
  fields: string[]
  /** The widest search among its rows, metres. */
  reachMeters: number
  maxFeatures: number
  rows: string[]
}

const sourceKey = (source: WfsSource | ArcgisSource) =>
  source.kind === 'wfs'
    ? `wfs:${source.typeName}|${source.filter ?? ''}`
    : `arcgis:${source.service}/${source.layer}|${source.where ?? ''}`

const reachOf = (row: RouteCardRow) => Math.max(row.search.yesWithinMeters, row.search.nearWithinMeters ?? 0)

/** The reads a set of rows needs, one per layer and filter. Rows that are not public need none. */
export function planReads(rows: readonly RouteCardRow[]): RouteCardRead[] {
  const reads = new Map<string, RouteCardRead>()
  for (const row of rows) {
    if (row.source.kind === 'notPublic') continue
    const key = sourceKey(row.source)
    const read = reads.get(key)
    if (read) {
      for (const field of row.source.fields) if (!read.fields.includes(field)) read.fields.push(field)
      read.reachMeters = Math.max(read.reachMeters, reachOf(row))
      read.maxFeatures = Math.max(read.maxFeatures, row.maxFeatures)
      read.rows.push(row.id)
    } else
      reads.set(key, {
        key,
        source: row.source,
        fields: [...row.source.fields],
        reachMeters: reachOf(row),
        maxFeatures: row.maxFeatures,
        rows: [row.id],
      })
  }
  return [...reads.values()]
}

const fixed = (value: number) => value.toFixed(1)

/** The address of one read, for the subject's box in EPSG:3005. */
export function readUrl(read: RouteCardRead, subjectBounds: PlanarBounds): string {
  const [w, s, e, n] = growBounds(subjectBounds, read.reachMeters)
  if (!(e > w && n > s)) throw new Error('Choose a block or road to check.')
  const source = read.source
  if (source.kind === 'wfs') {
    const box = `BBOX(${source.geometryField},${fixed(w)},${fixed(s)},${fixed(e)},${fixed(n)},'EPSG:3005')`
    return `${ROUTE_CARD_WFS}?${new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: source.typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:3005',
      count: String(read.maxFeatures),
      propertyName: [...read.fields, source.geometryField].join(','),
      CQL_FILTER: source.filter ? `(${source.filter}) AND ${box}` : box,
    }).toString()}`
  }
  return `${source.service}/${source.layer}/query?${new URLSearchParams({
    f: 'geojson',
    where: source.where ?? '1=1',
    outFields: read.fields.join(','),
    returnGeometry: 'true',
    geometryType: 'esriGeometryEnvelope',
    geometry: [w, s, e, n].map(fixed).join(','),
    inSR: '3005',
    outSR: '3005',
    spatialRel: 'esriSpatialRelIntersects',
    resultRecordCount: String(read.maxFeatures),
  }).toString()}`
}

export type ReadFeature = { props: Record<string, unknown>; shape: Planar }

/** A read's answer as features with shapes; `truncated` when the layer held more than one answer returns. */
export function parseRead(read: RouteCardRead, payload: unknown): { features: ReadFeature[]; truncated: boolean } {
  const collection = payload as {
    features?: unknown
    numberMatched?: unknown
    exceededTransferLimit?: unknown
    properties?: { exceededTransferLimit?: unknown }
  }
  if ((payload as { exceptions?: unknown; error?: unknown })?.exceptions || (payload as { error?: unknown })?.error)
    throw new Error('The service refused the query.')
  if (!Array.isArray(collection?.features)) throw new Error('The service sent no features.')
  const features = collection.features.flatMap((entry): ReadFeature[] => {
    const feature = entry as { geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }
    const shape = planarFromGeoJson(feature.geometry)
    return shape ? [{ props: feature.properties ?? {}, shape }] : []
  })
  const matched = typeof collection.numberMatched === 'number' ? collection.numberMatched : null
  const truncated =
    features.length >= read.maxFeatures ||
    (matched !== null && matched > features.length) ||
    collection.exceededTransferLimit === true ||
    collection.properties?.exceededTransferLimit === true
  return { features, truncated }
}

/** One read, through the `fetch` handed in. */
export async function runRead(
  read: RouteCardRead,
  subjectBounds: PlanarBounds,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ features: ReadFeature[]; truncated: boolean }> {
  const response = await fetcher(readUrl(read, subjectBounds), { signal })
  if (!response.ok) throw new Error(`The service answered ${response.status}.`)
  return parseRead(read, await response.json())
}

/**
 * A feature as the row prints it: its print fields joined with ", ", an empty field as "None"; for an estimated row,
 * PGMaps' estimate, or null when the feature has none (open ground has no nest rank).
 */
export function printFeature(row: RouteCardRow, props: Record<string, unknown>): string | null {
  if (row.estimate === 'migratory-bird-nest-rank') {
    const rank = estimateNestRank(props)
    return rank === null ? null : String(rank)
  }
  return row.print
    .map((field) => {
      const value = props[field]
      return value === null || value === undefined || value === '' ? 'None' : String(value)
    })
    .join(', ')
}

export type RouteCardMatch = {
  name: string
  /** Metres from the subject; 0 when it touches or overlaps. */
  distanceMeters: number
  props: Record<string, unknown>
  shape: Planar
}

export type RouteCardFinding = {
  /** Y, Within, or N. */
  answer: 'yes' | 'near' | 'no'
  /** What a Y prints, each once, in the order the layer listed them. */
  names: string[]
  /** What lies within the near search but is not Y; the tool prints nothing for these, PGMaps names them. */
  nearNames: string[]
  /** Every feature within the row's widest search, nearest first, for the considerations. */
  matches: RouteCardMatch[]
  /** Features the access road touches or crosses, wherever they lie along it; empty without a road. */
  alongAccess: RouteCardMatch[]
  /** The nearest feature within the row's widest search, metres; null when none lies that close. */
  nearestMeters: number | null
  truncated: boolean
}

const unique = (names: readonly string[]) => [...new Set(names)]

/** One row measured against a subject from its read's features. */
export function measureRow(
  row: RouteCardRow,
  subject: PreparedSubject,
  features: readonly ReadFeature[],
  truncated = false,
  access: PreparedSubject | null = null,
): RouteCardFinding {
  const reach = reachOf(row)
  let nearest = Infinity
  const matches: RouteCardMatch[] = []
  for (const feature of features) {
    const name = printFeature(row, feature.props)
    if (name === null) continue
    const distance = distanceToSubject(subject, feature.shape, Math.max(reach, 0))
    if (distance < nearest) nearest = distance
    if (distance <= reach)
      matches.push({
        name,
        distanceMeters: distance,
        props: feature.props,
        shape: feature.shape,
      })
  }
  const yes = matches.filter((match) => match.distanceMeters <= row.search.yesWithinMeters)
  const near =
    row.search.nearWithinMeters === null
      ? []
      : matches.filter(
          (match) =>
            match.distanceMeters > row.search.yesWithinMeters && match.distanceMeters <= row.search.nearWithinMeters!,
        )
  const yesNames = unique(yes.map((match) => match.name))
  return {
    answer: yes.length ? 'yes' : near.length ? 'near' : 'no',
    names: yesNames,
    nearNames: unique(near.map((match) => match.name)).filter((name) => !yesNames.includes(name)),
    matches: [...matches].sort((a, b) => a.distanceMeters - b.distanceMeters),
    nearestMeters: Number.isFinite(nearest) ? nearest : null,
    alongAccess: access
      ? features
          .filter((feature) => printFeature(row, feature.props) !== null)
          .filter((feature) => distanceToSubject(access, feature.shape, 0) === 0)
          .map((feature) => ({
            name: printFeature(row, feature.props)!,
            distanceMeters: 0,
            props: feature.props,
            shape: feature.shape,
          }))
      : [],
    truncated,
  }
}
