/// <reference lib="webworker" />
/**
 * Decodes one HEIC photo off the page's thread and hands it back as a JPEG the page can show. The
 * wasm file is fetched here, only when a HEIC photo is opened in a browser that cannot show one.
 * Where a worker has no 2D canvas, the pixels go back for the page to encode.
 */
import { compileHeicDecoder, decodeHeic, HeicDecodeError } from './heicDecode'

export interface HeicDecodeRequest {
  file: ArrayBuffer
  maxPixels: number
  /** JPEG quality, 0–1. */
  quality: number
}

export type HeicDecodeResponse =
  /**
   * The JPEG as bytes, not a Blob: this worker ends as soon as it has answered, and a Blob made here can
   * be unreadable on the page once it has.
   */
  | { type: 'jpeg'; jpeg: ArrayBuffer; width: number; height: number; srgb: boolean }
  | { type: 'pixels'; rgba: ArrayBuffer; width: number; height: number; srgb: boolean }
  | { type: 'error'; message: string; refused: boolean }

const scope = self as unknown as DedicatedWorkerGlobalScope

const encodeJpeg = async (
  picture: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> },
  quality: number,
): Promise<Blob | null> => {
  if (typeof OffscreenCanvas === 'undefined') return null
  try {
    const canvas = new OffscreenCanvas(picture.width, picture.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality })
  } catch {
    return null
  }
}

scope.onmessage = async (event: MessageEvent<HeicDecodeRequest>) => {
  const { file, maxPixels, quality } = event.data
  try {
    const response = await fetch(new URL('./heic_decode.wasm', import.meta.url))
    if (!response.ok) throw new Error(`The HEIC decoder did not load (${response.status}).`)
    const decoder = await compileHeicDecoder(await response.arrayBuffer())
    const picture = await decodeHeic(decoder, new Uint8Array(file), maxPixels)
    const { width, height, srgb } = picture
    const blob = await encodeJpeg(picture, quality)
    if (blob) {
      const jpeg = await blob.arrayBuffer()
      scope.postMessage({ type: 'jpeg', jpeg, width, height, srgb } satisfies HeicDecodeResponse, [jpeg])
    } else
      scope.postMessage(
        { type: 'pixels', rgba: picture.rgba.buffer, width, height, srgb } satisfies HeicDecodeResponse,
        [picture.rgba.buffer],
      )
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      refused: error instanceof HeicDecodeError,
    } satisfies HeicDecodeResponse)
  }
}
