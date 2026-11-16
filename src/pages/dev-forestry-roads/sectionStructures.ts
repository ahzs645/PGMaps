/**
 * Section parts beyond lane, ditch and batter: a ditch whose inslope and backslope differ, benched
 * cut and fill slopes, course side slopes, cut and fill walls, barriers and sub-cuts. Each is an
 * optional template value; a template without them builds and prices exactly as before.
 *
 * - **Ditch inslope** (`ditchInslope`, `leftDitchInslope`, `rightDitchInslope`, H:V): the slope from
 *   the formation edge down to the ditch bottom. The ditch keeps its top width, depth and bottom
 *   width, so the backslope takes the rest of the top width. Omitted: both sides run at the same
 *   slope, as they always have.
 * - **Benches** (`benches`, `leftBenches`, `rightBenches`, each with `cut` and `fill`): the batter
 *   rises (or falls) `heightM` at its face slope, then a bench `widthM` wide runs out at its fall,
 *   up to `count` times; after the last bench the side's batter closes to ground. Ground met on a
 *   face or a bench is the daylight there.
 * - **Course side slopes** (`SectionLayer.sideSlope`, H:V): a course's edges run in from its bottom
 *   edge at that slope, so courses narrow upward from the subgrade (formation) edge and the running
 *   surface is narrower than the formation by the courses' side runs.
 * - **Walls** (`walls`): a cut wall stands where a cut side leaves the ditch (or formation): the
 *   excavation runs under its base and up its back, the side's batter continues from its top, and a
 *   cut lower than the wall stops it at the ground. A fill wall holds a fill side: its face drops
 *   from the shoulder to the ground (a fill deeper than the wall continues below it at the fill
 *   batter); its body is taken out of the fill and its embedded base adds to the cut. The wall's
 *   body is reported as a structure volume; no structural check is made. A fill wall with a cover
 *   (`coverHeightM`, RoadEng Wall I's `WallCoverHt` under `bWallIncludeSG`) has its top that far
 *   below the formation edge, the road's fill over it. A cut wall with a backfill (`backfill`,
 *   RoadEng Wall IV) has the ground behind it dug out from its heel, level for `offsetM` and then
 *   up at `baseSlope` to the cut, and refilled to the cut surface (`toGround`) or to a top slope
 *   from the wall's top; the dig adds to the cut, the refill to the fill, and the wedge is reported
 *   as its own structure (`wall-backfill`).
 * - **Barriers** (`barriers`): guard rail, concrete barrier or railing standing on the running
 *   surface at an offset from the centreline. Drawn, listed and measured by length; no earthwork.
 * - **Sub-cuts** (`subCut`, `leftSubCut`, `rightSubCut`): ground removed below the subgrade
 *   (`reference: 'subgrade'`) or below the lower of subgrade and ground (`'merged'`), from the
 *   centreline out to its width and up its outside slope, then refilled. Its excavation adds to the
 *   section's cut and its backfill to the fill (and to a material demand when it names one). By
 *   default its bottom lies its depth below the reference all the way out. With a bottom slope
 *   (`bottomSlopePercent`), `followsCrossfall: false` or an inside slope (`insideSlope`) the bottom is
 *   a straight line from its depth below the reference at the centreline, at its own slope plus
 *   the road's crossfall where it follows it (RoadEng SubCut I/II: `SubCutBotSlope`, `bApplySuper`,
 *   `SubCutSlopeIn`), reached from the centreline down its inside slope.
 *
 * The RoadEng components these come from are mapped in `roadEngDesignSettings.ts`. Pure: no DOM,
 * terrain or network access.
 */
import { requireInRange, type EngineeringInputTarget } from './inputErrors'
import type { RoadStation, RoadTemplate, SectionLayer } from './types'

type Side = 'left' | 'right'
const EPS = 1e-7

/** Largest ditch PGMaps builds: top width and depth, m. */
export const MAX_DITCH_WIDTH_M = 30
export const MAX_DITCH_DEPTH_M = 10
/** Benches on one batter when the template does not say: older RoadEng Slope VI versions make up to five (the library's states `MaxNumberBenches`, at most 6). */
export const DEFAULT_BENCH_COUNT = 5
/** Walls and barriers in one template. */
export const MAX_SECTION_WALLS = 8
export const MAX_SECTION_BARRIERS = 8

export interface BenchedSlope {
  /** Rise (cut) or fall (fill) of each face between benches, m. */
  heightM: number
  /** Horizontal width of each bench, m. */
  widthM: number
  /** Face slope between benches, H:V. Omitted: the side's batter. */
  faceSlope?: number
  /** Fall of each bench away from the road, %; negative rises. Omitted: level. */
  benchFallPercent?: number
  /** Benches at most; after the last one the side's batter closes to ground. Omitted: 5. */
  count?: number
}
export interface SideBenches {
  cut?: BenchedSlope
  fill?: BenchedSlope
}
export interface SectionWall {
  id: string
  name: string
  side: Side
  /** A cut wall holds a cut side, a fill wall a fill side; each is built only in its condition. */
  kind: 'cut' | 'fill'
  /** Tallest face, m. A cut wall lower than this where the cut is low; a fill wall stops here. */
  heightM: number
  /** Horizontal thickness of the wall body, m. */
  thicknessM: number
  /** Batter of the face, H:V; 0 is vertical. Omitted: 0. */
  faceSlope?: number
  /** Level shelf from the attachment point to the foot (cut) or top (fill) of the face, m. */
  setbackM?: number
  /** Fill wall: depth of its base below the ground at its face, m. Omitted: 0. */
  embedM?: number
  /** Fill wall: its top lies this far below the formation edge, under the road's fill, m. Omitted: 0. */
  coverHeightM?: number
  /** Cut wall: the ground dug out behind it and refilled. Omitted: none. */
  backfill?: WallBackfill
  materialId?: string
}
export interface WallBackfill {
  /** Level dig behind the wall's heel before its base rises, m. */
  offsetM: number
  /** The dig's base rises at this slope to the cut, H:V; 0 is vertical. */
  baseSlope: number
  /** Refilled to the cut surface; false: to `topSlopePercent` from the wall's top. */
  toGround: boolean
  /** Top of the refill from the wall's top, % rise away from the road. Omitted: level. */
  topSlopePercent?: number
}
export interface SectionBarrier {
  id: string
  name: string
  side: Side
  kind: 'guard-rail' | 'concrete' | 'railing'
  /** Centreline to the barrier's inside face, m. */
  offsetM: number
  widthM: number
  heightM: number
}
export interface SubCut {
  id: string
  name: string
  /** `subgrade`: below the subgrade (RoadEng SUB CUT 2); `merged`: below the lower of subgrade and ground (SUB CUT 1). */
  reference: 'subgrade' | 'merged'
  depthM: number
  /** Centreline to the outside of the sub-cut's bottom, m. */
  widthM: number
  /** Outside slope from the bottom up to the reference, H:V; 0 is vertical. Omitted: 0. */
  outsideSlope?: number
  /** The bottom's own cross slope, % rise away from the centreline. Omitted: 0. */
  bottomSlopePercent?: number
  /** The bottom also takes the road's crossfall (RoadEng `bApplySuper`). Omitted: true. */
  followsCrossfall?: boolean
  /** Inside face from the reference at the centreline down to the bottom, H:V; omitted vertical. */
  insideSlope?: number
  /** Backfill material; its volume is a material demand when set. */
  materialId?: string
}
/** One structure in a calculated section: its outline (offset, elevation) and area. */
export interface StationStructure {
  id: string
  name: string
  kind: 'cut-wall' | 'fill-wall' | 'barrier' | 'sub-cut' | 'wall-backfill'
  side: Side
  /** Wall body, sub-cut or backfill excavation, m²; 0 for a barrier. */
  areaM2: number
  /** Face height (walls) or barrier height, m. */
  heightM: number
  outline: [number, number][]
}
/** A structure along the road: the length it stands on and its volume. */
export interface StructureQuantity {
  id: string
  name: string
  kind: StationStructure['kind']
  side: Side
  lengthM: number
  volumeM3: number
}

/** Each value's range. The project parser, the engine and the fields all hold to it. */
export const STRUCTURE_LIMITS = {
  ditchInslope: [0, 20],
  benchHeightM: [0.1, 30],
  benchWidthM: [0, 30],
  benchFaceSlope: [0.05, 10],
  benchFallPercent: [-50, 50],
  benchCount: [1, 20],
  wallHeightM: [0.1, 30],
  wallThicknessM: [0.05, 10],
  wallFaceSlope: [0, 2],
  wallSetbackM: [0, 20],
  wallEmbedM: [0, 5],
  barrierOffsetM: [0, 60],
  barrierWidthM: [0.02, 5],
  barrierHeightM: [0.1, 5],
  subCutDepthM: [0.01, 10],
  subCutWidthM: [0, 60],
  subCutOutsideSlope: [0, 10],
  subCutInsideSlope: [0, 10],
  subCutBottomSlopePercent: [-50, 50],
  wallCoverHeightM: [0, 10],
  wallBackfillOffsetM: [0, 30],
  wallBackfillBaseSlope: [0, 10],
  wallBackfillTopSlopePercent: [-100, 100],
  courseSideSlope: [0, 10],
} as const

// ---- Reading a template ------------------------------------------------------------------------------

export const ditchInslopeAt = (t: RoadTemplate, side: Side): number | undefined =>
  t[`${side}DitchInslope`] ?? t.ditchInslope
export const benchesAt = (t: RoadTemplate, side: Side, kind: 'cut' | 'fill'): BenchedSlope | undefined =>
  (t[`${side}Benches`] ?? t.benches)?.[kind]
export const subCutAt = (t: RoadTemplate, side: Side): SubCut | undefined => t[`${side}SubCut`] ?? t.subCut
export const wallsAt = (t: RoadTemplate, side: Side) => (t.walls ?? []).filter((w) => w.side === side)
export const barriersAt = (t: RoadTemplate, side: Side) => (t.barriers ?? []).filter((b) => b.side === side)

/** The template keys this module owns, for an editor that merges changes into a template. */
export const STRUCTURE_TEMPLATE_KEYS = [
  'ditchInslope',
  'leftDitchInslope',
  'rightDitchInslope',
  'benches',
  'leftBenches',
  'rightBenches',
  'walls',
  'barriers',
  'subCut',
  'leftSubCut',
  'rightSubCut',
] as const satisfies readonly (keyof RoadTemplate)[]

/** True when the template uses any part of this module (the section then takes the assembled path). */
export const hasSectionStructures = (t: RoadTemplate) =>
  t.ditchInslope !== undefined ||
  t.leftDitchInslope !== undefined ||
  t.rightDitchInslope !== undefined ||
  !!(t.benches || t.leftBenches || t.rightBenches) ||
  !!t.walls?.length ||
  !!t.barriers?.length ||
  !!(t.subCut || t.leftSubCut || t.rightSubCut)

/**
 * A ditch's horizontal runs: inslope, flat bottom, backslope, for a top width, depth and bottom
 * width. With no inslope the two sides share what the bottom leaves, as before; with one, the
 * inslope takes `depth × inslope` and the backslope the rest (never less than 0).
 */
export function ditchRuns(
  topWidthM: number,
  depthM: number,
  bottomWidthM: number,
  inslope: number | undefined,
): { inRun: number; bottom: number; backRun: number } {
  const bottom = Math.max(0, Math.min(topWidthM, bottomWidthM)),
    sides = Math.max(0, topWidthM - bottom)
  if (inslope === undefined || !(depthM > 0)) return { inRun: sides / 2, bottom, backRun: sides / 2 }
  const inRun = Math.min(sides, Math.max(0, inslope * depthM))
  return { inRun, bottom, backRun: sides - inRun }
}

/** The ditch on one side of a template: runs, and the backslope as H:V (null without a depth). */
export function ditchShapeAt(t: RoadTemplate, side: Side, sideValue: (attribute: string) => number) {
  const width = sideValue('DitchWidth'),
    depth = sideValue('DitchDepth'),
    bottomWidth = sideValue('DitchBottomWidth')
  const runs = ditchRuns(width, depth, bottomWidth, ditchInslopeAt(t, side))
  return {
    ...runs,
    width,
    depth,
    inslope: depth > 0 ? runs.inRun / depth : null,
    backslope: depth > 0 ? runs.backRun / depth : null,
  }
}

/** The horizontal run of every course with a side slope on one side, m: how much narrower the running surface is. */
export function courseSideRunM(layers: readonly SectionLayer[] | undefined, side: Side): number {
  return (layers ?? [])
    .filter((l) => l.side === side || l.side === 'both')
    .reduce((sum, l) => sum + l.depthM * (l.sideSlope ?? 0), 0)
}

/**
 * The courses on one side from the subgrade up: each one's bottom and top half-width and its
 * thickness. `layers` is the template's stack, listed from the subgrade up as the section draws
 * it; the first course sits on a formation `widthM` wide. A course with a side slope narrows by
 * its depth × slope.
 */
export function courseStack(layers: readonly SectionLayer[] | undefined, side: Side, widthM: number) {
  const own = (layers ?? []).filter((l) => l.side === side || l.side === 'both')
  const out: { layer: SectionLayer; bottomWidthM: number; topWidthM: number; baseDepthM: number }[] = []
  let bottom = widthM,
    base = 0
  for (const layer of own) {
    const top = Math.max(0, bottom - layer.depthM * (layer.sideSlope ?? 0))
    out.push({ layer, bottomWidthM: bottom, topWidthM: top, baseDepthM: base })
    bottom = top
    base += layer.depthM
  }
  return out
}

/** One course's area on one side: a trapezoid when it has a side slope, else its depth × width. */
export const courseAreaM2 = (c: { layer: SectionLayer; bottomWidthM: number; topWidthM: number }) =>
  (c.layer.depthM * (c.bottomWidthM + c.topWidthM)) / 2

// ---- Checks, project files and transitions ----------------------------------------------------------

const BENCH_BLOCKS = ['benches', 'leftBenches', 'rightBenches'] as const
const SUBCUT_BLOCKS = ['subCut', 'leftSubCut', 'rightSubCut'] as const

/** Throws an `EngineeringInputError` naming the first value out of range. */
export function validateSectionStructures(t: RoadTemplate, owner: string, target: EngineeringInputTarget): void {
  const check = (value: unknown, limit: keyof typeof STRUCTURE_LIMITS, label: string, field: string) =>
    requireInRange(value, STRUCTURE_LIMITS[limit][0], STRUCTURE_LIMITS[limit][1], owner, label, { ...target, field })
  for (const key of ['ditchInslope', 'leftDitchInslope', 'rightDitchInslope'] as const)
    if (t[key] !== undefined)
      check(t[key], 'ditchInslope', `${key === 'ditchInslope' ? '' : `${key.slice(0, -12)} `}ditch inslope (H:V)`, key)
  for (const block of BENCH_BLOCKS) {
    const value = t[block]
    if (value === undefined) continue
    for (const kind of ['cut', 'fill'] as const) {
      const b = value[kind]
      if (!b) continue
      const at = `${block}.${kind}`,
        name = `${block === 'benches' ? '' : `${block.slice(0, -7)} `}${kind} bench`
      check(b.heightM, 'benchHeightM', `${name} height (m)`, `${at}.heightM`)
      check(b.widthM, 'benchWidthM', `${name} width (m)`, `${at}.widthM`)
      if (b.faceSlope !== undefined) check(b.faceSlope, 'benchFaceSlope', `${name} face (H:V)`, `${at}.faceSlope`)
      if (b.benchFallPercent !== undefined)
        check(b.benchFallPercent, 'benchFallPercent', `${name} fall (%)`, `${at}.benchFallPercent`)
      if (b.count !== undefined) {
        check(b.count, 'benchCount', `${name} count`, `${at}.count`)
        if (!Number.isInteger(b.count)) check(Number.NaN, 'benchCount', `${name} count (a whole number)`, `${at}.count`)
      }
    }
  }
  if ((t.walls?.length ?? 0) > MAX_SECTION_WALLS)
    check(Number.NaN, 'wallHeightM', `walls (at most ${MAX_SECTION_WALLS})`, 'walls')
  for (const w of t.walls ?? []) {
    const at = `walls.${w.id}`
    check(w.heightM, 'wallHeightM', `${w.name} height (m)`, `${at}.heightM`)
    check(w.thicknessM, 'wallThicknessM', `${w.name} thickness (m)`, `${at}.thicknessM`)
    if (w.faceSlope !== undefined) check(w.faceSlope, 'wallFaceSlope', `${w.name} face batter (H:V)`, `${at}.faceSlope`)
    if (w.setbackM !== undefined) check(w.setbackM, 'wallSetbackM', `${w.name} setback (m)`, `${at}.setbackM`)
    if (w.embedM !== undefined) check(w.embedM, 'wallEmbedM', `${w.name} embedment (m)`, `${at}.embedM`)
    if (w.coverHeightM !== undefined)
      check(w.coverHeightM, 'wallCoverHeightM', `${w.name} cover (m)`, `${at}.coverHeightM`)
    if (w.backfill) {
      check(w.backfill.offsetM, 'wallBackfillOffsetM', `${w.name} backfill offset (m)`, `${at}.backfill.offsetM`)
      check(w.backfill.baseSlope, 'wallBackfillBaseSlope', `${w.name} backfill base (H:V)`, `${at}.backfill.baseSlope`)
      if (w.backfill.topSlopePercent !== undefined)
        check(
          w.backfill.topSlopePercent,
          'wallBackfillTopSlopePercent',
          `${w.name} backfill top (%)`,
          `${at}.backfill.topSlopePercent`,
        )
    }
  }
  if ((t.barriers?.length ?? 0) > MAX_SECTION_BARRIERS)
    check(Number.NaN, 'barrierHeightM', `barriers (at most ${MAX_SECTION_BARRIERS})`, 'barriers')
  for (const b of t.barriers ?? []) {
    const at = `barriers.${b.id}`
    check(b.offsetM, 'barrierOffsetM', `${b.name} offset (m)`, `${at}.offsetM`)
    check(b.widthM, 'barrierWidthM', `${b.name} width (m)`, `${at}.widthM`)
    check(b.heightM, 'barrierHeightM', `${b.name} height (m)`, `${at}.heightM`)
  }
  for (const block of SUBCUT_BLOCKS) {
    const s = t[block]
    if (!s) continue
    const name = `${block === 'subCut' ? '' : `${block.slice(0, -6)} `}sub-cut`
    check(s.depthM, 'subCutDepthM', `${name} depth (m)`, `${block}.depthM`)
    check(s.widthM, 'subCutWidthM', `${name} width (m)`, `${block}.widthM`)
    if (s.outsideSlope !== undefined)
      check(s.outsideSlope, 'subCutOutsideSlope', `${name} outside slope (H:V)`, `${block}.outsideSlope`)
    if (s.insideSlope !== undefined)
      check(s.insideSlope, 'subCutInsideSlope', `${name} inside slope (H:V)`, `${block}.insideSlope`)
    if (s.bottomSlopePercent !== undefined)
      check(s.bottomSlopePercent, 'subCutBottomSlopePercent', `${name} bottom slope (%)`, `${block}.bottomSlopePercent`)
  }
  for (const l of t.layers ?? [])
    if (l.sideSlope !== undefined)
      check(l.sideSlope, 'courseSideSlope', `${l.name} side slope (H:V)`, `layers.${l.id}.sideSlope`)
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, [low, high]: readonly [number, number], label: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high)
    throw Error(`${label} must be between ${low} and ${high}.`)
  return v
}
const text = (v: unknown, label: string, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${label} is missing or too long.`)
  return v.trim()
}
const bool = (v: unknown, label: string) => {
  if (typeof v !== 'boolean') throw Error(`${label} must be true or false.`)
  return v
}
const oneOf = <T extends string>(v: unknown, values: readonly T[], label: string): T => {
  if (!values.includes(v as T)) throw Error(`${label} must be one of ${values.join(', ')}.`)
  return v as T
}

function parseBenched(raw: unknown, label: string): BenchedSlope {
  if (!isRecord(raw)) throw Error(`${label} must be an object.`)
  const L = STRUCTURE_LIMITS
  return {
    heightM: num(raw.heightM, L.benchHeightM, `${label} height`),
    widthM: num(raw.widthM, L.benchWidthM, `${label} width`),
    ...(raw.faceSlope !== undefined ? { faceSlope: num(raw.faceSlope, L.benchFaceSlope, `${label} face`) } : {}),
    ...(raw.benchFallPercent !== undefined
      ? { benchFallPercent: num(raw.benchFallPercent, L.benchFallPercent, `${label} fall`) }
      : {}),
    ...(raw.count !== undefined ? { count: Math.round(num(raw.count, L.benchCount, `${label} count`)) } : {}),
  }
}

function parseSubCut(raw: unknown, label: string): SubCut {
  if (!isRecord(raw)) throw Error(`${label} must be an object.`)
  const L = STRUCTURE_LIMITS
  return {
    id: text(raw.id, `${label} ID`, 100),
    name: text(raw.name, `${label} name`),
    reference: oneOf(raw.reference, ['subgrade', 'merged'] as const, `${label} reference`),
    depthM: num(raw.depthM, L.subCutDepthM, `${label} depth`),
    widthM: num(raw.widthM, L.subCutWidthM, `${label} width`),
    ...(raw.outsideSlope !== undefined
      ? { outsideSlope: num(raw.outsideSlope, L.subCutOutsideSlope, `${label} outside slope`) }
      : {}),
    ...(raw.bottomSlopePercent !== undefined
      ? { bottomSlopePercent: num(raw.bottomSlopePercent, L.subCutBottomSlopePercent, `${label} bottom slope`) }
      : {}),
    ...(raw.followsCrossfall !== undefined
      ? { followsCrossfall: bool(raw.followsCrossfall, `${label} crossfall`) }
      : {}),
    ...(raw.insideSlope !== undefined
      ? { insideSlope: num(raw.insideSlope, L.subCutInsideSlope, `${label} inside slope`) }
      : {}),
    ...(raw.materialId !== undefined ? { materialId: text(raw.materialId, `${label} material`, 100) } : {}),
  }
}

function parseBackfill(raw: unknown, label: string): WallBackfill {
  if (!isRecord(raw)) throw Error(`${label} must be an object.`)
  const L = STRUCTURE_LIMITS
  return {
    offsetM: num(raw.offsetM, L.wallBackfillOffsetM, `${label} offset`),
    baseSlope: num(raw.baseSlope, L.wallBackfillBaseSlope, `${label} base slope`),
    toGround: bool(raw.toGround, `${label} to ground`),
    ...(raw.topSlopePercent !== undefined
      ? { topSlopePercent: num(raw.topSlopePercent, L.wallBackfillTopSlopePercent, `${label} top slope`) }
      : {}),
  }
}

/**
 * The structure values of a template record read from a project file: known values within their
 * limits; a template without them gets none of these keys.
 */
export function parseSectionStructures(r: Record<string, unknown>): Partial<RoadTemplate> {
  const out: Partial<RoadTemplate> = {}
  const L = STRUCTURE_LIMITS
  for (const key of ['ditchInslope', 'leftDitchInslope', 'rightDitchInslope'] as const)
    if (r[key] !== undefined) out[key] = num(r[key], L.ditchInslope, 'Ditch inslope')
  for (const block of BENCH_BLOCKS) {
    const raw = r[block]
    if (raw === undefined) continue
    if (!isRecord(raw)) throw Error('Benches must be an object.')
    const value: SideBenches = {}
    if (raw.cut !== undefined) value.cut = parseBenched(raw.cut, 'Cut bench')
    if (raw.fill !== undefined) value.fill = parseBenched(raw.fill, 'Fill bench')
    out[block] = value
  }
  if (r.walls !== undefined) {
    if (!Array.isArray(r.walls) || r.walls.length > MAX_SECTION_WALLS)
      throw Error(`A template holds at most ${MAX_SECTION_WALLS} walls.`)
    out.walls = r.walls.map((w): SectionWall => {
      if (!isRecord(w)) throw Error('A wall must be an object.')
      return {
        id: text(w.id, 'Wall ID', 100),
        name: text(w.name, 'Wall name'),
        side: oneOf(w.side, ['left', 'right'] as const, 'Wall side'),
        kind: oneOf(w.kind, ['cut', 'fill'] as const, 'Wall kind'),
        heightM: num(w.heightM, L.wallHeightM, 'Wall height'),
        thicknessM: num(w.thicknessM, L.wallThicknessM, 'Wall thickness'),
        ...(w.faceSlope !== undefined ? { faceSlope: num(w.faceSlope, L.wallFaceSlope, 'Wall face batter') } : {}),
        ...(w.setbackM !== undefined ? { setbackM: num(w.setbackM, L.wallSetbackM, 'Wall setback') } : {}),
        ...(w.embedM !== undefined ? { embedM: num(w.embedM, L.wallEmbedM, 'Wall embedment') } : {}),
        ...(w.coverHeightM !== undefined
          ? { coverHeightM: num(w.coverHeightM, L.wallCoverHeightM, 'Wall cover') }
          : {}),
        ...(w.backfill !== undefined ? { backfill: parseBackfill(w.backfill, 'Wall backfill') } : {}),
        ...(w.materialId !== undefined ? { materialId: text(w.materialId, 'Wall material', 100) } : {}),
      }
    })
  }
  if (r.barriers !== undefined) {
    if (!Array.isArray(r.barriers) || r.barriers.length > MAX_SECTION_BARRIERS)
      throw Error(`A template holds at most ${MAX_SECTION_BARRIERS} barriers.`)
    out.barriers = r.barriers.map((b): SectionBarrier => {
      if (!isRecord(b)) throw Error('A barrier must be an object.')
      return {
        id: text(b.id, 'Barrier ID', 100),
        name: text(b.name, 'Barrier name'),
        side: oneOf(b.side, ['left', 'right'] as const, 'Barrier side'),
        kind: oneOf(b.kind, ['guard-rail', 'concrete', 'railing'] as const, 'Barrier kind'),
        offsetM: num(b.offsetM, L.barrierOffsetM, 'Barrier offset'),
        widthM: num(b.widthM, L.barrierWidthM, 'Barrier width'),
        heightM: num(b.heightM, L.barrierHeightM, 'Barrier height'),
      }
    })
  }
  for (const block of SUBCUT_BLOCKS) if (r[block] !== undefined) out[block] = parseSubCut(r[block], 'Sub-cut')
  return out
}

/**
 * One side of a transition between two templates (`templateAt`): the inslope interpolates where
 * both templates give one; benches, walls, barriers and sub-cuts change at the transition's
 * midpoint. Writes the side's values into `out`, the resolved template.
 */
export function blendSectionStructures(
  out: RoadTemplate,
  from: RoadTemplate,
  to: RoadTemplate,
  side: Side,
  ratio: number,
): void {
  if (!hasSectionStructures(from) && !hasSectionStructures(to)) return
  const near = ratio < 0.5 ? from : to
  const a = ditchInslopeAt(from, side),
    b = ditchInslopeAt(to, side)
  const inslope = a !== undefined && b !== undefined ? a + (b - a) * ratio : ditchInslopeAt(near, side)
  if (inslope === undefined) delete out[`${side}DitchInslope`]
  else out[`${side}DitchInslope`] = inslope
  const other: Side = side === 'left' ? 'right' : 'left'
  // Each side resolves to blocks of its own, so a one-sided assignment leaves the other alone.
  if (out.ditchInslope !== undefined) {
    out[`${other}DitchInslope`] ??= out.ditchInslope
    delete out.ditchInslope
  }
  if (out.benches !== undefined) {
    out[`${other}Benches`] ??= out.benches
    delete out.benches
  }
  const benches = near[`${side}Benches`] ?? near.benches
  if (benches === undefined) delete out[`${side}Benches`]
  else out[`${side}Benches`] = benches
  if (out.subCut !== undefined) {
    out[`${other}SubCut`] ??= out.subCut
    delete out.subCut
  }
  const subCut = subCutAt(near, side)
  if (subCut === undefined) delete out[`${side}SubCut`]
  else out[`${side}SubCut`] = subCut
  out.walls = [...(out.walls ?? []).filter((w) => w.side !== side), ...wallsAt(near, side)]
  if (!out.walls.length) delete out.walls
  out.barriers = [...(out.barriers ?? []).filter((w) => w.side !== side), ...barriersAt(near, side)]
  if (!out.barriers.length) delete out.barriers
}

// ---- Along the road ---------------------------------------------------------------------------------

/**
 * Each structure's length and volume along the stations, by average end areas: an interval counts
 * fully where both ends have the structure and half where one does. Stations whose section is not
 * complete add no volume.
 */
export function structureQuantities(stations: readonly Pick<RoadStation, 'chainage' | 'structures' | 'complete'>[]) {
  const totals = new Map<string, StructureQuantity>()
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i],
      ds = b.chainage - a.chainage
    if (!(ds > EPS)) continue
    const keyOf = (s: StationStructure) => `${s.side}:${s.id}`
    const ids = new Set([...(a.structures ?? []), ...(b.structures ?? [])].map(keyOf))
    for (const key of ids) {
      const sa = a.structures?.find((s) => keyOf(s) === key),
        sb = b.structures?.find((s) => keyOf(s) === key)
      const any = (sa ?? sb)!
      const row =
        totals.get(key) ??
        totals
          .set(key, { id: any.id, name: any.name, kind: any.kind, side: any.side, lengthM: 0, volumeM3: 0 })
          .get(key)!
      row.lengthM += sa && sb ? ds : ds / 2
      if (a.complete && b.complete) row.volumeM3 += (((sa?.areaM2 ?? 0) + (sb?.areaM2 ?? 0)) * ds) / 2
    }
  }
  return [...totals.values()]
}
