import { describe, it, expect } from 'vitest'
import { computeAnalysis } from './analysis'
import { assessmentAlterationClipper } from './assessmentMaskGeometry'
import { assessmentMaskSampler, parseMasks } from './assessmentMasks'
import {
  comparisonScene,
  earlierToolViews,
  emptyTools,
  greenUpJobs,
  greenUpSensitiveOpenings,
  greenUpSensitivityAges,
  heightAtAge,
  matchingDesign,
  matrixJobs,
  parseGrowthCurve,
  parseTools,
  plannedToolViews,
  serializeTools,
  stabilityJobs,
  summarizeRun,
  timelineScene,
  withPlannedViews,
  type ToolView,
} from './assessmentTools'
import { viewAtPoint } from './viewsOfInterest'
import { localRasterResolution, parseRasters, rasterSampler } from '@/lib/forestry/terrain/localRaster'
import { createEmptyScene, createSampleScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import { traceSightlineProfile } from './sightlineProfile'
import { buildEvidenceHtml, evidenceGaps } from './toolEvidence'
import { pointInPolygon, DEFAULT_SIGHTLINE_OPTIONS, testSightline } from './visibility'
import { assessVia, partialCutEntries } from './via'
import type { LocalRaster, AssessmentMask } from './types'
import { partialCutEquivalentPercent } from './vqo'
const box = (a: number, b: number, c: number, d: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
      [a, b],
    ],
  ],
})
function scene(): ForestryScene {
  const base = createEmptyScene()
  const target = (id: string, role: 'landscape' | 'block', geometry: GeoJSON.Polygon) => ({
    id,
    name: id,
    role,
    geometry,
    objectiveId: 'partial-retention' as const,
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    source: 'test',
  })
  return {
    ...base,
    assessmentYear: 2026,
    viewpoint: { id: 'view', name: 'View', mode: 'spot', coordinates: [[-0.04, 0]] },
    activeLandformId: 'land',
    targets: [
      target('land', 'landscape', box(-0.02, -0.01, 0.02, 0.01)),
      target('block', 'block', box(0, -0.01, 0.02, 0.01)),
    ],
    settings: {
      ...base.settings,
      observerHeightMeters: 3000,
      maxViewDistanceMeters: 20000,
      sampleBudget: 1200,
      greenAreaConfirmed: true,
      existingDisturbanceConfirmed: true,
    },
  }
}
const flat = { elevationAt: () => 0 },
  terrain = { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 }
const analyse = (s: ForestryScene) => computeAnalysis(flat, buildSceneInput(s), terrain)
const raster: LocalRaster = {
  id: 'raster',
  name: 'DEM',
  kind: 'terrain',
  epsg: 4326,
  origin: [0, 0],
  pixelSize: [1, -1],
  width: 2,
  height: 2,
  values: [0, 10, 20, 30],
  acquired: '2026-09-30',
  verticalReference: 'metres, test datum',
  sha256: 'a'.repeat(64),
}
const mask = (kind: AssessmentMask['kind'], geometry = box(0, -0.01, 0.02, 0.01)): AssessmentMask => ({
  id: 'mask',
  name: 'Test mask',
  kind,
  geometry,
  source: 'field reviewed',
})

describe('assessment masks and source sampling', () => {
  it('removes natural ground from the denominator and numerator, preserves private/permanent ground, and nets retained patches', () => {
    const s = scene(),
      baseline = analyse(s)
    expect(Math.abs(baseline.planimetricAlteration!.proposedPercent - 50)).toBeLessThan(2)
    for (const kind of ['private', 'permanent', 'retained'] as const) {
      const r = analyse({ ...s, masks: [mask(kind)] })
      expect(r.planimetricAlteration!.proposedPercent).toBe(0)
      expect(r.landformForestedAreaMeters).toBe(baseline.landformForestedAreaMeters)
    }
    const natural = analyse({ ...s, masks: [mask('natural')] })
    expect(natural.planimetricAlteration!.proposedPercent).toBe(0)
    expect(natural.landformForestedAreaMeters! / baseline.landformForestedAreaMeters!).toBeCloseTo(0.5, 1)
  })
  it('natural exclusion takes precedence and under-resolved masks keep the assessment provisional', () => {
    const m = mask('natural'),
      retained = { ...m, id: 'retained', kind: 'retained' as const }
    expect(assessmentMaskSampler([m, retained])(0.01, 0)).toMatchObject({ excludeGreen: true, retained: true })
    const tiny = mask('retained', box(0.000001, 0.000001, 0.000002, 0.000002))
    const result = analyse({ ...scene(), masks: [tiny] })
    expect(result.quality?.numericalReady).toBe(false)
    expect(result.quality?.warnings.some((w) => w.includes('Test mask'))).toBe(true)
    expect(() => parseMasks([{ ...m, kind: 'toString' }])).toThrow()
    expect(() => parseMasks([m, m])).toThrow('unique')
  })
  it('samples native raster centres, interpolates and preserves unknown data', () => {
    const source = rasterSampler(parseRasters([raster])[0])
    expect(source.elevationAt(0.5, -0.5)).toBe(15)
    expect(source.elevationAt(0, 0)).toBe(0)
    expect(source.elevationAt(1, -1)).toBe(30)
    expect(source.elevationAt(-0.001, 0)).toBeNaN()
    expect(rasterSampler({ ...raster, values: [0, null, 20, 30] }).elevationAt(0.5, -0.5)).toBeNaN()
    expect(() => parseRasters([{ ...raster, kind: 'canopy', values: [-1, 0, 0, 0] }])).toThrow()
    expect(() => parseRasters([{ ...raster, epsg: 9999 }])).toThrow()
    expect(localRasterResolution({ ...raster, epsg: 3005, pixelSize: [1, -1] }, 54)).toBe(1)
  })
  it('keeps retained and excluded ground out of the drawn clearing, including holes', () => {
    const outline = box(0, 0, 0.02, 0.02),
      retained = mask('retained', box(0.005, 0.005, 0.015, 0.015))
    const clipped = assessmentAlterationClipper([retained])(outline)!
    expect(pointInPolygon(clipped, 0.01, 0.01)).toBe(false)
    expect(pointInPolygon(clipped, 0.001, 0.001)).toBe(true)
    expect(assessmentAlterationClipper([mask('retained', outline)])(outline)).toBeNull()
    const natural = mask('natural', outline)
    expect(assessmentAlterationClipper([natural])(outline)).toEqual(outline)
  })
  it('does not award Table 5 retention a second time for explicit retained geometry', () => {
    const s = { ...scene(), masks: [mask('retained')] },
      result = analyse(s)
    const review = { retention: 'high' as const }
    expect(
      assessVia({
        objectiveId: 'partial-retention',
        result,
        review,
        blocks: s.targets.filter((t) => t.role === 'block'),
      }).retentionFactor,
    ).toBe(0)
  })
  it('does not add a partial-cut equivalent for retained or excluded ground', () => {
    const s = scene()
    const block = {
      ...s.targets[1],
      harvestSystem: 'partial' as const,
      volumeRemovedPercent: 40,
      residualHeightMeters: 15,
    }
    s.targets[1] = block
    expect(partialCutEntries([block], analyse(s))[0].visible).toBe(true)
    for (const kind of ['retained', 'private', 'permanent', 'natural'] as const) {
      expect(partialCutEntries([block], analyse({ ...s, masks: [mask(kind)] }))[0].visible).toBe(false)
    }
  })
})
describe('independent saved assessments', () => {
  it('compares designs with a frozen common denominator and context', () => {
    const base = scene(),
      option = {
        ...scene(),
        activeLandformId: 'wrong',
        settings: { ...base.settings, sampleBudget: 800 },
        targets: scene().targets.map((t) => ({ ...t, id: `other-${t.id}` })),
        masks: [mask('retained')],
      }
    const next = comparisonScene(base, option)
    expect(next.activeLandformId).toBe('land')
    expect(next.settings).toEqual(base.settings)
    expect(next.targets.map((t) => t.id)).toEqual(['land', 'other-block'])
    expect(next.masks?.[0].kind).toBe('retained')
    expect(next.viaReview).toEqual({})
    expect(base.targets[1].id).toBe('block')
  })
  it('creates separate viewpoint/landform pairs and bounds batch work', () => {
    const base = scene(),
      view = {
        id: 'saved',
        name: 'Public road',
        viewpoint: base.viewpoint,
        landformId: 'land',
        notes: 'Public viewing opportunity',
      }
    const jobs = matrixJobs(base, [view], ['land'])
    expect(jobs[0].scene.activeLandformId).toBe('land')
    expect(jobs[0].viewId).toBe('saved')
    expect(() => matrixJobs(base, Array(13).fill(view), ['land'])).toThrow('12')
    expect(() => matrixJobs(base, [view], ['gone'])).toThrow('no longer')
    expect(stabilityJobs({ ...base, localRasters: [raster] })).toHaveLength(7)
    expect(stabilityJobs(base)[1].scene.settings.sampleBudget).toBe(2400)
  })
  it('schedules harvest and applies supplied height curves without extrapolation', () => {
    const base = scene()
    base.targets[1].plannedHarvestYear = 2030
    const curve = parseGrowthCurve('0,0\n10,3\n20,8')
    expect(heightAtAge(curve, 15)).toBe(5.5)
    expect(heightAtAge(curve, 30)).toBeNull()
    expect(timelineScene(base, 2029, curve, { block: 4 }).targets.some((t) => t.id === 'block')).toBe(false)
    expect(timelineScene(base, 2030, curve, { block: 4 }).targets[1].role).toBe('block')
    expect(timelineScene(base, 2040, curve, { block: 4 }).targets[1]).toMatchObject({
      role: 'harvested',
      recoveryPercent: 0,
    })
    expect(timelineScene(base, 2050, curve, { block: 4 }).targets[1].recoveryPercent).toBe(100)
    expect(timelineScene(base, 2070, curve, { block: 4 }).targets[1].recoveryPercent).toBeNull()
    expect(() =>
      timelineScene(
        { ...base, targets: base.targets.map((t) => ({ ...t, plannedHarvestYear: null })) },
        2030,
        curve,
        {},
      ),
    ).toThrow('planned')
    expect(() => parseGrowthCurve('0,\n10,2')).toThrow()
    expect(() => parseGrowthCurve('0,3\n10,2')).toThrow()
    expect(sceneFingerprint(base)).toBe(
      sceneFingerprint({ ...base, targets: base.targets.map((t) => ({ ...t, plannedHarvestYear: 2040 })) }),
    )
  })
  it('grows each block on its own loaded curve, else the supplied one', () => {
    const base = scene()
    base.targets[1].plannedHarvestYear = 2030
    const supplied = parseGrowthCurve('0,0\n40,4')
    const castor = {
      id: 'castor:7',
      label: '7',
      source: 'Castor yield table yields.csv',
      points: parseGrowthCurve('0,0\n10,6'),
    }
    // Ten years on, the supplied curve reads 1 m (not greened up at 4 m); the block's own curve reads 6 m.
    expect(timelineScene(base, 2040, supplied, { block: 4 }).targets[1].recoveryPercent).toBe(0)
    const own = timelineScene(base, 2040, supplied, { block: 4 }, { block: castor }).targets[1]
    expect(own).toMatchObject({ role: 'harvested', recoveryPercent: 100 })
    expect(own.source).toContain('Castor curve 7')
  })
  it('carries an earlier partial cut by its Table 6 figure until its gaps green up', () => {
    const base = scene()
    const partial = {
      ...base,
      targets: base.targets.map((t) =>
        t.id === 'block'
          ? {
              ...t,
              plannedHarvestYear: 2030,
              harvestSystem: 'partial' as const,
              volumeRemovedPercent: 40,
              residualHeightMeters: 20,
            }
          : t,
      ),
    }
    const curve = parseGrowthCurve('0,0\n10,3\n20,8')
    const before = timelineScene(partial, 2040, curve, { block: 4 }).targets[1]
    // Still a partial cut, residual height as recorded: Table 6 rises with residual height, so it is never grown.
    expect(before).toMatchObject({ role: 'block', harvestSystem: 'partial', residualHeightMeters: 20 })
    expect(before.source).toContain('not yet greened up')
    const after = timelineScene(partial, 2050, curve, { block: 4 }).targets[1]
    expect(after).toMatchObject({ role: 'harvested', recoveryPercent: 100 })
    expect(after.source).toContain('greened up')
    // Without a curve, the scene's stated green-up age decides, as for any opening.
    const age = partial.settings.greenUpAgeYears
    expect(timelineScene(partial, 2030 + age - 1, [], {}).targets[1].role).toBe('block')
    expect(timelineScene(partial, 2030 + age, [], {}).targets[1].role).toBe('harvested')
    // The run reads the carried partial cut as a partial cut: its Table 6 figure, not cleared ground.
    const carried = timelineScene(partial, 2040, curve, { block: 4 })
    const via = assessVia({
      objectiveId: 'partial-retention',
      result: analyse(carried),
      review: {},
      blocks: carried.targets.filter((t) => t.role === 'block'),
    })
    expect(via.partialCuts[0]).toMatchObject({ visible: true, equivalentPercent: partialCutEquivalentPercent(40, 20) })
  })
  it('compares green-up ages without changing the scene and names the openings that move', () => {
    const base = scene()
    expect(() => greenUpJobs(base)).toThrow('green-up age changes nothing')
    const withOpening: ForestryScene = {
      ...base,
      targets: [
        ...base.targets,
        {
          ...base.targets[1],
          id: 'old',
          name: 'Old opening',
          role: 'harvested',
          harvestYear: 2004,
          clearcutPercent: 100,
        },
        {
          ...base.targets[1],
          id: 'older',
          name: 'Older opening',
          role: 'harvested',
          harvestYear: 1980,
          clearcutPercent: 100,
        },
      ],
    }
    const jobs = greenUpJobs(withOpening)
    expect(jobs.map((j) => j.greenUpAgeYears)).toEqual([10, 15, 20, 25, 30])
    expect(jobs.every((j) => j.kind === 'greenup')).toBe(true)
    expect(jobs[2].name).toContain('(scene)')
    expect(withOpening.settings.greenUpAgeYears).toBe(20)
    expect(greenUpSensitivityAges(5)).toEqual([5, 10, 15])
    // Harvested 2004, 22 years old in 2026: counted at 25 and 30 years, recovered at 10–20.
    expect(greenUpSensitiveOpenings(withOpening, [10, 15, 20, 25, 30], 2026).map((o) => o.id)).toEqual(['old'])
    const field = {
      ...withOpening,
      targets: withOpening.targets.map((t) =>
        t.id === 'old'
          ? {
              ...t,
              fieldGreenUp: {
                finding: 'no' as const,
                greenedUpPercent: 0,
                observedOn: '2026-06-01',
                observedBy: 'A. B.',
              },
            }
          : t,
      ),
    }
    expect(greenUpSensitiveOpenings(field, [10, 15, 20, 25, 30], 2026)).toEqual([])
  })
  it('keeps the objective reading in a run summary and the loaded curves in the workspace', () => {
    const s = scene()
    const summary = summarizeRun(s, analyse(s))
    expect(summary.scales?.map((scale) => scale.basis)).toEqual(['perspective', 'planimetric'])
    const castor = {
      id: 'castor:7',
      label: '7',
      source: 'yields.csv',
      points: [
        { age: 0, height: 0 },
        { age: 10, height: 6 },
      ],
    }
    const d = {
      ...emptyTools(),
      curveLibrary: [castor],
      blockCurves: { block: 'castor:7', other: 'castor:gone' },
      runs: [
        {
          id: 'r',
          name: 'R',
          kind: 'greenup' as const,
          greenUpAgeYears: 25,
          scene: s,
          summary,
          error: null,
          generatedAt: new Date().toISOString(),
        },
      ],
    }
    const parsed = parseTools(JSON.parse(serializeTools(d)))
    expect(parsed.curveLibrary).toEqual([castor])
    // An assignment to a curve that is no longer loaded falls back to the supplied curve.
    expect(parsed.blockCurves).toEqual({ block: 'castor:7' })
    expect(parsed.runs[0]).toMatchObject({ kind: 'greenup', greenUpAgeYears: 25 })
    // Workspaces saved before the library still load.
    const old = JSON.parse(serializeTools(emptyTools()))
    delete old.curveLibrary
    delete old.blockCurves
    expect(parseTools(old)).toMatchObject({ curveLibrary: [], blockCurves: {} })
    expect(() =>
      parseTools({
        ...d,
        curveLibrary: [
          {
            ...castor,
            points: [
              { age: 0, height: 5 },
              { age: 10, height: 2 },
            ],
          },
        ],
      }),
    ).toThrow('falls')
    expect(() =>
      parseTools({ ...d, runs: [{ ...d.runs[0], summary: { ...summary, scales: [{ basis: 'x' }] } }] }),
    ).toThrow('objective reading')
  })
  it('round-trips scenes and result records, rejecting corrupt imported summaries', () => {
    const s = { ...scene(), masks: [mask('private')], localRasters: [raster] }
    expect(parseScene(JSON.parse(serializeScene(s)))?.localRasters?.[0].values).toEqual(raster.values)
    const run = {
      id: 'run',
      name: 'Scenario',
      kind: 'matrix' as const,
      scene: s,
      summary: summarizeRun(s, analyse(s)),
      error: null,
      generatedAt: new Date().toISOString(),
    }
    const d = { ...emptyTools(), options: [{ id: 'option', name: 'Design', scene: s }], runs: [run] }
    expect(parseTools(JSON.parse(JSON.stringify(d))).runs[0].summary?.blockAreaHa).toBeGreaterThan(0)
    const wire = JSON.parse(serializeTools({ ...d, currentScene: s }))
    expect(wire.localRasterPool).toHaveLength(1)
    expect(wire.runs[0].scene.localRasters).toBeUndefined()
    expect(parseTools(wire).runs[0].scene.localRasters?.[0].values).toEqual(raster.values)
    expect(parseTools(wire).currentScene?.localRasters?.[0].sha256).toBe(raster.sha256)
    expect(() => parseTools({ ...wire, localRasterPool: [] })).toThrow('missing local raster')
    expect(() => parseTools({ ...d, runs: [{ ...run, summary: { quality: {} } }] })).toThrow('summary')
    expect(() => parseTools({ ...d, options: [{ id: 'bad', name: 'Bad', scene: {} }] })).toThrow('scene')
  })
})
describe('sightline and evidence outputs', () => {
  it('traces the same blocking location as the sightline model, including unknown cells', () => {
    const a = { lng: 0, lat: 0, groundElevationMeters: 0 },
      b = { lng: 0.01, lat: 0, groundElevationMeters: 0 },
      settings = { ...DEFAULT_SIGHTLINE_OPTIONS, observerHeightMeters: 10, stepMeters: 10 }
    const source = { elevationAt: (lng: number) => (lng > 0.004 && lng < 0.006 ? 20 : 0) }
    const profile = traceSightlineProfile(source, a, b, settings)
    expect(profile.status).toBe('occluded')
    expect(profile.blockedAtMeters).toBe(testSightline(source, a, b, settings).blockedAtMeters)
    const unknown = traceSightlineProfile(
      { elevationAt: (lng: number) => (lng > 0.004 && lng < 0.006 ? NaN : 0) },
      a,
      b,
      settings,
    )
    expect(unknown.status).toBe('unknown')
    expect(unknown.points.some((p) => p.ground === null && p.canopy === null)).toBe(true)
    const s = scene(),
      result = computeAnalysis(flat, buildSceneInput(s), terrain, undefined, [], [], {
        inspection: { targetId: 'block', sampleIndex: 0, stationIndex: 0 },
      })
    expect(result.sightlineProfile?.status).toBe('visible')
  })
  it('keeps missing evidence explicit and escapes user content in printable reports', () => {
    const d = emptyTools()
    d.views = [
      {
        id: 'v',
        name: '<script>bad</script>',
        viewpoint: scene().viewpoint,
        landformId: 'land',
        notes: '<img src=x onerror=bad>',
      },
    ]
    expect(evidenceGaps(d)).toContain('<script>bad</script>: reference field photograph missing.')
    const html = buildEvidenceHtml(d)
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('matching simulation image missing')
    expect(html).toContain('distinct from the historical FS1252')
  })
})

describe('which design a scene shows', () => {
  it('names the saved alternative whose blocks and retained patches the scene carries', () => {
    const base = createSampleScene()
    const moved: ForestryScene = {
      ...base,
      targets: base.targets.map((target) =>
        target.role === 'block' && target.geometry.type === 'Polygon'
          ? {
              ...target,
              geometry: {
                type: 'Polygon',
                coordinates: target.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lng + 0.001, lat])),
              },
            }
          : target,
      ),
    }
    const options = [
      { id: 'a', name: 'Original layout', scene: structuredClone(base) },
      { id: 'b', name: 'Moved east', scene: structuredClone(moved) },
    ]
    expect(matchingDesign(base, options)?.name).toBe('Original layout')
    expect(matchingDesign(comparisonScene(base, moved), options)?.name).toBe('Moved east')
    // Anything else in the scene — the road, the settings — is not the design.
    expect(matchingDesign({ ...moved, viewpoint: { ...moved.viewpoint, name: 'Elsewhere' } }, options)?.name).toBe(
      'Moved east',
    )
  })

  it('names none when the blocks have been edited since', () => {
    const base = createSampleScene()
    const edited: ForestryScene = {
      ...base,
      targets: base.targets.map((target) =>
        target.role === 'block' ? { ...target, harvestSystem: 'partial' } : target,
      ),
    }
    expect(matchingDesign(edited, [{ id: 'a', name: 'Original layout', scene: base }])).toBeNull()
  })
})

describe("the views of interest as the tools' viewpoints", () => {
  const block = {
    id: 'block-1',
    name: 'Block A',
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-122.6, 53.9],
          [-122.59, 53.9],
          [-122.59, 53.91],
          [-122.6, 53.91],
          [-122.6, 53.9],
        ],
      ],
    },
  }
  const view = { ...viewAtPoint({ lng: -122.595, lat: 53.896 }, block, []), id: 'voi-a', landformId: 'land-1' }

  it('stands each on its pullout under its own id, with its landform and Table 3 notes; a view without its block goes', () => {
    const planned = plannedToolViews([view, { ...view, id: 'voi-b', blockId: 'gone' }], [block], {
      viewpointRecords: { [view.name]: { significance: 'High (5)', reason: ' Boat traffic ' } },
    })
    expect(planned).toHaveLength(1)
    expect(planned[0]).toMatchObject({
      id: 'voi-a',
      name: view.name,
      landformId: 'land-1',
      notes: 'High (5) — Boat traffic',
      viewpoint: { id: 'stand-voi-a', mode: 'corridor' },
    })
    expect(planned[0].viewpoint.coordinates).toHaveLength(2)
  })

  it('reads the views of interest first and keeps earlier viewpoints that are not one of them', () => {
    const planned = plannedToolViews([view], [block], null)
    const earlier: ToolView = {
      id: 'tool-view-1',
      name: 'Turnout',
      viewpoint: { id: 'vp', name: 'Turnout', mode: 'spot', coordinates: [[-122.62, 53.9]] },
      landformId: null,
      notes: '',
    }
    const stale = { ...earlier, id: 'voi-a', name: 'Copy' }
    const d = { ...emptyTools(), views: [earlier, stale] }
    expect(withPlannedViews(d, planned).views.map((v) => v.id)).toEqual(['voi-a', 'tool-view-1'])
    expect(earlierToolViews(d, planned).map((v) => v.id)).toEqual(['tool-view-1'])
    // An exported workspace carries both, and reads back.
    const read = parseTools(JSON.parse(serializeTools(withPlannedViews(d, planned))))
    expect(read.views.map((v) => v.id)).toEqual(['voi-a', 'tool-view-1'])
  })
})
