import { describe, it, expect } from 'vitest'
import { computeAnalysis } from './analysis'
import { assessmentAlterationClipper } from './assessmentMaskGeometry'
import { assessmentMaskSampler, parseMasks } from './assessmentMasks'
import {
  comparisonScene,
  emptyTools,
  heightAtAge,
  matrixJobs,
  parseGrowthCurve,
  parseTools,
  serializeTools,
  stabilityJobs,
  summarizeRun,
  timelineScene,
} from './assessmentTools'
import { localRasterResolution, parseRasters, rasterSampler } from './localRaster'
import { createEmptyScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import { traceSightlineProfile } from './sightlineProfile'
import { buildEvidenceHtml, evidenceGaps } from './toolEvidence'
import { pointInPolygon, DEFAULT_SIGHTLINE_OPTIONS, testSightline } from './visibility'
import { assessVia, partialCutEntries } from './via'
import type { LocalRaster, AssessmentMask } from './types'
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
    expect(() =>
      timelineScene(
        { ...base, targets: base.targets.map((t) => (t.id === 'block' ? { ...t, harvestSystem: 'partial' } : t)) },
        2040,
        curve,
        {},
      ),
    ).toThrow('stand model')
    expect(() => parseGrowthCurve('0,\n10,2')).toThrow()
    expect(() => parseGrowthCurve('0,3\n10,2')).toThrow()
    expect(sceneFingerprint(base)).toBe(
      sceneFingerprint({ ...base, targets: base.targets.map((t) => ({ ...t, plannedHarvestYear: 2040 })) }),
    )
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
