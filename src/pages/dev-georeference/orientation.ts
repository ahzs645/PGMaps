/**
 * Make the browser decode the original raster pixel grid, as GDAL does, without
 * rotating/resampling/re-encoding its compressed pixels. Keep the original File
 * for identity hashing and export; this Blob is only the browser decoding copy.
 */
const MAX_SEGMENTS = 4096
const MAX_EXIF_BYTES = 8 * 1024 * 1024
const MAX_PATCHES = 4096
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

interface Replacement {
  start: number
  end: number
  bytes?: ArrayBuffer
}

async function bytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer())
}

function short(data: Uint8Array, offset: number, little: boolean): number {
  return little ? data[offset] + data[offset + 1] * 256 : data[offset] * 256 + data[offset + 1]
}

function long(data: Uint8Array, offset: number, little: boolean): number {
  return little
    ? data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536 + data[offset + 3] * 16777216
    : data[offset] * 16777216 + data[offset + 1] * 65536 + data[offset + 2] * 256 + data[offset + 3]
}

/** Only the primary image IFD is authoritative; thumbnail/sub-IFD grids are separate images. */
function exifOrientationReplacements(data: Uint8Array, absoluteStart: number): Replacement[] {
  if (
    data.length < 14 ||
    data[0] !== 0x45 ||
    data[1] !== 0x78 ||
    data[2] !== 0x69 ||
    data[3] !== 0x66 ||
    data[4] !== 0 ||
    data[5] !== 0
  )
    return []
  const tiff = 6
  const little = data[tiff] === 0x49 && data[tiff + 1] === 0x49
  const big = data[tiff] === 0x4d && data[tiff + 1] === 0x4d
  if ((!little && !big) || short(data, tiff + 2, little) !== 42) return []
  const relativeDirectory = long(data, tiff + 4, little)
  const directory = tiff + relativeDirectory
  if (relativeDirectory < 8 || directory + 2 > data.length) return []
  const count = short(data, directory, little)
  // Require the complete IFD, including its next-IFD pointer. Never follow arbitrary pointers.
  if (directory + 2 + count * 12 + 4 > data.length) return []
  const replacements: Replacement[] = []
  for (let entry = 0; entry < count; entry += 1) {
    const offset = directory + 2 + entry * 12
    if (
      short(data, offset, little) !== 0x0112 ||
      short(data, offset + 2, little) !== 3 ||
      long(data, offset + 4, little) !== 1
    )
      continue
    const value = short(data, offset + 8, little)
    if (value < 2 || value > 8) continue
    replacements.push({
      start: absoluteStart + offset + 8,
      end: absoluteStart + offset + 10,
      bytes: new Uint8Array(little ? [1, 0] : [0, 1]).buffer,
    })
  }
  return replacements
}

async function jpegReplacements(file: Blob): Promise<Replacement[]> {
  let position = 2
  let metadataBytes = 0
  const replacements: Replacement[] = []
  for (let segment = 0; segment < MAX_SEGMENTS; segment += 1) {
    const header = await bytes(file, position, 4)
    if (header.length < 2 || header[0] !== 0xff) return []
    const marker = header[1]
    if (marker === 0xff) {
      position += 1 // JPEG permits padding FF bytes before a marker.
      continue
    }
    if (marker === 0xd9) return replacements
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2
      continue
    }
    if (marker === 0 || marker === 0xd8 || header.length < 4) return []
    const length = short(header, 2, false)
    if (length < 2 || position + 2 + length > file.size) return []
    // Entropy-coded scan bytes are never inspected or changed.
    if (marker === 0xda) return replacements
    if (marker === 0xe1 && length >= 8) {
      const prefix = await bytes(file, position + 4, 6)
      if (
        prefix[0] === 0x45 &&
        prefix[1] === 0x78 &&
        prefix[2] === 0x69 &&
        prefix[3] === 0x66 &&
        prefix[4] === 0 &&
        prefix[5] === 0
      ) {
        metadataBytes += length - 2
        if (metadataBytes > MAX_EXIF_BYTES) return []
        const data = await bytes(file, position + 4, length - 2)
        replacements.push(...exifOrientationReplacements(data, position + 4))
        if (replacements.length > MAX_PATCHES) return []
      }
    }
    position += length + 2
  }
  return []
}

async function pngReplacements(file: Blob): Promise<Replacement[]> {
  let position = 8
  const replacements: Replacement[] = []
  for (let chunk = 0; chunk < MAX_SEGMENTS; chunk += 1) {
    const header = await bytes(file, position, 8)
    if (header.length !== 8) return []
    const length = long(header, 0, false)
    const end = position + length + 12 // length, type, payload, CRC
    if (end > file.size) return []
    const type = String.fromCharCode(...header.subarray(4, 8))
    if (chunk === 0 && (type !== 'IHDR' || length !== 13)) return []
    if (type === 'eXIf') replacements.push({ start: position, end })
    if (type === 'IEND') return length === 0 ? replacements : []
    position = end
  }
  return []
}

async function webpReplacements(file: Blob, header: Uint8Array): Promise<Replacement[]> {
  const riffLength = long(header, 4, true)
  const riffEnd = riffLength + 8
  if (riffLength < 4 || riffLength % 2 !== 0 || riffEnd > file.size) return []
  let position = 12
  let removed = 0
  const replacements: Replacement[] = []
  for (let chunk = 0; chunk < MAX_SEGMENTS; chunk += 1) {
    if (position === riffEnd) {
      if (removed) {
        const lengthBytes = new ArrayBuffer(4)
        new DataView(lengthBytes).setUint32(0, riffLength - removed, true)
        replacements.unshift({ start: 4, end: 8, bytes: lengthBytes })
      }
      return replacements
    }
    if (position + 8 > riffEnd) return []
    const chunkHeader = await bytes(file, position, 8)
    if (chunkHeader.length !== 8) return []
    const length = long(chunkHeader, 4, true)
    // RIFF data chunks have an extra pad byte when their payload length is odd.
    const end = position + 8 + length + (length % 2)
    if (end > riffEnd) return []
    const type = String.fromCharCode(...chunkHeader.subarray(0, 4))
    if (type === 'EXIF') {
      replacements.push({ start: position, end })
      removed += end - position
    } else if (type === 'VP8X') {
      if (length !== 10) return []
      const flags = await bytes(file, position + 8, 1)
      if (flags[0] & 0x08) {
        replacements.push({
          start: position + 8,
          end: position + 9,
          bytes: new Uint8Array([flags[0] & ~0x08]).buffer,
        })
      }
    }
    // VP8/VP8L and ANIM/ANMF data are skipped by size, not read or re-encoded.
    position = end
  }
  return []
}

/**
 * Metadata-only, copy-on-write preview. Reads bounded headers/Exif payloads, not
 * the complete image buffer. Unsupported or malformed structures are untouched.
 */
export async function nativeOrientationBlob(file: Blob): Promise<Blob> {
  const signature = await bytes(file, 0, 12)
  let replacements: Replacement[]
  if (signature[0] === 0xff && signature[1] === 0xd8) {
    replacements = await jpegReplacements(file)
  } else if (PNG_SIGNATURE.every((value, index) => signature[index] === value)) {
    replacements = await pngReplacements(file)
  } else if (
    String.fromCharCode(...signature.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...signature.subarray(8, 12)) === 'WEBP'
  ) {
    replacements = await webpReplacements(file, signature)
  } else {
    return file
  }
  if (!replacements.length) return file
  const parts: BlobPart[] = []
  let position = 0
  for (const replacement of replacements) {
    parts.push(file.slice(position, replacement.start))
    if (replacement.bytes) parts.push(replacement.bytes)
    position = replacement.end
  }
  parts.push(file.slice(position))
  return new Blob(parts, { type: file.type })
}
