import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import { checkPlanEdit, selfCrossings, surfaceOverlap } from './planEditCheck'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate } from './types'

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

describe('a corner entered with no curve', () => {
  const pegged = (legs: Array<[number, number]>) => road(legs, 0)

  it('is allowed when a curve at the minimum radius would fit its legs', () => {
    // Field pegs 20 m apart turning 20° each: an R 20 curve needs 3.5 m of straight each side.
    const before = pegged([
      [0, 20],
      [20, 20],
      [40, 20],
    ])
    const after = {
      ...before,
      points: [
        ...before.points,
        { id: 'p5', coordinate: offsetCoordinate(before.points[3].coordinate, 60, 20), radiusM: 0 },
      ],
    }
    expect(checkPlanEdit(before, after, 20)).toBeNull()
  })

  it('is refused when no curve at the minimum radius could fit, and the notice says it has none', () => {
    // A peg that turns the road 150° after 20 m: R 20 needs 74.6 m of straight.
    const before = pegged([[0, 200]])
    const after = {
      ...before,
      points: [
        ...before.points,
        { id: 'p3', coordinate: offsetCoordinate(before.points[1].coordinate, 150, 20), radiusM: 0 },
      ],
    }
    const refusal = checkPlanEdit(before, after, 20)!
    expect(refusal.kind).toBe('curve')
    expect(refusal.message).toMatch(/point 2 has no curve, and the R 20 m curve the road needs there takes 74\.6 m/)
    expect(refusal.message).toMatch(/switchback/)
    // With no minimum radius there is no curve to fit.
    expect(checkPlanEdit(before, after, 0)).toBeNull()
  })

  it('never blocks an edit because of a sharp corner the road already could not round', () => {
    const before = pegged([
      [0, 200],
      [150, 20],
      [0, 200],
    ])
    expect(checkPlanEdit(pegged([[0, 200]]), before, 20)).not.toBeNull()
    const after = move(before, 'p4', offsetCoordinate(before.points[3].coordinate, 90, 10))
    expect(checkPlanEdit(before, after, 20)).toBeNull()
  })

  it('refuses the pegged knot from the 11 November field trace, which the old check let through', () => {
    // The Prince George LiDAR example with the ten pegs a user wound round its second corner:
    // turns of 162° and 127° on 20–25 m legs that never cross.
    const knot: Coordinate[] = [
      [-122.81506517368587, 53.89889000684268],
      [-122.81602576688464, 53.896375755140994],
      [-122.81301890418428, 53.89674751093561],
      [-122.81333377400045, 53.896766956083],
      [-122.81307063229895, 53.89693155476743],
      [-122.81273148442261, 53.896825731609574],
      [-122.81278127734714, 53.89658168618051],
      [-122.81294119329522, 53.896333194297355],
      [-122.81317964458015, 53.89603181327076],
      [-122.81326584468911, 53.895817745866815],
      [-122.81346941840184, 53.895487967017075],
      [-122.81487952733505, 53.89491380436381],
      [-122.81514131801481, 53.89484097106898],
      [-122.81664684231825, 53.89314073751209],
      [-122.81672713367836, 53.89255740703928],
      [-122.81772258374653, 53.89085122406363],
    ]
    const radii = [0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 0]
    const with_ = (keep: (i: number) => boolean): Alignment => ({
      ...road([]),
      points: knot.flatMap((coordinate, i) => (keep(i) ? [{ id: `k${i}`, coordinate, radiusM: radii[i] }] : [])),
    })
    const plain = with_((i) => i < 2 || i > 11)
    const wound = with_(() => true)
    expect(selfCrossings(wound.points)).toEqual([])
    const refusal = checkPlanEdit(plain, wound, 25)!
    expect(refusal.kind).toBe('curve')
    expect(refusal.message).toMatch(/point 3 has no curve/)
    // Its legs pass 6.4 m apart, which clears two 3 m half-widths by 0.4 m: only the corner rule
    // catches this knot, not the surface rule.
    expect(surfaceOverlap(wound).lengthM).toBe(0)
  })
})

describe('the road running onto itself', () => {
  // North 300, east 100, south 150, then west back toward the first leg: every corner fits at R 20.
  const loop = (westM: number) =>
    road([
      [0, 300],
      [90, 100],
      [180, 150],
      [270, westM],
    ])

  it('measures the gap between running surfaces, not between centrelines that cross', () => {
    // The default template is 3 m each side, so the end needs 6 m from the first leg.
    expect(surfaceOverlap(loop(80)).lengthM).toBe(0)
    expect(surfaceOverlap(loop(96)).lengthM).toBeGreaterThan(0)
    expect(selfCrossings(loop(96).points)).toEqual([])
  })

  it('refuses an edit that brings one leg within the surface of another, naming both legs', () => {
    const before = loop(80)
    const after = move(before, 'p5', offsetCoordinate(before.points[3].coordinate, 270, 96))
    const refusal = checkPlanEdit(before, after, 20)!
    expect(refusal.kind).toBe('clearance')
    expect(refusal.message).toMatch(/run onto itself between points 1–2 and 4–5/)
    expect(refusal.message).toMatch(/need 6 m/)
    // 7 m clear is allowed.
    expect(
      checkPlanEdit(before, move(before, 'p5', offsetCoordinate(before.points[3].coordinate, 270, 93)), 20),
    ).toBeNull()
  })

  it('reads widening: a turnout on the first leg needs its extra width too', () => {
    const before = {
      ...loop(80),
      overrides: [
        {
          id: 't',
          name: 'Turnout',
          kind: 'turnout' as const,
          side: 'right' as const,
          start: 100,
          end: 250,
          taper: 0,
          extraWidth: 4,
        },
      ],
    }
    // 7 m clear of a leg that is 3 + 4 m wide on that side, with 3 m on the end's side: 10 m needed.
    const after = move(before, 'p5', offsetCoordinate(before.points[3].coordinate, 270, 93))
    expect(checkPlanEdit(before, after, 20)?.kind).toBe('clearance')
  })

  it('does not count a curve against itself, nor a switchback whose legs clear each other', () => {
    // A 180° turn on R 20 curves with legs 45 m apart.
    const hairpin = road(
      [
        [0, 200],
        [90, 45],
        [180, 200],
      ],
      20,
    )
    expect(surfaceOverlap(hairpin).lengthM).toBe(0)
  })

  it('never blocks an edit because of an overlap the road already had', () => {
    const before = loop(96)
    const after = move(before, 'p1', offsetCoordinate(before.points[0].coordinate, 180, 20))
    expect(checkPlanEdit(before, after, 20)).toBeNull()
  })
})

describe('an area marked Excluded', () => {
  const base = road([
    [0, 200],
    [60, 200],
    [0, 200],
  ])
  // A 100 m square 50–150 m east of the first leg.
  const square = (treatment?: 'excluded' | 'conditional' | 'additional-cost'): ContextFeature => {
    const sw = offsetCoordinate(offsetCoordinate(origin, 90, 50), 0, 50)
    const ne = offsetCoordinate(offsetCoordinate(origin, 90, 150), 0, 150)
    return {
      id: 'a',
      name: 'Wildlife tree patch',
      kind: 'avoid',
      geometry: {
        type: 'Polygon',
        coordinates: [[sw, [ne[0], sw[1]], ne, [sw[0], ne[1]], sw]],
      },
      ...(treatment === 'excluded'
        ? { constraint: { treatment: 'excluded' } }
        : treatment === 'conditional'
          ? { constraint: { treatment: 'conditional' } }
          : treatment === 'additional-cost'
            ? { constraint: { treatment: 'additional-cost', costPerM: 50 } }
            : {}),
    }
  }
  // A bend 100 m up the first leg, pulled 100 m east into the square.
  const into = insertAfter(base, 'p1', offsetCoordinate(offsetCoordinate(origin, 0, 100), 90, 100))

  it('refuses an edit that takes the road into it, naming the area', () => {
    const refusal = checkPlanEdit(base, into, 20, { context: [square('excluded')] })!
    expect(refusal.kind).toBe('excluded')
    expect(refusal.message).toMatch(/enter Wildlife tree patch, an area marked Excluded/)
    // An avoid polygon with no policy and no price is Excluded by the legacy convention.
    expect(checkPlanEdit(base, into, 20, { context: [square()] })?.kind).toBe('excluded')
  })

  it('leaves priced and conditional areas to the search and the Review list', () => {
    expect(checkPlanEdit(base, into, 20, { context: [square('additional-cost')] })).toBeNull()
    expect(checkPlanEdit(base, into, 20, { context: [square('conditional')] })).toBeNull()
  })

  it('never blocks an edit to a road already inside one, unless the edit goes deeper', () => {
    const context = [square('excluded')]
    const nudged = {
      ...into,
      points: into.points.map((p) =>
        p.id === 'p4' ? { ...p, coordinate: offsetCoordinate(p.coordinate, 90, 10) } : p,
      ),
    }
    expect(checkPlanEdit(into, nudged, 20, { context })).toBeNull()
  })
})
