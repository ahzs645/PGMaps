import { describe, expect, it } from 'vitest'
import {
  readScanfi,
  scanfiAt,
  scanfiCellCentre,
  scanfiUrl,
  scanfiWindow,
  SCANFI_ORIGIN,
  type ScanfiTiff,
} from './scanfi'

const fake =
  (origin = SCANFI_ORIGIN, cell = 30) =>
  async (): Promise<ScanfiTiff> => ({
    getImage: async () => ({
      getOrigin: () => [...origin, 0],
      getResolution: () => [cell, -cell, 0],
      readRasters: async ({ window: [x0, y0, x1, y1] }) => {
        const out = new Uint8Array((x1 - x0) * (y1 - y0))
        for (let r = y0; r < y1; r++)
          for (let c = x0; c < x1; c++)
            out[(r - y0) * (x1 - x0) + (c - x0)] = (c + r) % 7 === 0 ? 255 : (c * 3 + r) % 40
        return out
      },
    }),
  })

describe('SCANFI v2', () => {
  it('names the published files', () => {
    expect(scanfiUrl('height', 2025)).toBe(
      'https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/SCANFI_att_height_2025_v2_20260119.tif',
    )
    expect(scanfiUrl('lodgepolePine', 2015)).toMatch(/SCANFI_spsCC_lodgepolePine_2015_v2_20260119\.tif$/)
    expect(scanfiUrl('age', 2020)).toMatch(/SCANFI_age_median_2020_v2_20260119\.tif$/)
  })

  it('reads a window, keeps cells on the national grid and turns 255 into no data', async () => {
    const box: [number, number, number, number] = [-122.83, 53.88, -122.78, 53.92]
    const grid = await readScanfi('height', 2025, box, fake())
    const win = scanfiWindow(box)
    expect(grid).toMatchObject(win)
    // About 3.3 km × 4.4 km of 30 m cells, plus the LCC grid's turn.
    expect(grid.width).toBeGreaterThan(100)
    expect(grid.height).toBeGreaterThan(140)
    for (let r = 0; r < grid.height; r += 11)
      for (let c = 0; c < grid.width; c += 7) {
        const gc = grid.col0 + c,
          gr = grid.row0 + r
        const expected = (gc + gr) % 7 === 0 ? NaN : (gc * 3 + gr) % 40
        const [lon, lat] = scanfiCellCentre(grid, c, r)
        expect(scanfiAt(grid, lon, lat)).toEqual(expected)
      }
    expect(scanfiAt(grid, -110, 54)).toBeNaN()
  })

  it('refuses a file that is not on the SCANFI grid', async () => {
    await expect(readScanfi('height', 2025, [-122.83, 53.88, -122.78, 53.92], fake([0, 0]))).rejects.toThrow(
      /not on the SCANFI v2 grid/,
    )
  })
})
