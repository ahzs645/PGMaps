import { describe, expect, it } from 'vitest'
import { createTrainingScenario, ROAD_SCENARIOS, type RoadScenarioId, type ScenarioContents } from './scenarios'

describe('scenario library contents', () => {
  it('describes what each offline training scenario actually contains', () => {
    for (const scenario of ROAD_SCENARIOS.filter((item) => item.kind === 'training')) {
      const project = createTrainingScenario(scenario.id as RoadScenarioId)
      const has = (kind: string) => project.context.some((feature) => feature.kind === kind)
      const contents: ScenarioContents = scenario.contents
      expect(has('harvest'), `${scenario.id} cutblocks`).toBe(contents.cutblocks !== 'none')
      expect(has('existing-road'), `${scenario.id} roads`).toBe(contents.roads !== 'none')
    }
  })

  it('marks synthetic content only on training scenarios and mapped content only on real landscapes', () => {
    for (const scenario of ROAD_SCENARIOS)
      for (const content of Object.values(scenario.contents)) {
        if (content === 'synthetic') expect(scenario.kind, scenario.id).toBe('training')
        if (content === 'mapped') expect(scenario.kind, scenario.id).not.toBe('training')
      }
  })
})
