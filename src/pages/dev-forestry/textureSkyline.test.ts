import { describe, expect, it } from 'vitest'
import { photoSkyline } from './skylineFit'
import { textureSkyline } from './textureSkyline'

describe('optional texture reader', () => {
  const width = 384
  const height = 216
  const ridge = (x: number) => Math.round(76 + 15 * Math.sin(0.02 * x) + 8 * Math.sin(0.049 * x))
  function snow(fog: boolean) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const ground = y - ridge(x)
        const grain = Math.sin(0.6 * x) * Math.cos(0.67 * y)
        const v = ground < 34 ? 239 + 13 * grain : 94 + 38 * grain
        data.set(fog ? [174, 174, 174, 255] : ground < 0 ? [111, 159, 205, 255] : [v, v, v, 255], i)
      }
    return { width, height, data }
  }
  it('recovers a snowy ridge where colour traces the snowline', () => {
    const im = snow(false)
    const error = (line: Array<{ x: number; y: number } | null>) => {
      const sorted = line.flatMap((point) => (point ? [Math.abs(ridge(point.x) - point.y)] : [])).sort((a, b) => a - b)
      expect(sorted.length).toBeGreaterThan(150)
      return sorted[Math.floor(sorted.length / 2)]
    }
    expect(error(photoSkyline(im))).toBeGreaterThan(20)
    expect(error(textureSkyline(im))).toBeLessThan(10)
  })
  it('does not turn featureless fog into a skyline', () => {
    expect(textureSkyline(snow(true)).filter(Boolean)).toHaveLength(0)
  })
})
