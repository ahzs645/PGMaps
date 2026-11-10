/**
 * Curvature correction of earthwork volumes by Pappus' centroid theorem.
 *
 * A cross-section swept along a curved centreline sweeps a volume equal to its area times the path
 * length of its own centroid, not of the centreline. With offsets negative to the left looking
 * up-station and signed curvature k positive on a right-hand curve, a region whose centroid sits at
 * offset e travels (1 − k·e) metres per metre of centreline. Over an interval of centreline length
 * s, average end areas become
 *
 *   V = s · [ (A₁ + A₂)/2 − k · (A₁·e₁ + A₂·e₂)/2 ]
 *
 * which is the average-end-area volume when k = 0. Cut and fill are corrected separately, because
 * on a sidehill they sit on opposite sides and partly cancel.
 *
 * Pure: no DOM, terrain or network access.
 */

export interface AreaMoment {
  /** Area, m². */
  area: number
  /** First moment about the centreline, ∫ offset dA, m³ (offsets negative left). */
  moment: number
}

/**
 * Cut and fill areas and first moments of a sampled cross-section, by the same trapezoids that give
 * the section's areas: depth varies linearly between samples, and a segment that crosses the
 * design line is split where it does. Samples without both elevations are skipped.
 */
export function sectionAreaMoments(
  section: readonly { offset: number; ground: number | null; design: number | null }[],
): { cut: AreaMoment; fill: AreaMoment } {
  const cut = { area: 0, moment: 0 },
    fill = { area: 0, moment: 0 }
  // A linear depth from da at xa to db at xb: area and ∫ x·d(x) dx over [xa, xb].
  const add = (target: AreaMoment, xa: number, xb: number, da: number, db: number) => {
    const w = xb - xa
    target.area += ((da + db) * w) / 2
    target.moment += (w * (da * (2 * xa + xb) + db * (xa + 2 * xb))) / 6
  }
  const inner = section.filter(
    (p) => p.ground !== null && p.design !== null && Number.isFinite(p.ground) && Number.isFinite(p.design),
  )
  for (let i = 1; i < inner.length; i++) {
    const a = inner[i - 1],
      b = inner[i]
    const da = a.ground! - a.design!,
      db = b.ground! - b.design!
    if (b.offset <= a.offset) continue
    if (da >= 0 && db >= 0) add(cut, a.offset, b.offset, da, db)
    else if (da <= 0 && db <= 0) add(fill, a.offset, b.offset, -da, -db)
    else {
      const x = a.offset + ((b.offset - a.offset) * Math.abs(da)) / (Math.abs(da) + Math.abs(db))
      if (da > 0) {
        add(cut, a.offset, x, da, 0)
        add(fill, x, b.offset, 0, -db)
      } else {
        add(fill, a.offset, x, -da, 0)
        add(cut, x, b.offset, 0, db)
      }
    }
  }
  return { cut, fill }
}

/** Centroid offset of a region, m; 0 for an empty one. */
export const centroidOffset = (region: AreaMoment) => (region.area > 1e-9 ? region.moment / region.area : 0)

/**
 * Volume of one region over an interval of centreline length `lengthM` with signed curvature
 * `curvature` (1/m, positive on a right-hand curve). Null when a centroid lies past the centre of
 * curvature (|k·e| ≥ 1): the section folds over itself there and the sweep has no volume.
 */
export function pappusVolume(a1: AreaMoment, a2: AreaMoment, curvature: number, lengthM: number): number | null {
  if (
    ![a1.area, a1.moment, a2.area, a2.moment, curvature, lengthM].every(Number.isFinite) ||
    lengthM < 0 ||
    Math.abs(curvature * centroidOffset(a1)) >= 1 ||
    Math.abs(curvature * centroidOffset(a2)) >= 1
  )
    return null
  return lengthM * ((a1.area + a2.area) / 2 - (curvature * (a1.moment + a2.moment)) / 2)
}

/**
 * A station's region with the area the analysis reports and the centroid of its sampled section.
 * The reported area can include more than the section's trapezoids (site preparation); the extra
 * is given the same centroid.
 */
export const withReportedArea = (sampled: AreaMoment, reportedArea: number): AreaMoment => ({
  area: reportedArea,
  moment: reportedArea * centroidOffset(sampled),
})

/** One sentence for reports: the corrected totals beside the ones the estimate uses. */
export function curvatureCorrectionText(
  correction:
    | { cutVolumeM3: number; fillVolumeM3: number; curvedLengthM: number; uncorrectedIntervals: number }
    | undefined,
  cutVolumeM3: number,
  fillVolumeM3: number,
): string {
  if (!correction || correction.curvedLengthM <= 0)
    return 'No covered interval lies on a horizontal curve, so no curvature correction applies.'
  const m3 = (value: number) => Math.round(value).toLocaleString('en-CA')
  const percent = (corrected: number, base: number) =>
    base > 0 ? ` (${corrected >= base ? '+' : ''}${(((corrected - base) / base) * 100).toFixed(1)} %)` : ''
  return (
    `Corrected for plan curvature by each region's centroid (Pappus) over ${m3(correction.curvedLengthM)} m of curves, ` +
    `cut would be ${m3(correction.cutVolumeM3)} m³${percent(correction.cutVolumeM3, cutVolumeM3)} and fill ` +
    `${m3(correction.fillVolumeM3)} m³${percent(correction.fillVolumeM3, fillVolumeM3)}; the totals, costs, mass and haul ` +
    `here use the uncorrected average end areas.` +
    (correction.uncorrectedIntervals
      ? ` ${correction.uncorrectedIntervals} interval(s) with a centroid past the centre of curvature are left uncorrected.`
      : '')
  )
}
