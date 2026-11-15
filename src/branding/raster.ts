import type { RasterImage } from '../lib/mapSheet/drawOps'
import { logoDataUrl, type BrandRecord } from './model'
import { printedLogo, type BrandingState } from './store'

/** The sheet engine already has a user-logo slot, expressed as an embedded raster. */
export async function brandLogoRaster(brand: BrandRecord): Promise<RasterImage> {
  const logo = brand.profile.logos.primary
  const image = new Image()
  image.src = logoDataUrl(logo)
  await image.decode()
  const space = brand.profile.identity?.logo?.clearSpaceRatio ?? 0
  const totalWidth = logo.viewBox[2] * (1 + 2 * space),
    totalHeight = logo.viewBox[3] + 2 * space * logo.viewBox[2]
  const scale = Math.min(1200 / totalWidth, 600 / totalHeight)
  const width = Math.max(1, Math.round(totalWidth * scale)),
    height = Math.max(1, Math.round(totalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('The brand logo could not be prepared.')
  const padding = space * logo.viewBox[2] * scale
  context.drawImage(image, padding, padding, logo.viewBox[2] * scale, logo.viewBox[3] * scale)
  return { kind: 'url', url: canvas.toDataURL('image/png'), format: 'PNG', width, height }
}

/** The logo a printed sheet or report takes (`printedLogo`): the user's own as is, else the brand's rasterised. */
export async function printedLogoRaster(state: BrandingState): Promise<RasterImage | null> {
  const chosen = printedLogo(state)
  if (!chosen) return null
  if (chosen.source === 'uploaded') {
    const { dataUrl, format, width, height } = chosen.logo
    return { kind: 'url', url: dataUrl, format, width, height }
  }
  return brandLogoRaster(chosen.brand)
}
