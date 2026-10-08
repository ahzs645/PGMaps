import { describe, expect, it } from 'vitest'
import { liveGridBuilder, viewportGrid } from './live-grid'
import { meters } from './routing'
import type { HeatGridSpec, Point } from './types'

describe('live viewport heat grid', () => {
  const study: HeatGridSpec['bbox'] = [-122.94, 53.78, -122.59, 54.045]
  it('samples a bounded visible area and increases spatial detail as you zoom', () => {
    const view: HeatGridSpec['bbox'] = [-122.79, 53.9, -122.76, 53.92]
    const low = viewportGrid(study, view, 11),
      high = viewportGrid(study, view, 14)
    expect(high.cols).toBeGreaterThan(low.cols)
    expect(high.rows).toBeGreaterThan(low.rows)
    expect(high.bbox).toEqual(low.bbox)
    expect(high.bbox[0]).toBeGreaterThan(study[0])
    expect(high.bbox[2]).toBeLessThan(study[2])
    expect(viewportGrid(study, study, 18).cols * viewportGrid(study, study, 18).rows).toBeLessThanOrEqual(120000)
    expect(viewportGrid(study, [-130, 50, -129, 51], 12).bbox).toEqual(study)
  })
  it('matches nearest-street distances across spatial buckets and leaves remote cells without access', () => {
    const walkNodes: Point[] = [
      [-122.7801, 53.9101],
      [-122.7779, 53.9109],
      [-122.7759, 53.909],
    ]
    const spec: HeatGridSpec = { bbox: [-122.784, 53.906, -122.772, 53.914], cols: 11, rows: 9 }
    const result = liveGridBuilder({ walkNodes, meta: { bbox: study } })(spec)
    let missing = 0,
      connected = 0
    for (let row = 0; row < spec.rows; row++)
      for (let col = 0; col < spec.cols; col++) {
        const point: Point = [
          spec.bbox[0] + ((col + 0.5) * (spec.bbox[2] - spec.bbox[0])) / spec.cols,
          spec.bbox[3] - ((row + 0.5) * (spec.bbox[3] - spec.bbox[1])) / spec.rows,
        ]
        const distance = Math.min(...walkNodes.map((node) => meters(point, node)))
        const cell = result.cells[row * spec.cols + col]
        if (distance > 150) {
          expect(cell).toBeNull()
          missing++
        } else {
          expect(cell?.[1]).toBeCloseTo(distance, 5)
          connected++
        }
      }
    expect(missing).toBeGreaterThan(0)
    expect(connected).toBeGreaterThan(0)
  })
  it('uses nearby road access consistently with marker snapping while retaining remote standalone paths', () => {
    const center: Point = [-122.78, 53.91]
    const walkNodes: Point[] = [[-122.779, 53.91], center]
    const spec: HeatGridSpec = { bbox: [-122.7802, 53.9098, -122.7798, 53.9102], cols: 1, rows: 1 }
    const data = { walkNodes, streetAccessNodes: [0], meta: { bbox: study } }
    const cell = liveGridBuilder(data)(spec).cells[0]
    expect(cell?.[0]).toBe(0)
    expect(cell?.[1]).toBeCloseTo(meters(center, walkNodes[0]), 5)
    walkNodes[0] = [-122.776, 53.91]
    expect(liveGridBuilder({ ...data })(spec).cells[0]?.[0]).toBe(1)
  })
})
