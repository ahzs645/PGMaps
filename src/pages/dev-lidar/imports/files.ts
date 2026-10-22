import { LIMITS, type ImportedLayer, type ImportFile, type ImportSession, emptySession } from './types'
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
function decode64(value: unknown) {
  if (typeof value !== 'string' || value.length > LIMITS.file * 1.4) throw Error('Invalid or oversized project payload')
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer
  } catch {
    throw Error('Project contains invalid base64 bytes')
  }
}
export async function unpack(bytes: ArrayBuffer, name: string) {
  if (!name.toLowerCase().endsWith('.gz')) return bytes
  if (typeof DecompressionStream === 'undefined')
    throw Error('Gzip needs a browser with DecompressionStream support; unzip the GeoJSON first')
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
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
export async function fileLayer(file: ImportFile, crs = 'auto'): Promise<ImportedLayer> {
  if (file.size > LIMITS.file) throw Error('Processed layers are limited to 128 MiB per file')
  const original = await file.arrayBuffer(),
    name = file.name.replace(/\.gz$/i, '').toLowerCase()
  const common = {
    id: crypto.randomUUID(),
    name: file.name,
    visible: true,
    opacity: 0.8,
    original,
    source: { name: file.name, bytes: original.byteLength, sha256: await sha256(original), crs: '' },
  }
  if (/\.(tif|tiff)$/.test(name)) {
    const raster = await rasterData(await unpack(original, file.name), crs)
    return { ...common, ...raster, source: { ...common.source, crs: raster.crs } }
  }
  if (!/\.(geojson|json)$/.test(name))
    throw Error(
      'Use LAS/LAZ/COPC, single-band GeoTIFF, GeoJSON or a PGMaps project JSON. Restore .part files with the archive guide first.',
    )
  const bytes = await unpack(original, file.name)
  if (bytes.byteLength > LIMITS.decoded) throw Error('JSON layer exceeds 96 MiB')
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(bytes))
  } catch {
    throw Error('Invalid UTF-8 JSON file')
  }
  const vector = vectorData(raw, crs)
  return { ...common, ...vector, kind: 'vector', source: { ...common.source, crs: vector.crs } }
}
export function checkSession(session: ImportSession) {
  if (
    session.layers.reduce((n, layer) => n + (layer.kind === 'raster' ? layer.width * layer.height : 0), 0) > 20_000_000
  )
    throw Error('Project exceeds 20 million raster cells; split it into separate projects')
  if (session.layers.length > LIMITS.layers) throw Error('A project supports up to 10 processed layers')
  if (session.layers.reduce((n, layer) => n + layer.original.byteLength, 0) > LIMITS.file)
    throw Error('Project exceeds the 128 MiB processed-file budget')
  if (session.layers.reduce((n, layer) => n + (layer.kind === 'vector' ? layer.data.features.length : 0), 0) > 300000)
    throw Error('Project exceeds 300,000 vector features; split it into separate projects')
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
export async function restoreProject(file: ImportFile): Promise<ImportSession> {
  if (file.size > LIMITS.project) throw Error('Project JSON exceeds 96 MiB')
  let value: any
  try {
    value = JSON.parse(decoder.decode(await file.arrayBuffer()))
  } catch {
    throw Error('Invalid project JSON')
  }
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
  const result = emptySession()
  for (const layer of value.layers) {
    if (
      !layer ||
      typeof layer.name !== 'string' ||
      !layer.name.length ||
      layer.name.length > 512 ||
      !['vector', 'raster'].includes(layer.kind) ||
      typeof layer.crs !== 'string' ||
      typeof layer.visible !== 'boolean' ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1
    )
      throw Error('Invalid project layer settings')
    const bytes = decode64(layer.data)
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
    )
    if (restored.kind !== layer.kind) throw Error('Project layer type mismatch')
    restored.visible = layer.visible
    restored.opacity = layer.opacity
    result.layers.push(restored)
    checkSession(result)
  }
  result.missingPoints = value.missingPoints
  return result
}
