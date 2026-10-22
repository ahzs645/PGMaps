import { memo, useLayoutEffect, useRef } from 'react'
import type { TerrainVertex } from './terrainMesh'

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
}

/** One canvas replaces thousands of DOM polygons; SVG overlays retain picking and keyboard access. */
export const TerrainGround = memo(
  function TerrainGround({ faces, overlays, project, width, height, wireframe }: Props) {
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
      }
    }, [faces, overlays, project, width, height, wireframe])
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
