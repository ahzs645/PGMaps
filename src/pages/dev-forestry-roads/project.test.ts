import { describe, expect, it } from 'vitest'
import {
  importAlignmentGeoJson,
  importContextGeoJson,
  parseProject,
  projectGeoJson,
  projectReportHtml,
  serializeProject,
  stationsCsv,
} from './project'
import {
  createDemoProject,
  demoTerrain,
  terrainBounds,
  terrainFromMetadata,
  validateRoadRaster,
  starterAlignment,
  DEMO_ORIGIN,
} from './terrain'
import type { RoadAnalysis } from './types'

const analysis: RoadAnalysis = {
  stations: [
    {
      index: 0,
      chainage: 0,
      coordinate: [-122.72, 53.89],
      bearing: 40,
      groundElevation: 688,
      designElevation: 689,
      gradePercent: 10,
      groundGradePercent: 9,
      curveRadiusM: null,
      leftWidth: 3,
      rightWidth: 3,
      section: [],
      cutAreaM2: 0,
      fillAreaM2: 6,
      cutVolumeM3: 0,
      fillVolumeM3: 60,
      massM3: -60,
      leftDaylightM: -5,
      rightDaylightM: 5,
      complete: true,
      flags: [],
    },
  ],
  centerline: [
    [-122.72, 53.89],
    [-122.71, 53.9],
  ],
  crossings: [],
  length: 100,
  cutVolumeM3: 0,
  fillVolumeM3: 60,
  balanceM3: -60,
  surfaceVolumeM3: 150,
  clearingAreaM2: 1000,
  estimatedCost: 7980,
  maxGradePercent: 10,
  completeLength: 100,
  coveragePercent: 100,
  warnings: [],
}

describe('road project boundary', () => {
  it('rejects array-coerced enum inputs so an avoid constraint cannot bypass downstream checks', () => {
    const project = createDemoProject()
    const feature = { ...project.context[0], kind: ['avoid'] }
    expect(() => parseProject({ ...project, context: [feature] })).toThrow(/Context kind/)
    const geojson = { type: 'Feature', properties: { kind: ['avoid'] }, geometry: feature.geometry }
    expect(() => importContextGeoJson(geojson)).toThrow(/Context kind/)
    expect(() => importAlignmentGeoJson(geojson)).toThrow(/kind must be a string/)
    expect(() => parseProject({ ...project, terrain: { ...project.terrain, kind: ['demo'] } })).toThrow(
      /terrain source kind/,
    )
    for (const invalid of [
      { kind: ['turnout'], side: 'left' },
      { kind: 'turnout', side: ['left'] },
    ]) {
      const alignment = {
        ...project.alignments[0],
        overrides: [{ id: 'turnout', name: 'Turnout', start: 10, end: 20, taper: 2, extraWidth: 2, ...invalid }],
      }
      expect(() => parseProject({ ...project, alignments: [alignment] })).toThrow(/Widening/)
    }
    expect(() =>
      parseProject({
        ...project,
        alignments: [{ ...project.alignments[0], fsrConnection: { endpoint: 'end', preference: ['chosen'] } }],
      }),
    ).toThrow(/FSR connection preference/)
    expect(() =>
      importContextGeoJson({
        ...geojson,
        crs: { type: 'name', properties: { name: ['EPSG:4326'] } },
      }),
    ).toThrow(/Reproject/)
    expect(() =>
      importContextGeoJson({
        ...geojson,
        properties: { kind: 'avoid' },
        geometry: { ...feature.geometry, type: [feature.geometry.type] },
      }),
    ).toThrow(/line or polygon geometry/)
  })

  it('round-trips the full supported UI vertical ranges and rejects unsupported latitude edges', () => {
    const project = createDemoProject()
    project.alignments[0].vertical = [
      { id: 'low', chainage: 0, elevation: -12000, curveLength: 0 },
      { id: 'high', chainage: 500, elevation: 12000, curveLength: 10000 },
    ]
    expect(parseProject(serializeProject(project)).alignments[0].vertical).toEqual(project.alignments[0].vertical)
    project.alignments[0].vertical[0].elevation = -12000.01
    expect(() => parseProject(project)).toThrow(/Design elevation/)
    project.alignments[0].vertical[0].elevation = -12000
    project.alignments[0].vertical[1].curveLength = 10000.01
    expect(() => parseProject(project)).toThrow(/Vertical curve length/)
    for (const latitude of [-85, 85]) {
      expect(() =>
        importAlignmentGeoJson({
          type: 'LineString',
          coordinates: [
            [-123, latitude],
            [-122.999, latitude],
          ],
        }),
      ).toThrow(/strictly between/)
    }
    expect(
      importAlignmentGeoJson({
        type: 'LineString',
        coordinates: [
          [-123, 84.999],
          [-122.999, 84.999],
        ],
      }),
    ).toHaveLength(1)
  })
  it('saves ground transects separately from road alignments and exports their distinct role', () => {
    const project = createDemoProject()
    project.profiles = [
      {
        id: 'stream-profile',
        name: 'Stream gradient',
        points: [
          [-123, 54],
          [-122.99, 54.01],
        ],
      },
    ]
    const restored = parseProject(serializeProject(project))
    expect(restored.profiles).toEqual(project.profiles)
    expect(restored.alignments).toEqual(project.alignments)
    const geo = projectGeoJson(restored, new Map())
    expect(geo.features.find((f) => f.id === 'stream-profile')?.properties?.kind).toBe('terrain-profile')
    expect(() =>
      parseProject({
        ...project,
        profiles: [
          {
            id: 'bad',
            name: 'Bad',
            points: [
              [1e6, 54],
              [1e6 + 1, 54],
            ],
          },
        ],
      }),
    ).toThrow(/longitude/)
  })
  it('round-trips the complete demo without changing geometry, independent design controls, settings or provenance', () => {
    const project = createDemoProject(),
      restored = parseProject(serializeProject(project))
    expect(restored).toEqual(project)
    expect(restored.alignments[0].vertical.length).toBeGreaterThan(1)
    expect(restored.terrain.name).toMatch(/synthetic/i)
    expect(terrainFromMetadata(restored.terrain)?.elevationAt(...DEMO_ORIGIN)).toBeCloseTo(
      demoTerrain.elevationAt(...DEMO_ORIGIN),
      12,
    )
  })
  it('keeps a regional extent so a reopened project loads the same square, and starts new projects on one road', () => {
    const road = starterAlignment([-120.33, 50.67])
    const project = {
      ...createDemoProject(),
      terrain: {
        kind: 'regional' as const,
        name: 'Regional Terrarium DEM · coarse screening',
        resolutionM: 25,
        verticalReference: 'Mixed-source regional DEM',
        bounds: [-120.35, 50.65, -120.31, 50.69] as [number, number, number, number],
      },
      alignments: [road],
      activeAlignmentId: road.id,
    }
    expect(parseProject(JSON.parse(serializeProject(project))).terrain.bounds).toEqual(project.terrain.bounds)
    expect(road.points).toHaveLength(2)
    expect(road.vertical).toEqual([])
    for (const bounds of [
      [-120.31, 50.65, -120.35, 50.69],
      [0, 0, 1],
      [0, -90, 1, 1],
    ])
      expect(() => parseProject({ ...project, terrain: { ...project.terrain, bounds } })).toThrow(/bounds/)
    expect(() =>
      parseProject({ ...project, terrain: { ...createDemoProject().terrain, bounds: project.terrain.bounds } }),
    ).toThrow(/bounds/)
  })

  it('rejects malformed, non-finite, oversized and ambiguous projects', () => {
    const p = createDemoProject()
    expect(() => parseProject({ ...p, settings: { ...p.settings, stationInterval: 0 } })).toThrow(/interval/i)
    expect(() => parseProject({ ...p, settings: { ...p.settings, fillRate: Infinity } })).toThrow(/cost/i)
    expect(() => parseProject({ ...p, activeAlignmentId: 'missing' })).toThrow(/missing/i)
    expect(() => parseProject({ ...p, alignments: [p.alignments[0], p.alignments[0]] })).toThrow(/unique/i)
    expect(() => parseProject({ ...p, terrain: { ...p.terrain, sourceUrl: 'javascript:alert(1)' } })).toThrow(/HTTPS/i)
    expect(() => parseProject({ ...p, terrain: { ...p.terrain, epsg: 12345 } })).toThrow(/WGS84/i)
    expect(() => parseProject('not json')).toThrow(/JSON/)
  })
  it('retains raw GeoJSON line vertices and does not turn third ordinates into designed or terrain elevations', () => {
    const coords = [
      [-123, 54, 500],
      [-122.999, 54.001, 530],
      [-122.998, 54.001, 520],
    ]
    const [imported] = importAlignmentGeoJson({
      type: 'Feature',
      properties: { name: 'Survey traverse' },
      geometry: { type: 'LineString', coordinates: coords },
    })
    expect(imported.points.map((p) => p.coordinate)).toEqual(coords.map((p) => p.slice(0, 2)))
    expect(imported.points.map((p) => p.radiusM)).toEqual([0, 0, 0])
    expect(imported.vertical).toEqual([])
    expect(() =>
      importAlignmentGeoJson({
        type: 'LineString',
        crs: { type: 'name', properties: { name: 'EPSG:3005' } },
        coordinates: [
          [1200000, 900000],
          [1200100, 900100],
        ],
      }),
    ).toThrow(/WGS84/)
    expect(() =>
      importAlignmentGeoJson({
        type: 'LineString',
        coordinates: [
          [-123, 54],
          [-123, 54],
        ],
      }),
    ).toThrow(/duplicate/i)
  })
  it('retains stream and review polygon topology while rejecting unclosed rings', () => {
    const p = createDemoProject(),
      context = importContextGeoJson({
        type: 'FeatureCollection',
        features: p.context.map((f) => ({
          type: 'Feature',
          properties: { kind: f.kind, name: f.name },
          geometry: f.geometry,
        })),
      })
    expect(context.map((f) => f.geometry)).toEqual(p.context.map((f) => f.geometry))
    expect(() =>
      importContextGeoJson({
        type: 'Polygon',
        coordinates: [
          [
            [-123, 54],
            [-122, 54],
            [-122, 55],
            [-123, 55],
          ],
        ],
      }),
    ).toThrow(/closed/)
  })
  it('preserves an explicit no-data hole and native pixel-centre sampling in a saved EPSG3157 raster', () => {
    const raster = validateRoadRaster({
      id: 'tiny',
      name: 'Tiny DTM',
      kind: 'terrain',
      epsg: 3157,
      width: 2,
      height: 2,
      origin: [512500.5, 5972000.5],
      pixelSize: [1, -1],
      values: [700, 701, 702, null],
      verticalReference: 'CGVD2013, metres',
      sha256: 'a'.repeat(64),
      acquired: '2024',
    })
    const metadata = {
      kind: 'geotiff' as const,
      name: raster.name,
      resolutionM: 1,
      epsg: raster.epsg,
      verticalReference: raster.verticalReference,
      sha256: raster.sha256,
      raster,
    }
    const bounds = terrainBounds(metadata)!
    const source = terrainFromMetadata(metadata)!
    expect(Number.isNaN(source.elevationAt((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2))).toBe(true)
    expect(Number.isNaN(source.elevationAt(0, 0))).toBe(true)
    const saved = createDemoProject()
    saved.terrain = metadata
    expect(parseProject(serializeProject(saved)).terrain.raster?.values).toEqual([700, 701, 702, null])
  })
})

describe('road exports', () => {
  it('reimports only road geometry from a mixed project export and retains road names', () => {
    const p = createDemoProject()
    p.profiles = [{ id: 'transect', name: 'Ground only', points: analysis.centerline }]
    const exported = projectGeoJson(p, new Map([[p.activeAlignmentId, analysis]]))
    exported.features.push({
      type: 'Feature',
      properties: { kind: 'crossing-review', name: 'Stream crossing' },
      geometry: { type: 'Point', coordinates: analysis.centerline[0] },
    })
    expect(exported.features.some((f) => f.properties?.kind === 'stream')).toBe(true)
    expect(exported.features.some((f) => f.properties?.kind === 'geometric-dline')).toBe(true)
    const imported = importAlignmentGeoJson(JSON.stringify(exported))
    expect(imported.map((a) => a.name)).toEqual(p.alignments.map((a) => a.name))
    expect(imported[0].points.map((point) => point.coordinate)).toEqual(analysis.centerline)
    expect(imported[1].points.map((point) => point.coordinate)).toEqual(
      p.alignments[1].points.map((point) => point.coordinate),
    )
    expect(imported.every((a) => a.vertical.length === 0)).toBe(true)
    expect(() =>
      importAlignmentGeoJson({
        ...exported,
        features: exported.features.filter((f) => f.properties?.kind !== 'alignment'),
      }),
    ).toThrow(/No road alignments/)
  })
  it('splits generic multipart roads with distinct names and skips accompanying non-line geometry', () => {
    const imported = importAlignmentGeoJson({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-123, 54] } },
        {
          type: 'Feature',
          properties: { name: 'Access road' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-123, 54],
                [-122.999, 54.001],
              ],
              [
                [-123, 54],
                [-123.001, 54.001],
              ],
            ],
          },
        },
      ],
    })
    expect(imported.map((a) => a.name)).toEqual(['Access road (part 1)', 'Access road (part 2)'])
  })
  it('exports spatial geometry with terrain provenance and partial status', () => {
    const p = createDemoProject(),
      result = projectGeoJson(p, new Map([[p.activeAlignmentId, { ...analysis, coveragePercent: 45 }]]))
    expect(result.features[0].properties?.status).toBe('partial-or-not-calculated')
    expect(result.features[0].properties?.vertical_reference).toBe(p.terrain.verticalReference)
    expect(result.features[0].geometry).toEqual({ type: 'LineString', coordinates: analysis.centerline })
  })
  it('quotes CSV text and prevents spreadsheet formula injection without changing numeric signs', () => {
    const metadata = {
      ...createDemoProject().terrain,
      name: '=HYPERLINK("https://example.test")',
      verticalReference: '+CMD',
    }
    const csv = stationsCsv(analysis, metadata)
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"')
    expect(csv).toContain('"\'+CMD"')
    expect(csv).toContain(',-60,')
    expect(csv).toContain('terrain_resolution_m')
  })
  it('escapes untrusted names and flags in printable HTML; reports partial totals and assumptions', () => {
    const p = createDemoProject()
    p.name = '<script>alert(1)</script>'
    const html = projectReportHtml(p, { ...analysis, coveragePercent: 45, warnings: ['<img src=x onerror=alert(1)>'] })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Partial model')
    expect(html).toContain('reusable-cut factor')
    expect(html).toContain('default-src')
  })
})
