/**
 * Everything the block planner writes, built from the same state the page shows. Save & export
 * (`SaveExportDialog.tsx`) is the only place these are offered.
 *
 * - **Plan file**: the plan itself, to reopen and keep working.
 * - **Assessment record**: the plan with every schedule's periods, the published comparators, both
 *   reviews' findings as the evaluator gave them, the D.5 checklists and the planning index, so a
 *   reviewer can rerun or audit the assessment.
 * - **Blocks and baseline (GeoJSON)**: each block shape with the year each schedule cuts it, and
 *   each past disturbance, for GIS.
 * - **Summary (HTML)**: a printable page of the same figures.
 *
 * DOM- and network-free: the rule library and the patch result are passed in.
 */
import type { Feature, FeatureCollection } from 'geojson'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { escapeHtml as escape } from '@/lib/escapeHtml'
import { assess } from '../../../packages/legal-rules/engine/evaluate'
import { releaseKey, type Pack } from '../../../packages/legal-rules/src/contract'
import { table } from '../forest-patches/project'
import { publishedUnit } from './observations'
import { entryOf, periodYears, type Plan, type ReviewCase } from './plan'
import type { PlanAnalysis } from './planAnalysis'
import { DEFAULT_INDEX_WEIGHTS, indexFormula, INDEX_INDICATORS, planningIndex } from './planningIndex'
import { pathways, trendYearOf } from './review/pathways'
import { BOARD_2019_SOURCE, gisDisagrees, oldForestUnit } from './oldForest/units'
import { boardCheckCurrent, firstShortfall, oldForestCurrent } from './records'

export const BLOCK_PLANNING_EXPORTS = [
  {
    id: 'plan',
    label: 'Plan file',
    description: 'The plan, to reopen in the block planner and keep working.',
    fileName: 'block-plan.json',
    type: { mime: 'application/json', extension: 'json', description: 'Block plan' },
    needsResult: false,
  },
  {
    id: 'record',
    label: 'Assessment record',
    description:
      'The plan with every schedule’s periods, the published comparators, both reviews’ findings, the D.5 checklists and the planning index, for a reviewer to audit or rerun.',
    fileName: 'block-assessment.json',
    type: { mime: 'application/json', extension: 'json', description: 'Block assessment record' },
    needsResult: true,
  },
  {
    id: 'geojson',
    label: 'Blocks and baseline (GeoJSON)',
    description: 'Each block shape with the year each schedule cuts it, and each past disturbance, in WGS84.',
    fileName: 'block-plan.geojson',
    type: { mime: 'application/geo+json', extension: 'geojson', description: 'GeoJSON' },
    needsResult: false,
  },
  {
    id: 'summary',
    label: 'Summary (HTML)',
    description:
      'A printable page: the area, the schedules over time, the published figures, the pathways and the index.',
    fileName: 'block-assessment-summary.html',
    type: { mime: 'text/html', extension: 'html', description: 'Web page' },
    needsResult: true,
  },
] as const
export type BlockPlanningExport = (typeof BLOCK_PLANNING_EXPORTS)[number]['id']

export const LIMITATIONS = [
  'Advisory: no finding decides that the order applies, that a block complies, or that an exception or pathway is met.',
  'Young-forest patches are calculated with method pg-2005-buffer-v1, from the December 2005 implementation policy, and are not yet validated against the province’s own GIS outputs.',
  'Only the baseline’s stand-replacing disturbances and the schedules’ blocks are modelled; the reporting unit’s coverage is as stated in the plan.',
  'Old and old-interior forest (Objectives A and B) are calculated only when assessed, from VRI ages (not field-verified), a VRI proxy for the CFLB unless one is stated, and the assumptions in the guide.',
  'The published 2015 and 2018 figures came from other inventories, and 2018 used the revised 2017 guidance.',
  'The planning index ranks options for discussion; it is not a legal test.',
]

function review(cases: ReviewCase | undefined, library: Pack[]) {
  if (!cases) return null
  const packs = library.filter((p) => cases.selected.includes(releaseKey(p)))
  const inputs = packs.map((p) => cases.sets[releaseKey(p)]).filter(Boolean)
  try {
    return assess(cases.date, packs, inputs)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The review could not be evaluated.' }
  }
}

export function assessmentRecord(plan: Plan, result: PlanAnalysis, library: Pack[], generatedOn: string) {
  const weights = { ...DEFAULT_INDEX_WEIGHTS, ...plan.indexWeights }
  const order = plan.landscape.review
  const orderKey = order?.selected.find((k) => k.startsWith('bc.pgtsa.biodiversity@'))
  return {
    format: 'pgmaps-block-assessment/v1',
    generatedOn,
    bindingDecision: false,
    method: 'pg-2005-buffer-v1',
    plan,
    schedules: result.runs.map((run) => ({
      schedule: run.schedule,
      name: plan.schedules.find((s) => s.id === run.schedule)?.name,
      periods: run.periods.map(({ year, totalHa, unclassifiedHa, patches, classes }) => ({
        year,
        totalHa,
        unclassifiedHa,
        patches,
        classes,
      })),
      movedAway: run.movedAway,
    })),
    published: publishedUnit(plan.area.district, plan.area.ndu),
    landscapeReview: { trendYear: trendYearOf(plan), assessment: review(order, library) },
    blockReviews: Object.fromEntries(Object.entries(plan.reviews).map(([id, r]) => [id, review(r, library)])),
    pathways: pathways(plan, orderKey ? order?.sets[orderKey] : undefined, result),
    planningIndex: { notALegalTest: true, formula: indexFormula(weights), ...planningIndex(plan, result, weights) },
    boardCheck: plan.checks?.board ? { current: boardCheckCurrent(plan), ...plan.checks.board } : null,
    oldForest: plan.checks?.oldForest
      ? {
          current: oldForestCurrent(plan),
          choices: plan.oldForest ?? null,
          shortfalls: plan.checks.oldForest.schedules.map((s) => ({
            schedule: s.schedule,
            first: firstShortfall(s.years),
          })),
          board2019: oldForestUnit(plan.checks.oldForest.district, plan.checks.oldForest.unit)?.board2019 ?? null,
          ...plan.checks.oldForest,
        }
      : null,
    limitations: LIMITATIONS,
  }
}

export function blocksGeoJson(plan: Plan): FeatureCollection {
  const blocks: Feature[] = plan.blocks.flatMap((block) =>
    block.shapes.map((shape) => ({
      type: 'Feature',
      geometry: shape.geometry,
      properties: {
        layer: 'block',
        block: block.name,
        shape: shape.name,
        gross_ha: Math.round(blockAreaHa(shape.geometry) * 100) / 100,
        ...Object.fromEntries(
          plan.schedules.map((s) => {
            const entry = entryOf(plan, s.id, block.id)
            const cut = entry.year !== null && (entry.shape ?? block.shapes[0].id) === shape.id
            return [`cut_${s.name}`, cut ? entry.year : null]
          }),
        ),
      },
    })),
  )
  const baseline: Feature[] = plan.baseline.map((d) => ({
    type: 'Feature',
    geometry: d.geometry,
    properties: {
      layer: 'baseline',
      name: d.name,
      kind: d.kind,
      year: d.year,
      year_basis: d.yearBasis,
      source: d.source ?? null,
    },
  }))
  return { type: 'FeatureCollection', features: [...blocks, ...baseline] }
}

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`)

export function summaryHtml(plan: Plan, result: PlanAnalysis, library: Pack[], generatedOn: string) {
  const record = assessmentRecord(plan, result, library, generatedOn)
  const years = periodYears(plan.area.startYear)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const trendYear = record.landscapeReview.trendYear
  const at = years.indexOf(trendYear)
  const row = (cells: unknown[], tag = 'td') => `<tr>${cells.map((c) => `<${tag}>${escape(c)}</${tag}>`).join('')}</tr>`
  const schedules = result.runs
    .map(
      (run) => `<h3>${escape(names[run.schedule])}</h3>
<table><thead>${row(['Year', 'Young ha', ...table.labels, 'A class moved away'], 'th')}</thead><tbody>
${run.periods.map((p, i) => row([p.year, p.totalHa.toFixed(1), ...p.classes.map((c) => pct(c.percent)), run.movedAway[i] === null ? '—' : run.movedAway[i] ? 'Yes' : 'No'])).join('\n')}
</tbody></table>`,
    )
    .join('\n')
  const published = record.published
    ? `<h2>Published 2015 and 2018</h2>
<table><thead>${row(['Patch size', 'Target', ...record.published.observations.map((o) => o.year)], 'th')}</thead><tbody>
${table.labels.map((label, b) => row([label, pct(record.published!.target[b]), ...record.published!.observations.map((o) => pct(o.shares[b]))])).join('\n')}
</tbody></table>
<p class="note">${record.published.observations.map((o) => `${o.year}: ${escape(o.method)}`).join(' · ')}. Source: ${escape(record.published.source.label)}.</p>`
    : ''
  const outOfDate = '<p class="warn">The plan changed after this was calculated; it is shown as it was.</p>'
  const board = record.boardCheck
  const boardHtml =
    board && record.published
      ? `<h3>Check of the method against these figures</h3>
${board.current ? '' : outOfDate}
<table><thead>${row(['Patch size', ...board.years.map((y) => `${y.year} modelled (Board)`)], 'th')}</thead><tbody>
${table.labels
  .map((label, b) =>
    row([
      label,
      ...board.years.map((y) => {
        const o = record.published!.observations.find((x) => x.year === y.year)
        return `${pct(y.shares[b])} (${o ? pct(o.shares[b]) : '—'})`
      }),
    ]),
  )
  .join('\n')}
</tbody></table>
<p class="note">The plan’s calculation on its baseline alone, run ${escape(board.ranOn)}. Young forest modelled: ${board.years.map((y) => `${y.year} ${y.totalHa.toFixed(0)} ha`).join(' · ')}. The Board used other inventories, and 2018 the revised 2017 guidance: a difference tests the inputs and the method together.</p>`
      : ''
  const old = record.oldForest
  const oldUnit = old ? oldForestUnit(old.district, old.unit) : null
  const oldHtml = old
    ? `<h2>Old and old interior forest · ${escape(old.unit)}</h2>
${old.current ? '' : outOfDate}
<p class="note">${escape(old.source)}. VRI projected to ${old.projectedYear}, age-based and not field-verified. ${
        oldUnit
          ? `${oldUnit.oldPercent}% of the CFLB old, ${oldUnit.interiorPercent}% of that interior. ${escape(oldUnit.ageBasis)}`
          : ''
      } ${old.choices?.cflbEnteredHa !== undefined ? `CFLB as stated${old.choices?.cflbSource ? ` (${escape(old.choices.cflbSource)})` : ''}, with the VRI proxy’s shares applied to it.` : 'CFLB by the VRI proxy (treed, forest management land base).'}${
        oldUnit && gisDisagrees(oldUnit, old.gisFraction) ? ` ${escape(gisDisagrees(oldUnit, old.gisFraction))}` : ''
      }</p>
${old.schedules
  .map(
    (s) => `<h3>${escape(names[s.schedule] ?? s.schedule)}: ${(() => {
      const f = old.shortfalls.find((x) => x.schedule === s.schedule)?.first
      return f ? `short of ${escape(f.what.join(', '))} from ${f.year}` : 'no shortfall over the projection'
    })()}</h3>
<table><thead>${row(['Year', 'Old ha (required)', 'Old non-pine ha (required)', 'Old interior ha (required)'], 'th')}</thead><tbody>
${s.years
  .map((y) =>
    row([
      y.year,
      `${y.oldHa.toFixed(0)} (${y.requiredOldHa.toFixed(0)})`,
      y.requiredNonPineHa === null
        ? `${y.nonPineOldHa.toFixed(0)} (none stated)`
        : `${y.nonPineOldHa.toFixed(0)} (${y.requiredNonPineHa.toFixed(0)})`,
      y.interiorHa === null ? '—' : `${y.interiorHa.toFixed(0)} (${y.requiredInteriorHa.toFixed(0)})`,
    ]),
  )
  .join('\n')}
</tbody></table>`,
  )
  .join('\n')}
${
  old.calibration2019 && old.board2019
    ? `<p class="note">2019, baseline only, against the Board (${escape(BOARD_2019_SOURCE.label)}): CFLB ${old.calibration2019.cflbHa.toFixed(0)} ha (${old.board2019.cflbHa}), old ${old.calibration2019.oldHa.toFixed(0)} ha (${old.board2019.oldHa}), interior ${old.calibration2019.interiorHa?.toFixed(0) ?? '—'} ha (${old.board2019.interiorHa}).</p>`
    : ''
}`
    : ''
  const pathwayHtml = record.pathways
    .map(
      (p) => `<h3>${escape(p.id)} · ${escape(p.title)} — ${escape(p.status)}</h3>
<ul>${p.steps.map((s) => `<li><strong>${escape(s.label)}</strong> (${escape(s.state)}): ${escape(s.detail)}</li>`).join('')}</ul>`,
    )
    .join('\n')
  const index = record.planningIndex
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Block plan assessment</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;max-width:920px;margin:24px auto;padding:0 16px;color:#1b1b19;background:#fff}
table{border-collapse:collapse;margin:8px 0 16px;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}
th{font-weight:600}.note{color:#555;font-size:12px}.warn{border-left:3px solid #b45309;padding:4px 8px;background:#fffbeb}
@media print{body{margin:0}}
</style></head><body>
<h1>Block plan assessment</h1>
<p>${escape(plan.area.district || 'No district')} · ${escape(plan.area.ndu || 'No sub-unit')} · first projection year ${plan.area.startYear} · prepared ${escape(generatedOn)}</p>
<p class="note">Inventory: ${escape((plan.area.source.trim() || 'not stated').replace(/[.]$/, ''))}${plan.area.snapshotDate ? ` (${escape(plan.area.snapshotDate)})` : ''}.</p>
<p class="warn">Advisory. No figure here decides that the order applies, that a block complies, or that a pathway is met.</p>
<h2>Schedules</h2>
<table><thead>${row(['Schedule', `In ${trendYear}: ${table.labels.join(' · ')}`], 'th')}</thead><tbody>
${result.runs.map((run) => row([names[run.schedule] + (run.schedule === plan.reviewSchedule ? ' (under review)' : ''), run.periods[at]?.classes.map((c) => pct(c.percent)).join(' · ')])).join('\n')}
</tbody></table>
${schedules}
${published}
${boardHtml}
${oldHtml}
<h2>D.5 pathways</h2>
<p class="note">Trend measured over ${trendYear - 5}–${trendYear} for the schedule under review.</p>
${pathwayHtml}
${plan.landscape.rationale ? `<h3>Rationale draft</h3><p>${escape(plan.landscape.rationale).replace(/\n/g, '<br>')}</p>` : ''}
<h2>Planning index</h2>
<p class="warn">Not a legal test. ${escape(index.formula)}.</p>
<table><thead>${row(['Schedule', 'Index', ...INDEX_INDICATORS.map((i) => i.label)], 'th')}</thead><tbody>
${index.rows.map((r) => row([names[r.schedule], r.score === null ? '—' : r.score.toFixed(1), ...r.parts.map((p) => (p.raw === null ? '—' : p.raw.toFixed(1)))])).join('\n')}
</tbody></table>
<h2>Limitations</h2>
<ul>${LIMITATIONS.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>
</body></html>
`
}

/** Builds one output's file text. `result` is needed only by the outputs that read the run. */
export function buildExport(
  id: BlockPlanningExport,
  plan: Plan,
  result: PlanAnalysis | undefined,
  library: Pack[],
  generatedOn: string,
): string {
  if (id === 'plan') return JSON.stringify(plan, null, 2)
  if (id === 'geojson') return JSON.stringify(blocksGeoJson(plan), null, 2)
  if (!result) throw Error('The patch calculation has not finished. Set the reporting unit and wait for the run.')
  if (id === 'record') return JSON.stringify(assessmentRecord(plan, result, library, generatedOn), null, 2)
  return summaryHtml(plan, result, library, generatedOn)
}
