/**
 * Decoding a HEIC photo to upright 8-bit sRGB pixels with the decoder in `heic_decode.wasm`
 * (`crates/heic-decode`, a thin interface over the heifer crate: MIT OR Apache-2.0, pure Rust,
 * `NOTICE-HEIFER.md`). Every browser but Safari needs it to show an iPhone's photos.
 *
 * The file's crop, rotation and mirror are applied, and a Display P3 photo is converted to sRGB
 * from its ICC profile, so the pixels match what a browser draws for the same photo exported as
 * JPEG. One instance per photo: its memory (about 8 bytes a pixel while decoding) goes with it.
 *
 * Free of DOM and network access: the wasm bytes are passed in. Load it in the browser only
 * through `heicDecodeClient.ts`, which runs it in a worker.
 */

/** The largest picture decoded: above an iPhone's 48 MP, well under what a tab's memory holds. */
export const HEIC_MAX_PIXELS = 80_000_000

export interface DecodedHeic {
  width: number
  height: number
  /** RGBA, row by row, upright. */
  rgba: Uint8ClampedArray<ArrayBuffer>
  /**
   * False when the file's colours could not be brought to sRGB (an HDR transfer, or an ICC profile
   * that is not RGB) and the pixels are as coded: fine for geometry, a little off in colour.
   */
  srgb: boolean
}

/** A file the decoder refused, with its reason in plain words. */
export class HeicDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeicDecodeError'
  }
}

interface HeicExports {
  memory: WebAssembly.Memory
  hd_alloc(length: number): number
  hd_free(pointer: number, length: number): void
  hd_decode(pointer: number, length: number, maxPixels: number): number
  hd_width(): number
  hd_height(): number
  hd_srgb(): number
  hd_pixels_ptr(): number
  hd_pixels_len(): number
  hd_message_ptr(): number
  hd_message_len(): number
  hd_release(): void
}

/** Compiles the decoder once; `decodeHeic` makes an instance of it per photo. */
export const compileHeicDecoder = (wasm: BufferSource): Promise<WebAssembly.Module> => WebAssembly.compile(wasm)

/** Decodes the primary picture of a HEIC file, refusing one larger than `maxPixels`. */
export async function decodeHeic(
  decoder: WebAssembly.Module,
  file: Uint8Array,
  maxPixels: number = HEIC_MAX_PIXELS,
): Promise<DecodedHeic> {
  if (!file.length) throw new HeicDecodeError('The file is empty.')
  const instance = await WebAssembly.instantiate(decoder, {})
  const heic = instance.exports as unknown as HeicExports
  try {
    const input = heic.hd_alloc(file.length)
    new Uint8Array(heic.memory.buffer, input, file.length).set(file)
    const failed = heic.hd_decode(input, file.length, Math.max(1, Math.min(maxPixels, 0xffffffff)) >>> 0)
    if (failed) {
      const message = new TextDecoder().decode(
        new Uint8Array(heic.memory.buffer, heic.hd_message_ptr(), heic.hd_message_len()),
      )
      throw new HeicDecodeError(message || 'The picture could not be decoded.')
    }
    const width = heic.hd_width()
    const height = heic.hd_height()
    const length = heic.hd_pixels_len()
    if (!width || !height || length !== width * height * 4)
      throw new HeicDecodeError('The decoder returned no picture.')
    // Copied out of the instance's memory, which is dropped with it.
    const rgba = new Uint8ClampedArray(length)
    rgba.set(new Uint8Array(heic.memory.buffer, heic.hd_pixels_ptr(), length))
    return { width, height, rgba, srgb: heic.hd_srgb() === 1 }
  } catch (error) {
    if (error instanceof HeicDecodeError) throw error
    // A panic or an allocation the tab could not give ends as a trap.
    throw new HeicDecodeError(
      error instanceof WebAssembly.RuntimeError
        ? 'The decoder stopped on this file; it may be damaged, or too large for this browser’s memory.'
        : error instanceof Error
          ? error.message
          : String(error),
    )
  }
}
