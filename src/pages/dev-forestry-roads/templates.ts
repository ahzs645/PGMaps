import type { Alignment, AlignmentEngineering, ResolvedTemplate, RoadTemplate } from './types'

const EPS = 1e-7
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const attributes = [
  'CrossfallPercent',
  'CutSlope',
  'FillSlope',
  'DitchWidth',
  'DitchDepth',
  'DitchBottomWidth',
  'SurfaceDepth',
] as const
type Attribute = (typeof attributes)[number]
type Side = 'left' | 'right'
const baseKey = (attribute: Attribute) => `${attribute[0].toLowerCase()}${attribute.slice(1)}` as keyof RoadTemplate

/** A negative side crossfall rises away from the centreline (superelevation). */
export function sideValue(template: RoadTemplate, side: Side, attribute: Attribute): number {
  // A ditch bottom width added later is optional: omitted means a V ditch.
  return template[`${side}${attribute}`] ?? template[baseKey(attribute)] ?? 0
}

export function validateTemplate(t: RoadTemplate): void {
  const bounded = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high
  if (
    !bounded(t.leftWidth, 0.1, 50) ||
    !bounded(t.rightWidth, 0.1, 50) ||
    !bounded(t.crossfallPercent, 0, 20) ||
    !bounded(t.cutSlope, 0.05, 10) ||
    !bounded(t.fillSlope, 0.05, 10) ||
    !bounded(t.ditchWidth, 0, 10) ||
    !bounded(t.ditchDepth, 0, 5) ||
    !bounded(t.surfaceDepth, 0, 2)
  )
    throw new Error('Road template dimensions or side slopes are outside their supported ranges.')
  for (const side of ['left', 'right'] as const) {
    const valid =
      bounded(sideValue(t, side, 'CrossfallPercent'), -20, 20) &&
      bounded(sideValue(t, side, 'CutSlope'), 0.05, 10) &&
      bounded(sideValue(t, side, 'FillSlope'), 0.05, 10) &&
      bounded(sideValue(t, side, 'DitchWidth'), 0, 10) &&
      bounded(sideValue(t, side, 'DitchDepth'), 0, 5) &&
      bounded(sideValue(t, side, 'DitchBottomWidth'), 0, sideValue(t, side, 'DitchWidth')) &&
      bounded(sideValue(t, side, 'SurfaceDepth'), 0, 2)
    if (!valid) throw new Error(`The ${side} template settings are outside their supported ranges.`)
  }
}

/** Reject ambiguous overlapping assignments instead of changing their priority silently. */
export function validateEngineering(e: AlignmentEngineering): void {
  if (
    e.templates.length > 50 ||
    e.assignments.length > 200 ||
    e.materials.length > 32 ||
    e.strata.length > 200 ||
    e.culverts.length > 100 ||
    e.sites.length > 100
  )
    throw new Error(
      'Engineering limits: 50 templates, 200 assignments, 32 materials, 200 strata, 100 culverts and 100 sites.',
    )
  for (const list of [e.templates, e.assignments, e.materials, e.strata, e.culverts, e.sites]) {
    if (list.some((p) => !p.id) || new Set(list.map((p) => p.id)).size !== list.length)
      throw new Error('Engineering records require distinct, nonempty IDs within each list.')
  }
  const templateIds = new Set(e.templates.map((t) => t.id))
  const materialIds = new Set(e.materials.map((m) => m.id))
  for (const t of e.templates) validateTemplate(t.template)
  const range = (start: number, end: number) =>
    Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= 100000
  for (let i = 0; i < e.assignments.length; i++) {
    const a = e.assignments[i]
    if (
      !range(a.start, a.end) ||
      !templateIds.has(a.templateId) ||
      !['left', 'right', 'both'].includes(a.side) ||
      !Number.isFinite(a.transitionM) ||
      a.transitionM < 0 ||
      a.transitionM > (a.end - a.start) / 2
    )
      throw new Error(
        'Template assignments need a known template, valid range/side, and transition no longer than half the range.',
      )
    for (let j = 0; j < i; j++) {
      const b = e.assignments[j]
      if (
        Math.min(a.end, b.end) > Math.max(a.start, b.start) + EPS &&
        (a.side === b.side || a.side === 'both' || b.side === 'both')
      )
        throw new Error('Template assignments overlap on the same side. Split their station ranges.')
    }
  }
  for (const m of e.materials) {
    if (
      m.id === '__unclassified' ||
      ![m.cutRate, m.reusableFraction, m.compactionFactor].every(Number.isFinite) ||
      m.cutRate < 0 ||
      m.cutRate > 10000000 ||
      m.reusableFraction < 0 ||
      m.reusableFraction > 1 ||
      m.compactionFactor <= 0 ||
      m.compactionFactor > 3 ||
      (m.purpose !== undefined && !['earthwork', 'stripping'].includes(m.purpose)) ||
      (m.purpose === 'stripping' && m.reusableFraction !== 0)
    )
      throw new Error('Material rates/factors are invalid. Stripping must have zero reusable fraction.')
  }
  for (let i = 0; i < e.strata.length; i++) {
    const a = e.strata[i]
    if (
      !range(a.start, a.end) ||
      !materialIds.has(a.materialId) ||
      !Number.isFinite(a.topDepthM) ||
      a.topDepthM < 0 ||
      a.topDepthM > 1000 ||
      (a.bottomDepthM !== null &&
        (!Number.isFinite(a.bottomDepthM) || a.bottomDepthM <= a.topDepthM || a.bottomDepthM > 1000))
    )
      throw new Error('Strata need a known material, valid station range, and increasing depths below ground.')
    for (let j = 0; j < i; j++) {
      const b = e.strata[j]
      if (
        Math.min(a.end, b.end) > Math.max(a.start, b.start) + EPS &&
        Math.min(a.bottomDepthM ?? Infinity, b.bottomDepthM ?? Infinity) > Math.max(a.topDepthM, b.topDepthM) + EPS
      )
        throw new Error('Material strata overlap at the same station and depth; excavation cannot be counted twice.')
    }
  }
  const h = e.haul
  if (
    typeof h.enabled !== 'boolean' ||
    [
      h.freeHaulDistanceM,
      h.overhaulDistanceM,
      h.overhaulRate,
      h.endHaulRate,
      h.borrowRate,
      h.wasteRate,
      h.mobilizationCost,
      h.contingencyPercent,
    ].some((v) => !Number.isFinite(v) || v < 0 || v > 1e12) ||
    h.freeHaulDistanceM > 100000 ||
    h.overhaulDistanceM < h.freeHaulDistanceM ||
    h.overhaulDistanceM > 100000 ||
    h.contingencyPercent > 100
  )
    throw new Error('Haul distances, rates and contingency are invalid; overhaul distance must include free haul.')
  for (const c of e.culverts) {
    if (
      ![c.chainage, c.skewDegrees, c.lengthM, c.diameterM, c.minCoverM, c.unitCost, c.fixedCost].every(
        Number.isFinite,
      ) ||
      c.chainage < 0 ||
      c.chainage > 100000 ||
      Math.abs(c.skewDegrees) > 80 ||
      c.lengthM < 0.1 ||
      c.lengthM > 500 ||
      c.diameterM < 0.05 ||
      c.diameterM > 20 ||
      c.minCoverM < 0 ||
      c.minCoverM > 100 ||
      c.unitCost < 0 ||
      c.fixedCost < 0 ||
      c.unitCost > 1e12 ||
      c.fixedCost > 1e12 ||
      (c.kind !== undefined && !['stream', 'cross-drain'].includes(c.kind)) ||
      [c.inletInvertM, c.outletInvertM].some((v) => v !== null && (!Number.isFinite(v) || Math.abs(v) > 12000))
    )
      throw new Error('Culverts need valid stationing, size, cover, invert elevations and costs.')
  }
  for (const s of e.sites) {
    if (
      ![s.chainage, s.accessDistanceM, s.unitRate, s.fixedCost].every(Number.isFinite) ||
      s.chainage < 0 ||
      s.chainage > 100000 ||
      s.accessDistanceM < 0 ||
      s.accessDistanceM > 100000 ||
      s.unitRate < 0 ||
      s.fixedCost < 0 ||
      s.unitRate > 1e12 ||
      s.fixedCost > 1e12 ||
      !['borrow', 'waste'].includes(s.kind) ||
      (s.capacityM3 !== null && (!Number.isFinite(s.capacityM3) || s.capacityM3 < 0 || s.capacityM3 > 1e12))
    )
      throw new Error('Borrow/waste sites need valid stationing, access distance, capacity and costs.')
  }
}

export function templateAt(alignment: Alignment, chainage: number): ResolvedTemplate {
  const template = { ...alignment.template }
  const result: ResolvedTemplate = { template, leftName: 'Base section', rightName: 'Base section', assignmentIds: [] }
  const e = alignment.engineering
  if (!e) return result
  // A touching boundary belongs to the range that starts there, not the preceding one.
  for (const side of ['left', 'right'] as const) {
    const assignment = e.assignments
      .filter((a) => a.side !== (side === 'left' ? 'right' : 'left') && chainage >= a.start && chainage <= a.end)
      .sort((a, b) => b.start - a.start)[0]
    if (!assignment) continue
    const named = e.templates.find((t) => t.id === assignment.templateId)
    if (!named) continue // Analysis validation reports the unknown ID.
    const ratio =
      assignment.transitionM > 0
        ? clamp(Math.min(chainage - assignment.start, assignment.end - chainage) / assignment.transitionM)
        : 1
    const widthKey = `${side}Width` as const
    template[widthKey] =
      alignment.template[widthKey] + (named.template[widthKey] - alignment.template[widthKey]) * ratio
    for (const attribute of attributes) {
      const base = sideValue(alignment.template, side, attribute)
      template[`${side}${attribute}`] = base + (sideValue(named.template, side, attribute) - base) * ratio
    }
    result[`${side}Name`] = ratio < 1 ? `${named.name} · transition` : named.name
    if (!result.assignmentIds.includes(assignment.id)) result.assignmentIds.push(assignment.id)
  }
  return result
}

/** Include discontinuity neighbours so an area change is not smeared over an ordinary interval. */
export function engineeringKnots(alignment: Alignment): number[] {
  const e = alignment.engineering
  if (!e) return []
  const knots: number[] = []
  for (const a of e.assignments) {
    knots.push(a.start, a.end, a.start + a.transitionM, a.end - a.transitionM)
    if (!a.transitionM) knots.push(a.start - 1e-5, a.end + 1e-5)
  }
  for (const a of e.strata) knots.push(a.start - 1e-5, a.start, a.end - 1e-5, a.end, a.end + 1e-5)
  for (const a of [...e.culverts, ...e.sites]) knots.push(a.chainage)
  return knots
}
