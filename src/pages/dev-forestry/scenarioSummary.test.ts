import { describe, expect, it } from 'vitest'
import { createEmptyScene, createSampleScene } from './scene'
import { START_SCENARIOS, scenarioContents, startScenarioContents, summariseScenario } from './scenarioSummary'

describe('scenarioSummary', () => {
  it('counts what a scene holds', () => {
    const summary = summariseScenario(createSampleScene())
    expect(summary).toMatchObject({ blocks: 2, landforms: 1, existingOpenings: 0, masks: 0, viewsOfInterest: 0 })
    expect(summary.access.kind).toBe('road')
  })

  it('reads a road only from two points and a viewpoint only from a placed spot', () => {
    const scene = createEmptyScene()
    const at = (mode: 'corridor' | 'spot', coordinates: Array<[number, number]>) =>
      summariseScenario({ ...scene, viewpoint: { ...scene.viewpoint, mode, coordinates } }).access.kind
    expect(at('corridor', [[-122.7, 53.9]])).toBe('none')
    expect(at('spot', [])).toBe('none')
    expect(at('spot', [[-122.7, 53.9]])).toBe('viewpoint')
  })

  it('names what is missing beside a block, and extras only when present', () => {
    const sample = createSampleScene()
    const block = sample.targets[0]
    const scene = createEmptyScene()
    expect(scenarioContents(scene)).toBe('Empty: nothing loaded')
    expect(scenarioContents({ ...scene, targets: [block] })).toBe('1 block · no road or viewpoint · no landform')
    expect(
      scenarioContents({
        ...scene,
        viewpoint: { ...scene.viewpoint, mode: 'spot', coordinates: [[-122.7, 53.9]] },
        targets: [block, { ...block, id: 'opening', role: 'harvested' }],
      }),
    ).toBe('1 block · 1 viewpoint · no landform · 1 existing opening')
  })

  it("prints each Start from scenario's contents from the scene it loads", () => {
    expect(START_SCENARIOS.map((scenario) => scenario.id)).toEqual(['tabor', 'purden', 'roadside', 'new'])
    expect(startScenarioContents()).toEqual({
      tabor: '2 blocks · 9.5 km road · 1 landform',
      purden: '1 block · 9.4 km road · 1 landform',
      roadside: '1 block · 1.2 km road · no landform',
      new: 'Empty: nothing loaded',
    })
  })
})
