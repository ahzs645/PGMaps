import { describe, expect, it } from 'vitest'
import { castorConfig, castorCsvRows, createExampleProject } from '@/features/forestry-castor/inputs'
import { runCastor } from '@/features/forestry-castor/engine'
import { computeAnalysis } from './analysis'
import {
  castorConstraintCsv,
  castorConstraintProblem,
  castorVqoConstraint,
  castorZoneGeoJson,
} from './castorConstraint'
import { resolveThreshold } from './integrity'
import { createEmptyScene, type ForestryScene } from './scene'
import { buildSceneInput } from './sceneInput'

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
  return {
    ...base,
    assessmentYear: 2026,
    viewpoint: { id: 'view', name: 'View', mode: 'spot', coordinates: [[-0.04, 0]] },
    activeLandformId: 'land',
    targets: [
      {
        id: 'land',
        name: 'Tabor Face, east',
        role: 'landscape',
        geometry: box(-0.02, -0.01, 0.02, 0.01),
        objectiveId: 'partial-retention',
        vac: 'low',
        harvestYear: null,
        clearcutPercent: null,
        source: 'test',
      },
    ],
    settings: {
      ...base.settings,
      observerHeightMeters: 3000,
      sampleBudget: 800,
      greenAreaConfirmed: true,
      existingDisturbanceConfirmed: true,
    },
  }
}
// A 10% slope everywhere, east–west.
const sloped = { elevationAt: (lng: number) => lng * 111_000 * 0.1 }
const analyse = (s: ForestryScene) =>
  computeAnalysis(sloped, buildSceneInput(s), { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 })

describe('the landform’s objective as a Castor constraint', () => {
  it('writes the run’s green-up height and the resolved planimetric allowance, as Castor reads them back', () => {
    const s = scene()
    const result = analyse(s)
    const c = castorVqoConstraint(s, result)!
    const height = result.targets.find((t) => t.targetId === 'land')!.vegHeightMeters!
    expect(c).toMatchObject({
      id: 'vqo-tabor-face-east',
      zone: 'vqo',
      zoneId: 'tabor-face-east',
      type: 'le',
      variable: 'height',
    })
    expect(c.threshold).toBeCloseTo(height, 2)
    expect(c.percentage).toBe(resolveThreshold('partial-retention', 'planimetric', s.thresholds, 'low').value)
    const rows = castorCsvRows(castorConstraintCsv(c))
    expect(rows).toEqual([
      {
        id: 'vqo-tabor-face-east',
        zone: 'vqo',
        zoneId: 'tabor-face-east',
        type: 'le',
        variable: 'height',
        threshold: String(c.threshold),
        percentage: String(c.percentage),
      },
    ])
    const zone = JSON.parse(castorZoneGeoJson(c, new Date('2026-11-15T00:00:00Z')))
    expect(zone.features[0].properties['zone:vqo']).toBe('tabor-face-east')
    expect(zone.features[0].properties.denominator).toContain('treed area')
  })

  it('is a constraint Castor’s own engine runs and holds', () => {
    const s = scene()
    const c = castorVqoConstraint(s, analyse(s))!
    const [cells] = castorCsvRows(castorConstraintCsv(c))
    const row = Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, String(value)]))
    const project = createExampleProject()
    // The landform as the zone: the west half of the example's cells.
    project.pixels = project.pixels.map((pixel, i) => ({
      ...pixel,
      zones: { ...pixel.zones, [row.zone]: i % 12 < 6 ? row.zoneId : 'outside' },
    }))
    project.constraints = [
      ...project.constraints,
      {
        id: row.id,
        zone: row.zone,
        zoneId: row.zoneId,
        type: 'le' as const,
        variable: row.variable,
        threshold: Number(row.threshold),
        percentage: Number(row.percentage),
      },
    ]
    const result = runCastor(project, castorConfig(project))
    const rows = result.zoneManagement.filter((r) => r.constraintId === c.id && r.phase === 'after-harvest')
    expect(rows.length).toBeGreaterThan(0)
    expect(
      rows.every((r) => r.variable === 'height' && r.threshold === c.threshold && r.targetPercent === c.percentage),
    ).toBe(true)
    // Castor schedules harvest so the zone never passes the allowance below green-up height.
    expect(rows.map((r) => r.met)).not.toContain(false)
    expect(Math.max(...rows.map((r) => r.actualPercent))).toBeLessThanOrEqual(c.percentage)
  })

  it('says why no constraint can be written', () => {
    const s = scene()
    expect(castorConstraintProblem(s, null)).toContain('Run the visibility assessment')
    expect(castorConstraintProblem({ ...s, targets: [], activeLandformId: null }, null)).toContain('landform')
    expect(castorVqoConstraint(s, null)).toBeNull()
  })
})
