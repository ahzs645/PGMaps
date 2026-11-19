import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'
import type { PreviewCamera } from './previewCamera'
import type { TerrainBackgroundLayer } from './terrainPreparation'
import type { TerrainRenderQuality } from './terrainRenderQuality'

/** Display inputs only. Neither the renderer nor a picked point is an engineering terrain source. */
export interface TerrainGpuData {
  ground: TerrainFace[]
  road: TerrainFace[]
  earthwork: TerrainFace[]
  design?: { positions: Float32Array; indices: Uint32Array; kind: 'finished' | 'subgrade' } | null
  lines: Array<{ a: TerrainVertex; b: TerrainVertex; color: string; station?: number }>
  culverts: Array<{ id: string; station: number; faces: TerrainFace[] }>
  stations: Array<TerrainVertex & { station: number }>
  colour: 'slope' | 'elevation' | 'plain' | 'ortho'
  low: number
  high: number
  /** Subtracted before Float32 upload; z elsewhere remains the project's absolute elevation. */
  originZ: number
  ortho?: TerrainBackgroundLayer
  /** Map local horizontal metres into the orthophoto's own source-pixel coordinates. */
  imagePoint?: (x: number, y: number) => [number, number]
}

export interface TerrainGpuView {
  camera: PreviewCamera
  angle: number
  tilt: number
  exaggeration: number
  width: number
  height: number
  quality: TerrainRenderQuality
  wireframe: boolean
  showEarthwork: boolean
  xray: boolean
  selectedCulvertId?: string
  /** Clip on the selected cross-section, in unexaggerated world metres. */
  cutaway?: { point: TerrainVertex; normal: [number, number] } | null
  bounds: number[]
}

export interface TerrainGpuHandle {
  setData(data: TerrainGpuData): void
  setView(view: TerrainGpuView): void
  pick(x: number, y: number): { station: number; culvertId?: string } | null
  dispose(): void
}
