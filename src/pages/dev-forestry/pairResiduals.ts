/**
 * The paired-point table's rows (WSL Monoplotting Tool, Pic2Map's check points): for each pair, where the camera solved
 * from the points puts its map spot in the photo, and how far that is from where the reviewer clicked, in pixels and
 * in metres on the ground. A pair left out of the solve is still measured, as a check point: it is the honest test of
 * a solve, since the solve did not see it. See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.2.
 *
 * Free of DOM and network access.
 */
import type { ControlPair, ControlSolveResult } from './controlPose'
import { cameraDistance } from './photoHitBuffer'
import { projectToPhoto } from './photoPose'

export type PairResidualRow = {
  id: string
  /** 1-based, in the order the pairs were placed: the number drawn on the photo. */
  n: number
  /** Whether the pair is in the solve; an off pair is a check point. */
  on: boolean
  /** Where the reviewer clicked in the photo. */
  pixel: [number, number]
  /** Where the solved camera draws the pair's map spot; null without a solve, or behind the camera. */
  solvedPixel: { x: number; y: number } | null
  /** Pixels between the two; null without a solve. */
  residualPx: number | null
  /** The same on the ground, metres across the view at the spot; null without a solve. */
  residualMeters: number | null
  /** The pair's own error with the camera solved without it (in-solve pairs only); null when not measured. */
  heldOutPx: number | null
  heldOutMeters: number | null
  /** An on pair the last solve did not use: added or switched on since. */
  stale: boolean
}

/** One row per pair, against the last solve (`solveFromControls`); pixel residuals before metres. */
export function pairResiduals(
  pairs: readonly ControlPair[],
  off: readonly string[],
  solve: ControlSolveResult | null,
): PairResidualRow[] {
  const offSet = new Set(off)
  const solved = new Map(solve?.pairs.map((row) => [row.id, row]))
  return pairs.map((pair, index) => {
    const on = !offSet.has(pair.id)
    const row = solved.get(pair.id)
    const projected = solve ? projectToPhoto(solve.pose, pair.lng, pair.lat, pair.elevation) : null
    const solvedPixel = projected ? { x: projected.x, y: projected.y } : null
    const residualPx = solvedPixel ? Math.hypot(solvedPixel.x - pair.pixel[0], solvedPixel.y - pair.pixel[1]) : null
    // Metres a pixel spans at the spot: the solve's own figure for its pairs, else range over focal length.
    const metresPerPx =
      row?.metresPerPx ??
      (solve ? cameraDistance(solve.pose, pair.lng, pair.lat, pair.elevation) / solve.pose.focalPx : null)
    return {
      id: pair.id,
      n: index + 1,
      on,
      pixel: pair.pixel,
      solvedPixel,
      residualPx,
      residualMeters: residualPx !== null && metresPerPx !== null ? residualPx * metresPerPx : null,
      heldOutPx: row?.heldOutPx ?? null,
      heldOutMeters: row && row.heldOutPx !== null ? row.heldOutPx * row.metresPerPx : null,
      stale: !!solve && on && !row,
    }
  })
}

/** The worst check point's residual, pixels: a solve's honest error. Null without a check point or a solve. */
export function worstCheckPoint(rows: readonly PairResidualRow[]): { px: number; meters: number | null } | null {
  const checks = rows.filter((row) => !row.on && row.residualPx !== null)
  if (!checks.length) return null
  const worst = checks.reduce((a, b) => (b.residualPx! > a.residualPx! ? b : a))
  return { px: worst.residualPx!, meters: worst.residualMeters }
}
