import { describe, expect, it } from 'vitest'
import { syntheticTerrain } from './blockSheetFixtures'
import { sheetNeeds } from './buildSheet'
import { sheetFocus, sheetFrame } from './composeSheet'
import { paintPublishedRaster, prepareSheetTerrainNow, type PublishedRaster } from './prepareSheet'
import { SHEET_PREVIEW_DPI } from './buildSheet'

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
/** Red west of a meridian, clear between it and a second one, nothing east of that. */
const published = (clearFrom: number, nothingFrom: number): PublishedRaster => ({
  sample(lng, _lat, out, offset) {
    if (lng >= nothingFrom) return false
    if (lng < clearFrom) out.set([200, 10, 10, 255], offset)
    return true
  },
  source: 'Slope classes as published on Sheet.pdf',
  legend: [{ kind: 'class', label: '20 - 30', color: '#ffff73', opacity: 1 }],
})
const drain = <T>(steps: Generator<number, T>) => {
  let next = steps.next()
  const yields: number[] = []
  while (!next.done) {
    yields.push(next.value)
    next = steps.next()
  }
  return { value: next.value, yields }
}

describe('a sheet raster someone already published', () => {
  it('is painted on the frame, row 0 at the north edge, and reports the share it covers', () => {
    // A box one degree of longitude wide at the equator, 4 × 32 cells.
    const { value, yields } = drain(paintPublishedRaster(published(0.25, 0.75), [0, -111319.49, 111319.49, 0], 4, 32))
    expect(yields).toEqual([16, 32])
    expect(value.coveredShare).toBe(0.75)
    expect([...value.data.subarray(0, 16)]).toEqual([200, 10, 10, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => drain(paintPublishedRaster(published(0, 0), [0, 0, 1, 1], 1, 1))).toThrow(/4 to/)
  })

  it('stands in for the terrain a slope sheet needs, with its own legend, and keeps the terrain for contours', () => {
    const frame = sheetFrame('lidar-slope', 'tabloid', 10000, { bounds: sheetFocus({ block })! })
    expect(sheetNeeds('lidar-slope', {})).toBe('terrain')
    expect(sheetNeeds('lidar-slope', { published: { slope: published(0, 0) } })).toBeNull()
    // A published hillshade does not make the slope sheet available.
    expect(sheetNeeds('lidar-slope', { published: { hillshade: published(0, 0) } })).toBe('terrain')
    const products = prepareSheetTerrainNow(
      frame,
      { terrain: syntheticTerrain, published: { slope: published(-121.525, 0) } },
      SHEET_PREVIEW_DPI,
    )
    expect(products.base?.legend?.map((entry) => entry.label)).toEqual(['20 - 30'])
    expect(products.published).toEqual({ source: 'Slope classes as published on Sheet.pdf', coveredShare: 1 })
    expect(products.missing).toEqual([])
    expect(products.contours?.result).toBeDefined()
    const data = (products.base!.image as { data: Uint8ClampedArray }).data
    expect([...data.subarray(0, 4)]).toEqual([200, 10, 10, 255])
    expect([...data.subarray(data.length - 4)]).toEqual([0, 0, 0, 0])
    // Without the published raster the same sheet is worked out from the terrain.
    expect(prepareSheetTerrainNow(frame, { terrain: syntheticTerrain }, SHEET_PREVIEW_DPI).published).toBeUndefined()
  })

  it('says how much of the frame it covers when it does not cover it all', () => {
    const frame = sheetFrame('lidar-slope', 'tabloid', 10000, { bounds: sheetFocus({ block })! })
    const partial = prepareSheetTerrainNow(
      frame,
      { published: { slope: published(-180, -121.525) } },
      SHEET_PREVIEW_DPI,
    )
    expect(partial.missing.join(' ')).toMatch(
      /The imported sheet covers \d+% of the map frame; the rest of the frame prints without it\./,
    )
    expect(partial.missing.join(' ')).toMatch(/no contours/)
    const empty = prepareSheetTerrainNow(frame, { published: { slope: published(-180, -180) } }, SHEET_PREVIEW_DPI)
    expect(empty.missing[0]).toBe('The imported sheet holds nothing inside the map frame.')
  })
})
