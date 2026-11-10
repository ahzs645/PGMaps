import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BLOCK_OF_INTEREST,
  CANOPY_HEIGHT_CLASSES,
  classLegend,
  lineSymbolPaint,
  proposedRoad,
  SLOPE_CLASS_OPACITY,
  SLOPE_CLASSES,
  SLOPE_STEEP_OVERLAY,
  type RasterClass,
} from './styles'

const contiguous = (classes: readonly RasterClass[]) =>
  classes.every((entry, i) => (i === 0 ? entry.min === undefined : entry.min === classes[i - 1].max))

describe('block sheet styles', () => {
  it('keeps the slope classes contiguous with the reference colours', () => {
    expect(contiguous(SLOPE_CLASSES)).toBe(true)
    expect(SLOPE_CLASSES.at(-1)!.max).toBeUndefined()
    expect(SLOPE_CLASSES.map((entry) => entry.color)).toEqual([
      null,
      '#ffff73',
      '#a3ff73',
      '#73dfff',
      '#df73ff',
      '#ffaa00',
      '#ff7f7f',
      '#e81515',
    ])
    expect(SLOPE_CLASS_OPACITY).toBeCloseTo(0.85, 2)
    expect(SLOPE_STEEP_OVERLAY).toMatchObject({ min: 95, color: '#000000', opacity: 1 })
  })

  it('keeps canopy height in 5 m classes, clear under 5 m', () => {
    expect(contiguous(CANOPY_HEIGHT_CLASSES)).toBe(true)
    expect(CANOPY_HEIGHT_CLASSES[0]).toMatchObject({ max: 5, color: null })
    for (const entry of CANOPY_HEIGHT_CLASSES.slice(1, -1)) expect(entry.max! - entry.min!).toBe(5)
    expect(CANOPY_HEIGHT_CLASSES.at(-1)).toMatchObject({ min: 40, color: '#000000' })
  })

  it('builds the legend from the same class objects the raster uses', () => {
    const legend = classLegend(SLOPE_CLASSES, SLOPE_CLASS_OPACITY, SLOPE_STEEP_OVERLAY)
    expect(legend.map((entry) => entry.color)).toEqual([
      ...SLOPE_CLASSES.flatMap((entry) => (entry.color ? [entry.color] : [])),
      '#000000',
    ])
    expect(legend.at(-1)!.label).toBe('95 +')
  })

  it('gives MapLibre the same colours and widths, with dashes in line widths', () => {
    const road = proposedRoad('#2563eb', 'detail')
    const paints = lineSymbolPaint(road)
    expect(paints[0]['line-color']).toBe('#2563eb')
    expect(paints[0]['line-width']).toBeCloseTo(2.5 * (96 / 72))
    expect(paints[1]['line-dasharray']).toEqual([5, 5])
    expect(BLOCK_OF_INTEREST.default.outline.map((s) => s.color)).toEqual(['#ffffff', '#ffaa00'])
  })

  it('carries no licensee names', () => {
    const folder = path.dirname(new URL(import.meta.url).pathname)
    for (const file of ['styles.ts', 'sheets.ts', 'composeSheet.ts']) {
      const text = readFileSync(path.join(folder, file), 'utf8')
      expect(text).not.toMatch(/canfor|bcts|\bdtt\b|U975582/i)
    }
  })
})
