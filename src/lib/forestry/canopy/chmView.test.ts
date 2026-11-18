import { describe, expect, it } from 'vitest'
import {
  canopyClassOf,
  canopyPicture,
  canopyQuad,
  chmImageryDates,
  chmOverviewFor,
  corridorSummary,
  stationBounds,
} from './chmView'
import { mercatorLonLat, mercatorPixel, type CanopyGrid } from './metaChm'
import type { CorridorStation } from './corridor'

// The 093G086 LiDAR tile at Prince George; nothing here is a licensee's block.
const PG: [number, number] = [-122.81, 53.89]

/** A full-resolution grid round a point, filled by `value(dxM, dyM)` from its centre. */
function grid(value: (dxM: number, dyM: number) => number, halfM = 150): CanopyGrid {
  const zoom = 25
  const cellM = (40_075_016.685_578_49 / 2 ** zoom) * Math.cos((PG[1] * Math.PI) / 180)
  const [cx, cy] = mercatorPixel(PG[0], PG[1], zoom)
  const half = Math.ceil(halfM / cellM)
  const x0 = Math.floor(cx) - half,
    y0 = Math.floor(cy) - half
  const width = 2 * half,
    height = 2 * half
  const data = new Uint8Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      data[r * width + c] = value((x0 + c + 0.5 - cx) * cellM, (cy - (y0 + r + 0.5)) * cellM)
  return { zoom, x0, y0, width, height, data, cellM, sources: [] }
}

describe('canopy layer', () => {
  it('reads coarser overviews for wider views', () => {
    expect(chmOverviewFor([-122.82, 53.88, -122.81, 53.89])).toBe(0)
    // About 0.5° wide: 46,600 full-resolution columns, so the 32× overview (1,456).
    expect(chmOverviewFor([-123.1, 53.7, -122.6, 54.0])).toBe(5)
    expect(chmOverviewFor([-130, 50, -120, 58])).toBe(6)
  })

  it('classes heights as the block sheet does and leaves under 5 m clear', () => {
    expect(canopyClassOf(5)?.label).toBe('< 5')
    expect(canopyClassOf(5.1)?.label).toBe('5 - 10')
    expect(canopyClassOf(40)?.label).toBe('35 - 40')
    expect(canopyClassOf(41)?.label).toBe('40 +')
    const g: CanopyGrid = {
      zoom: 25,
      x0: 0,
      y0: 0,
      width: 3,
      height: 1,
      data: Uint8Array.from([0, 4, 12]),
      cellM: 1,
      sources: [],
    }
    expect(Array.from(canopyPicture(g))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0x4c, 0xe6, 0x00, 255])
  })

  it('places the picture on its Mercator cells', () => {
    const g = grid(() => 0)
    const [tl, tr, br, bl] = canopyQuad(g)
    expect(tl).toEqual(mercatorLonLat(g.x0, g.y0, 25))
    expect(br).toEqual(mercatorLonLat(g.x0 + g.width, g.y0 + g.height, 25))
    expect(tr[1]).toBe(tl[1])
    expect(bl[0]).toBe(tl[0])
  })

  it('spans the imagery dates of every listed tile under a box', () => {
    const dates = {
      fields: [],
      tiles: { '0212102012': ['2012-06-01', '2018-08-02', 4] as [string, string, number] },
    }
    expect(chmImageryDates([-122.82, 53.88, -122.81, 53.89], dates)).toEqual({
      from: '2012-06-01',
      to: '2018-08-02',
      tiles: 1,
      listed: 1,
    })
    expect(chmImageryDates([-110, 50, -109.9, 50.1], dates)).toBeNull()
  })

  it('pads a road box by the margin', () => {
    const [w, s, e, n] = stationBounds([PG, [PG[0] + 0.01, PG[1] + 0.01]], 100)
    expect((PG[1] - s) * 111_320).toBeCloseTo(100, 3)
    expect((n - PG[1] - 0.01) * 111_320).toBeCloseTo(100, 3)
    expect(w).toBeLessThan(PG[0])
    expect(e).toBeGreaterThan(PG[0] + 0.01)
  })
})

describe('corridorSummary', () => {
  // A north-running road through 20 m timber, with a 4 m-wide trail down its centre from 0+040 to 0+100.
  const stations: CorridorStation[] = Array.from({ length: 15 }, (_, i) => {
    const chainage = i * 10 - 70
    return {
      chainage: chainage + 70,
      coordinate: [PG[0], PG[1] + chainage / 111_320] as [number, number],
      bearing: 0,
      leftClearingM: 8,
      rightClearingM: 12,
    }
  })
  const canopy = grid((dx, dy) => (Math.abs(dx) <= 2 && dy >= -30 && dy <= 30 ? 0 : 20))

  it('reads timber in the clearing, reaching trees and a centreline gap', () => {
    const s = corridorSummary(stations, canopy)
    expect(s.stations).toBe(15)
    expect(s.sampledStations).toBe(15)
    // 20 m clearing × 140 m.
    expect(s.clearingAreaM2).toBeCloseTo(2800, 6)
    // Timber everywhere except the trail's 5 cells of 21 across, on 7 of 15 stations.
    expect(s.clearingTimberShare!).toBeGreaterThan(0.85)
    expect(s.clearingTimberShare!).toBeLessThan(0.95)
    // 20 m trees within 23 m of the running surface's edge reach it at every station.
    expect(s.reachingStations).toBe(15)
    expect(s.tallestReaching!.heightM).toBe(20)
    expect(s.gaps).toEqual([{ fromM: 40, toM: 100 }])
  })
})
