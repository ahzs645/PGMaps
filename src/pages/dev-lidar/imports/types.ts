import type { FeatureCollection } from 'geojson'
export const LIMITS = {
  file: 128 * 1024 ** 2,
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
