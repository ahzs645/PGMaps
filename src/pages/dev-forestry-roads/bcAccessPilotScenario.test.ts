import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBcAccessPilotScenario } from './bcAccessPilotScenario'
import * as pilotSource from './bcAccessPilot'
import * as terrain from './terrain'
import { parseProject, serializeProject } from './project'
import { createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'
import { libraryEntry } from './projectLibrary'
import { roadPlanFitCoordinates } from './planFit'

afterEach(() => vi.restoreAllMocks())

// Invented source results exercise orchestration; this fixture is not a ministry extract.
function setup() {
  const fixture = createAccessHistoryTrainingProject()
  const block = { ...fixture.context.find((feature) => feature.kind === 'harvest')!, id: 'pilot-fixture-block' }
  block.harvestEvidence = { source: 'bc-ften', sourceId: 'fixture-record', openingId: '12345', yearMethod: 'unknown' }
  const road = { ...fixture.context.find((feature) => feature.kind === 'existing-road')!, id: 'pilot-fixture-road' }
  road.roadEvidence = { source: 'bc-ften', condition: 'unknown', conditionBasis: 'unreviewed', reuseAllowed: false }
  const result: pilotSource.BcAccessPilotResult = {
    status: 'loaded',
    openingId: '12345',
    retrievedAt: '2026-11-09T00:00:00Z',
    bounds: [-122.73, 53.885, -122.69, 53.905],
    blocks: [block],
    roads: [road],
    sources: [],
    identity: { openingId: '12345', retrievedAt: '2026-11-09T00:00:00Z', records: [], matches: [], missingSources: [] },
    queries: [],
    findings: [{ id: 'missing-history', kind: 'gap', text: 'Physical road history is missing.', sourceIds: [] }],
    roadCandidates: [],
  }
  const pilot = vi.spyOn(pilotSource, 'loadBcAccessPilot').mockResolvedValue(result)
  const dem = vi
    .spyOn(terrain, 'loadRegionalTerrain')
    .mockResolvedValue({ metadata: fixture.terrain, source: terrain.demoTerrain })
  return { result, pilot, dem }
}

describe('clean BC access investigation', () => {
  it('opens the requested opening in a persisted record-only study without inventing historical evidence', async () => {
    const { result, pilot, dem } = setup()
    const loaded = await loadBcAccessPilotScenario({ openingId: '12345' })
    expect(pilot).toHaveBeenCalledWith('12345', undefined)
    expect(dem).toHaveBeenCalledWith(result.bounds, undefined, undefined)
    expect(loaded.project.context.map((feature) => feature.id)).toEqual(['pilot-fixture-block', 'pilot-fixture-road'])
    expect(loaded.project.alignments).toHaveLength(1)
    expect(loaded.project.workspaceMode).toBe('access-investigation')
    expect(loaded.project.investigation).toEqual({
      openingId: '12345',
      draftAlignmentId: loaded.project.alignments[0].id,
    })
    expect(loaded.project.name).toContain('12345')
    expect(loaded.project.scenario?.id).toBe('bc-opening-12345')
    expect(libraryEntry('fixture', loaded.project)).toMatchObject({
      roads: 0,
      blocks: 1,
      roadRecords: 1,
      workspaceMode: 'access-investigation',
    })
    const fit = roadPlanFitCoordinates(loaded.project, 'active', loaded.project.alignments[0])
    for (const feature of loaded.project.context) {
      const coordinates =
        feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates
      for (const coordinate of coordinates) expect(fit).toContainEqual(coordinate)
    }
    expect(fit).not.toContainEqual(loaded.project.alignments[0].points[0].coordinate)
    expect(loaded.project.accessHistory).toMatchObject({ events: [], anchors: [], paths: [], structures: [] })
    expect(loaded.project.context[1].roadEvidence?.reuseAllowed).toBe(false)
    expect(loaded.project.scenario?.contextWarnings).toEqual(['Physical road history is missing.'])
    expect(parseProject(serializeProject(loaded.project))).toEqual(loaded.project)
  })

  it('does not manufacture a location or fetch terrain when the opening has no footprint', async () => {
    const { result, pilot, dem } = setup()
    pilot.mockResolvedValue({ ...result, status: 'no-block-found', blocks: [], roads: [], bounds: null })
    await expect(loadBcAccessPilotScenario()).rejects.toThrow('no mapped cutblock')
    expect(dem).not.toHaveBeenCalled()
  })

  it('does not return a replacement project after cancellation during terrain loading', async () => {
    const { dem } = setup()
    const controller = new AbortController()
    dem.mockImplementation(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      return { metadata: terrain.createDemoProject().terrain, source: terrain.demoTerrain }
    })
    await expect(loadBcAccessPilotScenario({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
