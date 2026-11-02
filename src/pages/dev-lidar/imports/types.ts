import type { FeatureCollection } from 'geojson'
// A session is only accepted while its saved project (base64 of every original file) fits LIMITS.project,
// so anything that loads can also be saved and restored. 71 MiB of bytes is ~94.7 MiB of base64.
export const LIMITS = {
  file: 71 * 1024 ** 2,
  decoded: 96 * 1024 ** 2,
  cells: 16_000_000,
  features: 200_000,
  vertices: 2_000_000,
  layers: 10,
  project: 96 * 1024 ** 2,
  plainPoints: 2_000_000,
  plainBytes: 64 * 1024 ** 2,
}
export type Bounds = [number, number, number, number]
export interface ImportSource {
  name: string
  bytes: number
  sha256: string
  crs: string
}
export interface LayerBase {
  id: string
  name: string
  visible: boolean
  opacity: number
  bounds: Bounds
  source: ImportSource
  original: ArrayBuffer
  /** Import-time notice (e.g. an embedded CRS overriding the picker); not saved. */
  note?: string
}
export interface VectorLayer extends LayerBase {
  kind: 'vector'
  data: FeatureCollection
}
export interface RasterLayer extends LayerBase {
  kind: 'raster'
  width: number
  height: number
  nativeBounds: Bounds
  resolution: [number, number]
  values: Float64Array
  noData: number | null
  minimum: number
  maximum: number
  valid: number
}
export type ImportedLayer = VectorLayer | RasterLayer
export interface PointSource {
  id: string
  name: string
  kind: 'file' | 'copc' | 'ept'
  file?: File
  url?: string
  pointCount?: number
}
export interface ImportSession {
  layers: ImportedLayer[]
  point: PointSource | null
  missingPoints: string[]
}
export const emptySession = (): ImportSession => ({ layers: [], point: null, missingPoints: [] })
export interface ImportFile {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  slice(start?: number, end?: number): Blob
}
/** User-facing text of a thrown value, without the "Error: " prefix String(error) adds. */
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Stops an import between steps once the user cancels; an aborted signal throws its reason. */
export function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Import cancelled', 'AbortError')
}
