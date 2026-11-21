import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'
import type { PreviewCamera } from './previewCamera'
import type { TerrainBackgroundLayer } from './terrainPreparation'
import type { TerrainRenderQuality } from './terrainRenderQuality'
import type { TerrainSlopeTexture } from './terrainSlopeTexture'

/** Display inputs only. Neither the renderer nor a picked point is an engineering terrain source. */
export interface TerrainGpuData {
  ground: TerrainFace[]
  /**
   * Where the clipped ground ends on the design footprint's outline, seam or open: the top edges of a vertical,
   * ground-coloured skirt, so a gap left between the ground and the design shows ground, not the page.
   */
  skirt?: Array<{ a: TerrainVertex; b: TerrainVertex }>
  /** How far the skirt hangs below those edges, in metres before vertical exaggeration. */
  skirtDepth?: number
  /**
   * The drawn formation's batter edges that stopped short of the ground: a face from each edge to the ground under
   * it, and the edges themselves. Shown with the batters.
   */
  unfinished?: { faces: TerrainVertex[][]; edges: Array<{ a: TerrainVertex; b: TerrainVertex }> } | null
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
  /**
   * The slope texture laid over the ground and skirt while the ground is coloured by slope, or null for vertex colours
   * alone. Sets no geometry: it requests one frame, and a later `setData` keeps it while the ground is coloured by slope.
   */
  setGroundTexture(texture: TerrainSlopeTexture | null): void
  pick(x: number, y: number): { station: number; culvertId?: string } | null
  dispose(): void
}
