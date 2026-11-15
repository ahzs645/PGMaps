import { memo, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { TerrainVertex } from './terrainMesh'
import type { OcclusionCover } from './terrainOcclusion'

export interface TerrainFace {
  vertices: TerrainVertex[]
  fill: string
  station?: number
  estimated?: boolean
  terrainGap?: boolean
}

interface Props {
  faces: TerrainFace[]
  overlays: TerrainFace[]
  project: (vertex: TerrainVertex) => { x: number; y: number; depth: number }
  /** Every camera value, including dimensions; lets station-only changes skip ground painting. */
  projectionKey: string
  width: number
  height: number
  wireframe: boolean
  /** Receives a copy of the ground alone, before the overlays, for `TerrainCover`. */
  groundLayer?: MutableRefObject<HTMLCanvasElement | null>
}

/** One canvas replaces thousands of DOM polygons; SVG overlays retain picking and keyboard access. */
export const TerrainGround = memo(
  function TerrainGround({ faces, overlays, project, width, height, wireframe, groundLayer }: Props) {
    const ref = useRef<HTMLCanvasElement>(null)
    useLayoutEffect(() => {
      const canvas = ref.current
      if (!canvas) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      const context = canvas.getContext('2d')!
      context.scale(ratio, ratio)
      for (const [batch, overlay] of [
        [faces, false],
        [overlays, true],
      ] as const) {
        const sorted = batch
          .map((face) => {
            const points = face.vertices.map(project)
            return {
              fill: face.fill,
              points,
              depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
            }
          })
          .sort((a, b) => b.depth - a.depth)
        for (const face of sorted) {
          context.beginPath()
          face.points.forEach((point, i) => (i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)))
          context.closePath()
          context.fillStyle = face.fill
          context.fill()
          context.strokeStyle = overlay ? '#94744a' : wireframe ? 'rgba(255,255,255,0.35)' : face.fill
          context.lineWidth = overlay ? 0.3 : wireframe ? 0.35 : 0.6
          context.stroke()
        }
        if (!overlay && groundLayer) {
          const layer = (groundLayer.current ??= document.createElement('canvas'))
          layer.width = canvas.width
          layer.height = canvas.height
          layer.getContext('2d')!.drawImage(canvas, 0, 0)
        }
      }
    }, [faces, overlays, project, width, height, wireframe, groundLayer])
    return (
      <foreignObject width={width} height={height} pointerEvents="none">
        <canvas
          ref={ref}
          style={{ width, height }}
          data-testid="road-ground-canvas"
          data-face-count={faces.length + overlays.length}
          data-estimated-face-count={faces.filter((face) => face.estimated).length}
          aria-hidden="true"
        />
      </foreignObject>
    )
  },
  (a, b) =>
    a.faces === b.faces &&
    a.overlays === b.overlays &&
    a.projectionKey === b.projectionKey &&
    a.wireframe === b.wireframe,
)

interface CoverProps {
  /** The ground alone, as `TerrainGround` last painted it. */
  groundLayer: MutableRefObject<HTMLCanvasElement | null>
  cover: OcclusionCover | null
  width: number
  height: number
  /** Repaint inputs of the ground layer; the cover repaints whenever the ground does. */
  faces: TerrainFace[]
  wireframe: boolean
  projectionKey: string
}

/**
 * The ground drawn back over the parts of the road's overlays it hides (`occlusionTest`'s `cover`).
 * It sits above the road in the SVG and takes no pointer events. It must come after `TerrainGround`
 * in the tree, whose layout effect paints the layer first.
 */
export const TerrainCover = memo(
  function TerrainCover({ groundLayer, cover, width, height, faces, wireframe, projectionKey }: CoverProps) {
    const ref = useRef<HTMLCanvasElement>(null)
    useLayoutEffect(() => {
      const canvas = ref.current
      const layer = groundLayer.current
      if (!canvas) return
      canvas.width = layer?.width ?? 1
      canvas.height = layer?.height ?? 1
      if (!cover || !layer) return
      const mask = document.createElement('canvas')
      mask.width = cover.columns
      mask.height = cover.rows
      const pixels = new ImageData(cover.columns, cover.rows)
      for (let i = 0; i < cover.alpha.length; i++) pixels.data[i * 4 + 3] = cover.alpha[i]
      mask.getContext('2d')!.putImageData(pixels, 0, 0)
      const context = canvas.getContext('2d')!
      context.drawImage(layer, 0, 0)
      context.globalCompositeOperation = 'destination-in'
      context.imageSmoothingEnabled = true
      const scale = canvas.width / width
      context.drawImage(mask, 0, 0, cover.columns * cover.cell * scale, cover.rows * cover.cell * scale)
    }, [groundLayer, cover, width, height, faces, wireframe, projectionKey])
    return (
      <foreignObject width={width} height={height} pointerEvents="none">
        <canvas
          ref={ref}
          style={{ width, height }}
          data-testid="road-ground-cover"
          data-covered-cells={cover ? cover.alpha.reduce((sum, value) => sum + (value ? 1 : 0), 0) : 0}
          aria-hidden="true"
        />
      </foreignObject>
    )
  },
  (a, b) =>
    a.cover === b.cover &&
    a.faces === b.faces &&
    a.wireframe === b.wireframe &&
    a.projectionKey === b.projectionKey &&
    a.width === b.width &&
    a.height === b.height,
)
