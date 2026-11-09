/**
 * One register of the places water crosses the road. Mapped crossings come from stream lines in the
 * project; modelled crossings come from the drainage check's flow routing over the terrain. Pure and
 * derived: it never edits the design.
 *
 * The two sources are different evidence for the same question, so a mapped stream and a modelled
 * flow line within `CROSSING_MATCH_DISTANCE_M` along the road are listed as one crossing, and
 * everything else is listed as unmatched rather than left for the reader to reconcile.
 */
import { crossingsWithoutStructure } from './costReadiness'
import { CROSSING_STRUCTURES, LEGACY_CULVERT_ASSOCIATION_M } from './crossingPlan'
import type { DrainageEvidence } from './drainageEvidence'
import { DEFAULT_CULVERT_SEARCH_M } from './hydrology'
import { effectiveClass, streamStatus, type RiparianClass, type StreamStatus } from './streamClass'
import type { Alignment, ContextFeature, Culvert, RoadAnalysis } from './types'

/** A mapped stream and a modelled flow line this close along the road are the same crossing. */
export const CROSSING_MATCH_DISTANCE_M = 25

export type CrossingSource = 'mapped' | 'modelled' | 'both'
export type CrossingCapacity = 'adequate' | 'undersized' | 'unchecked'

export interface CrossingStructureStatus {
  kind: 'none' | 'culvert' | 'record'
  /** "None", "Culvert 2 · Ø 0.8 m × 12 m", "Bridge (crossing record)". */
  label: string
  culvertId?: string
  capacity: CrossingCapacity | 'not-applicable'
  /** What stops a culvert counting as sized. Empty when nothing does. */
  outstanding: string[]
  /**
   * True for a culvert with its inverts and a current capacity check that passes; false for none or
   * an unsized one; null for a recorded structure this workspace does not size (a bridge, a ford).
   */
  sized: boolean | null
}

export interface CrossingRegisterRow {
  id: string
  /** The mapped station where there is one, otherwise the modelled one. */
  chainage: number
  source: CrossingSource
  name: string
  mapped: { featureId: string; name: string; chainage: number } | null
  modelled: { id: string; chainage: number; areaHa: number; redirected: boolean } | null
  /** Distance along the road between the mapped and modelled stations of a matched crossing. */
  separationM: number | null
  structure: CrossingStructureStatus
  /** Null for a modelled-only crossing: there is no mapped reach to classify. */
  classStatus: StreamStatus | null
  riparianClass: RiparianClass | null
}

export interface CrossingRegister {
  rows: CrossingRegisterRow[]
  mappedCount: number
  /** Null when no current drainage check supplies modelled crossings. */
  modelledCount: number | null
  matchedCount: number
  /** Whether modelled crossings are listed: `stale` and `not-run` list mapped crossings only. */
  drainage: 'current' | 'stale' | 'not-run'
  matchDistanceM: number
}

export interface CrossingRegisterInput {
  alignment: Alignment
  analysis: RoadAnalysis
  context: readonly ContextFeature[]
  drainage?: { record?: DrainageEvidence; stale: boolean }
}

interface CulvertCheck {
  adequate: boolean
  minimumDiameterM: number | string | null
}

const metres = (value: number, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits)

function culvertStatus(
  culvert: Culvert,
  analysis: RoadAnalysis,
  check: CulvertCheck | undefined,
  drainage: CrossingRegister['drainage'],
): CrossingStructureStatus {
  const outstanding: string[] = []
  if (culvert.inletInvertM === null || culvert.outletInvertM === null) outstanding.push('no inverts')
  else if (analysis.engineering?.culverts.find((c) => c.id === culvert.id)?.complete === false)
    outstanding.push('cover or length unresolved')
  let capacity: CrossingCapacity = 'unchecked'
  if (drainage === 'current' && check) capacity = check.adequate ? 'adequate' : 'undersized'
  if (capacity === 'unchecked')
    outstanding.push(drainage === 'stale' ? 'capacity check out of date' : 'capacity not checked')
  if (capacity === 'undersized')
    outstanding.push(
      typeof check?.minimumDiameterM === 'number'
        ? `undersized: needs Ø ${metres(check.minimumDiameterM, 2)} m`
        : 'undersized for the modelled flow',
    )
  return {
    kind: 'culvert',
    label: `${culvert.name} · Ø ${metres(culvert.diameterM, 2)} m × ${metres(culvert.lengthM)} m`,
    culvertId: culvert.id,
    capacity,
    outstanding,
    sized: outstanding.length === 0,
  }
}

const NO_STRUCTURE: CrossingStructureStatus = {
  kind: 'none',
  label: 'None',
  capacity: 'not-applicable',
  outstanding: ['no structure'],
  sized: false,
}

export function buildCrossingRegister({
  alignment,
  analysis,
  context,
  drainage,
}: CrossingRegisterInput): CrossingRegister {
  const record = drainage?.record
  const state: CrossingRegister['drainage'] = !record ? 'not-run' : drainage?.stale ? 'stale' : 'current'
  const culverts = alignment.engineering?.culverts ?? []
  const checks = new Map<string, CulvertCheck>()
  const modelled: NonNullable<CrossingRegisterRow['modelled']>[] = []
  if (record && state === 'current')
    for (const feature of record.features.features) {
      const p = feature.properties ?? {}
      if (p.role === 'culvert-check' && typeof p.id === 'string')
        checks.set(p.id, { adequate: p.adequate === true, minimumDiameterM: p.minimumDiameterM ?? null })
      if (p.role === 'crossing' && typeof p.id === 'string' && typeof p.chainage === 'number')
        modelled.push({
          id: p.id,
          chainage: p.chainage,
          areaHa: typeof p.areaHa === 'number' ? p.areaHa : 0,
          redirected: p.redirected === true,
        })
    }
  const nearestCulvert = (chainage: number, reach: number, featureId?: string) => {
    let best: Culvert | null = null
    for (const culvert of culverts) {
      if (featureId !== undefined && culvert.sourceFeatureId !== featureId) continue
      const gap = Math.abs(culvert.chainage - chainage)
      if (gap <= reach && (!best || gap < Math.abs(best.chainage - chainage))) best = culvert
    }
    return best
  }
  const mapped = analysis.crossings.filter((crossing) => crossing.kind === 'stream')
  const uncrossed = new Set(crossingsWithoutStructure(analysis, alignment.engineering).map((crossing) => crossing.id))

  // Nearest pairs first, so two streams close together each keep their own flow line.
  const pairs: { m: number; d: number; gap: number }[] = []
  mapped.forEach((crossing, m) =>
    modelled.forEach((flow, d) => {
      const gap = Math.abs(crossing.chainage - flow.chainage)
      if (gap <= CROSSING_MATCH_DISTANCE_M) pairs.push({ m, d, gap })
    }),
  )
  pairs.sort((a, b) => a.gap - b.gap)
  const flowOf = new Map<number, { d: number; gap: number }>(),
    taken = new Set<number>()
  for (const pair of pairs) {
    if (flowOf.has(pair.m) || taken.has(pair.d)) continue
    flowOf.set(pair.m, { d: pair.d, gap: pair.gap })
    taken.add(pair.d)
  }

  const rows: CrossingRegisterRow[] = mapped.map((crossing, m) => {
    const match = flowOf.get(m)
    const flow = match ? modelled[match.d] : null
    const feature = context.find((item) => item.id === crossing.featureId)
    const recordRow = analysis.crossingEstimate?.rows.find(
      (row) =>
        row.status === 'current' &&
        row.record.structure !== 'undecided' &&
        row.record.featureId === crossing.featureId &&
        Math.abs(row.chainage - crossing.chainage) <= 0.01,
    )
    const culvert =
      nearestCulvert(crossing.chainage, LEGACY_CULVERT_ASSOCIATION_M, crossing.featureId) ??
      (flow ? nearestCulvert(flow.chainage, DEFAULT_CULVERT_SEARCH_M) : null)
    const structure: CrossingStructureStatus = culvert
      ? culvertStatus(culvert, analysis, checks.get(culvert.id), state)
      : recordRow && !uncrossed.has(crossing.id)
        ? {
            kind: 'record',
            label: `${CROSSING_STRUCTURES.find((s) => s.value === recordRow.record.structure)?.label ?? 'Structure'} (crossing record)`,
            capacity: 'not-applicable',
            outstanding: [],
            sized: null,
          }
        : NO_STRUCTURE
    return {
      id: `mapped:${crossing.id}`,
      chainage: crossing.chainage,
      source: flow ? 'both' : 'mapped',
      name: crossing.name,
      mapped: { featureId: crossing.featureId, name: crossing.name, chainage: crossing.chainage },
      modelled: flow,
      separationM: match ? match.gap : null,
      structure,
      classStatus: streamStatus(feature?.streamAssessment, feature?.geometry.coordinates),
      riparianClass: effectiveClass(feature?.streamAssessment),
    }
  })
  modelled.forEach((flow, d) => {
    if (taken.has(d)) return
    const culvert = nearestCulvert(flow.chainage, DEFAULT_CULVERT_SEARCH_M)
    rows.push({
      id: `modelled:${flow.id}`,
      chainage: flow.chainage,
      source: 'modelled',
      name: `Modelled flow line · ${flow.areaHa.toFixed(flow.areaHa < 10 ? 2 : 1)} ha`,
      mapped: null,
      modelled: flow,
      separationM: null,
      structure: culvert ? culvertStatus(culvert, analysis, checks.get(culvert.id), state) : NO_STRUCTURE,
      classStatus: null,
      riparianClass: null,
    })
  })
  rows.sort((a, b) => a.chainage - b.chainage)
  return {
    rows,
    mappedCount: mapped.length,
    modelledCount: state === 'current' ? modelled.length : null,
    matchedCount: flowOf.size,
    drainage: state,
    matchDistanceM: CROSSING_MATCH_DISTANCE_M,
  }
}

/** "2 mapped · 2 modelled · 0 the same crossing", with the basis of each count named. */
export function crossingRegisterSummary(register: CrossingRegister): string {
  const mapped = `${register.mappedCount} mapped`
  if (register.modelledCount === null)
    return `${mapped} · modelled crossings ${register.drainage === 'stale' ? 'out of date' : 'not checked'}`
  return `${mapped} · ${register.modelledCount} modelled · ${register.matchedCount} matched`
}

export const CROSSING_SOURCE_LABELS: Record<CrossingSource, string> = {
  mapped: 'Mapped only',
  modelled: 'Modelled only',
  both: 'Mapped and modelled',
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const stationText = (chainage: number) => {
  const rounded = Math.round(Math.max(0, chainage) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

/** What a register row says about how its two sources agree. */
export function crossingMatchText(row: CrossingRegisterRow, register: CrossingRegister): string {
  if (row.source === 'both')
    return `Same crossing: modelled flow line ${row.separationM!.toFixed(1)} m along the road, at ${stationText(row.modelled!.chainage)}`
  if (row.source === 'mapped')
    return register.modelledCount === null
      ? `Modelled crossings ${register.drainage === 'stale' ? 'are out of date' : 'not checked'}`
      : `No modelled flow line within ${register.matchDistanceM} m`
  return `No mapped stream within ${register.matchDistanceM} m`
}

/** The register for the printed report. */
export function crossingRegisterReportHtml(register: CrossingRegister): string {
  const basis = `Mapped crossings are where the road meets a stream line in the project. Modelled crossings are where the drainage check's flow routing over the terrain enters the road footprint. A mapped stream and a modelled flow line within ${register.matchDistanceM} m along the road are listed as one crossing.`
  const state =
    register.drainage === 'current'
      ? ''
      : register.drainage === 'stale'
        ? ' The drainage check is out of date, so modelled crossings are not listed.'
        : ' The drainage check has not been run, so modelled crossings are not listed.'
  if (!register.rows.length)
    return `<h2>Crossing register</h2><p>${escapeHtml(crossingRegisterSummary(register))}. ${escapeHtml(basis + state)} No crossing in the supplied data does not establish that the road crosses no water.</p>`
  return `<h2>Crossing register</h2><p>${escapeHtml(crossingRegisterSummary(register))}. ${escapeHtml(basis + state)}</p><table><thead><tr><th>Station</th><th style="text-align:left">Crossing</th><th style="text-align:left">Source</th><th style="text-align:left">Structure</th><th style="text-align:left">Riparian class</th><th>Mapped and modelled</th></tr></thead><tbody>${register.rows
    .map(
      (row) =>
        `<tr><td>${stationText(row.chainage)}</td><td style="text-align:left">${escapeHtml(row.name)}</td><td style="text-align:left">${escapeHtml(CROSSING_SOURCE_LABELS[row.source])}</td><td style="text-align:left">${escapeHtml(row.structure.label)}${row.structure.outstanding.length && row.structure.kind !== 'none' ? `<br><span class="muted">${escapeHtml(row.structure.outstanding.join(', '))}</span>` : ''}</td><td style="text-align:left">${escapeHtml(row.classStatus === null ? 'Not a mapped stream' : row.riparianClass ? `${row.riparianClass} (${row.classStatus === 'reviewed' ? 'reviewed' : 'not reviewed'})` : 'No class')}</td><td>${escapeHtml(crossingMatchText(row, register))}</td></tr>`,
    )
    .join('')}</tbody></table>`
}
