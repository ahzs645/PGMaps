import { describe, expect, it } from 'vitest'
import { GRID_NO_DATA, GRID_UNCERTAIN, reconstructImageClassGrid, rasterGridCellRing } from './rasterClassGrid'

const palette = [{ value: 0, rgb: [220, 40, 30] as const }, { value: 2, rgb: [100, 20, 15] as const }]
function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
  return Uint8ClampedArray.from(Array.from({ length: width * height }, (_, i) => pixel(i % width, Math.floor(i / width))).flat())
}

describe('assumed image class grid', () => {
  it('preserves every RGBA channel, including partial alpha and unknown colours, in source pixel mode', () => {
    const rgba = image(4, 2, (x, y) => [x * 61 + y, x * 17, 255 - x, [0, 1, 127, 255][x]])
    const grid = reconstructImageClassGrid(rgba, 4, 2, palette, { cellPixels: 1, preserveSourcePixels: true })
    expect(Uint8ClampedArray.from(grid.cells.flatMap(cell => cell.rgba!))).toEqual(rgba)
    expect(grid.cells[0].value).toBe(GRID_NO_DATA)
    expect(grid.cells[2].value).toBe(GRID_UNCERTAIN)
    expect(() => reconstructImageClassGrid(rgba, 4, 2, palette, { cellPixels: 2, preserveSourcePixels: true })).toThrow('one box per pixel')
  })
  it('preserves zero classes, transparent cells and uncertain colours independently', () => {
    const rgba = image(4, 1, x => [[220, 40, 30, 255], [0, 0, 0, 0], [255, 255, 255, 255], [220, 40, 30, 100]][x])
    const grid = reconstructImageClassGrid(rgba, 4, 1, palette, { cellPixels: 1 })
    expect(grid.cells.map(cell => cell.value)).toEqual([0, GRID_NO_DATA, GRID_UNCERTAIN, GRID_UNCERTAIN])
  })

  it('keeps a minority class boundary uncertain instead of spreading the majority class', () => {
    const rgba = image(8, 4, (x, y) => x < 4 ? [220, 40, 30, 255] : y < 3 ? [220, 40, 30, 255] : [100, 20, 15, 255])
    const grid = reconstructImageClassGrid(rgba, 8, 4, palette, { cellPixels: 4 })
    expect(grid.cells.map(cell => cell.value)).toEqual([0, GRID_UNCERTAIN])
    expect(grid.cells[1].agreement).toBe(0.75)
  })

  it('votes from box interiors but does not invent uncoloured boxes from partial transparency', () => {
    const rgba = image(16, 8, (x, y) => x < 8
      ? x === 0 || y === 0 ? [255, 255, 255, 255] : [100, 20, 15, 255]
      : x === 8 && y === 0 ? [100, 20, 15, 255] : [0, 0, 0, 0])
    const grid = reconstructImageClassGrid(rgba, 16, 8, palette, { cellPixels: 8 })
    expect(grid.cells.map(cell => cell.value)).toEqual([2, GRID_NO_DATA])
    const mixed = reconstructImageClassGrid(image(4, 4, (x, y) => x === 0 && y === 0 ? [100, 20, 15, 255] : [0, 0, 0, 0]), 4, 4, palette)
    expect(mixed.cells[0].value).toBe(GRID_UNCERTAIN)
  })

  it('shares exactly identical edges across adjacent XYZ tiles and cell sizes', () => {
    const grid = { width: 256, height: 256, cellPixels: 4 }
    const left = rasterGridCellRing({ column: 63, row: 20 }, grid, { x: 162, y: 329, z: 10 })
    const right = rasterGridCellRing({ column: 0, row: 20 }, grid, { x: 163, y: 329, z: 10 })
    expect(left[1]).toEqual(right[0])
    expect(left[2]).toEqual(right[3])
    const nextRow = rasterGridCellRing({ column: 63, row: 21 }, grid, { x: 162, y: 329, z: 10 })
    expect(left[2]).toEqual(nextRow[1])
    expect(left[3]).toEqual(nextRow[0])
  })

  it('rejects grids that cannot align to the tile lattice', () => {
    expect(() => reconstructImageClassGrid(image(4, 4, () => [0, 0, 0, 0]), 4, 4, palette, { cellPixels: 3 })).toThrow('divide')
    expect(() => reconstructImageClassGrid(new Uint8ClampedArray(1), 4, 4, palette)).toThrow('complete')
  })
})
