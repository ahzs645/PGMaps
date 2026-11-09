import type { TileDecoder } from '../dev-forestry/demLoader'
import { createAccessHistoryState } from './accessHistory'
import { BC_ACCESS_PILOT_RECIPE, loadBcAccessPilot } from './bcAccessPilot'
import { parseProject } from './project'
import { requireScenarioTerrain } from './scenarioCoverage'
import { DEFAULT_ROAD_SETTINGS, loadRegionalTerrain, starterAlignment } from './terrain'
import type { Coordinate, RoadProject, TerrainSource } from './types'

/** Open a clean investigation only after both its live records and real terrain have loaded. */
export async function loadBcAccessPilotScenario({
  signal,
  onProgress,
  decodeRegionalTiles,
}: {
  signal?: AbortSignal
  onProgress?: (message: string) => void
  decodeRegionalTiles?: TileDecoder
} = {}): Promise<{ project: RoadProject; source: TerrainSource; notice: string }> {
  onProgress?.('Checking the BC opening and nearby road records…')
  const pilot = await loadBcAccessPilot(BC_ACCESS_PILOT_RECIPE.openingId, signal)
  if (!pilot.bounds || !pilot.blocks.length)
    throw Error(
      'This opening returned no mapped cutblock. The current project was kept; inspect the source lookup in Access history.',
    )
  onProgress?.('Loading regional terrain for the opening’s study area…')
  const loaded = await loadRegionalTerrain(pilot.bounds, signal, decodeRegionalTiles)
  if (signal?.aborted) throw signal.reason ?? new DOMException('Investigation loading cancelled.', 'AbortError')
  const centre: Coordinate = [(pilot.bounds[0] + pilot.bounds[2]) / 2, (pilot.bounds[1] + pilot.bounds[3]) / 2]
  const draft = starterAlignment(centre)
  draft.name = 'Design draft · no historical-use assertion'
  const terrainCoverage = requireScenarioTerrain([draft], loaded.source, DEFAULT_ROAD_SETTINGS.crossSectionHalfWidth)
  const harvestStart = pilot.identity.records.find(
    (record) => record.source === 'ften-cutblock' && record.disturbanceStartDate,
  )?.disturbanceStartDate
  const history = createAccessHistoryState(harvestStart ?? undefined)
  history.sources = pilot.sources
  const project = parseProject({
    schema: 'pgmaps-road-project-v1',
    name: BC_ACCESS_PILOT_RECIPE.title,
    scenario: {
      id: 'bc-opening-60677',
      contextWarnings: pilot.findings
        .filter((finding) => finding.kind === 'gap')
        .map((finding) => finding.text)
        .slice(0, 10),
      terrainCoveragePercent: terrainCoverage.coveragePercent,
    },
    terrain: loaded.metadata,
    alignments: [draft],
    activeAlignmentId: draft.id,
    settings: { ...DEFAULT_ROAD_SETTINGS },
    context: [...pilot.blocks, ...pilot.roads],
    profiles: [],
    cables: [],
    accessHistory: history,
  })
  return {
    project,
    source: loaded.source,
    notice: `Opened ${pilot.blocks.length} FTEN cutblock part(s) and ${pilot.roads.length} road segment part(s) from live BC records. The orange line is a new design draft. No historical route, construction date, entrance, outlet or bridge inventory has been assumed. Open Terrain → Access history to review the connected records and missing evidence.`,
  }
}
