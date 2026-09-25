import { describe, expect, it } from 'vitest'

import { HORIZON_MARGIN_DEGREES, horizonSafePitch, roadLookAhead, roadPath, roadPlacement } from './driveMath'
import { bearingDegrees } from './visibility'

/**
 * How the eye-level camera takes a bend. The camera looks along a chord of the
 * road from `window` metres behind the eye to `window` ahead (`DriveController`
 * uses max(15 m, 1.5 s of travel)). On a circular arc that chord is parallel to
 * the tangent, so the camera should face exactly down the road; these pin that,
 * and the harder cases, to the figures measured by driving them in a browser.
 */

const ORIGIN = { lng: -122.62, lat: 53.905 }
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)

type Part = { straight: number } | { radius: number; turn: number }

/** A centreline from straight runs and arcs (turn in degrees, negative = left), vertices every `step` metres. */
function road(heading: number, parts: Part[], step = 5): Array<[number, number]> {
  let x = 0
  let y = 0
  let h = heading
  const points: Array<[number, number]> = [[ORIGIN.lng, ORIGIN.lat]]
  const push = () => points.push([ORIGIN.lng + x / metresPerDegreeLng, ORIGIN.lat + y / METRES_PER_DEGREE_LAT])
  for (const part of parts) {
    if ('straight' in part) {
      const n = Math.max(1, Math.round(part.straight / step))
      for (let i = 0; i < n; i += 1) {
        x += (part.straight / n) * Math.sin((h * Math.PI) / 180)
        y += (part.straight / n) * Math.cos((h * Math.PI) / 180)
        push()
      }
    } else {
      const n = Math.max(2, Math.round((part.radius * Math.abs(part.turn) * Math.PI) / 180 / step))
      const dh = part.turn / n
      const chord = 2 * part.radius * Math.sin((Math.abs(dh) * Math.PI) / 360)
      for (let i = 0; i < n; i += 1) {
        const mid = h + dh / 2
        x += chord * Math.sin((mid * Math.PI) / 180)
        y += chord * Math.cos((mid * Math.PI) / 180)
        h += dh
        push()
      }
    }
  }
  return points
}

function angleBetween(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/** Look-ahead bearing against the local road direction, every metre over a stretch. */
function headingErrors(coordinates: Array<[number, number]>, from: number, to: number, window: number) {
  const path = roadPath(coordinates)
  const errors: number[] = []
  const bearings: number[] = []
  for (let d = from; d <= to; d += 1) {
    const ahead = roadLookAhead(path, d, window)!
    // The road's own direction here, from half a metre either side.
    const tangent = bearingDegrees(roadPlacement(path, d - 0.5)!, roadPlacement(path, d + 0.5)!)
    errors.push(angleBetween(ahead.bearing, tangent))
    bearings.push(ahead.bearing)
  }
  const steps = bearings.slice(1).map((bearing, index) => angleBetween(bearing, bearings[index]))
  return { max: Math.max(...errors), maxStepPerMetre: Math.max(...steps) }
}

const lookWindow = (kmh: number) => Math.max(15, (kmh / 3.6) * 1.5)

describe('the drive camera on curved roads', () => {
  it('faces down the road through a gentle 400 m curve at 80 km/h', () => {
    const coordinates = road(95, [{ straight: 200 }, { radius: 400, turn: -90 }, { straight: 200 }])
    // Measured in the browser, with damping: 1.5° worst.
    expect(headingErrors(coordinates, 100, 950, lookWindow(80)).max).toBeLessThan(2)
  })

  it('stays within a few degrees through an S-curve at 50 km/h', () => {
    const coordinates = road(95, [
      { straight: 150 },
      { radius: 150, turn: -70 },
      { radius: 150, turn: 70 },
      { straight: 150 },
    ])
    // Only the entries and the reversal, where the chord straddles two bends.
    // Measured in the browser: 3.6° worst.
    expect(headingErrors(coordinates, 80, 550, lookWindow(50)).max).toBeLessThan(5)
  })

  it('turns smoothly through a 25 m hairpin at 20 km/h and never looks back down the road', () => {
    const coordinates = road(95, [{ straight: 300 }, { radius: 25, turn: -180 }, { straight: 300 }], 3)
    const { max, maxStepPerMetre } = headingErrors(coordinates, 220, 470, lookWindow(20))
    // Anticipates the bend slightly at its entry and exit: 8.1° here, 10.3° in
    // the browser once the camera's damping lags it.
    expect(max).toBeLessThan(12)
    // A 180° turn over ~80 m of arc, with no snap from one metre to the next.
    expect(maxStepPerMetre).toBeLessThan(3.5)
  })

  it('takes a coarse digitised kink along its bisector instead of snapping at the vertex', () => {
    // 200 m between vertices with a 35° change of direction: what an old GIS road looks like.
    const coordinates = road(95, [{ straight: 200 }, { radius: 0.001, turn: 35 }, { straight: 200 }], 200)
    const path = roadPath(coordinates)
    const vertex = path[1].distanceAlongMeters
    const atVertex = roadLookAhead(path, vertex, lookWindow(60))!.bearing
    expect(angleBetween(atVertex, 95 + 17.5)).toBeLessThan(0.5)
    // The turn is spread over the look window rather than taken in one frame.
    expect(headingErrors(coordinates, 100, 300, lookWindow(60)).maxStepPerMetre).toBeLessThan(1.5)
  })
})

describe('the camera near the horizon', () => {
  it('never looks exactly level, which crashed the renderer', () => {
    expect(horizonSafePitch(90)).toBe(90 - HORIZON_MARGIN_DEGREES)
    expect(horizonSafePitch(90.04)).toBe(90 - HORIZON_MARGIN_DEGREES)
    expect(horizonSafePitch(89.5)).toBe(89.5)
    expect(horizonSafePitch(102.3)).toBe(102.3)
  })
})

