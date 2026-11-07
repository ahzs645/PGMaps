import type { MapQuadCoordinates } from '@/components/ui/map-layers'
import type { LoadedSource } from './sources'
import { mercatorToLngLat, type FittedTransformation } from './transforms'
import type { Point } from './model'

export type WarpedPreview = {
  canvas: HTMLCanvasElement
  coordinates: MapQuadCoordinates
  projectedBounds: [number, number, number, number]
  worldFile: string
  meshSegments: number
}
type Vertex = { source: Point; world: Point }
const WKT_3857 =
  'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","3857"]]'
export { WKT_3857 }

function drawTriangle(context: CanvasRenderingContext2D, image: HTMLCanvasElement, source: Point[], target: Point[]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = source
  const [[u0, v0], [u1, v1], [u2, v2]] = target
  const denominator = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (Math.abs(denominator) < 1e-12) return
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / denominator
  const c = ((x1 - x0) * (u2 - u0) - (x2 - x0) * (u1 - u0)) / denominator
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / denominator
  const d = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / denominator
  context.save()
  const centre: Point = [(u0 + u1 + u2) / 3, (v0 + v1 + v2) / 3]
  context.beginPath()
  target.forEach(([x, y], index) => {
    const length = Math.hypot(x - centre[0], y - centre[1]) || 1
    const xx = x + ((x - centre[0]) / length) * 0.35,
      yy = y + ((y - centre[1]) / length) * 0.35
    if (index) context.lineTo(xx, yy)
    else context.moveTo(xx, yy)
  })
  context.closePath()
  context.clip()
  context.setTransform(a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0)
  context.drawImage(image, 0, 0)
  context.restore()
}

/** Warp the image interior, not only four corners. The downloadable native COG uses GDAL. */
export async function renderWarpedPreview(
  source: LoadedSource,
  fit: FittedTransformation,
  signal?: AbortSignal,
): Promise<WarpedPreview> {
  if (fit.diagnostics.folded)
    throw Error('The fitted map folds over itself. Move or disable conflicting control points before previewing.')
  const segments = 40,
    vertices: Vertex[][] = []
  const { width, height } = source.descriptor
  for (let row = 0; row <= segments; row++) {
    const line: Vertex[] = []
    for (let col = 0; col <= segments; col++)
      line.push({
        source: [(col / segments) * source.canvas.width, (row / segments) * source.canvas.height],
        world: fit.forwardProjected([(col / segments) * width - 0.5, (row / segments) * height - 0.5]),
      })
    vertices.push(line)
  }
  const points = vertices.flat().map((v) => v.world)
  const bounds: [number, number, number, number] = [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ]
  const [west, south, east, north] = bounds
  const dx = east - west,
    dy = north - south
  if (!Number.isFinite(dx + dy) || dx <= 0 || dy <= 0 || dx / dy > 200 || dy / dx > 200)
    throw Error('The fitted map has an invalid or extremely distorted footprint. Check the control points.')
  const scale = Math.min(2048 / dx, 2048 / dy)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(dx * scale))
  canvas.height = Math.max(1, Math.ceil(dy * scale))
  const context = canvas.getContext('2d')!
  const toPixel = (v: Vertex): Point => [
    ((v.world[0] - west) / dx) * canvas.width,
    ((north - v.world[1]) / dy) * canvas.height,
  ]
  for (let row = 0; row < segments; row++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    for (let col = 0; col < segments; col++) {
      const a = vertices[row][col],
        b = vertices[row][col + 1],
        c = vertices[row + 1][col + 1],
        d = vertices[row + 1][col]
      drawTriangle(context, source.canvas, [a.source, b.source, c.source], [toPixel(a), toPixel(b), toPixel(c)])
      drawTriangle(context, source.canvas, [a.source, c.source, d.source], [toPixel(a), toPixel(c), toPixel(d)])
    }
    if (row % 6 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  const resolutionX = dx / canvas.width,
    resolutionY = -dy / canvas.height
  return {
    canvas,
    projectedBounds: bounds,
    coordinates: [
      mercatorToLngLat([west, north]),
      mercatorToLngLat([east, north]),
      mercatorToLngLat([east, south]),
      mercatorToLngLat([west, south]),
    ],
    worldFile:
      [resolutionX, 0, 0, resolutionY, west + resolutionX / 2, north + resolutionY / 2]
        .map((v) => v.toPrecision(17))
        .join('\n') + '\n',
    meshSegments: segments,
  }
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error('Could not export this image.'))), 'image/png'),
  )
}
