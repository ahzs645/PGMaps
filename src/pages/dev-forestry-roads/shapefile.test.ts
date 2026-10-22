import JSZip from 'jszip'
import shp from 'shpjs'
import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { roadShapefileLayers } from './designExports'
import { encodeDbf, type ShapeLayer, writeDbf, writeShapefile, writeShapefileLayer } from './shapefile'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const road: Alignment = {
  id: 'r',
  name: 'Spur road · été',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 45, 300), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const analysis = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)

describe('shapefile export', () => {
  it('writes layers that a shapefile reader parses back with their geometry and attributes', async () => {
    const zip = new JSZip()
    for (const layer of roadShapefileLayers([road], new Map([[road.id, analysis]]), road.id))
      for (const [name, bytes] of Object.entries(writeShapefile(layer))) zip.file(name, bytes)
    const parsed = (await shp(await zip.generateAsync({ type: 'arraybuffer' }))) as Array<
      GeoJSON.FeatureCollection & { fileName: string }
    >
    const lines = parsed.find((layer) => layer.fileName === 'road_centrelines')!
    expect(lines.features).toHaveLength(1)
    const feature = lines.features[0]
    expect(feature.geometry.type).toBe('LineString')
    const coordinates = (feature.geometry as GeoJSON.LineString).coordinates
    expect(coordinates[0][0]).toBeCloseTo(origin[0], 9)
    expect(coordinates[0][1]).toBeCloseTo(origin[1], 9)
    expect(feature.properties!.NAME).toBe('Spur road · été')
    expect(feature.properties!.LENGTH_M).toBeCloseTo(300, 1)
    const stations = parsed.find((layer) => layer.fileName === 'road_stations')!
    expect(stations.features).toHaveLength(analysis.stations.length)
    expect(stations.features[3].properties!.STATION_M).toBeCloseTo(analysis.stations[3].chainage, 2)
    expect(stations.features[3].geometry.type).toBe('Point')
  })

  it('cuts text past 254 bytes on a character boundary and leaves unknown numbers blank', () => {
    // 'é' is two bytes: 128 of them (256 bytes) keep 127 (254 bytes).
    const { bytes, fields, warnings } = encodeDbf(
      [
        { name: 'NAME', type: 'C', length: 5 },
        { name: 'VALUE', type: 'N', length: 6, decimals: 1 },
      ],
      [{ NAME: 'é'.repeat(128), VALUE: null }],
    )
    expect(fields.map((f) => f.length)).toEqual([254, 6])
    const record = bytes.slice(32 + 64 + 1, 32 + 64 + 1 + 1 + 254 + 6)
    expect(new TextDecoder().decode(record.slice(1, 255))).toBe('é'.repeat(127))
    expect(new TextDecoder().decode(record.slice(255, 261))).toBe('      ')
    expect(warnings).toEqual(['NAME: text cut to 254 bytes in 1 record, the most a dBase field can hold.'])
    expect(writeDbf(fields, [])).toBeInstanceOf(Uint8Array)
    expect(() => writeDbf([{ name: 'lower', type: 'C', length: 2 }], [])).toThrow()
  })

  it('widens fields to their data and warns about any value that still does not fit', async () => {
    const layer: ShapeLayer = {
      name: 'wide',
      type: 'point',
      fields: [
        { name: 'NAME', type: 'C', length: 5 },
        { name: 'COST_CAD', type: 'N', length: 6, decimals: 0 },
        { name: 'LEVEL_M', type: 'N', length: 6, decimals: 2 },
        { name: 'FLAGS', type: 'C', length: 10 },
      ],
      features: [
        { point: origin, attributes: { NAME: 'Spur road · été', COST_CAD: 12_345_678, LEVEL_M: -0.001, FLAGS: 'x' } },
        { point: origin, attributes: { NAME: 'B', COST_CAD: 1e20, LEVEL_M: 812.25, FLAGS: 'y'.repeat(300) } },
        { point: origin, attributes: { NAME: 'C', COST_CAD: null, LEVEL_M: Number.NaN, FLAGS: null } },
      ],
    }
    const { files, warnings } = writeShapefileLayer(layer)
    expect(writeShapefile(layer)['wide.dbf']).toEqual(files['wide.dbf'])
    const zip = new JSZip()
    for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes)
    const parsed = (await shp(await zip.generateAsync({ type: 'arraybuffer' }))) as GeoJSON.FeatureCollection
    const [a, b, c] = parsed.features.map((f) => f.properties!)
    // Text and numbers wider than their declared field are kept whole.
    expect(a.NAME).toBe('Spur road · été')
    expect(a.COST_CAD).toBe(12_345_678)
    // -0.001 to two decimals is 0, never "-0.00".
    expect(a.LEVEL_M).toBe(0)
    expect(new TextDecoder().decode(files['wide.dbf'])).not.toContain('-0.00')
    expect(b.LEVEL_M).toBe(812.25)
    // 1e20 needs 21 characters, past the 19 a dBase number holds; FLAGS stops at 254 bytes.
    expect(b.COST_CAD).not.toBe(1e20)
    expect(b.FLAGS).toBe('y'.repeat(254))
    expect(c.COST_CAD == null || Number.isNaN(c.COST_CAD)).toBe(true)
    expect(warnings).toEqual([
      'wide COST_CAD: left blank in 1 record; the number is wider than a dBase field can hold.',
      'wide FLAGS: text cut to 254 bytes in 1 record, the most a dBase field can hold.',
    ])
  })

  it('exports the road layers without warnings', () => {
    for (const layer of roadShapefileLayers([road], new Map([[road.id, analysis]]), road.id))
      expect(writeShapefileLayer(layer).warnings).toEqual([])
  })
})
