/** PNG maps for the drainage bench: a hillshade with coloured cell overlays. */
import { writeFile } from 'node:fs/promises'
import { encode } from 'fast-png'
import type { SurfaceGrid } from '../../../src/pages/dev-forestry-roads/surfaceGrid'

export type Rgb = [number, number, number]
export interface Layer {
  /** Cells to colour. */
  mask: (i: number) => boolean
  color: Rgb
  alpha?: number
}

/** Grey hillshade from the north-west, 45° sun; missing cells white. */
export function hillshade(grid: SurfaceGrid): Uint8Array {
  const { width: w, height: h, values: z, cellM } = grid
  const out = new Uint8Array(w * h)
  const az = (315 * Math.PI) / 180,
    alt = (45 * Math.PI) / 180
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c
      const at = (rr: number, cc: number) => {
        const v = z[Math.min(h - 1, Math.max(0, rr)) * w + Math.min(w - 1, Math.max(0, cc))]
        return Number.isFinite(v) ? v : z[i]
      }
      if (!Number.isFinite(z[i])) {
        out[i] = 255
        continue
      }
      const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * cellM),
        dzdy = (at(r - 1, c) - at(r + 1, c)) / (2 * cellM)
      const slope = Math.atan(Math.hypot(dzdx, dzdy) * 2),
        aspect = Math.atan2(dzdy, -dzdx)
      const shade =
        Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect)
      out[i] = Math.round(70 + 170 * Math.max(0, shade))
    }
  return out
}

/** Draw the window `[row0, col0, rows, cols]` of the grid, each cell `scale` pixels, layers in order. */
export async function writeMap(
  file: string,
  grid: SurfaceGrid,
  shade: Uint8Array,
  layers: Layer[],
  window: [number, number, number, number] = [0, 0, grid.height, grid.width],
  scale = 1,
) {
  const [row0, col0, rows, cols] = window
  const W = cols * scale,
    H = rows * scale
  const data = new Uint8Array(W * H * 3)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const gr = row0 + r,
        gc = col0 + c
      if (gr < 0 || gc < 0 || gr >= grid.height || gc >= grid.width) continue
      const i = gr * grid.width + gc
      let rgb: Rgb = [shade[i], shade[i], shade[i]]
      for (const layer of layers)
        if (layer.mask(i)) {
          const a = layer.alpha ?? 1
          rgb = [0, 1, 2].map((k) => rgb[k] * (1 - a) + layer.color[k] * a) as Rgb
        }
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((r * scale + y) * W + c * scale + x) * 3
          data[o] = rgb[0]
          data[o + 1] = rgb[1]
          data[o + 2] = rgb[2]
        }
    }
  await writeFile(file, encode({ width: W, height: H, data, channels: 3, depth: 8 }))
}
