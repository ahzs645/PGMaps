import { LIMITS, checkAborted, type ImportedLayer, type ImportFile, type ImportSession, emptySession } from './types'
import { vectorData } from './vector'
import { rasterData } from './raster'
const decoder = new TextDecoder('utf-8', { fatal: true })
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
export function base64(bytes: ArrayBuffer) {
  let result = ''
  const data = new Uint8Array(bytes)
  for (let i = 0; i < data.length; i += 32768) result += String.fromCharCode(...data.subarray(i, i + 32768))
  return btoa(result)
}
export function decode64(value: unknown) {
  if (typeof value !== 'string' || value.length > LIMITS.file * 1.4) throw Error('Invalid or oversized project payload')
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw Error('Project contains invalid base64 bytes')
  }
  // A preallocated loop; Uint8Array.from(string, mapper) iterates code points and froze the tab for seconds.
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
export async function unpack(bytes: ArrayBuffer, name: string, signal?: AbortSignal) {
  checkAborted(signal)
  if (!name.toLowerCase().endsWith('.gz')) return bytes
  if (typeof DecompressionStream === 'undefined')
    throw Error('Gzip needs a browser with DecompressionStream support; unzip the GeoJSON first')
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      checkAborted(signal)
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > LIMITS.decoded) throw Error('Decompressed file exceeds 96 MiB; crop or split it before import')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}
export async function fileLayer(file: ImportFile, crs = 'auto', signal?: AbortSignal): Promise<ImportedLayer> {
  checkAborted(signal)
  if (file.size > LIMITS.file)
    throw Error('Processed layers are limited to 71 MiB per file so the project stays within the 96 MiB save limit')
  const original = await file.arrayBuffer(),
    name = file.name.replace(/\.gz$/i, '').toLowerCase()
  checkAborted(signal)
  const hash = await sha256(original)
  checkAborted(signal)
  const common = {
    id: crypto.randomUUID(),
    name: file.name,
    visible: true,
    opacity: 0.8,
    original,
    source: { name: file.name, bytes: original.byteLength, sha256: hash, crs: '' },
  }
  if (/\.(tif|tiff)$/.test(name)) {
    const raster = await rasterData(await unpack(original, file.name, signal), crs, signal)
    const { crs: rasterCrs, ...rest } = raster
    return { ...common, ...rest, source: { ...common.source, crs: rasterCrs } }
  }
  if (!/\.(geojson|json)$/.test(name))
    throw Error(
      'Use LAS/LAZ/COPC, single-band GeoTIFF, GeoJSON or a PGMaps project JSON. Restore .part files with the archive guide first.',
    )
  const bytes = await unpack(original, file.name, signal)
  if (bytes.byteLength > LIMITS.decoded) throw Error('JSON layer exceeds 96 MiB')
  let raw: unknown
  // JSON.parse cannot be interrupted; check either side of it.
  checkAborted(signal)
  try {
    raw = JSON.parse(decoder.decode(bytes))
  } catch {
    throw Error('Invalid UTF-8 JSON file')
  }
  checkAborted(signal)
  const { crs: vectorCrs, ...vector } = vectorData(raw, crs)
  return { ...common, ...vector, kind: 'vector', source: { ...common.source, crs: vectorCrs } }
}
export function checkSession(session: ImportSession) {
  if (
    session.layers.reduce((n, layer) => n + (layer.kind === 'raster' ? layer.width * layer.height : 0), 0) > 20_000_000
  )
    throw Error('Project exceeds 20 million raster cells; split it into separate projects')
  if (session.layers.length > LIMITS.layers) throw Error('A project supports up to 10 processed layers')
  if (projectSizeBound(session) > LIMITS.project)
    throw Error('This would exceed the 96 MiB saved-project limit; remove a layer or save fewer layers together')
  if (session.layers.reduce((n, layer) => n + (layer.kind === 'vector' ? layer.data.features.length : 0), 0) > 300000)
    throw Error('Project exceeds 300,000 vector features; split it into separate projects')
}
/** Upper bound on exportProject's UTF-8 size: base64 payloads plus worst-case JSON escaping of strings. */
export function projectSizeBound(session: ImportSession) {
  const text = (value: string) => 6 * value.length + 2
  const points = [...session.missingPoints, ...(session.point ? [session.point.name] : [])]
  return session.layers.reduce(
    (n, l) => n + 4 * Math.ceil(l.original.byteLength / 3) + 512 + text(l.source.name) + text(l.source.crs),
    1024 + points.reduce((n, p) => n + text(p) + 1, 0),
  )
}
export function exportProject(session: ImportSession) {
  const output = {
    schema: 'pgmaps-lidar-project',
    version: 1,
    layers: session.layers.map((l) => ({
      name: l.source.name,
      kind: l.kind,
      crs: l.source.crs,
      sha256: l.source.sha256,
      bytes: l.source.bytes,
      data: base64(l.original),
      visible: l.visible,
      opacity: l.opacity,
    })),
    missingPoints: [...session.missingPoints, ...(session.point ? [session.point.name] : [])],
    pointCloudPolicy:
      'Processed layer bytes are embedded. Point-cloud files and remote URLs must be reattached after restore. No model inference is run by this file.',
  }
  const text = JSON.stringify(output)
  if (new TextEncoder().encode(text).length > LIMITS.project)
    throw Error('Saved project exceeds 96 MiB; export fewer layers together')
  return text
}
interface ProjectJson {
  schema?: unknown
  version?: unknown
  missingPoints?: unknown
  layers?: Array<{
    name?: unknown
    kind?: unknown
    crs?: unknown
    visible?: unknown
    opacity?: unknown
    bytes?: unknown
    sha256?: unknown
    data?: unknown
  } | null>
}
export async function restoreProject(file: ImportFile, signal?: AbortSignal): Promise<ImportSession> {
  checkAborted(signal)
  if (file.size > LIMITS.project) throw Error('Project JSON exceeds 96 MiB')
  const text = decoder.decode(await file.arrayBuffer())
  checkAborted(signal)
  let value: ProjectJson
  try {
    value = JSON.parse(text)
  } catch {
    throw Error('Invalid project JSON')
  }
  checkAborted(signal)
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema !== 'pgmaps-lidar-project' ||
    value.version !== 1 ||
    !Array.isArray(value.layers) ||
    value.layers.length > LIMITS.layers
  )
    throw Error('Unsupported PGMaps project schema or version')
  if (
    !Array.isArray(value.missingPoints) ||
    value.missingPoints.length > 100 ||
    !value.missingPoints.every((s: unknown) => typeof s === 'string' && s.length < 512)
  )
    throw Error('Invalid project point-cloud references')
  const missingPoints = value.missingPoints as string[]
  const result = emptySession()
  for (const layer of value.layers) {
    if (
      !layer ||
      typeof layer.name !== 'string' ||
      !layer.name.length ||
      layer.name.length > 512 ||
      (layer.kind !== 'vector' && layer.kind !== 'raster') ||
      typeof layer.crs !== 'string' ||
      typeof layer.visible !== 'boolean' ||
      typeof layer.opacity !== 'number' ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1
    )
      throw Error('Invalid project layer settings')
    checkAborted(signal)
    const bytes = decode64(layer.data)
    checkAborted(signal)
    if (bytes.byteLength !== layer.bytes || (await sha256(bytes)) !== layer.sha256)
      throw Error('Project layer checksum mismatch: ' + layer.name)
    const restored = await fileLayer(
      {
        name: layer.name,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes,
        slice: (start, end) => new Blob([bytes]).slice(start, end),
      },
      layer.crs,
      signal,
    )
    if (restored.kind !== layer.kind) throw Error('Project layer type mismatch')
    restored.visible = layer.visible
    restored.opacity = layer.opacity
    result.layers.push(restored)
    checkSession(result)
  }
  result.missingPoints = missingPoints
  return result
}
