/**
 * Opening a photo a browser may not be able to show. A HEIC file (an iPhone's default) is shown as
 * it is where the browser can (Safari), and otherwise decoded here, in a worker, to a JPEG held in
 * memory: nothing is uploaded, and the file the person picked is left as it was. Any other file is
 * passed through untouched.
 *
 * Browser-only. The decoder is `heicDecode.ts`; the HEIC test is `heicFile.ts`.
 */
import { HEIC_MAX_PIXELS, HeicDecodeError } from './heicDecode'
import { HEIC_SNIFF_BYTES, looksLikeHeic } from './heicFile'
import type { HeicDecodeRequest, HeicDecodeResponse } from './heicDecode.worker'

/** Near-lossless for a photograph, and about a quarter of the PNG's size. */
const JPEG_QUALITY = 0.92

export interface ShowablePhoto {
  /** The picked file itself, or its JPEG when it had to be decoded here. */
  blob: Blob
  /**
   * `heic` when `blob` is a JPEG decoded from a HEIC file; null when it is the file as picked.
   * The file's EXIF is read from the original either way: the JPEG carries none.
   */
  decodedFrom: 'heic' | null
  /** False when a decoded photo's colours could not be brought to sRGB; its geometry is unaffected. */
  srgb: boolean
}

export interface ShowablePhotoOptions {
  signal?: AbortSignal
  /** Told once when the file has to be decoded here, which takes a second or two. */
  onDecoding?: () => void
  maxPixels?: number
}

/** Whether these bytes are a HEIC photo, from the start of the file. */
export async function isHeicFile(file: Blob): Promise<boolean> {
  return looksLikeHeic(new Uint8Array(await file.slice(0, HEIC_SNIFF_BYTES).arrayBuffer()))
}

/**
 * Whether this browser decodes the file itself. Asked of `createImageBitmap`, which answers from the
 * bytes: an `<img>` on an object URL logs a failed request in the console for every file it cannot show.
 */
async function browserShows(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file)
    const shown = bitmap.width > 0
    bitmap.close()
    return shown
  } catch {
    return false
  }
}

async function jpegFromPixels(rgba: ArrayBuffer, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser gave no canvas to draw the photo on.')
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser could not write the photo as JPEG.'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  )
}

/** Decodes a HEIC file to a JPEG in a worker that ends, with its memory, when the photo is done. */
export async function heicToJpeg(
  file: Blob,
  { signal, maxPixels = HEIC_MAX_PIXELS }: Pick<ShowablePhotoOptions, 'signal' | 'maxPixels'> = {},
): Promise<{ blob: Blob; width: number; height: number; srgb: boolean }> {
  signal?.throwIfAborted()
  const bytes = await file.arrayBuffer()
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./heicDecode.worker.ts', import.meta.url), { type: 'module' })
  const response = await new Promise<HeicDecodeResponse>((resolve, reject) => {
    const abort = () => reject(signal?.reason ?? new DOMException('Opening the photo was cancelled.', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<HeicDecodeResponse>) => resolve(event.data)
    worker.onerror = (event) => reject(new Error(event.message || 'The HEIC decoder failed to start.'))
    worker.postMessage({ file: bytes, maxPixels, quality: JPEG_QUALITY } satisfies HeicDecodeRequest, [bytes])
  }).finally(() => worker.terminate())
  if (response.type === 'error')
    throw response.refused ? new HeicDecodeError(response.message) : new Error(response.message)
  const { width, height, srgb } = response
  const blob =
    response.type === 'jpeg'
      ? new Blob([response.jpeg], { type: 'image/jpeg' })
      : await jpegFromPixels(response.rgba, width, height)
  return { blob, width, height, srgb }
}

/** The photo in a form this browser shows: itself, or a JPEG decoded from its HEIC here. */
export async function showablePhoto(file: Blob, options: ShowablePhotoOptions = {}): Promise<ShowablePhoto> {
  if (!(await isHeicFile(file)) || (await browserShows(file))) return { blob: file, decodedFrom: null, srgb: true }
  options.onDecoding?.()
  const { blob, srgb } = await heicToJpeg(file, options)
  return { blob, decodedFrom: 'heic', srgb }
}
