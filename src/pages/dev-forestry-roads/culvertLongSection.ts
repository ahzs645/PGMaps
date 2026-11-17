/**
 * Drawing geometry for a culvert on the road profile and on its own along-barrel long section.
 *
 * Display only: every elevation comes from the engine's `CulvertAnalysis.profile` samples or the
 * road's analysed sections, and every printed figure (cover, grade) is the engine's. Nothing here
 * feeds a calculation, a schedule or an export. A missing value stays a gap: a line is never
 * bridged across it and never drawn at zero. Free of DOM access.
 */
import type { Culvert, CulvertAnalysis, CulvertProfilePoint } from './engineeringTypes'
import type { SectionSample } from './types'
import { culvertRiseM, culvertShapeOf, culvertSpanM, type CulvertShape } from './culverts/culvertShape'

/**
 * Least size, in screen px, of a culvert's opening on the road profile. Smaller than this the
 * opening is drawn at this size, invert held at its true level, and said to be not to scale.
 */
export const CULVERT_PROFILE_MIN_PX = 6

type ProfileField = 'groundElevation' | 'formationElevation' | 'invertElevation' | 'crownElevation'
type DesignCulvert = Pick<Culvert, 'diameterM' | 'shape' | 'spanM' | 'openingAreaM2' | 'barrels' | 'skewDegrees'>

const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)

/**
 * A profile field at `distanceM` along the barrel: the sample there, else a straight line between
 * the two samples either side when both are known. Never across a missing sample.
 */
export function profileValueAt(
  profile: readonly CulvertProfilePoint[],
  field: ProfileField,
  distanceM: number,
): number | null {
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]
    if (Math.abs(p.distanceM - distanceM) < 1e-9) return known(p[field]) ? p[field] : null
    if (p.distanceM > distanceM) {
      const a = profile[i - 1]
      if (!a) return null
      const va = a[field],
        vb = p[field]
      if (!known(va) || !known(vb)) return null
      const t = (distanceM - a.distanceM) / (p.distanceM - a.distanceM)
      return va + (vb - va) * t
    }
  }
  return null
}

const barrelLength = (culvert: Pick<CulvertAnalysis, 'profile'>) =>
  culvert.profile.length ? culvert.profile[culvert.profile.length - 1].distanceM : 0

export interface CulvertProfileMark {
  shape: CulvertShape
  /** Invert where the barrel crosses the road centreline (its midpoint); null when an invert is missing. */
  invertM: number | null
  crownM: number | null
  /** The design formation at the centreline, from the engine's own sample. */
  gradeM: number | null
  /** Crown to design grade at the centreline, m: what the dimension line is drawn to. */
  centreCoverM: number | null
  riseM: number
  /** The opening's width where the barrel crosses the profile's plane: span ÷ cos(skew). */
  alongRoadM: number
  /** Screen geometry of the opening; absent when the inverts are not entered. */
  opening?: {
    x: number
    width: number
    /** The invert's true y, the bottom of the drawn opening. */
    invertY: number
    height: number
    toScale: boolean
  }
  /** Screen geometry of the cover dimension, crown up to grade, when both are known. */
  cover?: { x: number; crownY: number; gradeY: number }
}

/**
 * Where a culvert is drawn on the road profile. `x` and `y` are the profile's own scales, so a
 * round pipe comes out as an ellipse in the profile's vertical exaggeration and reads as its real
 * rise above its invert.
 */
export function culvertProfileMark(
  culvert: Pick<CulvertAnalysis, 'chainage' | 'profile'>,
  design: DesignCulvert,
  x: (chainage: number) => number,
  y: (elevation: number) => number,
  minPx = CULVERT_PROFILE_MIN_PX,
): CulvertProfileMark {
  const centre = barrelLength(culvert) / 2
  const invertM = profileValueAt(culvert.profile, 'invertElevation', centre)
  const crownM = profileValueAt(culvert.profile, 'crownElevation', centre)
  const gradeM = profileValueAt(culvert.profile, 'formationElevation', centre)
  const riseM = culvertRiseM(design)
  const cosine = Math.cos((design.skewDegrees * Math.PI) / 180)
  const alongRoadM = culvertSpanM(design) / Math.max(1e-6, Math.abs(cosine))
  const mark: CulvertProfileMark = {
    shape: culvertShapeOf(design),
    invertM,
    crownM,
    gradeM,
    centreCoverM: known(crownM) && known(gradeM) ? gradeM - crownM : null,
    riseM,
    alongRoadM,
  }
  if (!known(invertM)) return mark
  const cx = x(culvert.chainage),
    invertY = y(invertM)
  const trueWidth = Math.abs(x(culvert.chainage + alongRoadM / 2) - x(culvert.chainage - alongRoadM / 2))
  const trueHeight = Math.abs(y(invertM) - y(invertM + riseM))
  const width = Math.max(minPx, trueWidth),
    height = Math.max(minPx, trueHeight)
  mark.opening = {
    x: cx,
    width,
    invertY,
    height,
    toScale: trueWidth >= minPx && trueHeight >= minPx,
  }
  if (known(crownM) && known(gradeM)) mark.cover = { x: cx, crownY: y(crownM), gradeY: y(gradeM) }
  return mark
}

/** One analysed road section near the culvert. */
export interface LongSectionStation {
  chainage: number
  bearing: number
  section: readonly SectionSample[]
}

export interface LongSectionPoint {
  distanceM: number
  elevation: number
}

export interface CulvertLongSection {
  lengthM: number
  /** Elevation range drawn, m, padded. */
  minM: number
  maxM: number
  ground: LongSectionPoint[][]
  /** The engine's formation samples over the road top. */
  formation: LongSectionPoint[][]
  /** The road's design surface (formation, ditches and batters) across the barrel, from the analysed sections. */
  surface: LongSectionPoint[][]
  invert: LongSectionPoint[][]
  crown: LongSectionPoint[][]
  /** Crown plus the manual's required cover, only where the engine measures cover (over the formation). */
  minimumCover: LongSectionPoint[][]
  /** Runs where the design surface stands above the ground: fill over the barrel. */
  fill: { top: LongSectionPoint[]; bottom: LongSectionPoint[] }[]
  inlet: { distanceM: number; invertM: number | null }
  outlet: { distanceM: number; invertM: number | null }
  /** From the engine's grade: a falling barrel has a positive fall. */
  fall: { percent: number; oneIn: number | null; falls: boolean } | null
  /** The sample the engine's least cover was measured at; absent when the engine's cover is unknown. */
  leastCover?: { distanceM: number; crownM: number; formationM: number; coverM: number }
  requiredCoverM: number
}

function runs(values: readonly (LongSectionPoint | null)[]): LongSectionPoint[][] {
  const out: LongSectionPoint[][] = []
  let current: LongSectionPoint[] = []
  for (const v of values) {
    if (v) current.push(v)
    else if (current.length) {
      out.push(current)
      current = []
    }
  }
  if (current.length) out.push(current)
  return out.filter((run) => run.length > 1)
}

/** A section's design at `offset`, straight between its samples; null outside or over a missing sample. */
function sectionDesignAt(section: readonly SectionSample[], offset: number): number | null {
  for (let i = 1; i < section.length; i++) {
    const a = section[i - 1],
      b = section[i]
    if (offset < a.offset - 1e-9 || offset > b.offset + 1e-9) continue
    if (!known(a.design) || !known(b.design)) return null
    const span = b.offset - a.offset
    return span > 1e-12 ? a.design + ((b.design - a.design) * (offset - a.offset)) / span : a.design
  }
  return null
}

/**
 * The design surface across the barrel: the sections either side of the culvert's station, each
 * read at the barrel's offset (negative to the left looking up-station, so the left inlet end is
 * at a negative offset) and blended by chainage, as the cross-section view projects the barrel.
 */
function surfaceAt(stations: readonly LongSectionStation[], chainage: number, offset: number): number | null {
  if (!stations.length) return null
  const sorted = [...stations].sort((a, b) => a.chainage - b.chainage)
  let a = sorted[0],
    b = sorted[0]
  for (const s of sorted) {
    if (s.chainage <= chainage + 1e-9) a = s
    if (s.chainage >= chainage - 1e-9) {
      b = s
      break
    }
  }
  if (b.chainage < chainage - 1e-9) b = a
  if (a.chainage > chainage + 1e-9) a = b
  const va = sectionDesignAt(a.section, offset),
    vb = sectionDesignAt(b.section, offset)
  if (a === b || Math.abs(b.chainage - a.chainage) < 1e-9) return va
  if (!known(va) || !known(vb)) return null
  const t = (chainage - a.chainage) / (b.chainage - a.chainage)
  return va + (vb - va) * t
}

/**
 * Everything the along-barrel long section draws. `stations` are the analysed sections either side
 * of the culvert's station; `requiredCoverM` is the manual's cover (`culverts/culvertChecks.ts`).
 */
export function culvertLongSection(
  culvert: Pick<CulvertAnalysis, 'chainage' | 'bearing' | 'profile' | 'coverM' | 'gradePercent'>,
  stations: readonly LongSectionStation[],
  requiredCoverM: number,
): CulvertLongSection | null {
  const profile = culvert.profile
  if (profile.length < 2) return null
  const lengthM = barrelLength(culvert)
  const nearest = stations.reduce<LongSectionStation | undefined>(
    (best, s) =>
      !best || Math.abs(s.chainage - culvert.chainage) < Math.abs(best.chainage - culvert.chainage) ? s : best,
    undefined,
  )
  // The same projection the cross-section view uses for the barrel.
  const cosine = nearest ? Math.cos(((culvert.bearing - nearest.bearing - 90) * Math.PI) / 180) : 1
  const point = (distanceM: number, v: number | null | undefined) => (known(v) ? { distanceM, elevation: v } : null)
  const field = (name: ProfileField) => runs(profile.map((p) => point(p.distanceM, p[name])))
  const surfaceValues = profile.map((p) => surfaceAt(stations, culvert.chainage, (p.distanceM - lengthM / 2) * cosine))
  const surface = runs(profile.map((p, i) => point(p.distanceM, surfaceValues[i])))
  const minimumCover = runs(
    profile.map((p) =>
      known(p.formationElevation) && known(p.crownElevation)
        ? { distanceM: p.distanceM, elevation: p.crownElevation + requiredCoverM }
        : null,
    ),
  )
  const fill: CulvertLongSection['fill'] = []
  let top: LongSectionPoint[] = [],
    bottom: LongSectionPoint[] = []
  const close = () => {
    if (top.length > 1) fill.push({ top, bottom })
    top = []
    bottom = []
  }
  profile.forEach((p, i) => {
    const s = surfaceValues[i],
      g = p.groundElevation
    if (known(s) && known(g) && s > g) {
      top.push({ distanceM: p.distanceM, elevation: s })
      bottom.push({ distanceM: p.distanceM, elevation: g })
    } else close()
  })
  close()
  const all = [
    ...profile.flatMap((p) => [p.groundElevation, p.formationElevation, p.invertElevation, p.crownElevation]),
    ...surfaceValues,
    ...minimumCover.flat().map((p) => p.elevation),
  ].filter(known)
  if (!all.length) return null
  const low = Math.min(...all),
    high = Math.max(...all)
  const pad = Math.max(0.3, (high - low) * 0.08)
  let leastCover: CulvertLongSection['leastCover']
  if (known(culvert.coverM)) {
    // The engine's least cover is the smallest formation-to-crown difference of its own samples.
    for (const p of profile)
      if (known(p.formationElevation) && known(p.crownElevation)) {
        const cover = p.formationElevation - p.crownElevation
        if (!leastCover || cover < leastCover.formationM - leastCover.crownM - 1e-9)
          leastCover = {
            distanceM: p.distanceM,
            crownM: p.crownElevation,
            formationM: p.formationElevation,
            coverM: culvert.coverM,
          }
      }
  }
  const grade = culvert.gradePercent
  return {
    lengthM,
    minM: low - pad,
    maxM: high + pad,
    ground: field('groundElevation'),
    formation: field('formationElevation'),
    surface,
    invert: field('invertElevation'),
    crown: field('crownElevation'),
    minimumCover,
    fill,
    inlet: { distanceM: 0, invertM: known(profile[0].invertElevation) ? profile[0].invertElevation : null },
    outlet: {
      distanceM: lengthM,
      invertM: known(profile[profile.length - 1].invertElevation) ? profile[profile.length - 1].invertElevation : null,
    },
    fall: known(grade)
      ? { percent: -grade, oneIn: Math.abs(grade) > 1e-9 ? 100 / Math.abs(grade) : null, falls: grade < 0 }
      : null,
    leastCover,
    requiredCoverM,
  }
}

/** An SVG path through runs of points; each run starts a new subpath, so a gap stays a gap. */
export function runsPath(
  lines: readonly (readonly LongSectionPoint[])[],
  x: (distanceM: number) => number,
  y: (elevation: number) => number,
): string {
  return lines
    .map((run) =>
      run.map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)},${y(p.elevation).toFixed(1)}`).join(' '),
    )
    .join(' ')
}

/** A closed band between a top and a bottom run of equal length (the barrel, a fill). */
export function bandPath(
  top: readonly LongSectionPoint[],
  bottom: readonly LongSectionPoint[],
  x: (distanceM: number) => number,
  y: (elevation: number) => number,
): string {
  if (top.length < 2 || bottom.length < 2) return ''
  const forward = top.map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)},${y(p.elevation).toFixed(1)}`)
  const back = [...bottom].reverse().map((p) => `L${x(p.distanceM).toFixed(1)},${y(p.elevation).toFixed(1)}`)
  return `${forward.join(' ')} ${back.join(' ')} Z`
}

/** Fixed-decimal text without `toLocaleString`, cheap enough for any render path. */
export const fixed = (value: number, digits: number) => {
  const text = value.toFixed(digits)
  return text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text
}
