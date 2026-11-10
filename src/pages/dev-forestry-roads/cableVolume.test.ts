/**
 * Volume on the extraction grid and volume-weighted cable line selection, on synthetic ground.
 */
import { describe, expect, it } from 'vitest'
import { cableYardable, type CableLanding, type CableLineRecord } from './cableCoverage'
import { DEFAULT_CABLE_SELECTION, selectCableLines } from './cableLineSelection'
import { MAX_VOLUME_PER_HA, volumeFromSampler, volumeFromStands, volumeWeights } from './cableVolume'
import { runToCompletion } from './cooperative'
import { DEFAULT_EXTRACTION_SETTINGS, prepareExtractionGrid, type ExtractionGrid } from './extractionReach'
import { rasterSampler } from './volumeRasterImport'
import { parseVriVolume, vriVolumeQueryUrl } from './vriVolume'
import type { Coordinate } from './types'

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const ring = (x0: number, y0: number, x1: number, y1: number) =>
  (
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ] as [number, number][]
  ).map(toLonLat)

const eg: ExtractionGrid = runToCompletion(
  prepareExtractionGrid({
    block: { type: 'Polygon', coordinates: [ring(-150, 10, 150, 300)] },
    roads: [],
    ground: { elevationAt: () => 1000 },
    toGrid,
    toLonLat,
    settings: { ...DEFAULT_EXTRACTION_SETTINGS, machine: 'cable' },
    cellM: 10,
    offBlockM: 20,
  }),
)
const { origin, cellM, width } = eg.sg.grid
const centre = Math.round((origin[1] - 150) / cellM) * width + Math.round((0 - origin[0]) / cellM)
const landing: CableLanding = {
  cell: centre,
  xy: [origin[0] + (centre % width) * cellM, origin[1] - Math.floor(centre / width) * cellM],
  roadIndex: -1,
  designed: false,
}
const line = (id: number, bearingDeg: number): CableLineRecord => ({
  id,
  landing: 0,
  bearingDeg,
  horizontalM: 100,
  skylineM: 100,
  configuration: 'below',
  designedLanding: false,
  preTensionKN: 50,
  points: [
    { stationM: 0, groundM: 1000, heightM: 10, xy: landing.xy },
    { stationM: 100, groundM: 1000, heightM: 8, xy: landing.xy },
  ],
  cells: 1,
  areaHa: 0,
  meanCarriageM: 50,
})
// North along the volume's boundary, and east into the heavy timber: the same area each.
const lines = [line(1, 0), line(2, 90)]
const one = { ...DEFAULT_CABLE_SELECTION, maxLines: 1, minNewShare: 0.05 }
/** 600 m³/ha east of the landing, 100 west; none north of 250 m when `gap`. */
const sampler =
  (gap = false) =>
  (lon: number, lat: number) => {
    const [x, y] = toGrid([lon, lat])
    if (gap && y > 250) return NaN
    return x > 0 ? 600 : 100
  }

describe('volume-weighted line selection', () => {
  it('chooses by area alone by default, and by the volume of new ground when given one', () => {
    const byArea = selectCableLines(eg, [landing], lines, 20, one)
    expect(byArea.ids).toEqual([1])
    expect(byArea.volume).toBeNull()
    const weights = volumeWeights(eg, volumeFromSampler(eg, sampler(), 'test raster'), cableYardable(eg))
    const byVolume = selectCableLines(eg, [landing], lines, 20, one, weights)
    expect(byVolume.ids).toEqual([2])
    expect(byVolume.volume!.source).toBe('test raster')
    // East band: about 100 m × 40 m at 600 m³/ha, on cell centres.
    expect(byVolume.volume!.lines[2].knownM3).toBeGreaterThan(0.3 * 600)
    expect(byVolume.volume!.knownM3).toBeCloseTo(byVolume.volume!.lines[2].knownM3, 6)
    expect(byVolume.volume!.unknownHa).toBe(0)
  })

  it('weighs ground with no figure at the known mean and reports its area, never as volume', () => {
    const weights = volumeWeights(eg, volumeFromSampler(eg, sampler(true), 'gappy'), cableYardable(eg))
    expect(weights.unknownHa).toBeGreaterThan(0)
    expect(weights.meanPerHa!).toBeGreaterThan(100)
    expect(weights.meanPerHa!).toBeLessThan(600)
    const both = selectCableLines(eg, [landing], lines, 20, { ...one, maxLines: 2 }, weights)
    expect(both.ids).toContain(1)
    expect(both.volume!.lines[1].unknownHa).toBeGreaterThan(0)
    expect(() =>
      volumeWeights(
        eg,
        volumeFromSampler(eg, () => NaN, 'empty'),
        cableYardable(eg),
      ),
    ).toThrow(/no volume over the block/)
  })

  it('rasterizes inventory polygons, keeping polygons without a figure unknown', () => {
    const v = volumeFromStands(
      eg,
      [
        { geometry: { type: 'Polygon', coordinates: [ring(0, 0, 200, 320)] }, volumePerHa: 400 },
        { geometry: { type: 'Polygon', coordinates: [ring(-200, 0, 0, 320)] }, volumePerHa: null },
        { geometry: { type: 'Polygon', coordinates: [ring(5000, 5000, 5100, 5100)] }, volumePerHa: 900 },
      ],
      'VRI',
    )
    const at = (x: number, y: number) =>
      v.perHa[Math.round((origin[1] - y) / cellM) * width + Math.round((x - origin[0]) / cellM)]
    expect(at(100, 100)).toBe(400)
    expect(at(-100, 100)).toBeNaN()
    // Implausible figures are missing, not volume.
    const wild = volumeFromSampler(eg, () => MAX_VOLUME_PER_HA + 1, 'wild')
    expect(wild.perHa.every((x) => Number.isNaN(x))).toBe(true)
  })

  it('samples a raster by nearest pixel from its top-left corner', () => {
    const sample = rasterSampler(
      { origin: [0, 20], pixelSize: [10, -10], width: 2, height: 2, values: Float32Array.from([1, 2, 3, NaN]) },
      (c) => c,
    )
    expect(sample(5, 15)).toBe(1)
    expect(sample(15, 15)).toBe(2)
    expect(sample(5, 5)).toBe(3)
    expect(sample(15, 5)).toBeNaN()
    expect(sample(25, 5)).toBeNaN()
  })

  it('asks DataBC for VRI volume with the box in the CQL filter, longitude first', () => {
    const url = new URL(vriVolumeQueryUrl([-122.6, 54.1, -122.5, 54.2]))
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-122.6,54.1,-122.5,54.2,'EPSG:4326')")
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('propertyName')).toBe('FEATURE_ID,LIVE_STAND_VOLUME_125,GEOMETRY')
    const parsed = parseVriVolume({
      features: [
        { geometry: { type: 'Polygon', coordinates: [] }, properties: { LIVE_STAND_VOLUME_125: 312.5 } },
        { geometry: { type: 'Polygon', coordinates: [] }, properties: { LIVE_STAND_VOLUME_125: null } },
        { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      ],
      numberMatched: 2,
    })
    expect(parsed.stands.map((s) => s.volumePerHa)).toEqual([312.5, null])
    expect(parsed.truncated).toBe(false)
  })
})
