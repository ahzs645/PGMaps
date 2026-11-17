/**
 * Telling a HEIC photo from its first bytes, not its name: a HEIF file starts with an `ftyp` box
 * naming a major brand and the brands it is compatible with (ISO/IEC 23008-12). A phone's ".HEIC"
 * renamed ".jpg" is still HEIC, and a ".heic" that is really a JPEG is not.
 *
 * Free of DOM and network access.
 */

/** How much of a file `looksLikeHeic` wants: the `ftyp` box of any phone photo fits well inside. */
export const HEIC_SNIFF_BYTES = 64

/** For a file input's `accept`, beside the formats every browser shows. */
export const HEIC_ACCEPT = '.heic,.heif,image/heic,image/heif'

/** A photograph input's `accept`: what every browser shows, and HEIC, decoded here where it must be. */
export const PHOTO_FILE_ACCEPT = `image/jpeg,image/png,image/webp,${HEIC_ACCEPT}`

/** Brands whose pictures are HEVC-coded, which is what the decoder reads. */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'])

const brandAt = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

/** Whether these leading bytes are a HEIF file holding HEVC pictures (HEIC), by its brands. */
export function looksLikeHeic(head: Uint8Array): boolean {
  if (head.length < 12 || brandAt(head, 4) !== 'ftyp') return false
  if (HEVC_BRANDS.has(brandAt(head, 8))) return true
  // A generic major brand (mif1, msf1): the compatible brands say which codec it holds.
  const boxSize = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0
  const end = Math.min(head.length, boxSize >= 16 ? boxSize : head.length)
  for (let offset = 16; offset + 4 <= end; offset += 4) if (HEVC_BRANDS.has(brandAt(head, offset))) return true
  return false
}
