import type { FeatureCollection } from 'geojson'
import { checkedPortalAttributes, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { normalizeGeojson, httpsUrl, type VectorData } from './workspace'
import { inspectLocalZip, readBoundedLocalZip } from './localWorkbenchBundle'
import { parseImportJson } from './importValues'

export type SourceLayerKind = 'schema' | 'submission' | 'shared' | 'local'
export type LocalLayerAsset = {
  schema: 'nechako-local-layer-v1'
  kind: SourceLayerKind
  name: string
  sourceId?: string
  schemaId?: string
  submissionId?: string
  geometryType?: string
  data?: FeatureCollection
  original?: unknown
  materialization: {
    status: 'descriptor' | 'complete' | 'partial'
    basis: 'catalogue' | 'imported-file' | 'source-export' | 'wfs-count'
    featureCount?: number
    expectedFeatures?: number
    countVerified: boolean
    fetchedAt?: string
    notes: string[]
  }
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a source record object.')
  return value as Record<string, unknown>
}
const sourceId = (value: unknown) => {
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 2147483647)
    throw new Error('Source IDs must be positive native numeric identifiers.')
  return text
}
const name = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new Error('A source layer name is missing or too long.')
  return value
}
export const SOURCE_LAYER_CATALOGUES = {
  schema: 'rest/portal/getSchemas_TBD.php',
  submission: 'rest/portal/getSubmissionLayersAddLayer.php',
  shared: 'rest/portal/getLinkedLayers.php',
} as const
export function parseLayerCatalogue(input: unknown, kind: Exclude<SourceLayerKind, 'local'>): LocalLayerAsset[] {
  const rows = Array.isArray(input) ? input : checkedPortalAttributes(input)
  if (!Array.isArray(rows) || rows.length > 20000)
    throw new Error('Expected a source catalogue with at most 20,000 entries.')
  const ids = new Set<string>()
  return rows.map((item) => {
    const row = record(item)
    const id = sourceId(kind === 'schema' ? row.id : row.layer_id)
    if (ids.has(id)) throw new Error('The catalogue repeats a source layer ID.')
    ids.add(id)
    return {
      schema: 'nechako-local-layer-v1',
      kind,
      name: name(kind === 'schema' ? row.schema : row.layer_name),
      sourceId: id,
      ...(kind === 'schema'
        ? { schemaId: id, geometryType: typeof row.geometryType === 'string' ? row.geometryType : undefined }
        : {}),
      ...(row.schema_id === undefined || row.schema_id === null ? {} : { schemaId: sourceId(row.schema_id) }),
      ...(row.form_submission_id === undefined || row.form_submission_id === null
        ? {}
        : { submissionId: sourceId(row.form_submission_id) }),
      original: row,
      materialization: {
        status: 'descriptor',
        basis: 'catalogue',
        countVerified: false,
        notes: ['Catalogue entry only; no feature geometry has been copied.'],
      },
    }
  })
}
export function checkedLocalLayer(input: unknown): LocalLayerAsset {
  const layer = record(input)
  if (
    layer.schema !== 'nechako-local-layer-v1' ||
    !['schema', 'submission', 'shared', 'local'].includes(String(layer.kind))
  )
    throw new Error('Not a local Nechako layer asset.')
  const materialization = record(layer.materialization)
  if (
    !['descriptor', 'complete', 'partial'].includes(String(materialization.status)) ||
    !['catalogue', 'imported-file', 'source-export', 'wfs-count'].includes(String(materialization.basis)) ||
    typeof materialization.countVerified !== 'boolean' ||
    !Array.isArray(materialization.notes) ||
    materialization.notes.some((note) => typeof note !== 'string')
  )
    throw new Error('Invalid layer materialization record.')
  const data = layer.data === undefined ? undefined : normalizeGeojson(layer.data)
  if (materialization.status !== 'descriptor' && !data)
    throw new Error('A materialized layer must contain its actual features.')
  if (data && materialization.featureCount !== data.features.length)
    throw new Error('Layer feature count does not match its stored geometry.')
  if (
    materialization.countVerified &&
    (!data || materialization.expectedFeatures !== data.features.length || materialization.status !== 'complete')
  )
    throw new Error('A verified layer must match the advertised total.')
  return {
    ...(layer as unknown as LocalLayerAsset),
    name: name(layer.name),
    data,
    ...(layer.sourceId === undefined ? {} : { sourceId: sourceId(layer.sourceId) }),
    ...(layer.schemaId === undefined ? {} : { schemaId: sourceId(layer.schemaId) }),
    ...(layer.submissionId === undefined ? {} : { submissionId: sourceId(layer.submissionId) }),
  }
}
export function materializeLayer(
  asset: LocalLayerAsset,
  value: unknown,
  basis: 'imported-file' | 'source-export' = 'imported-file',
): LocalLayerAsset {
  const raw = record(value)
  const data = normalizeGeojson(typeof raw.geojson === 'string' ? parseImportJson(raw.geojson) : raw)
  return {
    ...asset,
    data,
    original: { catalogue: asset.original, file: value },
    materialization: {
      status: 'complete',
      basis,
      featureCount: data.features.length,
      countVerified: false,
      fetchedAt: new Date().toISOString(),
      notes: [
        'Every feature in the supplied file is stored locally. The source did not provide a separately verified dataset total.',
      ],
    },
  }
}
export function localLayerVector(input: LocalLayerAsset): VectorData {
  const asset = checkedLocalLayer(input)
  if (!asset.data) throw new Error('Import or download feature geometry before adding this cached layer to the map.')
  return {
    id: crypto.randomUUID(),
    name: asset.name,
    data: asset.data,
    color: '#0f766e',
    visible: true,
    original: asset,
  }
}

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Source HTTP ${response.status}.`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes)
    throw new Error('The source response exceeds the browser download limit.')
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('The source response exceeds the browser download limit.')
    return bytes
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('The source response exceeds the browser download limit.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
/** No credentials or app gateway: public portal CORS reads only. */
export async function readPublicLayerCatalogue(kind: Exclude<SourceLayerKind, 'local'>, signal?: AbortSignal) {
  const response = await fetch(new URL(SOURCE_LAYER_CATALOGUES[kind], NECHAKO_PORTAL), {
    credentials: 'omit',
    signal: signal ?? AbortSignal.timeout(60000),
  })
  const value = parseImportJson(new TextDecoder().decode(await readBoundedResponse(response, 16 * 1024 * 1024)))
  return parseLayerCatalogue(value, kind)
}
export async function readGeojsonFile(blob: Blob): Promise<unknown> {
  if (blob.size > 64 * 1024 * 1024) throw new Error('Import at most 64 MiB for one cached layer.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { entries } = inspectLocalZip(bytes, {
      maxEntries: 100,
      maxFileBytes: 64 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    })
    const candidates = entries.filter(
      (entry) => /\.(?:geojson|json)$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/'),
    )
    if (candidates.length !== 1)
      throw new Error(
        'This archive must contain one GeoJSON file. Use Import files to select layers from a multi-layer GIS archive.',
      )
    const files = await readBoundedLocalZip(bytes, {
      maxEntries: 100,
      maxFileBytes: 64 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    })
    return parseImportJson(new TextDecoder('utf-8', { fatal: true }).decode(files.get(candidates[0].name)!))
  }
  const text = new TextDecoder().decode(bytes)
  if (!text.trimStart().startsWith('{'))
    throw new Error(
      'The source did not return GeoJSON. Its export may require a source session or server configuration. Import an authorized exported file, or use a WFS source.',
    )
  const value = record(parseImportJson(text))
  if (value.status === 'failure' || value.success === false || value.error) checkedPortalAttributes(value)
  return value
}
/** The source owns this export. Failure never falls back to credentials or fabricated geometry. */
export async function downloadPublicSourceLayer(
  asset: LocalLayerAsset,
  signal?: AbortSignal,
): Promise<{ asset: LocalLayerAsset; blob: Blob }> {
  if (asset.kind === 'local' || !asset.sourceId) throw new Error('Choose an actual source catalogue entry.')
  const id = sourceId(asset.sourceId)
  let src: Record<string, unknown>
  if (asset.kind === 'shared') {
    const response = await fetch(new URL('rest/openmap/getLayerFromShared.php', NECHAKO_PORTAL), {
      method: 'POST',
      body: new URLSearchParams({ layerId: id }),
      credentials: 'omit',
      signal,
    })
    const descriptor = record(
      checkedPortalAttributes(
        parseImportJson(new TextDecoder().decode(await readBoundedResponse(response, 1024 * 1024))),
      ),
    )
    if (
      String(descriptor.layerId) !== id ||
      typeof descriptor.name !== 'string' ||
      !descriptor.name ||
      descriptor.name.length > 250
    )
      throw new Error('The source shared-layer descriptor does not match this catalogue entry.')
    src = { directDb: true, table: descriptor.name, layerId: id }
  } else src = asset.kind === 'schema' ? { isPortal: true, schema: Number(id) } : { isPortal: true, layer: Number(id) }
  const response = await fetch(new URL('rest/openmap/downloadFile.php', NECHAKO_PORTAL), {
    method: 'POST',
    credentials: 'omit',
    signal: signal ?? AbortSignal.timeout(60000),
    body: new URLSearchParams({ name: asset.name, type: 'GeoJSON', src: JSON.stringify(src) }),
  })
  const bytes = await readBoundedResponse(response, 64 * 1024 * 1024)
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
  return { asset: materializeLayer(asset, await readGeojsonFile(blob), 'source-export'), blob }
}

type WfsPage = { data: FeatureCollection; total: number }
function checkedWfsPage(value: unknown, limit: number): WfsPage {
  const raw = record(value)
  const valueTotal = raw.numberMatched ?? raw.totalFeatures
  const total = typeof valueTotal === 'string' && /^\d+$/.test(valueTotal) ? Number(valueTotal) : valueTotal
  if (!Number.isSafeInteger(total) || (total as number) < 0)
    throw new Error('This WFS response does not advertise a verifiable total feature count.')
  const data = normalizeGeojson(raw)
  if (data.features.length > limit || data.features.length > (total as number))
    throw new Error('The WFS returned more features than requested or advertised.')
  if (raw.numberReturned !== undefined && Number(raw.numberReturned) !== data.features.length)
    throw new Error('The WFS numberReturned does not match its features.')
  return { data, total: total as number }
}
export async function materializeWfs({
  url,
  typeName,
  maxFeatures = 100000,
  signal,
  onProgress,
  fetcher = fetch,
}: {
  url: string
  typeName: string
  maxFeatures?: number
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
  fetcher?: typeof fetch
}): Promise<LocalLayerAsset> {
  const endpoint = new URL(httpsUrl(url))
  if (
    [...endpoint.searchParams.keys()].some((key) =>
      /^(?:access[_-]?token|api[_-]?key|password|passwd|token|secret|authorization|capability|session(?:id)?)$/i.test(
        key,
      ),
    )
  )
    throw new Error(
      'Use a public WFS URL without credentials or session tokens. Import an authorized export for protected data.',
    )
  if (!typeName.trim() || typeName.length > 200 || [...typeName].some((char) => char.charCodeAt(0) < 32))
    throw new Error('Enter a WFS feature type name.')
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > 100000)
    throw new Error('Choose a feature limit from 1 to 100,000.')
  for (const key of [...endpoint.searchParams.keys()])
    if (
      [
        'service',
        'request',
        'version',
        'typenames',
        'typename',
        'count',
        'startindex',
        'maxfeatures',
        'outputformat',
        'srsname',
      ].includes(key.toLowerCase())
    )
      endpoint.searchParams.delete(key)
  const pageSize = 500
  let bytes = 0
  const getPage = async (offset: number) => {
    signal?.throwIfAborted()
    const target = new URL(endpoint)
    const request = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: typeName,
      outputFormat: 'application/json',
      srsName: 'urn:ogc:def:crs:OGC:1.3:CRS84',
      count: String(pageSize),
      startIndex: String(offset),
    }
    for (const [key, value] of Object.entries(request)) target.searchParams.set(key, value)
    const body = await readBoundedResponse(
      await fetcher(target, { credentials: 'omit', signal: signal ?? AbortSignal.timeout(60000) }),
      16 * 1024 * 1024,
    )
    bytes += body.length
    if (bytes > 128 * 1024 * 1024) throw new Error('The WFS download exceeded the 128 MiB browser limit.')
    const text = new TextDecoder().decode(body)
    if (!text.trimStart().startsWith('{'))
      throw new Error('The WFS did not return GeoJSON. Verify its feature type, JSON format and CORS support.')
    const page = checkedWfsPage(parseImportJson(text), pageSize)
    signal?.throwIfAborted()
    return page
  }
  const first = await getPage(0)
  const total = first.total
  const target = Math.min(total, maxFeatures)
  const features: FeatureCollection['features'] = []
  const pages = new Set<string>()
  const ids = new Set<string>()
  let allHaveIds = true
  let last = first
  let lastOffset = 0
  const accept = (page: WfsPage, offset: number) => {
    if (page.total !== total) throw new Error('The WFS total changed during download. Restart it.')
    if (page.data.features.length !== Math.min(pageSize, Math.max(0, total - offset)))
      throw new Error('The WFS returned a short or missing page before its advertised total.')
    const fingerprint = JSON.stringify(page.data)
    if (page.data.features.length && pages.has(fingerprint))
      throw new Error('The WFS repeated a page; it may not support startIndex.')
    pages.add(fingerprint)
    for (const feature of page.data.features.slice(0, target - features.length)) {
      if (feature.id === undefined) allHaveIds = false
      else {
        const id = JSON.stringify([typeof feature.id, feature.id])
        if (ids.has(id)) throw new Error('The WFS repeated a feature ID across pages.')
        ids.add(id)
      }
      features.push(feature)
    }
    last = page
    lastOffset = offset
    onProgress?.(features.length, total)
  }
  accept(first, 0)
  for (let offset = pageSize; features.length < target; offset += pageSize) accept(await getPage(offset), offset)
  const complete = features.length === total
  if (complete) {
    const firstAgain = await getPage(0)
    if (firstAgain.total !== total || JSON.stringify(firstAgain.data) !== JSON.stringify(first.data))
      throw new Error('The first WFS page changed during verification.')
    if (lastOffset) {
      const lastAgain = await getPage(lastOffset)
      if (lastAgain.total !== total || JSON.stringify(lastAgain.data) !== JSON.stringify(last.data))
        throw new Error('The last WFS page changed during verification.')
    }
    const end = await getPage(total)
    if (end.total !== total || end.data.features.length)
      throw new Error('WFS features continued beyond the advertised total.')
  }
  return {
    schema: 'nechako-local-layer-v1',
    kind: 'local',
    name: typeName,
    data: { type: 'FeatureCollection', features },
    original: {
      wfs: { url: endpoint.href, typeName, version: '2.0.0', featureIdsChecked: allHaveIds, atomicSnapshot: false },
    },
    materialization: {
      status: complete ? 'complete' : 'partial',
      basis: 'wfs-count',
      featureCount: features.length,
      expectedFeatures: total,
      countVerified: complete,
      fetchedAt: new Date().toISOString(),
      notes: [
        complete
          ? 'Advertised count, boundary pages and empty terminal page verified.'
          : `Stopped at the selected ${maxFeatures}-feature limit.`,
        allHaveIds
          ? 'Returned feature IDs were checked for duplication.'
          : 'Some features have no ID; unique identity is not fully verified.',
        'The source provides no atomic snapshot guarantee.',
      ],
    },
  }
}
