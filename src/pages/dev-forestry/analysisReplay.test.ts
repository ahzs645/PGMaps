import { it, expect } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { ElevationGrid, DEM_TILE_SIZE } from '@/lib/forestry/terrain/terrain'
import { computeAnalysis } from './analysis'
import { retainRun, replayRun, type RunInputs } from './analysisReplay'
import { DEFAULT_ANALYSIS_SETTINGS } from './types'
it('recomputes the stored figures offline and detects a changed terrain cell', async () => {
  const range = { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, tileCount: 1 },
    grid = new ElevationGrid(range)
  const cells = new Float32Array(DEM_TILE_SIZE ** 2).fill(120)
  grid.setTile(0, 0, cells)
  const square = (r: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [-r, -r],
        [r, -r],
        [r, r],
        [-r, r],
        [-r, -r],
      ],
    ],
  })
  const data: RunInputs = {
    range,
    canopy: [],
    forested: [square(0.02)],
    context: {},
    terrain: { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 },
    input: {
      assessmentYear: 2000,
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      settings: {
        ...DEFAULT_ANALYSIS_SETTINGS,
        observerHeightMeters: 3000,
        maxViewDistanceMeters: 40000,
        sampleBudget: 300,
      },
      targets: [
        {
          id: 'face',
          name: 'Face',
          role: 'landscape',
          geometry: square(0.02),
          harvestYear: null,
          clearcutPercent: null,
        },
        { id: 'cut', name: 'Cut', role: 'block', geometry: square(0.005), harvestYear: null, clearcutPercent: null },
      ],
    },
  }
  const original = computeAnalysis(grid, data.input, data.terrain, undefined, data.canopy, data.forested, data.context)
  const file = await retainRun(data, new Map([['dem/0-0.f32', new Uint8Array(cells.buffer)]]), original, {
    viewId: 'v',
    rowId: 'sheet',
    landformId: 'face',
  })
  const replay = await replayRun(file)
  expect(replay.replayMatches).toBe(true)
  expect(replay.replayRowId).toBe('sheet')
  expect(replay.result.perspectiveByStation).toEqual(original.perspectiveByStation)
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  entries['dem/0-0.f32'][0] ^= 1
  await expect(replayRun(new Blob([zipSync(entries) as BlobPart]))).rejects.toThrow('checksum mismatch')
})
