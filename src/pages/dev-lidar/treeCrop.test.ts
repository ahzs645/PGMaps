import { readFileSync } from 'node:fs'
import proj4 from 'proj4'
import { describe, it, expect, vi } from 'vitest'
import { METRIC_CRS } from './sourceGrids'
import type { TreeIsolation } from './treeIsolation'
const state = vi.hoisted(() => ({
  cloud: null as unknown,
  nodes: [] as { key: string; pointCount: number; state: string }[],
  destroyed: 0,
}))
vi.mock('maplibre-gl-lidar', () => ({
  EptStreamingLoader: class {
    async initialize() {
      return { totalPoints: 84608005 }
    }
    async selectNodesForViewport() {
      return state.nodes
    }
    queueNode(node: { state: string }) {
      node.state = 'loaded'
    }
    async loadQueuedNodes() {}
    isLoading() {
      return false
    }
    getLoadedNodeCount() {
      return state.nodes.filter((n) => n.state === 'loaded').length
    }
    getLoadedPointCount() {
      return 6
    }
    getLoadedPointCloudData() {
      return state.cloud
    }
    hasPendingSubtrees() {
      return false
    }
    destroy() {
      state.destroyed++
    }
  },
}))
vi.mock('./sourceGrids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sourceGrids')>()
  return {
    ...actual,
    readSourceGrid: async () => ({
      width: 1648,
      height: 1396,
      bounds: [511498, 5971019, 513146, 5972415],
      resolution: 1,
      noData: -9999,
      values: new Float32Array(1648 * 1396),
    }),
  }
})
import { isolateTreeReturns } from './useTreeIsolation'
const data = JSON.parse(
  readFileSync(new URL('./treeIsolation.generated.json', import.meta.url), 'utf8'),
) as TreeIsolation

describe('bounded original-return crop through the GeoLibre loader API', () => {
  it('screens ground/noise/withheld and low returns, preserves node identity and reports skipped nodes', async () => {
    const crown = data.crowns.features[0],
      [row, col] = crown.properties.runs[0]
    const centre = proj4(METRIC_CRS, 'EPSG:4326', [data.grid.bounds[0] + col + 0.5, data.grid.bounds[3] - row - 0.5])
    state.nodes = [
      { key: '0-0-0-0', pointCount: 6, state: 'pending' },
      { key: '1-0-0-0', pointCount: 800000, state: 'pending' },
    ]
    state.cloud = {
      coordinateOrigin: [...centre, 0],
      positions: Float32Array.from([0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 1, 0, 0, 20]),
      classifications: Uint8Array.from([1, 2, 7, 1, 1, 1]),
      extraAttributes: { Withheld: Uint8Array.from([0, 0, 0, 1, 0, 0]) },
      nodeRanges: [{ key: '0-0-0-0', start: 0, count: 6 }],
    }
    const crop = await isolateTreeReturns(
      data,
      crown,
      'https://example.invalid/analysis/',
      'https://example.invalid/ept.json',
      new AbortController().signal,
      () => {},
    )
    expect(crop.points).toHaveLength(2)
    expect(crop.points.map((p) => p.height)).toEqual([10, 20])
    expect(crop.points.map((p) => p.index)).toEqual([0, 5])
    expect(crop.budget_limited).toBe(true)
    expect(crop.withheld_filtered).toBe(true)
    expect(state.destroyed).toBeGreaterThan(0)
  })
  it('cancels an obsolete selection before reading point data', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      isolateTreeReturns(
        data,
        data.crowns.features[0],
        'https://example.invalid/analysis/',
        'https://example.invalid/ept.json',
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('cancelled')
  })
})
