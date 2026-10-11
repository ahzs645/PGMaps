import { downloadBlob } from '@/lib/download'
import { normalizeGeojson } from './workspace'
import type { FeatureCollection } from 'geojson'

export async function conversionRequest(path: 'convert' | 'export', payload: unknown) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 180000)
  try {
    const response = await fetch(`/api/nechako/${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!(response.headers.get('content-type') || '').includes('application/json'))
      throw new Error(
        'GIS conversion service is unavailable. Start the local GDAL service or configure the same-origin production endpoint.',
      )
    const result = await response.json()
    if (!response.ok || result.error) throw new Error(result.error || `Conversion HTTP ${response.status}`)
    return result
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GIS conversion timed out.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
async function encodedFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  return { name: file.name, base64: btoa(chunks.join('')) }
}
export async function convertFiles(files: File[], sourceCrs?: string) {
  if (files.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024)
    throw new Error('Import at most 20 MB of source files.')
  if (files.length === 1 && /\.(geojson|json)$/i.test(files[0].name)) {
    const original = JSON.parse(await files[0].text())
    return { layers: [{ name: files[0].name, data: normalizeGeojson(original, sourceCrs) }], warnings: [], original }
  }
  const result = await conversionRequest('convert', { files: await Promise.all(files.map(encodedFile)), sourceCrs })
  if (!Array.isArray(result.layers)) throw new Error('Conversion response has no layer list.')
  return {
    ...result,
    layers: result.layers.map((layer: { name: string; data: unknown }) => ({
      ...layer,
      data: normalizeGeojson(layer.data),
    })),
  }
}
export async function exportGis(data: FeatureCollection, format: string) {
  const result = await conversionRequest('export', { data, format })
  if (typeof result.name !== 'string' || typeof result.base64 !== 'string') throw new Error('Invalid export response.')
  const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), result.name)
}
