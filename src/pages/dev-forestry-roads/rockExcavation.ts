/**
 * Rock excavation: the top of rock, a template's rock batter, ledge and blasting (overbreak) level,
 * and the split of a cross-section's rock into shallow cut, deep cut and overbreak.
 *
 * What it implements, from the Lima VVA functional specification (clean-room stage 1, 10 November
 * 2026: §5.2 surfaces, §6.1 "Slopes" and "Rock blasting", §6.3, §7.2–§7.3, worked cases T4, T5 and
 * T9, gaps G2 and G3):
 * - The top of rock is the top of the shallowest ground horizon whose material is marked rock: a
 *   depth below original ground, which is how PGMaps' ground layers are entered
 *   (`groundHorizons.ts`). Nothing is inferred from the terrain.
 * - The blasting level lies the template's depth below the subgrade at the centreline, falls at its
 *   crossfall to the ditch's inner bottom edge, and rises from there at the drainage crossfall until
 *   it meets the rock face: the design line leaving the ditch (or the formation edge where there is
 *   no ditch), extended downward. Only a side whose formation edge is in cut is blasted.
 * - Rock cut is rock above the design line. A column of it is shallow when the rock's thickness from
 *   its surface down to the blasting level, or to the design line where nothing is blasted, is at
 *   most the template's shallow depth.
 * - Overbreak ("deep rock") is rock between the design line and the blasting level. It is refilled
 *   in place with its own blasted rock, so only its swell reaches the mass balance.
 *
 * Areas are exact integrals of the piecewise-linear section: every crossing of the lines involved
 * splits a sample interval, and each piece is a trapezoid. First moments (∫ offset dA) feed the
 * Pappus curvature correction (`curvedVolume.ts`). Unlike Lima, ground is never extended past its
 * samples: where the section builder could not close a section, no rock quantity is reported.
 *
 * References: the specification above; Pappus–Guldinus as applied to end areas (Hickerson 1964,
 * Route Location and Design; Meyer & Gibson 1980, Route Surveying and Design). Written from a
 * functional specification; no code from Lima VVA (GPL-3.0-or-later) was used. No DOM, terrain or
 * network access.
 */
import { requireInRange, type EngineeringInputTarget } from './inputErrors'
import type { RoadTemplate, RockCutTemplate, RockSectionArea, SectionSample, StationRock } from './types'

type Side = 'left' | 'right'
const EPS = 1e-7

/** Lima VVA's values for a new project: where a template's rock cut starts when it is turned on. */
export const ROCK_CUT_DEFAULTS: Required<RockCutTemplate> = {
  cutSlope: 0.1,
  ledgeWidthM: 0.5,
  blastDepthM: 0.75,
  blastCrossfallPercent: 10,
  drainageCrossfallPercent: -25,
  shallowDepthM: 1,
}
/** Used when a blasting depth is entered without a crossfall. */
export const DEFAULT_BLAST_CROSSFALL_PERCENT = ROCK_CUT_DEFAULTS.blastCrossfallPercent
export const DEFAULT_DRAINAGE_CROSSFALL_PERCENT = ROCK_CUT_DEFAULTS.drainageCrossfallPercent

/** The range of each rock-cut value. The project parser, the engine and the fields all hold to it. */
export const ROCK_CUT_LIMITS: Readonly<Record<keyof RockCutTemplate, readonly [number, number]>> = {
  cutSlope: [0.1, 10],
  ledgeWidthM: [0, 10],
  blastDepthM: [0, 5],
  blastCrossfallPercent: [-20, 50],
  drainageCrossfallPercent: [-100, 0],
  shallowDepthM: [0, 20],
}
export const ROCK_CUT_LABELS: Readonly<Record<keyof RockCutTemplate, string>> = {
  cutSlope: 'rock cut batter (H:V)',
  ledgeWidthM: 'rock ledge width (m)',
  blastDepthM: 'blasting depth below subgrade (m)',
  blastCrossfallPercent: 'blasting crossfall (%)',
  drainageCrossfallPercent: 'drainage surface crossfall (%)',
  shallowDepthM: 'shallow rock depth (m)',
}
export const ROCK_CUT_KEYS = Object.keys(ROCK_CUT_LIMITS) as (keyof RockCutTemplate)[]
const BLOCKS = ['rockCut', 'leftRockCut', 'rightRockCut'] as const

/** The rock cut a side of a template uses: its own block, or the symmetric one. */
export const rockCutAt = (t: RoadTemplate, side: Side): RockCutTemplate | undefined => t[`${side}RockCut`] ?? t.rockCut

/** True when a template cuts rock differently from ordinary ground on either side. */
export const hasRockCut = (t: RoadTemplate) => BLOCKS.some((key) => t[key] !== undefined)

/** Throws an `EngineeringInputError` naming the block and value of the first rock-cut value out of range. */
export function validateRockCut(t: RoadTemplate, owner: string, target: EngineeringInputTarget): void {
  for (const block of BLOCKS) {
    const value: unknown = t[block]
    if (value === undefined) continue
    if (!value || typeof value !== 'object' || Array.isArray(value))
      requireInRange(Number.NaN, 0, 0, owner, 'rock cut', { ...target, field: block })
    const record = value as Record<string, unknown>
    for (const key of ROCK_CUT_KEYS) {
      if (record[key] === undefined) continue
      const [low, high] = ROCK_CUT_LIMITS[key]
      requireInRange(
        record[key],
        low,
        high,
        owner,
        `${block === 'rockCut' ? '' : `${block.slice(0, -7)} `}${ROCK_CUT_LABELS[key]}`,
        {
          ...target,
          field: `${block}.${key}`,
        },
      )
    }
  }
}

/** A rock-cut block read from a project file: known values within their limits, unknown keys dropped. */
export function parseRockCut(raw: unknown, label: string): RockCutTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  const record = raw as Record<string, unknown>,
    out: RockCutTemplate = {}
  for (const key of ROCK_CUT_KEYS) {
    const value = record[key]
    if (value === undefined) continue
    const [low, high] = ROCK_CUT_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
      throw Error(`${label} ${ROCK_CUT_LABELS[key]} must be between ${low} and ${high}.`)
    out[key] = value
  }
  return out
}

/**
 * A side's rock cut a fraction `ratio` of the way through a template transition from `a` to `b`.
 * A value both give is interpolated; one only one of them gives, and a block only one of them has,
 * holds until halfway and then switches.
 */
export function blendRockCut(
  a: RockCutTemplate | undefined,
  b: RockCutTemplate | undefined,
  ratio: number,
): RockCutTemplate | undefined {
  if (ratio <= EPS) return a && { ...a }
  if (ratio >= 1 - EPS) return b && { ...b }
  if (!a || !b) return ratio < 0.5 ? a && { ...a } : b && { ...b }
  const out: RockCutTemplate = {}
  for (const key of ROCK_CUT_KEYS) {
    const from = a[key],
      to = b[key]
    if (from !== undefined && to !== undefined) out[key] = from + (to - from) * ratio
    else if (ratio < 0.5 ? from !== undefined : to !== undefined) out[key] = ratio < 0.5 ? from : to
  }
  return out
}

/** One rock horizon piece of a station's column, by material. */
export interface RockPiece {
  materialId: string
  topDepthM: number
  bottomDepthM: number | null
}

export interface RockSectionInput {
  /** The built section, sorted by offset. */
  section: readonly SectionSample[]
  /** The station's horizon pieces whose material is rock. */
  pieces: readonly RockPiece[]
  /** The resolved template at the station. */
  template: RoadTemplate
  leftWidth: number
  rightWidth: number
  /** Each side's ditch top and flat-bottom widths, m (the template's side values). */
  ditch: Record<Side, { widthM: number; bottomWidthM: number }>
  /** Whether the section builder closed the section; areas are reported only when it did. */
  complete: boolean
}

/** The blasting level of one side, in distance `u` from the centreline. Null where the side has none. */
interface SideBlast {
  sign: number
  /** Ditch inner and outer bottom edges; the level ends at the outer one, where the rock face starts. */
  xi: number
  xo: number
  /** Breakpoints of the level besides `xi` and `xo`, inside them. */
  kinks: number[]
  /** The level at `u`, taking the piece that holds `at` (the middle of the interval being integrated). */
  level: (u: number, at?: number) => number
}

const interpolate = (section: readonly SectionSample[], x: number, key: 'ground' | 'design' | 'preparedGround') => {
  const value = (p: SectionSample) =>
    key === 'preparedGround' ? (p.preparedGround === undefined ? p.ground : p.preparedGround) : p[key]
  if (!section.length || x < section[0].offset - EPS || x > section[section.length - 1].offset + EPS) return null
  for (let i = 0; i < section.length; i++) {
    const b = section[i]
    if (Math.abs(b.offset - x) <= EPS) return value(b)
    if (b.offset > x && i > 0) {
      const a = section[i - 1],
        va = value(a),
        vb = value(b)
      if (va === null || vb === null) return null
      return va + ((vb - va) * (x - a.offset)) / (b.offset - a.offset)
    }
  }
  return null
}

function sideBlast(input: RockSectionInput, side: Side): SideBlast | null {
  const block = rockCutAt(input.template, side)
  if (block?.blastDepthM === undefined) return null
  const sign = side === 'left' ? -1 : 1,
    width = side === 'left' ? input.leftWidth : input.rightWidth
  const at = (u: number, key: 'design' | 'preparedGround') => interpolate(input.section, sign * u, key)
  const centre = at(0, 'design'),
    edge = at(width, 'design'),
    edgeGround = at(width, 'preparedGround')
  // A side whose formation edge is in fill has no rock face and no ditch: nothing is blasted there.
  if (centre === null || edge === null || edgeGround === null || edgeGround <= edge + EPS) return null
  const { widthM, bottomWidthM } = input.ditch[side],
    bottom = Math.min(widthM, Math.max(0, bottomWidthM))
  let xi = width,
    xo = width,
    zb = edge
  const middle = widthM > EPS ? at(width + widthM / 2, 'design') : null
  if (middle !== null && middle < edge - EPS) {
    xi = width + (widthM - bottom) / 2
    xo = width + (widthM + bottom) / 2
    zb = at(xi, 'design') ?? middle
  }
  // The rock face: the design segment that leaves the ditch bottom (or the edge), extended down.
  const next = input.section
    .filter((p) => p.design !== null && sign * p.offset > xo + 1e-6)
    .sort((a, b) => sign * a.offset - sign * b.offset)[0]
  const m = next ? (next.design! - zb) / (sign * next.offset - xo) : Infinity
  const face = Number.isFinite(m) && m > 0 ? (u: number) => zb + m * (u - xo) : null
  const c = (block.blastCrossfallPercent ?? DEFAULT_BLAST_CROSSFALL_PERCENT) / 100,
    r = -(block.drainageCrossfallPercent ?? DEFAULT_DRAINAGE_CROSSFALL_PERCENT) / 100
  const z0 = centre - block.blastDepthM,
    zi = z0 - xi * c
  const line = (u: number, at: number) => (at <= xi + EPS ? z0 - u * c : zi + r * (u - xi))
  const kinks: number[] = []
  if (face) {
    // Where the face crosses the falling line inside the ditch's inner edge, and the rising one past it.
    const u1 = (z0 - zb + m * xo) / (m + c)
    if (u1 > EPS && u1 < xi - EPS) kinks.push(u1)
    if (m > r + EPS) {
      const u2 = (zi - r * xi - zb + m * xo) / (m - r)
      if (u2 > xi + EPS && u2 < xo - EPS) kinks.push(u2)
    }
  }
  return {
    sign,
    xi,
    xo,
    kinks,
    level(u, mid = u) {
      const own = line(u, mid)
      if (!face) return own
      // The higher of the two holds over the whole piece; the piece is chosen at its middle.
      return face(mid) > line(mid, mid) ? face(u) : own
    },
  }
}

/** Parameters in (0, 1) where any two of the linear functions (values at 0 and 1) cross. */
function crossings(lines: readonly [number, number][]): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const d0 = lines[i][0] - lines[j][0],
        d1 = lines[i][1] - lines[j][1]
      if (d0 * d1 < 0) out.push(d0 / (d0 - d1))
    }
  return out.sort((a, b) => a - b)
}

/**
 * The section with its top of rock and blasting level, and, for a complete section, each rock
 * material's cut, shallow cut and overbreak with the shallow rock's width. The blasting level's
 * breakpoints are added as samples, interpolated linearly, so every area the section already had is
 * unchanged. Returns the section unchanged when the station has no rock.
 */
export function rockSection(input: RockSectionInput): { section: SectionSample[]; rock?: StationRock } {
  const pieces = input.pieces.filter((p) => p.bottomDepthM === null || p.bottomDepthM > p.topDepthM + EPS)
  if (!pieces.length) return { section: [...input.section] }
  const topOfRock = Math.min(...pieces.map((p) => p.topDepthM))
  const blasts = { left: sideBlast(input, 'left'), right: sideBlast(input, 'right') }
  const shallow = {
    left: rockCutAt(input.template, 'left')?.shallowDepthM,
    right: rockCutAt(input.template, 'right')?.shallowDepthM,
  }
  // The blasting level's breakpoints become samples, so the level is linear between samples.
  const section = [...input.section]
  const prepared = section.some((p) => p.preparedGround !== undefined)
  for (const blast of [blasts.left, blasts.right]) {
    if (!blast) continue
    for (const u of [blast.xi, blast.xo, ...blast.kinks]) {
      const x = blast.sign * u
      if (section.some((p) => Math.abs(p.offset - x) < 1e-6)) continue
      const i = section.findIndex((p) => p.offset > x)
      if (i <= 0) continue
      const a = section[i - 1],
        b = section[i],
        f = (x - a.offset) / (b.offset - a.offset)
      const lerp = (va: number | null | undefined, vb: number | null | undefined) =>
        va == null || vb == null ? null : va + (vb - va) * f
      section.splice(i, 0, {
        offset: x,
        ground: lerp(a.ground, b.ground),
        design: lerp(a.design, b.design),
        ...(prepared
          ? {
              preparedGround: lerp(
                a.preparedGround === undefined ? a.ground : a.preparedGround,
                b.preparedGround === undefined ? b.ground : b.preparedGround,
              ),
            }
          : {}),
      })
    }
  }
  const sideOf = (x: number): Side => (x < 0 ? 'left' : 'right')
  /**
   * The blasting level at a sample, drawn where the side is blasted, the level is not above the
   * design line and rock reaches down to it. It closes on the ditch bottom at the rock face.
   */
  const blastAt = (p: SectionSample) => {
    const blast = blasts[sideOf(p.offset)],
      u = Math.abs(p.offset)
    if (!blast || u > blast.xo + EPS || p.design === null || p.ground === null) return null
    const level = blast.level(u),
      surface = Math.min(p.ground - topOfRock, p.preparedGround ?? p.ground)
    return level <= p.design + 1e-6 && surface > level - 1e-6 ? level : null
  }
  const out = section.map((p): SectionSample => {
    const level = blastAt(p)
    return {
      ...p,
      rockTop: p.ground === null ? null : p.ground - topOfRock,
      ...(blasts.left || blasts.right ? { blastLevel: level } : {}),
    }
  })
  if (!input.complete) return { section: out }

  const areas = new Map<string, RockSectionArea>()
  for (const piece of pieces)
    if (!areas.has(piece.materialId))
      areas.set(piece.materialId, {
        materialId: piece.materialId,
        cutAreaM2: 0,
        shallowAreaM2: 0,
        deepAreaM2: 0,
        deepMomentM3: 0,
      })
  let shallowWidthM = 0
  for (let i = 1; i < section.length; i++) {
    const a = section[i - 1],
      b = section[i]
    const width = b.offset - a.offset
    if (width <= EPS || a.ground === null || b.ground === null || a.design === null || b.design === null) continue
    const pa = a.preparedGround === undefined ? a.ground : a.preparedGround,
      pb = b.preparedGround === undefined ? b.ground : b.preparedGround
    if (pa === null || pb === null) continue
    const mid = (a.offset + b.offset) / 2,
      side = sideOf(mid),
      blast = blasts[side],
      blasted = !!blast && Math.abs(mid) <= blast.xo + EPS
    const level: [number, number] | null = blasted
      ? [blast.level(Math.abs(a.offset), Math.abs(mid)), blast.level(Math.abs(b.offset), Math.abs(mid))]
      : null
    const ground: [number, number] = [a.ground, b.ground],
      design: [number, number] = [a.design, b.design],
      top: [number, number] = [pa, pb]
    const shift = (line: [number, number], depth: number): [number, number] => [line[0] - depth, line[1] - depth]
    const rockTop = shift(ground, topOfRock)
    // Nothing to count when the top of rock lies below everything excavated here.
    if (Math.max(...rockTop) <= Math.min(...design, ...(level ?? design)) + EPS) continue
    const limit = shallow[side]
    const lower = level ?? design
    const lines: [number, number][] = [ground, design, top, rockTop]
    if (level) lines.push(level)
    if (limit !== undefined) lines.push([lower[0] + limit, lower[1] + limit])
    for (const piece of pieces) {
      lines.push(shift(ground, piece.topDepthM))
      if (piece.bottomDepthM !== null) lines.push(shift(ground, piece.bottomDepthM))
    }
    const knots = [0, ...crossings(lines), 1]
    const at = (line: [number, number], t: number) => line[0] + (line[1] - line[0]) * t
    for (let k = 1; k < knots.length; k++) {
      const t0 = knots[k - 1],
        t1 = knots[k]
      if (t1 - t0 <= 1e-12) continue
      const tm = (t0 + t1) / 2,
        x0 = a.offset + width * t0,
        x1 = a.offset + width * t1,
        w = x1 - x0
      // Shallow where the rock, from its surface (or the stripped ground below it) down to the
      // blasting level or the design line, is no thicker than the template's shallow depth.
      const isShallow = limit !== undefined && Math.min(at(rockTop, tm), at(top, tm)) - at(lower, tm) <= limit + 1e-9
      let cutAtMiddle = 0
      for (const piece of pieces) {
        const entry = areas.get(piece.materialId)!
        const upper = (t: number) => Math.min(at(top, t), at(ground, t) - piece.topDepthM)
        const base = (t: number) => (piece.bottomDepthM === null ? -Infinity : at(ground, t) - piece.bottomDepthM)
        const cut = (t: number) => Math.max(0, upper(t) - Math.max(at(design, t), base(t)))
        const c0 = cut(t0),
          c1 = cut(t1),
          area = ((c0 + c1) * w) / 2
        cutAtMiddle += cut(tm)
        entry.cutAreaM2 += area
        if (isShallow) entry.shallowAreaM2 += area
        if (level) {
          const deep = (t: number) => Math.max(0, Math.min(upper(t), at(design, t)) - Math.max(at(level, t), base(t)))
          const d0 = deep(t0),
            d1 = deep(t1)
          entry.deepAreaM2 += ((d0 + d1) * w) / 2
          entry.deepMomentM3 += (w * (d0 * (2 * x0 + x1) + d1 * (x0 + 2 * x1))) / 6
        }
      }
      if (isShallow && cutAtMiddle > 1e-9) shallowWidthM += w
    }
  }
  return { section: out, rock: { areas: [...areas.values()], shallowWidthM } }
}

/**
 * What a rock material's overbreak does to the mass balance. The blasted rock refills its own void
 * below the subgrade, so of `deepBankM3` blasted, (factor − 1) × deep compacted m³ is left over: usable
 * in the material's reusable share and wasted (as bank m³) in the rest. A factor below 1 leaves the
 * void short by that much, which `shortfallCompactedM3` gives as extra fill.
 */
export function overbreakSwell(
  material: { compactionFactor: number; reusableFraction: number },
  deepBankM3: number,
): { swellCompactedM3: number; usableCompactedM3: number; unusableBankM3: number; shortfallCompactedM3: number } {
  const swell = (material.compactionFactor - 1) * deepBankM3
  if (swell <= 0)
    return { swellCompactedM3: swell, usableCompactedM3: 0, unusableBankM3: 0, shortfallCompactedM3: -swell }
  return {
    swellCompactedM3: swell,
    usableCompactedM3: swell * material.reusableFraction,
    unusableBankM3: (swell * (1 - material.reusableFraction)) / material.compactionFactor,
    shortfallCompactedM3: 0,
  }
}
