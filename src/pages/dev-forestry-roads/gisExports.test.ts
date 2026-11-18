import { strFromU8, unzipSync } from 'fflate'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { encodePng } from '@/lib/mapSheet/png'
import { analyzeRoad, offsetCoordinate } from './engine'
import { exportRoads } from './exportCatalog'
import {
  KMZ_DOT_ICON,
  kmzDotIcon,
  roadGeoPackage,
  roadGisLayers,
  roadGisNotice,
  roadGisPreview,
  roadKmz,
  type RoadGisInput,
} from './gisExports'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate, RoadAnalysis } from './types'

const origin: Coordinate = [-122.75, 53.91]
const road = (id: string, name: string, color: string, bearing: number): Alignment => ({
  id,
  name,
  color,
  points: [
    { id: `${id}a`, coordinate: origin, radiusM: 0 },
    { id: `${id}b`, coordinate: offsetCoordinate(origin, bearing, 400), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})
// The main road is stationed from 1+000, so its labels are not its chainage.
const main: Alignment = {
  ...road('main', 'Main line', '#d97706', 60),
  stationing: { startStation: 1000, equations: [] },
}
const spur = road('spur', 'Spur 2', '#2563eb', 120)
const analysed = (alignment: Alignment) => analyzeRoad(alignment, { elevationAt: () => 760 }, DEFAULT_ROAD_SETTINGS)
const mainAnalysis = analysed(main)
// One culvert on the main road, as the engineering run reports it.
const withCulvert = {
  ...mainAnalysis,
  engineering: {
    ...mainAnalysis.engineering,
    culverts: [
      {
        id: 'c1',
        name: 'CMP 1',
        chainage: 120,
        start: offsetCoordinate(origin, 150, 6),
        end: offsetCoordinate(origin, 330, 6),
        coverM: 0.6,
        installedCost: 2400,
      },
    ],
  },
} as unknown as RoadAnalysis
const analyses = new Map<string, RoadAnalysis>([
  [main.id, withCulvert],
  [spur.id, analysed(spur)],
])
const context: ContextFeature[] = [
  {
    id: 'creek',
    name: 'Willow Creek',
    kind: 'stream',
    geometry: { type: 'LineString', coordinates: [origin, offsetCoordinate(origin, 150, 300)] },
  },
  {
    id: 'old',
    name: 'Old spur',
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: [origin, offsetCoordinate(origin, 250, 300)] },
  },
  {
    id: 'block',
    name: 'CB 12',
    kind: 'harvest',
    geometry: {
      type: 'Polygon',
      coordinates: [[origin, offsetCoordinate(origin, 90, 200), offsetCoordinate(origin, 0, 200), origin]],
    },
  },
]
const input = (scope: 'active' | 'all'): RoadGisInput => ({
  name: 'Test project',
  roads: exportRoads([main, spur], main.id, scope),
  analyses,
  activeId: main.id,
  context,
})

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

const rows = (db: Database, sql: string) => {
  const result = db.exec(sql)[0]
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((c, i) => [c, values[i]]))) : []
}

describe('GIS layers', () => {
  it('are the QGIS project’s layers, titled, with station labels in the road’s own stationing', () => {
    const { layers, shapeLayers } = roadGisLayers(input('active'))
    expect(layers.map((layer) => layer.name)).toEqual(shapeLayers.map((layer) => layer.name))
    expect(layers.map((layer) => layer.name)).toEqual([
      'context_lines',
      'context_areas',
      'road_centrelines',
      'road_stations',
      'road_culverts',
    ])
    expect(layers.find((layer) => layer.name === 'road_centrelines')?.title).toBe('Road centrelines')
    const stations = layers.find((layer) => layer.name === 'road_stations')!
    expect(stations.features).toHaveLength(mainAnalysis.stations.length)
    expect(stations.features[0].attributes.STATION).toBe('1+000.0')
    expect(stations.features[0].attributes.STATION_M).toBe(0)
    expect(layers.find((layer) => layer.name === 'road_culverts')!.features[0].attributes.STATION).toBe('1+120.0')
  })
})

describe('GeoPackage', () => {
  it('reopens with sql.js holding every layer and a default QGIS style for each', () => {
    const file = roadGeoPackage(SQL, input('active'), { lastChange: new Date('2026-11-18T00:00:00Z') })
    const db = new SQL.Database(file.bytes)
    try {
      const features = rows(db, "SELECT table_name, identifier FROM gpkg_contents WHERE data_type = 'features'")
      expect(features.map((row) => row.table_name).sort()).toEqual(
        ['context_areas', 'context_lines', 'road_centrelines', 'road_culverts', 'road_stations'].sort(),
      )
      expect(features.find((row) => row.table_name === 'context_lines')?.identifier).toBe('Streams and existing roads')
      const styles = rows(db, 'SELECT f_table_name, styleName, styleQML, styleSLD, useAsDefault FROM layer_styles')
      expect(styles.map((row) => row.f_table_name).sort()).toEqual(features.map((row) => row.table_name).sort())
      for (const style of styles) {
        expect(style.useAsDefault).toBe(1)
        expect(String(style.styleQML)).toContain('<qgis')
        expect(String(style.styleSLD)).toContain('StyledLayerDescriptor')
      }
      // The roads take their own colour from the proposed-road symbol (QGIS writes r,g,b,a).
      const roads = String(styles.find((row) => row.f_table_name === 'road_centrelines')?.styleQML)
      expect(roads).toContain('217,119,6,255')
      const labels = rows(db, 'SELECT STATION FROM road_stations ORDER BY fid LIMIT 2')
      expect(labels[0].STATION).toBe('1+000.0')
      expect(rows(db, 'SELECT NAME FROM road_centrelines').map((row) => row.NAME)).toEqual(['Main line'])
    } finally {
      db.close()
    }
  })

  it('writes every road when asked, and only the road on screen otherwise', () => {
    const count = (scope: 'active' | 'all') => {
      const db = new SQL.Database(roadGeoPackage(SQL, input(scope)).bytes)
      try {
        return rows(db, 'SELECT NAME FROM road_centrelines ORDER BY fid').map((row) => row.NAME)
      } finally {
        db.close()
      }
    }
    expect(count('active')).toEqual(['Main line'])
    expect(count('all')).toEqual(['Main line', 'Spur 2'])
  })

  it('is refused while a road it would write leaves out an invalid input', () => {
    const invalid = new Map(analyses)
    invalid.set(spur.id, { ...analysed(spur), invalidInput: { message: 'Road section: bad.', leftOut: 'input' } })
    expect(() => roadGeoPackage(SQL, { ...input('all'), analyses: invalid })).toThrow(
      /^GeoPackage was not exported: an input is invalid/,
    )
    // The road on screen alone does not include the spur.
    expect(() => roadGeoPackage(SQL, { ...input('active'), analyses: invalid })).not.toThrow()
  })

  it('says what it wrote and previews the same layers', () => {
    const file = roadGeoPackage(SQL, input('active'))
    expect(roadGisNotice('GeoPackage', file)).toMatch(/^GeoPackage downloaded: 5 layers, \d+ features\./)
    const preview = roadGisPreview(file)
    expect(preview.type).toBe('geometry')
    if (preview.type !== 'geometry') return
    expect(preview.layers.map((layer) => layer.name)).toContain('Road centrelines')
    expect(preview.layers.find((layer) => layer.name === 'Road centrelines')?.color).toBe('#d97706')
  })
})

describe('KMZ', () => {
  const kml = (bytes: Uint8Array) => {
    const files = unzipSync(bytes)
    expect(Object.keys(files)[0]).toBe('doc.kml')
    return { text: strFromU8(files['doc.kml']), files }
  }

  it('holds a folder per layer and symbol, with meaningful placemark names and the plan’s colours', async () => {
    const file = roadKmz(input('all'), { dotIcon: await kmzDotIcon(encodePng) })
    const { text, files } = kml(file.bytes)
    expect(files[KMZ_DOT_ICON]).toBeDefined()
    const folders = [...text.matchAll(/<Folder>\s*<name>([^<]*)<\/name>/g)].map((m) => m[1])
    expect(folders).toEqual(
      expect.arrayContaining([
        'Streams and existing roads: Stream',
        'Streams and existing roads: Existing road',
        'Constraints and other blocks',
        'Road centrelines: Main line',
        'Road centrelines: Spur 2',
        'Road stations',
        'Culverts',
      ]),
    )
    for (const name of ['Main line', 'Spur 2', 'Willow Creek', 'Old spur', 'CB 12', '1+000.0', 'CMP 1'])
      expect(text).toContain(`<name>${name}</name>`)
    // Each road in its own colour, as KML's aabbggrr.
    expect(text).toContain('<color>ff0677d9</color>')
    expect(text).toContain('<color>ffeb6325</color>')
    // Attributes are kept.
    expect(text).toContain('<Data name="LENGTH_M">')
    expect(text).toContain(`<href>${KMZ_DOT_ICON}</href>`)
  })

  it('writes one road or every road', () => {
    const roadFolders = (scope: 'active' | 'all') =>
      [...kml(roadKmz(input(scope)).bytes).text.matchAll(/<name>(Road centrelines[^<]*)<\/name>/g)].map((m) => m[1])
    expect(roadFolders('active')).toEqual(['Road centrelines'])
    expect(roadFolders('all')).toEqual(['Road centrelines: Main line', 'Road centrelines: Spur 2'])
  })

  it('reports what KML cannot draw, in the notice and the document', () => {
    const file = roadKmz(input('active'))
    expect(file.diagnostics.some((d) => d.format === 'kml' && /more stroke left out/.test(d.message))).toBe(true)
    expect(roadGisNotice('KMZ', file)).toMatch(/symbol parts are simplified; the preview lists them\./)
    expect(kml(file.bytes).text).toMatch(/<description>Made by PGMaps.*so these were simplified:/s)
    const preview = roadGisPreview(file)
    expect(preview.type === 'geometry' && preview.notes?.some((note) => /^KML, /.test(note))).toBe(true)
  })

  it('is refused while an input is invalid', () => {
    const invalid = new Map(analyses)
    invalid.set(main.id, { ...withCulvert, invalidInput: { message: 'Road section: bad.', leftOut: 'input' } })
    expect(() => roadKmz({ ...input('active'), analyses: invalid })).toThrow(/^KMZ was not exported/)
  })
})
