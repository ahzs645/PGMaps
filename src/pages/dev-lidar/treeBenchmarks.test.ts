import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { benchmarkPreview, checkBenchmarks, type BenchmarkData } from './TreeBenchmarks'
import { pointKey } from './treeInspection'
import { toMetric } from './sourceGrids'
import type { TreeIsolation } from './treeIsolation'
const data = JSON.parse(
  readFileSync(new URL('./treeBenchmarks.generated.json', import.meta.url), 'utf8'),
) as BenchmarkData
const source = JSON.parse(
  readFileSync(new URL('./treeIsolation.generated.json', import.meta.url), 'utf8'),
) as TreeIsolation
describe('actual bounded segmentation benchmarks through the viewer', () => {
  it('accepts exact source/terrain/segmentation identity and rejects misaligned point labels', () => {
    expect(() => checkBenchmarks(data, source)).not.toThrow()
    expect(() => checkBenchmarks({ ...data, label_grid_sha256: 'other' }, source)).toThrow('mismatch')
    const changed = structuredClone(data)
    changed.plots[0].methods[0].labels.pop()
    expect(() => checkBenchmarks(changed, source)).toThrow('aligned')
  })
  it('preserves the same sampled original returns across all methods while varying only labels', () => {
    for (const plot of data.plots) {
      let reference: unknown
      for (const method of plot.methods) {
        const preview = benchmarkPreview(data, plot, method)
        expect(preview.crop.points).toHaveLength(plot.sample.sampled)
        expect(new Set(preview.crop.points.map(pointKey)).size).toBe(plot.sample.sampled)
        if (reference) expect(preview.crop.points).toEqual(reference)
        else reference = preview.crop.points
        for (let i = 0; i < plot.sample.sampled; i++) {
          const p = preview.crop.points[i],
            [x, y] = toMetric(p.lon, p.lat)
          expect(x).toBeCloseTo(plot.centre_utm[0] + plot.sample.points[i][0], 2)
          expect(y).toBeCloseTo(plot.centre_utm[1] + plot.sample.points[i][1], 2)
          expect(preview.assignments[pointKey(p)]).toBe(
            method.labels[i] < 0 ? '0' : `edit-${method.id}-${method.labels[i]}`,
          )
        }
        expect(preview.features.features.filter((f) => f.geometry.type === 'Polygon')).toHaveLength(2)
        expect(preview.features.features.filter((f) => f.geometry.type === 'Point')).toHaveLength(method.tops.length)
      }
    }
  })
  it('shows real algorithm disagreement and retains the completed zero-instance result', () => {
    expect(data.plots.map((p) => p.methods.map((m) => m.instances_core))).toEqual([
      [3, 5, 15, 0],
      [8, 9, 19, 0],
      [5, 6, 31, 0],
    ])
    for (const plot of data.plots) {
      const method = plot.methods.find((m) => m.id === 'pointtree-treex')!
      expect(method.status).toBe('completed')
      expect(method.labels.every((n) => n === -1)).toBe(true)
      expect(method.assigned_points).toBe(0)
      expect(method.unassigned_points).toBeGreaterThan(0)
    }
  })
})
