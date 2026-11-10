import { describe, expect, it } from 'vitest'
import { areaPatternTile, iconImage, MAX_PATTERN_TILE_PX, PX_PER_PT, tileSide, type RgbaImage } from './symbolRaster'
import type { AreaSymbol, Hatch } from './symbols'

const hatched = (hatches: Hatch[], more: Partial<AreaSymbol> = {}): AreaSymbol => ({
  kind: 'area',
  label: 'x',
  hatches,
  outline: [],
  ...more,
})
const at = (image: RgbaImage, x: number, y: number) => {
  const i = (y * image.width + x) * 4
  return [...image.data.slice(i, i + 4)]
}
const coloured = (image: RgbaImage, rgb: number[]) => {
  let count = 0
  for (let i = 0; i < image.data.length; i += 4)
    if (
      image.data[i + 3] > 200 &&
      Math.abs(image.data[i] - rgb[0]) + Math.abs(image.data[i + 1] - rgb[1]) + Math.abs(image.data[i + 2] - rgb[2]) <
        30
    )
      count++
  return count
}

describe('pattern tiles', () => {
  it('picks the smallest side holding whole periods', () => {
    expect(tileSide([10], 4)).toBe(10)
    // 13 px would put each line 2.5 % off; two periods in 27 px are 1.3 % off.
    expect(tileSide([13.333], 4)).toBe(27)
    expect(tileSide([12.5], 4)).toBe(25)
    expect(tileSide([], 9)).toBe(9)
    expect(tileSide([1000], 4)).toBeLessThanOrEqual(MAX_PATTERN_TILE_PX)
  })

  it('sizes a 45° hatch so its spacing and angle match in screen points, at the device pixel ratio', () => {
    for (const ratio of [1, 2, 3]) {
      const tile = areaPatternTile(
        hatched([{ angleDeg: 45, spacing: 5, stroke: { color: '#38a800', width: 0.5 } }]),
        ratio,
      )!
      // Lines 5 pt apart at 45° repeat every 5√2 pt across and down; the tile holds whole periods.
      const period = 5 * Math.SQRT2 * PX_PER_PT * ratio
      const periods = Math.round(tile.width / period)
      expect(periods).toBeGreaterThanOrEqual(1)
      expect(Math.abs(tile.width / periods - period) / period).toBeLessThanOrEqual(0.02)
      expect(tile.width).toBe(tile.height)
      expect(tile.pixelRatio).toBe(ratio)
      expect(tile.data.length).toBe(tile.width * tile.height * 4)
      expect(tile.hatches[0].angleDeg).toBeCloseTo(45, 6)
      expect(Math.abs(tile.hatches[0].spacing - 5) / 5).toBeLessThan(0.03)
    }
  })

  it('draws the lines through the tile and leaves the gaps clear', () => {
    const tile = areaPatternTile(hatched([{ angleDeg: 90, spacing: 5, stroke: { color: '#ff0000', width: 1 } }]), 2)!
    // Vertical lines 5 pt apart are 13.3 px at ratio 2: a 27 px tile holds two, at x = 0 and 13.5.
    expect(tile.width).toBe(27)
    expect(at(tile, 0, 3)).toEqual([255, 0, 0, 255])
    expect(at(tile, 7, 3)[3]).toBe(0)
    expect(at(tile, 13, 3)[3]).toBeGreaterThan(100)
    expect(at(tile, 20, 3)[3]).toBe(0)
  })

  it('repeats an odd angle exactly, reporting the angle and spacing it drew', () => {
    const tile = areaPatternTile(hatched([{ angleDeg: 55, spacing: 5, stroke: { color: '#6e6e6e', width: 1 } }]), 2)!
    expect(Math.abs(tile.hatches[0].angleDeg - 55)).toBeLessThan(2)
    expect(Math.abs(tile.hatches[0].spacing - 5) / 5).toBeLessThan(0.03)
  })

  it('combines cross, grid and striped hatches in one tile, with the fill baked in', () => {
    const cross = areaPatternTile(
      hatched([
        { angleDeg: 45, spacing: 8, stroke: { color: '#e60000', width: 0.7 } },
        { angleDeg: 135, spacing: 8, stroke: { color: '#a900e6', width: 0.8 } },
      ]),
      2,
    )!
    expect(cross.hatches.map((h) => Math.round(h.angleDeg))).toEqual([45, 135])
    expect(coloured(cross, [0xe6, 0, 0])).toBeGreaterThan(0)
    expect(coloured(cross, [0xa9, 0, 0xe6])).toBeGreaterThan(0)
    const grid = areaPatternTile(
      hatched([
        { angleDeg: 90, spacing: 5, stroke: { color: '#0070ff', width: 0.5 } },
        { angleDeg: 0, spacing: 5, stroke: { color: '#cdaa66', width: 0.5 } },
      ]),
      1,
    )!
    expect(grid.width).toBe(grid.height)
    const stripes = areaPatternTile(
      hatched([
        { angleDeg: 45, spacing: 6, stroke: { color: '#ff7f7f', width: 1.2 } },
        { angleDeg: 45, spacing: 6, stroke: { color: '#9c9c9c', width: 1.2 }, phase: 3 },
      ]),
      2,
    )!
    const pink = coloured(stripes, [0xff, 0x7f, 0x7f]),
      grey = coloured(stripes, [0x9c, 0x9c, 0x9c])
    expect(pink).toBeGreaterThan(0)
    expect(Math.abs(pink - grey) / pink).toBeLessThan(0.25)
    const filled = areaPatternTile(
      hatched([{ angleDeg: 45, spacing: 5, stroke: { color: '#6e6e6e', width: 1 } }], {
        fill: '#ffff00',
        fillOpacity: 0.5,
      }),
      1,
    )!
    expect(Math.min(...Array.from({ length: filled.width }, (_, x) => at(filled, x, 0)[3]))).toBeGreaterThanOrEqual(127)
  })

  it('tiles a staggered marker fill in whole pitches', () => {
    const tile = areaPatternTile(
      {
        kind: 'area',
        label: 'Wetland',
        markerFill: { icon: 'marsh', size: 8, color: '#005ce6', spacingX: 14, spacingY: 10, stagger: true },
        outline: [],
      },
      2,
    )!
    const pitchX = 14 * PX_PER_PT * 2,
      pitchY = 10 * PX_PER_PT * 2
    expect(Math.abs(tile.width / Math.round(tile.width / pitchX) - pitchX) / pitchX).toBeLessThan(0.03)
    expect(Math.round(tile.height / pitchY) % 2).toBe(0)
    expect(coloured(tile, [0, 0x5c, 0xe6])).toBeGreaterThan(20)
    expect(areaPatternTile({ kind: 'area', label: 'plain', fill: '#ffffbe', outline: [] }, 2)).toBeNull()
  })
})

describe('icon images', () => {
  it('draws an icon at its point size and pixel ratio, wider with a halo', () => {
    const plain = iconImage('diamond', 8, { primary: '#ff0000', secondary: '#000000' }, 2)
    expect(plain.pixelRatio).toBe(2)
    expect(plain.width).toBeGreaterThanOrEqual(Math.round(8 * PX_PER_PT * 2))
    const centre = at(plain, Math.floor(plain.width / 2), Math.floor(plain.height / 2))
    expect(centre).toEqual([255, 0, 0, 255])
    const halo = iconImage('diamond', 8, { primary: '#ff0000', secondary: '#000000' }, 2, {
      color: '#ffffff',
      width: 1.5,
    })
    expect(halo.width).toBeGreaterThan(plain.width)
    expect(coloured(halo, [255, 255, 255])).toBeGreaterThan(0)
  })
})
