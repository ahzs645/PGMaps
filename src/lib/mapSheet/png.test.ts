import { describe, expect, it } from 'vitest'
import { encodedImage, encodePng } from './png'

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe('PNG encoder', () => {
  it('writes RGB for opaque images and RGBA otherwise, with Sub-filtered rows', async () => {
    const opaque = await encodePng(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), 2, 1)
    expect([...opaque.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(opaque[25]).toBe(2)
    const translucent = await encodePng(new Uint8ClampedArray([10, 20, 30, 216, 40, 50, 60, 0]), 2, 1)
    expect(translucent[25]).toBe(6)
    // IDAT starts after the 8-byte signature and the 25-byte IHDR chunk.
    const length = new DataView(translucent.buffer).getUint32(33)
    const raw = await inflate(translucent.slice(41, 41 + length))
    expect([...raw]).toEqual([1, 10, 20, 30, 216, 30, 30, 30, 40])
  })

  it('rejects pixels that do not match the size and passes encoded images through', async () => {
    await expect(encodePng(new Uint8ClampedArray(4), 2, 2)).rejects.toThrow()
    const url = { kind: 'url' as const, url: 'data:image/jpeg;base64,AA', format: 'JPEG' as const, width: 1, height: 1 }
    expect(await encodedImage(url)).toBe(url)
    const encoded = await encodedImage({
      kind: 'rgba',
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    })
    expect(encoded.kind === 'url' && encoded.url.startsWith('data:image/png;base64,')).toBe(true)
  })
})
