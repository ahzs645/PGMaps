import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_HISTORY_SOURCES } from './accessHistorySources'
import { loadBcPlannedBlockScenario } from './bcPlannedBlockScenario'
import { awaitingFirstRoad } from './investigationWorkspace'
import { parseProject, serializeProject } from './project'
import { libraryEntry } from './projectLibrary'
import { roadPlanFitCoordinates } from './planFit'
import * as terrain from './terrain'
import { createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'

const layer = (id: string) => `${ACCESS_HISTORY_SOURCES.find((source) => source.id === id)!.serviceUrl}/`

// Invented records; the shape follows an FTEN block that has no RESULTS opening yet.
const ring = [
  [-122.52, 53.72],
  [-122.51, 53.72],
  [-122.51, 53.73],
  [-122.52, 53.73],
  [-122.52, 53.72],
]
const blockFeature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [ring] },
  properties: {
    CUT_BLOCK_SKEY: 870001,
    OPENING_ID: null,
    HARVEST_AUTH_FOREST_FILE_ID: 'ATEST01',
    HARVEST_AUTH_CUTTING_PERMIT_ID: 'A01',
    CUT_BLOCK_ID: 'TST001',
    BLOCK_STATUS_CODE: 'HB',
  },
}
const roadFeature = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.53, 53.725],
      [-122.515, 53.725],
    ],
  },
  properties: {
    OBJECTID: 7,
    FOREST_FILE_ID: 'RTEST01',
    ROAD_SECTION_ID: '01',
    START_STATION: 0,
    END_STATION: 1.5,
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    FILE_TYPE_CODE: 'B01',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('design from an FTEN block with no opening ID', () => {
  it('opens a design with the block and nearby roads and no road of its own yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [url.includes(layer('ften-cutblock')) ? blockFeature : roadFeature],
            }),
          ),
      ),
    )
    const fixture = createAccessHistoryTrainingProject()
    const dem = vi
      .spyOn(terrain, 'loadRegionalTerrain')
      .mockResolvedValue({ metadata: fixture.terrain, source: terrain.demoTerrain })
    const loaded = await loadBcPlannedBlockScenario({ cutblockSKey: '870001' })
    expect(dem).toHaveBeenCalledTimes(1)
    const { project } = loaded
    expect(project.name).toBe('Block TST001 · ATEST01 CP A01')
    expect(project.workspaceMode).toBe('design')
    expect(project.investigation).toBeUndefined()
    expect(project.accessHistory).toBeUndefined()
    expect(awaitingFirstRoad(project)).toBe(true)
    expect(project.scenario?.id).toBe('bc-ften-block-870001')
    expect(project.scenario?.contextWarnings).toHaveLength(3)
    expect(project.context.map((feature) => feature.kind)).toEqual(['harvest', 'existing-road'])
    expect(project.context[0].harvestEvidence).toMatchObject({ source: 'bc-ften', status: 'proposed' })
    expect(project.context[1].roadEvidence?.reuseAllowed).toBe(false)
    expect(libraryEntry('fixture', project)).toMatchObject({ roads: 0, blocks: 1, roadRecords: 1 })
    const fit = roadPlanFitCoordinates(project, 'active', project.alignments[0])
    for (const coordinate of ring) expect(fit).toContainEqual(coordinate)
    expect(fit).not.toContainEqual(project.alignments[0].points[0].coordinate)
    expect(loaded.notice).toContain('no RESULTS opening ID')
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('does not fetch terrain or open anything when the block cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }))),
    )
    const dem = vi.spyOn(terrain, 'loadRegionalTerrain')
    await expect(loadBcPlannedBlockScenario({ cutblockSKey: '870001' })).rejects.toThrow(/No FTEN cutblock record/)
    expect(dem).not.toHaveBeenCalled()
  })
})
