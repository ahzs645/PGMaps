import { describe, expect, it } from 'vitest'
import { createDemoProject, demoTerrain } from './terrain'
import { checkScenarioTerrain, requireScenarioTerrain } from './scenarioCoverage'
import { offsetCoordinate, positionAt } from './engine'

describe('built-in scenario terrain contract', () => {
  it('checks both training alternatives and their full section corridors', () => {
    const project = createDemoProject()
    const result = requireScenarioTerrain(project.alignments, demoTerrain, project.settings.crossSectionHalfWidth)
    expect(result.missing).toBe(0)
    expect(result.samples).toBeGreaterThan(1000)
    expect(result.coveragePercent).toBe(100)
  })

  it('refuses a scenario whose road centre is covered but a section side has no terrain', () => {
    const project = createDemoProject()
    const alignment = project.alignments[0]
    const at = positionAt(alignment, 0)
    const side = offsetCoordinate(at.coordinate, at.bearing - 90, project.settings.crossSectionHalfWidth)
    const source = {
      elevationAt: (lon: number, lat: number) =>
        Math.abs(lon - side[0]) < 0.000001 && Math.abs(lat - side[1]) < 0.000001
          ? NaN
          : demoTerrain.elevationAt(lon, lat),
    }
    expect(checkScenarioTerrain([alignment], source, project.settings.crossSectionHalfWidth).missing).toBeGreaterThan(0)
    expect(() => requireScenarioTerrain([alignment], source, project.settings.crossSectionHalfWidth)).toThrow(
      'Scenario terrain is incomplete',
    )
    expect(source.elevationAt(...side)).toBeNaN()
  })
})
