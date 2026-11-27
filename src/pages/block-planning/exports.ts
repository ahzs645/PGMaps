/**
 * Everything the block planner writes, built from the same state the page shows. Save & export
 * (`SaveExportDialog.tsx`) is the only place these are offered.
 *
 * - **Plan file**: the plan itself, to reopen and keep working.
 * - **Assessment record**: the plan with every schedule's periods, the published comparators, both
 *   reviews' findings as the evaluator gave them (each stream crossing's on its own, with the block's
 *   roll-up beside them), the D.5 checklists and the planning index, so a reviewer can rerun or
 *   audit the assessment.
 * - **Blocks and baseline (GeoJSON)**: each block shape with the year each schedule cuts it, and
 *   each past disturbance, for GIS.
 * - **Summary (HTML)**: a printable page of the same figures.
 * - **Records to request (text)**: the drafted letters for the records the reviews lack, one per
 *   channel per block, each with its freedom of information variant. Drafts only: nothing is sent.
 *
 * DOM- and network-free: the rule library and the patch result are passed in.
 */
import { documentTitle, titleFileStem } from '@/lib/documentTitle'
import type { Feature, FeatureCollection } from 'geojson'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { escapeHtml as escape } from '@/lib/escapeHtml'
import { assess } from '../../../packages/legal-rules/engine/evaluate'
import { releaseKey, type Pack } from '../../../packages/legal-rules/src/contract'
import { table } from '../forest-patches/project'
import { publishedUnit } from './observations'
import { entryOf, periodYears, type MappedEvidence, type Plan, type ReviewCase } from './plan'
import type { PlanAnalysis } from './planAnalysis'
import { DEFAULT_INDEX_WEIGHTS, indexFormula, INDEX_INDICATORS, planningIndex } from './planningIndex'
import { pathways, trendYearOf } from './review/pathways'
import { featureMeasure, GROUP_LABELS, layerSummary, MAPPED_LAYER_INFO } from './review/grazingEvidence'
import { mappedReadCurrent, rangeReviewCurrent } from './review/rangeReview'
import { STANDING_WORDS } from './review/wording'
import { corridorSentence, excludedSentence } from './oldForest/recordText'
import { BOARD_2019_SOURCE, gisDisagrees, oldForestUnit } from './oldForest/units'
import {
  BREAKDOWN_LABELS,
  pineSplit,
  REPRESENTATION_BREAKDOWNS,
  REPRESENTATION_SOURCES,
  rowLabel,
  shares,
  type RepresentationYear,
} from './oldForest/representation'
import {
  boardCheckCurrent,
  firstShortfall,
  metOnlyWithD4,
  oldForestCurrent,
  shortfallText,
  type OldForestRecord,
} from './records'
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  BINDS_LABELS,
  GROUND_CATALOGUE,
  groundInstrument,
  groundLayer,
  REACH_LABELS,
} from '@/lib/legal/groundInstruments'
import { precedentSummary } from './ground/precedent'
import { failedByReason, groundReadCurrent, nearText, type GroundRead } from './ground/record'
import { documentRequests } from './ground/requests'
import { exceptionsToRequest, wildlifeCitesText, wildlifeRows, withheldRequests } from './ground/wildlifeMeasures'
import { CROSSING_ORIGIN_LABELS, CROSSING_ROLE_LABELS, CROSSING_STRUCTURE_LABELS } from './crossings/record'
import { assessCrossing, CROSSING_STANDING_WORDS, crossingRollup, type CrossingAssessment } from './crossings/standing'
import { channelOf, gapKindOf } from './acquire/channels'
import { blockGaps, gapSubject, planGaps } from './acquire/gaps'
import { FSP_BASIS_LABELS, RECORD_ID_FIELDS, RECORD_ID_LABELS, REQUEST_EVENT_LABELS } from './acquire/record'
import { draftLetters, lettersText } from './acquire/requests'
import { requestStanding } from './acquire/status'

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
      'The plan with every schedule’s periods, the published comparators, review findings, the D.5 checklists and the planning index.',
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
  {
    id: 'requests',
    label: 'Records to request (text)',
    description:
      'The drafted requests for the records the reviews cannot answer from public data: one per channel per block, each with its freedom of information version. Nothing is sent.',
    fileName: 'block-records-requests.txt',
    type: { mime: 'text/plain', extension: 'txt', description: 'Text' },
    needsResult: false,
  },
] as const
export type BlockPlanningExport = (typeof BLOCK_PLANNING_EXPORTS)[number]['id']

/** The summary's heading while the planner has typed no title of their own (`Plan.title`). */
export const SUMMARY_HEADING = 'Block plan assessment'

/** An output's file name: the summary is named from the planner's own title once there is one; the data files never. */
export function exportFileName(id: BlockPlanningExport, plan: Pick<Plan, 'title'>): string {
  const output = BLOCK_PLANNING_EXPORTS.find((o) => o.id === id)!
  return id === 'summary' && plan.title
    ? `${titleFileStem(plan.title, 'block-assessment')}-summary.html`
    : output.fileName
}

export const LIMITATIONS = [
  'Advisory: no finding decides that the order applies, that a block complies, or that an exception or pathway is met.',
  'Young-forest patches are calculated with method pg-2005-buffer-v1, from the December 2005 implementation policy, and are not yet validated against the province’s own GIS outputs.',
  'Only the baseline’s stand-replacing disturbances and the schedules’ blocks are modelled; the reporting unit’s coverage is as stated in the plan.',
  'Old and old-interior forest (Objectives A and B) are calculated only when assessed, from VRI ages (not field-verified), a VRI proxy for the CFLB unless one is stated, and the assumptions in the guide.',
  'The published 2015 and 2018 figures came from other inventories, and 2018 used the revised 2017 guidance.',
  'The planning index ranks options for discussion; it is not a legal test.',
  '“On this ground” lists the instruments DataBC maps on a block and what each can reach, as read from the provisions it cites; it is a screen, never a legal determination, and an instrument that is not mapped can still apply.',
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
      distanceGrowth: run.distanceGrowth,
    })),
    published: publishedUnit(plan.area.district, plan.area.ndu),
    landscapeReview: { trendYear: trendYearOf(plan), assessment: review(order, library) },
    blockReviews: Object.fromEntries(Object.entries(plan.reviews).map(([id, r]) => [id, review(r, library)])),
    rangeReviews: (plan.rangeReviews ?? []).map((record) => {
      const current = rangeReviewCurrent(plan, record)
      return {
        ...record,
        current,
        mappedCurrent: mappedReadCurrent(plan, record),
        assessment: current ? review(record.review, library) : null,
      }
    }),
    groundReads: (plan.groundReads ?? []).map((read) => groundRecord(plan, read)),
    crossings: crossingRecords(plan, library),
    acquisition: acquisitionRecord(plan, library, generatedOn),
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
            ...(plan.checks!.oldForest!.younger
              ? { metOnlyWithD4: metOnlyWithD4(s.years), text: shortfallText(s.years) }
              : {}),
          })),
          board2019: oldForestUnit(plan.checks.oldForest.district, plan.checks.oldForest.unit)?.board2019 ?? null,
          ...(plan.checks.oldForest.pool
            ? {
                board2019ByUnit: plan.checks.oldForest.pool.map((u) => ({
                  district: u.district,
                  unit: u.unit,
                  board2019: oldForestUnit(u.district, u.unit)?.board2019 ?? null,
                })),
              }
            : {}),
          ...plan.checks.oldForest,
        }
      : null,
    limitations: LIMITATIONS,
  }
}

/**
 * Each block's stream crossings per schedule: every crossing with its own assessment, and the
 * block's roll-up (the worst standing, with the crossings at it), derived here and never stored.
 */
function crossingRecords(plan: Plan, library: Pack[]) {
  const pairs = [...new Set((plan.crossings ?? []).map((c) => JSON.stringify([c.block, c.schedule])))].map(
    (k) => JSON.parse(k) as [string, string],
  )
  return pairs.map(([block, schedule]) => {
    const rollup = crossingRollup(plan, block, schedule, library)
    return {
      block,
      schedule,
      standing: rollup.standing,
      worst: rollup.worst.map((c) => c.record.key),
      crossings: rollup.crossings.map((c) => ({
        ...c.record,
        current: c.current,
        standing: c.standing,
        openQuestions: c.openQuestions,
        assessment: c.report ?? { error: c.error },
      })),
    }
  })
}

/**
 * Records asked for and received: each request's status, dates and references, worked out against
 * the gaps as they stand, and each received record with the values the reviewer transcribed. The
 * documents themselves are never kept, so nothing else of them is printed.
 */
function acquisitionRecord(plan: Plan, library: Pack[], today: string) {
  const a = plan.acquisition
  const derived = new Map<string, Set<string>>()
  const gapsOf = (block: string, schedule: string) => {
    const key = `${block}|${schedule}`
    if (!derived.has(key)) derived.set(key, new Set(blockGaps(plan, library, block, schedule).map((g) => g.id)))
    return derived.get(key)!
  }
  return {
    ids: a?.ids ?? [],
    requests: (a?.requests ?? []).map((r) => {
      const standing = requestStanding(r, channelOf(r.channel), today, gapsOf(r.block, r.schedule).has(r.gap))
      return {
        ...r,
        state: standing.state,
        due: standing.due ?? null,
        overdue: standing.overdue,
        noLongerNeeded: standing.noLongerNeeded,
      }
    }),
    received: (a?.received ?? []).map((r) => ({
      ...r,
      values: r.values.map((v) => ({ ...v, transcribedBy: 'reviewer' as const })),
    })),
  }
}

/** The summary's section on records asked for and received; empty when there are none. */
function acquisitionHtml(plan: Plan, library: Pack[], today: string, names: Record<string, string>) {
  const a = plan.acquisition
  const requests = a?.requests ?? []
  const received = a?.received ?? []
  const stated = (a?.ids ?? []).filter((i) => i.fsp || RECORD_ID_FIELDS.some((f) => i[f]))
  if (!requests.length && !received.length && !stated.length) return ''
  const blockName = (id: string) => plan.blocks.find((b) => b.id === id)?.name ?? id
  const cell = (c: unknown) => `<td>${escape(c)}</td>`
  const record = acquisitionRecord(plan, library, today)
  const statedHtml = stated.length
    ? `<h3>Identifiers and the plan relied on, as the reviewer stated them</h3>
<ul>${stated
        .map(
          (i) =>
            `<li>${escape(blockName(i.block))}: ${escape(
              [
                ...RECORD_ID_FIELDS.flatMap((f) => (i[f] ? [`${RECORD_ID_LABELS[f]} ${i[f]}`] : [])),
                ...(i.permitIssued ? [`permit issued ${i.permitIssued}`] : []),
                ...(i.fsp
                  ? [
                      `FSP ${i.fsp.id}${i.fsp.amendment ? ` amendment ${i.fsp.amendment}` : ''}, identified by: ${FSP_BASIS_LABELS[i.fsp.basis]} (${i.fsp.statedOn})`,
                    ]
                  : []),
              ].join(' · '),
            )}</li>`,
        )
        .join('')}</ul>`
    : ''
  const requestsHtml = record.requests.length
    ? `<h3>Requests</h3>
<table><thead><tr><th>For</th><th>Record</th><th>Through</th><th>Status</th><th>Events</th></tr></thead><tbody>
${record.requests
  .map((r) => {
    const kind = r.gap.split(':')[0] as Parameters<typeof gapKindOf>[0]
    const crossing = r.gap.split(':')[3]
    const status = `${REQUEST_EVENT_LABELS[r.state as keyof typeof REQUEST_EVENT_LABELS] ?? r.state}${r.due ? ` · due ${r.due}` : ''}${r.overdue ? ' · overdue' : ''}${r.noLongerNeeded ? ' · no longer needed' : ''}`
    const events = r.events
      .map((e) => `${REQUEST_EVENT_LABELS[e.status]} ${e.date}${e.reference ? ` (${e.reference})` : ''}`)
      .join('; ')
    return `<tr>${cell(`${gapSubject(plan, { block: r.block, crossing })} · ${names[r.schedule] ?? r.schedule}`)}${cell(gapKindOf(kind)?.label ?? kind)}${cell(channelOf(r.channel)?.label ?? r.channel)}${cell(status)}${cell(events)}</tr>`
  })
  .join('\n')}
</tbody></table>`
    : ''
  const receivedHtml = received.length
    ? `<h3>Received</h3>
<p class="note">Each value is the reviewer’s transcription of the record; the record itself is not kept. A value counts only where the reviewer used it.</p>
<ul>${received
        .map(
          (r) =>
            `<li><strong>${escape(r.title)}</strong> · ${escape(blockName(r.block))} · from ${escape(channelOf(r.from)?.label ?? r.from)} · ${r.documentDate ? `dated ${escape(r.documentDate)} · ` : ''}received ${escape(r.receivedOn)}${r.reference ? ` · ${escape(r.reference)}` : ''}${r.severed ? ` · severed${r.severedNote ? ` (${escape(r.severedNote)})` : ''}` : ''}${
              r.values.length
                ? `<ul>${r.values
                    .map(
                      (v) =>
                        `<li>${escape(v.label)}: ${escape(v.value)}${v.page ? ` (p. ${escape(v.page)})` : ''}${v.uses?.length ? ` — used: ${escape(v.uses.map((u) => `${u.target} (${u.on})`).join('; '))}` : ' — not used'}</li>`,
                    )
                    .join('')}</ul>`
                : ''
            }</li>`,
        )
        .join('')}</ul>`
    : ''
  return `<h2>Records asked for and received</h2>
<p class="note">What the reviews could not answer from public data, and what was done to get it. A received record answers nothing until the reviewer uses a value from it.</p>
${statedHtml}
${requestsHtml}
${receivedHtml}`
}

/** A ground read for the record: the read, whether it is current, and the catalogue's reach for what it found. */
function groundRecord(plan: Plan, read: GroundRead) {
  const block = plan.blocks.find((b) => b.id === read.block)
  return {
    ...read,
    current: groundReadCurrent(plan, read),
    screenOnly: true,
    catalogueRead: GROUND_CATALOGUE.readOn,
    reach: read.instruments
      .filter((r) => r.features.length)
      .map((r) => {
        const x = groundInstrument(r.instrument)
        if (!x) return { instrument: r.instrument, inCatalogue: false }
        return {
          instrument: x.id,
          label: x.label,
          statute: x.statute,
          binds: x.binds,
          reach: x.reach,
          terms: x.terms,
          facts: x.facts,
          precedent: !hasPrecedent(x.layer)
            ? 'Not read for a line or point layer'
            : read.precedent
              ? precedentSummary(read.precedent, x.id)
              : 'Not read',
          ...(wildlifeRows(x, r)
            ? {
                byOrder: wildlifeRows(x, r)!.map((w) => ({
                  order: w.orderId,
                  status: w.status,
                  ...(w.order ? { title: w.order.title, url: w.order.url, decided: w.order.decided } : {}),
                  features: w.features.map((f) => f.id),
                  reach: w.reach,
                  binds: w.binds,
                })),
              }
            : {}),
        }
      }),
    requests: [
      ...documentRequests(read, block?.name ?? read.block),
      ...withheldRequests(read, groundInstrument, block?.name ?? read.block),
    ],
    exceptions: exceptionsToRequest(read, groundInstrument).map((x) => ({
      order: x.order.id,
      title: x.order.title,
      url: x.order.url,
      units: x.units,
      clauses: x.clauses,
      route: x.route,
    })),
  }
}

/** Precedent is read inside area instruments only: a line or a point holds no openings. */
const hasPrecedent = (layer: string) => (groundLayer(layer)?.geometry ?? 'area') === 'area'

/** Where each layer without a date keeps one, printed once under the precedent. */
function undated(layers: string[]) {
  const notes = [...new Set(layers)].flatMap((id) => {
    const l = groundLayer(id)
    return l && !l.date && l.dateNote ? [l.dateNote] : []
  })
  return notes.length ? `<p class="note">${escape(notes.join(' '))}</p>` : ''
}

/** The exempt cut blocks and ALR applications the precedent read, listed under it. */
function precedentLists(read: GroundRead) {
  const p = read.precedent
  if (!p) return ''
  const blocks = p.exemptBlocks ?? []
  const alr = p.alrApplications ?? []
  return [
    blocks.length
      ? `<p class="note">Cut blocks marked exempt from a silviculture prescription (Forest Practices Code s. 30; the exemption and its reason are not public): ${escape(
          blocks
            .map((b) =>
              [
                b.forestFileId,
                b.cuttingPermit && `CP ${b.cuttingPermit}`,
                b.cutBlock && `block ${b.cutBlock}`,
                b.harvested,
              ]
                .filter(Boolean)
                .join(' '),
            )
            .join('; '),
        )}.</p>`
      : '',
    alr.length
      ? `<p class="note">ALR applications and notices of intent (the Commission's decisions are not in the layer): ${escape(
          alr
            .map(
              (a) =>
                `${a.kind} ${a.id}${a.received ? `, received ${a.received}` : ''}${a.components ? `, ${a.components}` : ''}`,
            )
            .join('; '),
        )}.</p>`
      : '',
  ].join('')
}

/** A ground read as it prints: the matrix with each cell's provisions, what was not read, the precedent and the requests. */
function groundHtml(plan: Plan, read: GroundRead, names: Record<string, string>) {
  const cell = (c: unknown) => `<td>${escape(c)}</td>`
  const block = plan.blocks.find((b) => b.id === read.block)
  const shape = block?.shapes.find((s) => s.id === read.shape)
  const found = read.instruments.flatMap((r) => {
    const x = groundInstrument(r.instrument)
    return x && r.features.length ? [{ r, x }] : []
  })
  const label = (id: string) => groundInstrument(id)?.label ?? id
  const failed = read.instruments.filter((r) => r.status === 'failed')
  const empty = read.instruments.filter((r) => r.status !== 'failed' && !r.features.length)
  const requests = [
    ...documentRequests(read, block?.name ?? read.block),
    ...withheldRequests(read, groundInstrument, block?.name ?? read.block),
  ]
  const exceptions = exceptionsToRequest(read, groundInstrument)
  const share = (v: number) => (read.footprintHa > 0 ? (v / read.footprintHa) * 100 : 0).toFixed(1)
  // A range or habitat area whose order was read prints the order's answer, one row per order and answer.
  const matrix = found.flatMap(({ r, x }) => {
    const own = wildlifeRows(x, r)
    if (!own)
      return [
        {
          x,
          title: `${x.label}: ${r.features.map((f) => f.id).join(', ')}`,
          covered: r.coveredHa,
          near: r.near,
          reach: x.reach,
          binds: x.binds,
        },
      ]
    return own.map((w) => ({
      x,
      title: `${x.label} · ${w.label}: ${w.features.map((f) => f.id).join(', ')}`,
      covered: w.overlapHa,
      near: undefined,
      reach: w.reach,
      binds: w.binds,
    }))
  })
  return `<h3>${escape(names[read.schedule] ?? read.schedule)} · ${escape(block?.name ?? read.block)} · ${escape(shape?.name ?? read.shape)} · read ${escape(read.readOn)}</h3>
${groundReadCurrent(plan, read) ? '' : '<p class="warn">The block shape changed since this read. Read it again before relying on it.</p>'}
<p class="note">DataBC layers read against the ${read.footprintHa.toFixed(2)} ha footprint, each cell from the provisions it cites (catalogue ${escape(read.catalogue)}). A screen, never a legal determination: it decides no fact, and an instrument that is not mapped can still apply.</p>
${
  found.length
    ? `<table><thead><tr><th>Instrument</th><th>On the block</th>${ACTIVITIES.map((a) => `<th>${ACTIVITY_LABELS[a]}</th>`).join('')}<th>Binds</th><th>Terms public</th></tr></thead><tbody>
${matrix
  .map(
    (m) =>
      `<tr>${cell(m.title)}${cell(m.near ? nearText(m.near) : `${m.covered.toFixed(2)} ha · ${share(m.covered)}%`)}${ACTIVITIES.map((a) => cell(`${REACH_LABELS[m.reach[a].state]}. ${m.reach[a].note} (${wildlifeCitesText(m.reach[a].cites)})`)).join('')}${cell(`${BINDS_LABELS[m.binds.kind]} (${wildlifeCitesText(m.binds.cites)})`)}${cell(m.x.terms.public ? 'Yes' : `No: ${m.x.terms.where}`)}</tr>`,
  )
  .join('\n')}
</tbody></table>`
    : '<p>None of the instruments read is mapped on this footprint.</p>'
}
${failedByReason(failed)
  .map(({ reason, ids }) => `<p class="warn">Not read: ${escape(ids.map(label).join(', '))}. ${escape(reason)}</p>`)
  .join('\n')}
${empty.length ? `<p class="note">Read, nothing mapped on the footprint: ${escape(empty.map((r) => label(r.instrument)).join(', '))}.</p>` : ''}
${
  found.length && read.precedent
    ? `<h4>Precedent within ${read.precedent.radiusM / 1000} km (RESULTS and other public records)</h4>
<ul>${found
        .filter(({ x }) => hasPrecedent(x.layer))
        .map(
          ({ x }) => `<li><strong>${escape(x.label)}</strong>: ${escape(precedentSummary(read.precedent!, x.id))}</li>`,
        )
        .join('')}</ul>
${undated(found.map(({ x }) => x.layer))}${precedentLists(read)}`
    : ''
}
${
  requests.length
    ? `<h4>Documents to request</h4>
<ul>${requests.map((q) => `<li><strong>${escape(q.label)}</strong> (${escape(q.identifiers.join('; '))}): ${escape(`ask ${q.holder}, through ${q.channel}`)}.</li>`).join('')}</ul>`
    : ''
}
${
  exceptions.length
    ? `<h4>Exceptions the wildlife orders provide</h4>
<p class="note">What each order read here says may proceed, or may be approved, despite its measures, and who decides. Nothing here says an exception applies or would be granted.</p>
<ul>${exceptions.map((e) => `<li><strong>${escape(e.order.title)}</strong> (${escape(e.units.join(', '))}): ${e.clauses.length ? e.clauses.map((c) => escape(`${c.ref}${c.inOrder ? '' : ' (guidance, not part of the order)'}: ${c.says} “${c.quote}” Decides: ${c.by}.`)).join(' ') : 'The order states no exception or approval of its own.'} ${escape(`${e.route.text} (${wildlifeCitesText(e.route.cites)})`)}</li>`).join('')}</ul>`
    : ''
}`
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
const growthText = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)

/**
 * D.3's summary for the printed record: what the order and the policy say representative refers
 * to, then, for each unit, old forest beside the CFLB by breakdown in the first and last years of
 * the schedule under review. Figures only, never a verdict.
 */
function representationHtml(
  old: Pick<OldForestRecord, 'unit' | 'representation' | 'pool'>,
  names: Record<string, string>,
  row: (cells: unknown[], tag?: string) => string,
): string {
  const units = old.pool
    ? old.pool.map((u) => ({ unit: u.unit, representation: u.representation }))
    : [{ unit: old.unit, representation: old.representation }]
  if (!units.some((u) => u.representation)) return ''
  const share = (v: number | null) => (v === null ? '—' : pct(v * 100))
  const cell = (ha: number, s: number | null) => `${ha.toFixed(0)} (${share(s)})`
  return `<h3>Representative stands (D.3)</h3>
${REPRESENTATION_SOURCES.map((q) => `<blockquote class="note">“${escape(q.text)}” (${escape(q.cite)})</blockquote>`).join('\n')}
<p class="note">Figures to help judge representativeness, never a pass or fail. The texts measure it by affected (pine-leading) and unaffected (non-pine) stands; the BEC variant, age class and site index breakdowns are context. Old forest includes ground counted whole under D.1 and never D.4's younger stands. Age classes are the provincial inventory's; site index classes are PGMaps' own 5 m steps of the VRI site index.</p>
${units
  .map(({ unit, representation: r }) => {
    if (!r) return `<p class="note">${escape(unit)}: no D.3 summary in this record (made before it).</p>`
    const ends = [r.years[0], r.years.at(-1)!].filter((y, i, all) => all.indexOf(y) === i) as RepresentationYear[]
    const splits = ends
      .map((y) => {
        const s = pineSplit(y)
        return `${y.year}: non-pine-leading ${share(s.nonPineCflbShare)} of the CFLB, old non-pine ${share(s.nonPineOldShare)} of old forest${s.nonPineInteriorShare === null ? '' : `, interior on non-pine old ground ${share(s.nonPineInteriorShare)} of old interior`}`
      })
      .join('; ')
    return `<h4>${escape(unit)} · ${escape(names[r.schedule] ?? r.schedule)} (under review)</h4>
<p class="note">${escape(splits)}.</p>
${REPRESENTATION_BREAKDOWNS.map((b) => {
  const keys = [...new Set(ends.flatMap((y) => y.by[b].map((x) => x.key)))]
  const at = ends.map((y) => new Map(shares(y.by[b]).map((x) => [x.key, x])))
  return `<table><thead>${row([BREAKDOWN_LABELS[b], ...ends.flatMap((y) => [`CFLB ha ${y.year}`, `Old ha ${y.year}`, `Old non-pine ha ${y.year}`])], 'th')}</thead><tbody>
${keys
  .map((k) =>
    row([
      rowLabel(b, k),
      ...at.flatMap((m) => {
        const x = m.get(k)
        return x
          ? [cell(x.cflbHa, x.cflbShare), cell(x.oldHa, x.oldShare), cell(x.nonPineOldHa, x.nonPineShare)]
          : ['—', '—', '—']
      }),
    ]),
  )
  .join('\n')}
</tbody></table>`
}).join('\n')}`
  })
  .join('\n')}`
}

/** A grazing review's mapped read, dated and named as candidates; a layer not read says so. */
type AssessedFinding = ReturnType<typeof assess>['releases'][number]['findings'][number]

/** A finding's claimed exception in one line: what is relied on, where it stands, and why. */
function exceptionLine(f: AssessedFinding) {
  const x = 'exception' in f ? f.exception : undefined
  if (!x) return ''
  const evidence = (x.claim.evidence ?? []).map(
    (e) => `${e.label}: ${[e.reference, e.date].filter(Boolean).join(', ')}`,
  )
  const decision = x.claim.decision?.by
    ? `Decided by ${x.claim.decision.by}${x.claim.decision.date ? ' on ' + x.claim.decision.date : ''}${x.claim.decision.reference ? ' (' + x.claim.decision.reference + ')' : ''}.`
    : ''
  return ` <em>${escape(STANDING_WORDS[x.standing])}:</em> ${escape(x.label)}.${x.claim.rationale ? ' ' + escape(x.claim.rationale) : ''}${decision ? ' ' + escape(decision) : ''}${evidence.length ? ' Evidence: ' + escape(evidence.join('; ')) + '.' : ''}`
}

/** Every exception relied on across the block reviews and their crossings, with its standing, rationale and evidence. */
function exceptionsHtml(
  plan: Plan,
  blockReviews: Record<string, ReturnType<typeof review>>,
  crossings: CrossingAssessment[],
) {
  const blockName = (id: string) => escape(plan.blocks.find((b) => b.id === id)?.name ?? id)
  const crossingRows = crossings.flatMap((c) =>
    c.raised
      .filter(({ finding }) => 'exception' in finding && finding.exception)
      .map(
        ({ pack, finding }) =>
          `<li><strong>${blockName(c.record.block)} · ${escape(c.record.label)}</strong> · ${escape(pack.title)}, ${escape(finding.title)} (§${escape(finding.provision)}).${exceptionLine(finding)}</li>`,
      ),
  )
  const rows = Object.entries(blockReviews).flatMap(([id, result]) =>
    result && 'releases' in result
      ? result.releases.flatMap((release) =>
          release.findings
            .filter((f) => 'exception' in f && f.exception)
            .map(
              (f) =>
                `<li><strong>${escape(plan.blocks.find((b) => b.id === id)?.name ?? id)}</strong> · ${escape(release.pack.title)}, ${escape(f.title)} (§${escape(f.provision)}).${exceptionLine(f)}</li>`,
            ),
        )
      : [],
  )
  rows.push(...crossingRows)
  return rows.length
    ? `<h2>Exceptions relied on</h2>
<p class="note">Each finding stays raised with the exception claimed on it; the reviewer's claim and evidence are the record.</p>
<ul>${rows.join('')}</ul>`
    : ''
}

/** One finding as the summary prints it: its title, provision and words, and any exception claimed on it. */
const findingItem = (f: AssessedFinding) =>
  `<li>${escape(f.title)} (§${escape(f.provision)}) — ${'finding' in f ? escape(f.finding) : ''}${exceptionLine(f)}</li>`

/** Each block's stream crossings per schedule: the roll-up, then each crossing with its own findings. */
function crossingsHtml(plan: Plan, library: Pack[], names: Record<string, string>) {
  const pairs = [...new Set((plan.crossings ?? []).map((c) => JSON.stringify([c.block, c.schedule])))].map(
    (k) => JSON.parse(k) as [string, string],
  )
  if (!pairs.length) return ''
  const cell = (c: unknown) => `<td>${escape(c)}</td>`
  return `<h2>Stream crossings</h2>
<p class="note">Each crossing is answered on its own; a block’s standing is the worst of its crossings, worked out from their answers and never kept. A finding flags a provision to review; none decides that a crossing complies.</p>
${pairs
  .map(([block, schedule]) => {
    const rollup = crossingRollup(plan, block, schedule, library)
    const name = plan.blocks.find((b) => b.id === block)?.name ?? block
    const worst = rollup.worst.map((c) => c.record.label).join(', ')
    return `<h3>${escape(name)} · ${escape(names[schedule] ?? schedule)}${rollup.standing ? ` — ${escape(CROSSING_STANDING_WORDS[rollup.standing])}: ${escape(worst)}` : ''}</h3>
<table><thead><tr><th>Crossing</th><th>Origin</th><th>Road</th><th>Structure</th><th>Standing</th><th>Findings</th></tr></thead><tbody>
${rollup.crossings
  .map((c) => {
    const s = c.record.structure
    const structure = s
      ? `${CROSSING_STRUCTURE_LABELS[s.kind]}${s.spanOrDiameterM === undefined ? '' : ` ${s.spanOrDiameterM} m`}`
      : 'Not stated'
    const findings = c.error
      ? `<p>${escape(c.error)}</p>`
      : `${c.raised.length ? `<ul>${c.raised.map(({ finding }) => findingItem(finding)).join('')}</ul>` : ''}${c.openQuestions ? `<p class="note">${c.openQuestions} question${c.openQuestions === 1 ? '' : 's'} to answer.</p>` : ''}`
    return `<tr>${cell(c.record.label + (c.current ? '' : ' (the block’s shape changed since it was listed)'))}${cell(CROSSING_ORIGIN_LABELS[c.record.origin])}${cell(CROSSING_ROLE_LABELS[c.record.role])}${cell(structure)}${cell(CROSSING_STANDING_WORDS[c.standing])}<td>${findings || '—'}</td></tr>`
  })
  .join('\n')}
</tbody></table>`
  })
  .join('\n')}`
}

function mappedHtml(mapped: MappedEvidence | undefined, current: boolean) {
  if (!mapped) return ''
  const cell = (c: unknown) => `<td>${escape(c)}</td>`
  const margin = mapped.layers.find((l) => l.marginM !== undefined)?.marginM
  const rows = mapped.layers.flatMap((layer) => {
    const title = MAPPED_LAYER_INFO[layer.layer].title
    if (!layer.features.length) return [`<tr>${cell(title)}<td colspan="3">${escape(layerSummary(layer))}</td></tr>`]
    return [
      ...(layer.status === 'truncated'
        ? [`<tr>${cell(title)}<td colspan="3">${escape(`Incomplete: ${layer.message}`)}</td></tr>`]
        : []),
      ...layer.features.map(
        (f) =>
          `<tr>${cell(title)}${cell(`${f.id} · ${f.name} (${GROUP_LABELS[f.group]})`)}${cell(featureMeasure(f, layer.marginM))}${cell(f.details.join(' · '))}</tr>`,
      ),
      // Lines and points: each kind's total, with a stretch two records share counted once.
      ...(layer.marginM !== undefined
        ? [`<tr>${cell(title)}<td colspan="3">${escape(`In all: ${layerSummary(layer)}`)}</td></tr>`]
        : []),
    ]
  })
  return `<h4>Mapped candidates · read ${escape(mapped.readOn)}</h4>
${current ? '' : '<p class="warn">The block shape changed since this read. Read it again before relying on it.</p>'}
<p class="note">DataBC layers read against the ${mapped.footprintHa.toFixed(2)} ha footprint${margin === undefined ? '' : `; range developments and natural barriers inside it and within ${margin} m of its edge`}. Candidates for the reviewer to weigh, never answers: the orders’ maps are a visual representation not for legal purposes, the legal descriptions, signed instruments and the district decide, and what is not mapped can still be on the ground.</p>
<table><thead><tr><th>Layer</th><th>Feature</th><th>Overlap · share, length or count</th><th>As DataBC gives it</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>`
}

export function summaryHtml(plan: Plan, result: PlanAnalysis, library: Pack[], generatedOn: string) {
  const title = documentTitle(plan.title, SUMMARY_HEADING)
  const record = assessmentRecord(plan, result, library, generatedOn)
  const years = periodYears(plan.area.startYear)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const trendYear = record.landscapeReview.trendYear
  const at = years.indexOf(trendYear)
  const row = (cells: unknown[], tag = 'td') => `<tr>${cells.map((c) => `<${tag}>${escape(c)}</${tag}>`).join('')}</tr>`
  const schedules = result.runs
    .map(
      (run) => `<h3>${escape(names[run.schedule])}</h3>
<table><thead>${row(['Year', 'Young ha', ...table.labels, 'Distance grew (points)', 'A class moved away'], 'th')}</thead><tbody>
${run.periods.map((p, i) => row([p.year, p.totalHa.toFixed(1), ...p.classes.map((c) => pct(c.percent)), growthText(run.distanceGrowth[i]), run.movedAway[i] === null ? '—' : run.movedAway[i] ? 'Yes' : 'No'])).join('\n')}
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
<p class="note">The plan’s calculation on its baseline’s harvests alone (fires left out, as the Board’s figures were built from harvest records), run ${escape(board.ranOn)}. Young forest modelled: ${board.years.map((y) => `${y.year} ${y.totalHa.toFixed(0)} ha`).join(' · ')}. The Board used other inventories, and 2018 the revised 2017 guidance: a difference tests the inputs and the method together.</p>`
      : ''
  const old = record.oldForest
  const oldUnit = old ? oldForestUnit(old.district, old.unit) : null
  const oldHtml = old
    ? `<h2>Old and old interior forest · ${escape(old.pool ? old.pool.map((u) => u.unit).join(' + ') : old.unit)}</h2>
${old.current ? '' : outOfDate}
<p class="note">${escape(old.source)}. VRI projected to ${old.projectedYear}, age-based and not field-verified. ${
        oldUnit
          ? `${oldUnit.oldPercent}% of the CFLB old, ${oldUnit.interiorPercent}% of that interior. ${escape(oldUnit.ageBasis)}`
          : ''
      } ${old.choices?.cflbEnteredHa !== undefined ? `CFLB as stated${old.choices?.cflbSource ? ` (${escape(old.choices.cflbSource)})` : ''}, with the VRI proxy’s shares applied to it.` : 'CFLB by the VRI proxy (treed, forest management land base).'}${
        oldUnit && gisDisagrees(oldUnit, old.gisFraction) ? ` ${escape(gisDisagrees(oldUnit, old.gisFraction))}` : ''
      } ${escape(excludedSentence(old))} ${escape(corridorSentence(old))}</p>
${old.pool ? `<p class="note">Pooled under D.2 by the reviewer: ${old.pool.map((u) => `${escape(u.unit)} (${escape(u.district)}, CFLB ${(u.cflbEnteredHa ?? u.cflbProxyHa).toFixed(0)} ha${u.cflbEnteredHa === undefined ? ' by the VRI proxy' : ' as stated'})`).join(', ')}. Each unit’s requirement is at its own percentage and old age; the figures below are the pool’s sums. ${old.pool.map((u) => escape(u.source)).join('. ')}.</p>` : ''}
${old.younger ? `<p class="note">D.4, as stated by the reviewer: stands from ${old.younger.fromAge} years up to the old age count toward up to 20% of the old and old interior requirements (never the non-pine one). Conservation benefit: ${escape(old.younger.benefit)}</p>` : ''}
${old.schedules
  .map(
    (s) => `<h3>${escape(names[s.schedule] ?? s.schedule)}: ${escape(shortfallText(s.years))}</h3>
<table><thead>${row(['Year', 'Old ha (required)', 'Old non-pine ha (required)', 'Old interior ha (required)', ...(old.younger ? ['D.4 old ha (available)', 'D.4 interior ha (available)'] : [])], 'th')}</thead><tbody>
${s.years
  .map((y) =>
    row([
      y.year,
      `${y.oldHa.toFixed(0)} (${y.requiredOldHa.toFixed(0)})`,
      y.requiredNonPineHa === null
        ? `${y.nonPineOldHa.toFixed(0)} (none stated)`
        : `${y.nonPineOldHa.toFixed(0)} (${y.requiredNonPineHa.toFixed(0)})`,
      y.interiorHa === null ? '—' : `${y.interiorHa.toFixed(0)} (${y.requiredInteriorHa.toFixed(0)})`,
      ...(old.younger
        ? [
            `${(y.d4OldHa ?? 0).toFixed(0)} (${(y.d4OldSupplyHa ?? 0).toFixed(0)})`,
            y.d4InteriorHa === null || y.d4InteriorHa === undefined
              ? '—'
              : `${y.d4InteriorHa.toFixed(0)} (${(y.d4InteriorSupplyHa ?? 0).toFixed(0)})`,
          ]
        : []),
    ]),
  )
  .join('\n')}
</tbody></table>`,
  )
  .join('\n')}
${(old.pool ?? [{ district: old.district, unit: old.unit, calibration2019: old.calibration2019 }])
  .map((u) => {
    // The Board's table is per unit: each unit with a Board row is set beside its own.
    const b = oldForestUnit(u.district, u.unit)?.board2019
    const c = u.calibration2019
    return c && b
      ? `<p class="note">${old.pool ? `${escape(u.unit)}: ` : ''}2019, baseline only, against the Board (${escape(BOARD_2019_SOURCE.label)}): CFLB ${c.cflbHa.toFixed(0)} ha (${b.cflbHa}), old ${c.oldHa.toFixed(0)} ha (${b.oldHa}), interior ${c.interiorHa?.toFixed(0) ?? '—'} ha (${b.interiorHa}).</p>`
      : ''
  })
  .join('\n')}
${representationHtml(old, names, row)}`
    : ''
  const pathwayHtml = record.pathways
    .map(
      (p) => `<h3>${escape(p.id)} · ${escape(p.title)} — ${escape(p.status)}</h3>
<ul>${p.steps.map((s) => `<li><strong>${escape(s.label)}</strong> (${escape(s.state)}): ${escape(s.detail)}</li>`).join('')}</ul>`,
    )
    .join('\n')
  const groundSection = (plan.groundReads ?? []).length
    ? `<h2>On this ground</h2>
${(plan.groundReads ?? []).map((read) => groundHtml(plan, read, names)).join('\n')}`
    : ''
  const crossingAssessments = (plan.crossings ?? []).map((c) => assessCrossing(plan, c, library))
  const index = record.planningIndex
  const rangeHtml = record.rangeReviews.length
    ? `<h2>Crown grazing and reforestation</h2>
${record.rangeReviews
  .map((r) => {
    const block = plan.blocks.find((b) => b.id === r.block)
    const shape = block?.shapes.find((s) => s.id === r.shape)
    const findings =
      r.assessment && 'releases' in r.assessment ? r.assessment.releases.flatMap((release) => release.findings) : []
    const rows = findings.filter((f) => f.status === 'review_required' || f.status === 'missing_evidence')
    const outsideWindow = findings.some((f) => f.status === 'outside_source_window')
    return `<h3>${escape(names[r.schedule] ?? r.schedule)} · ${escape(block?.name ?? r.block)} · ${escape(shape?.name ?? r.shape)} · ${r.harvestYear ?? 'No harvest scheduled'}</h3>
<p class="note">${r.current ? `Legal assessment date ${escape(r.review.date)}.` : 'The shape or harvest year changed. Review pending.'}</p>
${r.reference ? `<p>${escape(r.reference).replace(/\n/g, '<br>')}</p>` : ''}
${outsideWindow ? '<p>The assessment date is outside the rule pack’s source window.</p>' : ''}
${r.assessment && 'error' in r.assessment ? `<p>${escape(r.assessment.error)}</p>` : ''}
${rows.length ? `<ul>${rows.map((f) => `<li>${escape(f.title)} (§${escape(f.provision)}) — ${f.status === 'review_required' ? escape(f.finding) + exceptionLine(f) : 'Evidence needed.'}</li>`).join('')}</ul>` : ''}
${mappedHtml(r.mapped, r.mappedCurrent)}`
  })
  .join('\n')}`
    : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;max-width:920px;margin:24px auto;padding:0 16px;color:#1b1b19;background:#fff}
table{border-collapse:collapse;margin:8px 0 16px;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}
th{font-weight:600}.note{color:#555;font-size:12px}.warn{border-left:3px solid #b45309;padding:4px 8px;background:#fffbeb}
@media print{body{margin:0}}
</style></head><body>
<h1>${escape(title)}</h1>
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
${exceptionsHtml(plan, record.blockReviews, crossingAssessments)}
${crossingsHtml(plan, library, names)}
${acquisitionHtml(plan, library, generatedOn, names)}
${rangeHtml}
${groundSection}
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
  if (id === 'requests') return lettersText(plan, draftLetters(plan, planGaps(plan, library), generatedOn), generatedOn)
  if (!result) throw Error('The patch calculation has not finished. Set the reporting unit and wait for the run.')
  if (id === 'record') return JSON.stringify(assessmentRecord(plan, result, library, generatedOn), null, 2)
  return summaryHtml(plan, result, library, generatedOn)
}
