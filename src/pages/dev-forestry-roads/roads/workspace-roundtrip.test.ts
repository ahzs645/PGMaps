import { describe, expect, it } from 'vitest'
import { createDemoProject, demoTerrain } from '../terrain'
import { normalizeRoadsOptions } from './graph'
import { ROADS_EXAMPLES, prepExData } from './examples'
import { createNetworkPlanning, parseNetworkScenario } from './planning'
import { prepareNetworkScenario, serializeNetworkScenario } from './workspace'

describe('network scenario replay contract', () => {
  it.each(ROADS_EXAMPLES.map((example) => [example.id]))(
    'round-trips %s grid, options and periods without losing no-data',
    async (id) => {
      const project = createDemoProject()
      const example = prepExData(id)
      const planning = {
        ...createNetworkPlanning(project),
        mode: 'example' as const,
        exampleId: id,
        options: normalizeRoadsOptions(example.input.options),
      }
      const prepared = await prepareNetworkScenario(project, demoTerrain, planning)
      const replay = parseNetworkScenario(JSON.parse(serializeNetworkScenario(prepared, [])))
      const restored = await prepareNetworkScenario(project, demoTerrain, replay)
      expect(restored.input.grid).toEqual(prepared.input.grid)
      expect(restored.input.elevations).toEqual(prepared.input.elevations)
      expect(restored.input.roadCells).toEqual(prepared.input.roadCells)
      expect(restored.input.landings).toEqual(prepared.input.landings)
      expect(restored.input.options).toEqual(prepared.input.options)
      expect(restored.stages).toEqual(prepared.stages)
      expect(restored.canAdopt).toBe(false)
    },
  )

  it('uses the recorded computation options when a bundle also carries different editor controls', async () => {
    const project = createDemoProject()
    const planning = {
      ...createNetworkPlanning(project),
      mode: 'example' as const,
      exampleId: 'clus-reference',
      options: normalizeRoadsOptions(prepExData('clus-reference').input.options),
    }
    const prepared = await prepareNetworkScenario(project, demoTerrain, planning)
    const bundle = JSON.parse(serializeNetworkScenario(prepared, []))
    bundle.planning.options.roadsInWeight = false
    bundle.planning.options.neighbourhood = 'rook'
    const replay = parseNetworkScenario(bundle)
    const restored = await prepareNetworkScenario(project, demoTerrain, replay)
    expect(restored.input.options?.roadsInWeight).toBe(true)
    expect(restored.input.options?.neighbourhood).toBe('queen')
  })
})
