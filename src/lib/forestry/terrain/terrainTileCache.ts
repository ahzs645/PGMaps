// The decoded-tile cache and the persistent tile store live in the toolkit (`@pgmaps/geo-toolkit/terrain`).
export { createTerrainTileCache, createTerrainTileStore, terrainTileCache } from '@pgmaps/geo-toolkit/terrain'
export type { TerrainTileStore } from '@pgmaps/geo-toolkit/terrain'

import { createTerrainTileStore } from '@pgmaps/geo-toolkit/terrain'

/** PG Maps' Terrarium PNGs in Cache Storage, under the name its earlier releases used. */
export const pgmapsTerrainTileStore = createTerrainTileStore('pgmaps-terrarium-png-v1')
