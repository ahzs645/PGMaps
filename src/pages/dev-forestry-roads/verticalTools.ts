/** Bulk vertical-alignment tools. Pure: no DOM, network or terrain access. */
import type { VerticalPoint } from './types'

/**
 * Curve length = K × grade change (percentage points) at every interior PVI, at least
 * `minLengthM`, then shrunk where neighbouring curves would overlap or run past a PVI so the
 * result always fits its tangents. End PVIs keep no curve.
 */
export function curveLengthsForK(points: VerticalPoint[], k: number, minLengthM = 0): VerticalPoint[] {
  const pv = [...points].sort((a, b) => a.chainage - b.chainage)
  if (pv.length < 3 || !(k > 0)) return pv
  const grade = (i: number) => (100 * (pv[i + 1].elevation - pv[i].elevation)) / (pv[i + 1].chainage - pv[i].chainage)
  const halves = pv.map((_, i) => {
    if (i === 0 || i === pv.length - 1) return 0
    const change = Math.abs(grade(i) - grade(i - 1))
    return change < 1e-9 ? 0 : Math.max(minLengthM, k * change) / 2
  })
  // Each tangent between PVIs is shared by the two half-curves that meet on it.
  const shrunk = pv.map(() => false)
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i + 1 < pv.length; i++) {
      const gap = pv[i + 1].chainage - pv[i].chainage
      const used = halves[i] + halves[i + 1]
      if (used > gap) {
        const scale = gap / used
        halves[i] *= scale
        halves[i + 1] *= scale
        shrunk[i] = shrunk[i + 1] = true
      }
    }
  // Round up to 0.1 m so K never lands just under the target; a shrunk curve rounds down to fit.
  return pv.map((p, i) => ({
    ...p,
    curveLength: Math.max(0, shrunk[i] ? Math.floor(halves[i] * 20) : Math.ceil(halves[i] * 20 - 1e-9)) / 10,
  }))
}

/**
 * Douglas–Peucker on the grade line: drop PVIs whose removal moves the line by no more than
 * `toleranceM` vertically. Ends and `keep` stations (control points) always stay.
 */
export function simplifyProfile(points: VerticalPoint[], toleranceM: number, keep: number[] = []): VerticalPoint[] {
  const pv = [...points].sort((a, b) => a.chainage - b.chainage)
  if (pv.length < 3 || !(toleranceM > 0)) return pv
  const kept = new Set<number>([0, pv.length - 1])
  pv.forEach((p, i) => {
    if (keep.some((s) => Math.abs(s - p.chainage) < 1e-6)) kept.add(i)
  })
  const anchors = [...kept].sort((a, b) => a - b)
  const split = (a: number, b: number) => {
    let worst = -1,
      far = toleranceM
    for (let i = a + 1; i < b; i++) {
      const t = (pv[i].chainage - pv[a].chainage) / (pv[b].chainage - pv[a].chainage)
      const line = pv[a].elevation + (pv[b].elevation - pv[a].elevation) * t
      const off = Math.abs(pv[i].elevation - line)
      if (off > far) {
        far = off
        worst = i
      }
    }
    if (worst < 0) return
    kept.add(worst)
    split(a, worst)
    split(worst, b)
  }
  for (let i = 1; i < anchors.length; i++) split(anchors[i - 1], anchors[i])
  return pv.filter((_, i) => kept.has(i))
}
