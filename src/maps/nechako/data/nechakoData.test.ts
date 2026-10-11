import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { EMPTY_WORKSPACE, geographicArea, importWorkspace, nativeVector, normalizeGeojson } from './workspace'
import { checkedCsv, csvExport, normalizeMonitoring, parseTimestamp, summarize } from './monitoring'
import { processGeometry } from '../PortalVectors'

const point = {
  type: 'Feature',
  id: 'source-17',
  properties: { station: 'A', zero: 0, missing: null },
  geometry: { type: 'Point', coordinates: [-124, 54, 713] },
} as const
const polygon = (west: number, south: number, east: number, north: number): GeoJSON.Feature<GeoJSON.Polygon> => ({
  type: 'Feature',
  properties: { site: 'test geometry' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  },
})

describe('Nechako geometry and workspace transport', () => {
  it('preserves IDs, source properties, elevation and null geometry', () => {
    const data = normalizeGeojson({
      type: 'FeatureCollection',
      features: [point, { ...point, id: 18, geometry: null }],
    })
    expect(data.features[0]).toEqual(point)
    expect(data.features[1].geometry).toBeNull()
  })
  it('reprojects BC Albers and Web Mercator using supplied CRS', () => {
    for (const crs of ['EPSG:3005', 'EPSG:3857']) {
      const projected = proj4('EPSG:4326', crs, [-124, 54])
      const value = normalizeGeojson({ ...point, geometry: { type: 'Point', coordinates: [...projected, 713] } }, crs)
      const geometry = value.features[0].geometry as GeoJSON.Point
      expect(geometry.coordinates[0]).toBeCloseTo(-124, 6)
      expect(geometry.coordinates[1]).toBeCloseTo(54, 6)
      expect(geometry.coordinates[2]).toBe(713)
    }
  })
  it('rejects invalid nesting, open rings, missing CRS and invalid coordinates', () => {
    expect(() => normalizeGeojson({ ...point, geometry: { type: 'Point', coordinates: [800000, 900000] } })).toThrow(
      'CRS',
    )
    expect(() =>
      normalizeGeojson({
        ...point,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          ],
        },
      }),
    ).toThrow('closed')
    expect(() => normalizeGeojson({ ...point, geometry: { type: 'LineString', coordinates: [[0, 0]] } })).toThrow('two')
    expect(() => normalizeGeojson({ ...point, geometry: { type: 'Point', coordinates: [NaN, 0] } })).toThrow(
      'invalid coordinate',
    )
    expect(() => normalizeGeojson(point, 'EPSG:9999')).toThrow('Unsupported CRS')
  })
  it('round trips a local workspace and rejects malformed or credentialed sources', () => {
    const workspace = {
      ...EMPTY_WORKSPACE,
      vectors: [{ id: 'vector-a', name: 'Stations', color: '#0f766e', visible: false, data: normalizeGeojson(point) }],
    }
    expect(importWorkspace(JSON.parse(JSON.stringify(workspace)))).toMatchObject(workspace)
    expect(() => importWorkspace({ ...workspace, camera: { ...workspace.camera, zoom: Infinity } })).toThrow('zoom')
    expect(() => importWorkspace({ ...workspace, vectors: [...workspace.vectors, ...workspace.vectors] })).toThrow(
      'unique',
    )
    expect(() =>
      importWorkspace({
        ...workspace,
        tiles: [{ id: 'a', name: 'Tile', urls: ['https://user:password@example.com/{z}'], attribution: 'Source' }],
      }),
    ).toThrow('credentials')
  })
  it('converts actual native project field names and retains unsupported sources', () => {
    const native = {
      coordinates: [-124, 54],
      scale: 100000,
      layers: [
        {
          sourceType: 'Vector',
          checked: false,
          legendName: 'Station',
          layerData: JSON.stringify(normalizeGeojson(point)),
          schemaId: 7,
          portalSld: 'original.sld',
        },
        {
          sourceType: 'WMS',
          checked: true,
          legendName: 'Watershed',
          urls: ['https://example.com/wms?map=source.qgs'],
          params: { LAYERS: 'main map', STYLES: 'native' },
        },
        { sourceType: 'WMS', legendName: 'Private', src: { submissionId: 9 } },
        { sourceType: 'BingMaps', legendName: 'Old basemap' },
      ],
    }
    const result = importWorkspace({ attributes: native })
    expect(result.vectors[0]).toMatchObject({ name: 'Station', visible: false, original: native.layers[0] })
    expect(result.layers[0]).toMatchObject({ style: 'native', layer: { name: 'main map' } })
    expect(result.camera.zoom).toBeCloseTo(Math.log2(40075016.68557849 / ((512 * 100000) / (96 * 39.37))), 7)
    expect(result.warnings.join(' ')).toContain('authorized layer endpoint')
    expect(result.originalProject).toEqual({ attributes: native })
  })
  it('converts the native vector wrapper and typed attribute matrix without bigint precision loss', () => {
    const input = {
      geojson: JSON.stringify(normalizeGeojson(point)),
      Attributes: {
        attributes: ['temperature', 'large_id', 'notes'],
        type: ['double precision', 'bigint', 'text'],
        rows: [['7.25', '9007199254740993', '']],
      },
      stylizeParams: { mode: 'SINGLE' },
    }
    const output = nativeVector(JSON.stringify(input))
    expect(output.data.features[0].properties).toMatchObject({
      temperature: 7.25,
      large_id: '9007199254740993',
      notes: null,
    })
    expect(output.warnings.join(' ')).toContain('precision loss')
    expect(() => nativeVector({ ...input, Attributes: { ...input.Attributes, rows: [] } })).toThrow('matrix')
  })
  it('sends a closed EPSG:4326 polygon with the native nested area contract', () => {
    const area = geographicArea([-126, 52, -122, 56])
    const data = JSON.parse(area.geojson)
    expect(data.crs.properties.name).toBe('EPSG:4326')
    expect(data.features[0].geometry.coordinates[0]).toHaveLength(5)
    expect(() => geographicArea([170, -10, -170, 10])).toThrow('date line')
  })
  it('buffers, clips, intersects, unions, subtracts and splits without altering inputs', () => {
    const a = polygon(-125, 53, -124, 54),
      b = polygon(-124.5, 53.5, -123.5, 54.5),
      saved = JSON.stringify(a)
    for (const operation of ['buffer', 'union', 'intersection', 'difference', 'clip'] as const)
      expect(processGeometry(a, b, operation, 100).features.length).toBe(1)
    expect(JSON.stringify(a)).toBe(saved)
    const line: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: { station: 7 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-125, 54],
          [-123, 54],
        ],
      },
    }
    const cutter: GeoJSON.Feature<GeoJSON.LineString> = {
      ...line,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-124, 53],
          [-124, 55],
        ],
      },
    }
    expect(processGeometry(line, cutter, 'split-line', 0).features).toHaveLength(2)
    const areaCutter: GeoJSON.Feature<GeoJSON.LineString> = {
      ...line,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-124.5, 52.5],
          [-124.5, 54.5],
        ],
      },
    }
    expect(processGeometry(a, areaCutter, 'split-polygon', 0).features).toHaveLength(2)
    expect(processGeometry(line, b, 'clip', 0).features).toHaveLength(1)
    expect(processGeometry(normalizeGeojson(point).features[0], b, 'clip', 0).features).toHaveLength(1)
    expect(() => processGeometry(a, b, 'buffer', -1)).toThrow('distance')
    expect(() => processGeometry(line, b, 'union', 0)).toThrow('polygon')
  })
})

describe('monitoring and bibliographic quality', () => {
  it('reads quoted newlines, BOM and all columns; rejects duplicate headers and broken rows', () => {
    expect(checkedCsv('\uFEFFTitle,DOI\n"A, river\nreport",10.1/test').records[0].Title).toBe('A, river\nreport')
    expect(() => checkedCsv('a,a\n1,2')).toThrow('unique')
    expect(() => checkedCsv('a,b\n1')).toThrow('column counts')
    expect(() => checkedCsv('a,b\n"broken,2')).toThrow('unclosed')
  })
  it('uses explicit offsets and validates calendar dates and DST ambiguity', () => {
    expect(parseTimestamp('2026-01-01 12:00:00', '-08:00')).toBe(Date.parse('2026-01-01T20:00:00Z'))
    expect(parseTimestamp('2026-01-01T12:00:00+02:00', 'America/Vancouver')).toBe(Date.parse('2026-01-01T10:00:00Z'))
    expect(parseTimestamp('2026-07-01 12:00:00', 'America/Vancouver')).toBe(Date.parse('2026-07-01T19:00:00Z'))
    expect(() => parseTimestamp('2025-11-02 01:30:00', 'America/Vancouver')).toThrow('Ambiguous')
    expect(() => parseTimestamp('2025-03-09 02:30:00', 'America/Vancouver')).toThrow('nonexistent')
    expect(() => parseTimestamp('2026-02-30 12:00', 'UTC')).toThrow('calendar')
    expect(() => parseTimestamp('2026-01-01 12:00', 'embedded')).toThrow('offset')
  })
  it('retains missing measurements and duplicates, reports source row errors and computes numeric statistics', () => {
    const records = checkedCsv(
      'time,site,temp,level\n2026-01-01T00:00Z,A,0,1\n2026-01-01T00:00Z,A,,2\ninvalid,A,9,3\n2026-01-02T00:00Z,B,not-number,3',
    ).records
    const result = normalizeMonitoring(records, {
      timestamp: 'time',
      station: 'site',
      primary: 'temp',
      secondary: 'level',
      primaryUnit: 'C',
      secondaryUnit: 'm',
      timezone: 'embedded',
    })
    expect(result.observations.map((item) => item.primary)).toEqual([0, null])
    expect(result.duplicates).toBe(1)
    expect(result.errors.map((item) => item.row)).toEqual([4, 5])
    expect(summarize([0, 2, null])).toEqual({ count: 2, min: 0, max: 2, mean: 1 })
    expect(summarize([])).toEqual({ count: 0, min: null, max: null, mean: null })
  })
  it('exports multiline/quoted cells and guards spreadsheet formulas while keeping negative numbers numeric', () => {
    const exported = csvExport(
      ['title', 'value'],
      [
        ['=WEBSERVICE("url")', -2],
        ['a\nb', null],
      ],
    )
    expect(exported).toContain("'=WEBSERVICE")
    expect(exported).toContain('"-2"')
    expect(checkedCsv(exported).records[1]).toEqual({ title: 'a\nb', value: '' })
  })
})
