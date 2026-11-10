/**
 * A D-line's intermediate-support settings as the project stores them, their limits, and the run
 * they turn into: the D-line's rigging in kN, the ground sampled every metre from the yarder out
 * past both ends for the anchors, and the search settings.
 *
 * Written from a functional specification of SEILAPLAN 3.8.2; no code from SEILAPLAN
 * (GPL-2.0-or-later) was used. Pure: no DOM or network access.
 */
import { resolvedCableLine } from '../cableGeometry'
import { MAX_MECHANICS_SPAN_M, STANDARD_GRAVITY, riggingErrors, riggingForces } from '../cableMechanics'
import { distance, offsetCoordinate } from '../engine'
import type { CableLine, Coordinate, TerrainSource } from '../types'
import type { CableLayoutInput, CableSystem, LayoutEndKind, LayoutStartKind, LayoutToAnalyse } from './cableLayout'

/** Ground spacing the search reads, m. */
export const LAYOUT_PROFILE_SPACING_M = 1
/** Load positions solved per span, cosine-spaced; the path between them is interpolated (≤ 1 cm on 400 m). */
export const LAYOUT_LOAD_POSITIONS = 32
/** Longest D-line the search plans, m (the rope mechanics' own limit). */
export const MAX_LAYOUT_LINE_M = MAX_MECHANICS_SPAN_M
/** Most spans one run checks before it refuses (each is a few rope solves). */
export const MAX_LAYOUT_SPANS = 400_000
/** Most pre-tensions searched; the step widens past it. */
export const MAX_TENSION_STEPS = 2000
export const MAX_FIXED_SUPPORTS = 50
export const MAX_SECTORS = 50
export const MAX_SAVED_SUPPORTS = 200

export interface FixedSupportEntry {
  /** From the yarder, m. */
  stationM: number
  /** Saddle height, m; absent: the search picks it. */
  heightM?: number
}
export interface SectorEntry {
  fromM: number
  toM: number
}
/** The layout a run found (or one entered), kept so a reload shows and re-checks it. */
export interface SavedLayout {
  preTensionKN: number
  complete: boolean
  supports: { stationM: number; heightM: number }[]
}

export interface CableSupportLayout {
  startKind: LayoutStartKind
  endKind: LayoutEndKind
  cableSystem: CableSystem
  minSupportHeightM: number
  maxSupportHeightM: number
  heightStepM: number
  candidateSpacingM: number
  minSupportSpacingM: number
  builtSupportAboveM: number
  clearanceFromStartM: number
  clearanceBeforeEndM: number
  trafficableFromStartM: number
  trafficableBeforeEndM: number
  minGravityGradePercent: number
  liftOffDeg: number
  holdDownDeg: number
  maxLoadedDeg: number
  maxLoadedEndDeg: number
  anchorDistanceM: number
  lowestPreTensionKN: number
  fixedSupports: FixedSupportEntry[]
  noSupportSectors: SectorEntry[]
  saved?: SavedLayout
}

type NumericKey = {
  [K in keyof CableSupportLayout]-?: CableSupportLayout[K] extends number ? K : never
}[keyof CableSupportLayout]

/** Starting values: SEILAPLAN's Standard set where it has one. Replace them with the job's. */
export const DEFAULT_SUPPORT_LAYOUT: CableSupportLayout = {
  startKind: 'yarder',
  endKind: 'support',
  cableSystem: 'multi-cable',
  minSupportHeightM: 8,
  maxSupportHeightM: 22,
  heightStepM: 2,
  candidateSpacingM: 10,
  minSupportSpacingM: 10,
  builtSupportAboveM: 22,
  clearanceFromStartM: 20,
  clearanceBeforeEndM: 20,
  trafficableFromStartM: 0,
  trafficableBeforeEndM: 0,
  minGravityGradePercent: 0,
  liftOffDeg: 1,
  holdDownDeg: 3,
  maxLoadedDeg: 30,
  maxLoadedEndDeg: 60,
  anchorDistanceM: 20,
  lowestPreTensionKN: 20,
  fixedSupports: [],
  noSupportSectors: [],
}

/** [low, high] for every number; a project file is refused outside them. */
export const SUPPORT_LAYOUT_LIMITS: Record<NumericKey, readonly [number, number]> = {
  minSupportHeightM: [1, 50],
  maxSupportHeightM: [1, 50],
  heightStepM: [0.5, 10],
  candidateSpacingM: [1, 100],
  minSupportSpacingM: [0, 500],
  builtSupportAboveM: [0, 100],
  clearanceFromStartM: [0, 500],
  clearanceBeforeEndM: [0, 500],
  trafficableFromStartM: [0, 1000],
  trafficableBeforeEndM: [0, 1000],
  minGravityGradePercent: [0, 50],
  liftOffDeg: [0, 15],
  holdDownDeg: [0, 15],
  maxLoadedDeg: [0, 90],
  maxLoadedEndDeg: [0, 90],
  anchorDistanceM: [0, 100],
  lowestPreTensionKN: [1, 10_000],
}

export const SUPPORT_LAYOUT_LABELS: Record<NumericKey, string> = {
  minSupportHeightM: 'Lowest support (m)',
  maxSupportHeightM: 'Tallest support (m)',
  heightStepM: 'Height step (m)',
  candidateSpacingM: 'Candidate spacing (m)',
  minSupportSpacingM: 'Min support spacing (m)',
  builtSupportAboveM: 'Built support above (m)',
  clearanceFromStartM: 'Clearance from start after (m)',
  clearanceBeforeEndM: 'Clearance up to before end (m)',
  trafficableFromStartM: 'Gravity check after (m)',
  trafficableBeforeEndM: 'Gravity check up to before end (m)',
  minGravityGradePercent: 'Min gravity grade (%)',
  liftOffDeg: 'Min empty break angle (°)',
  holdDownDeg: 'Hold-down lug below (°)',
  maxLoadedDeg: 'Max loaded break, intermediate (°)',
  maxLoadedEndDeg: 'Max loaded break, end support (°)',
  anchorDistanceM: 'Anchor behind support (m)',
  lowestPreTensionKN: 'Lowest pre-tension (kN)',
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Every reason the settings cannot run, in the form's words. Empty when they can. */
export function supportLayoutErrors(s: CableSupportLayout): string[] {
  const errors: string[] = []
  if (!['yarder', 'support', 'anchor'].includes(s.startKind)) errors.push('Choose a yarder, support or anchor start.')
  if (!['support', 'anchor'].includes(s.endKind)) errors.push('Choose a support or anchor end.')
  if (!['two-cable', 'multi-cable'].includes(s.cableSystem)) errors.push('Choose a two-cable or multi-cable system.')
  for (const key of Object.keys(SUPPORT_LAYOUT_LIMITS) as NumericKey[]) {
    const [low, high] = SUPPORT_LAYOUT_LIMITS[key]
    const v = s[key]
    if (!isNumber(v) || v < low || v > high)
      errors.push(`${SUPPORT_LAYOUT_LABELS[key]} must be between ${low} and ${high}.`)
  }
  if (errors.length) return errors
  if (s.minSupportHeightM > s.maxSupportHeightM) errors.push('The lowest support must not be taller than the tallest.')
  if (s.endKind === 'anchor' && s.clearanceBeforeEndM <= 0)
    errors.push('An anchor end needs a clearance zone before it: the carriage comes down to the ground there.')
  if (s.startKind === 'anchor' && s.clearanceFromStartM <= 0)
    errors.push('An anchor start needs a clearance zone after it: the carriage comes down to the ground there.')
  if (s.fixedSupports.length > MAX_FIXED_SUPPORTS) errors.push(`At most ${MAX_FIXED_SUPPORTS} fixed supports.`)
  if (s.noSupportSectors.length > MAX_SECTORS) errors.push(`At most ${MAX_SECTORS} no-support sectors.`)
  const stations = new Set<number>()
  for (const f of s.fixedSupports) {
    if (!isNumber(f.stationM) || f.stationM <= 0 || f.stationM >= MAX_LAYOUT_LINE_M)
      errors.push('A fixed support needs a station inside the line.')
    else if (stations.has(Math.round(f.stationM * 1000))) errors.push('Two fixed supports share a station.')
    else stations.add(Math.round(f.stationM * 1000))
    if (f.heightM !== undefined && (!isNumber(f.heightM) || f.heightM <= 0 || f.heightM > 50))
      errors.push('A fixed support height must be between 0 and 50 m.')
  }
  for (const r of s.noSupportSectors)
    if (!isNumber(r.fromM) || !isNumber(r.toM) || r.fromM < 0 || r.toM <= r.fromM || r.toM > MAX_LAYOUT_LINE_M)
      errors.push('A no-support sector must run forwards inside the line.')
  for (const f of s.fixedSupports)
    if (s.noSupportSectors.some((r) => f.stationM > r.fromM && f.stationM < r.toM))
      errors.push(`The fixed support at ${f.stationM} m lies inside a no-support sector.`)
  return [...new Set(errors)]
}

function list(raw: unknown, label: string, max: number): unknown[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > max) throw Error(`${label} must be a list of at most ${max}.`)
  return raw
}

/** Reads a saved support layout, refusing unknown kinds and out-of-range values. */
export function parseSupportLayout(raw: unknown): CableSupportLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('D-line support layout must be an object.')
  const r = raw as Record<string, unknown>
  const s = {
    ...DEFAULT_SUPPORT_LAYOUT,
    startKind: r.startKind ?? DEFAULT_SUPPORT_LAYOUT.startKind,
    endKind: r.endKind ?? DEFAULT_SUPPORT_LAYOUT.endKind,
    cableSystem: r.cableSystem ?? DEFAULT_SUPPORT_LAYOUT.cableSystem,
  } as CableSupportLayout
  for (const key of Object.keys(SUPPORT_LAYOUT_LIMITS) as NumericKey[])
    if (r[key] !== undefined) (s as unknown as Record<string, unknown>)[key] = r[key]
  s.fixedSupports = list(r.fixedSupports, 'Fixed supports', MAX_FIXED_SUPPORTS).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    return { stationM: o.stationM as number, ...(o.heightM === undefined ? {} : { heightM: o.heightM as number }) }
  })
  s.noSupportSectors = list(r.noSupportSectors, 'No-support sectors', MAX_SECTORS).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    return { fromM: o.fromM as number, toM: o.toM as number }
  })
  const errors = supportLayoutErrors(s)
  if (errors.length) throw Error(`D-line support layout: ${errors[0]}`)
  if (r.saved !== undefined) {
    const v = (r.saved ?? {}) as Record<string, unknown>
    const supports = list(v.supports, 'Saved supports', MAX_SAVED_SUPPORTS).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>
      if (!isNumber(o.stationM) || !isNumber(o.heightM) || o.stationM < 0 || o.heightM < 0 || o.heightM > 100)
        throw Error('D-line support layout: a saved support needs a station and a 0–100 m height.')
      return { stationM: o.stationM, heightM: o.heightM }
    })
    if (!isNumber(v.preTensionKN) || v.preTensionKN <= 0 || v.preTensionKN > 10_000 || typeof v.complete !== 'boolean')
      throw Error('D-line support layout: the saved layout needs its pre-tension and whether it is complete.')
    if (supports.length < 2 || supports.some((p, i) => i > 0 && p.stationM <= supports[i - 1].stationM))
      throw Error('D-line support layout: saved supports must run forwards from the yarder.')
    s.saved = { preTensionKN: v.preTensionKN, complete: v.complete, supports }
  }
  return s
}

function headingDeg(a: Coordinate, b: Coordinate) {
  const RAD = Math.PI / 180
  const d = (b[0] - a[0]) * RAD,
    p = a[1] * RAD,
    q = b[1] * RAD
  const h = Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d))
  return (((h / RAD + 360) % 360) + 360) % 360
}

export interface LayoutRun {
  input: CableLayoutInput
  /** Horizontal length of the line, m. */
  lengthM: number
  /** True when the yarder is at the D-line's physical end: profile distance = length − station. */
  yarderAtEnd: boolean
}

/** The D-line's length and which end the yarder is at, or null for invalid geometry. */
export function lineFrame(line: CableLine): Pick<LayoutRun, 'lengthM' | 'yarderAtEnd'> | null {
  try {
    const resolved = resolvedCableLine(line)
    return { lengthM: distance(resolved.start, resolved.end), yarderAtEnd: (line.yarderAt ?? 'start') === 'end' }
  } catch {
    return null
  }
}

/** Profile distance on the D-line chart for a station from the yarder. */
export function chartDistance(run: Pick<LayoutRun, 'lengthM' | 'yarderAtEnd'>, stationM: number) {
  return run.yarderAtEnd ? run.lengthM - stationM : stationM
}

/**
 * The run for a D-line with rope mechanics: its rigging in kN, its ground every metre from the
 * yarder out past both ends to the anchors, and the settings. Returns why it cannot run instead
 * when the line, rigging or settings are not usable.
 */
export function layoutRun(
  line: CableLine,
  terrain: TerrainSource,
  settings: CableSupportLayout,
): { ok: true; run: LayoutRun } | { ok: false; error: string } {
  if (line.sagModel !== 'mechanics' || !line.rigging)
    return { ok: false, error: 'Choose Rope and load for this D-line to plan supports.' }
  const rigging = riggingErrors(line.rigging)
  if (rigging.length) return { ok: false, error: rigging[0] }
  const errors = supportLayoutErrors(settings)
  if (errors.length) return { ok: false, error: errors[0] }
  let resolved: CableLine
  try {
    resolved = resolvedCableLine(line)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid D-line geometry.' }
  }
  const yarderAtEnd = (line.yarderAt ?? 'start') === 'end'
  const yarder = yarderAtEnd ? resolved.end : resolved.start
  const far = yarderAtEnd ? resolved.start : resolved.end
  const lengthM = distance(yarder, far)
  if (!(lengthM >= 20) || lengthM > MAX_LAYOUT_LINE_M)
    return { ok: false, error: `Support layouts need a D-line between 20 m and ${MAX_LAYOUT_LINE_M} m long.` }
  const heading = headingDeg(yarder, far)
  const ground = (s: number) => {
    const z = terrain.elevationAt(...offsetCoordinate(yarder, heading, s))
    return Number.isFinite(z) ? z : NaN
  }
  if (Number.isNaN(ground(0)) || Number.isNaN(ground(lengthM)))
    return { ok: false, error: 'Ground at the yarder or the far support is unknown.' }
  for (const f of settings.fixedSupports)
    if (f.stationM >= lengthM) return { ok: false, error: `The fixed support at ${f.stationM} m is beyond the line.` }
  // Anchors sit on known ground behind each end, as far as the anchor distance where it is known.
  const reach = (from: number, sign: number) => {
    for (let d = Math.floor(settings.anchorDistanceM); d > 0; d--) if (!Number.isNaN(ground(from + sign * d))) return d
    return 0
  }
  const before = reach(0, -1)
  const after = reach(lengthM, 1)
  const dx = LAYOUT_PROFILE_SPACING_M
  const count = Math.ceil((lengthM + after + before) / dx) + 1
  const z = new Float64Array(count)
  for (let i = 0; i < count; i++) z[i] = ground(-before + i * dx)
  const forces = riggingForces(line.rigging)
  const allowableKN = forces.allowableN / 1000
  const high = Math.floor(allowableKN)
  const low = Math.min(settings.lowestPreTensionKN, high)
  if (!(high >= 1)) return { ok: false, error: 'The allowable tension is below 1 kN.' }
  const step = Math.max(1, Math.ceil((high - low) / MAX_TENSION_STEPS))
  const kNPerKg = STANDARD_GRAVITY / 1000
  const r = line.rigging
  return {
    ok: true,
    run: {
      lengthM,
      yarderAtEnd,
      input: {
        model: 'catenary',
        startKind: settings.startKind,
        endKind: settings.endKind,
        towerHeightM: line.startHeight,
        cableSystem: settings.cableSystem,
        trafficableFromStartM: settings.trafficableFromStartM,
        trafficableBeforeEndM: settings.trafficableBeforeEndM,
        minClearanceM: r.minClearanceM,
        clearanceFromStartM: settings.clearanceFromStartM,
        clearanceBeforeEndM: settings.clearanceBeforeEndM,
        zoneClearanceM: 0,
        loadKN: (r.payloadKg + r.carriageKg) * kNPerKg,
        ropeKNPerM: r.ropeMassKgPerM * kNPerKg,
        runningLinesKNPerM: r.runningLinesKgPerM * kNPerKg,
        stiffnessKN: forces.stiffnessN / 1000,
        allowableKN,
        tensionLowKN: low,
        tensionHighKN: high,
        tensionStepKN: step,
        minSupportSpacingM: settings.minSupportSpacingM,
        candidateSpacingM: settings.candidateSpacingM,
        minHeightM: settings.minSupportHeightM,
        maxHeightM: settings.maxSupportHeightM,
        heightStepM: settings.heightStepM,
        builtSupportAboveM: settings.builtSupportAboveM,
        liftOffDeg: settings.liftOffDeg,
        holdDownDeg: settings.holdDownDeg,
        maxLoadedDeg: settings.maxLoadedDeg,
        maxLoadedEndDeg: settings.maxLoadedEndDeg,
        anchorDistanceM: settings.anchorDistanceM,
        anchorReferenceHeightM: 12,
        minGravityGrade: settings.minGravityGradePercent / 100,
        lineEndM: lengthM,
        maxSpans: MAX_LAYOUT_SPANS,
        loadPositions: LAYOUT_LOAD_POSITIONS,
        profile: { x0: -before, dx, z },
        fixedSupports: settings.fixedSupports,
        noSupportSectors: settings.noSupportSectors,
      },
    },
  }
}

/** The saved layout as the crate's analysis input, or null when it no longer fits the line. */
export function savedLayoutToAnalyse(run: LayoutRun, saved: SavedLayout | undefined): LayoutToAnalyse | null {
  if (!saved) return null
  const last = saved.supports.at(-1)!
  if (saved.supports[0].stationM !== 0 || last.stationM > run.lengthM + 1e-6) return null
  if (saved.complete && Math.abs(last.stationM - run.lengthM) > 0.5) return null
  const { input } = run
  const supports = saved.supports.map((s, i) => {
    const end = saved.complete && i === saved.supports.length - 1
    // The ends follow the D-line as it is now: the yarder's height, a ground anchor's zero.
    if (i === 0 && input.startKind !== 'support')
      return { stationM: 0, heightM: input.startKind === 'yarder' ? input.towerHeightM : 0 }
    if (end) return { stationM: run.lengthM, heightM: input.endKind === 'anchor' ? 0 : s.heightM }
    return s
  })
  return { preTensionKN: saved.preTensionKN, complete: saved.complete, supports }
}
