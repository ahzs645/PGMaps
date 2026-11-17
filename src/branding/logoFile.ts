import { MAX_UPLOADED_LOGO_BYTES, type UploadedLogo } from './model'
import { svgIntrinsicSize, svgRasterSize } from './svgLogo'

/** What a logo chooser offers: the file types `readLogoFile` reads. */
export const LOGO_FILE_ACCEPT = 'image/png,image/jpeg,image/svg+xml,.svg'
/** The same, as a person reads it beside the chooser. */
export const LOGO_FILE_TYPES_TEXT = 'PNG, JPEG or SVG, up to 2 MB'

const readAs = (file: Blob, as: 'dataUrl' | 'text') =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(Error('The logo could not be read.'))
    if (as === 'text') reader.readAsText(file)
    else reader.readAsDataURL(file)
  })

const isSvg = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

/**
 * Reads a chosen PNG, JPEG or SVG into the stored-logo shape. An SVG is drawn once into a PNG with its longer side at
 * `SVG_LOGO_RASTER_PX`, so every sheet, report and PDF prints it as any other logo; it is drawn as an image, which
 * runs none of its scripts. Browser only.
 */
export async function readLogoFile(file: File): Promise<UploadedLogo> {
  if (file.size > MAX_UPLOADED_LOGO_BYTES) throw Error('Choose a logo under 2 MB.')
  if (isSvg(file)) return readSvgLogo(file)
  const format = file.type === 'image/png' ? 'PNG' : file.type === 'image/jpeg' ? 'JPEG' : null
  if (!format) throw Error(`Choose a logo image: ${LOGO_FILE_TYPES_TEXT}.`)
  const dataUrl = await readAs(file, 'dataUrl')
  const image = new Image()
  image.src = dataUrl
  try {
    await image.decode()
  } catch {
    throw Error('That file is not a PNG or JPEG image.')
  }
  return { name: file.name.slice(0, 200), format, dataUrl, width: image.naturalWidth, height: image.naturalHeight }
}

async function readSvgLogo(file: File): Promise<UploadedLogo> {
  const text = await readAs(file, 'text')
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  try {
    await image.decode()
  } catch {
    throw Error('That file is not an SVG image this browser can draw.')
  }
  // The drawing's own shape; an SVG that states neither size nor viewBox takes the browser's reading of it.
  const own =
    svgIntrinsicSize(text) ??
    (image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null)
  if (!own) throw Error('This SVG states no size: give its root a viewBox, or a width and height.')
  const size = svgRasterSize(own)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw Error('The logo could not be drawn.')
  context.drawImage(image, 0, 0, size.width, size.height)
  const dataUrl = canvas.toDataURL('image/png')
  if (dataUrl.length > MAX_UPLOADED_LOGO_BYTES * 1.4)
    throw Error('This SVG makes a picture over 2 MB. Simplify it, or add a PNG instead.')
  return { name: file.name.slice(0, 200), format: 'PNG', dataUrl, ...size }
}
