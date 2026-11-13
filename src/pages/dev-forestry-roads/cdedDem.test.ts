import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { cdedFromDownload, cdedTileAt, cdedTilesFor, cdedWindow, parseCdedDem } from './cdedDem'

/** A USGS-format ASCII DEM as BC writes CDED: geographic arc-seconds, metres, 1,024-byte records. */
function demFile(west: number, south: number, cols: number, rows: number, z: (c: number, r: number) => number) {
  const pad = (text: string, width: number) => text.padStart(width)
  const d = (value: number) => pad(value.toExponential(15).replace('e', 'D'), 24)
  const e = (value: number) => pad(value.toExponential(6), 12)
  const header = Array(1024).fill(' ')
  const put = (at: number, text: string) => [...text].forEach((ch, i) => (header[at + i] = ch))
  put(0, 'test sheet')
  put(156, pad('0', 6))
  put(528, pad('3', 6))
  put(534, pad('2', 6))
  put(816, e(0.75) + e(0.75) + e(1))
  put(852, pad('1', 6) + pad(String(cols), 6))
  put(888, pad('1', 2))
  let out = header.join('')
  for (let c = 0; c < cols; c++) {
    const values = Array.from({ length: rows }, (_, r) => pad(String(Math.round(z(c, r))), 6))
    let record =
      pad('1', 6) +
      pad(String(c + 1), 6) +
      pad(String(rows), 6) +
      pad('1', 6) +
      d((west + (c * 0.75) / 3600) * 3600) +
      d(south * 3600) +
      d(0) +
      d(0) +
      d(0)
    record += values.splice(0, 146).join('')
    out += record.padEnd(1024)
    while (values.length) out += values.splice(0, 170).join('').padEnd(1024)
  }
  return new TextEncoder().encode(out)
}

describe('BC CDED tiles and files', () => {
  it('names the half-sheet under a point from the NTS grid', () => {
    // The sheet tested by hand on 2026-11-12: lon −121.75 to −121.5, lat 54 to 54.25.
    expect(cdedTileAt([-121.55, 54.07])).toEqual({
      name: '093i04_e',
      url: 'https://pub.data.gov.bc.ca/datasets/175624/93i/093i04_e.dem.zip',
    })
    expect(cdedTileAt([-121.45, 54.07]).name).toBe('093i03_w')
    expect(cdedTileAt([-122.8, 53.92]).name).toBe('093g15_w')
    expect(cdedTileAt([-123.1, 49.3]).name).toBe('092g06_e')
    expect(
      cdedTilesFor([
        [-121.6, 54.05],
        [-121.4, 54.1],
      ]).map((t) => t.name),
    ).toEqual(['093i04_e', '093i03_w'])
  })

  it('reads posts, continuation blocks and voids from a DEM, zipped or not', () => {
    const bytes = demFile(-121.75, 54, 3, 200, (c, r) => (c === 1 && r === 150 ? -32767 : 900 + c * 10 + r))
    const grid = parseCdedDem(bytes, 'x.dem')
    expect([grid.cols, grid.rows, grid.west, grid.south]).toEqual([3, 200, -121.75, 54])
    expect(grid.dx).toBeCloseTo(0.75 / 3600, 12)
    expect(grid.columns[0][0]).toBe(900)
    expect(grid.columns[2][199]).toBe(900 + 20 + 199)
    expect(grid.columns[1][150]).toBeNull()
    expect(grid.verticalDatumCode).toBe(1)
    const zipped = zipSync({ 'x.dem': bytes })
    expect(cdedFromDownload(zipped, 'x.dem.zip').columns[2][199]).toBe(1119)
    expect(() => parseCdedDem(new Uint8Array(4096).fill(32), 'bad.dem')).toThrow(/not a geographic DEM/)
  })

  it('crops an area to a WGS84 road terrain whose posts keep their places', async () => {
    const step = 0.75 / 3600
    const bytes = demFile(-121.75, 54, 60, 60, (c, r) => 800 + c + r * 100)
    const grid = parseCdedDem(bytes, 'x.dem')
    const area = { coordinates: [[-121.75 + 20 * step, 54 + 30 * step]] as [number, number][], bufferM: 0 }
    const loaded = await cdedWindow([grid], area, [bytes])
    const raster = loaded.metadata.raster!
    // One post beyond the point on every side: columns 19–21, rows 29–31, north row first.
    expect([raster.epsg, raster.width, raster.height]).toEqual([4326, 3, 3])
    expect(raster.values).toEqual([3919, 3920, 3921, 3819, 3820, 3821, 3719, 3720, 3721])
    expect(raster.origin[0]).toBeCloseTo(-121.75 + 19 * step, 10)
    expect(raster.origin[1]).toBeCloseTo(54 + 31 * step, 10)
    expect(loaded.source.elevationAt(-121.75 + 20 * step, 54 + 30 * step)).toBeCloseTo(3820, 3)
    expect(loaded.coveragePercent).toBe(100)
    expect(loaded.metadata.verticalReference).toMatch(/^CGVD28/)
    await expect(cdedWindow([grid], { coordinates: [[-120, 55]], bufferM: 0 }, [bytes])).rejects.toThrow(
      /has elevations in this area/,
    )
  })
})
