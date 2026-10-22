import JSZip from 'jszip'
import shp from 'shpjs'
import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { roadShapefileLayers } from './designExports'
import { writeDbf, writeShapefile } from './shapefile'
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

  it('truncates long text by bytes on a character boundary and leaves unknown numbers blank', () => {
    const bytes = writeDbf(
      [
        { name: 'NAME', type: 'C', length: 5 },
        { name: 'VALUE', type: 'N', length: 6, decimals: 1 },
      ],
      [{ NAME: 'ééé', VALUE: null }],
    )
    const record = bytes.slice(32 + 64 + 1, 32 + 64 + 1 + 12)
    expect(new TextDecoder().decode(record.slice(1, 6))).toBe('éé ')
    expect(new TextDecoder().decode(record.slice(6, 12))).toBe('      ')
    expect(() => writeDbf([{ name: 'lower', type: 'C', length: 2 }], [])).toThrow()
  })
})
