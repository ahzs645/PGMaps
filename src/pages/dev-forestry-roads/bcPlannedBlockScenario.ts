import type { TileDecoder } from '@/lib/forestry/terrain/demLoader'
import { loadBcPlannedBlock } from './bcPlannedBlock'
import { parseProject } from './project'
import { DEFAULT_ROAD_SETTINGS, loadRegionalTerrain, starterAlignment } from './terrain'
import type { Coordinate, RoadProject, TerrainSource } from './types'

/**
 * A new design around an FTEN block with no opening ID: the block, nearby FTEN road segments and regional terrain.
 * It opens in design mode with no road yet (`designPlaceholderId`), because there is no opening to investigate.
 */
export async function loadBcPlannedBlockScenario({
  cutblockSKey,
  signal,
  onProgress,
  decodeRegionalTiles,
}: {
  cutblockSKey: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  decodeRegionalTiles?: TileDecoder
}): Promise<{ project: RoadProject; source: TerrainSource; notice: string }> {
  onProgress?.('Loading the BC cutblock and nearby road records…')
  const block = await loadBcPlannedBlock(cutblockSKey, signal)
  onProgress?.('Loading regional terrain around the block…')
  const loaded = await loadRegionalTerrain(block.bounds, signal, decodeRegionalTiles)
  if (signal?.aborted) throw signal.reason ?? new DOMException('Loading cancelled.', 'AbortError')
  const [west, south, east, north] = block.bounds
  const centre: Coordinate = [(west + east) / 2, (south + north) / 2]
  const placeholder = starterAlignment(centre)
  const blockVertices = block.blocks.flatMap((part) =>
    part.geometry.type === 'Polygon' ? part.geometry.coordinates[0] : [],
  )
  const covered = blockVertices.filter(([lon, lat]) => Number.isFinite(loaded.source.elevationAt(lon, lat))).length
  const { record } = block
  const label = record.cutBlockId ?? record.cutblockSKey
  const permit = [record.forestFileId, record.cuttingPermitId && `CP ${record.cuttingPermitId}`]
    .filter(Boolean)
    .join(' ')
  const project = parseProject({
    schema: 'pgmaps-road-project-v1',
    name: `Block ${label}${permit ? ` · ${permit}` : ''}`,
    workspaceMode: 'design',
    designPlaceholderId: placeholder.id,
    scenario: {
      id: `bc-ften-block-${record.cutblockSKey}`,
      contextWarnings: block.warnings,
      terrainCoveragePercent: blockVertices.length ? (covered / blockVertices.length) * 100 : 0,
    },
    terrain: loaded.metadata,
    alignments: [placeholder],
    activeAlignmentId: placeholder.id,
    settings: { ...DEFAULT_ROAD_SETTINGS },
    context: [...block.blocks, ...block.roads],
    profiles: [],
    cables: [],
  })
  return {
    project,
    source: loaded.source,
    notice: `Opened FTEN block ${label} with ${block.roads.length} nearby FTEN road segment part(s) on regional terrain. The block has no RESULTS opening ID; peg or sketch the access road. Nearby roads are candidates only.`,
  }
}
