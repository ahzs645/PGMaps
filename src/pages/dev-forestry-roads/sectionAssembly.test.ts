import { describe, expect, it } from 'vitest'
import { analyzeRoad, createRoadStationSampler, effectiveWidths, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import { parseSectionComponents, parseSectionLayers, parseSitePreparation } from './sectionAssembly'
import type { Alignment, Coordinate, RoadSettings } from './types'
import { featureSectionAnchor, MAX_REFERENCE_SEGMENT_CHECKS } from './sectionReferences'
import { preparationMarginFeatures } from './preparationFootprint'
import { previewEarthwork } from './previewEarthwork'
import { burnRoad } from './designSurface'
import { cellIndexAt, sampleSurfaceGrid } from './surfaceGrid'

const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 1,
}
const flat = { elevationAt: () => 800 }
function road(level: number): Alignment {
  return {
    id: 'assembly',
    name: 'Assembly',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: level, curveLength: 0 },
      { id: 'b', chainage: 100, elevation: level, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
function prepare(a: Alignment) {
  a.engineering!.materials.push({
    id: 'strip',
    name: 'Stripping',
    color: '#876543',
    purpose: 'stripping',
    cutRate: 5,
    reusableFraction: 0,
    compactionFactor: 1,
  })
  a.engineering!.sitePreparation = [
    {
      id: 'prep',
      start: 0,
      end: 101,
      depthM: 0.2,
      leftInsideM: 0,
      rightInsideM: 0,
      leftOutsideM: 0.3,
      rightOutsideM: 0.3,
      materialId: 'strip',
    },
  ]
}
describe('physical section assemblies', () => {
  it('strips ground beneath a fill, replaces it, conserves excavation and retains source samples', () => {
    const a = road(802)
    prepare(a)
    const result = analyzeRoad(a, flat, settings),
      station = result.stations.find((s) => s.chainage === 50)!
    expect(result.coveragePercent).toBeCloseTo(100, 5)
    expect(station.leftDaylightM).toBeCloseTo(5.2, 5)
    expect(station.fillAreaM2).toBeCloseTo(18.04, 4)
    expect(result.fillVolumeM3).toBeCloseTo(1804, 3)
    expect(result.cutVolumeM3).toBeCloseTo(220, 3)
    expect(result.clearingAreaM2).toBeCloseTo(1100, 3)
    expect(result.engineering!.strippingCutM3).toBeCloseTo(220, 3)
    expect(result.engineering!.costs.stripping).toBeCloseTo(1100, 2)
    expect(sectionSampleAt(station, 0)).toMatchObject({ ground: 800, preparedGround: 799.8, design: 802 })
  })
  it('reduces ordinary cut by the removed overburden instead of counting it twice', () => {
    const a = road(798)
    prepare(a)
    const result = analyzeRoad(a, flat, settings)
    const total = result.engineering!.materials.reduce((sum, m) => sum + m.bankCutM3, 0)
    expect(total).toBeCloseTo(result.cutVolumeM3, 4)
    expect(result.engineering!.materials.find((m) => m.materialId === '__unclassified')!.bankCutM3).toBeCloseTo(
      (6 * 1.8 + 1.8 ** 2) * 100,
      2,
    )
  })
  it('changes cut batter at an entered material boundary', () => {
    const a = road(798)
    a.engineering!.materials.push(
      { id: 'soil', name: 'Soil', color: '#885533', cutRate: 2, reusableFraction: 1, compactionFactor: 1, cutSlope: 2 },
      {
        id: 'rock',
        name: 'Rock',
        color: '#555555',
        cutRate: 10,
        reusableFraction: 1,
        compactionFactor: 1,
        cutSlope: 0.5,
      },
    )
    a.engineering!.strata.push(
      { id: 's', start: 0, end: 101, materialId: 'soil', topDepthM: 0, bottomDepthM: 1 },
      { id: 'r', start: 0, end: 101, materialId: 'rock', topDepthM: 1, bottomDepthM: null },
    )
    const result = analyzeRoad(a, flat, settings),
      station = result.stations.find((s) => s.chainage === 50)!
    expect(station.leftDaylightM).toBeCloseTo(5.5, 4)
    expect(station.cutAreaM2).toBeCloseTo(15.5, 4)
    expect(sectionSampleAt(station, 3.5).design).toBeCloseTo(799, 4)
  })
  it('uses an exact subgrade fill material slope when assigned', () => {
    const a = road(802)
    a.engineering!.materials.push({
      id: 'rockfill',
      name: 'Rock fill',
      color: '#555555',
      cutRate: 3,
      reusableFraction: 1,
      compactionFactor: 1,
      fillSlope: 0.5,
    })
    a.engineering!.fillRequirements = [
      { id: 'f', start: 0, end: 101, layer: 'subgrade', materialId: 'rockfill', replaceable: false },
    ]
    const result = analyzeRoad(a, flat, settings)
    expect(result.stations.find((s) => s.chainage === 50)!.rightDaylightM).toBeCloseTo(4, 5)
  })
  it('uses a conservative fill batter across every permitted quality substitution', () => {
    const a = road(802)
    a.engineering!.materials.push(
      {
        id: 'a',
        name: 'Reference rock',
        color: '#555555',
        cutRate: 3,
        reusableFraction: 1,
        compactionFactor: 1,
        quality: 50,
        fillSlope: 0.5,
      },
      {
        id: 'b',
        name: 'Eligible soil',
        color: '#885533',
        cutRate: 3,
        reusableFraction: 1,
        compactionFactor: 1,
        quality: 60,
        fillSlope: 2,
      },
      {
        id: 'c',
        name: 'Unsuitable soil',
        color: '#777777',
        cutRate: 3,
        reusableFraction: 1,
        compactionFactor: 1,
        quality: 10,
        fillSlope: 4,
      },
    )
    a.engineering!.fillRequirements = [
      { id: 'f', start: 0, end: 101, layer: 'subgrade', materialId: 'a', replaceable: true },
    ]
    const result = analyzeRoad(a, flat, settings)
    expect(result.stations.find((s) => s.chainage === 50)!.rightDaylightM).toBeCloseTo(7, 5)
  })
  it('constructs benches in order and exposes their real point codes', () => {
    const a = road(798)
    a.template.components = [
      {
        id: 'bench',
        name: 'Cut bench',
        side: 'left',
        kind: 'bench',
        condition: 'cut',
        widthM: 2,
        riseM: 0,
        code: 'bench-outer',
      },
    ]
    const result = analyzeRoad(a, flat, settings),
      s = result.stations.find((s) => s.chainage === 50)!
    expect(s.leftDaylightM).toBeCloseTo(7, 5)
    expect(s.rightDaylightM).toBeCloseTo(5, 5)
    expect(sectionCodePoints(s, a.template).find((p) => p.code === 'bench-outer')).toMatchObject({
      offset: -5,
      design: 798,
    })
  })
  it('excavates a key below fill and includes its replacement without doubling fill demand', () => {
    const a = road(802)
    a.template.components = [
      {
        id: 'key',
        name: 'Rock key',
        side: 'left',
        kind: 'key',
        condition: 'fill',
        widthM: 1,
        riseM: 0,
        depthM: 1,
        offsetM: 0,
      },
    ]
    const result = analyzeRoad(a, flat, settings),
      s = result.stations.find((s) => s.chainage === 50)!
    expect(result.cutVolumeM3).toBeCloseTo(100, 3)
    expect(result.fillVolumeM3).toBeCloseTo(1700, 2)
    expect(s.componentAreas?.[0]).toMatchObject({ id: 'key', areaM2: 1 })
    expect(sectionSampleAt(s, -3.5).preparedGround).toBe(799)
  })
  it('demands only the physically refilled part of a key in a cut or partial replacement', () => {
    for (const [level, width, expected] of [
      [798, 1, 0],
      [799.5, 0.25, 0.15625],
    ] as const) {
      const a = road(level)
      a.template.components = [
        {
          id: 'key',
          name: 'Key',
          side: 'left',
          kind: 'key',
          condition: 'always',
          widthM: width,
          riseM: 0,
          depthM: 1,
          offsetM: 0,
        },
      ]
      const result = analyzeRoad(a, flat, settings),
        s = result.stations.find((s) => s.chainage === 50)!
      expect(s.componentAreas?.[0].areaM2).toBeCloseTo(expected, 4)
      expect((s.componentAreas ?? []).reduce((sum, c) => sum + c.areaM2, 0)).toBeLessThanOrEqual(s.fillAreaM2! + 1e-6)
    }
  })
  it('rejects an active key outside the constructed footprint while skipping a nonmatching condition', () => {
    const a = road(802)
    a.template.components = [
      {
        id: 'key',
        name: 'Outside key',
        side: 'left',
        kind: 'key',
        condition: 'fill',
        widthM: 1,
        riseM: 0,
        depthM: 1,
        offsetM: 20,
      },
    ]
    const result = analyzeRoad(a, flat, settings)
    expect(result.coveragePercent).toBe(0)
    expect(result.stations[0].flags.join(' ')).toContain('requested key extends outside')
    expect(result.cutVolumeM3).toBe(0)
    a.vertical = a.vertical.map((v) => ({ ...v, elevation: 798 }))
    const cut = analyzeRoad(a, flat, settings)
    expect(cut.coveragePercent).toBeCloseTo(100, 5)
    expect(cut.stations[0].flags.join(' ')).not.toContain('requested key')
  })
  it('classifies key excavation from actual entered ground horizons', () => {
    const a = road(802)
    a.engineering!.materials.push(
      { id: 'soil', name: 'Soil', color: '#885533', cutRate: 2, reusableFraction: 1, compactionFactor: 1 },
      { id: 'rock', name: 'Rock', color: '#555555', cutRate: 10, reusableFraction: 1, compactionFactor: 1 },
    )
    a.engineering!.strata.push(
      { id: 'soil', start: 0, end: 101, materialId: 'soil', topDepthM: 0, bottomDepthM: 0.4 },
      { id: 'rock', start: 0, end: 101, materialId: 'rock', topDepthM: 0.4, bottomDepthM: null },
    )
    a.template.components = [
      {
        id: 'key',
        name: 'Key',
        side: 'left',
        kind: 'key',
        condition: 'fill',
        widthM: 1,
        riseM: 0,
        depthM: 1,
        offsetM: 0,
      },
    ]
    const result = analyzeRoad(a, flat, settings)
    expect(result.engineering!.materials.find((m) => m.materialId === 'soil')?.bankCutM3).toBeCloseTo(40, 3)
    expect(result.engineering!.materials.find((m) => m.materialId === 'rock')?.bankCutM3).toBeCloseTo(60, 3)
    expect(result.engineering!.costs.cut).toBeCloseTo(680, 3)
  })
  it('merges copied component identities once during dimension transitions', () => {
    const a = road(806),
      id = 'key-component'
    a.template.components = [
      { id, name: 'Key', side: 'left', kind: 'key', condition: 'fill', widthM: 2, riseM: 0, depthM: 1, offsetM: 0 },
    ]
    a.engineering!.templates.push({
      id: 'deep',
      name: 'Deep key',
      template: { ...a.template, components: [{ ...a.template.components[0], widthM: 4, depthM: 3 }] },
    })
    a.engineering!.assignments.push({ id: 'a', start: 0, end: 100, side: 'left', templateId: 'deep', transitionM: 50 })
    const station = createRoadStationSampler(a, flat, settings).at(25)
    expect(station.preparationAreas?.reduce((sum, p) => sum + p.areaM2, 0)).toBeCloseTo(6, 4)
    expect(station.componentAreas).toHaveLength(1)
    expect(station.componentAreas?.[0].areaM2).toBeCloseTo(6, 4)
    a.engineering!.templates[0].template.components![0].condition = 'always'
    expect(() => analyzeRoad(a, flat, settings)).toThrow(/step assignment/)
  })
  it('requires enough section reach for the whole preparation footprint', () => {
    const a = road(802)
    prepare(a)
    a.engineering!.sitePreparation![0].leftOutsideM = 50
    const result = analyzeRoad(a, flat, settings)
    expect(result.coveragePercent).toBe(0)
    expect(result.stations[0].flags.join(' ')).toContain('Site preparation extends beyond')
    expect(result.cutVolumeM3).toBe(0)
  })
  it('quantifies a multi-course stack instead of adding legacy surfacing twice', () => {
    const a = road(802)
    a.template.surfaceDepth = 1
    a.template.layers = [
      { id: 'base', name: 'Base', side: 'both', depthM: 0.2 },
      { id: 'wear', name: 'Wearing', side: 'left', depthM: 0.1 },
    ]
    const result = analyzeRoad(a, flat, settings)
    expect(result.surfaceVolumeM3).toBeCloseTo(150, 5)
    expect(result.stations[0].layerAreas?.map((l) => l.id)).toEqual(['base', 'wear'])
    expect(result.stations[0].layerAreas?.[0].areaM2).toBeCloseTo(1.2, 8)
    expect(result.stations[0].layerAreas?.[1].areaM2).toBeCloseTo(0.3, 8)
  })
  it('uses independent entry and exit taper lengths', () => {
    const a = road(802)
    a.overrides.push({
      id: 'w',
      name: 'Turnout',
      kind: 'turnout',
      side: 'left',
      start: 0,
      end: 100,
      extraWidth: 4,
      taper: 10,
      entryTaperM: 20,
      exitTaperM: 40,
    })
    expect(effectiveWidths(a, 10).leftWidth).toBe(5)
    expect(effectiveWidths(a, 80).leftWidth).toBe(5)
    expect(effectiveWidths(a, 40).leftWidth).toBe(7)
    a.overrides[0].entryTaperM = undefined
    a.overrides[0].exitTaperM = undefined
    a.overrides[0].taper = 1000
    expect(effectiveWidths(a, 50).leftWidth).toBe(7)
  })
  it('rejects overlapping preparation and duplicate or invalid assembly definitions', () => {
    const a = road(802)
    prepare(a)
    expect(() =>
      parseSitePreparation([
        ...a.engineering!.sitePreparation!,
        { ...a.engineering!.sitePreparation![0], id: 'second' },
      ]),
    ).toThrow(/overlap/)
    expect(() => parseSectionLayers([{ id: 'x', name: 'x', side: 'both', depthM: -1 }])).toThrow(/depth/)
    expect(() =>
      parseSectionComponents([
        { id: 'x', name: 'x', side: 'left', kind: 'wall', condition: 'always', widthM: 0, riseM: 2 },
      ]),
    ).toThrow(/width/)
  })
  it('anchors a component to a real 3D feature and to a named analytical surface', () => {
    const a = road(798)
    const leftFeature = {
      id: 'bench-reference',
      name: 'Survey bench',
      kind: 'existing-road' as const,
      referenceVerticalDatum: 'CGVD2013',
      geometry: {
        type: 'LineString' as const,
        coordinates: [-50, 150].map((s) => [...offsetCoordinate(offsetCoordinate(origin, 0, s), 270, 6), 799]),
      },
    }
    a.template.components = [
      {
        id: 'anchor',
        name: 'Anchored bench',
        side: 'left',
        kind: 'slope',
        condition: 'cut',
        widthM: 1,
        riseM: 0,
        referenceFeatureId: leftFeature.id,
        code: 'survey-edge',
      },
    ]
    const analysis = analyzeRoad(a, flat, settings, [leftFeature], { verticalReference: 'CGVD2013' }),
      station = analysis.stations.find((s) => s.chainage === 50)!
    const point = sectionCodePoints(station, a.template).find((p) => p.code === 'survey-edge')!
    expect(point.offset).toBeCloseTo(-6, 3)
    expect(point.design).toBeCloseTo(799, 5)
    a.template.components[0].referenceSurfaceId = 'measured-bench'
    a.template.components[0].referenceElevationM = 0.25
    const refs = { 'measured-bench': { elevationAt: () => 799.5 } }
    const referenced = analyzeRoad(a, flat, settings, [leftFeature], { referenceSurfaces: refs })
    const at = referenced.stations.find((s) => s.chainage === 50)!
    expect(sectionCodePoints(at, a.template).find((p) => p.code === 'survey-edge')?.design).toBeCloseTo(799.75, 5)
    const dense = createRoadStationSampler(a, flat, settings, { context: [leftFeature], referenceSurfaces: refs }).at(
      50,
    )
    expect(dense.leftDaylightM).toBeCloseTo(at.leftDaylightM!, 7)
  })
  it('marks missing references incomplete and enforces bounded feature work', () => {
    const a = road(798)
    a.template.components = [
      {
        id: 'anchor',
        name: 'Bench',
        side: 'left',
        kind: 'bench',
        condition: 'always',
        widthM: 1,
        riseM: 0,
        referenceSurfaceId: 'missing-surface',
      },
    ]
    const analysis = analyzeRoad(a, flat, settings)
    expect(analysis.coveragePercent).toBe(0)
    expect(analysis.stations[0].flags.join(' ')).toContain('missing-surface')
    const feature = {
      id: 'x',
      name: 'x',
      kind: 'existing-road' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-122.9, 53.8],
          [-122.9, 54],
        ],
      },
    }
    expect(() => featureSectionAnchor(feature, origin, 0, 'left', { checks: MAX_REFERENCE_SEGMENT_CHECKS })).toThrow(
      /budget/,
    )
  })
  it('does not accept a 3D feature with an unknown or different vertical datum', () => {
    const a = road(798)
    a.template.components = [
      {
        id: 'anchor',
        name: 'Bench',
        side: 'left',
        kind: 'bench',
        condition: 'always',
        widthM: 1,
        riseM: 0,
        referenceFeatureId: 'f',
      },
    ]
    const feature = {
      id: 'f',
      name: '3D survey',
      kind: 'existing-road' as const,
      referenceVerticalDatum: 'CGVD28',
      geometry: {
        type: 'LineString' as const,
        coordinates: [-50, 150].map((s) => [...offsetCoordinate(offsetCoordinate(origin, 0, s), 270, 6), 799]),
      },
    }
    const result = analyzeRoad(a, flat, settings, [feature], { verticalReference: 'CGVD2013' })
    expect(result.coveragePercent).toBe(0)
    expect(result.stations[0].flags.join(' ')).toContain('matching vertical datum')
  })
  it('shares supported stripping margins between plan, 3D and the drainage surface', () => {
    const a = road(802)
    prepare(a)
    const result = analyzeRoad(a, flat, settings),
      stations = result.stations.filter((s) => s.chainage === 40 || s.chainage === 50)
    expect(preparationMarginFeatures(stations[0], stations[1])).toHaveLength(2)
    expect(
      previewEarthwork(stations, (s, offset, elevation) => ({ x: offset, y: s.chainage, z: elevation })).faces.filter(
        (f) => f.fill === '#a16207',
      ),
    ).toHaveLength(2)
    const r = 6371008.8,
      rad = Math.PI / 180
    const toGrid = (p: Coordinate): [number, number] => [
      (p[0] - origin[0]) * rad * r * Math.cos(origin[1] * rad),
      (p[1] - origin[1]) * rad * r,
    ]
    const toLonLat = ([x, y]: [number, number]): Coordinate => [
      origin[0] + x / (r * rad * Math.cos(origin[1] * rad)),
      origin[1] + y / (r * rad),
    ]
    const source = sampleSurfaceGrid(flat, [-8, 40, 8, 60], toLonLat, { cellM: 0.1 })
    const burned = burnRoad(source, result, toGrid).surface
    expect(burned.values[cellIndexAt(burned, -5.4, 50)]).toBeCloseTo(799.8, 3)
    expect(burned.values[cellIndexAt(burned, -6, 50)]).toBe(800)
  })
})
