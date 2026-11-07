import type { Alignment, ContextFeature, Crossing, RoadAnalysis, RoadProject } from './types'
import type {
  CrossingCostItem,
  CrossingEstimate,
  CrossingEstimateRow,
  CrossingStructure,
  StreamCrossingRecord,
} from './crossingPlanTypes'
import { RIPARIAN_RULES } from './streamClass'

/** Same association tolerance as the engineering culvert geometry check. */
export const LEGACY_CULVERT_ASSOCIATION_M = 1

export const CROSSING_STRUCTURES: ReadonlyArray<{ value: CrossingStructure; label: string }> = [
  { value: 'undecided', label: 'Not selected' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'open-bottom', label: 'Open-bottom structure' },
  { value: 'embedded-culvert', label: 'Embedded culvert' },
  { value: 'closed-bottom-culvert', label: 'Closed-bottom culvert' },
  { value: 'ford', label: 'Ford' },
]
const hash = (value: string) => {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
const locationKey = (crossing: Crossing) =>
  `${crossing.featureId}:${crossing.coordinate.map((n) => n.toFixed(8)).join(',')}`

export function newCrossingCostItem(id: string, label = 'Structure supply and installation'): CrossingCostItem {
  return { id, label, quantity: 1, unit: 'item', unitRate: null, source: '', sourceUrl: '', priceDate: '' }
}

export function validCrossingPriceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

/** Null is different from zero. A priced row also carries the user's source and price date. */
export function priceCrossingItems(items: readonly CrossingCostItem[]) {
  let knownSubtotal = 0
  const missing: string[] = []
  for (const item of items) {
    if (item.quantity === null || item.unitRate === null) missing.push(`${item.label}: quantity or rate missing`)
    else if (!Number.isFinite(item.quantity * item.unitRate) || item.quantity < 0 || item.unitRate < 0)
      missing.push(`${item.label}: invalid quantity or rate`)
    else {
      knownSubtotal += item.quantity * item.unitRate
      if (!item.source.trim() || !validCrossingPriceDate(item.priceDate))
        missing.push(`${item.label}: source and price date required`)
      if (!item.label.trim() || !item.unit.trim()) missing.push('Estimate item description and unit required')
      if (item.sourceUrl && !/^https?:\/\/[^\s/]+/i.test(item.sourceUrl))
        missing.push(`${item.label}: use an http or https source link`)
    }
  }
  return { knownSubtotal, complete: missing.length === 0, missing }
}

/** Duplicated vertex intersections collapse; separate passages across a reach remain separate. */
export function reconcileCrossingRecords(
  alignment: Alignment,
  crossings: readonly Crossing[],
  context: readonly ContextFeature[],
) {
  const geometry = JSON.stringify([
    alignment.points.map((p) => [p.coordinate, p.radiusM, p.spiralM ?? 0]),
    alignment.vertical.map((p) => [p.chainage, p.elevation, p.curveLength]),
    alignment.template,
    alignment.overrides,
    alignment.engineering?.templates ?? [],
    alignment.engineering?.assignments ?? [],
  ])
  const streams = new Map(context.filter((f) => f.kind === 'stream').map((f) => [f.id, f]))
  const seen = new Map<string, number[]>()
  const occurrences = new Map<string, number>()
  const records = alignment.crossingRecords ?? []
  const used = new Set<string>()
  const rows: CrossingEstimateRow[] = []
  for (const crossing of [...crossings].filter((c) => c.kind === 'stream').sort((a, b) => a.chainage - b.chainage)) {
    const location = locationKey(crossing)
    const previous = seen.get(location) ?? []
    if (previous.some((s) => Math.abs(s - crossing.chainage) < 0.01)) continue
    seen.set(location, [...previous, crossing.chainage])
    const occurrence = occurrences.get(location) ?? 0
    occurrences.set(location, occurrence + 1)
    const identity = `${location}:${occurrence}`
    const feature = streams.get(crossing.featureId)
    const assessment = feature?.streamAssessment
    const basisFingerprint = hash(
      JSON.stringify([
        geometry,
        feature?.geometry ?? null,
        RIPARIAN_RULES,
        assessment
          ? [
              assessment.channelWidthM,
              assessment.oneKmAverageWidthM,
              assessment.fish,
              assessment.communityWatershed,
              assessment.importedClass,
              assessment.reviewedClass,
              assessment.reviewedFingerprint,
              assessment.reviewedRules,
            ]
          : null,
      ]),
    )
    const saved = records.find((r) => r.identity === identity && r.featureId === crossing.featureId)
    const record: StreamCrossingRecord = saved ?? {
      id: `crossing-${hash(alignment.id)}-${hash(identity)}`,
      featureId: crossing.featureId,
      identity,
      coordinate: [...crossing.coordinate],
      chainage: crossing.chainage,
      basisFingerprint,
      structure: 'undecided',
      evidence: '',
      items: [newCrossingCostItem(`item-${hash(identity)}`)],
    }
    if (saved) used.add(saved.id)
    const status = !saved ? 'unrecorded' : saved.basisFingerprint === basisFingerprint ? 'current' : 'needs-review'
    const priced = priceCrossingItems(record.items)
    const missing = [...priced.missing]
    if (status !== 'current')
      missing.push(
        status === 'unrecorded' ? 'Crossing record not saved' : 'Geometry or stream evidence changed; review required',
      )
    if (record.structure === 'undecided') missing.push('Structure option not selected')
    if (!record.items.length) missing.push('No estimate items')
    rows.push({
      record,
      name: crossing.name,
      chainage: crossing.chainage,
      status,
      basisFingerprint,
      knownSubtotal: priced.knownSubtotal,
      complete: !missing.length,
      missing,
    })
  }
  return { rows, retired: records.filter((r) => !used.has(r.id)) }
}

/** Add new records without deleting evidence or renewing a review on old records. */
export function synchronizeCrossingRecords(
  alignment: Alignment,
  crossings: readonly Crossing[],
  context: readonly ContextFeature[],
): StreamCrossingRecord[] {
  const result = reconcileCrossingRecords(alignment, crossings, context)
  return [
    ...(alignment.crossingRecords ?? []),
    ...result.rows.filter((r) => r.status === 'unrecorded').map((r) => r.record),
  ]
}

export function estimateCrossings(
  alignment: Alignment,
  analysis: Pick<RoadAnalysis, 'crossings' | 'engineering'>,
  context: readonly ContextFeature[],
  shared: readonly CrossingCostItem[] = [],
): CrossingEstimate {
  const { rows, retired } = reconcileCrossingRecords(alignment, analysis.crossings, context)
  const sharedPrice = priceCrossingItems(shared)
  const warnings = sharedPrice.missing.map((s) => `Shared crossing cost: ${s}.`)
  let crossingSubtotal = 0
  let replacedLegacyCost = 0
  const replaced = new Set<string>()
  for (const row of rows) {
    if (row.status === 'current') crossingSubtotal += row.knownSubtotal
    const associated =
      alignment.engineering?.culverts.filter(
        (c) =>
          c.sourceFeatureId === row.record.featureId &&
          Math.abs(c.chainage - row.chainage) <= LEGACY_CULVERT_ASSOCIATION_M,
      ) ?? []
    const linked = row.record.replacesCulvertId
    if (linked) {
      const culvert = alignment.engineering?.culverts.find((c) => c.id === linked)
      const calculated = analysis.engineering?.culverts.find((c) => c.id === linked)
      const matchingRows = culvert
        ? rows.filter(
            (r) =>
              r.record.featureId === culvert.sourceFeatureId &&
              Math.abs(r.chainage - culvert.chainage) <= LEGACY_CULVERT_ASSOCIATION_M,
          )
        : []
      if (
        row.status !== 'current' ||
        !culvert ||
        !calculated ||
        associated.length !== 1 ||
        matchingRows.length !== 1 ||
        associated[0].id !== linked ||
        replaced.has(linked)
      ) {
        if (row.status === 'current') crossingSubtotal -= row.knownSubtotal
        row.missing.push('Replacement culvert link needs review')
        row.complete = false
      } else {
        replaced.add(linked)
        replacedLegacyCost += calculated.installedCost
      }
    } else if (associated.length) {
      // Do not add two prices for the same installed structure. The user must choose the replacement.
      if (row.status === 'current') crossingSubtotal -= row.knownSubtotal
      row.missing.push('Existing engineering culvert: explicitly select its allowance for replacement')
      row.complete = false
    }
    for (const message of row.missing) warnings.push(`${row.name} at ${row.chainage.toFixed(1)} m: ${message}.`)
  }
  const knownSubtotal = crossingSubtotal + sharedPrice.knownSubtotal
  return {
    rows,
    retired,
    crossingSubtotal,
    sharedSubtotal: sharedPrice.knownSubtotal,
    knownSubtotal,
    replacedLegacyCost,
    replacedLegacyIds: [...replaced],
    incrementalSubtotal: knownSubtotal - replacedLegacyCost,
    complete: rows.every((r) => r.complete) && sharedPrice.complete,
    warnings,
  }
}

/** Proximity flags a possible duplicated allowance; it never attaches evidence or approves drainage. */
export function crossingScreeningOverlapCount(
  analysis: RoadAnalysis,
  modelled: readonly Pick<Crossing, 'chainage' | 'coordinate'>[],
  cellM: number,
): number {
  const priced = analysis.crossingEstimate?.rows.filter((row) => row.complete && row.status === 'current') ?? []
  return modelled.filter((crossing) =>
    priced.some((row) => {
      const station = analysis.stations.reduce<(typeof analysis.stations)[number] | undefined>(
        (best, current) =>
          !best || Math.abs(current.chainage - row.chainage) < Math.abs(best.chainage - row.chainage) ? current : best,
        undefined,
      )
      const radius =
        Math.max(
          station?.leftDaylightM ?? station?.leftWidth ?? 5,
          station?.rightDaylightM ?? station?.rightWidth ?? 5,
        ) +
        Math.max(2, cellM) * Math.SQRT2
      if (Math.abs(crossing.chainage - row.chainage) > radius) return false
      const dy = (((crossing.coordinate[1] - row.record.coordinate[1]) * Math.PI) / 180) * 6371008.8
      const dx =
        (((crossing.coordinate[0] - row.record.coordinate[0]) * Math.PI) / 180) *
        6371008.8 *
        Math.cos((row.record.coordinate[1] * Math.PI) / 180)
      return Math.hypot(dx, dy) <= radius
    }),
  ).length
}

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const money = (value: number) => `$${value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`
export function crossingReportHtml(project: RoadProject, analysis: RoadAnalysis): string {
  const alignment = project.alignments.find((a) => a.id === project.activeAlignmentId)
  if (!alignment) return ''
  const estimate =
    analysis.crossingEstimate ?? estimateCrossings(alignment, analysis, project.context, project.sharedCrossingCosts)
  if (!estimate.rows.length && !estimate.retired.length && !project.sharedCrossingCosts?.length) return ''
  const itemRows = (items: readonly CrossingCostItem[]) =>
    items
      .map(
        (i) =>
          `<tr><td>${escape(i.label)}</td><td>${i.quantity ?? 'Unknown'} ${escape(i.unit)}</td><td>${i.unitRate === null ? 'Unpriced' : money(i.unitRate)}</td><td>${i.quantity === null || i.unitRate === null ? 'Unpriced' : money(i.quantity * i.unitRate)}</td><td>${escape(i.source || 'Missing source')} ${escape(i.sourceUrl)} ${escape(i.priceDate || 'Missing date')}</td></tr>`,
      )
      .join('')
  const table = (items: readonly CrossingCostItem[]) =>
    `<table><thead><tr><th>Item</th><th>Quantity</th><th>Unit rate</th><th>Amount</th><th>Price evidence (user supplied)</th></tr></thead><tbody>${itemRows(items)}</tbody></table>`
  return `<section><h2>Stream crossing estimates</h2><p>${estimate.complete ? 'Entered planning estimate' : 'Incomplete / unpriced planning estimate'}; known subtotal ${money(estimate.knownSubtotal)} before contingency. Structure choices are not engineering or regulatory approval. Sources are user-entered, not independently verified. Route-search allowances are separate screening assumptions.</p>${estimate.rows.map((r) => `<h3>${escape(r.name)} — ${r.chainage.toFixed(1)} m</h3><p>${escape(CROSSING_STRUCTURES.find((s) => s.value === r.record.structure)?.label)}; ${escape(r.status)}. ${escape(r.record.evidence)}</p>${table(r.record.items)}${r.missing.length ? `<p>Outstanding: ${escape(r.missing.join('; '))}.</p>` : ''}`).join('')}<h3>Shared costs, once per road estimate</h3>${table(project.sharedCrossingCosts ?? [])}<p>Shared subtotal ${money(estimate.sharedSubtotal)}. Replaced engineering culvert allowances ${money(estimate.replacedLegacyCost)}. Net addition ${money(estimate.incrementalSubtotal)}.</p>${estimate.retired.length ? `<p>${estimate.retired.length} earlier crossing record(s) no longer match a current physical crossing; evidence is retained and excluded from this estimate.</p>` : ''}</section>`
}
