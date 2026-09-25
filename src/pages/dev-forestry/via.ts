/**
 * The *Visual Impact Assessment Handbook* (BC Ministry of Forests, 2022)
 * procedure, as far as a desk run can carry it.
 *
 * A VIA is five steps (handbook Figure 2): identify the VQO and potential
 * viewpoints (3.1), visit them and photograph (3.2), develop design options and
 * simulate them (3.3), assess the simulation against the VQO (3.4), and settle
 * a final rating (3.5). This module holds the handbook's tables for step 4 and
 * 5 and the bookkeeping that says which step a scene has reached. It knows
 * nothing about the DOM or the network, so every rule here is unit-tested.
 *
 * The handbook assesses each view two independent ways and ranks them:
 * - **Ocular** (3.4.1): the reviewer describes how the alteration looks — ease
 *   of seeing, scale, shape — against the FPPR s.1.1 definitions (Table 1).
 *   This is the primary measure. A model cannot make it, so it is always an
 *   input here, never a computed value.
 * - **Numerical** (3.4.2–3.4.3): percent alteration in perspective view (the
 *   run's figure), adjusted for design, roads and retention by
 *   `X * (1 + 0.14 * Y)`, then read against Table 2.
 *
 * Table 7 combines the two into the final rating, with the ocular class
 * deciding where they disagree.
 */

import type { FormReview } from './pdf/fs1252'
import type { AlterationBreakdown, AnalysisResult, TargetPolygon } from './types'
import { designDistanceScore, visibleProposalCentre } from './vqe'
import { haversineMeters } from './visibility'
import {
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  partialCutEquivalentPercent,
  classifyAlteration,
  rangeFloorFor,
  thresholdFor,
  visualQualityClass,
  VISUAL_QUALITY_CLASSES,
  type VisualQualityClass,
  type VisualQualityClassId,
} from './vqo'

// ---------------------------------------------------------------------------
// The five steps

export type ViaStepId = 'identify' | 'visit' | 'design' | 'assess' | 'rate'

export type ViaStep = {
  id: ViaStepId
  number: 1 | 2 | 3 | 4 | 5
  /** Handbook section the step follows. */
  section: string
  title: string
  /** What the step is for, in the handbook's terms. */
  purpose: string
}

export const VIA_STEPS: readonly ViaStep[] = [
  {
    id: 'identify',
    number: 1,
    section: '3.1',
    title: 'Identify the VQO and viewpoints',
    purpose: 'Locate the proposal, find the established objective, and pick the public viewpoints it may be seen from.',
  },
  {
    id: 'visit',
    number: 2,
    section: '3.2',
    title: 'Visit the viewpoints',
    purpose: 'Travel the road the way a visitor would, confirm the best views, and record each one.',
  },
  {
    id: 'design',
    number: 3,
    section: '3.3',
    title: 'Design and simulate',
    purpose: 'Delineate the landform, review the design against its terrain, and simulate what the road sees.',
  },
  {
    id: 'assess',
    number: 4,
    section: '3.4',
    title: 'Assess against the VQO',
    purpose: 'Judge the simulation by eye against the FPPR definitions, then measure and adjust percent alteration.',
  },
  {
    id: 'rate',
    number: 5,
    section: '3.5',
    title: 'Final rating and package',
    purpose: 'Combine the two measures into the Table 7 rating, write the rationale, and export the package.',
  },
] as const

export type ViaStepStatus = 'done' | 'current' | 'todo'

export type ViaProgressInput = {
  hasViewpoint: boolean
  blockCount: number
  hasLandform: boolean
  /** A current (not stale) run exists. */
  hasResult: boolean
  /** The road has been viewed from eye level, or a view saved, for this run. */
  visited: boolean
  numericalReady: boolean
  assessment: ViaAssessment | null
}

/**
 * Where each step stands. A step is done when the handbook's output for it
 * exists; the first one that is not is current. Later steps can be done out of
 * order (a run can exist before the road has been driven), which is why each
 * is judged on its own rather than by position.
 */
export function viaStepStatuses(input: ViaProgressInput): Record<ViaStepId, ViaStepStatus> {
  const done: Record<ViaStepId, boolean> = {
    identify: input.hasViewpoint && input.blockCount > 0 && input.hasLandform,
    visit: input.hasResult && input.visited,
    design: input.hasResult && input.numericalReady,
    assess: !!input.assessment?.ocular && !!input.assessment.adjusted,
    rate: !!input.assessment?.rating && !!input.assessment.rationaleWritten,
  }
  const current = VIA_STEPS.find((step) => !done[step.id])?.id ?? null
  return Object.fromEntries(
    VIA_STEPS.map((step) => [step.id, done[step.id] ? 'done' : step.id === current ? 'current' : 'todo']),
  ) as Record<ViaStepId, ViaStepStatus>
}

// ---------------------------------------------------------------------------
// 3.2.1 Viewpoint type

export type ViewpointTypeId = 1 | 2 | 3 | 4 | 5

/** Handbook 3.2.1, roughly ordered by viewing duration and angle. */
export const VIEWPOINT_TYPES: ReadonlyArray<{ id: ViewpointTypeId; label: string }> = [
  { id: 1, label: 'Glimpse view, less than 10 seconds' },
  { id: 2, label: 'Sustained side view' },
  { id: 3, label: 'Sustained focal view, or travelling toward the alteration for more than one minute' },
  { id: 4, label: 'Rest stop, campsite, or other static short-term view' },
  { id: 5, label: 'Community, tourism enterprise, or other static long-term view' },
]

// ---------------------------------------------------------------------------
// 3.4.1 Ocular assessment (Table 1)

export type Visibleness = 'not-easily-distinguishable' | 'difficult' | 'easy' | 'very-easy'
export type ScaleTerm = 'very-small' | 'small' | 'medium' | 'large' | 'very-large'
export type ShapeTerm = 'natural' | 'angular' | 'rectilinear' | 'geometric'

/** The phrases the summary form asks the reviewer to circle, with the glossary's meaning. */
export const VISIBLENESS_TERMS: ReadonlyArray<{ id: Visibleness; label: string; meaning: string }> = [
  { id: 'not-easily-distinguishable', label: 'Not easily distinguishable', meaning: 'Not visually apparent.' },
  {
    id: 'difficult',
    label: 'Difficult to see',
    meaning: 'Takes effort to discern. Peripheral, obscured, or very distant.',
  },
  { id: 'easy', label: 'Easy to see', meaning: 'Seen without great effort. Directly in sight or unobscured.' },
  { id: 'very-easy', label: 'Very easy to see', meaning: 'Immediately identifiable. A visually dominant feature.' },
]

export const SCALE_TERMS: ReadonlyArray<{ id: ScaleTerm; label: string }> = [
  { id: 'very-small', label: 'Very small' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'very-large', label: 'Very large' },
]

export const SHAPE_TERMS: ReadonlyArray<{ id: ShapeTerm; label: string; meaning: string }> = [
  {
    id: 'natural',
    label: 'Natural in appearance',
    meaning: 'Irregular organic shapes, curvilinear lines, diffuse pattern.',
  },
  { id: 'angular', label: 'Angular', meaning: 'Angles or sharp corners, such as right-angle corners.' },
  { id: 'rectilinear', label: 'Rectilinear', meaning: 'Straight boundary lines and roads.' },
  { id: 'geometric', label: 'Geometric', meaning: 'Regular shapes: squares, rectangles, triangles, circles.' },
]

export type OcularInput = {
  visibleness?: Visibleness | null
  scale?: ScaleTerm | null
  shape?: ShapeTerm | null
  /**
   * The reviewer places the alteration on the boundary between the objective
   * and the next more-altered class. Table 7 rates that Inconclusive.
   */
  onBoundary?: boolean
}

const CLASS_ORDER: readonly VisualQualityClassId[] = VISUAL_QUALITY_CLASSES.map((entry) => entry.id)

function rank(id: VisualQualityClassId): number {
  return CLASS_ORDER.indexOf(id)
}

/**
 * The least-altered class each phrase is compatible with, read off Table 1.
 * "Very easy to see" appears only in modification and maximum modification;
 * "angular" only in modification (ii)(B); "rectilinear" and "geometric" only in
 * maximum modification (ii)(B).
 */
const VISIBLENESS_CLASS: Record<Visibleness, VisualQualityClassId> = {
  'not-easily-distinguishable': 'preservation',
  difficult: 'retention',
  easy: 'partial-retention',
  'very-easy': 'modification',
}
const SCALE_CLASS: Record<ScaleTerm, VisualQualityClassId> = {
  'very-small': 'preservation',
  small: 'retention',
  medium: 'partial-retention',
  large: 'modification',
  'very-large': 'maximum-modification',
}
const SHAPE_CLASS: Record<ShapeTerm, VisualQualityClassId> = {
  natural: 'preservation',
  angular: 'modification',
  rectilinear: 'maximum-modification',
  geometric: 'maximum-modification',
}

export type OcularResult = {
  classId: VisualQualityClassId
  /** The three criteria point at different classes (handbook 3.4.1's "do not line up exactly"). */
  mixed: boolean
  /** When mixed, the class the other criteria lean toward — the boundary to consider. */
  leansTowardId: VisualQualityClassId | null
  onBoundary: boolean
}

/**
 * The visual quality class a described alteration achieves.
 *
 * Each FPPR definition is a conjunction, so an alteration achieves a class
 * only if every criterion fits it; the class circled is therefore the most
 * altered one any criterion calls for. That is the handbook's own worked case:
 * easy to see and medium in scale fit partial retention, but angular
 * characteristics place it in modification — "circle M, but perhaps closer to
 * the boundary with PR". Returns null until all three criteria are described.
 */
export function ocularClass(input: OcularInput | null | undefined): OcularResult | null {
  if (!input?.visibleness || !input.scale || !input.shape) return null
  const ranks = [VISIBLENESS_CLASS[input.visibleness], SCALE_CLASS[input.scale], SHAPE_CLASS[input.shape]].map(rank)
  const worst = Math.max(...ranks)
  // Natural shape is compatible with every class, so it does not pull the
  // result either way and is left out of the "do they agree" question.
  const telling = input.shape === 'natural' ? ranks.slice(0, 2) : ranks
  const mixed = new Set(telling).size > 1
  const next = telling.filter((value) => value < worst)
  return {
    classId: CLASS_ORDER[worst],
    mixed,
    leansTowardId: mixed && next.length ? CLASS_ORDER[Math.max(...next)] : null,
    onBoundary: input.onBoundary === true,
  }
}

// ---------------------------------------------------------------------------
// 3.4.2 Numerical assessment (Table 2)

/**
 * Table 2's scale term for a percent alteration, alongside the class. The
 * handbook's ranges are fixed (P 0, R 0–1.5, PR 1.6–7, M 7.1–18, MM 18.1–30);
 * the tool's editable planning thresholds are a separate concern and do not
 * move them. Upper bounds are inclusive, so 1.55% reads as partial retention.
 */
export function table2Class(percent: number): VisualQualityClass | null {
  return classifyAlteration(percent, 'perspective', DEFAULT_VISUAL_QUALITY_THRESHOLDS)
}

/** Table 2's "most probable % landform alteration" column, as printed. */
const TABLE2_PRINTED: Record<VisualQualityClassId, string> = {
  preservation: '0%',
  retention: '0–1.5%',
  'partial-retention': '1.6–7%',
  modification: '7.1–18%',
  'maximum-modification': '18.1–30%',
}

/**
 * The Table 2 range of a class. `floor` is where the class below stops (1.5 for
 * partial retention, which the handbook prints as 1.6 to one decimal place),
 * so the ranges meet with no gap; `label` is the range as printed.
 */
export function table2Range(id: VisualQualityClassId): { floor: number; max: number; label: string } {
  return {
    floor: rangeFloorFor(id, 'perspective', DEFAULT_VISUAL_QUALITY_THRESHOLDS),
    max: thresholdFor(id, 'perspective', DEFAULT_VISUAL_QUALITY_THRESHOLDS),
    label: TABLE2_PRINTED[id],
  }
}

/**
 * What an older opening that has partly greened up still adds (3.4.2): its
 * share of the landform times the share not yet recovered. The handbook's
 * example: 15% of the landform, 70% greened up, contributes 4.5%.
 */
export function existingOpeningContribution(openingPercent: number, greenedUpPercent: number): number {
  const recovered = Math.max(0, Math.min(100, greenedUpPercent)) / 100
  return Math.max(0, openingPercent) * (1 - recovered)
}

/**
 * X on the summary form: (a) proposed openings, (b) roads and site
 * disturbance outside them, and (c) the non-greened-up share of existing
 * openings. The run already reports those three in perspective view.
 */
export function initialAlterationPercent(breakdown: AlterationBreakdown | null): number | null {
  if (!breakdown) return null
  const total = breakdown.proposedPercent + breakdown.disturbancePercent + breakdown.existingPercent
  return Number.isFinite(total) ? total : null
}

// ---------------------------------------------------------------------------
// 3.4.3 Adjustments (Tables 3, 4 and 5)

export type DesignElementId =
  | 'force-lines'
  | 'natural-character'
  | 'edge-treatment'
  | 'distance'
  | 'position'
  | 'number-size-spacing'

export type DesignRating = -1 | 0 | 1

export type DesignElement = {
  id: DesignElementId
  label: string
  question: string
  good: string
  moderate: string
  poor: string
}

/**
 * Table 3. The handbook's prose says "the sum of the five components", a
 * leftover from the five-element FS1252 form; its table lists six, adding
 * number, size and spacing, and so does this.
 */
export const DESIGN_ELEMENTS: readonly DesignElement[] = [
  {
    id: 'force-lines',
    label: 'Response to visual force lines',
    question: 'Do boundaries push up in hollows and drop down on ridges?',
    good: 'Strong',
    moderate: 'Force lines not apparent',
    poor: 'Weak or no response',
  },
  {
    id: 'natural-character',
    label: 'Borrows from natural character',
    question: 'Does the shape echo the shapes and openings already in this landscape?',
    good: 'Fully',
    moderate: 'Partially',
    poor: 'Isolated or not at all',
  },
  {
    id: 'edge-treatment',
    label: 'Incorporates edge treatments',
    question: 'Feathered edges, and irregular or interlocking boundaries?',
    good: 'Feathering and irregular boundaries',
    moderate: 'One of the two',
    poor: 'Neither',
  },
  {
    id: 'distance',
    label: 'Distance from the viewpoint',
    question: 'How far is the alteration from the viewpoint?',
    good: 'Over 8 km',
    moderate: '1 to 8 km',
    poor: 'Under 1 km',
  },
  {
    id: 'position',
    label: 'Position on the landform',
    question: 'Where does the opening sit on the landform?',
    good: 'Lower down and to one side',
    moderate: 'Small and near the centre',
    poor: 'High, or large near the centre',
  },
  {
    id: 'number-size-spacing',
    label: 'Number, size and spacing',
    question: 'Counting existing openings not yet greened up, how do they sit together?',
    good: 'Three or more, varied size and spacing',
    moderate: 'One or two, or limited variety',
    poor: 'Three or more, similar size and spacing',
  },
]

export type RoadsVisibility = 0 | 1 | 2 | 3

/** Table 4. */
export const ROADS_VISIBILITY: ReadonlyArray<{ value: RoadsVisibility; label: string }> = [
  { value: 0, label: 'No roads or sidecast visible' },
  { value: 1, label: 'Visible, but subordinate in the scene' },
  { value: 2, label: 'Significantly visible, but small in scale' },
  { value: 3, label: 'Roads or sidecast dominate the scene' },
]

export type RetentionLevel = 'low' | 'moderate' | 'high'

/** Table 5. */
export const RETENTION_LEVELS: ReadonlyArray<{ id: RetentionLevel; label: string; factor: 0 | -1 | -2 }> = [
  { id: 'low', label: 'Under 15% retention (low)', factor: 0 },
  { id: 'moderate', label: '15–22% retention (moderate)', factor: -1 },
  { id: 'high', label: 'Over 22% retention (high)', factor: -2 },
]

/** Table 5 from a measured retention percentage. */
export function retentionLevelFor(percent: number): RetentionLevel | null {
  if (!Number.isFinite(percent) || percent < 0) return null
  if (percent < 15) return 'low'
  if (percent <= 22) return 'moderate'
  return 'high'
}

/** A proposed block's cutting system, as the scene records it. */
export type BlockHarvest = Pick<
  TargetPolygon,
  'id' | 'name' | 'harvestSystem' | 'retentionPercent' | 'volumeRemovedPercent' | 'residualHeightMeters'
>

/**
 * Table 5 from the blocks themselves: the share of the proposed stand left
 * standing, weighted by block area. Clearcut blocks count as 0% retained;
 * partial cuts are left out, since Table 6 already accounts for what they
 * leave. Null unless at least one block records dispersed retention.
 */
export function measuredRetention(
  blocks: ReadonlyArray<BlockHarvest>,
  areaOf: (id: string) => number | null,
): { percent: number; level: RetentionLevel } | null {
  let area = 0
  let kept = 0
  let recorded = false
  for (const block of blocks) {
    if (block.harvestSystem === 'partial') continue
    const blockArea = areaOf(block.id)
    if (!blockArea || !(blockArea > 0)) continue
    const retained = block.harvestSystem === 'retention' ? (block.retentionPercent ?? null) : 0
    if (retained === null) return null
    if (block.harvestSystem === 'retention') recorded = true
    area += blockArea
    kept += blockArea * retained
  }
  if (!recorded || !(area > 0)) return null
  const percent = kept / area
  const level = retentionLevelFor(percent)
  return level ? { percent, level } : null
}

/**
 * 3.4.4: a partial cut is not measured as cleared ground. Table 6 reads its
 * volume removed against the mean height of the trees left to give a
 * clearcut-equivalent percent alteration, which "the simplest procedure" adds
 * to the clearcut figure before the adjustments. Only a partial cut the run
 * sees from the viewpoint is added; one it cannot see alters nothing here.
 */
export type PartialCutEntry = {
  id: string
  name: string
  visible: boolean
  /** Table 6's figure, or null until volume removed and residual height are both entered. */
  equivalentPercent: number | null
}

export function partialCutEntries(blocks: ReadonlyArray<BlockHarvest>, result: AnalysisResult | null): PartialCutEntry[] {
  return blocks
    .filter((block) => block.harvestSystem === 'partial')
    .map((block) => {
      const target = result?.targets.find((entry) => entry.targetId === block.id)
      const equivalent =
        block.volumeRemovedPercent != null && block.residualHeightMeters != null
          ? partialCutEquivalentPercent(block.volumeRemovedPercent, block.residualHeightMeters)
          : null
      return {
        id: block.id,
        name: block.name,
        visible: !!target && target.visibleAreaMeters > 0,
        // Under 10% removed the table does not start: it reads as no alteration.
        equivalentPercent:
          equivalent ?? (block.volumeRemovedPercent != null && block.volumeRemovedPercent < 10 && block.residualHeightMeters != null ? 0 : null),
      }
    })
}

/**
 * The adjusted percent alteration, `X * (1 + 0.14 * Y)` (3.4.3). With six
 * design elements Y runs from −8 to +9, and below Y ≈ −7.1 the factor turns
 * negative; an alteration cannot be less than none, so the result is held at 0.
 */
export function adjustedPercent(initialPercent: number, y: number): number {
  return Math.max(0, initialPercent * (1 + 0.14 * y))
}

// ---------------------------------------------------------------------------
// 3.5.1 Final rating (Table 7)

export type ViaRatingId = 'well-met' | 'met' | 'inconclusive' | 'not-met' | 'clearly-not-met'

export const VIA_RATINGS: Record<
  ViaRatingId,
  { label: string; meaning: string; tone: 'success' | 'warning' | 'danger' }
> = {
  'well-met': {
    label: 'Well met',
    meaning: 'Definition achieved and % alteration well within the VQO range.',
    tone: 'success',
  },
  met: {
    label: 'Met',
    meaning: 'Definition achieved; % alteration near the boundary or somewhat over the VQO range.',
    tone: 'success',
  },
  inconclusive: {
    label: 'Inconclusive',
    meaning: 'Definition on the class boundary; % alteration may be over the VQO range.',
    tone: 'warning',
  },
  'not-met': {
    label: 'Not met',
    meaning: 'Definition not achieved; % alteration near the boundary or within range.',
    tone: 'danger',
  },
  'clearly-not-met': {
    label: 'Clearly not met',
    meaning: 'Definition not achieved and % alteration over the VQO range.',
    tone: 'danger',
  },
}

/**
 * How far into its range a percentage can go and still be "well within" it.
 * Table 7 does not put a number on "well within" or "near boundary"; this tool
 * calls the top fifth of the objective's Table 2 range "near the boundary",
 * and says so wherever the rating is shown.
 */
export const WELL_WITHIN_SHARE = 0.8

export type PercentStanding = 'well-within' | 'near-boundary' | 'over'

export function percentStanding(percent: number, objectiveId: VisualQualityClassId): PercentStanding {
  const { floor, max } = table2Range(objectiveId)
  if (percent > max) return 'over'
  return percent <= floor + WELL_WITHIN_SHARE * (max - floor) ? 'well-within' : 'near-boundary'
}

export type ViaRating = {
  id: ViaRatingId
  label: string
  meaning: string
  tone: 'success' | 'warning' | 'danger'
  definitionAchieved: boolean
  standing: PercentStanding
  /** The two measures point different ways; 3.5.1 lets the ocular class decide. */
  measuresDisagree: boolean
}

export function finalRating(input: {
  objectiveId: VisualQualityClassId
  ocular: OcularResult
  adjustedPercent: number
}): ViaRating {
  const standing = percentStanding(input.adjustedPercent, input.objectiveId)
  const definitionAchieved = !input.ocular.onBoundary && rank(input.ocular.classId) <= rank(input.objectiveId)
  const id: ViaRatingId = input.ocular.onBoundary
    ? 'inconclusive'
    : definitionAchieved
      ? standing === 'well-within'
        ? 'well-met'
        : 'met'
      : standing === 'over'
        ? 'clearly-not-met'
        : 'not-met'
  const measuresDisagree = input.ocular.onBoundary ? false : definitionAchieved === (standing === 'over')
  return { id, ...VIA_RATINGS[id], definitionAchieved, standing, measuresDisagree }
}

// ---------------------------------------------------------------------------
// The reviewer's record, and the whole assessment

export type ViaReview = {
  ocular?: OcularInput
  design?: Partial<Record<DesignElementId, DesignRating | null>>
  roads?: RoadsVisibility | null
  retention?: RetentionLevel | null
  /** Aggregated retention was already netted out of the geometry (3.4.3.3), so it is not counted twice. */
  retentionNetted?: boolean
  viewpointType?: ViewpointTypeId | null
  /** 3.5.2 — landscape character, constraints, design strategies. */
  rationale?: string
}

export type DesignSuggestion = { rating: DesignRating; basis: string }

/**
 * The design elements a run can measure rather than judge. Distance is a
 * measurement in Table 3, taken to the centre of the visible proposal from the
 * assessment station. Number, size and spacing is a judgement except in the
 * one-or-two-openings case, which Table 3 rates Moderate outright.
 */
/** Distance from the assessment station to the centre of what is visible of the proposal. */
export function alterationDistanceMeters(result: AnalysisResult | null): number | null {
  if (!result) return null
  const station = result.stations[result.assessmentStationIndex]
  const centre = visibleProposalCentre(result)
  return station && centre ? haversineMeters(station, centre) : null
}

/**
 * Handbook 3.0: the criteria "have not been calibrated to assess foreground
 * views of alterations generally less than 1 km from the viewpoint", and such
 * views need additional interpretation — advice from the district office.
 */
export const FOREGROUND_LIMIT_METERS = 1000

export function measuredDesignRatings(
  result: AnalysisResult | null,
): Partial<Record<DesignElementId, DesignSuggestion>> {
  if (!result) return {}
  const out: Partial<Record<DesignElementId, DesignSuggestion>> = {}
  const distance = alterationDistanceMeters(result)
  if (distance !== null) {
    const score = designDistanceScore(distance)
    if (score)
      out.distance = {
        rating: score.score,
        basis: `${(distance / 1000).toFixed(1)} km to the visible proposal (${score.band})`,
      }
  }
  const openings = result.targets.filter(
    (target) => (target.role === 'block' || target.role === 'harvested') && target.visibleAreaMeters > 0,
  ).length
  if (openings > 0 && openings <= 2) {
    out['number-size-spacing'] = { rating: 0, basis: `${openings} visible opening${openings === 1 ? '' : 's'}` }
  }
  return out
}

export type ViaAssessment = {
  objective: VisualQualityClass
  /** X, or null until a run with a delineated landform gives one. Includes visible partial cuts' Table 6 figures. */
  initialPercent: number | null
  /** X's part measured as cleared ground, before any partial cut is added. */
  clearedPercent: number | null
  partialCuts: PartialCutEntry[]
  /** Table 5 read from the blocks' recorded retention, used when the reviewer has not chosen a level. */
  retentionMeasured: { percent: number; level: RetentionLevel } | null
  initialClass: VisualQualityClass | null
  /** The run flagged its numerical figures as provisional. */
  numericalProvisional: boolean
  ocular: OcularResult | null
  /** Each element's rating as used: the reviewer's, else a measured one. */
  design: Record<DesignElementId, { rating: DesignRating | null; measured: DesignSuggestion | null }>
  designTotal: number | null
  roads: RoadsVisibility | null
  retentionFactor: 0 | -1 | -2 | null
  /** Y, once every factor is in. */
  y: number | null
  adjusted: { percent: number; classId: VisualQualityClassId | null } | null
  rating: ViaRating | null
  rationaleWritten: boolean
  /** The visible proposal sits under 1 km away, where the handbook's criteria are not calibrated. */
  foreground: boolean
  /** The reviewer has recorded something in step 4, whether or not a run exists to rate it against. */
  reviewStarted: boolean
  /** What is still needed before a final rating, in handbook order. */
  missing: string[]
}

export function assessVia(input: {
  objectiveId: VisualQualityClassId
  result: AnalysisResult | null
  review: ViaReview | null | undefined
  /** The proposed blocks' cutting systems; absent means every block is a clearcut. */
  blocks?: ReadonlyArray<BlockHarvest>
}): ViaAssessment {
  const review = input.review ?? {}
  const objective = visualQualityClass(input.objectiveId)
  const numericalReady = !!input.result?.quality?.numericalReady
  const clearedPercent = numericalReady ? initialAlterationPercent(input.result?.perspectiveAlteration ?? null) : null
  const blocks = input.blocks ?? []
  const partialCuts = partialCutEntries(blocks, input.result)
  const partialsMissing = partialCuts.some((cut) => cut.visible && cut.equivalentPercent === null)
  const initialPercent =
    clearedPercent !== null && !partialsMissing
      ? clearedPercent + partialCuts.reduce((sum, cut) => sum + (cut.visible ? (cut.equivalentPercent ?? 0) : 0), 0)
      : null
  const retentionMeasured = measuredRetention(blocks, (id) => input.result?.targets.find((t) => t.targetId === id)?.areaMeters ?? null)
  const ocular = ocularClass(review.ocular)

  const measured = measuredDesignRatings(input.result)
  const design = Object.fromEntries(
    DESIGN_ELEMENTS.map((element) => {
      const own = review.design?.[element.id]
      const suggestion = measured[element.id] ?? null
      return [element.id, { rating: own ?? suggestion?.rating ?? null, measured: suggestion }]
    }),
  ) as ViaAssessment['design']
  const ratings = DESIGN_ELEMENTS.map((element) => design[element.id].rating)
  const designTotal = ratings.every((value) => value !== null)
    ? ratings.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
  const roads = review.roads ?? null
  const retentionLevel = review.retention ?? retentionMeasured?.level ?? null
  const retentionFactor =
    review.retentionNetted === true
      ? 0
      : retentionLevel
        ? (RETENTION_LEVELS.find((level) => level.id === retentionLevel)?.factor ?? null)
        : null
  const y =
    designTotal !== null && roads !== null && retentionFactor !== null ? designTotal + roads + retentionFactor : null
  const adjustedValue = initialPercent !== null && y !== null ? adjustedPercent(initialPercent, y) : null
  const adjusted =
    adjustedValue !== null ? { percent: adjustedValue, classId: table2Class(adjustedValue)?.id ?? null } : null
  const rating =
    ocular && adjusted
      ? finalRating({ objectiveId: input.objectiveId, ocular, adjustedPercent: adjusted.percent })
      : null

  const missing: string[] = []
  if (!input.result) missing.push('Run the simulation')
  else if (!numericalReady) missing.push('Resolve the run’s provisional warnings')
  if (partialsMissing) missing.push('Enter each visible partial cut’s volume removed and residual height')
  if (!ocular) missing.push('Describe the alteration by eye')
  if (designTotal === null) missing.push('Rate every design element')
  if (roads === null) missing.push('Rate road visibility')
  if (retentionFactor === null) missing.push('Rate tree retention')
  const rationaleWritten = !!review.rationale?.trim()
  const distance = alterationDistanceMeters(input.result)
  if (rating && !rationaleWritten) missing.push('Write the rationale')

  return {
    objective,
    initialPercent,
    clearedPercent,
    partialCuts,
    retentionMeasured,
    initialClass: initialPercent !== null ? table2Class(initialPercent) : null,
    numericalProvisional: !!input.result && !numericalReady,
    ocular,
    design,
    designTotal,
    roads,
    retentionFactor,
    y,
    adjusted,
    rating,
    rationaleWritten,
    foreground: distance !== null && distance < FOREGROUND_LIMIT_METERS,
    reviewStarted:
      !!(review.ocular?.visibleness || review.ocular?.scale || review.ocular?.shape) ||
      Object.values(review.design ?? {}).some((value) => value !== null && value !== undefined) ||
      review.roads != null ||
      !!review.retention,
    missing,
  }
}

// ---------------------------------------------------------------------------
// Scene storage and the FS1252 hand-off

const VISIBLENESS_IDS = new Set(VISIBLENESS_TERMS.map((term) => term.id))
const SCALE_IDS = new Set(SCALE_TERMS.map((term) => term.id))
const SHAPE_IDS = new Set(SHAPE_TERMS.map((term) => term.id))
const RETENTION_IDS = new Set(RETENTION_LEVELS.map((level) => level.id))

function member<T extends string>(set: Set<T>, value: unknown): T | null {
  return typeof value === 'string' && set.has(value as T) ? (value as T) : null
}

/** A review read back from storage or an imported scene; anything unrecognised is dropped. */
export function parseViaReview(raw: unknown): ViaReview | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const ocularRaw = (value.ocular && typeof value.ocular === 'object' ? value.ocular : {}) as Record<string, unknown>
  const designRaw = (value.design && typeof value.design === 'object' ? value.design : {}) as Record<string, unknown>
  const design: ViaReview['design'] = {}
  for (const element of DESIGN_ELEMENTS) {
    const rating = designRaw[element.id]
    if (rating === -1 || rating === 0 || rating === 1) design[element.id] = rating
  }
  const roads = value.roads
  const viewpointType = value.viewpointType
  return {
    ocular: {
      visibleness: member(VISIBLENESS_IDS, ocularRaw.visibleness),
      scale: member(SCALE_IDS, ocularRaw.scale),
      shape: member(SHAPE_IDS, ocularRaw.shape),
      onBoundary: ocularRaw.onBoundary === true,
    },
    design,
    roads: roads === 0 || roads === 1 || roads === 2 || roads === 3 ? roads : null,
    retention: member(RETENTION_IDS, value.retention),
    retentionNetted: value.retentionNetted === true,
    viewpointType:
      typeof viewpointType === 'number' && [1, 2, 3, 4, 5].includes(viewpointType)
        ? (viewpointType as ViewpointTypeId)
        : null,
    rationale: typeof value.rationale === 'string' ? value.rationale.slice(0, 4000) : '',
  }
}

/**
 * The FS1252 (2008) form has five design rows — it predates number, size and
 * spacing — so that element stays on the VIA record and out of the PDF's rows.
 */
export function fs1252ReviewFromVia(assessment: ViaAssessment, review: ViaReview | null | undefined): FormReview {
  const order: DesignElementId[] = ['force-lines', 'natural-character', 'edge-treatment', 'distance', 'position']
  const retention = review?.retention
    ? (RETENTION_LEVELS.find((level) => level.id === review.retention)?.factor ?? null)
    : null
  return {
    design: order.map((id) => assessment.design[id].rating),
    roads: assessment.roads,
    // FS1252 needs a Table 5 row even when netting makes it irrelevant.
    retention: review?.retentionNetted ? (retention ?? 0) : retention,
    retentionAlreadyNetted: review?.retentionNetted === true,
    notes: review?.rationale?.trim() || undefined,
  }
}
