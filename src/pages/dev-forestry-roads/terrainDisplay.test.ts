import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTerrainDisplay,
  TERRAIN_ASPECT_FLAT_COLOR,
  TERRAIN_ASPECT_STOPS,
  terrainAspectFromGradient,
} from './terrainDisplay'
import type { TerrainSource } from './types'

interface CapturedImage {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

/** Inspect actual display pixels before encoding; no browser rendering dependency. */
function captureCanvas() {
  const images = new Map<string, CapturedImage>()
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'canvas') throw Error('Unexpected DOM request in terrain display')
      let pixels: Uint8ClampedArray = new Uint8ClampedArray()
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: (image: { data: Uint8ClampedArray }) => {
            pixels = image.data.slice()
          },
        }),
        toDataURL() {
          const key = `captured-image-${images.size}`
          images.set(key, { width: this.width, height: this.height, pixels })
          return key
        },
      }
    },
  })
  return images
}
const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
const pixel = (image: CapturedImage, column: number, row: number) => [
  ...image.pixels.slice((row * image.width + column) * 4, (row * image.width + column + 1) * 4),
]
const bounds: [number, number, number, number] = [-0.001, -0.001, 0.001, 0.001]
const metresPerDegree = (Math.PI / 180) * 6371008.8

afterEach(() => vi.unstubAllGlobals())

describe('terrain aspect direction', () => {
  it('uses downslope compass bearings for all eight cardinal/intercardinal planes', () => {
    const cases = [
      [0, -1, 0],
      [-1, -1, 45],
      [-1, 0, 90],
      [-1, 1, 135],
      [0, 1, 180],
      [1, 1, 225],
      [1, 0, 270],
      [1, -1, 315],
    ]
    for (const [east, north, expected] of cases) {
      const result = terrainAspectFromGradient(east, north)
      expect(result.state).toBe('aspect')
      expect(result.degrees).toBeCloseTo(expected, 10)
    }
    expect(TERRAIN_ASPECT_STOPS[0].color).toBe(TERRAIN_ASPECT_STOPS.at(-1)!.color)
    expect(TERRAIN_ASPECT_STOPS.map((stop) => stop.value)).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360])
  })

  it('wraps clockwise around north and distinguishes flat terrain from unavailable gradients', () => {
    const oneDegree = Math.tan(Math.PI / 180)
    expect(terrainAspectFromGradient(-oneDegree, -1).degrees).toBeCloseTo(1, 10)
    expect(terrainAspectFromGradient(oneDegree, -1).degrees).toBeCloseTo(359, 10)
    expect(terrainAspectFromGradient(0, 0)).toEqual({ state: 'flat', degrees: null })
    expect(terrainAspectFromGradient(1e-12, -1e-12)).toEqual({ state: 'flat', degrees: null })
    expect(terrainAspectFromGradient(1e-6, 0)).toEqual({ state: 'aspect', degrees: 270 })
    expect(terrainAspectFromGradient(NaN, 1)).toEqual({ state: 'no-data', degrees: null })
    expect(terrainAspectFromGradient(1, Infinity)).toEqual({ state: 'no-data', degrees: null })
  })
})

describe('same-source aspect preview', () => {
  it.each([
    ['north-facing', 0, -0.2, 0],
    ['east-facing', -0.2, 0, 90],
    ['northwest-facing', 0.2, -0.2, 315],
  ] as const)('colors a %s plane correctly at pixel centers and display boundaries', (_name, east, north, bearing) => {
    const images = captureCanvas()
    let calls = 0
    const source: TerrainSource = {
      elevationAt: (longitude, latitude) => {
        calls++
        return 400 + east * longitude * metresPerDegree + north * latitude * metresPerDegree
      },
    }
    const display = buildTerrainDisplay(source, bounds, 32)
    const aspect = images.get(display.aspect)!
    const expected = [...rgb(TERRAIN_ASPECT_STOPS.find((stop) => stop.value === bearing)!.color), 255]
    expect(pixel(aspect, 16, 16)).toEqual(expected)
    expect(pixel(aspect, 0, 0)).toEqual(expected)
    expect(pixel(aspect, aspect.width - 1, aspect.height - 1)).toEqual(expected)
    expect(calls).toBe(aspect.width * aspect.height)
    expect(images.size).toBe(4)
    expect(display.coordinates).toEqual([
      [-0.001, 0.001],
      [0.001, 0.001],
      [0.001, -0.001],
      [-0.001, -0.001],
    ])
  })

  it('renders covered flat terrain in an opaque neutral color, distinct from no-data', () => {
    const images = captureCanvas()
    const flat = buildTerrainDisplay({ elevationAt: () => 500 }, bounds, 32)
    const flatImage = images.get(flat.aspect)!
    const expected = [...rgb(TERRAIN_ASPECT_FLAT_COLOR), 255]
    for (let i = 0; i < flatImage.pixels.length; i += 4) expect([...flatImage.pixels.slice(i, i + 4)]).toEqual(expected)
    const missing = buildTerrainDisplay({ elevationAt: () => NaN }, bounds, 32)
    expect(images.get(missing.aspect)!.pixels.every((value) => value === 0)).toBe(true)
  })

  it('keeps actual no-data transparent and retains supported gradients beside a gap', () => {
    const images = captureCanvas()
    const cell = 0.002 / 32
    const display = buildTerrainDisplay(
      {
        elevationAt: (longitude, latitude) =>
          longitude > 0 && longitude < cell && latitude < 0 && latitude > -cell
            ? NaN
            : 400 + latitude * metresPerDegree * 0.2,
      },
      bounds,
      32,
    )
    const aspect = images.get(display.aspect)!,
      elevation = images.get(display.elevation)!
    expect(pixel(aspect, 16, 16)[3]).toBe(0)
    expect(pixel(images.get(display.hillshade)!, 16, 16)[3]).toBe(0)
    for (const [column, row] of [
      [15, 16],
      [17, 16],
      [16, 15],
      [16, 17],
    ])
      expect(pixel(aspect, column, row)).toEqual([
        ...rgb(TERRAIN_ASPECT_STOPS.find((stop) => stop.value === 180)!.color),
        255,
      ])
    expect(pixel(elevation, 16, 16)[3]).toBe(0)
    expect(pixel(elevation, 15, 16)[3]).toBe(255)
    expect(pixel(aspect, 15, 15)).toEqual([...rgb(TERRAIN_ASPECT_STOPS.find((stop) => stop.value === 180)!.color), 255])
  })

  it('does not invent a gradient where neither side of an axis has supported ground', () => {
    const images = captureCanvas()
    const cell = 0.002 / 32
    const display = buildTerrainDisplay(
      {
        elevationAt: (longitude, latitude) =>
          latitude < 0 && latitude > -cell && !(longitude > 0 && longitude < cell)
            ? NaN
            : 400 + longitude * metresPerDegree * 0.2,
      },
      bounds,
      32,
    )
    expect(pixel(images.get(display.elevation)!, 16, 16)[3]).toBe(255)
    expect(pixel(images.get(display.aspect)!, 16, 16)[3]).toBe(0)
    expect(pixel(images.get(display.hillshade)!, 16, 16)[3]).toBe(0)
  })
})
