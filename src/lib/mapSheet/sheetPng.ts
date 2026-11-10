/**
 * A sheet as a PNG: its SVG drawn onto a canvas in the browser. Rasters must already be encoded
 * (`encodeSheetImages`), so the SVG holds data URLs and the canvas stays readable. Browser only.
 */

/** Largest side of a PNG sheet, pixels; the scale is lowered to fit. */
export const MAX_SHEET_PNG_SIDE = 8192

export async function sheetPngBlob(svg: string, width: number, height: number, pixelsPerPoint = 2): Promise<Blob> {
  const scale = Math.min(pixelsPerPoint, MAX_SHEET_PNG_SIDE / Math.max(width, height))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(Error('The sheet could not be drawn as an image.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw Error('This browser cannot draw the sheet as an image.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error('The PNG could not be encoded.'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
