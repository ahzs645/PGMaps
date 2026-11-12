/**
 * The revision loop: what the last design change did to the objective verdict.
 * The page keeps the previous run's headline figures — the landform's
 * cumulative percent on each scale and the class it read as — and sets them
 * beside this run's, so a boundary edit or an applied alternative shows its
 * effect without another run. Nothing here computes a new figure: every
 * percent is the one a run reported, read against its own scale's range the
 * way the Results panel reads it. No DOM or network access.
 */
import { canonicalInput, resolvedThresholds } from './integrity'
import { formatPct } from './measureFormat'
import type { AnalysisResult, TargetPolygon } from './types'
import {
  assessObjective,
  rangeFloorFor,
  thresholdFor,
  visualQualityClass,
  type AlterationBasis,
  type VisualQualityClassId,
  type VisualQualityThresholds,
} from './vqo'

export type HeadlineScale = {
  basis: AlterationBasis
  /** The run's own cumulative percent on this scale; null while the run is provisional. */
  percent: number | null
  /** The class that percent reads as on this scale; null beyond maximum modification, or withheld. */
  classId: VisualQualityClassId | null
  /** Whether the percent is inside the objective's range on this scale; null when withheld. */
  met: boolean | null
  /** The objective's range on this scale, as the run's thresholds resolve it. */
  floorPercent: number
  maxPercent: number
}

/** The inputs a revision can change, in the words the readout uses. */
export const REVISION_PARTS = {
  blocks: 'proposed blocks',
  masks: 'masks',
  openings: 'existing openings',
  viewpoint: 'viewpoint',
  settings: 'simulation settings',
  year: 'assessment year',
} as const
export type RevisionPart = keyof typeof REVISION_PARTS

export type RunHeadline = {
  /** Identifies the run's inputs; a rerun of the same inputs is not a revision. */
  signature: string
  /** Landform, objective, VAC and resolved ranges: runs compare only when these agree. */
  comparisonKey: string
  landformName: string
  objectiveId: VisualQualityClassId
  numericalReady: boolean
  /** Perspective first, then planimetric. */
  scales: HeadlineScale[]
  parts: Record<RevisionPart, string>
  /** The saved design alternative the run's blocks match, if any. */
  designName: string | null
}

/** A short, stable digest (cyrb53); the readout compares, it never needs the inputs back. */
export function digest(text: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

type DesignScene = {
  targets: ReadonlyArray<Pick<TargetPolygon, 'id' | 'role' | 'geometry' | 'harvestSystem'>>
  masks?: ReadonlyArray<{ kind: string; geometry: unknown }>
}

/** What a saved design alternative supplies (`comparisonScene`): its blocks and retained patches. */
export function designSignature(scene: DesignScene): string {
  return digest(
    canonicalInput({
      blocks: scene.targets
        .filter((t) => t.role === 'block')
        .map((t) => ({ id: t.id, geometry: t.geometry, harvestSystem: t.harvestSystem ?? 'clearcut' })),
      retained: (scene.masks ?? []).filter((m) => m.kind === 'retained').map((m) => m.geometry),
    }),
  )
}

/** The name of the saved alternative whose design the scene carries, or null. */
export function matchingDesignName(
  options: ReadonlyArray<{ name: string; scene: DesignScene }>,
  scene: DesignScene,
): string | null {
  const own = designSignature(scene)
  return options.find((option) => designSignature(option.scene) === own)?.name ?? null
}

function inputParts(result: AnalysisResult): Record<RevisionPart, string> {
  const input = result.inputSnapshot
  const part = (value: unknown) => digest(canonicalInput(value ?? null))
  const targets = input?.targets ?? []
  return {
    blocks: part(targets.filter((t) => t.role === 'block')),
    masks: part(input?.masks ?? []),
    openings: part(targets.filter((t) => t.role === 'harvested')),
    viewpoint: part(input?.viewpoint),
    settings: part(input?.settings),
    year: part(input?.assessmentYear),
  }
}

/**
 * One run's headline figures against the landform it measured. Null when the
 * run has no active landform, or the landform passed in is not the one it
 * measured. Percentages are withheld while the run is provisional, as the
 * Results panel withholds them.
 */
export function runHeadline(
  result: AnalysisResult,
  landform: Pick<TargetPolygon, 'id' | 'name' | 'objectiveId' | 'vac'> | null,
  thresholds: VisualQualityThresholds,
  designName: string | null = null,
): RunHeadline | null {
  if (!landform || !result.activeLandformId || result.activeLandformId !== landform.id) return null
  const numericalReady = !!result.quality?.numericalReady
  const bases: Array<[AlterationBasis, AnalysisResult['perspectiveAlteration']]> = [
    ['perspective', result.perspectiveAlteration],
    ['planimetric', result.planimetricAlteration],
  ]
  const resolved = Object.fromEntries(
    bases.map(([basis]) => [basis, resolvedThresholds(landform.objectiveId, basis, thresholds, landform.vac)]),
  ) as Record<AlterationBasis, VisualQualityThresholds>
  const scales = bases.map(([basis, breakdown]): HeadlineScale => {
    const percent = numericalReady && breakdown ? breakdown.cumulativePercent : null
    const floorPercent = rangeFloorFor(landform.objectiveId, basis, resolved[basis]),
      maxPercent = thresholdFor(landform.objectiveId, basis, resolved[basis])
    if (percent === null || !Number.isFinite(percent))
      return { basis, percent: null, classId: null, met: null, floorPercent, maxPercent }
    const verdict = assessObjective(percent, landform.objectiveId, basis, resolved[basis])
    return { basis, percent, classId: verdict.achieved?.id ?? null, met: verdict.met, floorPercent, maxPercent }
  })
  return {
    signature: digest(result.inputSignature ?? canonicalInput(result.inputSnapshot ?? null)),
    comparisonKey: canonicalInput({
      landform: landform.id,
      objective: landform.objectiveId,
      vac: landform.vac ?? null,
      ranges: scales.map((s) => [s.basis, s.floorPercent, s.maxPercent]),
    }),
    landformName: landform.name,
    objectiveId: landform.objectiveId,
    numericalReady,
    scales,
    parts: inputParts(result),
    designName,
  }
}

export type RevisionState = { previous: RunHeadline | null; current: RunHeadline | null }
export const EMPTY_REVISION: RevisionState = { previous: null, current: null }

/**
 * Moves the current headline to previous when a new run arrives. A run on
 * another landform, objective or range starts over, since its percentages
 * answer a different question; a rerun of the same inputs keeps the
 * comparison it had.
 */
export function nextRevision(state: RevisionState, headline: RunHeadline | null): RevisionState {
  if (!headline) return EMPTY_REVISION
  const current = state.current
  if (current && current.signature === headline.signature) return { previous: state.previous, current: headline }
  if (current && current.comparisonKey === headline.comparisonKey) return { previous: current, current: headline }
  return { previous: null, current: headline }
}

export type Movement = 'now-within' | 'now-over' | 'still-within' | 'still-over' | 'withheld'

export type RevisionLine = {
  basis: AlterationBasis
  /** "Perspective" or "Planimetric": every percent names its scale. */
  scale: string
  before: number | null
  after: number | null
  beforeClassId: VisualQualityClassId | null
  afterClassId: VisualQualityClassId | null
  movement: Movement
  /** "Modification 14.2% → Partial retention 6.1%". */
  change: string
  /** "now within partial retention (≤ 7%)". */
  verdict: string
}

export type RevisionReadout = {
  landformName: string
  objectiveLabel: string
  lines: RevisionLine[]
  /** What differs between the two runs' inputs, in words. */
  changed: string[]
  previousDesign: string | null
  currentDesign: string | null
}

const SCALE_LABELS: Record<AlterationBasis, string> = { perspective: 'Perspective', planimetric: 'Planimetric' }

function reading(percent: number | null, classId: VisualQualityClassId | null): string {
  if (percent === null) return 'withheld'
  const label = classId ? visualQualityClass(classId).label : 'Beyond maximum modification'
  return `${label} ${formatPct(percent)}`
}

/** The before/after readout, or null until there are two comparable runs. */
export function describeRevision(state: RevisionState): RevisionReadout | null {
  const { previous, current } = state
  if (!previous || !current) return null
  const objective = visualQualityClass(current.objectiveId)
  const lines = current.scales.map((after): RevisionLine => {
    const before = previous.scales.find((s) => s.basis === after.basis)
    const range = `${objective.label.toLowerCase()} (≤ ${formatPct(after.maxPercent, 0)})`
    const movement: Movement =
      before?.met == null || after.met === null
        ? 'withheld'
        : after.met
          ? before.met
            ? 'still-within'
            : 'now-within'
          : before.met
            ? 'now-over'
            : 'still-over'
    const verdict =
      movement === 'withheld' ? 'not compared: a run is provisional' : `${movement.replace('-', ' ')} ${range}`
    return {
      basis: after.basis,
      scale: SCALE_LABELS[after.basis],
      before: before?.percent ?? null,
      after: after.percent,
      beforeClassId: before?.classId ?? null,
      afterClassId: after.classId,
      movement,
      change: `${reading(before?.percent ?? null, before?.classId ?? null)} → ${reading(after.percent, after.classId)}`,
      verdict,
    }
  })
  const changed = (Object.keys(REVISION_PARTS) as RevisionPart[])
    .filter((part) => previous.parts[part] !== current.parts[part])
    .map((part) => REVISION_PARTS[part])
  return {
    landformName: current.landformName,
    objectiveLabel: objective.label,
    lines,
    changed,
    previousDesign: previous.designName,
    currentDesign: current.designName,
  }
}
