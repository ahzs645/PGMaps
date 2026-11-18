import { describe, expect, it } from 'vitest'
import { BEND_TANGENT_SHARE, bendThrough, curveGrip, curveThrough } from './bendArc'
import { alignmentLength, distance, horizontalCurveFits, offsetCoordinate, positionAt } from './engine'
import { checkPlanEdit } from './planEditCheck'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
/** A road from bearing/length legs, every interior point at `radius`. */
function road(legs: Array<[number, number]>, radius = 25): Alignment {
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
const bent = (a: Alignment, afterId: string, coordinate: Coordinate, radiusM: number): Alignment => ({
  ...a,
  points: a.points.flatMap((p) => (p.id === afterId ? [p, { id: 'new', coordinate, radiusM }] : [p])),
})
/** How near the fitted centreline, as the engine builds it, passes to a place, m. */
function nearest(a: Alignment, place: Coordinate) {
  const length = alignmentLength(a)
  let best = Infinity
  for (let s = 0; s <= length; s += 0.05) best = Math.min(best, distance(positionAt(a, s).coordinate, place))
  return best
}
/** A place `along` m up the leg from `from` toward `to`, `off` m to its right. */
function beside(from: Coordinate, bearing: number, along: number, off: number) {
  return offsetCoordinate(offsetCoordinate(from, bearing, along), bearing + 90, off)
}

describe('bendThrough', () => {
  it('puts the fitted curve through the place the handle was dragged to', () => {
    const straight = road([[90, 200]])
    for (const [along, off] of [
      [100, 5],
      [100, 30],
      [100, -60],
      [60, 20],
      [150, 45],
    ]) {
      const place = beside(origin, 90, along, off)
      const bend = bendThrough(straight, 'p1', place, 25)
      expect(bend.through, `${along}, ${off}`).toBe(true)
      const made = bent(straight, 'p1', bend.coordinate, bend.radiusM)
      expect(nearest(made, place), `${along}, ${off}`).toBeLessThan(0.1)
      // The point itself lies beyond the place, on the far side from the leg.
      expect(distance(bend.coordinate, place)).toBeGreaterThan(0)
      expect(horizontalCurveFits(made).find((fit) => fit.pointId === 'new')?.status).toBe('fitted')
      expect(checkPlanEdit(straight, made, 25)).toBeNull()
    }
  })

  it('opens a long flat arc for a small pull and tightens as the pull grows, never below the minimum', () => {
    const straight = road([[90, 200]])
    const radii = [2, 10, 30, 80].map((off) => bendThrough(straight, 'p1', beside(origin, 90, 100, off), 25).radiusM)
    expect(radii[0]).toBeGreaterThan(radii[1])
    expect(radii[1]).toBeGreaterThan(radii[2])
    expect(radii[2]).toBeGreaterThan(radii[3])
    expect(radii[0]).toBeGreaterThan(500)
    for (const radius of radii) {
      expect(radius).toBeGreaterThanOrEqual(25)
      // Kept to a tenth of a metre, with no binary tail to print.
      expect(String(radius)).toMatch(/^\d+(\.\d)?$/)
    }
  })

  it('takes its share of the straight the neighbouring curves leave', () => {
    // An S: the bend goes on the middle leg, between two curves that each hold some of it.
    const s = road(
      [
        [90, 150],
        [60, 200],
        [90, 150],
      ],
      60,
    )
    const middle = offsetCoordinate(s.points[1].coordinate, 60, 100)
    const place = offsetCoordinate(middle, 150, 25)
    const bend = bendThrough(s, 'p2', place, 25)
    expect(bend.through).toBe(true)
    const made = bent(s, 'p2', bend.coordinate, bend.radiusM)
    const fits = horizontalCurveFits(made)
    // Both neighbours keep their curves, and the new one leaves straight between them.
    expect(fits.map((fit) => fit.status)).toEqual(['fitted', 'fitted', 'fitted'])
    const added = fits.find((fit) => fit.pointId === 'new')!
    expect(added.tangentM).toBeLessThanOrEqual(BEND_TANGENT_SHARE * Math.min(added.backM, added.aheadM) + 0.01)
    expect(added.tangentM).toBeGreaterThan(0.9 * BEND_TANGENT_SHARE * Math.min(added.backM, added.aheadM))
    expect(nearest(made, place)).toBeLessThan(0.1)
  })

  it('adds the point at the place with the minimum radius where no curve through it fits', () => {
    const straight = road([[90, 200]])
    // On the leg itself: nothing to round.
    const on = offsetCoordinate(origin, 90, 100)
    expect(bendThrough(straight, 'p1', on, 25)).toEqual({ coordinate: on, radiusM: 25, through: false })
    // A short leg pulled far off: the turn is too tight for the minimum radius wherever the point
    // goes, so it is added at the place and the edit check refuses it.
    const short = road([[90, 30]])
    const tight = beside(origin, 90, 15, 40)
    expect(bendThrough(short, 'p1', tight, 25)).toEqual({ coordinate: tight, radiusM: 25, through: false })
    expect(checkPlanEdit(short, bent(short, 'p1', tight, 25), 25)?.kind).toBe('curve')
    expect(bendThrough(straight, 'missing', tight, 25).through).toBe(false)
    expect(bendThrough(straight, 'p2', tight, 25).through).toBe(false)
  })

  it('gives a curve with no minimum radius entered', () => {
    const straight = road([[90, 200]])
    const place = beside(origin, 90, 100, 20)
    const bend = bendThrough(straight, 'p1', place, 0)
    expect(bend.through).toBe(true)
    expect(bend.radiusM).toBeGreaterThan(0)
    expect(nearest(bent(straight, 'p1', bend.coordinate, bend.radiusM), place)).toBeLessThan(0.1)
  })
})

describe('curveThrough', () => {
  const corner = road(
    [
      [90, 200],
      [150, 200],
    ],
    40,
  )

  it('reads the radius whose arc passes through a place on the bisector', () => {
    const wider = { ...corner, points: corner.points.map((p) => (p.id === 'p2' ? { ...p, radiusM: 90 } : p)) }
    const through = curveThrough(corner, 'p2', curveGrip(wider, 'p2')!.coordinate, 25)
    expect(through?.limitedBy).toBeNull()
    expect(through!.radiusM).toBeCloseTo(90, 0)
    // And the curve it had reads back as itself.
    const grip = curveGrip(corner, 'p2')!
    expect(curveThrough(corner, 'p2', grip.coordinate, 25)!.radiusM).toBeCloseTo(40, 0)
    // The grip is the middle of the arc as the engine builds it, and its centre lies south-west of
    // a road that runs east and then turns right to the south-east.
    expect(nearest(corner, grip.coordinate)).toBeLessThan(0.05)
    expect(grip.radiusM).toBe(40)
    expect(grip.inwardBearing).toBeCloseTo(210, 0)
  })

  it('stops at the minimum radius and at the largest the legs carry', () => {
    expect(curveThrough(corner, 'p2', corner.points[1].coordinate, 25)).toEqual({ radiusM: 25, limitedBy: 'min' })
    const far = curveThrough(corner, 'p2', offsetCoordinate(corner.points[1].coordinate, 210, 150), 25)!
    expect(far.limitedBy).toBe('max')
    const widest = { ...corner, points: corner.points.map((p) => (p.id === 'p2' ? { ...p, radiusM: far.radiusM } : p)) }
    expect(horizontalCurveFits(widest)[0].status).toBe('fitted')
    expect(horizontalCurveFits(widest)[0].tangentM).toBeGreaterThan(190)
  })

  it('has nothing to read at an end, a straight point or a curve with spirals', () => {
    expect(curveThrough(corner, 'p1', origin, 25)).toBeNull()
    expect(curveGrip(corner, 'p3')).toBeNull()
    const line = bent(road([[90, 200]]), 'p1', offsetCoordinate(origin, 90, 100), 25)
    expect(curveThrough(line, 'new', origin, 25)).toBeNull()
    expect(curveGrip(line, 'new')).toBeNull()
    const spiralled = { ...corner, points: corner.points.map((p) => (p.id === 'p2' ? { ...p, spiralM: 20 } : p)) }
    expect(curveThrough(spiralled, 'p2', origin, 25)).toBeNull()
    expect(curveGrip(spiralled, 'p2')).toBeNull()
    // A corner whose curve does not fit is held at the point itself.
    const crowded = { ...corner, points: corner.points.map((p) => (p.id === 'p2' ? { ...p, radiusM: 900 } : p)) }
    expect(curveGrip(crowded, 'p2')).toMatchObject({ coordinate: corner.points[1].coordinate, radiusM: 0 })
  })
})
