import { describe, expect, it } from 'vitest'
import { distance, offsetCoordinate } from './engine'
import {
  EXTEND_SNAP_PX,
  extendAlignment,
  hasStationedInputs,
  nearerEnd,
  SKETCH_MIN_TOLERANCE_M,
  sketchPoints,
  strokeContinuation,
} from './sketchRoad'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const at = (east: number, north: number): Coordinate =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))

function road(coordinates: Coordinate[], extra: Partial<Alignment> = {}): Alignment {
  return {
    id: 'road',
    name: 'Road 1',
    color: '#d97706',
    points: coordinates.map((coordinate, index) => ({ id: `p${index}`, coordinate, radiusM: 0 })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    ...extra,
  }
}

let next = 0
const newId = () => `new-${++next}`

describe('sketched strokes', () => {
  it('keeps the corners a pencil meant and drops tremor below the pixel and metre tolerances', () => {
    // An L drawn with 1 m of jitter, at 1 m per pixel: 4 px is 4 m, above the 2 m floor.
    const stroke = [
      ...Array.from({ length: 50 }, (_, i) => at(i % 2 ? 1 : 0, i * 4)),
      ...Array.from({ length: 50 }, (_, i) => at(i * 4, 200 + (i % 2 ? 1 : 0))),
    ]
    const points = sketchPoints(stroke, 1)
    expect(points.length).toBeGreaterThanOrEqual(3)
    expect(points.length).toBeLessThanOrEqual(5)
    expect(distance(points[0], stroke[0])).toBeLessThan(0.01)
    expect(distance(points.at(-1)!, stroke.at(-1)!)).toBeLessThan(0.01)
  })

  it(`never thins below ${SKETCH_MIN_TOLERANCE_M} m, however far the map is zoomed in`, () => {
    const wobble = Array.from({ length: 60 }, (_, i) => at(i % 2 ? 1.5 : 0, i * 2))
    expect(sketchPoints(wobble, 0.01)).toHaveLength(2)
  })
})

describe('continuing a road from a stroke', () => {
  const base = road([at(0, 0), at(0, 100)])

  it(`continues an end within ${EXTEND_SNAP_PX} px, whichever way the stroke was drawn`, () => {
    const out = [at(0, 103), at(20, 150)]
    expect(strokeContinuation(base, out, 1)).toEqual({ end: 'end', added: out })
    // Drawn towards the road: turned round so it runs away from it.
    expect(strokeContinuation(base, [...out].reverse(), 1)).toEqual({ end: 'end', added: out })
    const before = [at(0, -4), at(-30, -60)]
    expect(strokeContinuation(base, before, 1)?.end).toBe('start')
  })

  it('is a new road when the stroke starts nowhere near an end', () => {
    expect(strokeContinuation(base, [at(50, 50), at(80, 90)], 1)).toBeNull()
    // The same gap is within reach when each pixel covers more ground.
    expect(strokeContinuation(base, [at(0, 120), at(0, 150)], 1)).toBeNull()
    expect(strokeContinuation(base, [at(0, 120), at(0, 150)], 2)?.end).toBe('end')
  })

  it('picks the nearer end for a pegged extension', () => {
    expect(nearerEnd(base, at(5, 90))).toBe('end')
    expect(nearerEnd(base, at(5, 10))).toBe('start')
  })
})

describe('extending a road', () => {
  it('appends from the end, curving the new corners and the old end without touching existing curves', () => {
    const curved = road([at(0, 0), at(0, 100), at(100, 200)])
    curved.points[1].radiusM = 40
    const extended = extendAlignment(curved, [at(100, 300), at(200, 400)], 'end', newId, 25)
    expect(extended.points).toHaveLength(5)
    expect(extended.points.slice(0, 3).map((p) => p.id)).toEqual(['p0', 'p1', 'p2'])
    expect(extended.points[1].radiusM).toBe(40)
    // The old end is now a corner and takes the minimum radius where its tangents allow.
    expect(extended.points[2].radiusM).toBeGreaterThan(0)
    expect(extended.points[3].radiusM).toBeGreaterThan(0)
    expect(extended.points.at(-1)!.radiusM).toBe(0)
  })

  it('prepends from the start, keeping the road running in its own direction', () => {
    const base = road([at(0, 0), at(0, 100)])
    const extended = extendAlignment(base, [at(0, -50), at(-40, -120)], 'start', newId, 0)
    expect(extended.points.map((p) => p.coordinate)).toEqual([at(-40, -120), at(0, -50), at(0, 0), at(0, 100)])
  })

  it('refuses the start of a road with inputs measured from it, and refuses a mapped road', () => {
    const profiled = road([at(0, 0), at(0, 100)], {
      vertical: [{ id: 'v', chainage: 0, elevation: 800, curveLength: 0 }],
    })
    expect(hasStationedInputs(profiled)).toBe(true)
    expect(() => extendAlignment(profiled, [at(0, -50)], 'start', newId, 25)).toThrow('Extend it from its end')
    expect(extendAlignment(profiled, [at(0, 150)], 'end', newId, 25).points).toHaveLength(3)
    const mapped = road([at(0, 0), at(0, 100)], {
      mappedRoad: {
        source: 'bc-ften',
        roadName: 'R1',
        contextIds: ['c'],
        sourceIds: [],
        sourceVertexCount: 2,
        thinningToleranceM: 0.5,
        joinGapsM: [],
        partsLeftOut: 0,
      },
    })
    expect(() => extendAlignment(mapped, [at(0, 150)], 'end', newId, 25)).toThrow('held as recorded')
  })

  it('needs at least one point past the end', () => {
    const base = road([at(0, 0), at(0, 100)])
    expect(() => extendAlignment(base, [at(0, 100.2)], 'end', newId, 25)).toThrow('Draw past the end')
  })
})
