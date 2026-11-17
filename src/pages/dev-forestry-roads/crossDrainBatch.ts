/**
 * Placing cross-drain culverts in batches (guide `drainage.md`, **Placing cross-drains in a
 * batch**). Drafts come from reviewed cross-drain candidates or from a trial spacing; each is built
 * into a `Culvert` and checked through the engine's own culvert calculation (`calculate`, which is
 * `calculateCulverts` over `engineeringGeometry`), so the preview shows what the road will calculate
 * once the drafts are added. Nothing here changes the project: the page adds the accepted rows in
 * one named undo step.
 *
 * Natural-stream crossings stay in individual review: a draft near one is refused. Coarse-grid
 * candidates stay available, marked as a screen.
 *
 * Free of DOM and network access.
 */
import type { Culvert, CulvertAnalysis } from './engineeringTypes'
import type { Alignment, RoadAnalysis, RoadSettings, RoadStation } from './types'
import { drainageRoadFingerprint } from './drainageEvidence'
import type { DitchLowPoint } from './hydrology'
import { CROSS_DRAIN_SITE_M, DEFAULT_CULVERT_SEARCH_M } from './hydrology'
import { culvertInletSide, otherSide, type CulvertInletSide } from './culverts/culvertInlet'

/** The project file's limit on culverts per road (`engineeringProject.ts`). */
export const MAX_ROAD_CULVERTS = 100
/**
 * Two pipes closer than this along the road are one site: the drainage run already counts a
 * culvert this close as serving a candidate (`DEFAULT_CULVERT_SEARCH_M`).
 */
export const BATCH_DUPLICATE_M = DEFAULT_CULVERT_SEARCH_M
/** A draft nearer than this to a natural-stream crossing is left to the crossing's own review. */
export const BATCH_STREAM_CLEARANCE_M = DEFAULT_CULVERT_SEARCH_M
/** Trial spacing limits, m. Change them with the guide's limits table. */
export const TRIAL_SPACING_LIMITS = { minM: 10, maxM: 1000 } as const
/** Barrel spans are rounded up to this, m. */
export const BATCH_SPAN_STEP_M = 0.5
/** Fall a new draft starts with, %: the drainage run's assumed slope. */
export const DEFAULT_BATCH_FALL_PERCENT = 2

export interface BatchPipeDefaults {
  diameterM: number
  minCoverM: number
  unitCost: number
  fixedCost: number
}
export const DEFAULT_BATCH_PIPE: BatchPipeDefaults = { diameterM: 0.6, minCoverM: 0.6, unitCost: 0, fixedCost: 0 }

export interface CrossDrainDraft {
  /** Stable for the life of the preview; becomes the culvert's id when added. */
  id: string
  origin: 'candidate' | 'spacing'
  /** The cross-drain site (`DitchLowPoint.id`) this draft came from. */
  siteId?: string
  /** The site's stretch: every outlet merged into it lies between these stations. */
  fromChainage?: number
  toChainage?: number
  /** Outlets merged into the site. */
  outlets?: number
  /** Every side the site's outlets are on. */
  sidesSeen?: CulvertInletSide[]
  /**
   * The inlet side the source proposes: the side a candidate's water gathers on, or the uphill end
   * of a spacing draft's barrel. Null when the ground does not say.
   */
  proposedSide: CulvertInletSide | null
  /** From a run on cells coarser than `DITCH_DETAIL_CELL_M`: a screen, not a site. */
  screening: boolean
  chainage: number
  inletSide: CulvertInletSide
  /** The designer has looked at the flow direction and kept or changed it. */
  sideConfirmed: boolean
  skewDegrees: number
  /** Fall, inlet to outlet, % of the horizontal span. */
  fallPercent: number
  included: boolean
}

export type BatchIssueCode =
  | 'outside-road'
  | 'side-unconfirmed'
  | 'natural-stream'
  | 'intersects'
  | 'over-limit'
  | 'duplicate'
  | 'short-span'
  | 'unknown-cover'
  | 'low-cover'
  | 'adverse-fall'
  | 'outlet-uphill'
  | 'off-site'
  | 'screening'
export interface BatchIssue {
  code: BatchIssueCode
  /** A blocking issue keeps the row out of the batch until it is fixed or the row is excluded. */
  blocks: boolean
  message: string
}
export interface BatchRow {
  draft: CrossDrainDraft
  culvert: Culvert
  result: CulvertAnalysis | null
  issues: BatchIssue[]
  /** Included and nothing blocks it. */
  ready: boolean
}

/** The engine's culvert calculation for culverts not yet in the road. */
export type CalculateCulverts = (culverts: Culvert[]) => CulvertAnalysis[]

const mm = (value: number) => Math.round(value * 1000) / 1000

function nearestStation(stations: readonly RoadStation[], chainage: number): RoadStation | undefined {
  let best: RoadStation | undefined
  for (const s of stations) if (!best || Math.abs(s.chainage - chainage) < Math.abs(best.chainage - chainage)) best = s
  return best
}

/**
 * Drafts for the selected cross-drain sites. A site already served through a culvert gets none.
 * Each pipe starts at the site's largest outlet, with its inlet proposed on the side that outlet
 * is on; the designer confirms the side and may move the pipe within (or out of) the stretch.
 */
export function draftsFromCandidates(
  sites: readonly DitchLowPoint[],
  selected: ReadonlySet<string>,
  options: { screening: boolean; newId: () => string; fallPercent?: number },
): CrossDrainDraft[] {
  return sites
    .filter((site) => selected.has(site.id) && !site.throughCulvert)
    .map((site) => ({
      id: options.newId(),
      origin: 'candidate' as const,
      siteId: site.id,
      fromChainage: site.fromChainage,
      toChainage: site.toChainage,
      outlets: site.outlets,
      sidesSeen: [...site.sides],
      proposedSide: site.side,
      screening: options.screening,
      chainage: site.chainage,
      inletSide: site.side,
      sideConfirmed: false,
      skewDegrees: 0,
      fallPercent: options.fallPercent ?? DEFAULT_BATCH_FALL_PERCENT,
      included: true,
    }))
}

export interface TrialSpacing {
  startM: number
  endM: number
  spacingM: number
}

/** What is wrong with a trial spacing on a road of `lengthM`; null when it can run. */
export function trialSpacingProblem(t: TrialSpacing, lengthM: number): string | null {
  if (![t.startM, t.endM, t.spacingM].every(Number.isFinite)) return 'Enter a start, an end and a spacing.'
  if (t.spacingM < TRIAL_SPACING_LIMITS.minM || t.spacingM > TRIAL_SPACING_LIMITS.maxM)
    return `Spacing must be between ${TRIAL_SPACING_LIMITS.minM} and ${TRIAL_SPACING_LIMITS.maxM} m.`
  if (t.startM < 0 || t.endM > lengthM + 1e-6) return 'Start and end must lie on the road.'
  if (t.endM <= t.startM) return 'The end must be past the start.'
  return null
}

/** Stations from start to end at the spacing; the last never past the end. */
export function trialSpacingStations(t: TrialSpacing): number[] {
  const out: number[] = []
  for (let k = 0; ; k++) {
    const s = t.startM + k * t.spacingM
    if (s > t.endM + 1e-6 || out.length >= MAX_ROAD_CULVERTS) break
    out.push(mm(s))
  }
  return out
}

/**
 * Drafts at a trial spacing. No candidate says where water gathers, so each inlet is proposed at
 * the barrel's uphill end, read from the ground at its two ends; where the ground is missing or
 * level there is no proposal and the draft starts on the left. Every side still needs confirming.
 */
export function draftsFromSpacing(
  t: TrialSpacing,
  options: {
    newId: () => string
    fallPercent?: number
    /** Ground at a left-inlet draft's two ends, left end first, as the engine reads it. */
    groundAtEnds: (draft: CrossDrainDraft) => [number | null, number | null]
  },
): CrossDrainDraft[] {
  return trialSpacingStations(t).map((chainage) => {
    const draft: CrossDrainDraft = {
      id: options.newId(),
      origin: 'spacing',
      proposedSide: null,
      screening: false,
      chainage,
      inletSide: 'left',
      sideConfirmed: false,
      skewDegrees: 0,
      fallPercent: options.fallPercent ?? DEFAULT_BATCH_FALL_PERCENT,
      included: true,
    }
    const [a, b] = options.groundAtEnds(draft)
    const proposed: CulvertInletSide | null =
      a === null || b === null || Math.abs(a - b) < 0.01 ? null : a > b ? 'left' : 'right'
    return { ...draft, proposedSide: proposed, inletSide: proposed ?? 'left' }
  })
}

/**
 * The culvert a draft becomes on the road as it stands. The span reaches the farther daylight on
 * both ends at the skew (the engine centres the barrel), rounded up to `BATCH_SPAN_STEP_M`; with an
 * unresolved section it is the road's width plus 4 m, at least 12 m, as a new culvert starts. The
 * inverts put the crown `minCoverM` under the centreline formation at mid-barrel and fall at the
 * draft's grade from inlet to outlet; `deepenM` lowers both (see `previewBatch`).
 */
export function draftCulvert(
  draft: CrossDrainDraft,
  analysis: RoadAnalysis,
  pipe: BatchPipeDefaults,
  name: string,
  deepenM = 0,
): Culvert {
  const station = nearestStation(analysis.stations, draft.chainage)
  const cosine = Math.cos((draft.skewDegrees * Math.PI) / 180)
  const daylight =
    station?.complete && station.leftDaylightM !== null && station.rightDaylightM !== null
      ? (2 * Math.max(station.leftDaylightM, station.rightDaylightM)) / cosine
      : null
  const lengthM = Math.min(
    500,
    daylight !== null
      ? Math.ceil(daylight / BATCH_SPAN_STEP_M - 1e-9) * BATCH_SPAN_STEP_M
      : Math.max(12, (station?.leftWidth ?? 3) + (station?.rightWidth ?? 3) + 4),
  )
  const formation = station?.designElevation ?? null
  const centre = formation === null ? null : formation - pipe.minCoverM - pipe.diameterM - deepenM
  const half = (draft.fallPercent * lengthM) / 200
  const culvert: Culvert = {
    id: draft.id,
    name,
    kind: 'cross-drain',
    chainage: mm(draft.chainage),
    skewDegrees: draft.skewDegrees,
    lengthM,
    diameterM: pipe.diameterM,
    inletInvertM: centre === null ? null : mm(centre + half),
    outletInvertM: centre === null ? null : mm(centre - half),
    minCoverM: pipe.minCoverM,
    unitCost: pipe.unitCost,
    fixedCost: pipe.fixedCost,
  }
  if (draft.inletSide === 'right') culvert.inletSide = 'right'
  return culvert
}

/** Local plan metres around `origin`, for intersection tests between barrels. */
function planar(origin: [number, number]) {
  const k = Math.cos((origin[1] * Math.PI) / 180) * 111_320
  return (p: [number, number]): [number, number] => [(p[0] - origin[0]) * k, (p[1] - origin[1]) * 110_574]
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

export interface BatchContext {
  analysis: RoadAnalysis
  /** The road's culverts as they stand. */
  existing: readonly Culvert[]
  /** Their engine results (`analysis.engineering.culverts`). */
  existingResults: readonly CulvertAnalysis[]
  /** Stations of natural-stream crossings (the drainage run's, and mapped streams the road crosses). */
  streamStations: readonly number[]
  pipe: BatchPipeDefaults
  calculate: CalculateCulverts
  /** Names the n-th new culvert (1-based, after the existing ones). */
  nameFor?: (n: number) => string
}

/**
 * Builds every draft into a culvert, runs the engine's checks on it, deepens a pipe that lacks
 * cover by exactly the shortfall (both inverts together, so the fall is kept), and lists each row's
 * issues: blocking ones (off the road, side not confirmed, a natural stream, crossing another
 * barrel, past the culvert limit) and warnings (duplicates, short span, unknown or low cover,
 * adverse fall, outlet ground above the inlet's, moved off its site, a coarse-grid screen).
 */
export function previewBatch(drafts: readonly CrossDrainDraft[], context: BatchContext): BatchRow[] {
  const { analysis, existing, pipe, calculate } = context
  const nameFor = context.nameFor ?? ((n: number) => `Cross-drain ${n}`)
  let built = drafts.map((d, i) => draftCulvert(d, analysis, pipe, nameFor(existing.length + i + 1)))
  let results = calculate(built)
  // Lowering both inverts lowers every crown along the barrel by the same amount, so one pass
  // brings the least-cover sample to the required cover.
  const deepen = results.map((r, i) =>
    r.coverM !== null && r.coverM < built[i].minCoverM - 1e-6 ? built[i].minCoverM - r.coverM : 0,
  )
  if (deepen.some((d) => d > 0)) {
    built = drafts.map((d, i) => draftCulvert(d, analysis, pipe, built[i].name, deepen[i]))
    results = calculate(built)
  }
  const origin = (analysis.stations[0]?.coordinate ?? [0, 0]) as [number, number]
  const toPlan = planar(origin)
  const barrel = (r: CulvertAnalysis) => [toPlan(r.start as [number, number]), toPlan(r.end as [number, number])]
  const existingBarrels = context.existingResults.map(barrel)
  const included = drafts.map((d) => d.included)
  const room = MAX_ROAD_CULVERTS - existing.length
  let counted = 0
  return drafts.map((draft, i) => {
    const culvert = built[i],
      result = results[i] ?? null
    const issues: BatchIssue[] = []
    const block = (code: BatchIssueCode, message: string) => issues.push({ code, blocks: true, message })
    const warn = (code: BatchIssueCode, message: string) => issues.push({ code, blocks: false, message })
    if (draft.chainage < 0 || draft.chainage > analysis.length + 1e-6) block('outside-road', 'Station is off the road.')
    if (!draft.sideConfirmed)
      block(
        'side-unconfirmed',
        draft.proposedSide === null
          ? 'No proposed flow direction: choose the inlet side.'
          : `Confirm the inlet side (proposed ${draft.proposedSide}).`,
      )
    const stream = context.streamStations.find((s) => Math.abs(s - draft.chainage) < BATCH_STREAM_CLEARANCE_M)
    if (stream !== undefined)
      block('natural-stream', 'A natural stream crosses here: place its culvert on its own, under Culvert inputs.')
    if (result) {
      const mine = barrel(result)
      const hitsExisting = existingBarrels.some((b) => segmentsCross(mine[0], mine[1], b[0], b[1]))
      const hitsDraft = drafts.some((_, j) => {
        if (j === i || !included[j] || !results[j]) return false
        const [c, d] = barrel(results[j])
        return segmentsCross(mine[0], mine[1], c, d)
      })
      if (hitsExisting || hitsDraft)
        block('intersects', `Barrel crosses ${hitsExisting ? 'an existing culvert' : 'another draft'}.`)
    }
    if (draft.included && !issues.some((x) => x.blocks)) {
      counted++
      if (counted > room) block('over-limit', `A road holds at most ${MAX_ROAD_CULVERTS} culverts.`)
    }
    const nearExisting = existing.find((c) => Math.abs(c.chainage - draft.chainage) < BATCH_DUPLICATE_M)
    const nearDraft = drafts.find(
      (other, j) => j !== i && included[j] && Math.abs(other.chainage - draft.chainage) < BATCH_DUPLICATE_M,
    )
    if (nearExisting) warn('duplicate', `${nearExisting.name} is within ${BATCH_DUPLICATE_M} m.`)
    else if (nearDraft) warn('duplicate', `Another draft is within ${BATCH_DUPLICATE_M} m.`)
    if (result) {
      if (result.requiredLengthM !== null && culvert.lengthM + 1e-6 < result.requiredLengthM)
        warn('short-span', `Span is shorter than the daylight span (${result.requiredLengthM.toFixed(1)} m).`)
      if (result.coverM === null)
        warn('unknown-cover', 'Cover is unknown: the formation or terrain is unresolved here.')
      else if (result.coverM < culvert.minCoverM - 1e-6)
        warn('low-cover', `Cover ${result.coverM.toFixed(2)} m is below ${culvert.minCoverM.toFixed(2)} m.`)
      const ground = [result.profile[0]?.groundElevation ?? null, result.profile.at(-1)?.groundElevation ?? null]
      if (ground[0] !== null && ground[1] !== null && ground[1] > ground[0] + 0.01)
        warn(
          'outlet-uphill',
          `Ground at the outlet (${otherSide(culvertInletSide(culvert))}) end stands ${(ground[1] - ground[0]).toFixed(2)} m above the inlet's: check the flow direction.`,
        )
    }
    if (!(draft.fallPercent > 0)) warn('adverse-fall', 'The outlet is not below the inlet.')
    if (
      draft.origin === 'candidate' &&
      draft.fromChainage !== undefined &&
      draft.toChainage !== undefined &&
      (draft.chainage < draft.fromChainage - CROSS_DRAIN_SITE_M ||
        draft.chainage > draft.toChainage + CROSS_DRAIN_SITE_M)
    )
      warn('off-site', `Moved more than ${CROSS_DRAIN_SITE_M} m outside its site's stretch.`)
    if (draft.screening) warn('screening', 'From a coarse-grid run: a screen, not a reviewed site.')
    return {
      draft,
      culvert,
      result,
      issues,
      ready: draft.included && !issues.some((x) => x.blocks),
    }
  })
}

/** The culverts a batch adds: its ready rows, in station order. */
export function acceptedCulverts(rows: readonly BatchRow[]): Culvert[] {
  return rows
    .filter((row) => row.ready)
    .map((row) => row.culvert)
    .sort((a, b) => a.chainage - b.chainage)
}

/**
 * Every proposed inlet side confirmed as it stands. A draft with no proposal (level or missing
 * ground at a spacing draft's ends) keeps waiting for the designer to choose.
 */
export function confirmSides(drafts: readonly CrossDrainDraft[]): CrossDrainDraft[] {
  return drafts.map((d) => (d.sideConfirmed || d.proposedSide === null ? d : { ...d, sideConfirmed: true }))
}

/** One draft changed by the designer. Choosing a side confirms it. */
export function editDraft(
  draft: CrossDrainDraft,
  patch: Partial<Pick<CrossDrainDraft, 'chainage' | 'inletSide' | 'skewDegrees' | 'fallPercent' | 'included'>>,
): CrossDrainDraft {
  const next = { ...draft, ...patch }
  if (patch.inletSide !== undefined) next.sideConfirmed = true
  if (patch.skewDegrees !== undefined) next.skewDegrees = Math.max(-80, Math.min(80, patch.skewDegrees))
  return next
}

/**
 * What a preview was built on: the road with its culverts left out (they are checked live), and
 * for candidate drafts the drainage run's inputs. Adding the batch is refused while it differs
 * from the road as it now stands, until the designer refreshes the preview.
 */
export function batchBasis(
  alignment: Alignment,
  roadSettings: RoadSettings,
  drainageFingerprint: string | null,
): string {
  const engineering = alignment.engineering ? { ...alignment.engineering, culverts: [] } : undefined
  return `${drainageRoadFingerprint({ alignment: { ...alignment, engineering }, roadSettings })}|${drainageFingerprint ?? ''}`
}

/** A one-line name for the undo history. */
export function batchStepLabel(count: number): string {
  return `Add ${count} cross-drain${count === 1 ? '' : 's'}`
}
