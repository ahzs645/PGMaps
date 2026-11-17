import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { HEIC_SNIFF_BYTES, looksLikeHeic } from './heicFile'

const ftyp = (major: string, compatible: string[] = []) => {
  const size = 16 + compatible.length * 4
  const bytes = new Uint8Array(size)
  new DataView(bytes.buffer).setUint32(0, size)
  const text = `ftyp${major}\0\0\0\0${compatible.join('')}`
  for (let i = 0; i < text.length; i += 1) bytes[4 + i] = text.charCodeAt(i)
  return bytes
}

describe('looksLikeHeic', () => {
  it('knows a HEIC photo by its major brand', () => {
    expect(looksLikeHeic(ftyp('heic', ['mif1', 'MiHB']))).toBe(true)
    expect(looksLikeHeic(ftyp('heix'))).toBe(true)
  })

  it('reads the compatible brands of a generic HEIF file', () => {
    expect(looksLikeHeic(ftyp('mif1', ['miaf', 'heic']))).toBe(true)
    expect(looksLikeHeic(ftyp('mif1', ['miaf', 'avif']))).toBe(false)
    expect(looksLikeHeic(ftyp('mif1'))).toBe(false)
  })

  it('refuses other files, whatever they are named', () => {
    expect(looksLikeHeic(ftyp('avif', ['mif1']))).toBe(false)
    expect(looksLikeHeic(ftyp('isom', ['mp42']))).toBe(false)
    expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, 0x45, 0x78, 0x69, 0x66, 0, 0]))).toBe(false)
    expect(looksLikeHeic(new Uint8Array(4))).toBe(false)
  })

  it('does not read brands past the ftyp box', () => {
    // "heic" in the bytes after a 16-byte ftyp box is not a brand.
    const bytes = new Uint8Array(32)
    bytes.set(ftyp('mif1'))
    bytes.set([0x68, 0x65, 0x69, 0x63], 16)
    expect(looksLikeHeic(bytes)).toBe(false)
  })

  it('knows the fixture macOS wrote from its first bytes', () => {
    const file = readFileSync(new URL('./fixtures/quadrants.heic', import.meta.url))
    expect(looksLikeHeic(new Uint8Array(file.subarray(0, HEIC_SNIFF_BYTES)))).toBe(true)
  })
})
