import { describe, expect, it } from 'vitest'
import { resolvedCableLine } from './cableGeometry'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import {
  engineeringCsv,
  importRoadLibrary,
  parseProject,
  projectGeoJson,
  projectReportHtml,
  serializeProject,
  serializeRoadLibrary,
  stationsCsv,
  terrainProfileCsv,
  terrainProfileReportHtml,
} from './project'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import type { AlignmentEngineering, Coordinate, RoadAnalysis, RoadProject } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (distanceM: number) => offsetCoordinate(origin, 0, distanceM)

function projectFixture(): RoadProject {
  const project = createDemoProject()
  const engineering: AlignmentEngineering = {
    ...createEngineeringDesign(),
    templates: [
      {
        id: 'wide',
        name: 'Asymmetric bench',
        template: {
          ...DEFAULT_TEMPLATE,
          leftWidth: 5,
          rightWidth: 4,
          leftCrossfallPercent: -4,
          rightCrossfallPercent: 4,
          leftCutSlope: 1.2,
          rightCutSlope: 1.5,
          leftFillSlope: 1.6,
          rightFillSlope: 1.8,
          leftDitchWidth: 1.1,
          rightDitchWidth: 0.8,
          leftDitchDepth: 0.4,
          rightDitchDepth: 0.3,
          leftSurfaceDepth: 0.2,
          rightSurfaceDepth: 0.3,
        },
      },
    ],
    assignments: [
      { id: 'left-range', templateId: 'wide', start: 10, end: 80, side: 'left', transitionM: 10 },
      { id: 'right-range', templateId: 'wide', start: 10, end: 80, side: 'right', transitionM: 5 },
    ],
    materials: [
      {
        id: 'strip',
        name: 'Excavated organic layer',
        color: '#765432',
        cutRate: 3,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
      {
        id: 'soil',
        name: 'Soil, "entered"',
        color: '#997744',
        cutRate: 5,
        reusableFraction: 0.8,
        compactionFactor: 0.9,
        purpose: 'earthwork',
      },
    ],
    strata: [
      { id: 'surface', materialId: 'strip', start: 0, end: 100, topDepthM: 0, bottomDepthM: 0.2 },
      { id: 'deep', materialId: 'soil', start: 0, end: 100, topDepthM: 0.2, bottomDepthM: null },
    ],
    culverts: [
      {
        id: 'culvert',
        name: 'Entered stream crossing',
        kind: 'stream',
        sourceFeatureId: 'stream',
        chainage: 50,
        skewDegrees: 20,
        lengthM: 16,
        diameterM: 0.6,
        inletInvertM: 799.2,
        outletInvertM: 799,
        minCoverM: 0.5,
        unitCost: 130,
        fixedCost: 700,
      },
    ],
    sites: [
      {
        id: 'borrow',
        name: 'Borrow source',
        kind: 'borrow',
        chainage: 20,
        accessDistanceM: 70,
        capacityM3: 1000,
        unitRate: 6,
        fixedCost: 100,
      },
      {
        id: 'waste',
        name: 'Waste destination',
        kind: 'waste',
        chainage: 70,
        accessDistanceM: 20,
        capacityM3: null,
        unitRate: 4,
        fixedCost: 50,
      },
    ],
    haul: {
      enabled: true,
      freeHaulDistanceM: 25,
      overhaulDistanceM: 150,
      freeHaulRate: 0,
      overhaulRate: 2,
      endHaulRate: 4,
      freeHaulLoadingRate: 0,
      overhaulLoadingRate: 0,
      endHaulLoadingRate: 0,
      borrowRate: 8,
      wasteRate: 5,
      mobilizationCost: 500,
      contingencyPercent: 15,
    },
  }
  project.name = 'Engineering persistence fixture'
  project.alignments = [
    {
      id: 'road',
      name: 'Entered road',
      color: '#156b68',
      points: [
        { id: 'start', coordinate: origin, radiusM: 0 },
        { id: 'end', coordinate: north(100), radiusM: 0 },
      ],
      vertical: [
        { id: 'vs', chainage: 0, elevation: 802, curveLength: 0 },
        { id: 've', chainage: 100, elevation: 802, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [
        { id: 'turnout', name: 'Turnout', kind: 'turnout', side: 'right', start: 30, end: 60, taper: 5, extraWidth: 2 },
      ],
      engineering,
    },
  ]
  project.activeAlignmentId = 'road'
  project.context = [
    {
      id: 'stream',
      name: 'Entered stream',
      kind: 'stream',
      geometry: {
        type: 'LineString',
        coordinates: [offsetCoordinate(north(50), 270, 20), offsetCoordinate(north(50), 90, 20)],
      },
    },
  ]
  project.cables = [
    {
      id: 'dline',
      name: 'Offset D-line',
      start: origin,
      end: north(100),
      startHeight: 25,
      endHeight: 7,
      deflectionPercent: 3,
      startOffsetM: 20,
      endOffsetM: 30,
      yarderAt: 'end',
    },
  ]
  project.profiles = [{ id: 'profile', name: 'Ground-only transect', points: [origin, north(100)] }]
  project.terrain = { ...project.terrain, sha256: 'a'.repeat(64), verticalReference: 'Fixture metres, local datum' }
  project.settings = { ...project.settings, stationInterval: 10, crossSectionHalfWidth: 30 }
  return project
}

function analysisFixture(project = projectFixture()): RoadAnalysis {
  return analyzeRoad(project.alignments[0], { elevationAt: () => 800 }, project.settings, project.context)
}

/** Read the generated tabular interchange independently of its writer. */
function readCsv(csv: string): Record<string, string>[] {
  const rows = csv
    .trimEnd()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = []
      let cell = '',
        quoted = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          if (quoted && line[i + 1] === '"') {
            cell += '"'
            i++
          } else quoted = !quoted
        } else if (char === ',' && !quoted) {
          cells.push(cell)
          cell = ''
        } else cell += char
      }
      cells.push(cell)
      return cells
    })
  return rows.slice(1).map((row) => Object.fromEntries(rows[0].map((key, index) => [key, row[index]])))
}

describe('engineering project persistence and portable libraries', () => {
  it('round-trips every engineering input, independent side setting, cable control and ground-only profile', () => {
    const project = projectFixture()
    const restored = parseProject(serializeProject(project))
    expect(restored).toEqual(project)
    expect(restored.alignments[0].engineering?.culverts[0].sourceFeatureId).toBe(restored.context[0].id)
    expect(restored.cables[0]).toEqual(project.cables[0])
    expect(restored.cables[0].start).toEqual(origin)
  })

  it('exports library definitions without carrying geometry, assignments, horizons or site-specific structures', () => {
    const alignment = projectFixture().alignments[0]
    const library = JSON.parse(serializeRoadLibrary(alignment))
    expect(Object.keys(library).sort()).toEqual(['materials', 'schema', 'templates'])
    expect(library.schema).toBe('pgmaps-road-library-v1')
    expect(library.templates).toEqual(alignment.engineering!.templates)
    expect(library.materials).toEqual(alignment.engineering!.materials)
  })

  it('remaps conflicting merge IDs without rebinding existing assignments or mutating either library', () => {
    const alignment = projectFixture().alignments[0]
    alignment.engineering!.templates.push({
      id: 'library-1',
      name: 'Existing generated ID',
      template: { ...DEFAULT_TEMPLATE },
    })
    const original = structuredClone(alignment)
    const library = {
      schema: 'pgmaps-road-library-v1',
      templates: [
        { id: 'wide', name: 'Imported wide', template: { ...DEFAULT_TEMPLATE, leftWidth: 9 } },
        { id: 'library-2', name: 'Imported generated ID', template: { ...DEFAULT_TEMPLATE, rightWidth: 8 } },
      ],
      materials: [
        { ...alignment.engineering!.materials[1], id: 'soil', name: 'Imported soil' },
        { ...alignment.engineering!.materials[1], id: 'wide', name: 'Cross-namespace collision' },
      ],
    }
    const beforeLibrary = structuredClone(library)
    const merged = importRoadLibrary(alignment, JSON.stringify(library), 'merge')
    const design = merged.engineering!
    expect(alignment).toEqual(original)
    expect(library).toEqual(beforeLibrary)
    expect(design.templates.slice(0, 2)).toEqual(original.engineering!.templates)
    expect(design.materials.slice(0, 2)).toEqual(original.engineering!.materials)
    const definitions = [...design.templates, ...design.materials]
    expect(new Set(definitions.map((entry) => entry.id)).size).toBe(definitions.length)
    expect(design.templates.find((entry) => entry.name === 'Imported wide')?.id).not.toBe('wide')
    expect(design.materials.find((entry) => entry.name === 'Imported soil')?.id).not.toBe('soil')
    expect(design.assignments).toEqual(original.engineering!.assignments)
    expect(design.strata).toEqual(original.engineering!.strata)
    expect(design.culverts).toEqual(original.engineering!.culverts)
    const project = projectFixture()
    project.alignments[0] = merged
    expect(parseProject(serializeProject(project)).alignments[0]).toEqual(merged)
  })

  it('replaces definitions and clears dependent ranges while retaining road geometry, culverts and haul settings', () => {
    const project = projectFixture(),
      alignment = project.alignments[0]
    const original = structuredClone(alignment)
    const library = {
      schema: 'pgmaps-road-library-v1',
      templates: [{ id: 'new', name: 'New section', template: { ...DEFAULT_TEMPLATE } }],
      materials: [],
    }
    const replaced = importRoadLibrary(alignment, library, 'replace')
    expect(alignment).toEqual(original)
    expect(replaced.engineering!.templates).toEqual(library.templates)
    expect(replaced.engineering!.materials).toEqual([])
    expect(replaced.engineering!.assignments).toEqual([])
    expect(replaced.engineering!.strata).toEqual([])
    expect(replaced.engineering!.culverts).toEqual(original.engineering!.culverts)
    expect(replaced.engineering!.sites).toEqual(original.engineering!.sites)
    expect(replaced.engineering!.haul).toEqual(original.engineering!.haul)
    expect(replaced.points).toEqual(original.points)
    expect(replaced.vertical).toEqual(original.vertical)
    expect(replaced.template).toEqual(original.template)
    expect(replaced.overrides).toEqual(original.overrides)
    project.alignments[0] = replaced
    expect(parseProject(serializeProject(project)).alignments[0]).toEqual(replaced)
  })

  it.each([
    [
      'same-side overlap',
      (e: AlignmentEngineering) => {
        e.assignments[1].side = 'both'
      },
      /overlap/i,
    ],
    [
      'overlapping horizons',
      (e: AlignmentEngineering) => {
        e.strata[1].topDepthM = 0.1
      },
      /overlap/i,
    ],
    [
      'orphan template',
      (e: AlignmentEngineering) => {
        e.assignments[0].templateId = 'missing'
      },
      /missing template/i,
    ],
    [
      'orphan material',
      (e: AlignmentEngineering) => {
        e.strata[0].materialId = 'missing'
      },
      /missing material/i,
    ],
  ] as const)('rejects %s at the project boundary', (_label, mutate, message) => {
    const project = projectFixture()
    mutate(project.alignments[0].engineering!)
    expect(() => parseProject(project)).toThrow(message)
    expect(() => serializeProject(project)).toThrow(message)
  })

  it('accepts touching range boundaries and rejects collapsed offset spans before saving', () => {
    const project = projectFixture(),
      design = project.alignments[0].engineering!
    design.assignments = [
      { ...design.assignments[0], start: 0, end: 50 },
      { ...design.assignments[0], id: 'next', start: 50, end: 100 },
    ]
    expect(() => parseProject(project)).not.toThrow()
    project.cables[0].startOffsetM = 70
    project.cables[0].endOffsetM = 40
    expect(() => parseProject(project)).toThrow(/collapse or reverse/)
    expect(() => serializeProject(project)).toThrow(/collapse or reverse/)
  })
})

describe('engineering result interchange', () => {
  it('retains bank/compacted units, monetary units, provenance and partial engineering status', () => {
    const project = projectFixture(),
      analysis = analysisFixture(project),
      engineering = analysis.engineering!
    engineering.complete = false
    engineering.movements = [
      {
        id: 'borrow-move',
        kind: 'borrow',
        sourceId: 'borrow',
        targetId: 'fill',
        materialId: null,
        fromChainage: 20,
        toChainage: 40,
        distanceM: 90,
        bankVolumeM3: null,
        compactedVolumeM3: 12,
        transportedVolumeM3: 12,
        volumeBasis: 'compacted',
        category: 'overhaul',
        haulCost: 3.2,
      },
      {
        id: 'waste-move',
        kind: 'waste',
        sourceId: 'cut',
        targetId: 'waste',
        materialId: 'soil',
        fromChainage: 30,
        toChainage: 70,
        distanceM: 60,
        bankVolumeM3: 7,
        compactedVolumeM3: null,
        transportedVolumeM3: 7,
        volumeBasis: 'bank',
        category: 'overhaul',
        haulCost: 2.1,
      },
    ]
    engineering.materials = [
      {
        materialId: 'soil',
        name: 'Soil, "entered"',
        color: '#997744',
        purpose: 'earthwork',
        bankCutM3: 20,
        usableCompactedM3: 12,
        unusableBankM3: 5,
        excavationCost: 100,
      },
    ]
    engineering.culverts[0].complete = false
    engineering.culverts[0].warnings = ['Entered invert needs review']
    const rows = readCsv(engineeringCsv(analysis, project.terrain))
    const material = rows.find((row) => row.record_type === 'material')!
    expect(material).toMatchObject({
      name: 'Soil, "entered"',
      bank_m3: '20',
      compacted_m3: '12',
      quantity: '5',
      unit: 'unusable bank m3',
      cost_cad: '100',
      status: 'partial-covered-subtotal',
    })
    expect(rows.find((row) => row.id === 'borrow-move')).toMatchObject({
      bank_m3: '',
      compacted_m3: '12',
      quantity: '12',
      unit: 'compacted m3',
      haul_distance_m: '90',
    })
    expect(rows.find((row) => row.id === 'waste-move')).toMatchObject({
      bank_m3: '7',
      compacted_m3: '',
      quantity: '7',
      unit: 'bank m3',
      haul_distance_m: '60',
    })
    expect(rows.find((row) => row.id === 'culvert')).toMatchObject({
      quantity: String(engineering.culverts[0].barrelLengthM),
      unit: 'inclined barrel m',
      status: 'Entered invert needs review',
    })
    const costRows = rows.filter((row) => row.record_type === 'cost')
    expect(costRows.length).toBeGreaterThan(1)
    expect(costRows.every((row) => row.unit === 'CAD' && row.status === 'partial-covered-subtotal')).toBe(true)
    expect(
      rows.every(
        (row) =>
          row.terrain_sha256 === project.terrain.sha256 && row.vertical_reference === project.terrain.verticalReference,
      ),
    ).toBe(true)
    const geo = projectGeoJson(project, new Map([['road', analysis]]))
    expect(geo.features.find((feature) => feature.id === 'road')?.properties?.status).toBe('partial-or-not-calculated')
    expect(geo.features.find((feature) => feature.properties?.kind === 'culvert')?.properties).toMatchObject({
      complete: false,
      vertical_reference: project.terrain.verticalReference,
    })
    expect(geo.features.find((feature) => feature.properties?.kind === 'borrow-site')?.properties?.volume_basis).toBe(
      'compacted',
    )
    expect(geo.features.find((feature) => feature.properties?.kind === 'waste-site')?.properties?.volume_basis).toBe(
      'bank',
    )
    engineering.culverts[0].barrelLengthM = null
    expect(readCsv(engineeringCsv(analysis, project.terrain)).find((row) => row.id === 'culvert')).toMatchObject({
      quantity: String(engineering.culverts[0].profile.at(-1)!.distanceM),
      unit: 'provisional horizontal barrel m',
      status: 'Entered invert needs review',
    })
  })

  it('exports effective D-line geometry while retaining the original editable endpoints and roles', () => {
    const project = projectFixture(),
      cable = project.cables[0]
    const effective = resolvedCableLine(cable)
    const feature = projectGeoJson(project, new Map()).features.find((entry) => entry.id === cable.id)!
    expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [effective.start, effective.end] })
    expect(feature.properties).toMatchObject({
      original_start: cable.start,
      original_end: cable.end,
      start_offset_m: 20,
      end_offset_m: 30,
      yarder_at: 'end',
      yarder_height_m: 25,
      tailhold_height_m: 7,
    })
    expect(parseProject(serializeProject(project)).cables[0]).toEqual(cable)
  })

  it.each([
    ['engineering CSV', (p: RoadProject, a: RoadAnalysis) => engineeringCsv(a, p.terrain)],
    ['road report', (p: RoadProject, a: RoadAnalysis) => projectReportHtml(p, a)],
    ['terrain profile report', (p: RoadProject, a: RoadAnalysis) => terrainProfileReportHtml('Profile', a, p.terrain)],
    ['calculated GeoJSON', (p: RoadProject, a: RoadAnalysis) => projectGeoJson(p, new Map([[p.activeAlignmentId, a]]))],
    ['station CSV', (p: RoadProject, a: RoadAnalysis) => stationsCsv(a, p.terrain)],
    ['terrain profile CSV', (p: RoadProject, a: RoadAnalysis) => terrainProfileCsv(a, p.terrain)],
  ] as const)('rejects unavailable analyses in %s', (_label, exportResult) => {
    const project = projectFixture(),
      empty = { ...analysisFixture(project), stations: [], centerline: [] }
    expect(() => exportResult(project, empty)).toThrow(/unavailable|model errors|calculated geometry/i)
  })

  it('keeps terrain profile exports ground-only even when the supplied analysis also has road engineering', () => {
    const project = projectFixture(),
      analysis = analysisFixture(project)
    const first = analysis.stations[0]
    analysis.length = 40
    analysis.stations = [0, 10, 20, 30, 40].map((chainage, index) => ({
      ...first,
      index,
      chainage,
      groundElevation: [100, 110, null, 130, 125][index],
      groundGradePercent: [null, 100, null, null, -50][index],
      designElevation: 9876,
      cutAreaM2: 1234,
      fillAreaM2: 5678,
    }))
    analysis.engineering!.materials[0].name = 'ROAD_MATERIAL_SENTINEL'
    const csv = terrainProfileCsv(analysis, project.terrain),
      rows = readCsv(csv)
    expect(Object.keys(rows[0])).toEqual([
      'station_m',
      'longitude',
      'latitude',
      'ground_elevation_m',
      'ground_grade_percent',
      'interval_length_m',
      'terrain',
      'terrain_resolution_m',
      'vertical_reference',
      'terrain_sha256',
    ])
    expect(rows[2].ground_elevation_m).toBe('')
    expect(rows[2].ground_grade_percent).toBe('')
    expect(csv).not.toContain('9876')
    const report = terrainProfileReportHtml('<Profile & creek>', analysis, project.terrain)
    expect(report).toContain('&lt;Profile &amp; creek&gt;')
    expect(report).toContain('supported intervals 20 m (50%)')
    expect(report).toContain('sampled ascent 10 m')
    expect(report).toContain('sampled descent 5 m')
    expect(report).not.toContain('ROAD_MATERIAL_SENTINEL')
    expect(report).not.toContain('Engineering cost breakdown')
    expect(report).not.toContain('Material quantities')
    expect(report).not.toContain('Scenario cost')
    expect(report).not.toContain('9876')
    expect(report).not.toContain('design (orange)')
    expect(report).not.toContain('Ground and design longitudinal')
  })
})
