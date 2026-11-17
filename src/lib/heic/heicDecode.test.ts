import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import { compileHeicDecoder, decodeHeic, HeicDecodeError } from './heicDecode'

// Four flat quadrants, 96 × 64, written by macOS's HEIC encoder (sips): red, green over blue, white.
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/quadrants.heic', import.meta.url)))
let decoder: WebAssembly.Module

beforeAll(async () => {
  decoder = await compileHeicDecoder(readFileSync(new URL('./heic_decode.wasm', import.meta.url)))
})

describe('decodeHeic', () => {
  it('decodes a HEIC another encoder wrote, upright and in sRGB', async () => {
    const picture = await decodeHeic(decoder, fixture)
    expect([picture.width, picture.height]).toEqual([96, 64])
    expect(picture.srgb).toBe(true)
    expect(picture.rgba).toHaveLength(96 * 64 * 4)
    const at = (x: number, y: number) => Array.from(picture.rgba.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4))
    const near = (got: number[], want: number[]) => got.every((value, i) => Math.abs(value - want[i]) <= 6)
    expect(near(at(10, 10), [220, 30, 30, 255])).toBe(true)
    expect(near(at(85, 10), [30, 200, 30, 255])).toBe(true)
    expect(near(at(10, 55), [30, 30, 220, 255])).toBe(true)
    expect(near(at(85, 55), [240, 240, 240, 255])).toBe(true)
  })

  it('gives each photo its own instance, so one decode leaves nothing for the next', async () => {
    const first = await decodeHeic(decoder, fixture)
    const second = await decodeHeic(decoder, fixture)
    expect(second.rgba).not.toBe(first.rgba)
    expect(Array.from(second.rgba.subarray(0, 64))).toEqual(Array.from(first.rgba.subarray(0, 64)))
  })

  it('refuses a picture over the pixel limit with the decoder’s reason', async () => {
    await expect(decodeHeic(decoder, fixture, 1000)).rejects.toBeInstanceOf(HeicDecodeError)
  })

  it('refuses a file that is not HEIC, a truncated one and an empty one', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1])
    await expect(decodeHeic(decoder, jpeg)).rejects.toBeInstanceOf(HeicDecodeError)
    await expect(decodeHeic(decoder, fixture.subarray(0, 200))).rejects.toBeInstanceOf(HeicDecodeError)
    await expect(decodeHeic(decoder, new Uint8Array(0))).rejects.toThrow('empty')
  })
})
