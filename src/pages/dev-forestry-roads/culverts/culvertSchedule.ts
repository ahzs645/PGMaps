/**
 * The culvert schedule: one row per culvert of a road, holding three things kept apart on purpose.
 *
 * - **Construction cost**: the estimate's installed cost, or the crossing record that replaced it.
 * - **Appraisal treatment**: how the appraisal manual for the project's cost location treats it
 *   (`culvertAppraisal.ts`). Never added to, or taken from, the construction cost.
 * - **Design evidence**: its class, its checks against the Engineering Manual, and what was entered
 *   or modelled to support them.
 *
 * Derived and pure: it never edits the design. The editor, Review, the report and the CSV all read
 * these rows, so a figure cannot differ between them. Free of DOM and network access.
 */
import type { BankfullReading } from './naturalChannel'
import type { CostPlace } from '../costPlaces/places'
import { placeCurrency } from '../costPlaces/packs'
import { culvertCostDefaultStatus } from '../culvertCostDefaults'
import { CROSSING_STRUCTURES } from '../crossingPlan'
import type { DrainageEvidence } from '../drainageEvidence'
import { labelStation } from '../roadStationing'
import { templateAt } from '../templates'
import type { Alignment, Coordinate, Culvert, RoadAnalysis } from '../types'
import {
  APPRAISAL_TREATMENT_LABELS,
  appraisalPackForPlace,
  culvertAppraisalInput,
  culvertAppraisalTreatment,
  type AppraisalPackChoice,
  type AppraisalTreatmentKind,
  type CulvertAppraisalTreatment,
} from './culvertAppraisal'
import {
  culvertChecks,
  culvertHeadwaterFor,
  requiredCoverM,
  type CulvertCheckResult,
  type CulvertFlowCheck,
  type CulvertRun,
} from './culvertChecks'
import { classifyCulvert, type CulvertClass } from './culvertClass'
import {
  culvertEndDepths,
  outletHeadwaterRead,
  templateSurfacingM,
  type CulvertEndDepths,
  type CulvertHeadwater,
} from './culvertHeadwater'
import {
  CULVERT_SHAPES,
  culvertBarrels,
  culvertPurposeOf,
  culvertShapeOf,
  culvertSizeText,
  type CulvertPurpose,
} from './culvertShape'
import { CULVERT_MATERIALS } from './engineeringManual'

export interface CulvertScheduleRow {
  id: string
  name: string
  chainage: number
  purpose: CulvertPurpose
  /** "Ø 1.2 m", "2 × Ø 0.9 m", "Box 2.4 × 1.2 m". */
  sizeText: string
  shapeLabel: string
  materialLabel: string | null
  barrels: number
  spanLengthM: number
  /** Inclined barrel length; null until both inverts are entered. */
  barrelLengthM: number | null
  skewDegrees: number
  /** Fall from inlet to outlet, %; null without both inverts. */
  fallPercent: number | null
  /** The same fall as "1 in X": horizontal span over the drop. Null without a falling pipe. */
  fallOneIn: number | null
  /** Ground less the invert at each end, and the road surface over the centreline less the invert there, m. */
  depthToInvert: CulvertEndDepths
  inletInvertM: number | null
  outletInvertM: number | null
  /** Barrel ends on the ground; null for a culvert the calculation left out. */
  inlet: Coordinate | null
  outlet: Coordinate | null
  coverM: number | null
  requiredCoverM: number
  flow: CulvertFlowCheck | null
  /**
   * Inlet- and outlet-control headwater, the governing control, freeboard to the road over the barrel
   * and the suggested stock size (`culvertHeadwater.ts`). The checks judge them; these are the figures.
   */
  headwater: CulvertHeadwater
  cost: {
    /** The estimate's installed cost for this culvert, CAD; null for a culvert the calculation left out. */
    installedCad: number | null
    /** A current crossing record's itemized estimate stands in place of the installed cost. */
    replacedByCrossingRecord: boolean
    /** The amount still carries an unreviewed default origin, including after a manual edit. */
    provisional?: boolean
    /** "Installed cost", "Replaced by the crossing record's estimate", "No price entered". */
    basis: string
  }
  /** Null where the project's cost location has no appraisal rules. */
  appraisal: CulvertAppraisalTreatment | null
  class: CulvertClass
  checks: CulvertCheckResult[]
  /** What supports the design, in the reader's words. */
  evidence: string[]
}

export interface CulvertSchedule {
  rows: CulvertScheduleRow[]
  appraisal: AppraisalPackChoice | null
  drainage: 'current' | 'stale' | 'not-run'
  totals: {
    /** Installed cost of the culverts the estimate prices itself, CAD. */
    installedCad: number
    /** Sum of the single-entry table allowances, CAD: an appraisal figure, never a cost. */
    tableAllowanceCad: number
    treatments: Record<AppraisalTreatmentKind, number>
    major: number
  }
}

export interface CulvertScheduleInput {
  /** The road; with its `template`, the surfacing over the subgrade lifts the subgrade to the road surface. */
  alignment: Pick<Alignment, 'engineering'> & Partial<Alignment>
  analysis: Pick<RoadAnalysis, 'engineering' | 'stations' | 'crossingEstimate'> | null | undefined
  /** The project's cost location; undefined reads the default manual and says so. */
  place: CostPlace | undefined
  drainage?: { record?: DrainageEvidence; stale: boolean }
  /**
   * Each stream culvert's channel by culvert id (`culvertChannels`): the recorded width and any
   * terrain reading. Omitted, the schedule prints no channel checks, exactly as before.
   */
  channels?: ReadonlyMap<string, { recordedWidthM: number | null; reading: BankfullReading | null }>
}

function flowChecks(record: DrainageEvidence | undefined): Map<string, CulvertFlowCheck> {
  const checks = new Map<string, CulvertFlowCheck>()
  for (const feature of record?.features.features ?? []) {
    const p = feature.properties ?? {}
    if (
      p.role === 'culvert-check' &&
      typeof p.id === 'string' &&
      typeof p.designFlowM3s === 'number' &&
      typeof p.capacityM3s === 'number' &&
      typeof p.slope === 'number'
    )
      checks.set(p.id, {
        designFlowM3s: p.designFlowM3s,
        capacityM3s: p.capacityM3s,
        adequate: p.adequate === true,
        slope: p.slope,
        slopeAssumed: p.slopeAssumed === true,
        ...(typeof p.tcMin === 'number' && typeof p.intensityMmPerHr === 'number'
          ? {
              timing: {
                tcMin: p.tcMin,
                intensityMmPerHr: p.intensityMmPerHr,
                returnPeriodYears: typeof p.returnPeriodYears === 'number' ? p.returnPeriodYears : null,
                idf: typeof p.idf === 'string' ? p.idf : 'IDF curve',
              },
            }
          : {}),
      })
  }
  return checks
}

/** The thinner side's surfacing at `chainage`, m; null where the road's template is not given. */
function surfacingAt(alignment: CulvertScheduleInput['alignment'], chainage: number): number | null {
  if (!alignment.template) return null
  const template = templateAt(alignment as Alignment, chainage).template
  return Math.min(templateSurfacingM(template, 'left'), templateSurfacingM(template, 'right'))
}

/** The road's design grade at the calculated station nearest `chainage`, %. */
function roadGradeAt(stations: RoadAnalysis['stations'] | undefined, chainage: number): number | null {
  if (!stations?.length) return null
  const nearest = stations.reduce((best, station) =>
    Math.abs(station.chainage - chainage) < Math.abs(best.chainage - chainage) ? station : best,
  )
  return nearest.gradePercent
}

export function buildCulvertSchedule({
  alignment,
  analysis,
  place,
  drainage,
  channels,
}: CulvertScheduleInput): CulvertSchedule {
  const record = drainage?.record
  const state: CulvertSchedule['drainage'] = !record ? 'not-run' : drainage?.stale ? 'stale' : 'current'
  const flows = state === 'current' ? flowChecks(record) : new Map<string, CulvertFlowCheck>()
  const choice = appraisalPackForPlace(place)
  const estimate = analysis?.crossingEstimate
  const culverts: readonly Culvert[] = alignment.engineering?.culverts ?? []

  // Runs of road with no culvert in them, for the spacing note: each culvert reads the longer of its two.
  const placed = [...culverts].sort((a, b) => a.chainage - b.chainage)
  const roadLength = analysis?.stations?.length ? analysis.stations[analysis.stations.length - 1].chainage : null
  const runBeside = (culvert: Culvert): CulvertRun | undefined => {
    if (roadLength === null) return undefined
    const at = placed.indexOf(culvert)
    const before = placed[at - 1],
      after = placed[at + 1]
    const runs = [
      { from: before?.chainage ?? 0, to: culvert.chainage, name: before?.name ?? 'the road start' },
      { from: culvert.chainage, to: after?.chainage ?? roadLength, name: after?.name ?? 'the road end' },
    ]
    const longer = runs[0].to - runs[0].from >= runs[1].to - runs[1].from ? runs[0] : runs[1]
    let steepest: number | null = null
    for (const station of analysis!.stations)
      if (station.chainage >= longer.from && station.chainage <= longer.to && station.gradePercent !== null)
        steepest =
          steepest === null || Math.abs(station.gradePercent) > Math.abs(steepest) ? station.gradePercent : steepest
    return { lengthM: Math.max(0, longer.to - longer.from), to: longer.name, steepestGradePercent: steepest }
  }

  const rows = culverts.map((culvert): CulvertScheduleRow => {
    const result = analysis?.engineering?.culverts.find((item) => item.id === culvert.id)
    const flow = flows.get(culvert.id) ?? null
    const replaced = !!estimate?.replacedLegacyIds.includes(culvert.id)
    const costDefault = !replaced ? culvertCostDefaultStatus(culvert, placeCurrency(place)) : null
    const crossingRecord = estimate?.rows.find(
      (row) => row.status === 'current' && row.record.replacesCulvertId === culvert.id,
    )?.record
    const embeddedStructure = crossingRecord?.structure === 'embedded-culvert'
    const shape = culvertShapeOf(culvert)
    const known = culvert.inletInvertM !== null && culvert.outletInvertM !== null
    const surfacingM = result ? surfacingAt(alignment, culvert.chainage) : null
    const checkInput = {
      culvert,
      analysis: result,
      roadGradePercent: roadGradeAt(analysis?.stations, culvert.chainage),
      drainage: {
        state,
        check: flow ?? undefined,
        rainfallMmPerHr: record?.settings?.rainfallMmPerHr,
        manningN: record?.settings?.manningN,
      },
      surfacingM,
      embeddedStructure,
      adjacentRun: runBeside(culvert),
      ...(channels?.has(culvert.id)
        ? {
            channel: {
              ...channels.get(culvert.id)!,
              major: classifyCulvert(culvert, flow?.designFlowM3s ?? null).major ?? undefined,
            },
          }
        : {}),
    }
    const checks = culvertChecks(checkInput)
    const fallPercent = known ? ((culvert.inletInvertM! - culvert.outletInvertM!) / culvert.lengthM) * 100 : null
    const evidence: string[] = [
      known ? 'Both inverts entered' : 'Inverts not entered',
      flow
        ? `Drainage check: peak ${flow.designFlowM3s.toFixed(3)} m³/s`
        : state === 'stale'
          ? 'Drainage check out of date'
          : state === 'not-run'
            ? 'No drainage check'
            : 'Drainage check did not reach this culvert',
    ]
    if (crossingRecord)
      evidence.push(
        `Crossing record: ${CROSSING_STRUCTURES.find((item) => item.value === crossingRecord.structure)?.label ?? 'structure'}${crossingRecord.evidence.trim() ? `, ${crossingRecord.evidence.trim()}` : ''}`,
      )
    return {
      id: culvert.id,
      name: culvert.name,
      chainage: culvert.chainage,
      purpose: culvertPurposeOf(culvert),
      sizeText: culvertSizeText(culvert),
      shapeLabel: CULVERT_SHAPES.find((item) => item.value === shape)!.label,
      materialLabel: CULVERT_MATERIALS.find((item) => item.value === culvert.material)?.label ?? null,
      barrels: culvertBarrels(culvert),
      spanLengthM: culvert.lengthM,
      barrelLengthM: result?.barrelLengthM ?? null,
      skewDegrees: culvert.skewDegrees,
      fallPercent,
      fallOneIn: fallPercent !== null && fallPercent > 0 ? 100 / fallPercent : null,
      depthToInvert: culvertEndDepths(result?.profile, culvert.lengthM, surfacingM),
      inletInvertM: culvert.inletInvertM,
      outletInvertM: culvert.outletInvertM,
      inlet: result?.start ?? null,
      outlet: result?.end ?? null,
      coverM: result?.coverM ?? null,
      requiredCoverM: requiredCoverM(culvert),
      flow,
      headwater: culvertHeadwaterFor(checkInput),
      cost: {
        installedCad: result?.installedCost ?? null,
        replacedByCrossingRecord: replaced,
        ...(costDefault ? { provisional: true } : {}),
        basis: [
          !result
            ? 'Not calculated'
            : replaced
              ? 'Replaced by the crossing record’s itemized estimate'
              : result.installedCost === 0
                ? 'No price entered'
                : 'Installed cost per metre plus fixed cost',
          costDefault?.summary,
        ]
          .filter(Boolean)
          .join('. '),
      },
      appraisal: choice
        ? culvertAppraisalTreatment(
            culvertAppraisalInput(culvert, result?.barrelLengthM, embeddedStructure),
            choice.pack,
          )
        : null,
      class: classifyCulvert(culvert, flow?.designFlowM3s ?? null),
      checks,
      evidence,
    }
  })
  rows.sort((a, b) => a.chainage - b.chainage)

  const treatments: Record<AppraisalTreatmentKind, number> = {
    'in-subgrade': 0,
    table: 0,
    'engineered-estimate': 0,
    'not-determined': 0,
  }
  let installedCad = 0,
    tableAllowanceCad = 0,
    major = 0
  for (const row of rows) {
    if (row.appraisal) treatments[row.appraisal.kind] += 1
    if (!row.cost.replacedByCrossingRecord) installedCad += row.cost.installedCad ?? 0
    tableAllowanceCad += row.appraisal?.allowanceCad ?? 0
    if (row.class.major) major += 1
  }
  return {
    rows,
    appraisal: choice,
    drainage: state,
    totals: { installedCad, tableAllowanceCad, treatments, major },
  }
}

/** "2 in the subgrade allowance · 1 table allowance · 1 engineered estimate". */
export function culvertTreatmentSummary(schedule: CulvertSchedule): string {
  if (!schedule.appraisal) return 'No appraisal rules for this cost location'
  const parts = (Object.keys(schedule.totals.treatments) as AppraisalTreatmentKind[])
    .filter((kind) => schedule.totals.treatments[kind])
    .map((kind) => `${schedule.totals.treatments[kind]} ${APPRAISAL_TREATMENT_LABELS[kind].toLowerCase()}`)
  return parts.join(' · ') || 'No culverts'
}

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'number' ? String(Number(value.toFixed(6))) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Outlet control's headwater as the checks read it: full flow from 0.75D up, the backwater profile below. */
function outletRead(h: CulvertHeadwater) {
  if (!h.outlet) return null
  const read = outletHeadwaterRead(h.outlet)
  return read && read !== 'steep' ? read : null
}

/** How outlet control was read: `full flow`, `backwater`, `steep barrel` (the outlet does not control), or blank. */
function outletMethodText(h: CulvertHeadwater): string {
  if (!h.outlet) return ''
  const read = outletHeadwaterRead(h.outlet)
  return read === 'steep'
    ? 'steep barrel'
    : read === null
      ? ''
      : read.method === 'backwater'
        ? 'backwater'
        : 'full flow'
}

export const CULVERT_SCHEDULE_COLUMNS = [
  'station',
  'station_m',
  'name',
  'purpose',
  'shape',
  'size',
  'barrels',
  'material',
  'span_m',
  'barrel_length_m',
  'skew_deg',
  'fall_percent',
  'inlet_invert_m',
  'outlet_invert_m',
  'inlet_lon',
  'inlet_lat',
  'outlet_lon',
  'outlet_lat',
  'cover_m',
  'required_cover_m',
  'design_peak_m3s',
  'capacity_m3s',
  'construction_cost_cad',
  'construction_cost_basis',
  'appraisal_manual',
  'appraisal_treatment',
  'appraisal_allowance_cad',
  'appraisal_low_cad',
  'appraisal_high_cad',
  'appraisal_reference',
  'appraisal_reasons',
  'major_culvert',
  'checks_not_met',
  'checks_not_assessed',
  'evidence',
  // Added after the original columns so none of those moves.
  'fall_one_in',
  'inlet_depth_to_invert_m',
  'outlet_depth_to_invert_m',
  'road_surface_over_invert_m',
  'inlet_control_hw_m',
  'outlet_control_hw_m',
  'outlet_control_method',
  'governing_control',
  'governing_hw_m',
  'governing_hw_over_d',
  'headwater_elevation_m',
  'road_surface_low_m',
  'freeboard_m',
  'suggested_diameter_m',
] as const

/**
 * The schedule as CSV. `station` is the road's own station name; `station_m` is chainage. The
 * appraisal columns are the manual's figures on its cost base and are not part of the estimate.
 */
export function culvertScheduleCsv(schedule: CulvertSchedule): string {
  const lines = [CULVERT_SCHEDULE_COLUMNS.join(',')]
  for (const row of schedule.rows) {
    const failing = (state: CulvertCheckResult['state']) =>
      row.checks
        .filter((check) => check.state === state)
        .map((check) => `${check.label}: ${check.result}`)
        .join('; ')
    lines.push(
      [
        labelStation(row.chainage),
        row.chainage,
        row.name,
        row.purpose,
        row.shapeLabel,
        row.sizeText,
        row.barrels,
        row.materialLabel,
        row.spanLengthM,
        row.barrelLengthM,
        row.skewDegrees,
        row.fallPercent,
        row.inletInvertM,
        row.outletInvertM,
        row.inlet?.[0],
        row.inlet?.[1],
        row.outlet?.[0],
        row.outlet?.[1],
        row.coverM,
        row.requiredCoverM,
        row.flow?.designFlowM3s,
        row.flow?.capacityM3s,
        row.cost.replacedByCrossingRecord ? null : row.cost.installedCad,
        row.cost.basis,
        row.appraisal?.manual,
        row.appraisal ? APPRAISAL_TREATMENT_LABELS[row.appraisal.kind] : 'No appraisal rules for this cost location',
        row.appraisal?.allowanceCad,
        row.appraisal?.between?.lowCad,
        row.appraisal?.between?.highCad,
        row.appraisal?.locator,
        row.appraisal?.reasons.join(' '),
        row.class.major === null ? 'not known' : row.class.major ? 'yes' : 'no',
        failing('not-met'),
        failing('not-assessed'),
        row.evidence.join('; '),
        row.fallOneIn,
        row.depthToInvert.inletM,
        row.depthToInvert.outletM,
        row.depthToInvert.roadM,
        row.headwater.inlet?.headwaterM,
        outletRead(row.headwater)?.headwaterM,
        outletMethodText(row.headwater),
        row.headwater.governing?.control ?? 'not determined',
        row.headwater.governing?.headwaterM,
        row.headwater.governing?.hwOverD,
        row.headwater.elevationM,
        row.headwater.road?.lowestSurfaceM,
        row.headwater.freeboardM,
        row.headwater.suggested?.diameterM,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\n') + '\n'
}

const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

/** "1 in 40" for a fall of 2.5 %: whole numbers from 1 in 10, one decimal below. */
export const fallOneInText = (oneIn: number) => `1 in ${trim(oneIn, oneIn >= 10 ? 0 : 1)}`

/**
 * One line of the row's hydraulic figures, for the editor and the report: fall, depth to invert,
 * the headwater by each control, freeboard and the suggested size. Empty where none is known.
 */
export function culvertHydraulicsText(row: CulvertScheduleRow): string {
  const parts: string[] = []
  if (row.fallOneIn !== null && row.fallPercent !== null)
    parts.push(`Falls ${fallOneInText(row.fallOneIn)} (${trim(row.fallPercent)}%)`)
  const d = row.depthToInvert
  const depths = [
    d.inletM === null ? '' : `inlet ${trim(d.inletM)} m`,
    d.outletM === null ? '' : `outlet ${trim(d.outletM)} m`,
    d.roadM === null ? '' : `road ${trim(d.roadM)} m`,
  ].filter(Boolean)
  if (depths.length) parts.push(`depth to invert: ${depths.join(', ')}`)
  const h = row.headwater
  if (h.inlet || h.outlet)
    parts.push(
      `headwater: inlet control ${h.inlet ? `${trim(h.inlet.headwaterM)} m` : 'not worked out'}, outlet control ${
        !h.outlet
          ? 'not worked out'
          : outletMethodText(h) === 'steep barrel'
            ? 'does not apply (steep barrel)'
            : outletRead(h)
              ? `${trim(outletRead(h)!.headwaterM)} m${outletMethodText(h) === 'backwater' ? ' by backwater' : ''}${h.outlet.tailwaterKnown ? '' : ' (tailwater not known)'}`
              : 'not worked out'
      }${h.governing ? `; ${h.governing.control} control governs` : ''}`,
    )
  if (h.freeboardM !== null) parts.push(`freeboard ${trim(h.freeboardM)} m`)
  if (h.suggested) parts.push(`suggested by headwater: Ø ${trim(h.suggested.diameterM * 1000, 0)} mm`)
  if (!parts.length) return ''
  const text = parts.join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const WHOLE = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const money = (value: number) => '$' + WHOLE.format(value)

/** The schedule for the printed report, under the heading "Culvert schedule". */
export function culvertScheduleReportHtml(schedule: CulvertSchedule): string {
  if (!schedule.rows.length) return ''
  const basis = schedule.appraisal
    ? `Appraisal treatment is read from the ${schedule.appraisal.pack.manual}, ${schedule.appraisal.pack.edition}, on a ${schedule.appraisal.pack.costBaseYear} cost base. ${schedule.appraisal.basis} It says how the appraisal costs each culvert; it is not the price of building one and is not part of this estimate.`
    : 'The project’s cost location has no appraisal rules in this workspace, so no appraisal treatment is shown.'
  const body = schedule.rows
    .map((row) => {
      const notMet = row.checks.filter((check) => check.state === 'not-met')
      const open = row.checks.filter((check) => check.state === 'not-assessed')
      const cost = row.cost.replacedByCrossingRecord
        ? 'Crossing record'
        : row.cost.installedCad === null
          ? 'Not calculated'
          : row.cost.installedCad === 0
            ? 'No price'
            : money(row.cost.installedCad)
      const design = [
        row.class.major ? row.class.summary : '',
        ...notMet.map((check) => `${check.label}: ${check.result}`),
        open.length ? `Not assessed: ${open.map((check) => check.label.toLowerCase()).join('; ')}` : '',
      ].filter(Boolean)
      const hydraulics = culvertHydraulicsText(row)
      return `<tr><td>${escapeHtml(labelStation(row.chainage))}</td><td style="text-align:left">${escapeHtml(row.name)}<br><span class="muted">${escapeHtml(row.purpose === 'stream' ? 'Stream' : 'Cross-drain')}</span></td><td style="text-align:left">${escapeHtml(row.sizeText)} × ${escapeHtml((row.barrelLengthM ?? row.spanLengthM).toFixed(1))} m${row.materialLabel ? `<br><span class="muted">${escapeHtml(row.materialLabel)}</span>` : ''}</td><td>${escapeHtml(cost)}${row.cost.provisional ? `<br><span class="muted">${escapeHtml(row.cost.basis)}</span>` : ''}</td><td style="text-align:left">${escapeHtml(row.appraisal?.summary ?? 'Not shown')}${row.appraisal ? `<br><span class="muted">${escapeHtml(row.appraisal.locator)}</span>` : ''}</td><td style="text-align:left">${design.length ? design.map(escapeHtml).join('<br>') : 'Checks met'}${hydraulics ? `<br>${escapeHtml(hydraulics)}` : ''}<br><span class="muted">${escapeHtml(row.evidence.join('; '))}</span></td></tr>`
    })
    .join('')
  return `<h2>Culvert schedule</h2><p>${escapeHtml(basis)}</p><table><thead><tr><th>Station</th><th style="text-align:left">Culvert</th><th style="text-align:left">Size</th><th>Construction cost</th><th style="text-align:left">Appraisal treatment</th><th style="text-align:left">Design checks and evidence</th></tr></thead><tbody>${body}</tbody></table><p class="muted">Design checks follow BC’s Engineering Manual and Fish-stream Crossing Guidebook as screens; they are not a hydrotechnical or fish-passage design. ${escapeHtml(culvertTreatmentSummary(schedule))}.</p>`
}
