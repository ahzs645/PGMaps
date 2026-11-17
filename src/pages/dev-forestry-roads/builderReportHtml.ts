/**
 * The builder's tables as report sections (`reportContents.ts`): the schedule of quantities with the
 * equipment assumed, the balance points on the zero balance line, the slope-stake book and the
 * clearing schedule. They print the same rows as the Stations and Quantities panes
 * (`builderSchedules.ts`, `quantitySchedule.ts`, `balanceLine.ts`). No DOM or network access.
 */
import { balanceWhatIf } from './balanceLine'
import {
  END_HAUL_DOWNSLOPE,
  END_HAUL_MIN_SECTION_M,
  END_HAUL_MIN_TRUCKED_M,
  endHaulEvidence,
  endHaulSections,
} from './endHaul'
import {
  RECORD_LEVEL_TOLERANCE_M,
  RECORD_PLAN_TOLERANCE_M,
  RECORD_SAMPLE_M,
  recordChanges,
  type RecordStretch,
} from './recordChanges'
import { roadSidehill } from './sectionSideSlope'
import { clearingSchedule, slopeStakeBook, stakeText } from './builderSchedules'
import { massHaulDiagram } from './massHaul'
import { quantitySchedule, taskQuantity } from './quantitySchedule'
import { STAKE_REASON_TEXT, stationExtras, type StationExtra, type ToGrid } from './stationExtras'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

const html = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const num = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: digits })
const signed = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}`

export interface BuilderReportContext {
  project: Pick<RoadProject, 'settings' | 'standards'>
  alignment: Alignment
  analysis: RoadAnalysis
  toGrid?: ToGrid | null
  /** Station label for a chainage, the report's own (named stationing where the road has it). */
  station: (chainage: number) => string
}

const extrasCache = new WeakMap<RoadAnalysis, StationExtra[]>()
function extrasFor(ctx: BuilderReportContext) {
  let extras = extrasCache.get(ctx.analysis)
  if (!extras) extrasCache.set(ctx.analysis, (extras = stationExtras(ctx.alignment, ctx.analysis, ctx.toGrid)))
  return extras
}

export function quantityScheduleReportHtml(ctx: BuilderReportContext): string {
  const lines = quantitySchedule(ctx.analysis, ctx.project.settings)
  const equipment = ctx.project.standards?.equipment ?? []
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="text-align:left">${html(l.item)}</td><td>${num(l.quantity, l.unit === 'ha' || l.unit === 'compacted per bank' ? 2 : 0)}</td><td style="text-align:left">${html(l.unit)}</td><td>${html(l.basis)}</td></tr>`,
    )
    .join('')
  const machines = equipment.length
    ? `<table><thead><tr><th style="text-align:left">Task</th><th style="text-align:left">Equipment</th><th>Works on</th><th>Notes</th></tr></thead><tbody>${equipment
        .map((e) => {
          const q = taskQuantity(e.task, lines)
          return `<tr><td style="text-align:left">${html(e.task)}</td><td style="text-align:left">${html(e.equipment || 'Not named')}</td><td>${q ? `${num(q.quantity, q.unit === 'ha' ? 2 : 0)} ${html(q.unit)}` : '—'}</td><td>${html(e.notes ?? '')}</td></tr>`
        })
        .join('')}</tbody></table>`
    : '<p class="muted">No construction equipment has been entered as assumed for moving material.</p>'
  return `<h2>Schedule of quantities</h2><table><thead><tr><th style="text-align:left">Item</th><th>Quantity</th><th style="text-align:left">Unit</th><th>Measured on</th></tr></thead><tbody>${rows}</tbody></table><h3>Equipment assumed for moving material</h3>${machines}`
}

export function balancePointsReportHtml(ctx: BuilderReportContext): string {
  const diagram = massHaulDiagram(ctx.analysis, ctx.alignment.engineering)
  if (diagram.balance.length < 2) return ''
  const freeHaul = ctx.alignment.engineering?.haul.freeHaulDistanceM ?? null
  const zero = balanceWhatIf(diagram.balance, 0, freeHaul)
  const rows = zero.loops
    .map(
      (l) =>
        `<tr><td>${html(ctx.station(l.start))}</td><td>${html(ctx.station(l.end))}</td><td>${l.direction === 'up-station' ? 'Up-station' : 'Down-station'}</td><td>${num(l.volumeM3, 0)}</td><td>${num(l.meanHaulM, 0)}</td><td>${freeHaul === null ? '—' : num(l.overhaulM3, 0)}</td><td>${l.open === null ? 'Balances' : l.open === 'both' ? 'Open both ends' : `Open at the ${l.open}`}</td></tr>`,
    )
    .join('')
  return `<h2>Balance points</h2><p>Loops on the zero balance line of the mass-haul diagram: between two balance points the cut fills the road there. A loop open at a road end is material that comes in (borrow) or leaves (waste) at that end.${freeHaul === null ? '' : ` Free haul ${num(freeHaul, 0)} m.`}</p><table><thead><tr><th>From</th><th>To</th><th>Moves</th><th>Volume m³</th><th>Mean haul m</th><th>Overhaul m³</th><th>Ends</th></tr></thead><tbody>${rows}<tr><td colspan="3"><strong>Total · balanced over ${num(zero.balancedLengthM, 0)} m</strong></td><td><strong>${num(zero.volumeM3, 0)}</strong></td><td>${zero.volumeM3 > 0 ? num(zero.haulM3m / zero.volumeM3, 0) : '—'}</td><td>${freeHaul === null ? '—' : num(zero.overhaulM3, 0)}</td><td></td></tr></tbody></table>`
}

export function slopeStakeReportHtml(ctx: BuilderReportContext, intervalM = 20): string {
  const book = slopeStakeBook(ctx.alignment, ctx.analysis, extrasFor(ctx), intervalM)
  const hinge = (c: StationExtra['catch']['left']) =>
    c ? `${c.hinge === 'ditch' ? 'D ' : ''}${c.hingeOffsetM.toFixed(1)}` : '—'
  const rows = book
    .map(
      ({ station: s, extra: e, reasons }) =>
        `<tr><td>${html(ctx.station(s.chainage))}</td><td>${html(
          reasons
            .filter((r) => r !== 'interval')
            .map((r) => STAKE_REASON_TEXT[r])
            .join(', '),
        )}</td><td>${html(stakeText(e.catch.left))}</td><td>${hinge(e.catch.left)}</td><td>${signed(e.centreDepthM)}</td><td>${num(s.designElevation, 2)}</td><td>${hinge(e.catch.right)}</td><td>${html(stakeText(e.catch.right))}</td><td>${signed(e.gradeLastPercent)}</td><td>${signed(e.gradeNextPercent)}</td></tr>`,
    )
    .join('')
  return `<h2>Slope-stake book</h2><p>Stations to stake as the Engineering Manual's Table 5-10 lists them: every ${intervalM} m, both ends, curve points (BC/EC, BVC/EVC), culverts and cuts or fills over 3 m. A stake reads cut (C) or fill (F) from the catch to the hinge (D: the ditch bottom, else the formation edge), then its distance from the centreline in metres. A guide only: stake from the field survey (§5.6.5).</p><table><thead><tr><th>Station</th><th>Why</th><th>Left stake</th><th>Hinge L m</th><th>CL C/F m</th><th>Formation m</th><th>Hinge R m</th><th>Right stake</th><th>Grade last %</th><th>Grade next %</th></tr></thead><tbody>${rows}</tbody></table>`
}

export function clearingReportHtml(ctx: BuilderReportContext, everyM = 20): string {
  const limit = ctx.project.standards?.maxClearingWidthM ?? null
  const rows = clearingSchedule(ctx.analysis, extrasFor(ctx), everyM, limit)
  const total = rows.reduce((sum, r) => sum + (r.areaM2 ?? 0), 0)
  const body = rows
    .map(
      ({ station: s, extra: e, areaM2, over }) =>
        `<tr><td>${html(ctx.station(s.chainage))}</td><td>${num(e.sidehillPercent, 0)}${e.uphill ? ` ${e.uphill === 'left' ? 'L' : 'R'}` : ''}</td><td>${num(s.leftWidth + s.rightWidth)}</td><td>${num(e.catch.left?.offsetM)}</td><td>${num(e.catch.right?.offsetM)}</td><td>${num(e.clearingM.left)}</td><td>${num(e.clearingM.right)}</td><td>${over ? `<strong>${num(e.clearingWidthM)}</strong>` : num(e.clearingWidthM)}</td><td>${num(areaM2, 0)}</td></tr>`,
    )
    .join('')
  return `<h2>Clearing schedule</h2><p>Clearing widths station by station (Engineering Manual §3.5.3), every ${everyM} m: clearing runs to each catch point plus the preparation margins. ${num(total / 10000, 2)} ha in all.${limit === null ? ' No clearing limit is entered.' : ` Widths over the ${num(limit)} m limit are bold.`}</p><table><thead><tr><th>Station</th><th>Sidehill %</th><th>Subgrade W m</th><th>Catch L m</th><th>Catch R m</th><th>Clear L m</th><th>Clear R m</th><th>Clear W m</th><th>Area since prev. m²</th></tr></thead><tbody>${body}<tr><td colspan="8"><strong>Total</strong></td><td><strong>${num(total, 0)}</strong></td></tr></tbody></table>`
}

export function endHaulReportHtml(ctx: BuilderReportContext): string {
  const sections = endHaulSections(ctx.analysis, ctx.alignment, roadSidehill(ctx.analysis.stations))
  const evidence = endHaulEvidence(ctx.analysis, ctx.alignment)
  const list = evidence
    .map(
      (e) =>
        `<li>${html(e.item)}: ${e.ready === null ? 'supply separately' : e.ready ? 'in this design' : 'not in this design'}</li>`,
    )
    .join('')
  const rule = `End haul qualifies under the Coast ECE procedures (Type 6, January 2025) where excess material is trucked at least ${END_HAUL_MIN_TRUCKED_M} m because it cannot be side-cast: natural downslope over ${END_HAUL_DOWNSLOPE.coast}% below the road prism or fill-unsuitable soil, a sensitive site, or unstable terrain identified by a terrain stability assessment. The Interior procedures (item E, July 2024) use ${END_HAUL_DOWNSLOPE.interior}% or a sensitive site. The reason is the designer's to state.`
  if (!ctx.analysis.engineering?.haul.enabled)
    return `<h2>End haul summary</h2><p>No haul allocation: turn haul on and enter spoil sites to set out the planned end haul.</p><p class="muted">${html(rule)}</p>`
  const total = sections.reduce((sum, s) => sum + s.bankM3, 0)
  const rows = sections
    .map(
      (s) =>
        `<tr><td>${html(ctx.station(s.start))}</td><td>${html(ctx.station(s.end))}</td><td>${num(s.lengthM)}</td><td>${num(s.bankM3, 0)}</td><td>${num(s.meanHaulM, 0)}</td><td>${html(s.destinations.join(', '))}</td><td>${num(s.steepestSidehillPercent, 0)}</td><td>${s.short ? `Under ${END_HAUL_MIN_SECTION_M} m long, or trucked under ${END_HAUL_MIN_TRUCKED_M} m` : ''}</td></tr>`,
    )
    .join('')
  return `<h2>End haul summary</h2><p>${sections.length ? `${sections.length} section${sections.length === 1 ? '' : 's'} truck ${num(total, 0)} bank m³ off the road, from the haul plan.` : 'The haul plan trucks no cut off the road.'} Bank volumes from the design, no swell applied.</p>${sections.length ? `<table><thead><tr><th>From</th><th>To</th><th>Length m</th><th>Bank m³</th><th>Mean haul m</th><th>To</th><th>Steepest sidehill %</th><th>Review</th></tr></thead><tbody>${rows}</tbody></table>` : ''}<p>Supporting evidence the procedures ask for:</p><ul>${list}</ul><p class="muted">${html(rule)}</p>`
}

export function recordChangesReportHtml(
  issued: { alignment: Alignment; analysis: RoadAnalysis } | null,
  record: { alignment: Alignment; analysis: RoadAnalysis },
  station: (chainage: number) => string,
  baselineName?: string,
): string {
  if (!issued)
    return baselineName
      ? `<h2>Record of changes</h2><p>The issued design (${html(baselineName)}) has no calculated results, so no comparison is printed.</p>`
      : ''
  const r = recordChanges(issued, record)
  const table = (items: RecordStretch[], what: string, signedValue: boolean) =>
    items.length
      ? `<table><thead><tr><th>From</th><th>To</th><th>Largest ${what} m</th></tr></thead><tbody>${items
          .map(
            (s) =>
              `<tr><td>${html(station(s.start))}</td><td>${html(station(s.end))}</td><td>${signedValue ? signed(s.maxM) : num(s.maxM, 2)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<p>No ${what} over the tolerance.</p>`
  return `<h2>Record of changes from the issued design</h2><p>Compares this road (the record) with ${html(issued.alignment.name)} (the design as issued), for the record drawings (Engineering Manual §5.2.4). Plan shifts over ${RECORD_PLAN_TOLERANCE_M} m and formation changes over ${RECORD_LEVEL_TOLERANCE_M} m are listed, sampled every ${RECORD_SAMPLE_M} m. It lists differences; conformance is the professional's to judge.</p><table><thead><tr><th style="text-align:left">Item</th><th>Issued</th><th>Record</th><th>Change</th></tr></thead><tbody>${r.rows
    .map(
      (row) =>
        `<tr><td style="text-align:left">${html(row.item)}</td><td>${html(row.issued)}</td><td>${html(row.record)}</td><td>${html(row.change)}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table><h3>Centreline shifts</h3>${table(r.planShifts, 'plan shift', false)}<h3>Formation level changes</h3>${table(r.levelChanges, 'level change', true)}<h3>Culverts</h3>${
    r.culverts.length
      ? `<table><thead><tr><th style="text-align:left">Culvert</th><th>Change</th></tr></thead><tbody>${r.culverts.map((c) => `<tr><td style="text-align:left">${html(c.name)}</td><td>${html(c.change)}</td></tr>`).join('')}</tbody></table>`
      : '<p>No culvert added, removed, moved or resized.</p>'
  }`
}
