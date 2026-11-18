/** What a hillshade refinement did, in the words the import notice and the terrain's record use. No DOM access. */
import type { ReliefResult } from '@/lib/geoPdf/hillshadeRelief'
import type { ContourRelief } from './contourTerrain'

const metres = (value: number) => (value < 0.095 ? value.toFixed(2) : value.toFixed(1))

export function reliefSummary(result: ReliefResult, file: string, intervalM: number): ContourRelief {
  const share = result.cells ? (100 * result.refinedCells) / result.cells : 0
  const bounded = result.boundedShare * 100
  return {
    name: file,
    sharePercent: Math.round(share * 10) / 10,
    medianChangeM: Math.round(result.medianChangeM * 100) / 100,
    p99ChangeM: Math.round(result.p99ChangeM * 100) / 100,
    summary: `Between the contours the ground is read from ${file}'s hillshade (sun at ${Math.round(result.lighting.azimuthDeg)}°, ${Math.round(result.lighting.altitudeDeg)}° up) over ${Math.round(share)}% of the cells: it moved them ${metres(result.medianChangeM)} m at the median and ${metres(result.p99ChangeM)} m at most for 99 in 100, never more than the ${intervalM} m contour interval${bounded >= 0.05 ? ` (${bounded.toFixed(1)}% of cells are held at that bound)` : ''}. The contours still set the heights. An estimate between contours, not a survey.`,
  }
}
