import { describe, expect, it } from 'vitest'
import { combinedViewshedBounds, computeCombinedViewshed } from './combined'
import { computeViewshed, type ViewshedSettings } from './model'

const observers = [
  { lng: -0.003, lat: 0 },
  { lng: 0.003, lat: 0 },
]
const settings: ViewshedSettings = { observer: observers[0], radiusMeters: 500, heightA: 1.6, heightB: 1.6 }

describe('combined road visibility', () => {
  it('unites views across two ridges while preserving their hidden valley', () => {
    const source = { elevationAt: (lng: number) => (Math.abs(lng) > 0.0008 && Math.abs(lng) < 0.0016 ? 150 : 100) }
    const bounds = combinedViewshedBounds(settings, observers)
    const views = observers.map((observer) =>
      computeViewshed(source, { ...settings, observer }, 15, 32, false, { bounds }),
    )
    const result = computeCombinedViewshed(source, settings, observers, 15, 32)
    expect(result.counts.visibleB).toBeGreaterThan(Math.max(...views.map((view) => view.counts.visibleB)))
    for (let i = 0; i < result.cells.length; i++) {
      expect(result.cells[i] === 4).toBe(views.some((view) => view.cells[i] === 4))
    }
    expect(Array.from(result.cells)).toContain(1) // Occluded areas do not turn red just because they lie in a circle.
  })

  it('keeps missing rays unknown unless another road viewpoint establishes visibility', () => {
    const source = { elevationAt: (lng: number) => (lng === observers[0].lng ? NaN : 100) }
    const result = computeCombinedViewshed(source, settings, observers, 15, 32)
    expect(result.counts.visibleB).toBeGreaterThan(0)
    expect(result.counts.unknown).toBeGreaterThan(0)
    const missing = computeCombinedViewshed({ elevationAt: () => NaN }, settings, observers, 15, 32)
    expect(missing.counts.unknown).toBe(missing.counts.total)
    expect(missing.counts.visibleB).toBe(0)
  })

  it('extends accumulated coverage without losing cells or recalculating old observers', () => {
    const source = { elevationAt: () => 100 }
    const bounds = combinedViewshedBounds(settings, observers)
    const first = computeCombinedViewshed(source, settings, observers.slice(0, 1), 15, 32, bounds)
    const progress: number[] = []
    const extended = computeCombinedViewshed(
      source,
      settings,
      observers,
      15,
      32,
      bounds,
      (completed) => progress.push(completed),
      { result: first, observerCount: 1 },
    )
    const fresh = computeCombinedViewshed(source, settings, observers, 15, 32, bounds)
    expect(extended.cells).toEqual(fresh.cells)
    expect(progress).toEqual([2])
    first.cells.forEach((cell, i) => {
      if (cell === 4) expect(extended.cells[i]).toBe(4)
    })
    expect(extended.cells).not.toBe(first.cells)
  })

  it('bounds the observer budget and rejects mixed-height road results', () => {
    expect(() => combinedViewshedBounds(settings, [])).toThrow('1–32')
    expect(() => combinedViewshedBounds(settings, Array(33).fill(observers[0]))).toThrow('1–32')
    expect(() =>
      computeCombinedViewshed({ elevationAt: () => 0 }, { ...settings, heightB: 2 }, observers, 20, 16),
    ).toThrow('one observer height')
  })
})
