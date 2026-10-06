import { expect, it } from 'vitest'
import { encode } from 'fast-png'
import { decodePngPixels } from './pngPixels'

it('decodes PNG bytes without losing transparent RGB or rounding colours with partial alpha', () => {
  const data = new Uint8Array([71, 83, 97, 0, 17, 43, 89, 1, 123, 167, 211, 127, 252, 128, 118, 255])
  const decoded = decodePngPixels(encode({ width: 4, height: 1, channels: 4, depth: 8, data }))
  expect(decoded.width).toBe(4)
  expect(decoded.height).toBe(1)
  expect(decoded.rgba).toEqual(new Uint8ClampedArray(data))
})

it('rejects unsupported images rather than silently reducing source precision', () => {
  expect(() => decodePngPixels(encode({ width: 1, height: 1, channels: 3, data: new Uint8Array([1, 2, 3]) }))).toThrow('8-bit RGBA')
})
