import { MAX_UPLOADED_LOGO_BYTES, type UploadedLogo } from './model'

/** Reads a chosen PNG or JPEG into the stored-logo shape. Browser only. */
export async function readLogoFile(file: File): Promise<UploadedLogo> {
  if (file.size > MAX_UPLOADED_LOGO_BYTES) throw Error('Choose a logo under 2 MB.')
  const format = file.type === 'image/png' ? 'PNG' : file.type === 'image/jpeg' ? 'JPEG' : null
  if (!format) throw Error('Choose a PNG or JPEG image.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(Error('The logo could not be read.'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = dataUrl
  try {
    await image.decode()
  } catch {
    throw Error('That file is not a PNG or JPEG image.')
  }
  return { name: file.name.slice(0, 200), format, dataUrl, width: image.naturalWidth, height: image.naturalHeight }
}
