/**
 * **Full bench** for the incomplete-section fixes (`sectionFixes.ts`): a profile that lowers the
 * formation over steep fill stretches until the downhill formation edge sits in cut, so the road is
 * cut wholly into the hill and the fill batter that never met the ground is gone. The material comes
 * out as cut, so the road's mass balance shows the surplus to end haul.
 *
 * At each station of a stretch (from the station before it to the station after) the lowering is how
 * far the formation edge on the failing side stands above the ground at the outer top of the ditch
 * that side will have, read from the section as calculated, plus `BENCH_MARGIN_M`. It is then spread so it changes by at most `BENCH_TAPER_GRADE`
 * per metre along the road (the most of every station's lowering less the grade times the distance
 * to it): the profile eases into and out of the bench rather than stepping down at its first station,
 * and the road's grade changes by no more than that anywhere.
 *
 * Where the road follows the ground, the result is a PVI at every station at the formation it had,
 * less the lowering, so the rest of the road is where it was. Where it has a vertical design, its
 * PVIs outside the lowered stretches are kept, and the lowered stretches get a PVI at each station.
 * No DOM.
 */
import { sectionSampleAt } from './sectionGeometry'
import { sideValue, templateAt } from './templates'
import { simplifyProfile } from './verticalTools'
import type { Alignment, RoadStation, VerticalPoint } from './types'

/** How far below the ground the downhill formation edge is set, so it is plainly in cut. */
export const BENCH_MARGIN_M = 0.1
/** Steepest the lowering may change along the road: the most it adds to or takes from the grade. */
export const BENCH_TAPER_GRADE = 0.04
/**
 * How far the simplified grade line may stand from a station's level where the road is not benched
 * (and below a benched station's). A designer's grade line follows the ground no closer than this.
 */
export const PROFILE_TOLERANCE_M = 0.2
/** The engine's limit on vertical control points per road (`verticalProfile` in `engine.ts`). */
export const MAX_PROFILE_POINTS = 500
/**
 * Stations closer than this share a PVI (the engine needs them 1 mm apart). A bend's own station,
 * 0.3 m past a regular one, keeps its PVI: across a sharp corner the ground at the bend sits below
 * the chord between its neighbours, and an interpolated formation there missed the bench by 0.13 m.
 */
const MIN_PVI_SPACING_M = 0.1

type Station = Pick<RoadStation, 'chainage' | 'designElevation' | 'section' | 'leftWidth' | 'rightWidth'>

export interface BenchStretch {
  side: 'left' | 'right'
  /** The stations either side of the stretch (`IncompleteStretch.rangeFrom`/`rangeTo`). */
  rangeFrom: number
  rangeTo: number
}

export interface FullBenchPlan {
  vertical: VerticalPoint[]
  /** Deepest lowering anywhere, metres. */
  maxLoweringM: number
  /** Road length over which the formation is lowered, metres. */
  loweredLengthM: number
  /** True when the road followed the ground and now has a vertical design of its own. */
  createdProfile: boolean
}

/**
 * How far the formation edge on `side` stands above the ground at the outer top of the ditch that
 * side gets once it is in cut (`ditchWidthM` past the edge, at the edge's level); null where unknown.
 * Measuring at the edge alone is not enough: the engine builds a cut side's ditch, and on a steep
 * slope its outer top stood 0.6 m above the ground and turned the section back into fill.
 */
function edgeAboveGround(station: Station, side: 'left' | 'right', ditchWidthM: number): number | null {
  const width = side === 'left' ? station.leftWidth : station.rightWidth
  const sign = side === 'left' ? -1 : 1
  const edge = sectionSampleAt(station as RoadStation, sign * width)
  const outer = sectionSampleAt(station as RoadStation, sign * (width + Math.max(0, ditchWidthM)))
  if (edge.design === null || edge.ground === null || outer.ground === null) return null
  return edge.design - Math.min(edge.ground, outer.ground)
}

/**
 * The profile that full-benches `stretches`, from the stations as last calculated. Returns the
 * reason instead when nothing needs lowering or the result would pass the engine's PVI limit.
 */
export function fullBenchProfile(
  alignment: Pick<Alignment, 'vertical' | 'template' | 'engineering'>,
  stations: readonly Station[],
  stretches: readonly BenchStretch[],
  newId: () => string,
): FullBenchPlan | { error: string } {
  // Each station's formation as calculated, one per `MIN_PVI_SPACING_M` (event stations sit a hair apart).
  const known: { chainage: number; level: number; station: Station }[] = []
  for (const station of [...stations].sort((a, b) => a.chainage - b.chainage)) {
    if (station.designElevation === null || !Number.isFinite(station.designElevation)) continue
    const last = known.at(-1)
    if (last && station.chainage - last.chainage < MIN_PVI_SPACING_M) continue
    known.push({ chainage: station.chainage, level: station.designElevation, station })
  }
  if (known.length < 2) return { error: 'The road has too few stations with a formation level to bench.' }
  // The lowering each stretch station needs, then spread at the taper grade. Every station counts,
  // the close event stations too: a bend's station a few decimetres past a PVI still has to close.
  const needs: { chainage: number; depth: number }[] = []
  for (const station of stations) {
    if (station.designElevation === null || !Number.isFinite(station.designElevation)) continue
    const chainage = station.chainage
    for (const stretch of stretches) {
      if (chainage < stretch.rangeFrom - 1e-6 || chainage > stretch.rangeTo + 1e-6) continue
      const template = templateAt(alignment as Alignment, chainage).template
      const above = edgeAboveGround(station, stretch.side, sideValue(template, stretch.side, 'DitchWidth'))
      if (above !== null && above + BENCH_MARGIN_M > 0) needs.push({ chainage, depth: above + BENCH_MARGIN_M })
    }
  }
  if (!needs.length) return { error: 'The formation edge is already in cut on these stretches.' }
  const lowering = (chainage: number) =>
    needs.reduce((most, n) => Math.max(most, n.depth - BENCH_TAPER_GRADE * Math.abs(chainage - n.chainage)), 0)
  // Where the lowering is non-zero, with the station either side where it is zero.
  const lowered = known.map((k) => lowering(k.chainage))
  const inWindow = known.map(
    (_, i) => lowered[i] > 0 || (i > 0 && lowered[i - 1] > 0) || (i + 1 < known.length && lowered[i + 1] > 0),
  )
  const createdProfile = alignment.vertical.length < 2
  let vertical: VerticalPoint[]
  if (createdProfile) {
    vertical = known.map((k, i) => ({
      id: newId(),
      chainage: k.chainage,
      elevation: k.level - lowered[i],
      curveLength: 0,
    }))
  } else {
    // Keep the design's own PVIs outside the lowered stretches; the stretches take a PVI per station.
    const windows: [number, number][] = []
    known.forEach((k, i) => {
      if (!inWindow[i]) return
      const last = windows.at(-1)
      if (last && i > 0 && inWindow[i - 1]) last[1] = k.chainage
      else windows.push([k.chainage, k.chainage])
    })
    const inside = (chainage: number) => windows.some(([a, b]) => chainage >= a - 1e-6 && chainage <= b + 1e-6)
    vertical = [
      ...alignment.vertical.filter((p) => !inside(p.chainage)),
      ...known.flatMap((k, i) =>
        inWindow[i] ? [{ id: newId(), chainage: k.chainage, elevation: k.level - lowered[i], curveLength: 0 }] : [],
      ),
    ].sort((a, b) => a.chainage - b.chainage)
    // A kept PVI right beside a new one would make a sliver tangent; the new one stands.
    vertical = vertical.filter(
      (p, _, all) =>
        !alignment.vertical.includes(p) ||
        !all.some(
          (q) => q !== p && !alignment.vertical.includes(q) && Math.abs(q.chainage - p.chainage) < MIN_PVI_SPACING_M,
        ),
    )
  }
  // A PVI at every station is unreadable on the profile and nothing a designer would draw: keep only
  // the PVIs the grade line needs to stay within PROFILE_TOLERANCE_M of every station's level, and
  // never above a benched station's (the bench would no longer reach into the hill there). The
  // design's own PVIs always stay.
  const capped = new Set(known.flatMap((k, i) => (lowered[i] > 0 ? [k.chainage] : [])))
  vertical = simplifyWithCaps(
    vertical,
    PROFILE_TOLERANCE_M,
    (p) => capped.has(p.chainage),
    alignment.vertical.map((p) => p.chainage),
  )
  if (vertical.length > MAX_PROFILE_POINTS)
    return {
      error: `This road would need more than ${MAX_PROFILE_POINTS} PVIs at its station spacing. Widen the station interval or split the road, then try again.`,
    }
  let loweredLength = 0
  for (let i = 1; i < known.length; i++)
    if (lowered[i] > 0 || lowered[i - 1] > 0) loweredLength += known[i].chainage - known[i - 1].chainage
  return {
    vertical,
    maxLoweringM: Math.max(...lowered),
    loweredLengthM: loweredLength,
    createdProfile,
  }
}

/**
 * `simplifyProfile`, then every dropped PVI the simplified line misses by more than `tolerance`, or
 * passes above where `isCap` says it must not, is put back, until none is. The line between kept PVIs
 * is linear (no curves are fitted here), so checking the dropped PVIs checks every station.
 */
function simplifyWithCaps(
  points: VerticalPoint[],
  tolerance: number,
  isCap: (p: VerticalPoint) => boolean,
  keep: number[],
): VerticalPoint[] {
  const all = [...points].sort((a, b) => a.chainage - b.chainage)
  const kept = new Set(simplifyProfile(all, tolerance, keep).map((p) => p.id))
  for (let pass = 0; pass < 50; pass++) {
    const line = all.filter((p) => kept.has(p.id))
    let added = 0
    let j = 0
    for (const p of all) {
      if (kept.has(p.id)) continue
      while (j + 1 < line.length - 1 && line[j + 1].chainage < p.chainage) j++
      const a = line[j],
        b = line[j + 1]
      if (!a || !b) continue
      const level = a.elevation + ((b.elevation - a.elevation) * (p.chainage - a.chainage)) / (b.chainage - a.chainage)
      const off = level - p.elevation
      if (Math.abs(off) > tolerance + 1e-9 || (isCap(p) && off > 1e-6)) {
        kept.add(p.id)
        added++
      }
    }
    if (!added) break
  }
  return all.filter((p) => kept.has(p.id))
}
