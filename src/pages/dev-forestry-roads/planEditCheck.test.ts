import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import { checkPlanEdit, selfCrossings } from './planEditCheck'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
/** A road from bearing/length legs, every interior point at `radius`. */
function road(legs: Array<[number, number]>, radius = 20): Alignment {
  const coordinates = [origin]
  for (const [bearing, length] of legs) coordinates.push(offsetCoordinate(coordinates.at(-1)!, bearing, length))
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: coordinates.map((coordinate, i) => ({
      id: `p${i + 1}`,
      coordinate,
      radiusM: i === 0 || i === coordinates.length - 1 ? 0 : radius,
    })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const move = (a: Alignment, id: string, coordinate: Coordinate): Alignment => ({
  ...a,
  points: a.points.map((p) => (p.id === id ? { ...p, coordinate } : p)),
})
const insertAfter = (a: Alignment, afterId: string, coordinate: Coordinate, radiusM = 20): Alignment => ({
  ...a,
  points: a.points.flatMap((p) => (p.id === afterId ? [p, { id: 'new', coordinate, radiusM }] : [p])),
})

describe('self-crossings', () => {
  it('finds none on an open road and one on a loop that comes back across itself', () => {
    expect(
      selfCrossings(
        road([
          [0, 200],
          [90, 200],
          [180, 100],
        ]).points,
      ),
    ).toEqual([])
    // North 200, east 100, south 100, west 200: the last leg crosses the first.
    const loop = road([
      [0, 200],
      [90, 100],
      [180, 100],
      [270, 200],
    ])
    const found = selfCrossings(loop.points)
    expect(found.map((c) => c.legs)).toEqual([[1, 4]])
  })

  it('counts a leg running back along another as a crossing', () => {
    const back = road([
      [0, 200],
      [90, 50],
      [180, 0.0001],
      [270, 50],
      [180, 150],
    ])
    // p5 → p6 runs south along p1 → p2.
    expect(selfCrossings(back.points).length).toBeGreaterThan(0)
  })
})

describe('a plan edit', () => {
  const base = road([
    [0, 200],
    [60, 200],
    [0, 200],
  ])

  it('is allowed when the road stays open and every curve fits at the minimum radius', () => {
    const after = move(base, 'p3', offsetCoordinate(base.points[2].coordinate, 90, 30))
    expect(checkPlanEdit(base, after, 20)).toBeNull()
  })

  it('is refused when a dragged point makes the road cross itself, naming the legs', () => {
    // Drag p4 back west across the first leg.
    const after = move(base, 'p4', offsetCoordinate(origin, 0, 100))
    const refusal = checkPlanEdit(base, after, 20)!
    expect(refusal.kind).toBe('crossing')
    expect(refusal.message).toMatch(/cross itself between points 1–2 and 3–4/)
  })

  it('is refused when a bend leaves a corner that cannot fit even at the minimum radius', () => {
    // A bend 5 m off the first leg, 5 m short of the corner: a 7 m leg into a 105° turn at point 3.
    const at = offsetCoordinate(offsetCoordinate(origin, 0, 195), 90, 5)
    const refusal = checkPlanEdit(base, insertAfter(base, 'p1', at), 20)!
    expect(refusal.kind).toBe('curve')
    expect(refusal.message).toMatch(/^Not applied: /)
    expect(refusal.message).toMatch(/R 20 m/)
  })

  it('allows a corner whose entered radius no longer fits when the minimum radius would', () => {
    // R 150 at p2 needs ~87 m of tangent at 60°; shortening the first leg to 60 m breaks it, R 20 fits.
    const wide = road(
      [
        [0, 200],
        [60, 200],
        [0, 200],
      ],
      150,
    )
    const after = move(wide, 'p2', offsetCoordinate(origin, 0, 60))
    expect(checkPlanEdit(wide, after, 20)).toBeNull()
  })

  it('never blocks an edit because of a crossing or corner the road already had', () => {
    const loop = road([
      [0, 200],
      [90, 100],
      [180, 100],
      [270, 200],
      [0, 300],
    ])
    expect(selfCrossings(loop.points)).toHaveLength(1)
    // Nudging the far end keeps the one existing crossing.
    const after = move(loop, 'p6', offsetCoordinate(loop.points[5].coordinate, 90, 10))
    expect(checkPlanEdit(loop, after, 20)).toBeNull()
    // A bend on a crossing leg renames the crossing but adds none.
    const mid = offsetCoordinate(origin, 0, 150)
    expect(checkPlanEdit(loop, insertAfter(loop, 'p1', offsetCoordinate(mid, 270, 15)), 20)).toBeNull()
  })

  it('refuses a fold-back as a reversal and points to switchbacks', () => {
    const straight = road([
      [0, 200],
      [0, 200],
    ])
    // Drag the end straight back down the road.
    const after = move(straight, 'p3', offsetCoordinate(origin, 0, 100))
    const refusal = checkPlanEdit(straight, after, 20)!
    expect(refusal).not.toBeNull()
    expect(refusal.message).toMatch(/turn back on itself|cross itself/)
  })

  it('refuses the wound-up bend from the field trace: repeated bends at one corner', () => {
    let a = base
    let refused = 0
    for (let k = 0; k < 12; k++) {
      const corner = a.points[1].coordinate
      const next = insertAfter(
        { ...a, points: a.points.map((p, i) => (p.id === 'new' ? { ...p, id: `b${k}-${i}` } : p)) },
        a.points[1].id,
        offsetCoordinate(corner, 30 * k, 12),
      )
      if (checkPlanEdit(a, next, 20)) refused++
      else a = next
    }
    expect(refused).toBeGreaterThan(0)
    expect(selfCrossings(a.points)).toEqual([])
  })
})
