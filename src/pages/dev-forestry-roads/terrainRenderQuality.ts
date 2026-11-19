/**
 * Drawing-buffer budgets for the road's 3D view. These change the picture only: source terrain,
 * design surfaces and calculated quantities never depend on the chosen rendering quality.
 *
 * Pure: no DOM, renderer or device access. Pass the viewport and the device's pixel ratio in.
 */
export type TerrainRenderQuality = 'auto' | 'high' | 'efficient'

export const TERRAIN_RENDER_LIMITS = {
  auto: { pixelRatio: 2, maxPixels: 4_000_000 },
  high: { pixelRatio: 2, maxPixels: 8_000_000 },
  efficient: { pixelRatio: 1, maxPixels: 1_500_000 },
} as const

/** Auto sharpens again once the camera has held still for this long. */
export const TERRAIN_SHARPEN_DELAY_MS = 350
export const TERRAIN_MOVING_RENDER_LIMITS = { pixelRatio: 1.25, maxPixels: 1_500_000 } as const
/** Bounds long, thin canvases as well as their area; a renderer may supply a smaller hardware limit. */
export const MAX_TERRAIN_RENDER_SIDE = 8192

const positive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 1)
const dimension = (value: number) => Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, positive(value)))

/**
 * Physical pixels for a viewport measured in CSS pixels. Auto uses a smaller budget while moving;
 * High and Efficient hold the selected budget throughout. No mode draws above the device's pixel
 * ratio, and the total pixel/side caps may lower the ratio further on a large or dense display.
 *
 * Empty or invalid measurements get a minimal valid canvas until a real size is available. Rounding
 * is downward so the drawing buffer cannot exceed the budget. The caller keeps camera/lens geometry
 * in CSS pixels; changing only this buffer must not move the eye or change the framing.
 */
export function terrainRenderSize({
  width,
  height,
  devicePixelRatio,
  quality,
  moving = false,
  maxDimension = MAX_TERRAIN_RENDER_SIDE,
}: {
  width: number
  height: number
  devicePixelRatio: number
  quality: TerrainRenderQuality
  moving?: boolean
  maxDimension?: number
}): { width: number; height: number; pixelRatio: number } {
  const cssWidth = dimension(width),
    cssHeight = dimension(height)
  const limits = quality === 'auto' && moving ? TERRAIN_MOVING_RENDER_LIMITS : TERRAIN_RENDER_LIMITS[quality]
  const side = Math.floor(Math.min(MAX_TERRAIN_RENDER_SIDE, dimension(maxDimension)))
  const pixelRatio = Math.min(
    positive(devicePixelRatio),
    limits.pixelRatio,
    Math.sqrt(limits.maxPixels / cssWidth / cssHeight),
    side / cssWidth,
    side / cssHeight,
  )
  return {
    width: Math.max(1, Math.floor(cssWidth * pixelRatio)),
    height: Math.max(1, Math.floor(cssHeight * pixelRatio)),
    pixelRatio,
  }
}
