import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import proj4 from 'proj4'
import { canforPdfFixture } from '../../../tests/fixtures/canforPdf'
import { readGeoPdf } from './read'
import { clipLines, drawingPaths } from './paths'
import { applyLayerImport } from '@/pages/dev-forestry-roads/referenceImport'
import { createDemoProject } from '@/pages/dev-forestry-roads/terrain'
import { parseProject, serializeProject } from '@/pages/dev-forestry-roads/project'
import { referenceGeoJson } from '@/pages/dev-forestry-roads/referenceFeatures'
import { buildSpatialImport, type SpatialFile } from '@/pages/dev-forestry-roads/spatialImport'
import { vehicleToolSources } from '@/pages/dev-forestry-roads/vehicleTools'
import { blockChoices } from '@/pages/dev-forestry-roads/blockSheet'
import { decodeCells, parseClassGrid, UNKNOWN } from './classGrid'

const limits = { maxFeatures: 500, maxVertices: 50_000 }
describe('company GeoPDF reader', () => {
  it.each(['canopy', 'slope'] as const)(
    'reads the original %s image and legend without labels or linework',
    async (kind) => {
      const result = await readGeoPdf(await canforPdfFixture({ raster: kind }), 'Raster.pdf', runtime, limits)
      const layer = result.layers.find((l) => l.classGrid)!
      expect(layer, result.notices.join('\n')).toBeDefined()
      const grid = parseClassGrid(layer.classGrid)!
      expect(grid).toMatchObject({ width: 4, height: 4, kind })
      expect(grid.legend).toHaveLength(8)
      expect([...decodeCells(grid)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, UNKNOWN.color, UNKNOWN.alpha, 4, 5, 6, 7, 8])
      expect(grid.sourceImages.every((i) => !i.lossy)).toBe(true)
      const file: SpatialFile = {
        fileName: 'Raster.pdf/classes',
        format: 'GeoPDF',
        crs: 'Embedded map',
        collection: { type: 'FeatureCollection', features: layer.features },
        pdf: { source: layer.source, note: layer.note, selected: true, classGrid: grid },
      }
      const base = createDemoProject()
      expect(() => applyLayerImport(base, [{ file, role: 'planned-block' }], () => 'raster')).toThrow()
      const project = applyLayerImport(base, [{ file, role: 'reference' }], () => 'raster').project
      expect(project.context).toEqual(base.context)
      expect(project.terrain).toEqual(base.terrain)
      const restored = parseProject(JSON.parse(serializeProject(project)))
      expect(restored.reference![0].classGrid).toEqual(grid)
      const back = buildSpatialImport(
        {
          fileName: 'roundtrip.geojson',
          format: 'GeoJSON',
          crs: 'WGS84',
          collection: referenceGeoJson(project.reference!),
        },
        { point: 'reference', line: 'reference', polygon: 'reference' },
        'reference',
      )
      expect(back.reference[0].classGrid).toEqual(grid)
      expect(vehicleToolSources([], restored.reference!)).toEqual([])
      expect(blockChoices(restored).some((c) => c.value === 'reference:raster')).toBe(false)
    },
  )

  it('reports a missing legend instead of guessing colours from a familiar layer name', async () => {
    const result = await readGeoPdf(
      await canforPdfFixture({ raster: 'canopy', legend: false }),
      'No-legend.pdf',
      runtime,
      limits,
    )
    expect(result.layers.some((l) => l.classGrid)).toBe(false)
    expect(result.notices.join('\n')).toMatch(/Missing Canopy Height/)
    expect(result.layers.some((l) => l.name === 'Roads')).toBe(true)
  })
  it('registers native paths in the source CRS, clips legend linework, and retains reserve holes', async () => {
    const result = await readGeoPdf(await canforPdfFixture(), 'Test.pdf', runtime, limits)
    expect(result.layers.map((l) => l.name)).toEqual(['Map sheet', 'Block outlines', 'Roads', 'Streams', 'Reserves'])
    expect(result.layers.every((l) => l.source.registrationErrorM < 0.001)).toBe(true)
    const road = result.layers.find((l) => l.name === 'Roads')!.features[0].geometry as GeoJSON.LineString
    const xy = road.coordinates.map((c) =>
      proj4(
        'EPSG:4326',
        '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m',
        c,
      ),
    )
    expect(xy[0][0]).toBeCloseTo(1291000, 4)
    expect(xy[1][0]).toBeCloseTo(1292800, 4)
    expect(xy[0][1]).toBeCloseTo(1015900, 4)
    const stream = result.layers.find((l) => l.name === 'Streams')!.features
    expect(stream).toHaveLength(1)
    expect((stream[0].geometry as GeoJSON.MultiLineString).coordinates).toHaveLength(2)
    expect(
      (result.layers.find((l) => l.name === 'Reserves')!.features[0].geometry as GeoJSON.Polygon).coordinates,
    ).toHaveLength(2)
    expect(result.layers.find((l) => l.name === 'Roads')!.suggestedRole).toBe('reference')
  })

  it('refuses unregistered and unknown templates instead of inventing placement or meaning', async () => {
    await expect(
      readGeoPdf(await canforPdfFixture({ registered: false }), 'scan.pdf', runtime, limits),
    ).rejects.toThrow(/no supported embedded map registration/)
    await expect(
      readGeoPdf(await canforPdfFixture({ supported: false }), 'unknown.pdf', runtime, limits),
    ).rejects.toThrow(/template is not supported/)
  })

  it('keeps source metadata, compound paths and native attributes through project and GeoJSON round trips', async () => {
    const result = await readGeoPdf(await canforPdfFixture(), 'Map.pdf', runtime, limits)
    const files: SpatialFile[] = result.layers.map((layer) => ({
      fileName: `Map.pdf/${layer.name}`,
      format: 'GeoPDF',
      crs: 'Embedded map',
      collection: { type: 'FeatureCollection', features: layer.features },
      pdf: { source: layer.source, note: layer.note, selected: true },
    }))
    const base = createDemoProject()
    let id = 0
    const imported = applyLayerImport(
      base,
      files.map((file) => ({ file, role: 'reference' })),
      () => `pdf-${++id}`,
    ).project
    expect(imported.context).toEqual(base.context)
    expect(imported.terrain).toEqual(base.terrain)
    expect(parseProject(JSON.parse(serializeProject(imported))).reference).toEqual(imported.reference)
    const stream = imported.reference!.find((f) => f.geometry.type === 'MultiLineString')!
    expect(vehicleToolSources([], [stream])).toEqual([])
    const frame = imported.reference![0]
    const sheet = {
      ...frame,
      sheet: {
        image: 'data:image/jpeg;base64,/9j/2Q==',
        corners: (frame.geometry as GeoJSON.Polygon).coordinates[0].slice(0, 4) as [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ],
      },
    }
    expect(vehicleToolSources([], [sheet])).toEqual([])
    expect(
      blockChoices({ ...imported, reference: [sheet] }).some((choice) => choice.value === `reference:${frame.id}`),
    ).toBe(false)
    expect(stream.pdfSource).toMatchObject({ page: 1, file: 'Map.pdf', layer: 'Streams - 0k - 25k' })
    const exported = referenceGeoJson(imported.reference!)
    const back = buildSpatialImport(
      { fileName: 'Roundtrip.geojson', format: 'GeoJSON', crs: 'WGS84', collection: exported },
      { line: 'reference', polygon: 'reference', point: 'reference' },
      'reference',
    )
    expect(back.reference.find((f) => f.geometry.type === 'MultiLineString')?.pdfSource).toEqual(stream.pdfSource)
    const native: SpatialFile = {
      fileName: 'native.geojson',
      format: 'GeoJSON',
      crs: 'WGS84',
      collection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-123, 54] },
            properties: { NAME: 'Station', observed: '2026-08-22', value: 0, reviewed: false },
          },
        ],
      },
    }
    expect(
      buildSpatialImport(native, { point: 'reference', line: null, polygon: null }).reference[0].attributes,
    ).toMatchObject({ NAME: 'Station', observed: '2026-08-22', value: 0, reviewed: false })
  })

  it('clips line gaps independently and flattens cubic paths after the complete transform', () => {
    expect(
      clipLines(
        [
          [-1, 1],
          [3, 1],
          [3, 3],
          [1, 1],
        ],
        [0, 0, 2, 2],
      ),
    ).toEqual([
      [
        [0, 1],
        [2, 1],
      ],
      [
        [2, 2],
        [1, 1],
      ],
    ])
    const paths = drawingPaths([0, 0, 0, 2, 0, 10, 10, 10, 10, 0], [2, 0, 0, 2, 5, 6])
    expect(paths[0][0]).toEqual([5, 6])
    expect(paths[0].at(-1)).toEqual([25, 6])
    expect(Math.max(...paths[0].map((p) => p[1]))).toBeGreaterThan(20)
  })
})

// Read private source sheets only when explicitly supplied. Never copy them into fixtures.
const privateMaps = process.env.PGMAPS_CANFOR_MAPS
describe.skipIf(!privateMaps)('local Canfor source sheets', () => {
  it('reads every supplied PDF with registered roads and streams', async () => {
    for (const name of (await readdir(privateMaps!)).filter((n) => /\.pdf$/i.test(n))) {
      const result = await readGeoPdf(
        new Uint8Array(await readFile(path.join(privateMaps!, name))),
        name,
        runtime,
        limits,
      )
      expect(result.layers[0].source.profile).toMatch(/Canfor/)
      expect(result.layers.some((l) => l.name === 'Roads')).toBe(true)
      expect(result.layers.some((l) => l.name === 'Streams')).toBe(true)
      expect(result.layers.every((l) => l.source.registrationErrorM < 1)).toBe(true)
      if (/Canopy_Height|Slope|revised/.test(name)) {
        const grid = result.layers.find((l) => l.classGrid)?.classGrid
        expect(grid, result.notices.join('\n')).toBeDefined()
        expect(grid).toMatchObject({ width: 3637, height: 3004 })
        expect(grid!.legend).toHaveLength(8)
        expect(grid!.sourceImages.filter((i) => i.lossy)).toHaveLength(grid!.kind === 'canopy' ? 2 : 3)
        expect(grid!.counts.slice(65, 73).reduce((s, n) => s + n, 0)).toBeGreaterThan(1000)
        expect(grid!.undrawn?.maximum).toBe(grid!.kind === 'canopy' ? 5 : 20)
        // Every drawn pixel of a decoded JPEG tile gets an estimate; none is left "outside tolerance".
        expect(grid!.counts[240] + grid!.counts[241] + grid!.counts[243]).toBe(0)
        expect(grid!.notes.join(' ')).toMatch(/JPEG tiles?: drawn pixels take the classes/)
        parseClassGrid(grid)
      }
      if (/Field_Layout/.test(name)) {
        const surface = result.layers.find((l) => l.contourSurface)?.contourSurface
        expect(surface, result.notices.join('\n')).toBeDefined()
        expect(surface).toMatchObject({ epsg: 3005, cellM: 2, assignment: { interval: 10 } })
        expect(surface!.assignment.labelledLines).toBeGreaterThan(80)
        const heights = Array.from(surface!.values).filter(Number.isFinite)
        expect(heights.length).toBeGreaterThan(surface!.values.length / 2)
        expect(Math.min(...heights.slice(0, 50_000))).toBeGreaterThanOrEqual(700)
      }
    }
  }, 600_000)
})
