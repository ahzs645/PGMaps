/**
 * The report package's summary page: what the main file opens with when its front page is the
 * summary rather than the cover (`ReportPackageSettings.front`). Key figures, findings, a table of
 * the roads, cost by category and by item, open checks and the package's contents, each switched by
 * `summaryOff`, with every cost before or after contingency (`contingency`).
 *
 * Every figure is read from the roads' own analyses and readiness rows, the same ones their reports
 * print; nothing is estimated here. Returns HTML for the report PDF renderer (`reportPdfBlob`), which
 * draws headings, paragraphs, lists, tables and SVG. No DOM or network access.
 */
import { labelStation } from './roadStationing'
import { fitLabel, LABEL_LINE_HEIGHT, textWidth } from '@/lib/mapSheet/textMetrics'
import { chartStats } from './chartsSheet'
import { gradeRuleText, type GradeRule } from './designStandards'
import type { CostRates } from './costRates'
import type { EngineeringCosts } from './engineeringTypes'
import type { ReadinessRow } from './readiness'
import {
  includesContingency,
  slopeSheetMode,
  summaryShows,
  type EstimateSettings,
  type ReportPackageSettings,
} from './reportPackage'
import { SLOPE_SHEET_CHECK, type SlopeSheetCheck } from './slopeSheetCheck'
import { rangeTotals, type RangeLevel, type RoadEstimateRange } from './estimateRange'
import type { RoadAnalysis, TerrainMetadata } from './types'
import { terrainResolution } from './tinGround'

export interface SummaryRoad {
  name: string
  analysis: RoadAnalysis
  /** The readiness rows the road's report prints (`reportReview`); null when there are none. */
  review: ReadinessRow[] | null
  /** The rate each cost item was priced at (`costRates`), printed beside the item. */
  rates?: CostRates
  /**
   * A road with no engineering inputs: its estimate split by item at the project's base rates
   * (`baseCosts`), so the breakdown still prints. Ignored when the analysis has engineering costs.
   */
  baseCosts?: EngineeringCosts
  /**
   * The slope sheet beside the estimate (`slopeSheetCheck`): null where the sheet does not reach the
   * road. `highCase` is the road with the sheet's steeper stretches full-benched (`slopeSheetCase`),
   * analysed with `base` the same way, so their difference is what the benching adds; or the
   * reason there is none.
   */
  slopeSheet?: {
    check: SlopeSheetCheck | null
    highCase?: { base: RoadAnalysis; case: RoadAnalysis; change: string } | { error: string }
  }
  /** The road's low, medium and high estimate (`estimateRange.ts`), when the package asks for it. */
  range?: RoadEstimateRange
}

export interface SummaryInput {
  /** The preliminary estimate's allowances, for the range (`RoadReportSettings.estimate`). */
  estimate?: EstimateSettings
  projectName: string
  roads: readonly SummaryRoad[]
  settings: ReportPackageSettings | undefined
  rule?: GradeRule
  terrain: Pick<TerrainMetadata, 'name' | 'resolutionM' | 'kind' | 'preparation'>
  /** Issue stamp, planning caveat and any "not current" line, printed under the title. */
  stamp: string[]
  /** What follows the summary in this file; `page` is null until the file is laid out. */
  contents: { label: string; page: number | null }[]
  appendices: { filename: string; title: string }[]
  omitted: string[]
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const number = (value: number, digits = 0) =>
  value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const money = (value: number | null) => (value === null || !Number.isFinite(value) ? '—' : `$${number(value)}`)
const percent = (value: number | null, digits = 1, signed = false) =>
  value === null || !Number.isFinite(value)
    ? '—'
    : `${signed && value > 0 ? '+' : ''}${number(value, digits).replace('-', '−')}%`

/** Cost groups for the chart and the findings, in the order a reader builds a road. */
export const COST_GROUPS: readonly { label: string; keys: readonly (keyof EngineeringCosts)[]; colour: string }[] = [
  { label: 'Excavation and stripping', keys: ['cut', 'stripping'], colour: '#2f6f9f' },
  { label: 'Fill placement', keys: ['fill'], colour: '#7fa7c9' },
  { label: 'Haul, borrow and waste', keys: ['haul', 'borrow', 'waste'], colour: '#c9a227' },
  { label: 'Surfacing', keys: ['surfacing'], colour: '#8a6d3b' },
  { label: 'Clearing and site preparation', keys: ['clearing', 'sitePreparation'], colour: '#4f8a4f' },
  { label: 'Culverts and structures', keys: ['structures'], colour: '#6b5ca5' },
  { label: 'Mobilization', keys: ['mobilization'], colour: '#9aa5b1' },
  { label: 'Contingency', keys: ['contingency'], colour: '#cbd2d9' },
]
const COST_ROWS: readonly (readonly [keyof EngineeringCosts, string])[] = [
  ['cut', 'Excavation'],
  ['stripping', 'Stripping'],
  ['fill', 'Fill placement'],
  ['surfacing', 'Surfacing'],
  ['clearing', 'Clearing'],
  ['sitePreparation', 'Site preparation'],
  ['structures', 'Culverts and structures'],
  ['haul', 'Haul'],
  ['borrow', 'Borrow'],
  ['waste', 'Waste disposal'],
  ['mobilization', 'Mobilization'],
]

interface RoadFigures {
  name: string
  lengthM: number
  cutM3: number
  fillM3: number
  costs: EngineeringCosts | null
  /** The costs are the base rates only: no haul, borrow, waste, culverts or mobilization were priced. */
  baseOnly: boolean
  range?: RoadEstimateRange
  slopeSheet?: SummaryRoad['slopeSheet'] & {
    /** What full-benching the sheet's steeper stretches adds to the estimate, as the estimate is counted. */
    addsToEstimate?: number
  }
  /** With or without contingency, as the settings ask. */
  estimate: number
  coveragePercent: number
  checks: { met: number; attention: number; notAssessed: number } | null
  stats: ReturnType<typeof chartStats>
}

/** An analysis's estimate as the summary counts it: with or without contingency. */
const estimateOf = (a: RoadAnalysis, contingency: boolean) =>
  a.engineering ? (contingency ? a.engineering.costs.total : a.engineering.costs.subtotal) : a.estimatedCost

function figures(road: SummaryRoad, contingency: boolean, rule?: GradeRule): RoadFigures {
  const a = road.analysis
  const costs = a.engineering?.costs ?? road.baseCosts ?? null
  const rows = road.review
  return {
    name: road.name,
    lengthM: a.length,
    cutM3: a.cutVolumeM3,
    fillM3: a.fillVolumeM3,
    costs,
    baseOnly: !a.engineering && !!road.baseCosts,
    ...(road.range ? { range: road.range } : {}),
    ...(road.slopeSheet
      ? {
          slopeSheet: {
            ...road.slopeSheet,
            ...(road.slopeSheet.highCase && !('error' in road.slopeSheet.highCase)
              ? {
                  addsToEstimate:
                    estimateOf(road.slopeSheet.highCase.case, contingency) -
                    estimateOf(road.slopeSheet.highCase.base, contingency),
                }
              : {}),
          },
        }
      : {}),
    estimate: costs ? (contingency ? costs.total : costs.subtotal) : a.estimatedCost,
    coveragePercent: a.coveragePercent,
    checks: rows
      ? {
          met: rows.filter((r) => r.state === 'met').length,
          attention: rows.filter((r) => r.state === 'attention').length,
          notAssessed: rows.filter((r) => r.state === 'not-assessed').length,
        }
      : null,
    stats: chartStats(a.stations, rule),
  }
}

/** $1.34M, $482k: a tile's short form. */
const compactMoney = (value: number) =>
  value >= 1_000_000 ? `$${number(value / 1_000_000, 2)}M` : value >= 1000 ? `$${number(value / 1000)}k` : money(value)

const LEVELS: RangeLevel[] = ['low', 'medium', 'high']
const LEVEL_NAMES: Record<RangeLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** Each road's low, medium and high estimate, what each level did, and the allowances behind them. */
function rangeSection(roads: readonly RoadFigures[], estimate: EstimateSettings) {
  const ranged = roads.filter((r) => r.range)
  const single = ranged.length === 1
  const totals = rangeTotals(ranged.map((r) => r.range!))
  const head = ['Road', 'As imported', 'Low: 1:1 fill', 'Medium: leading fixes', 'High: full bench']
  const cell = (r: RoadFigures, level: RangeLevel) => {
    const s = r.range![level]
    return s.estimate === null ? 'Not built' : money(s.estimate)
  }
  const rows = ranged.map(
    (r) =>
      `<tr><td>${escape(r.name)}</td><td>${money(r.range!.asIs.estimate)}</td>${LEVELS.map((l) => `<td>${cell(r, l)}</td>`).join('')}</tr>`,
  )
  const total = single
    ? ''
    : `<tr><th>All roads</th><th>${money(ranged.reduce((t, r) => t + r.range!.asIs.estimate, 0))}</th>${LEVELS.map((l) => `<th>${totals[l] === null ? '—' : money(totals[l])}</th>`).join('')}</tr>`
  const did = ranged.map(
    (r) =>
      `<li>${escape(
        `${r.name}: ${LEVELS.map((l) => {
          const s = r.range![l]
          return `${LEVEL_NAMES[l]}, ${s.error ? `not built (${s.error})` : s.changes.join('; ')}${s.completePercent !== null && s.completePercent < 99.95 ? ` (${number(s.completePercent, 1)}% of sections close)` : ''}`
        }).join('. ')}.`,
      )}</li>`,
  )
  // The allowances, as entered: a blank one is counted and named, never priced.
  const range = estimate
  const drains = (level: RangeLevel) => ranged.reduce((t, r) => t + (r.range![level].crossDrains?.count ?? 0), 0)
  const haulM3 = (level: RangeLevel) => ranged.reduce((t, r) => t + (r.range![level].endHaul?.m3 ?? 0), 0)
  const notes: string[] = []
  if (!range.crossDrainSpacingM)
    notes.push('No cross-drain spacing is entered, so culverts beyond those already on the roads are not counted.')
  else
    notes.push(
      `Medium and high add ${number(drains('high'))} cross-drain${drains('high') === 1 ? '' : 's'}, one every ${number(range.crossDrainSpacingM)} m less the culverts already entered, ${
        range.crossDrainCost === undefined
          ? 'counted but not priced: enter a price for each'
          : `at ${money(range.crossDrainCost)} each (${money(drains('high') * range.crossDrainCost)})`
      }.`,
    )
  const surplus = LEVELS.map((l) => `${LEVEL_NAMES[l].toLowerCase()} ${number(haulM3(l))} m³`).join(', ')
  if (LEVELS.some((l) => haulM3(l) > 0.5))
    notes.push(
      range.endHaulRate === undefined
        ? `Surplus cut to take away on roads that price no haul (${surplus}) has no end-haul price: enter a rate to include it.`
        : `Surplus cut on roads that price no haul (${surplus}) is priced at ${money(range.endHaulRate)}/m³ end haul.`,
    )
  return `<h2>Estimate range</h2><p>${escape(
    'Each road priced three ways on copies of it; its own estimate is unchanged. Low: the 1:1 fill wherever it closes a section, and the longer reach that closes the rest. Medium: each stretch’s leading fix in Review (full bench on ground of 60% or more, else the 1:1 fill, else the reach). High: every fill stretch full-benched, and the stretches a slope sheet shows steeper. The as-imported estimate leaves out the sections that do not close, so every level can sit above it.',
  )}</p><table><thead><tr>${head.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}${total}</tbody></table><p>${escape(notes.join(' '))}</p><ul>${did.join('')}</ul>`
}

const chainageText = (chainage: number) => labelStation(chainage, 0)

/** The slope sheet set beside each road's estimate, and with `range` the high case. */
function slopeSheetSection(roads: readonly RoadFigures[], settings: ReportPackageSettings | undefined) {
  const range = slopeSheetMode(settings) === 'range'
  const sheet = roads.find((r) => r.slopeSheet?.check)?.slopeSheet?.check?.sheet
  const head = [
    'Road',
    'On the sheet',
    `${SLOPE_SHEET_CHECK.steepPercent}%+ per sheet`,
    `${SLOPE_SHEET_CHECK.steepPercent}%+ per terrain`,
    'Stretches the sheet shows steeper',
    ...(range ? ['High case', 'Adds'] : []),
  ]
  const rows = roads.map((r) => {
    const check = r.slopeSheet?.check
    if (!r.slopeSheet) return ''
    if (!check)
      return `<tr><td>${escape(r.name)}</td><td>Not on the sheet</td><td></td><td></td><td></td>${range ? '<td></td><td></td>' : ''}</tr>`
    const stretches = check.stretches.length
      ? check.stretches
          .map(
            (s) =>
              `${chainageText(s.from)}–${chainageText(s.to)} (${number(s.sheetSteepPercent)}% against ${number(s.terrainSteepPercent)}%)`,
          )
          .join('; ')
      : 'None'
    const high = r.slopeSheet.highCase
    const highCells = !range
      ? ''
      : !check.stretches.length
        ? '<td>—</td><td>—</td>'
        : !high || 'error' in high
          ? `<td colspan="2">${escape(high && 'error' in high ? high.error : 'Not priced')}</td>`
          : `<td>${money(r.estimate + (r.slopeSheet.addsToEstimate ?? 0))}</td><td>${money(r.slopeSheet.addsToEstimate ?? 0)}</td>`
    return `<tr><td>${escape(r.name)}</td><td>${number(check.coveredLengthM)} of ${number(check.roadLengthM)} m</td><td>${number(check.sheetSteepPercent)}%</td><td>${number(check.terrainSteepPercent)}%</td><td>${escape(stretches)}</td>${highCells}</tr>`
  })
  const changes = range
    ? roads.flatMap((r) => {
        const high = r.slopeSheet?.highCase
        return high && !('error' in high) ? [`${r.name}: ${high.change}.`] : []
      })
    : []
  const haulPriced = roads.some((r) => r.slopeSheet?.highCase && !('error' in r.slopeSheet.highCase) && !r.baseOnly)
  return `<h2>Slope sheet check</h2><p>${escape(
    `${sheet ? `${sheet}, ` : ''}read as the share of a ±${SLOPE_SHEET_CHECK.stripHalfWidthM} m strip along each road that it prints at ${SLOPE_SHEET_CHECK.steepPercent}% or steeper, against the same share on the ground the estimate was calculated from. A stretch is named where the sheet shows ${SLOPE_SHEET_CHECK.flagPoints} points more over ${SLOPE_SHEET_CHECK.intervalM} m. The sheet's JPEG classes are area estimates (about 9–12%), and it is evidence beside the estimate, never an input to it.`,
  )}</p><table><thead><tr>${head.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>${
    range
      ? `<p>${escape(
          `The high case benches those stretches into the hill on a copy of each road and prices it the way the estimate is priced; the estimate itself is unchanged. It is measured on the estimate's own terrain, so where the ground is as steep as the sheet shows the bench goes deeper: a floor under the steep-ground cost, not its ceiling. ${haulPriced ? 'Where a road prices haul, the surplus cut goes to end haul at its rates; elsewhere it is priced as excavation only.' : 'No road prices haul, so the surplus cut is priced as excavation only and its end haul is not priced.'}${changes.length ? ` ${changes.join(' ')}` : ''}`,
        )}</p>`
      : ''
  }`
}

/** Names the roads priced at the base rates only and what their estimate leaves out. */
function baseOnlyNote(roads: readonly RoadFigures[]) {
  const base = roads.filter((r) => r.baseOnly)
  if (!base.length) return ''
  const who =
    base.length === roads.length
      ? roads.length === 1
        ? 'This road has'
        : 'These roads have'
      : `${base.map((r) => r.name).join(', ')} ${base.length === 1 ? 'has' : 'have'}`
  return `<p>${escape(
    `${who} no engineering inputs, so ${base.length === 1 && roads.length === 1 ? 'its estimate is' : 'the estimate is'} cut, fill, surfacing and clearing at the project's rates, plus any crossing estimate. Haul, borrow, waste, culverts, site preparation, mobilization and contingency are not priced.`,
  )}</p>`
}

/** Contingency as a share of the subtotal, when every road with costs uses the same one. */
function contingencyShare(roads: readonly RoadFigures[]) {
  const shares = roads
    .filter((r) => r.costs && r.costs.subtotal > 0)
    .map((r) => Math.round((1000 * r.costs!.contingency) / r.costs!.subtotal) / 10)
  return shares.length && shares.every((s) => s === shares[0]) ? shares[0] : null
}

/**
 * The key-figure tiles. Each value and label is measured (`textWidth`, `fitLabel`) and fitted to its
 * tile: a label wraps to a second line, then shrinks, and a row of tiles grows to hold two lines,
 * so nothing runs past a tile's edge ("estimate (no contingency entered)" did).
 */
export function tilesSvg(tiles: [string, string][]) {
  const perRow = Math.min(5, tiles.length),
    width = 760,
    gap = 10,
    pad = 10,
    tileW = (width - gap * (perRow - 1)) / perRow,
    inner = tileW - 2 * pad
  const LABEL = 10.5,
    VALUE = 18
  const fitted = tiles.map(([value, label]) => ({
    value,
    valueSize: Math.max(11, Math.min(VALUE, (VALUE * inner) / Math.max(1, textWidth(value, VALUE, 'bold')))),
    label: fitLabel(label, LABEL, inner, LABEL * LABEL_LINE_HEIGHT * 2, { minScale: 0.85 }),
  }))
  const rows = Math.ceil(tiles.length / perRow)
  // A row is as tall as its tallest label needs.
  const rowHeight = Array.from({ length: rows }, (_, r) =>
    fitted.slice(r * perRow, (r + 1) * perRow).some((t) => t.label.lines.length > 1) ? 66 : 54,
  )
  const rowTop = rowHeight.map((_, r) => rowHeight.slice(0, r).reduce((sum, h) => sum + h + gap, 0))
  const body = fitted
    .map((tile, i) => {
      const r = Math.floor(i / perRow),
        x = (i % perRow) * (tileW + gap),
        y = rowTop[r]
      const label = tile.label.lines
        .map(
          (line, k) =>
            `<text x="${(x + pad).toFixed(1)}" y="${(y + 43 + k * tile.label.size * LABEL_LINE_HEIGHT).toFixed(1)}" font-size="${tile.label.size.toFixed(1)}" fill="#4b5563">${escape(line)}</text>`,
        )
        .join('')
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${tileW.toFixed(1)}" height="${rowHeight[r]}" rx="3" fill="#f3f5f7"/><text x="${(x + pad).toFixed(1)}" y="${y + 25}" font-size="${tile.valueSize.toFixed(1)}" font-weight="700" fill="#1d232a">${escape(tile.value)}</text>${label}`
    })
    .join('')
  const height = rowTop[rows - 1] + rowHeight[rows - 1]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Key figures" data-summary="figures">${body}</svg>`
}

function costChartSvg(roads: readonly RoadFigures[], contingency: boolean) {
  const groups = COST_GROUPS.filter(
    (g) => (contingency || g.label !== 'Contingency') && roads.some((r) => r.costs && g.keys.some((k) => r.costs![k])),
  )
  const width = 760,
    labelW = 150,
    barW = 420,
    legendRows = Math.ceil(groups.length / 4),
    top = legendRows * 16 + 8
  const max = Math.max(1, ...roads.map((r) => r.estimate))
  const legend = groups
    .map((g, i) => {
      const x = (i % 4) * 190,
        y = Math.floor(i / 4) * 16
      return `<rect x="${x}" y="${y + 2}" width="10" height="10" fill="${g.colour}"/><text x="${x + 15}" y="${y + 11}" font-size="10" fill="#1d232a">${escape(g.label)}</text>`
    })
    .join('')
  const bars = roads
    .map((r, i) => {
      const y = top + i * 26
      let x = labelW
      const parts = groups
        .map((g) => {
          const value = r.costs ? g.keys.reduce((sum, k) => sum + (r.costs![k] || 0), 0) : 0
          const w = (barW * value) / max
          const rect =
            w > 0 ? `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="18" fill="${g.colour}"/>` : ''
          x += w
          return rect
        })
        .join('')
      const perKm = r.lengthM > 0 ? ` · ${money(r.estimate / (r.lengthM / 1000))}/km` : ''
      return `<text x="0" y="${y + 13}" font-size="10.5" fill="#1d232a">${escape(r.name.slice(0, 26))}</text>${parts}<text x="${(x + 6).toFixed(1)}" y="${y + 13}" font-size="10.5" fill="#1d232a">${money(r.estimate)}${perKm}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${top + roads.length * 26}" role="img" aria-label="Estimate by road and cost category" data-summary="cost-chart">${legend}${bars}</svg>`
}

/** The findings, as plain statements of what the figures show. */
export function summaryFindings(
  roads: readonly RoadFigures[],
  input: Pick<SummaryInput, 'rule' | 'terrain' | 'settings'>,
): string[] {
  const out: string[] = []
  const contingency = includesContingency(input.settings)
  const total = roads.reduce((sum, r) => sum + r.estimate, 0)
  const priced = roads.filter((r) => r.costs)
  if (priced.length && total > 0) {
    const ranked = COST_GROUPS.filter((g) => g.label !== 'Contingency')
      .map((g) => ({
        label: g.label,
        value: priced.reduce((s, r) => s + g.keys.reduce((t, k) => t + (r.costs![k] || 0), 0), 0),
      }))
      .filter((g) => g.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
    const items = ranked.map((g) => `${g.label.toLowerCase()} ${money(g.value)} (${number((100 * g.value) / total)}%)`)
    const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]
    // With no contingency entered there is nothing to be before.
    const plain = contingency || priced.every((r) => r.costs!.contingency === 0)
    out.push(`The largest costs are ${list} of the ${plain ? 'estimate' : 'estimate before contingency'}.`)
  }
  if (input.rule) {
    // With a loaded direction each grade is held to its own side's limit, and the line names both.
    const directional = !!input.rule.loadedDirection && input.rule.adversePercent !== input.rule.favourablePercent
    const limits = directional
      ? `sustained limits (${gradeRuleText({ ...input.rule, shortPitch: null })}, loaded toward the road ${input.rule.loadedDirection === 'end-to-start' ? 'start' : 'end'})`
      : `${number(input.rule.favourablePercent, 1)}% sustained limit`
    const over = roads.filter((r) => (r.stats.overLimitM ?? 0) > 0.5)
    out.push(
      over.length
        ? `The design grade is ${directional ? 'past' : 'steeper than'} the ${limits} on ${over
            .map(
              (r) =>
                `${r.name} for ${number(r.stats.overLimitM!)} m (${number((100 * r.stats.overLimitM!) / Math.max(1, r.lengthM))}% of its length)`,
            )
            .join('; ')}.`
        : `The design grade stays within the ${limits}${roads.length > 1 ? ' on every road' : ''}.`,
    )
  }
  const partial = roads.filter((r) => r.coveragePercent < 99.95)
  if (partial.length)
    out.push(
      `Earthwork is known over ${partial.map((r) => `${number(r.coveragePercent, 1)}% of ${r.name}`).join(', ')}. Cut, fill and cost cover that part only.`,
    )
  const checked = roads.filter((r) => r.checks)
  if (checked.length) {
    const sum = (k: 'met' | 'attention' | 'notAssessed') => checked.reduce((s, r) => s + r.checks![k], 0)
    const attention = sum('attention')
    out.push(
      `Readiness checks: ${sum('met')} met, ${attention} need attention and ${sum('notAssessed')} not assessed.${
        attention && summaryShows(input.settings, 'openItems')
          ? ' Those needing attention are listed under Open items.'
          : ''
      }`,
    )
  }
  const ranged = roads.filter((r) => r.range)
  if (ranged.length) {
    const totals = rangeTotals(ranged.map((r) => r.range!))
    const asIs = ranged.reduce((t, r) => t + r.range!.asIs.estimate, 0)
    const unpriced = ranged.reduce(
      (t, r) => t + (r.range!.high.endHaul && r.range!.high.endHaul.cost === null ? r.range!.high.endHaul.m3 : 0),
      0,
    )
    if (totals.low !== null && totals.high !== null)
      out.push(
        `Fixing the sections that do not close puts the estimate between ${money(totals.low)} (low) and ${money(totals.high)} (high)${totals.medium === null ? '' : `, ${money(totals.medium)} with Review's leading fixes`}, against ${money(asIs)} as imported, which leaves those sections out.${
          unpriced > 0.5
            ? ` A further ${number(unpriced)} m³ of surplus cut at the high level has no end-haul price.`
            : ''
        }`,
      )
  }
  const flagged = roads.filter((r) => r.slopeSheet?.check?.stretches.length)
  if (flagged.length && slopeSheetMode(input.settings) !== 'off') {
    const added = flagged.reduce((s, r) => s + (r.slopeSheet?.addsToEstimate ?? 0), 0)
    out.push(
      `The slope sheet shows more ground at ${SLOPE_SHEET_CHECK.steepPercent}%+ than the estimate's terrain on ${flagged.length === roads.length && roads.length > 1 ? 'every road' : flagged.map((r) => r.name).join(', ')}, so full bench and end haul may be understated there.${
        slopeSheetMode(input.settings) === 'range' && flagged.some((r) => r.slopeSheet?.addsToEstimate !== undefined)
          ? ` Full-benching those stretches adds ${money(added)} to the estimate (the high case, see Slope sheet check).`
          : ''
      }`,
    )
  }
  // A terrain named after its download box reads better without the coordinates.
  const terrainName = input.terrain.name.replace(/\s*·\s*-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){3}/, '')
  // A RoadEng TIN is as fine as its points; the grid drawn from it is not the ground.
  const resolution = terrainResolution(input.terrain)
  const spacing = number(resolution.spacingM, resolution.spacingM < 10 ? 1 : 0)
  const terrain = `${terrainName} (${resolution.kind === 'tin' ? `TIN, ${spacing} m median point spacing` : `${spacing} m cells`})`
  out.push(
    input.terrain.kind === 'regional'
      ? `Quantities come from ${terrain}. That is regional terrain: use these figures to compare and screen routes, not to price construction.`
      : input.terrain.kind === 'demo'
        ? `Quantities come from ${terrain}, synthetic training terrain: every figure is illustrative.`
        : `Quantities come from ${terrain}.`,
  )
  return out
}

export function packageSummaryHtml(input: SummaryInput): string {
  const { settings } = input
  const contingency = includesContingency(settings)
  const show = (section: Parameters<typeof summaryShows>[1]) => summaryShows(settings, section)
  const roads = input.roads.map((r) => figures(r, contingency, input.rule))
  const single = roads.length === 1
  const sum = (pick: (r: RoadFigures) => number) => roads.reduce((s, r) => s + pick(r), 0)
  const length = sum((r) => r.lengthM),
    estimate = sum((r) => r.estimate)
  const share = contingencyShare(roads)
  // A project with no contingency entered says so, rather than printing a 0% line.
  const noContingency = roads.every((r) => !r.costs || r.costs.contingency === 0)
  const noMobilization = roads.every((r) => !r.costs || r.costs.mobilization === 0)
  const basis = noContingency
    ? 'estimate (no contingency entered)'
    : contingency
      ? share === null
        ? 'estimate with contingency'
        : `estimate with ${number(share, share % 1 ? 1 : 0)}% contingency`
      : 'estimate before contingency'
  const included = [
    noMobilization ? '' : "the road's mobilization",
    noContingency || !contingency ? '' : 'contingency',
  ].filter(Boolean)
  const parts: string[] = []
  parts.push(
    `<h1>${escape(input.projectName)}</h1><p>${escape(
      single
        ? `Road summary: ${roads[0].name}`
        : `Road summary: ${roads.length} roads (${roads.map((r) => r.name).join(', ')})`,
    )}</p>${input.stamp.map((line) => `<p>${escape(line)}</p>`).join('')}`,
  )
  if (show('figures') || show('grades')) {
    const tiles: [string, string][] = []
    if (show('figures'))
      tiles.push(
        [`${number(length)} m`, single ? 'road length' : 'total length'],
        [`${number(sum((r) => r.cutM3))} m³`, 'cut'],
        [`${number(sum((r) => r.fillM3))} m³`, 'fill'],
        [money(estimate), basis],
        [length > 0 ? `${money(estimate / (length / 1000))}/km` : '—', 'per kilometre'],
      )
    const ranged = roads.filter((r) => r.range)
    if (show('figures') && ranged.length === roads.length && roads.length) {
      const totals = rangeTotals(ranged.map((r) => r.range!))
      if (totals.low !== null && totals.high !== null)
        tiles.push([`${compactMoney(totals.low)}–${compactMoney(totals.high)}`, 'estimate range, low to high'])
    }
    if (show('grades')) {
      const climb = sum((r) => r.stats.climbM),
        descent = sum((r) => r.stats.descentM)
      const steepest = Math.max(
        0,
        ...roads.flatMap((r) => [r.stats.steepestClimbPercent ?? 0, -(r.stats.steepestDescentPercent ?? 0)]),
      )
      const over = roads.some((r) => r.stats.overLimitM !== null) ? sum((r) => r.stats.overLimitM ?? 0) : null
      if (single) tiles.push([percent(roads[0].stats.averageGradePercent, 1, true), 'average grade (net)'])
      tiles.push(
        [percent(length > 0 ? (100 * (climb + descent)) / length : null), 'average grade, either direction'],
        [percent(steepest), 'steepest design grade'],
        [over === null ? '—' : `${number(over)} m`, 'over the sustained limit'],
        [`${number(climb)} / ${number(descent)} m`, 'climb / descent'],
      )
    }
    parts.push(tilesSvg(tiles))
  }
  if (show('findings')) {
    const findings = summaryFindings(roads, input)
    if (findings.length)
      parts.push(`<h2>Findings</h2><ul>${findings.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>`)
  }
  if (show('roads')) {
    const grades = show('grades')
    const head = [
      'Road',
      'Length m',
      'Cut m³',
      'Fill m³',
      'Estimate',
      '$/km',
      'Earthwork known',
      'Checks met / attention / not assessed',
      ...(grades ? ['Average grade', 'Steepest grade'] : []),
    ]
    const row = (r: RoadFigures) => [
      escape(r.name),
      number(r.lengthM),
      number(r.cutM3),
      number(r.fillM3),
      money(r.estimate),
      r.lengthM > 0 ? money(r.estimate / (r.lengthM / 1000)) : '—',
      percent(r.coveragePercent),
      r.checks ? `${r.checks.met} / ${r.checks.attention} / ${r.checks.notAssessed}` : '—',
      ...(grades
        ? [
            percent(r.stats.averageGradePercent, 1, true),
            percent(Math.max(r.stats.steepestClimbPercent ?? 0, -(r.stats.steepestDescentPercent ?? 0))),
          ]
        : []),
    ]
    const total = single
      ? ''
      : `<tr><th>Total</th><th>${number(length)}</th><th>${number(sum((r) => r.cutM3))}</th><th>${number(sum((r) => r.fillM3))}</th><th>${money(estimate)}</th><th>${length > 0 ? money(estimate / (length / 1000)) : '—'}</th>${'<th></th>'.repeat(head.length - 6)}</tr>`
    parts.push(
      `<h2>${single ? 'Road summary' : 'Roads'}</h2><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${roads
        .map(
          (r) =>
            `<tr>${row(r)
              .map((c) => `<td>${c}</td>`)
              .join('')}</tr>`,
        )
        .join(
          '',
        )}${total}</tbody></table><p>Each estimate covers the stations whose sections are complete, at the entered rates${included.length ? `, and includes ${included.join(' and ')}` : ''}.${
        noContingency ? ' No contingency is entered in the project.' : contingency ? '' : ' Contingency is left out.'
      }${single || noMobilization ? '' : ' Mobilization is counted once for each road.'}</p>`,
    )
  }
  if (roads.some((r) => r.range)) parts.push(rangeSection(roads, input.estimate ?? {}))
  if (show('costChart') && roads.some((r) => r.costs))
    parts.push(`<h2>Cost by category</h2>${costChartSvg(roads, contingency)}`)
  if (show('costTable') && roads.some((r) => r.costs)) {
    const keys = COST_ROWS.filter(([k]) => roads.some((r) => r.costs && r.costs[k]))
    const cell = (r: RoadFigures, k: keyof EngineeringCosts) => (r.costs ? money(r.costs[k]) : '—')
    const all = (k: keyof EngineeringCosts) => money(roads.reduce((s, r) => s + (r.costs?.[k] ?? 0), 0))
    const line = (label: string, k: keyof EngineeringCosts, strong = false) => {
      const tag = strong ? 'th' : 'td'
      const rate = withRates ? `<${tag}>${k === 'subtotal' || k === 'total' ? '' : escape(rateOf(k))}</${tag}>` : ''
      return `<tr><${tag}>${label}</${tag}>${rate}${roads.map((r) => `<${tag}>${cell(r, k)}</${tag}>`).join('')}${single ? '' : `<${tag}>${all(k)}</${tag}>`}</tr>`
    }
    const pct = share === null ? '' : ` (${number(share, share % 1 ? 1 : 0)}%)`
    // The assumed rate beside each item: one column when every road used the same rate.
    const rateOf = (k: keyof EngineeringCosts) => {
      const texts = [...new Set(input.roads.map((r) => r.rates?.[k]).filter((t): t is string => !!t))]
      return texts.length === 0 ? '' : texts.length === 1 ? texts[0] : 'differs by road (see each report)'
    }
    const withRates = input.roads.some((r) => r.rates && Object.keys(r.rates).length)
    parts.push(
      `<h2>Cost breakdown (CAD)</h2><table><thead><tr><th>Item</th>${withRates ? '<th>Rate assumed</th>' : ''}${roads
        .map((r) => `<th>${escape(r.name)}</th>`)
        .join('')}${single ? '' : '<th>All roads</th>'}</tr></thead><tbody>${keys
        .map(([k, label]) => line(label, k))
        .join('')}${
        noContingency
          ? line('Total (no contingency entered)', 'subtotal', true)
          : contingency
            ? `${line('Subtotal', 'subtotal', true)}${line(`Contingency${pct}`, 'contingency')}${line('Total', 'total', true)}`
            : line('Total before contingency', 'subtotal', true)
      }</tbody></table>${baseOnlyNote(roads)}`,
    )
  }
  if (slopeSheetMode(settings) !== 'off' && roads.some((r) => r.slopeSheet))
    parts.push(slopeSheetSection(roads, settings))
  if (show('openItems')) {
    const blocks = input.roads
      .map((road) => {
        const rows = (road.review ?? []).filter((r) => r.state === 'attention')
        if (!rows.length) return ''
        return `${single ? '' : `<h3>${escape(road.name)}</h3>`}<ul>${rows
          .map((r) => `<li>${escape(`${r.check}: ${r.result}`)}</li>`)
          .join('')}</ul>`
      })
      .join('')
    parts.push(`<h2>Open items</h2>${blocks || '<p>No readiness check needs attention.</p>'}`)
  }
  if (show('contents') && (input.contents.length || input.appendices.length)) {
    parts.push(
      `<h2>In this package</h2>${
        input.contents.length
          ? `<ul>${input.contents
              .map((c) => `<li>${escape(c.label)}${c.page === null ? '' : `, page ${c.page}`}</li>`)
              .join('')}</ul>`
          : ''
      }${
        input.appendices.length
          ? `<p>Appendices, each a separate PDF: ${escape(input.appendices.map((a) => `${a.filename} (${a.title})`).join('; '))}.</p>`
          : ''
      }${input.omitted.length ? `<p>Left out: ${escape(input.omitted.join(', '))}.</p>` : ''}`,
    )
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(input.projectName)} · summary</title><style>body{font:13px/1.45 Inter,Arial,sans-serif;color:#1d232a;max-width:960px;margin:24px auto;padding:0 20px}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:right;padding:4px 6px;border-bottom:1px solid #e3e6ea}th:first-child,td:first-child{text-align:left}th{background:#eef2f5}svg{width:100%;height:auto;margin:6px 0}</style></head><body data-package-summary>${parts.join('')}</body></html>`
}

/** The findings the preliminary estimate prints: the range, the slope sheet, what is known, the terrain. */
const ESTIMATE_FINDINGS = /^(Fixing the sections|The slope sheet shows|Earthwork is known|Quantities come from)/

/**
 * The Preliminary estimate export: the low, medium and high estimate of each road beside its
 * estimate as imported (`estimateRange.ts`), with the findings that bear on it and the allowances
 * behind it. The same range the package summary prints, as a document of its own.
 */
export function estimateHtml(input: SummaryInput): string {
  const contingency = includesContingency(input.settings)
  const roads = input.roads.map((r) => figures(r, contingency, input.rule))
  const ranged = roads.filter((r) => r.range)
  const totals = rangeTotals(ranged.map((r) => r.range!))
  const asIs = ranged.reduce((t, r) => t + r.range!.asIs.estimate, 0)
  const length = roads.reduce((t, r) => t + r.lengthM, 0)
  const basis = contingency ? '' : ', before contingency'
  const tiles: [string, string][] = [
    [`${number(length)} m`, roads.length === 1 ? 'road length' : 'total length'],
    [money(asIs), `as imported${basis}`],
    ...LEVELS.map((l): [string, string] => [
      totals[l] === null ? '—' : money(totals[l]),
      `${LEVEL_NAMES[l].toLowerCase()}${basis}`,
    ]),
  ]
  const findings = summaryFindings(roads, input).filter((f) => ESTIMATE_FINDINGS.test(f))
  const parts = [
    `<h1>${escape(input.projectName)}</h1><p>${escape(
      `Preliminary estimate: ${roads.length === 1 ? roads[0].name : `${roads.length} roads (${roads.map((r) => r.name).join(', ')})`}`,
    )}</p>${input.stamp.map((line) => `<p>${escape(line)}</p>`).join('')}`,
    tilesSvg(tiles),
    findings.length ? `<h2>Findings</h2><ul>${findings.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>` : '',
    ranged.length ? rangeSection(roads, input.estimate ?? {}) : '<p>No road has calculated results to price.</p>',
  ]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(input.projectName)} · preliminary estimate</title><style>body{font:13px/1.45 Inter,Arial,sans-serif;color:#1d232a;max-width:960px;margin:24px auto;padding:0 20px}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:right;padding:4px 6px;border-bottom:1px solid #e3e6ea}th:first-child,td:first-child{text-align:left}th{background:#eef2f5}svg{width:100%;height:auto;margin:6px 0}</style></head><body data-package-summary>${parts.join('')}</body></html>`
}
