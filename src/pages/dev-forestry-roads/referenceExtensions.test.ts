import { describe, expect, it } from 'vitest'
import { createDemoProject, demoTerrain } from './terrain'
import { createEngineeringDesign } from './engineeringTypes'
import { parseProject, serializeProject, projectGeoJson, importContextGeoJson, projectReportHtml } from './project'
import { createRoadReportSettings } from './reportSettings'
import { addVerticalAlternative } from './verticalAlternatives'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage } from './drainageRun'
import { createDrainageEvidence } from './drainageEvidence'
import { analyzeRoad } from './engine'
import { localMetricGrid } from './terrain'
import { DEFAULT_ROUTE_OPTIONS } from './routing'

function extendedProject() {
  const project = createDemoProject()
  const road = project.alignments[0]
  road.engineering = createEngineeringDesign()
  road.engineering.materials = [
    {
      id: 'rock',
      name: 'Measured rock',
      color: '#777777',
      cutRate: 20,
      reusableFraction: 1,
      compactionFactor: 0.9,
      quality: 80,
      cutSlope: 0.5,
      fillSlope: 1.5,
    },
    {
      id: 'organics',
      name: 'Organic stripping',
      color: '#654321',
      cutRate: 5,
      reusableFraction: 0,
      compactionFactor: 1,
      purpose: 'stripping',
    },
  ]
  road.template.components = [
    {
      id: 'bench',
      name: 'Bench',
      side: 'left',
      kind: 'bench',
      condition: 'cut',
      widthM: 1,
      riseM: 0.1,
      code: 'bench-edge',
    },
  ]
  road.template.layers = [{ id: 'wearing', name: 'Wearing course', side: 'both', depthM: 0.15, materialId: 'rock' }]
  road.engineering.sitePreparation = [
    {
      id: 'strip',
      start: 10,
      end: 40,
      depthM: 0.2,
      leftInsideM: 0,
      rightInsideM: 0,
      leftOutsideM: 0.3,
      rightOutsideM: 0.3,
      materialId: 'organics',
    },
  ]
  road.engineering.fillRequirements = [
    { id: 'fill', start: 0, end: 100, layer: 'subgrade', minQuality: 60, replaceable: true },
  ]
  road.engineering.haul = {
    ...road.engineering.haul,
    allocation: 'economic',
    directionRanges: [{ id: 'down-chain', start: 10, end: 100, direction: 'backward' }],
    sidecastRanges: [
      { id: 'disposal', start: 10, end: 40, capacityBankM3PerM: 2, unitRate: 3, materialIds: ['organics'] },
    ],
  }
  road.engineering.sites = [
    {
      id: 'pit',
      name: 'Rock pit',
      kind: 'borrow',
      chainage: 0,
      accessDistanceM: 20,
      capacityM3: 1000,
      unitRate: 5,
      fixedCost: 500,
      materialId: 'rock',
    },
  ]
  road.overrides[0] = { ...road.overrides[0], entryTaperM: 5, exitTaperM: 15 }
  road.curveDesign = {
    criteriaName: 'Entered forestry criteria',
    criteriaSource: 'Engineering review ABC',
    designSpeedKmh: 20,
    maxSuperelevationPercent: 8,
    sideFrictionFactor: 0.15,
    runoffLengthM: 30,
    wideningVehicleLengthM: null,
    insideWideningM: 0.1,
    outsideWideningM: 0.2,
    wideningTable: [{ radiusM: 25, deflectionDegrees: 90, insideM: 1, outsideM: 0.5 }],
  }
  road.verticalStandards = {
    gradeRanges: [],
    minSagK: 2,
    minCrestK: 1,
    minCurveLengthM: 0,
    minTangentLengthM: 0,
    curvatureRanges: [{ id: 'linear', start: 0, end: 10, minSagK: null, minCrestK: null, linear: true }],
  }
  project.alignments[0] = addVerticalAlternative(road, 'lower', 'Lower profile')
  project.reportSettings = createRoadReportSettings()
  project.reportSettings.paper = 'A4'
  project.reportSettings.stationLabel = '{road} {station}'
  project.drainage = {
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, rainfallMmPerHr: 75 },
    pourPoint: { coordinate: [...road.points[0].coordinate], surface: 'design', snapRadiusM: 10 },
    watershedMinAreaHa: 0.4,
    records: [],
  }
  project.surveyBooks = [
    {
      id: 'book',
      name: 'Tie-in traverse',
      epsg: 26910,
      verticalReference: 'Entered CGVD2013',
      input: {
        start: [500000, 5900000, 800],
        adjustment: 'none',
        legs: [{ id: 'P1', bearingDegrees: 20, horizontalDistanceM: 10, gradePercent: 5 }],
      },
    },
  ]
  const stream = project.context.find((feature) => feature.kind === 'stream')!
  stream.crossingCost = 12345
  stream.crossingGroup = 'reviewed-small-streams'
  project.routeSearch = { ...DEFAULT_ROUTE_OPTIONS, crossingGroups: { 'reviewed-small-streams': 10000 } }
  return project
}

describe('reference extension integration and portable projects', () => {
  it('retains section, materials, criteria, alternative, drainage, drawing and survey inputs together', () => {
    const project = extendedProject()
    const restored = parseProject(serializeProject(project))
    expect(restored.alignments[0]).toEqual({ ...project.alignments[0], verticalAlternativeCostMode: 'shared' })
    expect(restored.reportSettings).toEqual(project.reportSettings)
    expect(restored.drainage).toEqual(project.drainage)
    expect(restored.surveyBooks).toEqual(project.surveyBooks)
    expect(restored.context).toEqual(project.context)
    expect(restored.routeSearch).toEqual(project.routeSearch)
  })

  it('preserves per-stream costs and groups through geographic context handoff', () => {
    const project = extendedProject()
    const geojson = projectGeoJson(project, new Map())
    const context = importContextGeoJson({
      type: 'FeatureCollection',
      features: geojson.features.filter((feature) => feature.properties?.kind === 'stream'),
    })
    expect(context[0].crossingCost).toBe(12345)
    expect(context[0].crossingGroup).toBe('reviewed-small-streams')
  })

  it('retains measured reference-feature heights only with an explicit vertical datum', () => {
    const project = createDemoProject()
    const stream = project.context.find((feature) => feature.kind === 'stream')!
    if (stream.geometry.type !== 'LineString') throw Error('Expected stream line')
    stream.geometry.coordinates = stream.geometry.coordinates.map((xy) => [...xy, 812.5])
    stream.referenceVerticalDatum = project.terrain.verticalReference
    const restored = parseProject(serializeProject(project))
    const saved = restored.context.find((feature) => feature.id === stream.id)!
    expect((saved.geometry as GeoJSON.LineString).coordinates[0][2]).toBe(812.5)
    const geojson = projectGeoJson(restored, new Map())
    const imported = importContextGeoJson({
      type: 'FeatureCollection',
      features: geojson.features.filter((feature) => feature.properties?.kind === 'stream'),
    })
    expect(imported[0].referenceVerticalDatum).toBe(project.terrain.verticalReference)
    expect((imported[0].geometry as GeoJSON.LineString).coordinates[0][2]).toBe(812.5)
    delete stream.referenceVerticalDatum
    expect(
      (parseProject(project).context.find((feature) => feature.id === stream.id)!.geometry as GeoJSON.LineString)
        .coordinates[0],
    ).toHaveLength(2)
  })

  it('rejects invalid nested extension data rather than dropping it on autosave', () => {
    const project = extendedProject()
    project.alignments[0].engineering!.materials[0].quality = 101
    expect(() => serializeProject(project)).toThrow(/quality/i)
    project.alignments[0].engineering!.materials[0].quality = 80
    project.alignments[0].template.layers![0].depthM = -1
    expect(() => serializeProject(project)).toThrow(/depth/i)
    project.alignments[0].template.layers![0].depthM = 0.15
    project.alignments[0].verticalAlternatives![1].vertical[1].elevation = Infinity
    expect(() => parseProject(project)).toThrow(/elevation/i)
  })

  it('includes portable drainage evidence and its inputs in the road report', () => {
    const project = createDemoProject()
    const road = project.alignments[0],
      analysis = analyzeRoad(road, demoTerrain, project.settings, project.context)
    const grid = localMetricGrid(road.points[0].coordinate)
    const settings = { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 20 }
    const run = runDrainage({
      terrain: demoTerrain,
      analysis,
      culverts: [],
      ...grid,
      settings,
      resolutionM: 10,
      maxCells: 100000,
    })
    const evidence = createDrainageEvidence(
      run,
      { alignment: road, terrain: project.terrain, roadSettings: project.settings, settings },
      '2026-10-30T12:00:00Z',
    )
    project.drainage = { settings, records: [evidence] }
    const report = projectReportHtml(parseProject(serializeProject(project)), analysis)
    expect(report).toContain('Drainage')
    expect(report).toContain('2026-10-30T12:00:00Z')
    expect(report).toContain('50')
    expect(report).not.toContain('Drainage evidence is out of date')
  })
})
