import { describe, expect, it } from 'vitest'
import { prepareTerrainGpuTexture } from './terrainGpuTexture'
import type { TerrainBackgroundLayer } from './terrainPreparation'

function layer(width: number, height: number): TerrainBackgroundLayer {
  return {
    id: 'imported-ortho',
    name: 'Survey image',
    kind: 'ortho',
    epsg: 26910,
    origin: [500000.125, 6000000.25],
    pixelSize: [0.25, -0.5],
    width,
    height,
    rgba: Array.from({ length: width * height }, () => [200, 100, 20, 255]).flat(),
    sha256: 'a'.repeat(64),
    visible: true,
    opacity: 0.7,
  }
}

function positionAt(image: TerrainBackgroundLayer, u: number, v: number) {
  return [
    image.origin[0] - image.pixelSize[0] / 2 + u * image.width * image.pixelSize[0],
    image.origin[1] - image.pixelSize[1] / 2 + v * image.height * image.pixelSize[1],
  ]
}

describe('GPU orthophoto preparation', () => {
  it('returns the original object and pixel array when both sides already fit', () => {
    const source = layer(8, 4)
    const display = prepareTerrainGpuTexture(source, 8)
    expect(display).toBe(source)
    expect(display.rgba).toBe(source.rgba)
  })

  it.each([
    [4097, 2, 128],
    [2, 4097, 128],
    [25000, 2, 8],
    [2, 25000, 8],
  ])('bounds a %i × %i strip to %i pixels per side without moving its footprint', (width, height, side) => {
    const source = layer(width, height)
    const before = structuredClone(source)
    const display = prepareTerrainGpuTexture(source, side)
    expect(display).not.toBe(source)
    expect(display.width).toBeGreaterThanOrEqual(2)
    expect(display.height).toBeGreaterThanOrEqual(2)
    expect(display.width).toBeLessThanOrEqual(side)
    expect(display.height).toBeLessThanOrEqual(side)
    expect(Math.max(display.width, display.height)).toBeGreaterThanOrEqual(side - 1)
    expect(display.rgba.length).toBe(display.width * display.height * 4)
    expect(display.rgba.every((value, i) => value === [200, 100, 20, 255][i % 4])).toBe(true)
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.37, 0.61],
    ]) {
      const actual = positionAt(display, u, v)
      const expected = positionAt(source, u, v)
      expect(actual[0]).toBeCloseTo(expected[0], 8)
      expect(actual[1]).toBeCloseTo(expected[1], 8)
    }
    expect(source).toEqual(before)
    expect(display.opacity).toBe(source.opacity)
    expect(display.sourceSize).toEqual([width, height])
  })

  it('preserves transparent gaps, opacity-weighted colours and original file dimensions', () => {
    const source = layer(64, 2)
    source.sourceSize = [640, 20]
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++) {
        if (x % 8 >= 4 || (x >= 32 && x < 40)) source.rgba.splice((y * source.width + x) * 4, 4, 0, 0, 0, 0)
      }
    const before = structuredClone(source)
    const display = prepareTerrainGpuTexture(source, 8)
    expect([display.width, display.height]).toEqual([8, 2])
    for (let y = 0; y < display.height; y++)
      for (let x = 0; x < display.width; x++)
        expect(display.rgba.slice((y * display.width + x) * 4, (y * display.width + x + 1) * 4)).toEqual(
          x === 4 ? [0, 0, 0, 0] : [200, 100, 20, 128],
        )
    expect(display.sourceSize).toEqual([640, 20])
    expect(display.opacity).toBe(0.7)
    expect(source).toEqual(before)
  })

  it('uses an integer cap of at least two and rejects an unreadable device limit', () => {
    const source = layer(64, 4)
    const minimum = prepareTerrainGpuTexture(source, 1)
    expect([minimum.width, minimum.height]).toEqual([2, 2])
    const fractional = prepareTerrainGpuTexture(source, 8.9)
    expect(Math.max(fractional.width, fractional.height)).toBeLessThanOrEqual(8)
    expect(() => prepareTerrainGpuTexture(source, NaN)).toThrow('invalid image texture limit')
    expect(() => prepareTerrainGpuTexture(source, Infinity)).toThrow('invalid image texture limit')
  })
})
