import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import proj4 from 'proj4'
import { canforPdfFixture } from '../../../tests/fixtures/canforPdf'
import { readGeoPdf } from './read'
import { clipLines, drawingPaths, extractPaths } from './paths'
import { boxAgainstRegion, clipLineToRegion, clipRegionFromPaths, prepareRegion, regionContains } from './clipRegion'
import { simplifyPath, thinLayer, THIN_MAX_LEFT_OUT_SHARE, THINNING_TOLERANCES_MM } from './thinDrawing'
import type { MapFrame } from './georeference'
import { applyLayerImport } from '@/pages/dev-forestry-roads/referenceImport'
import { createDemoProject } from '@/pages/dev-forestry-roads/terrain'
import { parseProject, serializeProject } from '@/pages/dev-forestry-roads/project'
import { referenceGeoJson } from '@/pages/dev-forestry-roads/referenceFeatures'
import { buildSpatialImport, type SpatialFile } from '@/pages/dev-forestry-roads/spatialImport'
import { vehicleToolSources } from '@/pages/dev-forestry-roads/vehicleTools'
import { blockChoices } from '@/pages/dev-forestry-roads/blockSheet'
import { decodeCells, parseClassGrid, UNKNOWN } from './classGrid'
import { parseImageMosaic } from './imageMosaic'
import { PDF_LIMITS, type XY } from './types'
import { CANFOR_PROFILE, GENERIC_PROFILE_ID, GENERIC_PROFILE_LABEL, genericProfile } from './profiles'

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

  it('reads a tile stored losslessly in off-legend colours as estimates, and says why', async () => {
    const result = await readGeoPdf(
      await canforPdfFixture({ raster: 'canopy', damaged: true }),
      'Recompressed.pdf',
      runtime,
      limits,
    )
    const grid = parseClassGrid(result.layers.find((l) => l.classGrid)!.classGrid)!
    // Every drawn pixel is near a legend colour and on none: no class is exact, and none is lost.
    expect([...decodeCells(grid)]).toEqual([
      65,
      66,
      67,
      68,
      69,
      70,
      71,
      UNKNOWN.lossyNeutral,
      0,
      UNKNOWN.color,
      UNKNOWN.alpha,
      68,
      69,
      70,
      71,
      UNKNOWN.lossyNeutral,
    ])
    expect(grid.sourceImages.every((i) => i.lossy)).toBe(true)
    expect(grid.notes.join('\n')).toMatch(/Stored losslessly, but not in the legend's colours: .*compressed before/)
  })

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

  it('refuses an unregistered sheet instead of inventing placement', async () => {
    await expect(
      readGeoPdf(await canforPdfFixture({ registered: false }), 'scan.pdf', runtime, limits),
    ).rejects.toThrow(/no supported embedded map registration/)
  })

  it('reads a sheet no profile recognizes as its registered image and named map layers, unticked', async () => {
    const result = await readGeoPdf(await canforPdfFixture({ generic: true }), 'Overview.pdf', runtime, limits)
    expect(result.layers.map((l) => [l.name, l.source.layer, l.features.map((f) => f.geometry.type)])).toEqual([
      ['Map sheet', 'Map sheet', ['Polygon']],
      ['Plan areas', 'Plan areas', ['Polygon']],
      ['Access roads', 'Access roads', ['LineString']],
      // One layer drawn both ways comes in as two, each keeping the PDF layer's name.
      ['Mixed · areas', 'Mixed', ['Polygon']],
      ['Mixed · lines', 'Mixed', ['LineString']],
    ])
    expect(result.layers.every((l) => l.source.profile === GENERIC_PROFILE_LABEL)).toBe(true)
    expect(result.layers.every((l) => l.suggestedRole === 'reference')).toBe(true)
    expect(result.layers.filter((l) => l.name !== 'Map sheet').every((l) => !l.selected)).toBe(true)
    expect(result.layers[0].features[0].properties?.template).toBe(GENERIC_PROFILE_ID)
    expect(result.layers.some((l) => l.classGrid || l.imageMosaic || l.contourSurface)).toBe(false)
    // The fill closed the open path; the road is clipped to the frame like any other drawing.
    const area = (result.layers[1].features[0].geometry as GeoJSON.Polygon).coordinates[0]
    expect(area).toHaveLength(4)
    expect(area[0]).toEqual(area[3])
    const road = (result.layers[2].features[0].geometry as GeoJSON.LineString).coordinates.map((c) =>
      proj4(
        'EPSG:4326',
        '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m',
        c,
      ),
    )
    expect(road[0][0]).toBeCloseTo(1291000, 4)
    expect(road[1][0]).toBeCloseTo(1292800, 4)
    const notices = result.notices.join('\n')
    expect(notices).toMatch(/No company profile recognizes this sheet \(profiles: Canfor/)
    // The legend inside the frame is not part of the map.
    expect(notices).toMatch(/2 drawings inside the frame but not drawn as part of the map/)
  })

  it('reads only the sheet when nothing is drawn under the map frame', async () => {
    const result = await readGeoPdf(await canforPdfFixture({ supported: false }), 'unknown.pdf', runtime, limits)
    expect(result.layers.map((l) => l.name)).toEqual(['Map sheet'])
    expect(result.notices.join('\n')).toMatch(/No company profile recognizes this sheet/)
  })

  it('still reads a recognized template by its own profile', async () => {
    const result = await readGeoPdf(await canforPdfFixture(), 'Test.pdf', runtime, limits)
    expect(result.layers.every((l) => l.source.profile === CANFOR_PROFILE.label)).toBe(true)
    expect(result.notices.join('\n')).not.toMatch(/No company profile/)
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

// Generated geometry only: a page in points, read through a made-up operator list.
type Op = [number, unknown[]]
const square = (l: number, b: number, r: number, t: number, clockwise = false): XY[] =>
  clockwise
    ? [
        [l, b],
        [l, t],
        [r, t],
        [r, b],
        [l, b],
      ]
    : [
        [l, b],
        [r, b],
        [r, t],
        [l, t],
        [l, b],
      ]
const drawOps = (...paths: XY[][]) =>
  Float32Array.from(paths.flatMap((path) => path.flatMap(([x, y], i) => [i ? 1 : 0, x, y])))
const regionArea = (region: XY[][][]) =>
  region.reduce(
    (s, poly) =>
      s +
      poly.reduce((t, ring, i) => {
        let a = 0
        for (let k = 1; k < ring.length; k++) a += ring[k - 1][0] * ring[k][1] - ring[k][0] * ring[k - 1][1]
        return t + (i ? -1 : 1) * Math.abs(a / 2)
      }, 0),
    0,
  )
const OPS = runtime.OPS as unknown as Record<string, number>
const pageFrame: MapFrame = {
  page: 1,
  bbox: [0, 0, 100, 100],
  crs: 'local',
  registrationErrorM: 0,
  toWorld: (p) => p,
  corners: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  wkt: '',
  pageToProjected: [1, 0, 0, 1, 0, 0],
}
const layerContent = { getGroup: (id: string) => ({ name: id }), isVisible: () => true }
const inLayer = (layer: string, ops: Op[]): Op[] => [
  [OPS.beginMarkedContentProps, ['OC', { type: 'OCG', id: layer }]],
  ...ops,
  [OPS.endMarkedContent, []],
]
const clipTo = (fill: number, ...paths: XY[][]): Op[] => [
  [fill, []],
  [OPS.constructPath, [OPS.endPath, [drawOps(...paths)]]],
]
const stroke = (...paths: XY[][]): Op => [OPS.constructPath, [OPS.stroke, [drawOps(...paths)]]]
const paint = (...paths: XY[][]): Op => [OPS.constructPath, [OPS.fill, [drawOps(...paths)]]]
/** The map drawn under its frame's own clip, as map exporters draw it. */
const onMap = (ops: Op[]) => {
  const list: Op[] = [[OPS.save, []], ...clipTo(OPS.clip, square(0, 0, 100, 100)), ...ops, [OPS.restore, []]]
  return { fnArray: list.map(([fn]) => fn), argsArray: list.map(([, args]) => args) }
}
const read = (ops: Op[], layers: string[], limits = { maxFeatures: 500, maxVertices: 50_000 }) =>
  extractPaths(onMap(ops), OPS, layerContent, pageFrame, genericProfile(layers).rules, limits)

describe('drawings under a clip that is not a rectangle', () => {
  it('states a clip region under each fill rule, and refuses one it cannot state exactly', () => {
    // An outline with a hole wound the other way: nonzero and even-odd agree.
    const holed = clipRegionFromPaths([square(0, 0, 10, 10), square(2, 2, 4, 4, true)], false)!
    expect(regionArea(holed as XY[][][])).toBeCloseTo(96, 9)
    expect(
      regionArea(clipRegionFromPaths([square(0, 0, 10, 10), square(2, 2, 4, 4, true)], true) as XY[][][]),
    ).toBeCloseTo(96, 9)
    // Two overlapping squares wound alike: nonzero fills the overlap, even-odd leaves it out.
    const pair = [square(0, 0, 4, 4), square(2, 0, 6, 4)]
    expect(regionArea(clipRegionFromPaths(pair, false) as XY[][][])).toBeCloseTo(24, 9)
    expect(regionArea(clipRegionFromPaths(pair, true) as XY[][][])).toBeCloseTo(16, 9)
    // An open subpath is closed, as a clip closes it.
    expect(regionArea(clipRegionFromPaths([square(0, 0, 4, 4).slice(0, 4)], false) as XY[][][])).toBeCloseTo(16, 9)
    // A ring wound twice over by its parent (the third square sits inside the first, wound alike,
    // beside a hole wound the other way) cannot be stated by even-odd: refused, not guessed.
    expect(clipRegionFromPaths([square(0, 0, 10, 10), square(1, 1, 3, 3, true), square(5, 5, 8, 8)], false)).toBe(
      undefined,
    )
    // A figure eight paints differently under even-odd: refused.
    const eight: XY[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
      [0, 0],
    ]
    expect(clipRegionFromPaths([eight, square(10, 10, 12, 12)], true)).toBe(undefined)
    expect(clipRegionFromPaths([eight], false)).toBeDefined()
  })

  it('cuts a line where it crosses the region and keeps the gaps apart', () => {
    const region = prepareRegion(clipRegionFromPaths([square(0, 0, 10, 10), square(4, 0, 6, 6, true)], false)!)
    expect(regionContains(region, [5, 3])).toBe(false)
    expect(regionContains(region, [5, 8])).toBe(true)
    const pieces = clipLineToRegion(
      [
        [-2, 3],
        [12, 3],
        [12, 8],
      ],
      region,
    )
    expect(pieces.map((line) => line.map(([x, y]) => [Math.round(x * 1e9) / 1e9, y]))).toEqual([
      [
        [0, 3],
        [4, 3],
      ],
      [
        [6, 3],
        [10, 3],
      ],
    ])
    expect(boxAgainstRegion(region, [1, 1, 2, 2])).toBe('inside')
    expect(boxAgainstRegion(region, [4.5, 1, 5.5, 2])).toBe('outside')
    expect(boxAgainstRegion(region, [3, 1, 5, 2])).toBe('across')
  })

  it('reads lines and areas clipped to an outline, and a hatched area from the outline its hatching fills', () => {
    const outline: XY[] = [
      [20, 20],
      [80, 20],
      [50, 80],
      [20, 20],
    ]
    const result = read(
      [
        ...inLayer('Roads', [
          [OPS.save, []],
          ...clipTo(OPS.clip, outline),
          stroke([
            [10, 30],
            [90, 30],
          ]),
          paint(square(40, 10, 60, 40)),
          [OPS.restore, []],
        ]),
        ...inLayer('Reserves', [
          [OPS.save, []],
          ...clipTo(OPS.clip, outline),
          // Hatch strokes across the outline's whole box: its fill pattern, not lines.
          ...[25, 35, 45, 55, 65, 75].map((y) =>
            stroke([
              [15, y],
              [85, y],
            ]),
          ),
          [OPS.restore, []],
        ]),
      ],
      ['Roads', 'Reserves'],
    )
    expect(result.omittedClips).toBe(0)
    const road = result.layers
      .get('Roads\u0000line')!
      .features.map((f) => (f.geometry as GeoJSON.LineString).coordinates)
    expect(road).toHaveLength(1)
    expect(road[0][0][0]).toBeCloseTo(25, 9)
    expect(road[0][1][0]).toBeCloseTo(75, 9)
    const area = result.layers.get('Roads\u0000polygon')!.features[0].geometry as GeoJSON.Polygon
    // The square's part inside the triangle: above its base at y = 20.
    expect(regionArea([area.coordinates as XY[][]])).toBeCloseTo(20 * 20, 6)
    expect(result.hatchedAreas).toBe(1)
    expect(result.layers.has('Reserves\u0000line')).toBe(false)
    const hatched = result.layers.get('Reserves\u0000polygon')!.features[0].geometry as GeoJSON.Polygon
    expect(regionArea([hatched.coordinates as XY[][]])).toBeCloseTo(0.5 * 60 * 60, 6)
  })

  it('still leaves out drawings under a clip it cannot state exactly, and counts them', () => {
    const eight: XY[] = [
      [10, 10],
      [50, 50],
      [50, 10],
      [10, 50],
      [10, 10],
    ]
    const result = read(
      inLayer('Roads', [
        [OPS.save, []],
        ...clipTo(OPS.eoClip, eight, square(60, 60, 70, 70)),
        stroke([
          [0, 30],
          [100, 30],
        ]),
        [OPS.restore, []],
        stroke([
          [0, 90],
          [100, 90],
        ]),
      ]),
      ['Roads'],
    )
    expect(result.omittedClips).toBe(1)
    expect(result.layers.get('Roads\u0000line')!.features).toHaveLength(1)
  })
})

describe("thinning a layer over its budget to the sheet's own detail", () => {
  const wave = (n: number, y0 = 50): XY[] =>
    Array.from({ length: n }, (_, i) => [(i / (n - 1)) * 100, y0 + 2 * Math.sin((i / (n - 1)) * Math.PI * 6)] as XY)

  it('simplifies within the tolerance and keeps both ends', () => {
    const line = wave(20_000)
    const thin = simplifyPath(line, 0.25)
    expect(thin.length).toBeLessThan(200)
    expect(thin[0]).toBe(line[0])
    expect(thin.at(-1)).toBe(line.at(-1))
    // Every dropped vertex lies within the tolerance of the thinned line.
    const near = (p: XY) =>
      Math.min(
        ...thin.slice(1).map((b, i) => {
          const a = thin[i],
            dx = b[0] - a[0],
            dy = b[1] - a[1]
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
          return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
        }),
      )
    expect(Math.max(...line.filter((_, i) => i % 97 === 0).map(near))).toBeLessThanOrEqual(0.25 + 1e-9)
  })

  it('thins a dense line, joins lines over the part budget and keeps the largest areas first', () => {
    const limits = { maxFeatures: 10, maxVertices: 1_000 }
    const dense = thinLayer([{ type: 'LineString', coordinates: wave(5_000) }], 'line', limits)
    expect('thinning' in dense && dense.thinning).toMatchObject({
      toleranceMm: THINNING_TOLERANCES_MM[0],
      verticesBefore: 5_000,
      partsAfter: 1,
      joined: false,
      leftOutParts: 0,
    })
    // Too many lines but few vertices: joined into one feature, no vertex removed.
    const many = thinLayer(
      Array.from({ length: 30 }, (_, i) => ({
        type: 'LineString' as const,
        coordinates: [
          [0, i],
          [10, i],
        ] as XY[],
      })),
      'line',
      limits,
    )
    expect('thinning' in many && many.thinning).toMatchObject({
      toleranceMm: 0,
      joined: true,
      partsAfter: 1,
      verticesAfter: 60,
    })
    expect('geometries' in many && many.geometries[0].type).toBe('MultiLineString')
    // One large area and 30 specks: the large one and the nine largest specks kept, the rest
    // counted with their share of the area.
    const areas = [
      { type: 'Polygon' as const, coordinates: [square(0, 0, 90, 90)] },
      ...Array.from({ length: 30 }, (_, i) => ({
        type: 'Polygon' as const,
        coordinates: [square(i * 3, 95, i * 3 + 1 + i / 100, 96)],
      })),
    ]
    const kept = thinLayer(areas, 'polygon', limits)
    expect('thinning' in kept && kept.thinning).toMatchObject({ partsAfter: 10, leftOutParts: 21 })
    expect('thinning' in kept && kept.thinning.leftOutShare).toBeLessThan(0.003)
    expect('geometries' in kept && kept.geometries[0].coordinates).toEqual([square(0, 0, 90, 90)])
    // Equal areas: keeping ten of thirty would leave out two thirds, so the layer is refused.
    const even = thinLayer(areas.slice(1), 'polygon', limits)
    expect('leftOutShare' in even && even.leftOutShare).toBeGreaterThan(THIN_MAX_LEFT_OUT_SHARE)
  })

  it('brings a layer over its budget in through extractPaths instead of refusing it', () => {
    const result = read(inLayer('Roads', [stroke(wave(3_000))]), ['Roads'], { maxFeatures: 500, maxVertices: 500 })
    const entry = result.layers.get('Roads\u0000line')!
    expect(entry.overBudget).toBe(false)
    expect(entry.thinning).toMatchObject({ verticesBefore: 3_000 })
    expect(entry.thinning!.verticesAfter).toBeLessThanOrEqual(500)
    expect(entry.features).toHaveLength(1)
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
      // A copy saved again by another program carries rounded registration points, and says so.
      const resaved = result.notices.some((note) => /saved again by another program/.test(note))
      expect(
        result.layers.every((l) => l.source.registrationErrorM < (resaved ? PDF_LIMITS.registrationErrorM : 1)),
      ).toBe(true)
      expect(result.notices.some((note) => /registration points disagree/.test(note))).toBe(
        result.layers[0].source.registrationErrorM > PDF_LIMITS.registrationNoticeM,
      )
      if (/Hillshade|Ortho/.test(name)) {
        const picture = result.layers.find((l) => l.imageMosaic)
        expect(picture, result.notices.join('\n')).toBeDefined()
        const mosaic = parseImageMosaic(picture!.imageMosaic)!
        // The hillshade shares the class rasters' pixel grid; every tile is the PDF's own JPEG file.
        if (/Hillshade/.test(name)) expect(mosaic).toMatchObject({ kind: 'hillshade', width: 3637, height: 3004 })
        expect(mosaic.tiles).toHaveLength(/Hillshade/.test(name) ? 4 : 6)
        expect(mosaic.tiles.every((tile) => tile.lossy && tile.image.startsWith('data:image/jpeg;base64,/9j/'))).toBe(
          true,
        )
        expect(mosaic.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(mosaic.width * mosaic.height)
        expect(picture!.selected).toBe(/Hillshade/.test(name))
      } else expect(result.layers.some((l) => l.imageMosaic)).toBe(false)
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
        // The profile assumes the datum and metres, which the import offers ticked.
        const terrain = result.layers.find((l) => l.contourSurface)!
        expect(terrain.assumedVerticalDatum?.reference).toBe('CGVD2013 (CGG2013), EPSG:6647; metres')
      }
    }
  }, 600_000)
})
