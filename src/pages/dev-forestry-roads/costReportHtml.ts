/**
 * The report's cost parts beyond the base rates: the project's cost location, where each adopted
 * rate came from (its frozen terms, basis, included work and overlaps), the saved build-ups, the
 * project budget with its unassessed items, the lifecycle costs, and the stated scenario bounds.
 * Free of DOM and network access.
 */
import { rateSourceLines } from './costEvidence/rateAdoption'
import { calculateBuildUp, BUILD_UP_KINDS } from './costEvidence/rateBuildUps'
import { placeLabel } from './costPlaces/packs'
import { projectCurrency } from './costPlaces/projectLocation'
import { SCHEDULE_BASES, SCHEDULE_GROUPS, SCHEDULE_STATUSES, type ScheduleGroup } from './costSchedule'
import { SCENARIO_DRIVERS, type ScenarioDriverId } from './costScenarios'
import { projectBudget } from './projectBudget'
import type { RoadAnalysis, RoadProject } from './types'

const html = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const money = (value: number) => `$${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

/** `<dt>/<dd>` rows for the cost-assumptions list. */
export function costAssumptionRowsHtml(project: RoadProject): string {
  const currency = projectCurrency(project.costLocation)
  const location = project.costLocation
    ? `${html(placeLabel(project.costLocation.place))} · amounts in ${currency} · ${
        project.costLocation.basis === 'road-location' ? 'accepted from the road’s location' : 'chosen'
      } ${html(project.costLocation.setOn)}`
    : 'Not set. Evidence is not ordered by place, and amounts are read as CAD.'
  const lines = rateSourceLines(project.rateEvidence, project, projectBudgetPackItems(project))
  const sources = lines.length
    ? `<dt>Rate sources</dt><dd data-rate-sources>${lines
        .map(
          (line) =>
            `<div data-rate-source="${html(line.rateKey)}">${html(line.adopted)} adopted ${html(line.adoptedOn)} from ${html(line.observed)} (${html(line.source)}${line.url ? `; <a href="${html(line.url)}">${html(line.url)}</a>` : ''}${line.locator ? `; ${html(line.locator)}` : ''}). Adjustment: ${html(line.reason)}${line.scope ? ` ${html(line.scope)}.` : ''}${line.terms.length ? ` Terms as read: ${html(line.terms.join('; '))}.` : ''}${line.overlaps.length ? ` <strong>Overlap accounted for: ${html(line.overlaps.join(' '))}</strong>` : ''}${[
              line.edited,
              line.orphaned,
              line.stale,
            ]
              .filter(Boolean)
              .map((note) => ` <strong>${html(note)}</strong>`)
              .join('')}</div>`,
        )
        .join(
          '',
        )} No currency conversion or escalation is computed; each adopted rate is the estimator’s own figure.</dd>`
    : ''
  const buildUps = project.rateBuildUps?.length
    ? `<dt>Rate build-ups</dt><dd data-rate-build-ups>${project.rateBuildUps
        .map((buildUp) => {
          const { formula } = calculateBuildUp(buildUp)
          return `<div>${html(buildUp.name)} (${html(BUILD_UP_KINDS[buildUp.kind].label)}): ${html(formula)}${buildUp.quote ? `; inputs from ${html(buildUp.quote)}` : ''}</div>`
        })
        .join('')}</dd>`
    : ''
  const drivers = Object.entries(project.costScenarios?.drivers ?? {}) as [
    ScenarioDriverId,
    { low: number; high: number },
  ][]
  const scenarios = drivers.length
    ? `<dt>Cost scenario bounds</dt><dd data-cost-scenarios>${drivers
        .map(([id, range]) => `${html(SCENARIO_DRIVERS[id].label)} × ${range.low} low, × ${range.high} high`)
        .join(
          '; ',
        )}. Stated bounds, not a confidence interval.${project.costScenarios?.note ? ` ${html(project.costScenarios.note)}` : ''}</dd>`
    : ''
  return `<dt>Cost location</dt><dd data-cost-location>${location}</dd>${sources}${buildUps}${scenarios}`
}

const projectBudgetPackItems = (project: RoadProject) =>
  projectBudget(project, { estimatedCost: 0, length: 0, engineering: undefined }).packItems

/** The project budget chapter: construction, project items by group, unassessed scope, lifecycle. */
export function projectBudgetReportHtml(project: RoadProject, analysis: RoadAnalysis): string {
  const { rows, summary } = projectBudget(project, analysis)
  const currency = projectCurrency(project.costLocation)
  const groups = Object.keys(SCHEDULE_GROUPS) as ScheduleGroup[]
  const table = groups
    .map((group) => {
      const inGroup = rows.filter((row) => row.group === group)
      return inGroup
        .map((row, index) => {
          const detail =
            row.status === 'included'
              ? (row.derived ?? row.entry?.includedIn ?? '')
              : row.status === 'excluded'
                ? (row.entry?.reason ?? '')
                : row.amount !== null
                  ? `${row.basis === 'percent' ? `${row.entry?.percent}% of construction` : row.basis === 'per-km' ? `${money(row.entry?.amount ?? 0)}${SCHEDULE_BASES['per-km'].unit}` : 'Lump sum'}${row.recurrence ? `, year ${row.recurrence.firstYear}${row.recurrence.everyYears ? ` then every ${row.recurrence.everyYears} years` : ''}` : ''}${row.entry?.source ? `; ${row.entry.source}` : ''}`
                  : ''
          return `<tr data-budget-row="${html(row.id)}"><td style="text-align:left">${index === 0 ? html(SCHEDULE_GROUPS[group].label) : ''}</td><td style="text-align:left">${html(row.label)}</td><td style="text-align:left">${html(SCHEDULE_STATUSES[row.status].label)}</td><td>${row.amount === null ? '—' : money(row.amount)}</td><td>${html(detail)}</td></tr>`
        })
        .join('')
    })
    .join('')
  const life = summary.lifecycle
  const lifecycle = life.lines.length
    ? `<p>Future work over ${life.horizonYears} years: ${money(life.undiscounted)} undiscounted${life.discountRatePercent ? `, ${money(life.presentValue)} present value at ${life.discountRatePercent}% a year` : ''}. Kept out of the construction-period budget.</p>`
    : ''
  return `<section data-project-budget><h2>Project budget</h2><div class="metrics"><div class="metric">Construction estimate<strong>${money(summary.construction)}</strong></div><div class="metric">Project items<strong>${money(summary.projectItems)}</strong></div><div class="metric">Project budget<strong>${money(summary.projectBudget)}</strong></div><div class="metric">Not assessed<strong>${summary.counts['not-assessed']}</strong></div></div><p class="muted">Amounts in ${currency}. Project items sit beside the construction estimate and never change it; route searches compare roads on the construction estimate alone.${summary.allowances ? ` Allowances (provisional sums) are ${money(summary.allowances)} of the project items.` : ''}${summary.counts['not-assessed'] ? ` <strong>${summary.counts['not-assessed']} items are not assessed: the budget leaves them out, which is not the same as costing nothing.</strong>` : ''}</p><table><thead><tr><th style="text-align:left">Group</th><th style="text-align:left">Item</th><th style="text-align:left">Status</th><th>Amount</th><th>Basis, line or reason</th></tr></thead><tbody>${table}</tbody></table>${lifecycle}${summary.problems.length ? `<p class="status">${summary.problems.map(({ row, problem }) => `${html(row.label)}: ${html(problem)}`).join(' ')}</p>` : ''}</section>`
}
