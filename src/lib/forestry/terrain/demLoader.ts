/**
 * The DEM tile loader lives in the toolkit (`@pgmaps/geo-toolkit/terrain`). PG Maps' loader keeps its
 * tiles in its own Cache Storage (`pgmapsTerrainTileStore`) unless a caller names another store.
 */
import {
  loadElevationGrid as loadToolkitElevationGrid,
  type LoadElevationGridOptions,
} from '@pgmaps/geo-toolkit/terrain'
import { pgmapsTerrainTileStore } from './terrainTileCache'

export { decodeTerrariumTile } from '@pgmaps/geo-toolkit/terrain'
export type { LoadElevationGridOptions, LoadElevationGridResult, TileDecoder } from '@pgmaps/geo-toolkit/terrain'

export function loadElevationGrid(options: LoadElevationGridOptions) {
  return loadToolkitElevationGrid({ store: pgmapsTerrainTileStore, ...options })
}
