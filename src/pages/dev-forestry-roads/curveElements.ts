/**
 * The curve-table elements a builder lays a curve out from: the PI station, tangent lengths T, the
 * total length L, the long chord C, the external E and the middle ordinate M. Read from the fitted
 * curve (`horizontalCurveSummary`), never refitted. With spirals, T and E use the spiral's shift p
 * and tangent offset k (p = Ls²/24R, k = Ls/2 − Ls³/240R², the usual clothoid approximations), and C
 * and M are the circular arc's. No DOM or network access.
 */
import type { CurveReview } from './curveReview'

export interface CurveElements {
  /** Back and forward tangent lengths, PI to TS/BC and PI to ST/EC; equal without unequal spirals. */
  tangentInM: number
  tangentOutM: number
  /** PI station: the start of the curve plus the back tangent, as RoadEng and most curve tables state it. */
  piChainage: number
  lengthM: number
  /** Long chord and middle ordinate of the circular arc. */
  chordM: number
  externalM: number
  middleOrdinateM: number
}

const RAD = Math.PI / 180
const spiral = (ls: number, r: number) =>
  ls > 0 ? { p: (ls * ls) / (24 * r), k: ls / 2 - ls ** 3 / (240 * r * r) } : { p: 0, k: 0 }

type CurveGeometry = Pick<
  CurveReview,
  | 'radius'
  | 'deflectionDegrees'
  | 'circularDeflectionDegrees'
  | 'spiralInLengthM'
  | 'spiralOutLengthM'
  | 'fullStart'
  | 'fullLength'
>

export function curveElements(c: CurveGeometry): CurveElements | null {
  const r = c.radius,
    delta = c.deflectionDegrees * RAD,
    arc = c.circularDeflectionDegrees * RAD
  if (!(r > 0) || !(delta > 1e-9) || delta >= Math.PI) return null
  const a = spiral(c.spiralInLengthM, r),
    b = spiral(c.spiralOutLengthM, r)
  const sin = Math.sin(delta),
    cos = Math.cos(delta)
  // Unequal spirals give unequal tangents (AASHTO's general form); equal ones reduce to (R+p)tan(Δ/2)+k.
  const tangentInM = (r + b.p - (r + a.p) * cos) / sin + a.k
  const tangentOutM = (r + a.p - (r + b.p) * cos) / sin + b.k
  const p = (a.p + b.p) / 2
  return {
    tangentInM,
    tangentOutM,
    piChainage: c.fullStart + tangentInM,
    lengthM: c.fullLength,
    chordM: 2 * r * Math.sin(arc / 2),
    externalM: (r + p) / Math.cos(delta / 2) - r,
    middleOrdinateM: r * (1 - Math.cos(arc / 2)),
  }
}
