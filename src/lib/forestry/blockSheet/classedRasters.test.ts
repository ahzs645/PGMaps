import { describe, expect, it } from 'vitest'
import { mercatorX, mercatorY } from '@/lib/mapSheet/scale'
import {
  classIndex,
  classifyRgba,
  hillshadeRgba,
  sampleSheetGridNow,
  slopeClassRgba,
  slopePercentFromDegrees,
  slopePercentGrid,
  type SheetGrid,
} from './classedRasters'
import { SLOPE_CLASS_OPACITY, SLOPE_CLASSES } from './styles'

const grid = (values: number[][], cell = 10): SheetGrid => ({
  width: values[0].length,
  height: values.length,
  values: Float32Array.from(values.flat()),
  cellSizeM: new Float64Array(values.length).fill(cell),
})
/** A plane rising `east` and `north` metres per metre. */
const plane = (east: number, north: number, size = 5, cell = 10) =>
  grid(
    Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => 100 + east * col * cell + north * (size - 1 - row) * cell),
    ),
    cell,
  )

describe('classed rasters', () => {
  it('converts degrees to percent', () => {
    expect(slopePercentFromDegrees(45)).toBeCloseTo(100)
  })

  it('measures slope percent from the grid, one-sided at edges', () => {
    const slope = slopePercentGrid(plane(0.3, 0.4))
    for (const value of slope) expect(value).toBeCloseTo(50, 4)
  })

  it('puts a value on a break in the class below (ArcGIS ≤ upper)', () => {
    expect(SLOPE_CLASSES[classIndex(30, SLOPE_CLASSES)].label).toBe('20 - 30')
    expect(SLOPE_CLASSES[classIndex(30.01, SLOPE_CLASSES)].label).toBe('30 - 35')
    expect(SLOPE_CLASSES[classIndex(20, SLOPE_CLASSES)].color).toBeNull()
    expect(classIndex(Number.NaN, SLOPE_CLASSES)).toBe(-1)
  })

  it('draws slope classes at alpha 216, clear under 20 % and black over 95 %', () => {
    const rgba = classifyRgba([10, 25, 90, 96, Number.NaN], SLOPE_CLASSES, SLOPE_CLASS_OPACITY, {
      min: 95,
      color: '#000000',
      opacity: 1,
    })
    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...rgba.slice(4, 8)]).toEqual([255, 255, 115, 216])
    expect([...rgba.slice(8, 12)]).toEqual([232, 21, 21, 216])
    expect([...rgba.slice(12, 16)]).toEqual([0, 0, 0, 255])
    expect([...rgba.slice(16, 20)]).toEqual([0, 0, 0, 0])
    expect(slopeClassRgba(plane(0.25, 0))[3]).toBe(216)
  })

  it('shades flat ground grey 180 and lights north-west faces', () => {
    expect(hillshadeRgba(plane(0, 0))[0]).toBe(180)
    // Rising to the south-east: the ground faces north-west, toward the sun.
    const lit = hillshadeRgba(plane(0.5, -0.5))[0]
    const shaded = hillshadeRgba(plane(-0.5, 0.5))[0]
    expect(lit).toBeGreaterThan(180)
    expect(shaded).toBeLessThan(180)
    // Missing ground stays transparent.
    const holed = grid([
      [1, 1, 1],
      [1, Number.NaN, 1],
      [1, 1, 1],
    ])
    expect(hillshadeRgba(holed)[4 * 4 + 3]).toBe(0)
  })

  it('samples a Mercator box at cell centres with ground cell sizes', () => {
    const box: [number, number, number, number] = [mercatorX(-121.6), mercatorY(54), mercatorX(-121.5), mercatorY(54.1)]
    const sampled = sampleSheetGridNow({ elevationAt: (lng) => lng }, box, 4, 4)
    expect(sampled.values[0]).toBeCloseTo(-121.5875, 4)
    // 0.1° of longitude at about 54.09° is about 6.5 km: 4 cells of about 1.63 km.
    expect(sampled.cellSizeM[0]).toBeGreaterThan(1620)
    expect(sampled.cellSizeM[0]).toBeLessThan(1640)
  })
})
