/**
 * The readiness list: the checks a designer is responsible for before a road leaves the workspace.
 * Pure and derived, with no DOM or network access. It never edits the design.
 *
 * Every row is one check with one of three states. `met` means the check was made and nothing is
 * outstanding. `attention` means it was made and something is: a limit is broken (`limit`) or an
 * input is still to do (`todo`). `not-assessed` means the workspace could not make the check, because
 * a limit was not entered, a result is missing or out of date, or the subject is outside what it
 * models. A check that was not made never reads as met.
 *
 * Two things make a rule unable to judge, and each rule tests for both before it can read met: the
 * calculation it reads is absent (`calculated` is false when the analysis has no stations), or its
 * own input is empty (no streams, no limit, no culvert). `readiness.test.ts` holds one case per rule.
 *
 * None of this certifies a road standard: the limits are the project's own inputs.
 */
import { calculatedAlignment, hasCompleteCoverage } from './analysisResult'
import { MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M } from './connectorCheckOptions'
import { CONSTRAINT_LABELS, resolveConstraint } from './constraints'
import { assessCostReadiness, type CostReadinessAssessment } from './costReadiness'
import { buildCrossingRegister, type CrossingRegister } from './crossingRegister'
import { gradeRule, gradeRuleText, reviewGrades, type DesignStandards } from './designStandards'
import type { DrainageEvidence } from './drainageEvidence'
import { horizontalCurveSummary, verticalCurveSummary } from './engine'
import { materialPlanMissing } from './engineeringTypes'
import { invalidInputMessages, type EngineeringInputList } from './inputErrors'
import { STREAM_STATUS_LABELS } from './streamClass'
import type { SweptPathResult } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type {
  Alignment,
  ContextFeature,
  RoadAnalysis,
  RoadProject,
  RoadSettings,
  RoadTemplate,
  TerrainMetadata,
} from './types'

export type ReadinessState = 'met' | 'attention' | 'not-assessed'
export type ReadinessGroup = 'inputs' | 'terrain' | 'alignment' | 'earthwork' | 'water' | 'cost'
/** Where a row's action leads. The interface maps each to the place the check is cleared. */
export type ReadinessTarget =
  | 'terrain'
  | 'station'
  | 'standards'
  | 'profile'
  | 'curves'
  | 'vehicle'
  | 'vertical-standards'
  | 'template'
  | 'templates'
  | 'materials'
  | 'haul'
  | 'rates'
  | 'culverts'
  | 'streams'
  | 'drainage'
  | 'constraints'

export interface ReadinessRow {
  id: string
  group: ReadinessGroup
  /** The check as a statement a designer signs: "Grade within the standard". */
  check: string
  state: ReadinessState
  /** On a row that needs attention: a limit is broken, or an input is still to do. */
  severity?: 'limit' | 'todo'
  /** What was found, stated as a result: "Grade exceeds the standard in 2 places". */
  result: string
  /** The measured value the result rests on. */
  measured?: string
  /** The limit or rule it was judged on. */
  judgedOn?: string
  action?: { label: string; target: ReadinessTarget; chainage?: number }
}

export const READINESS_GROUP_LABELS: Record<ReadinessGroup, string> = {
  // Shown only while an input cannot be calculated; it leads because it qualifies every row after it.
  inputs: 'Inputs',
  terrain: 'Terrain',
  alignment: 'Alignment',
  earthwork: 'Section and earthwork',
  water: 'Water and constraints',
  cost: 'Cost',
}
export const READINESS_STATE_LABELS: Record<ReadinessState, string> = {
  met: 'Met',
  attention: 'Needs attention',
  'not-assessed': 'Not assessed',
}

/** A balance inside this share of the larger of fill and usable cut, or this volume, counts as balanced. */
export const BALANCE_TOLERANCE_FRACTION = 0.02
export const BALANCE_TOLERANCE_M3 = 10
/** A grade break smaller than this needs no vertical curve to be reported. */
export const MIN_GRADE_BREAK_PERCENT = 0.5

export interface VehicleFit {
  vehicleName: string
  clearanceM: number
  turns: number
  failingTurns: number
  /** Largest wheel-path widening any turn needs, 0 when everything fits. */
  worstWideningM: number
  worstChainage: number | null
}

/** The swept-path result reduced to what the readiness row states. */
export function vehicleFit(result: SweptPathResult): VehicleFit {
  const failing = result.maneuvers.filter((turn) => !turn.fits)
  const worst = failing.reduce<(typeof failing)[number] | null>(
    (best, turn) =>
      !best ||
      Math.max(turn.requiredLeftWideningM, turn.requiredRightWideningM) >
        Math.max(best.requiredLeftWideningM, best.requiredRightWideningM)
        ? turn
        : best,
    null,
  )
  return {
    vehicleName: result.check.vehicle.name,
    clearanceM: result.check.clearanceM,
    turns: result.maneuvers.length,
    failingTurns: failing.length,
    worstWideningM: worst ? Math.max(worst.requiredLeftWideningM, worst.requiredRightWideningM) : 0,
    worstChainage: worst?.worstChainage ?? null,
  }
}

export interface ReadinessInput {
  settings: RoadSettings
  standards?: DesignStandards
  terrain: Pick<TerrainMetadata, 'kind' | 'name' | 'resolutionM' | 'verticalReference'>
  context: readonly ContextFeature[]
  alignment: Alignment
  analysis: RoadAnalysis
  cost: CostReadinessAssessment
  drainage?: { record?: DrainageEvidence; stale: boolean }
  /** Null when no vehicle has been run on this road. */
  vehicle?: VehicleFit | null
  /** Built here when omitted; pass the one already on screen so both agree. */
  register?: CrossingRegister
}

const EPS = 1e-6
const station = (chainage: number) => {
  const rounded = Math.round(Math.max(0, chainage) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}
const num = (value: number, digits = 0) =>
  value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const trim = (value: number, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits)
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
/** "The 1 crossing has", "All 3 crossings have": a met row's subject, whatever the count. */
const every = (count: number, one: string, many: string) => (count === 1 ? `The 1 ${one}` : `All ${count} ${many}`)
const pct = (value: number) => `${Math.abs(value).toFixed(1)}%`
const money = (value: number) => `$${num(value, value % 1 ? 2 : 0)}`

/** Consecutive stations that satisfy `test`, as chainage ranges. */
function ranges<T extends { chainage: number }>(stations: readonly T[], test: (station: T) => boolean) {
  const out: { start: number; end: number; count: number }[] = []
  let open: (typeof out)[number] | null = null
  for (const item of stations) {
    if (!test(item)) {
      open = null
      continue
    }
    if (open) {
      open.end = item.chainage
      open.count++
    } else out.push((open = { start: item.chainage, end: item.chainage, count: 1 }))
  }
  return out
}
const span = (range: { start: number; end: number }) =>
  range.end - range.start < 0.05 ? station(range.start) : `${station(range.start)} to ${station(range.end)}`

const TEMPLATE_KEYS = [
  'leftWidth',
  'rightWidth',
  'crossfallPercent',
  'cutSlope',
  'fillSlope',
  'ditchWidth',
  'ditchDepth',
  'surfaceDepth',
] as const
/** True while the template is exactly the one a new road starts with. */
export function isStartingTemplate(template: RoadTemplate): boolean {
  const extras = Object.entries(template).filter(
    ([key, value]) => !(TEMPLATE_KEYS as readonly string[]).includes(key) && value !== undefined,
  )
  return (
    TEMPLATE_KEYS.every((key) => template[key] === DEFAULT_TEMPLATE[key]) &&
    extras.every(([, value]) => Array.isArray(value) && value.length === 0)
  )
}

/** Where each kind of engineering input is corrected. */
const INPUT_TARGETS: Record<EngineeringInputList, ReadinessTarget> = {
  template: 'template',
  templates: 'templates',
  assignments: 'templates',
  materials: 'materials',
  strata: 'materials',
  sitePreparation: 'materials',
  culverts: 'culverts',
  sites: 'haul',
  fillRequirements: 'haul',
  directionRanges: 'haul',
  sidecastRanges: 'haul',
  haul: 'haul',
}

const COST_FLAG_OWNERS: Record<string, string> = {
  'partial-sections': 'terrain-coverage',
  'placeholder-rates': 'rates',
  'zero-work-rates': 'rates',
  'aggregate-source-evidence': 'rates',
  'unclassified-ground': 'materials',
  'haul-disabled': 'haul',
  'borrow-screening': 'earthwork-balance',
  'infeasible-material-plan': 'haul',
  'unsolved-material-plan': 'haul',
  'unallocated-haul': 'haul',
  'zero-supply-rates': 'haul',
  'zero-haul-rates': 'haul',
  'unassigned-crossings': 'crossing-structures',
  'drainage-inventory': 'crossing-structures',
  'incomplete-crossing-estimate': 'structure-costs',
  'zero-culvert-rates': 'structure-costs',
  'incomplete-culverts': 'structure-costs',
  'excluded-culverts': 'structure-costs',
  // A standing reminder of what no estimate here covers; the report prints it in full.
  'project-scope': 'none',
}

export function assessReadiness(input: ReadinessInput): ReadinessRow[] {
  const { settings, standards, terrain, context, alignment, analysis, cost } = input
  const rows: ReadinessRow[] = []
  const add = (row: ReadinessRow) => rows.push(row)
  const stations = analysis.stations
  const engineering = alignment.engineering
  const result = analysis.engineering
  const mapped = !!alignment.mappedRoad
  const designed = alignment.vertical.length > 1
  const costFlags = (owner: string) => cost.flags.filter((flag) => COST_FLAG_OWNERS[flag.id] === owner)
  /** False when the analysis produced nothing: every rule that reads it is then not assessed. */
  const calculated = stations.length > 0

  // ---- Inputs --------------------------------------------------------------------------------
  // An input that cannot be calculated is left out of the results, so every row below is judged on
  // its last valid value. The list says so first, and cannot read as clear while it stands.
  const invalid = analysis.invalidInput
  if (invalid) {
    const messages = invalidInputMessages(invalid)
    add({
      id: 'invalid-input',
      group: 'inputs',
      check: 'Every input can be calculated',
      state: 'attention',
      severity: 'limit',
      result: !stations.length
        ? 'Nothing is calculated: an input is invalid'
        : invalid.leftOut === 'all'
          ? 'The results leave out every section and engineering edit since the inputs were last valid'
          : `The results leave out ${plural(messages.length, 'invalid input')}`,
      measured: `${messages.join(' ')}${
        !stations.length
          ? ''
          : invalid.leftOut === 'all'
            ? ' The checks below are judged on the last valid inputs.'
            : ` The checks below use ${messages.length === 1 ? 'its last valid value' : 'their last valid values'}.`
      }`,
      judgedOn: 'Every section and engineering input inside its allowed range',
      action: {
        label: 'Correct the input',
        target: invalid.target ? INPUT_TARGETS[invalid.target.list] : 'template',
      },
    })
  }

  // ---- Terrain -------------------------------------------------------------------------------
  const sourceText = `${terrain.name} · ${trim(terrain.resolutionM, 2)} m cells · ${terrain.verticalReference || 'no vertical datum'}`
  const siteLimit = `${MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M} m cells or finer, from a survey you have checked`
  if (terrain.kind !== 'demo' && !(Number.isFinite(terrain.resolutionM) && terrain.resolutionM > 0))
    add({
      id: 'terrain-source',
      group: 'terrain',
      check: 'Terrain fit for site quantities',
      state: 'not-assessed',
      result: 'The terrain’s cell size is not recorded',
      measured: terrain.name,
      judgedOn: siteLimit,
      action: { label: 'Terrain', target: 'terrain' },
    })
  else if (terrain.kind === 'demo')
    add({
      id: 'terrain-source',
      group: 'terrain',
      check: 'Terrain fit for site quantities',
      state: 'attention',
      severity: 'limit',
      result: 'Synthetic training terrain: every quantity and location is illustrative',
      measured: sourceText,
      judgedOn: siteLimit,
      action: { label: 'Terrain', target: 'terrain' },
    })
  else if (terrain.kind === 'regional' || terrain.resolutionM > MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M + EPS)
    add({
      id: 'terrain-source',
      group: 'terrain',
      check: 'Terrain fit for site quantities',
      state: 'attention',
      severity: 'limit',
      result: `Terrain is too coarse for earthworks: ${trim(terrain.resolutionM, 2)} m cells`,
      measured: sourceText,
      judgedOn: siteLimit,
      action: { label: 'Terrain', target: 'terrain' },
    })
  else
    add({
      id: 'terrain-source',
      group: 'terrain',
      check: 'Terrain fit for site quantities',
      state: 'met',
      result: `Terrain resolves the road: ${trim(terrain.resolutionM, 2)} m cells`,
      measured: sourceText,
      judgedOn: `${siteLimit}. Accuracy is the source's, not checked here`,
    })

  const gaps = ranges(stations, (s) => !s.complete)
  if (!stations.length)
    add({
      id: 'terrain-coverage',
      group: 'terrain',
      check: 'Ground and design known at every section',
      state: 'not-assessed',
      result: 'No sections were calculated',
      measured: analysis.warnings[0],
      action: { label: 'Design', target: 'profile' },
    })
  else if (hasCompleteCoverage(analysis))
    add({
      id: 'terrain-coverage',
      group: 'terrain',
      check: 'Ground and design known at every section',
      state: 'met',
      result: 'Every section is complete',
      measured: `${num(analysis.completeLength)} of ${num(analysis.length)} m · ${plural(stations.length, 'section')}`,
      judgedOn: '100% of the road length',
    })
  else
    add({
      id: 'terrain-coverage',
      group: 'terrain',
      check: 'Ground and design known at every section',
      state: 'attention',
      severity: 'limit',
      result: `${plural(gaps.length, 'gap')} in the sections: quantities and cost leave them out`,
      measured: `${analysis.coveragePercent.toFixed(1)}% covered · ${gaps
        .slice(0, 3)
        .map(span)
        .join(', ')}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ''}`,
      judgedOn: '100% of the road length',
      action: gaps.length
        ? { label: `Go to ${station(gaps[0].start)}`, target: 'station', chainage: gaps[0].start }
        : undefined,
    })

  // ---- Alignment -----------------------------------------------------------------------------
  const rule = gradeRule(settings, standards)
  const limitsText = `${gradeRuleText(rule)} grade · minimum radius ${trim(settings.minRadius)} m`
  add(
    standards?.confirmedOn
      ? {
          id: 'standards',
          group: 'alignment',
          check: 'Design standards confirmed for this job',
          state: 'met',
          result: `Standards confirmed ${standards.confirmedOn}`,
          measured: limitsText,
          judgedOn: standards.source ? `Source: ${standards.source}` : 'Entered by the designer; no source recorded',
        }
      : {
          id: 'standards',
          group: 'alignment',
          check: 'Design standards confirmed for this job',
          state: 'attention',
          severity: 'todo',
          result: 'The limits are the starting values, not this job’s',
          measured: limitsText,
          judgedOn: 'A person confirms the limits once per project',
          action: { label: 'Set standards', target: 'standards' },
        },
  )

  add(
    designed
      ? {
          id: 'profile',
          group: 'alignment',
          check: 'Profile designed',
          state: 'met',
          result: `Profile designed with ${plural(alignment.vertical.length, 'PVI')}`,
        }
      : mapped
        ? {
            id: 'profile',
            group: 'alignment',
            check: 'Profile designed',
            state: 'not-assessed',
            result: 'Mapped road: read as built, with the formation on the ground',
          }
        : {
            id: 'profile',
            group: 'alignment',
            check: 'Profile designed',
            state: 'attention',
            severity: 'todo',
            result: 'No profile: the formation follows the ground',
            judgedOn: 'At least two PVIs (points of vertical intersection)',
            action: { label: 'Design', target: 'profile' },
          },
  )

  const grades = reviewGrades(stations, rule)
  const signedRanges = (analysis.verticalChecks ?? []).filter(
    (check) => check.kind === 'grade' || check.kind === 'control-grade',
  )
  if (!grades.steepest)
    add({
      id: 'grade',
      group: 'alignment',
      check: 'Grade within the standard',
      state: 'not-assessed',
      result: 'No grades were calculated',
      judgedOn: gradeRuleText(rule),
    })
  else {
    const steep = `Steepest ${pct(grades.steepest.percent)} at ${station(grades.steepest.chainage)}${designed ? '' : ' (ground grade)'}`
    const pitches = grades.pitches.length
      ? ` · ${plural(grades.pitches.length, 'short pitch', 'short pitches')} allowed, longest ${num(Math.max(...grades.pitches.map((run) => run.lengthM)))} m`
      : ''
    const worst = grades.breaches.reduce<(typeof grades.breaches)[number] | null>(
      (best, run) => (!best || Math.abs(run.worstPercent) > Math.abs(best.worstPercent) ? run : best),
      null,
    )
    if (worst)
      add({
        id: 'grade',
        group: 'alignment',
        check: 'Grade within the standard',
        state: 'attention',
        severity: 'limit',
        result: `Grade exceeds the standard in ${plural(grades.breaches.length, 'place')}`,
        measured: `${steep} · ${num(grades.breachLengthM)} m over at ${grades.breaches
          .slice(0, 3)
          .map(span)
          .join(', ')}${grades.breaches.length > 3 ? ` and ${grades.breaches.length - 3} more` : ''}${pitches}`,
        judgedOn: gradeRuleText(rule),
        action: { label: `Go to ${station(worst.worstChainage)}`, target: 'station', chainage: worst.worstChainage },
      })
    else if (signedRanges.length)
      add({
        id: 'grade',
        group: 'alignment',
        check: 'Grade within the standard',
        state: 'attention',
        severity: 'limit',
        result: `Grade is outside ${plural(signedRanges.length, 'station-range limit')}`,
        measured: signedRanges[0].message,
        judgedOn: `${gradeRuleText(rule)}, and the road’s grade ranges and control points`,
        action: {
          label: `Go to ${station(signedRanges[0].chainage)}`,
          target: 'station',
          chainage: signedRanges[0].chainage,
        },
      })
    else
      add({
        id: 'grade',
        group: 'alignment',
        check: 'Grade within the standard',
        state: 'met',
        result: 'Grade is within the standard',
        measured: `${steep}${pitches}`,
        judgedOn: gradeRuleText(rule),
      })
  }

  // The engine refuses a line it cannot read; the curve rows then have nothing to judge.
  const fittedCurves = (() => {
    try {
      return horizontalCurveSummary(alignment)
    } catch {
      return null
    }
  })()
  const curves = fittedCurves ?? []
  const sharp = ranges(stations, (s) => s.flags.some((flag) => /Sharp horizontal PI/i.test(flag)))
  const corners = Math.max(0, alignment.points.length - 2)
  add(
    !calculated
      ? {
          // A sharp corner is a flag on a calculated station: without stations none can be found.
          id: 'curves-fitted',
          group: 'alignment',
          check: 'Every corner fitted with a curve',
          state: 'not-assessed',
          result: 'No sections were calculated, so the corners were not checked',
          judgedOn: 'A curve at every IP (intersection point)',
        }
      : sharp.length
        ? {
            id: 'curves-fitted',
            group: 'alignment',
            check: 'Every corner fitted with a curve',
            state: 'attention',
            severity: 'limit',
            result: `${plural(sharp.length, 'corner has', 'corners have')} no curve`,
            measured: `${plural(curves.length, 'curve')} on ${plural(corners, 'corner')} · sharp at ${sharp
              .slice(0, 3)
              .map((range) => station(range.start))
              .join(', ')}`,
            judgedOn: 'A curve at every IP (intersection point)',
            action: { label: `Go to ${station(sharp[0].start)}`, target: 'curves', chainage: sharp[0].start },
          }
        : {
            id: 'curves-fitted',
            group: 'alignment',
            check: 'Every corner fitted with a curve',
            state: 'met',
            result: corners ? `${every(corners, 'corner has', 'corners have')} a curve` : 'Straight road: no corners',
            measured: corners ? plural(curves.length, 'curve') : undefined,
            judgedOn: 'A curve at every IP (intersection point)',
          },
  )

  const tight = curves.filter((curve) => curve.radius < settings.minRadius - EPS)
  const tightest = curves.reduce<(typeof curves)[number] | null>(
    (best, curve) => (!best || curve.radius < best.radius ? curve : best),
    null,
  )
  if (!fittedCurves)
    add({
      id: 'curve-radius',
      group: 'alignment',
      check: 'Curve radius at or above the minimum',
      state: 'not-assessed',
      result: 'The line could not be calculated',
      judgedOn: `Minimum radius ${trim(settings.minRadius)} m`,
    })
  else if (settings.minRadius <= 0)
    add({
      id: 'curve-radius',
      group: 'alignment',
      check: 'Curve radius at or above the minimum',
      state: 'not-assessed',
      result: 'No minimum radius is entered',
      measured: tightest ? `Tightest ${trim(tightest.radius)} m at ${station(tightest.start)}` : undefined,
      action: { label: 'Set standards', target: 'standards' },
    })
  else if (tight.length && tightest)
    add({
      id: 'curve-radius',
      group: 'alignment',
      check: 'Curve radius at or above the minimum',
      state: 'attention',
      severity: 'limit',
      result: `${tight.length} of ${plural(curves.length, 'curve')} ${tight.length === 1 ? 'is' : 'are'} tighter than ${trim(settings.minRadius)} m`,
      measured: `Tightest ${trim(tightest.radius)} m at ${station(tightest.start)} · below at ${tight
        .slice(0, 4)
        .map((curve) => station(curve.start))
        .join(', ')}${tight.length > 4 ? ` and ${tight.length - 4} more` : ''}`,
      judgedOn: `Minimum radius ${trim(settings.minRadius)} m`,
      action: {
        label: `Go to ${station(tightest.start)}`,
        target: 'curves',
        chainage: (tightest.start + tightest.end) / 2,
      },
    })
  else if (!curves.length && corners > 0)
    // Corners with no curve fitted are the corner row's finding; there is no radius here to pass.
    add({
      id: 'curve-radius',
      group: 'alignment',
      check: 'Curve radius at or above the minimum',
      state: 'not-assessed',
      result: 'No curve is fitted, so there is no radius to judge',
      judgedOn: `Minimum radius ${trim(settings.minRadius)} m`,
    })
  else
    add({
      id: 'curve-radius',
      group: 'alignment',
      check: 'Curve radius at or above the minimum',
      state: 'met',
      result: curves.length ? `Every curve is ${trim(settings.minRadius)} m or wider` : 'Straight road: no curves',
      measured: tightest ? `Tightest ${trim(tightest.radius)} m at ${station(tightest.start)}` : undefined,
      judgedOn: `Minimum radius ${trim(settings.minRadius)} m`,
    })

  const vehicle = input.vehicle
  if (!vehicle)
    add({
      id: 'vehicle-fit',
      group: 'alignment',
      check: 'Design vehicle stays on the running surface',
      state: 'not-assessed',
      result: standards?.designVehicle
        ? 'The design vehicle has not been run on this road'
        : 'No design vehicle is checked on this road',
      judgedOn: 'Swept path of the design vehicle against the formation width',
      action: { label: 'Check a vehicle', target: 'vehicle' },
    })
  else if (vehicle.failingTurns)
    add({
      id: 'vehicle-fit',
      group: 'alignment',
      check: 'Design vehicle stays on the running surface',
      state: 'attention',
      severity: 'limit',
      result: `The vehicle leaves the running surface at ${vehicle.failingTurns} of ${plural(vehicle.turns, 'turn')}`,
      measured: `${vehicle.vehicleName} · needs up to ${vehicle.worstWideningM.toFixed(2)} m more width${vehicle.worstChainage === null ? '' : ` at ${station(vehicle.worstChainage)}`}`,
      judgedOn: `Wheel paths inside the formation with ${vehicle.clearanceM.toFixed(2)} m clearance`,
      action: { label: 'Open check', target: 'vehicle', chainage: vehicle.worstChainage ?? undefined },
    })
  else
    add({
      id: 'vehicle-fit',
      group: 'alignment',
      check: 'Design vehicle stays on the running surface',
      state: 'met',
      result: vehicle.turns ? `The vehicle fits all ${plural(vehicle.turns, 'turn')}` : 'The vehicle fits: no turns',
      measured: vehicle.vehicleName,
      judgedOn: `Wheel paths inside the formation with ${vehicle.clearanceM.toFixed(2)} m clearance`,
    })

  // Grade breaks from the PVIs themselves, so the row holds when no K limit is entered. A curve
  // counts only where the engine applied it: one that does not fit its tangents, or overlaps its
  // neighbour, is dropped there and leaves the break unrounded.
  const pvis = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  // The engine refuses PVIs it cannot order or read; the rows then have nothing to judge.
  const curveSummary = (() => {
    try {
      return verticalCurveSummary(alignment)
    } catch {
      return null
    }
  })()
  const profileRead = designed && curveSummary !== null
  const noProfile = designed ? 'The profile could not be calculated' : 'No designed profile to check'
  const enteredCurves = new Map((curveSummary ?? []).map((curve) => [curve.pviId, curve]))
  const breaks = pvis.slice(1, -1).flatMap((pvi, i) => {
    const before = pvis[i],
      after = pvis[i + 2]
    const run1 = pvi.chainage - before.chainage,
      run2 = after.chainage - pvi.chainage
    if (run1 <= EPS || run2 <= EPS) return []
    const g1 = ((pvi.elevation - before.elevation) / run1) * 100,
      g2 = ((after.elevation - pvi.elevation) / run2) * 100
    const change = Math.abs(g2 - g1)
    if (change < MIN_GRADE_BREAK_PERCENT) return []
    const curve = enteredCurves.get(pvi.id)
    const applied = !!curve?.valid
    return [
      {
        pvi,
        change,
        applied,
        /** Set when a curve was entered and the engine did not apply it. */
        dropped: curve && !applied ? curve : null,
        k: applied ? pvi.curveLength / change : 0,
      },
    ]
  })
  const unrounded = breaks.filter((item) => !item.applied)
  const droppedBreaks = unrounded.filter((item) => item.dropped)
  const bareBreaks = unrounded.filter((item) => !item.dropped)
  const stationList = <T>(items: readonly T[], text: (item: T) => string, limit = 4) =>
    `${items.slice(0, limit).map(text).join(', ')}${items.length > limit ? ` and ${items.length - limit} more` : ''}`
  const curveRule = `A curve at every PVI where the grade changes by ${MIN_GRADE_BREAK_PERCENT}% or more`
  if (!profileRead)
    add({
      id: 'vertical-curves',
      group: 'alignment',
      check: 'Vertical curve at every grade break',
      state: 'not-assessed',
      result: noProfile,
    })
  else if (unrounded.length) {
    const largest = unrounded.reduce((best, item) => (item.change > best.change ? item : best))
    const first = droppedBreaks[0] ?? largest
    add({
      id: 'vertical-curves',
      group: 'alignment',
      check: 'Vertical curve at every grade break',
      state: 'attention',
      // An entered curve the road does not have is a broken design, not an input still to make.
      severity: droppedBreaks.length ? 'limit' : 'todo',
      result: `${unrounded.length} of ${plural(breaks.length, 'grade break')} ${unrounded.length === 1 ? 'has' : 'have'} no vertical curve${
        droppedBreaks.length
          ? `: ${plural(droppedBreaks.length, 'entered curve does', 'entered curves do')} not fit and ${droppedBreaks.length === 1 ? 'is' : 'are'} not applied`
          : ''
      }`,
      measured: [
        droppedBreaks.length
          ? `Entered curve not applied at ${stationList(
              droppedBreaks,
              (item) =>
                `${station(item.pvi.chainage)} (${trim(item.pvi.curveLength)} m, ${item.dropped!.reason === 'overlap' ? 'overlaps its neighbour' : 'does not fit its tangents'})`,
            )}`
          : '',
        droppedBreaks.length && bareBreaks.length
          ? `no curve entered at ${stationList(bareBreaks, (item) => station(item.pvi.chainage))}`
          : '',
        `${droppedBreaks.length ? 'largest' : 'Largest'} unrounded break ${largest.change.toFixed(1)}% at ${station(largest.pvi.chainage)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      judgedOn: droppedBreaks.length ? `${curveRule}; a curve counts only where it fits and is applied` : curveRule,
      action: { label: `Go to ${station(first.pvi.chainage)}`, target: 'profile', chainage: first.pvi.chainage },
    })
  } else
    add({
      id: 'vertical-curves',
      group: 'alignment',
      check: 'Vertical curve at every grade break',
      state: 'met',
      result: breaks.length
        ? `${every(breaks.length, 'grade break has', 'grade breaks have')} a vertical curve`
        : 'No grade breaks',
      judgedOn: curveRule,
    })

  const vertical = alignment.verticalStandards
  const kEntered =
    !!vertical &&
    (vertical.minSagK !== null ||
      vertical.minCrestK !== null ||
      vertical.minCurveLengthM !== null ||
      !!vertical.curvatureRanges?.some((range) => range.minSagK !== null || range.minCrestK !== null))
  const kFailures = (analysis.verticalChecks ?? []).filter(
    (check) => check.kind === 'k' || check.kind === 'curve-length' || check.kind === 'tangent',
  )
  // K is quoted for applied curves only: a dropped curve has no K to report.
  const smallestK = breaks
    .filter((item) => item.k > 0)
    .reduce<(typeof breaks)[number] | null>((best, item) => (!best || item.k < best.k ? item : best), null)
  const notApplied = droppedBreaks.length
    ? `${plural(droppedBreaks.length, 'entered curve')} not applied at ${stationList(droppedBreaks, (item) => station(item.pvi.chainage))}`
    : ''
  const kMeasured =
    [
      smallestK
        ? `Smallest K ${smallestK.k.toFixed(1)} at ${station(smallestK.pvi.chainage)}`
        : droppedBreaks.length
          ? 'No vertical curve is applied'
          : '',
      smallestK ? notApplied : '',
    ]
      .filter(Boolean)
      .join(' · ') || undefined
  const kLimit = `Minimum K: sag ${vertical?.minSagK ?? 'not set'}, crest ${vertical?.minCrestK ?? 'not set'}`
  if (!profileRead || !kEntered)
    add({
      id: 'vertical-k',
      group: 'alignment',
      check: 'Vertical curves long enough for sight distance (K)',
      state: 'not-assessed',
      result: profileRead ? 'No minimum K is entered, so curve length is not checked' : noProfile,
      measured: profileRead ? kMeasured : undefined,
      judgedOn: 'K is curve length divided by the grade change in percent',
      action: profileRead ? { label: 'Set minimum K', target: 'vertical-standards' } : undefined,
    })
  else if (kFailures.length)
    add({
      id: 'vertical-k',
      group: 'alignment',
      check: 'Vertical curves long enough for sight distance (K)',
      state: 'attention',
      severity: 'limit',
      result: `${plural(kFailures.length, 'vertical curve check')} failed`,
      measured: kFailures[0].message,
      judgedOn: kLimit,
      action: { label: `Go to ${station(kFailures[0].chainage)}`, target: 'profile', chainage: kFailures[0].chainage },
    })
  else
    add({
      id: 'vertical-k',
      group: 'alignment',
      check: 'Vertical curves long enough for sight distance (K)',
      state: 'met',
      // A dropped curve reaches here only where no minimum applies to its kind of break.
      result: droppedBreaks.length
        ? 'Every applied vertical curve meets the minimum K'
        : 'Every vertical curve meets the minimum K',
      measured: kMeasured,
      judgedOn: kLimit,
    })

  // ---- Section and earthwork -----------------------------------------------------------------
  const template = alignment.template
  const top = template.leftWidth + template.rightWidth
  const templateText = `${trim(top, 2)} m top · cut ${trim(template.cutSlope, 2)}:1 · fill ${trim(template.fillSlope, 2)}:1 · ditch ${trim(template.ditchWidth, 2)} × ${trim(template.ditchDepth, 2)} m · ${trim(template.surfaceDepth, 2)} m surfacing`
  const standardWidth = standards?.runningSurfaceWidthM ?? null
  if (mapped)
    add({
      id: 'template',
      group: 'earthwork',
      check: 'Cross-section template set for this road',
      state: 'not-assessed',
      result: 'Mapped road: no section is designed',
    })
  else if (standardWidth !== null && Math.abs(top - standardWidth) > 0.005)
    add({
      id: 'template',
      group: 'earthwork',
      check: 'Cross-section template set for this road',
      state: 'attention',
      severity: 'limit',
      result: `Running surface is ${trim(top, 2)} m; the standard is ${trim(standardWidth, 2)} m`,
      measured: templateText,
      judgedOn: `Running-surface width ${trim(standardWidth, 2)} m`,
      action: { label: 'Section', target: 'template' },
    })
  else if (isStartingTemplate(template) && !(standardWidth !== null && standards?.confirmedOn))
    add({
      id: 'template',
      group: 'earthwork',
      check: 'Cross-section template set for this road',
      state: 'attention',
      severity: 'todo',
      result: 'The template is still the starting one',
      measured: templateText,
      judgedOn: 'Widths, slopes, ditch and surfacing chosen for this road',
      action: { label: 'Section', target: 'template' },
    })
  else
    add({
      id: 'template',
      group: 'earthwork',
      check: 'Cross-section template set for this road',
      state: 'met',
      result:
        standardWidth !== null
          ? `Running surface matches the ${trim(standardWidth, 2)} m standard`
          : 'Template edited for this road',
      measured: templateText,
      judgedOn:
        standardWidth !== null
          ? `Running-surface width ${trim(standardWidth, 2)} m`
          : 'Differs from the starting template',
    })

  const unclassified = result
    ? (result.materials.find((material) => material.materialId === '__unclassified')?.bankCutM3 ?? 0)
    : analysis.cutVolumeM3
  // Earthwork exists only between complete sections: with none, zero cut is not "no cut".
  const earthworkKnown = calculated && analysis.completeLength > EPS
  if (analysis.cutVolumeM3 <= EPS)
    add({
      id: 'materials',
      group: 'earthwork',
      check: 'Ground materials entered for the cut',
      state: earthworkKnown ? 'met' : 'not-assessed',
      result: earthworkKnown ? 'No cut to classify' : 'No earthwork was calculated',
    })
  else if (unclassified > EPS)
    add({
      id: 'materials',
      group: 'earthwork',
      check: 'Ground materials entered for the cut',
      state: 'attention',
      severity: 'todo',
      result: `${num(unclassified)} m³ of cut has no material: rock and organics are not told apart`,
      measured: `${num(unclassified)} of ${num(analysis.cutVolumeM3)} bank m³ unclassified · reused at ${trim(settings.shrinkFactor, 2)}`,
      judgedOn: 'A material horizon under every cut',
      action: { label: 'Materials', target: 'materials' },
    })
  else
    add({
      id: 'materials',
      group: 'earthwork',
      check: 'Ground materials entered for the cut',
      state: 'met',
      result: 'All cut has a material',
      measured: `${plural(result?.materials.filter((m) => m.bankCutM3 > EPS).length ?? 0, 'material')} over ${num(analysis.cutVolumeM3)} bank m³`,
      judgedOn: 'A material horizon under every cut',
    })

  const usableCut = result?.usableCutM3 ?? analysis.cutVolumeM3 * settings.shrinkFactor
  const balance = usableCut - analysis.fillVolumeM3
  const tolerance = Math.max(
    BALANCE_TOLERANCE_M3,
    BALANCE_TOLERANCE_FRACTION * Math.max(usableCut, analysis.fillVolumeM3),
  )
  const balanceText = `${num(usableCut)} m³ usable cut − ${num(analysis.fillVolumeM3)} m³ fill = ${balance < 0 ? '−' : '+'}${num(Math.abs(balance))} m³${hasCompleteCoverage(analysis) ? '' : ' (covered sections only)'}`
  const balanceLimit = `Balanced within ${num(tolerance)} m³ (${BALANCE_TOLERANCE_FRACTION * 100}%), or every cubic metre given a source or site`
  const haul = result?.haul
  const sites = (kind: 'borrow' | 'waste') =>
    (engineering?.sites ?? []).filter((site) => site.kind === kind && site.enabled !== false).map((site) => site.name)
  if (analysis.cutVolumeM3 <= EPS && analysis.fillVolumeM3 <= EPS)
    add({
      id: 'earthwork-balance',
      group: 'earthwork',
      check: 'Earthwork balanced, or borrow and waste given a source',
      state: 'not-assessed',
      result: 'No earthwork was calculated',
    })
  else if (haul && materialPlanMissing(haul))
    // No allocation was adopted, so there is no borrow, waste or shortfall to state: the totals
    // are known, where they go is not.
    add(
      haul.optimizationStatus === 'unsolved'
        ? {
            id: 'earthwork-balance',
            group: 'earthwork',
            check: 'Earthwork balanced, or borrow and waste given a source',
            state: 'not-assessed',
            result: 'The material plan was not solved, so borrow and waste have no source or site yet',
            measured: balanceText,
            judgedOn: balanceLimit,
            action: { label: 'Haul', target: 'haul' },
          }
        : {
            id: 'earthwork-balance',
            group: 'earthwork',
            check: 'Earthwork balanced, or borrow and waste given a source',
            state: 'attention',
            severity: 'limit',
            result: 'The material plan is infeasible: the sites, capacities and rules entered cannot meet every demand',
            measured: balanceText,
            judgedOn: balanceLimit,
            action: { label: 'Haul', target: 'haul' },
          },
    )
  else if (haul?.enabled) {
    const open = haul.unallocatedBorrowM3 > EPS || haul.unallocatedWasteM3 > EPS
    const moved = `${num(haul.borrowCompactedM3)} m³ borrow${sites('borrow').length ? ` from ${sites('borrow').join(', ')}` : ''} · ${num(haul.wasteBankM3)} m³ waste${sites('waste').length ? ` to ${sites('waste').join(', ')}` : ''}`
    add(
      open
        ? {
            id: 'earthwork-balance',
            group: 'earthwork',
            check: 'Earthwork balanced, or borrow and waste given a source',
            state: 'attention',
            severity: 'limit',
            result: `${[
              haul.unallocatedBorrowM3 > EPS ? `${num(haul.unallocatedBorrowM3)} m³ of borrow has no source` : '',
              haul.unallocatedWasteM3 > EPS ? `${num(haul.unallocatedWasteM3)} m³ of waste has no site` : '',
            ]
              .filter(Boolean)
              .join(' and ')}`,
            measured: `${balanceText} · ${moved}`,
            judgedOn: balanceLimit,
            action: { label: 'Haul', target: 'haul' },
          }
        : {
            id: 'earthwork-balance',
            group: 'earthwork',
            check: 'Earthwork balanced, or borrow and waste given a source',
            state: 'met',
            result:
              haul.borrowCompactedM3 > EPS || haul.wasteBankM3 > EPS
                ? 'Borrow and waste are all allocated to sites'
                : 'Cut and fill balance along the road',
            measured: `${balanceText} · ${moved}`,
            judgedOn: balanceLimit,
          },
    )
  } else if (Math.abs(balance) <= tolerance)
    add({
      id: 'earthwork-balance',
      group: 'earthwork',
      check: 'Earthwork balanced, or borrow and waste given a source',
      state: 'met',
      result: 'Cut and fill balance within tolerance',
      measured: balanceText,
      judgedOn: balanceLimit,
    })
  else
    add({
      id: 'earthwork-balance',
      group: 'earthwork',
      check: 'Earthwork balanced, or borrow and waste given a source',
      state: 'attention',
      severity: 'limit',
      result:
        balance < 0
          ? `Fill is short by ${num(-balance)} m³ and no borrow source is set`
          : `${num(balance)} m³ of usable cut is left over and no waste site is set`,
      measured: balanceText,
      judgedOn: balanceLimit,
      action: { label: 'Haul', target: 'haul' },
    })

  const widths = stations
    .filter((s) => s.complete)
    .map((s) => ({ chainage: s.chainage, width: s.clearingWidthM ?? (s.leftDaylightM ?? 0) + (s.rightDaylightM ?? 0) }))
  const widest = widths.reduce<(typeof widths)[number] | null>(
    (best, item) => (!best || item.width > best.width ? item : best),
    null,
  )
  const clearingLimit = standards?.maxClearingWidthM ?? null
  const clearingText = widest
    ? `Widest ${widest.width.toFixed(1)} m at ${station(widest.chainage)} · average ${(analysis.completeLength > 0 ? analysis.clearingAreaM2 / analysis.completeLength : 0).toFixed(1)} m · ${num(analysis.clearingAreaM2)} m²`
    : undefined
  if (!widest || clearingLimit === null)
    add({
      id: 'clearing-width',
      group: 'earthwork',
      check: 'Clearing width within the limit',
      state: 'not-assessed',
      result: widest ? 'No clearing width limit is entered' : 'No sections to measure',
      measured: clearingText,
      judgedOn: 'Catch line to catch line, plus any preparation margin',
      action: widest ? { label: 'Set standards', target: 'standards' } : undefined,
    })
  else {
    const wide = ranges(
      stations.filter((s) => s.complete),
      (s) => (s.clearingWidthM ?? (s.leftDaylightM ?? 0) + (s.rightDaylightM ?? 0)) > clearingLimit + EPS,
    )
    add(
      wide.length
        ? {
            id: 'clearing-width',
            group: 'earthwork',
            check: 'Clearing width within the limit',
            state: 'attention',
            severity: 'limit',
            result: `Clearing is wider than ${trim(clearingLimit)} m in ${plural(wide.length, 'place')}`,
            measured: `${clearingText} · over at ${wide.slice(0, 3).map(span).join(', ')}${wide.length > 3 ? ` and ${wide.length - 3} more` : ''}`,
            judgedOn: `Clearing width limit ${trim(clearingLimit)} m`,
            action: { label: `Go to ${station(widest.chainage)}`, target: 'station', chainage: widest.chainage },
          }
        : {
            id: 'clearing-width',
            group: 'earthwork',
            check: 'Clearing width within the limit',
            state: 'met',
            result: `Clearing stays within ${trim(clearingLimit)} m`,
            measured: clearingText,
            judgedOn: `Clearing width limit ${trim(clearingLimit)} m`,
          },
    )
  }

  // ---- Water ---------------------------------------------------------------------------------
  const register = input.register ?? buildCrossingRegister({ alignment, analysis, context, drainage: input.drainage })
  const streams = context.filter((feature) => feature.kind === 'stream')
  const crossed = register.rows.filter((row) => row.mapped)
  const describe = (row: (typeof crossed)[number]) =>
    `${station(row.chainage)} ${row.name}: ${row.structure.kind === 'none' ? 'no structure' : `${row.structure.label}${row.structure.outstanding.length ? ` (${row.structure.outstanding.join(', ')})` : ''}`}`
  const sizedRule =
    'A structure at each crossing; a culvert counts as sized with both inverts and a current capacity check that passes'
  if (!streams.length)
    add({
      id: 'crossing-structures',
      group: 'water',
      check: 'Every stream crossing has a sized structure',
      state: 'not-assessed',
      result: 'No stream lines are in the project, so crossings cannot be found',
      judgedOn: sizedRule,
      action: { label: 'Add streams', target: 'streams' },
    })
  else if (!calculated)
    add({
      id: 'crossing-structures',
      group: 'water',
      check: 'Every stream crossing has a sized structure',
      state: 'not-assessed',
      result: 'No sections were calculated, so crossings were not found',
      judgedOn: sizedRule,
    })
  else if (!crossed.length)
    add({
      id: 'crossing-structures',
      group: 'water',
      check: 'Every stream crossing has a sized structure',
      state: 'met',
      result: `The road crosses none of the ${plural(streams.length, 'mapped stream')}`,
      judgedOn: sizedRule,
    })
  else {
    const bare = crossed.filter((row) => row.structure.kind === 'none')
    const unsized = crossed.filter((row) => row.structure.kind === 'culvert' && row.structure.sized === false)
    const external = crossed.filter((row) => row.structure.sized === null)
    const first = bare[0] ?? unsized[0]
    if (first)
      add({
        id: 'crossing-structures',
        group: 'water',
        check: 'Every stream crossing has a sized structure',
        state: 'attention',
        severity: 'limit',
        result: [
          bare.length ? `${plural(bare.length, 'crossing has', 'crossings have')} no structure` : '',
          unsized.length ? `${plural(unsized.length, 'culvert is', 'culverts are')} not sized` : '',
        ]
          .filter(Boolean)
          .join(' and '),
        measured: [...bare, ...unsized].slice(0, 3).map(describe).join(' · '),
        judgedOn: sizedRule,
        action: {
          label: bare.length ? 'Add culvert' : 'Size culvert',
          target: 'culverts',
          chainage: first.chainage,
        },
      })
    else if (external.length)
      add({
        id: 'crossing-structures',
        group: 'water',
        check: 'Every stream crossing has a sized structure',
        state: 'not-assessed',
        result: `${plural(external.length, 'crossing has', 'crossings have')} a recorded structure this workspace does not size`,
        measured: external.slice(0, 3).map(describe).join(' · '),
        judgedOn: sizedRule,
      })
    else
      add({
        id: 'crossing-structures',
        group: 'water',
        check: 'Every stream crossing has a sized structure',
        state: 'met',
        result: `${every(crossed.length, 'crossing has', 'crossings have')} a sized culvert`,
        measured: crossed.slice(0, 3).map(describe).join(' · '),
        judgedOn: sizedRule,
      })
  }

  const crossedStreams = [...new Map(crossed.map((row) => [row.mapped!.featureId, row])).values()]
  const unclassed = crossedStreams.filter((row) => row.classStatus !== 'reviewed')
  if (!streams.length)
    add({
      id: 'stream-class',
      group: 'water',
      check: 'Every crossed stream has a reviewed riparian class',
      state: 'not-assessed',
      result: 'No stream lines are in the project',
      action: { label: 'Add streams', target: 'streams' },
    })
  else if (!calculated)
    add({
      id: 'stream-class',
      group: 'water',
      check: 'Every crossed stream has a reviewed riparian class',
      state: 'not-assessed',
      result: 'No sections were calculated, so crossed streams were not found',
      judgedOn: 'A class S1 to S6 reviewed by a person (FPPR s. 47)',
    })
  else if (unclassed.length)
    add({
      id: 'stream-class',
      group: 'water',
      check: 'Every crossed stream has a reviewed riparian class',
      state: 'attention',
      severity: 'todo',
      result: `${unclassed.length} of ${plural(crossedStreams.length, 'crossed stream')} ${unclassed.length === 1 ? 'has' : 'have'} no reviewed class`,
      measured: unclassed
        .slice(0, 3)
        .map((row) => `${row.name}: ${STREAM_STATUS_LABELS[row.classStatus ?? 'unassessed'].toLowerCase()}`)
        .join(' · '),
      judgedOn: 'A class S1 to S6 reviewed by a person (FPPR s. 47)',
      action: { label: 'Classify', target: 'streams' },
    })
  else
    add({
      id: 'stream-class',
      group: 'water',
      check: 'Every crossed stream has a reviewed riparian class',
      state: 'met',
      result: crossedStreams.length
        ? `${every(crossedStreams.length, 'crossed stream has', 'crossed streams have')} a reviewed class`
        : 'No crossed streams',
      measured:
        crossedStreams
          .slice(0, 4)
          .map((row) => `${row.name}: ${row.riparianClass}`)
          .join(' · ') || undefined,
      judgedOn: 'A class S1 to S6 reviewed by a person (FPPR s. 47)',
    })

  const record = input.drainage?.record
  if (!record || input.drainage?.stale)
    add({
      id: 'drainage',
      group: 'water',
      check: 'Low points and modelled streams drained',
      state: 'not-assessed',
      result: record ? 'The drainage check is out of date' : 'The drainage check has not been run',
      measured: record ? 'The road, its culverts, the terrain or a limit changed since it ran' : undefined,
      judgedOn: 'A culvert at every modelled stream and ditch low point',
      action: { label: record ? 'Run again' : 'Run check', target: 'drainage' },
    })
  else {
    const flowsBare = register.rows.filter((row) => row.modelled && row.structure.kind === 'none').length
    const summary = record.summary
    const issues = [
      summary.lowPoints ? `${plural(summary.lowPoints, 'low point has', 'low points have')} no culvert` : '',
      flowsBare ? `${plural(flowsBare, 'modelled stream has', 'modelled streams have')} no culvert` : '',
      summary.redirected ? `${plural(summary.redirected, 'stream is', 'streams are')} carried along the road` : '',
      summary.undersized ? `${plural(summary.undersized, 'culvert is', 'culverts are')} undersized` : '',
    ].filter(Boolean)
    const measured = `${summary.crossings} modelled ${summary.crossings === 1 ? 'stream' : 'streams'} · ${plural(summary.lowPoints, 'unrelieved low point')} · ${num(summary.pondingAreaM2)} m² new ponding · ${summary.undersized} of ${plural(summary.culverts, 'culvert')} undersized`
    add(
      issues.length
        ? {
            id: 'drainage',
            group: 'water',
            check: 'Low points and modelled streams drained',
            state: 'attention',
            severity: 'limit',
            result: issues.slice(0, 2).join(' and ') + (issues.length > 2 ? `, and ${issues.length - 2} more` : ''),
            measured,
            judgedOn: 'A culvert at every modelled stream and ditch low point; none undersized',
            action: { label: 'Open drainage', target: 'drainage' },
          }
        : {
            id: 'drainage',
            group: 'water',
            check: 'Low points and modelled streams drained',
            state: 'met',
            result: 'Every modelled stream and low point has a culvert',
            measured,
            judgedOn: 'A culvert at every modelled stream and ditch low point; none undersized',
          },
    )
  }

  const drains = [...new Set((engineering?.culverts ?? []).map((c) => c.chainage))]
    .filter((chainage) => chainage >= -EPS && chainage <= analysis.length + EPS)
    .sort((a, b) => a - b)
  const edges = [0, ...drains, analysis.length]
  const runs = edges.slice(1).map((end, i) => ({ start: edges[i], end, length: end - edges[i] }))
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0])
  const spacingLimit = standards?.maxCrossDrainSpacingM ?? null
  const spacingText = `Longest run without a culvert ${num(longest.length)} m (${span(longest)}) · ${plural(drains.length, 'culvert')}`
  if (analysis.length <= EPS || spacingLimit === null)
    add({
      id: 'cross-drain-spacing',
      group: 'water',
      check: 'Cross-drain spacing within the limit',
      state: 'not-assessed',
      result: analysis.length > EPS ? 'No maximum spacing is entered' : 'No road to measure',
      measured: analysis.length > EPS ? spacingText : undefined,
      judgedOn: 'Runs are measured between culverts and from each road end',
      action: analysis.length > EPS ? { label: 'Set standards', target: 'standards' } : undefined,
    })
  else {
    const long = runs.filter((run) => run.length > spacingLimit + EPS)
    add(
      long.length
        ? {
            id: 'cross-drain-spacing',
            group: 'water',
            check: 'Cross-drain spacing within the limit',
            state: 'attention',
            severity: 'limit',
            result: `${plural(long.length, 'run is', 'runs are')} longer than ${trim(spacingLimit)} m without a culvert`,
            measured: spacingText,
            judgedOn: `Maximum spacing ${trim(spacingLimit)} m, between culverts and from each road end`,
            action: { label: 'Add culvert', target: 'culverts', chainage: (longest.start + longest.end) / 2 },
          }
        : {
            id: 'cross-drain-spacing',
            group: 'water',
            check: 'Cross-drain spacing within the limit',
            state: 'met',
            result: `No run is longer than ${trim(spacingLimit)} m without a culvert`,
            measured: spacingText,
            judgedOn: `Maximum spacing ${trim(spacingLimit)} m, between culverts and from each road end`,
          },
    )
  }

  const areas = context.filter((feature) => feature.kind === 'avoid' && feature.geometry.type === 'Polygon')
  const entered = new Map<string, { start: number; end: number }>()
  for (const s of stations)
    for (const flag of s.flags) {
      if (!flag.startsWith('Avoidance area: ')) continue
      const name = flag.slice('Avoidance area: '.length)
      const seen = entered.get(name)
      if (seen) seen.end = s.chainage
      else entered.set(name, { start: s.chainage, end: s.chainage })
    }
  if (!areas.length)
    add({
      id: 'constraints',
      group: 'water',
      check: 'Excluded and conditional areas kept clear',
      state: 'not-assessed',
      result: 'No constraint areas are in the project',
      judgedOn: 'Every sampled centreline station outside each excluded or unreviewed area',
      action: { label: 'Constraints', target: 'constraints' },
    })
  else if (!calculated)
    add({
      id: 'constraints',
      group: 'water',
      check: 'Excluded and conditional areas kept clear',
      state: 'not-assessed',
      result: 'No sections were calculated, so the areas were not tested',
      judgedOn: 'Every sampled centreline station outside each excluded or unreviewed area',
    })
  else if (entered.size) {
    const hits = [...entered.entries()].map(([name, range]) => {
      // Several areas can share a name; judge on the most restrictive.
      const resolved = areas.filter((area) => area.name === name).map(resolveConstraint)
      const blocked = resolved.some((item) => item.blocked) || !resolved.length
      const treatment = resolved.find((item) => item.blocked)?.policy.treatment ?? resolved[0]?.policy.treatment
      return { name, range, blocked, treatment }
    })
    const blocked = hits.filter((hit) => hit.blocked)
    add({
      id: 'constraints',
      group: 'water',
      check: 'Excluded and conditional areas kept clear',
      state: 'attention',
      severity: blocked.length ? 'limit' : 'todo',
      result: blocked.length
        ? `The road enters ${plural(blocked.length, 'excluded or unreviewed area')}`
        : `The road enters ${plural(hits.length, 'area')} that ${hits.length === 1 ? 'carries' : 'carry'} a cost or condition`,
      measured: hits
        .slice(0, 3)
        .map(
          (hit) =>
            `${hit.name} (${hit.treatment ? CONSTRAINT_LABELS[hit.treatment].toLowerCase() : 'excluded'}) at ${span(hit.range)}`,
        )
        .join(' · '),
      judgedOn: 'Every sampled centreline station outside each excluded or unreviewed area',
      action: { label: `Go to ${station(hits[0].range.start)}`, target: 'constraints', chainage: hits[0].range.start },
    })
  } else
    add({
      id: 'constraints',
      group: 'water',
      check: 'Excluded and conditional areas kept clear',
      state: 'met',
      result:
        areas.length === 1
          ? 'The centreline is clear of the 1 constraint area'
          : `The centreline is clear of all ${areas.length} constraint areas`,
      judgedOn: 'Every sampled centreline station outside each excluded or unreviewed area',
    })

  // ---- Cost ----------------------------------------------------------------------------------
  const rateFlags = costFlags('rates')
  const ratesText = `Cut ${money(settings.cutRate)}/m³ · fill ${money(settings.fillRate)}/m³ · surfacing ${money(settings.surfacingRate)}/m³ · clearing ${money(settings.clearingRate)}/m²`
  const RATE_NAMES = { cutRate: 'cut', fillRate: 'fill', surfacingRate: 'surfacing', clearingRate: 'clearing' }
  const rateNotes = [
    cost.placeholderRates.length
      ? `Still the starting value: ${cost.placeholderRates.map((key) => RATE_NAMES[key]).join(', ')}`
      : '',
    ...rateFlags
      .filter((flag) => flag.id !== 'placeholder-rates')
      .map((flag) => `${flag.label}: ${flag.detail.split('. ')[0]}`),
  ].filter(Boolean)
  // A rate is judged where it prices something: with no quantity, none is in use.
  const quantities =
    analysis.cutVolumeM3 + analysis.fillVolumeM3 + analysis.surfaceVolumeM3 + analysis.clearingAreaM2 > EPS
  add(
    !quantities
      ? {
          id: 'rates',
          group: 'cost',
          check: 'Unit rates entered for the work',
          state: 'not-assessed',
          result: 'No quantities were calculated, so no rate is in use',
          measured: ratesText,
          judgedOn: 'A rate that differs from the starting value, and no positive quantity priced at $0',
        }
      : rateFlags.length
        ? {
            id: 'rates',
            group: 'cost',
            check: 'Unit rates entered for the work',
            state: 'attention',
            severity: 'todo',
            result: cost.placeholderRates.length
              ? `${plural(cost.placeholderRates.length, 'rate is', 'rates are')} still the starting value`
              : rateFlags[0].label,
            measured: `${ratesText} · ${rateNotes.join(' · ')}`,
            judgedOn: 'A rate that differs from the starting value, and no positive quantity priced at $0',
            action: { label: 'Enter rates', target: 'rates' },
          }
        : {
            id: 'rates',
            group: 'cost',
            check: 'Unit rates entered for the work',
            state: 'met',
            result: 'Every base rate with a quantity has been entered',
            measured: ratesText,
            judgedOn: 'A rate that differs from the starting value, and no positive quantity priced at $0',
          },
  )

  const haulFlags = costFlags('haul')
  const hasEarthwork = analysis.cutVolumeM3 > EPS || analysis.fillVolumeM3 > EPS
  add(
    !hasEarthwork
      ? {
          id: 'haul',
          group: 'cost',
          check: 'Haul, borrow and waste priced',
          state: 'not-assessed',
          result: 'No earthwork was calculated',
        }
      : !engineering?.haul.enabled
        ? {
            id: 'haul',
            group: 'cost',
            check: 'Haul, borrow and waste priced',
            state: 'attention',
            severity: 'todo',
            result: 'Haul allocation is off: haul, borrow and waste add $0 to the estimate',
            measured: `${num(analysis.cutVolumeM3)} m³ cut and ${num(analysis.fillVolumeM3)} m³ fill are priced for excavation and placing only`,
            judgedOn: 'Haul allocation on, with sites, distances and rates',
            action: { label: 'Haul', target: 'haul' },
          }
        : haul?.optimizationStatus === 'unsolved'
          ? {
              id: 'haul',
              group: 'cost',
              check: 'Haul, borrow and waste priced',
              state: 'not-assessed',
              result: 'The material plan was not solved, so haul, borrow and waste are not priced',
              // The engine's own reason: which limit the allocation reached.
              measured:
                result?.warnings
                  .find((warning) => warning.startsWith('Material plan not solved: '))
                  ?.split(' The road, ')[0] ?? 'The allocation did not finish',
              judgedOn: 'Every movement beyond free haul and every borrow or waste volume has a price',
              action: { label: 'Haul', target: 'haul' },
            }
          : haulFlags.length
            ? {
                id: 'haul',
                group: 'cost',
                check: 'Haul, borrow and waste priced',
                state: 'attention',
                severity: 'todo',
                result: haulFlags[0].label,
                measured: haulFlags.map((flag) => flag.detail.split('. ')[0]).join(' · '),
                judgedOn: 'Every movement beyond free haul and every borrow or waste volume has a price',
                action: { label: 'Haul', target: 'haul' },
              }
            : {
                id: 'haul',
                group: 'cost',
                check: 'Haul, borrow and waste priced',
                state: 'met',
                result: 'Haul, borrow and waste are allocated and priced',
                measured: result
                  ? `Haul ${money(result.costs.haul)} · borrow ${money(result.costs.borrow)} · waste ${money(result.costs.waste)}`
                  : undefined,
                judgedOn: 'Every movement beyond free haul and every borrow or waste volume has a price',
              },
  )

  const culverts = engineering?.culverts ?? []
  const structureFlags = costFlags('structure-costs')
  // The unpriced culverts are named first in that prompt's detail; the count leads the row.
  const unpricedNames =
    structureFlags
      .find((flag) => flag.id === 'zero-culvert-rates')
      ?.detail.split('. ')[0]
      .split(', ') ?? []
  add(
    culverts.length && !(calculated && result)
      ? {
          // Entered culverts are priced by the calculation; without one there is no cost to read.
          id: 'structure-costs',
          group: 'cost',
          check: 'Structures priced',
          state: 'not-assessed',
          result: 'No structure cost was calculated',
          judgedOn: 'An installed price on every culvert and current crossing record',
        }
      : structureFlags.length
        ? {
            id: 'structure-costs',
            group: 'cost',
            check: 'Structures priced',
            state: 'attention',
            severity: 'todo',
            result: unpricedNames.length
              ? `${plural(unpricedNames.length, 'culvert has', 'culverts have')} no price`
              : structureFlags[0].label,
            measured:
              [
                unpricedNames.length ? `No price: ${unpricedNames.join(', ')}` : '',
                // The first prompt is the result when no culvert is unpriced; do not print it twice.
                ...structureFlags
                  .filter((flag) => flag.id !== 'zero-culvert-rates')
                  .slice(unpricedNames.length ? 0 : 1)
                  .map((flag) => flag.label),
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
            judgedOn: 'An installed price on every culvert and current crossing record',
            action: { label: 'Set price', target: 'culverts', chainage: culverts[0]?.chainage },
          }
        : culverts.length
          ? {
              id: 'structure-costs',
              group: 'cost',
              check: 'Structures priced',
              state: 'met',
              result: `${every(culverts.length, 'culvert has', 'culverts have')} a price`,
              measured: result ? `Structures ${money(result.costs.structures)}` : undefined,
              judgedOn: 'An installed price on every culvert and current crossing record',
            }
          : {
              id: 'structure-costs',
              group: 'cost',
              check: 'Structures priced',
              state: 'not-assessed',
              result: 'No structures are entered, so there is nothing to price',
              judgedOn: 'An installed price on every culvert and current crossing record',
            },
  )

  const mobilization = engineering?.haul.mobilizationCost ?? 0,
    contingency = engineering?.haul.contingencyPercent ?? 0
  add({
    id: 'allowances',
    group: 'cost',
    check: 'Mobilization and contingency set',
    ...(mobilization === 0 && contingency === 0
      ? {
          state: 'attention' as const,
          severity: 'todo' as const,
          result: 'Mobilization is $0 and contingency is 0%',
          action: { label: 'Haul & cost', target: 'haul' as const },
        }
      : { state: 'met' as const, result: 'Mobilization or contingency is entered' }),
    measured: `Mobilization ${money(mobilization)} · contingency ${trim(contingency)}%`,
    judgedOn: 'At least one of the two entered; zero for both is taken as not yet considered',
  })

  // A cost prompt this list has no row for still shows, so a new prompt is never silently dropped.
  for (const flag of cost.flags)
    if (!(flag.id in COST_FLAG_OWNERS))
      add({
        id: `cost-${flag.id}`,
        group: 'cost',
        check: flag.label,
        state: 'attention',
        severity: 'todo',
        result: flag.label,
        measured: flag.detail,
        // Material and haul settings are all one tab; the haul view holds allocation and its sites.
        action: { label: 'Engineering', target: 'haul' },
      })
  return rows
}

/**
 * The list and the crossing register for one road of a project, as the Review step shows them and the
 * report prints them. `drainageStale` comes from the caller, which knows whether a live run matches.
 */
export function projectReadiness(
  project: Pick<RoadProject, 'settings' | 'standards' | 'terrain' | 'context' | 'drainage'>,
  alignment: Alignment,
  analysis: RoadAnalysis,
  options: { drainageStale: boolean; vehicle?: VehicleFit | null },
): { rows: ReadinessRow[]; register: CrossingRegister } {
  const drainage = {
    record: project.drainage?.records.find((record) => record.alignmentId === alignment.id),
    stale: options.drainageStale,
  }
  // Rows that quote an input (the template, a culvert price) quote the one the results used.
  alignment = calculatedAlignment(alignment, analysis)
  const register = buildCrossingRegister({ alignment, analysis, context: project.context, drainage })
  return {
    register,
    rows: assessReadiness({
      settings: project.settings,
      standards: project.standards,
      terrain: project.terrain,
      context: project.context,
      alignment,
      analysis,
      cost: assessCostReadiness(analysis, alignment, project.settings),
      drainage,
      vehicle: options.vehicle,
      register,
    }),
  }
}

export function readinessCounts(rows: readonly ReadinessRow[]) {
  const count = (state: ReadinessState) => rows.filter((row) => row.state === state).length
  return {
    met: count('met'),
    attention: count('attention'),
    notAssessed: count('not-assessed'),
    limits: rows.filter((row) => row.state === 'attention' && row.severity === 'limit').length,
  }
}

/** "5 need attention · 4 not assessed · 14 met". */
export function readinessSummary(rows: readonly ReadinessRow[]): string {
  const counts = readinessCounts(rows)
  return `${counts.attention} need${counts.attention === 1 ? 's' : ''} attention · ${counts.notAssessed} not assessed · ${counts.met} met`
}

const html = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** The same list for the printed report, so the document says what was and was not checked. */
export function readinessReportHtml(rows: readonly ReadinessRow[]): string {
  if (!rows.length) return ''
  const body = (Object.keys(READINESS_GROUP_LABELS) as ReadinessGroup[])
    .flatMap((group) => {
      const members = rows.filter((row) => row.group === group)
      return members.length
        ? [
            `<tr><th colspan="4" style="text-align:left">${html(READINESS_GROUP_LABELS[group])}</th></tr>`,
            ...members.map(
              (row) =>
                `<tr><td style="text-align:left">${html(row.check)}</td><td style="text-align:left"><strong>${html(
                  row.state === 'attention' && row.severity === 'limit'
                    ? 'Needs attention: limit'
                    : READINESS_STATE_LABELS[row.state],
                )}</strong></td><td style="text-align:left">${html(row.result)}${row.measured ? `<br><span class="muted">${html(row.measured)}</span>` : ''}</td><td>${html(row.judgedOn ?? '')}</td></tr>`,
            ),
          ]
        : []
    })
    .join('')
  return `<h2>Readiness checks</h2><p>${html(readinessSummary(rows))}. Each check is judged on the project's own limits, listed in the last column. Met means the check was made and nothing is outstanding. Not assessed means the workspace could not make the check; it is not a pass. None of these certifies a road standard.</p><table><thead><tr><th style="text-align:left">Check</th><th style="text-align:left">State</th><th style="text-align:left">Result and measured value</th><th>Judged on</th></tr></thead><tbody>${body}</tbody></table>`
}
