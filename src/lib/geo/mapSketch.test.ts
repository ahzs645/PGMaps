import { describe, expect, it } from 'vitest'
import {
  IDLE_SKETCH,
  canFinishSketch,
  closeRing,
  formatSketchArea,
  formatSketchDistance,
  nearFirstVertex,
  sketchFeatures,
  sketchPolygon,
  sketchReducer,
  sketchStats,
  type LngLat,
  type SketchAction,
  type SketchState,
} from './mapSketch'

const run = (actions: SketchAction[], from: SketchState = IDLE_SKETCH) => actions.reduce(sketchReducer, from)
const A: LngLat = [-122.8, 53.9]
const B: LngLat = [-122.79, 53.9]
const C: LngLat = [-122.79, 53.91]

describe('sketchReducer', () => {
  it('closes a polygon only from three points, and reopens it on undo', () => {
    const two = run([
      { type: 'start', shape: 'polygon' },
      { type: 'add', point: A },
      { type: 'add', point: B },
    ])
    expect(sketchReducer(two, { type: 'finish' })).toBe(two)
    const closed = run([{ type: 'add', point: C }, { type: 'finish' }], two)
    expect(closed.mode).toBe('complete')
    expect(sketchReducer(closed, { type: 'add', point: A })).toBe(closed)
    const undone = sketchReducer(closed, { type: 'undo' })
    expect(undone).toMatchObject({ mode: 'drawing', points: [A, B], redo: [C] })
    expect(sketchReducer(undone, { type: 'redo' })).toMatchObject({ mode: 'drawing', points: [A, B, C], redo: [] })
  })

  it('drops the redo list when a new point goes in', () => {
    const state = run([
      { type: 'start', shape: 'line' },
      { type: 'add', point: A },
      { type: 'add', point: B },
      { type: 'undo' },
      { type: 'add', point: C },
    ])
    expect(state).toMatchObject({ points: [A, C], redo: [] })
    expect(canFinishSketch('line', state.points)).toBe(true)
  })

  it('takes a circle as centre then edge, and moves the edge after', () => {
    const state = run([
      { type: 'start', shape: 'circle' },
      { type: 'add', point: A },
      { type: 'add', point: B },
    ])
    expect(state).toMatchObject({ mode: 'complete', points: [A, B] })
    expect(sketchReducer(state, { type: 'radius', point: C }).points).toEqual([A, C])
    const undone = sketchReducer(state, { type: 'undo' })
    expect(undone.mode).toBe('drawing')
    expect(sketchReducer(undone, { type: 'redo' }).mode).toBe('complete')
  })

  it('ignores points while idle', () => {
    expect(sketchReducer(IDLE_SKETCH, { type: 'add', point: A })).toBe(IDLE_SKETCH)
  })
})

describe('sketchStats', () => {
  it('measures an open perimeter while drawing and a closed one when finished', () => {
    const open = sketchStats('polygon', [A, B, C], false)!
    const closed = sketchStats('polygon', [A, B, C], true)!
    expect(closed.length).toBeGreaterThan(open.length)
    expect(open.area).toBe(closed.area)
    // About 0.66 km × 1.1 km ÷ 2 at 53.9° N.
    expect(closed.area / 10_000).toBeGreaterThan(30)
    expect(closed.area / 10_000).toBeLessThan(45)
  })

  it('reads a circle edge from the pointer until it is placed', () => {
    expect(sketchStats('circle', [A], false)).toBeNull()
    const stats = sketchStats('circle', [A], false, B)!
    expect(stats.radius).toBeCloseTo(0.657, 2)
    expect(stats.length).toBeCloseTo(2 * Math.PI * stats.radius!, 6)
  })

  it('gives a line no area', () => {
    expect(sketchStats('line', [A, B], false)).toMatchObject({ area: 0 })
  })
})

describe('sketchFeatures', () => {
  it('runs the rubber band back to the first point once a polygon can close', () => {
    expect(sketchFeatures('polygon', 'drawing', [A, B], C).preview.features[0].geometry.coordinates).toEqual([B, C])
    expect(sketchFeatures('polygon', 'drawing', [A, B, C], B).preview.features[0].geometry.coordinates).toEqual([
      C,
      B,
      A,
    ])
    expect(sketchFeatures('line', 'drawing', [A, B, C], B).preview.features[0].geometry.coordinates).toEqual([C, B])
  })

  it('closes the outline only when the polygon is finished', () => {
    expect(sketchFeatures('polygon', 'drawing', [A, B, C], null).outline.features[0].geometry.coordinates).toHaveLength(
      3,
    )
    expect(
      sketchFeatures('polygon', 'complete', [A, B, C], null).outline.features[0].geometry.coordinates,
    ).toHaveLength(4)
    expect(sketchFeatures('polygon', 'complete', [A, B, C], C).preview.features).toHaveLength(0)
  })

  it('draws a closed circle ring', () => {
    const ring = sketchFeatures('circle', 'drawing', [A], B).circle.features[0].geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })
})

describe('helpers', () => {
  it('builds a polygon only from three distinct points', () => {
    expect(sketchPolygon([A, B])).toBeNull()
    expect(sketchPolygon([A, B, C])?.coordinates[0]).toEqual([A, B, C, A])
    expect(closeRing([A, B, A])).toEqual([A, B, A])
  })

  it('snaps to the first vertex within 18 px', () => {
    expect(nearFirstVertex({ x: 0, y: 0 }, { x: 12, y: 13 })).toBe(true)
    expect(nearFirstVertex({ x: 0, y: 0 }, { x: 15, y: 15 })).toBe(false)
  })

  it('formats in metres, kilometres and hectares', () => {
    expect(formatSketchDistance(0.4567)).toBe('457 m')
    expect(formatSketchDistance(1.234)).toBe('1.23 km')
    expect(formatSketchArea(12_345)).toBe('1.2 ha')
  })
})
