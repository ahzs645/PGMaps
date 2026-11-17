import { zipSync } from 'fflate'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { encodePng } from '@/lib/mapSheet/png'
import { readStyleFile } from '@/lib/styleExchange/readStyleFile'
import { readQgisFile } from '@/lib/styleExchange/qgis/read'
import { roadShapefileLayers } from './designExports'
import { analyzeRoad, offsetCoordinate } from './engine'
import { contextShapefileLayers } from './exportStyles'
import { styledExportBundle, type StyledExportKind } from './styledExports'
import { styledExportPreviewHtml } from './styledExportPreview'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate } from './types'

const origin: Coordinate = [-122.75, 53.91]
const road: Alignment = {
  id: 'main',
  name: "Main line's spur",
  color: '#d97706',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 60, 400), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const analysis = analyzeRoad(road, { elevationAt: () => 760 }, DEFAULT_ROAD_SETTINGS)
const context: ContextFeature[] = [
  {
    id: 'creek',
    name: 'Creek',
    kind: 'stream',
    geometry: { type: 'LineString', coordinates: [origin, offsetCoordinate(origin, 150, 300)] },
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
const layers = [
  ...contextShapefileLayers(context),
  ...roadShapefileLayers([road], new Map([[road.id, analysis]]), road.id),
]
const input = { name: 'Test project', layers, roads: [{ name: road.name, color: road.color }] }
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

const bundle = (kind: StyledExportKind) => styledExportBundle(kind, input, { encodePng, SQL })
const zip = (files: { path: string; content: string | Uint8Array }[]) =>
  zipSync(
    Object.fromEntries(
      files.map((f) => [f.path, typeof f.content === 'string' ? new TextEncoder().encode(f.content) : f.content]),
    ),
  )

describe('styled GIS exports', () => {
  it('writes the QGIS project with data, a style per layer and all five sheet layouts', async () => {
    const { files } = await bundle('qgis-project')
    const paths = files.map((f) => f.path)
    expect(paths).toContain('Test-project.qgz')
    for (const id of ['context_lines', 'context_areas', 'road_centrelines', 'road_stations', 'road_culverts'])
      expect(paths).toEqual(expect.arrayContaining([`data/${id}.shp`, `data/${id}.qml`]))
    expect(paths.filter((p) => p.startsWith('layouts/') && p.endsWith('.qpt'))).toHaveLength(5)
    expect(paths).toContain('layouts/operating-plan-side-panel.qpt')
    const operating = readQgisFile(
      'operating-plan.qpt',
      files.find((file) => file.path === 'layouts/operating-plan-side-panel.qpt')!.content,
    )
    expect(operating.layouts[0].paper).toBe('36x29')
    expect(operating.layouts[0].template.panels.map((panel) => panel.id)).toEqual([
      'branding',
      'blockInfo',
      'legend',
      'source',
      'locator',
      'footer',
    ])
    expect(paths).toContain('README.txt')
  })

  it('writes the ArcGIS Pro map with layer files, layouts beside the map and a style', async () => {
    const { files } = await bundle('arcgis-pro')
    const paths = files.map((f) => f.path)
    expect(paths).toEqual(expect.arrayContaining(['road_centrelines.lyrx', 'data/road_centrelines.shp']))
    expect(paths.some((p) => p.endsWith('.mapx'))).toBe(true)
    expect(paths.filter((p) => !p.includes('/') && p.endsWith('.pagx'))).toHaveLength(5)
    expect(paths).toContain('operating-plan-side-panel.pagx')
    expect(paths.some((p) => p.startsWith('styles/') && p.endsWith('.stylx'))).toBe(true)
    const lyrx = JSON.parse(files.find((f) => f.path === 'road_centrelines.lyrx')!.content as string)
    expect(lyrx.layerDefinitions[0].featureTable.dataConnection.workspaceConnectionString).toBe('DATABASE=.\\data')
  })

  it.each(['qgis-project', 'arcgis-pro', 'web-map-style'] as const)(
    'reads a %s bundle back whole with every road and context rule',
    async (kind) => {
      const written = await bundle(kind)
      const reads = readStyleFile('bundle.zip', zip(written.files), { SQL })
      expect(reads.filter((read) => read.error)).toEqual([])
      const roadRules = reads
        .flatMap((read) => read.result?.layers ?? [])
        .filter((layer) => layer.id === 'road_centrelines' || layer.name === 'Road centrelines')
      expect(roadRules.length).toBeGreaterThan(0)
      for (const layer of roadRules) expect(layer.rules.map((rule) => rule.label)).toEqual([road.name, 'Proposed road'])
    },
  )

  it('writes the whole catalogue as a library in every format, and previews it', async () => {
    const written = await bundle('symbol-library')
    expect(written.library!.symbols.length).toBeGreaterThan(100)
    const reads = readStyleFile('library.zip', zip(written.files), { SQL })
    for (const read of reads) {
      expect(read.error).toBeUndefined()
      expect(read.result!.symbols.length).toBe(written.library!.symbols.length)
    }
    expect(styledExportPreviewHtml('Symbol library', written)).toContain('Old growth management area')
  })

  it('names the styles a browser library replaced in the README', async () => {
    const creek = { kind: 'line' as const, label: 'Imported creek', layers: [{ color: '#123456', width: 2 }] }
    const written = await styledExportBundle('qgis-project', { ...input, overrides: { stream: creek } }, { encodePng })
    const readme = written.files.find((f) => f.path === 'README.txt')!.content as string
    expect(readme).toContain(
      "Drawn with styles from this browser's style library instead of PGMaps' own: Imported creek",
    )
    expect(written.files.find((f) => f.path === 'data/context_lines.qml')!.content).toContain('18,52,86')
  })
})
