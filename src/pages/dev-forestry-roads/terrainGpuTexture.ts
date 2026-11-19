import { resampleBackground, type TerrainBackgroundLayer } from './terrainPreparation'

/**
 * Prepare only the GPU display copy. A pixel-area import budget does not bound a long strip's
 * sides; WebGL needs both sides within MAX_TEXTURE_SIZE. Normalized UVs still use the imported
 * image's full footprint, and the project's pixels, origin and source metadata remain untouched.
 */
export function prepareTerrainGpuTexture(
  layer: TerrainBackgroundLayer,
  maxTextureSize: number,
): TerrainBackgroundLayer {
  if (!Number.isFinite(maxTextureSize)) throw Error('The graphics device reported an invalid image texture limit.')
  const side = Math.max(2, Math.floor(maxTextureSize))
  const longest = Math.max(layer.width, layer.height)
  if (longest <= side) return layer

  const scale = side / longest
  // A very thin strip may need a fractional pixel budget to constrain its long side. The shared
  // resampler retains at least two pixels on each side, so do not round this budget up to one.
  const display = resampleBackground(layer, layer.width * layer.height * scale * scale)
  if (display.width > side || display.height > side)
    throw Error('The orthophoto could not be resized to this graphics device’s image texture limit.')
  // A previous import resample may already record the file's original dimensions.
  if (layer.sourceSize) display.sourceSize = layer.sourceSize
  return display
}
