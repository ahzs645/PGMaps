import { describe, expect, it } from 'vitest'
import { sampleSheetGridNow } from './classedRasters'
import { composeSheet, sheetFocus, sheetFrame } from './composeSheet'
import { beyondOnly, prepareSheetTerrainNow } from './prepareSheet'
import { syntheticTerrain } from './blockSheetFixtures'
import { BEYOND_CONTOUR_STYLES } from './styles'

const block = {
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-121.53, 54.06],
        [-121.52, 54.06],
        [-121.52, 54.066],
        [-121.53, 54.066],
        [-121.53, 54.06],
      ],
    ],
  },
  name: 'Block',
}
const EDGE = -121.525
/** Detailed terrain that stops at a meridian through the block, as a LiDAR box stops. */
const detailed = {
  elevationAt: (lng: number, lat: number) => (lng < EDGE ? syntheticTerrain.elevationAt(lng, lat) : NaN),
}
/** Coarse terrain over the whole frame, a tilted plane. */
const regional = { elevationAt: (lng: number, lat: number) => 800 + (lng + 121.5) * 4000 + (lat - 54) * 3000 }
const frame = () => sheetFrame('field-layout', 'tabloid', 10000, { bounds: sheetFocus({ block })! })
const sheetBase = {
  layers: { block },
  facts: null,
  terrainName: 'Detailed terrain',
  fields: {},
  issue: { date: '2026-11-24', preparedBy: '', organisation: '', revision: '' },
  caveat: 'Preliminary',
}

describe('contours beyond the terrain', () => {
  it('draws regional contours only where the terrain holds no height, and leaves the terrain’s own alone', () => {
    const f = frame()
    const products = prepareSheetTerrainNow(f, {
      terrain: detailed,
      contourBeyond: { source: regional, name: 'regional DEM' },
    })
    const plain = prepareSheetTerrainNow(f, { terrain: detailed })
    expect(products.contours).toEqual(plain.contours)
    expect(products.missing).toEqual([])
    const beyond = products.contoursBeyond!
    expect(beyond.source).toBe('regional DEM')
    expect(beyond.result.levels.length).toBeGreaterThan(0)
    const covered = sampleSheetGridNow(detailed, f.projection.mercatorBox, beyond.gridWidth, beyond.gridHeight)
    expect(covered.values.some(Number.isFinite)).toBe(true)
    // Every vertex lies in a cell whose four corners the terrain left empty.
    for (const level of beyond.result.levels)
      for (const line of level.lines)
        for (const [c, r] of line)
          for (const col of [Math.floor(c), Math.ceil(c)])
            for (const row of [Math.floor(r), Math.ceil(r)])
              expect(Number.isFinite(covered.values[row * beyond.gridWidth + col])).toBe(false)
  })

  it('adds nothing where the terrain covers the whole frame', () => {
    const products = prepareSheetTerrainNow(frame(), {
      terrain: regional,
      contourBeyond: { source: regional, name: 'regional DEM' },
    })
    expect(products.contoursBeyond).toBeUndefined()
    expect(products.contours).toBeDefined()
  })

  it('draws the regional set dashed, with legend rows of its own after the terrain’s', () => {
    const f = frame()
    const products = prepareSheetTerrainNow(f, {
      terrain: detailed,
      contourBeyond: { source: regional, name: 'regional DEM' },
    })
    const sheet = composeSheet({
      ...sheetBase,
      frame: f,
      contours: products.contours,
      contoursBeyond: products.contoursBeyond,
    })
    const keys = sheet.legend.map((item) => item.key)
    const beyondRows = sheet.legend.filter((item) => item.key.startsWith('contourBeyond'))
    expect(beyondRows.length).toBeGreaterThan(0)
    expect(keys.indexOf('contourIntermediate')).toBeLessThan(keys.indexOf(beyondRows[0].key))
    expect(beyondRows.every((item) => item.symbol.label.includes(', regional DEM ('))).toBe(true)
    const dashed = sheet.ops.filter(
      (op) =>
        op.op === 'path' && op.stroke?.dash && op.stroke.color === BEYOND_CONTOUR_STYLES.default.intermediate.color,
    )
    expect(dashed.length).toBeGreaterThan(0)
  })

  it('masks every cell the terrain holds a height for', () => {
    const grid = { width: 2, height: 1, values: new Float32Array([5, 6]), cellSizeM: new Float64Array([1]) }
    expect([...beyondOnly(grid, new Float32Array([1, NaN])).values]).toEqual([NaN, 6])
    expect(beyondOnly(grid, undefined)).toBe(grid)
    expect(() => beyondOnly(grid, new Float32Array(3))).toThrow(/same cells/)
  })
})
