import type { Alignment, AlignmentEngineering, ResolvedTemplate, RoadTemplate, SectionComponent } from './types'
import { validatePreparation, validateSectionAssembly } from './sectionAssembly'
import { validateAllocationPolicy } from './allocationPolicy'

const EPS = 1e-7
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const bounded = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high
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
const componentKeys = ['widthM', 'riseM', 'depthM', 'offsetM', 'referenceOffsetM', 'referenceElevationM'] as const
function blendedComponents(base: RoadTemplate, target: RoadTemplate, side: Side, ratio: number): SectionComponent[] {
  const a = (base.components ?? []).filter((c) => c.side === side),
    b = (target.components ?? []).filter((c) => c.side === side)
  if (ratio <= EPS) return a.map((c) => ({ ...c }))
  if (ratio >= 1 - EPS) return b.map((c) => ({ ...c }))
  const weighted = (c: SectionComponent, weight: number) => ({
    ...c,
    widthM: c.widthM * weight,
    riseM: c.riseM * weight,
    ...(c.depthM !== undefined ? { depthM: c.depthM * weight } : {}),
  })
  return [
    ...a.map((c) => {
      const next = b.find((v) => v.id === c.id)
      if (!next) return weighted(c, 1 - ratio)
      const result = { ...next }
      for (const key of componentKeys)
        if (c[key] !== undefined || next[key] !== undefined)
          result[key] = (c[key] ?? 0) + ((next[key] ?? 0) - (c[key] ?? 0)) * ratio
      return result
    }),
    ...b.filter((c) => !a.some((v) => v.id === c.id)).map((c) => weighted(c, ratio)),
  ]
}

/** Matching component identities interpolate once. Topology/reference changes need a deliberate step. */
export function validateComponentTransitions(alignment: Alignment) {
  const e = alignment.engineering
  if (!e) return
  for (const assignment of e.assignments) {
    if (!assignment.transitionM) continue
    const target = e.templates.find((t) => t.id === assignment.templateId)?.template
    if (!target) continue
    for (const side of ['left', 'right'] as const) {
      if (assignment.side !== 'both' && assignment.side !== side) continue
      const a = (alignment.template.components ?? []).filter((c) => c.side === side)
      const b = (target.components ?? []).filter((c) => c.side === side)
      const sharedA = a.filter((c) => b.some((d) => d.id === c.id)).map((c) => c.id)
      const sharedB = b.filter((c) => a.some((d) => d.id === c.id)).map((c) => c.id)
      if (JSON.stringify(sharedA) !== JSON.stringify(sharedB))
        throw Error('Reordered components require a step assignment (transition 0).')
      for (const c of a) {
        const next = b.find((d) => d.id === c.id)
        if (
          next &&
          (['kind', 'condition', 'materialId', 'referenceFeatureId', 'referenceSurfaceId'] as const).some(
            (key) => c[key] !== next[key],
          )
        )
          throw Error(
            'Changing component type, condition, material or reference requires a step assignment (transition 0).',
          )
        if (!next && (c.referenceFeatureId || c.referenceSurfaceId))
          throw Error('Adding or removing an anchored component requires a step assignment (transition 0).')
        if (c.kind === 'key')
          for (const d of b)
            if (
              d.kind === 'key' &&
              d.id !== c.id &&
              (c.condition === 'always' || d.condition === 'always' || c.condition === d.condition) &&
              Math.min((c.offsetM ?? 0) + c.widthM, (d.offsetM ?? 0) + d.widthM) >
                Math.max(c.offsetM ?? 0, d.offsetM ?? 0)
            )
              throw Error(
                'Overlapping key transitions need matching component IDs or a step assignment (transition 0).',
              )
      }
      for (const c of b)
        if (!a.some((d) => d.id === c.id) && (c.referenceFeatureId || c.referenceSurfaceId))
          throw Error('Adding or removing an anchored component requires a step assignment (transition 0).')
    }
  }
}

/** A negative side crossfall rises away from the centreline (superelevation). */
export function sideValue(template: RoadTemplate, side: Side, attribute: Attribute): number {
  // A ditch bottom width added later is optional: omitted means a V ditch.
  const value = template[`${side}${attribute}`] ?? template[baseKey(attribute)]
  return typeof value === 'number' ? value : 0
}

/**
 * The crossfall a section uses on one side at a station. On a curve the section rotates about the
 * centreline toward the superelevation `curve.superPercent` (at least the inside crown), the inside
 * falling and the outside rising, moving linearly from the template value over the runoff ratio.
 */
export function sectionCrossfall(
  template: RoadTemplate,
  side: Side,
  curve: { inside: Side; superPercent: number; ratio: number } | null,
): number {
  const crossfall = sideValue(template, side, 'CrossfallPercent')
  if (!curve || curve.superPercent <= 0) return crossfall
  const e = Math.max(curve.superPercent, sideValue(template, curve.inside, 'CrossfallPercent'))
  const target = side === curve.inside ? e : -e
  return crossfall + (target - crossfall) * curve.ratio
}

export type TemplateStarter = 'current' | 'single' | 'double' | 'landing' | 'urban'

const STARTER_DIMENSIONS: Record<Exclude<TemplateStarter, 'current'>, Partial<RoadTemplate>> = {
  single: { leftWidth: 3, rightWidth: 3, crossfallPercent: 4 },
  double: { leftWidth: 4.5, rightWidth: 4.5, crossfallPercent: 4 },
  landing: { leftWidth: 12, rightWidth: 3, crossfallPercent: 2, surfaceDepth: 0 },
  // No ditch: a ditch bottom cannot be wider than the ditch, so it goes too.
  urban: {
    leftWidth: 3.5,
    rightWidth: 3.5,
    crossfallPercent: 2,
    ditchWidth: 0,
    ditchDepth: 0,
    ditchBottomWidth: 0,
    surfaceDepth: 0.3,
  },
}

/**
 * A new named template from a starting point. `current` copies the road section as it is; every
 * other starter is symmetric, so it drops all side-specific values (ditch bottom widths included)
 * and keeps the ditch bottom within the ditch. Throws when the result is out of range.
 */
export function templateFromStarter(base: RoadTemplate, starter: TemplateStarter): RoadTemplate {
  const template: RoadTemplate = { ...base }
  if (starter !== 'current') {
    delete template.components
    delete template.layers
    Object.assign(template, STARTER_DIMENSIONS[starter])
    for (const side of ['left', 'right'] as const)
      for (const attribute of attributes) delete template[`${side}${attribute}`]
    if (template.ditchBottomWidth !== undefined)
      template.ditchBottomWidth = Math.max(0, Math.min(template.ditchBottomWidth, template.ditchWidth))
  }
  validateTemplate(template)
  return template
}

export function validateTemplate(t: RoadTemplate): void {
  validateSectionAssembly(t)
  if (
    !bounded(t.leftWidth, 0.1, 50) ||
    !bounded(t.rightWidth, 0.1, 50) ||
    !bounded(t.crossfallPercent, 0, 20) ||
    !bounded(t.cutSlope, 0.1, 10) ||
    !bounded(t.fillSlope, 0.1, 10) ||
    !bounded(t.ditchWidth, 0, 10) ||
    !bounded(t.ditchDepth, 0, 5) ||
    !bounded(t.surfaceDepth, 0, 2)
  )
    throw new Error('Road template dimensions or side slopes are outside their supported ranges.')
  for (const side of ['left', 'right'] as const) {
    const valid =
      bounded(sideValue(t, side, 'CrossfallPercent'), -20, 20) &&
      bounded(sideValue(t, side, 'CutSlope'), 0.1, 10) &&
      bounded(sideValue(t, side, 'FillSlope'), 0.1, 10) &&
      bounded(sideValue(t, side, 'DitchWidth'), 0, 10) &&
      bounded(sideValue(t, side, 'DitchDepth'), 0, 5) &&
      bounded(sideValue(t, side, 'DitchBottomWidth'), 0, sideValue(t, side, 'DitchWidth')) &&
      bounded(sideValue(t, side, 'SurfaceDepth'), 0, 2)
    if (!valid) throw new Error(`The ${side} template settings are outside their supported ranges.`)
  }
}

/**
 * Reject ambiguous overlapping assignments instead of changing their priority silently. Numeric
 * bounds match the editor fields and project-file parsing (`engineeringProject.ts`), so a value
 * either can enter is one the analysis accepts.
 */
export function validateEngineering(e: AlignmentEngineering): void {
  validatePreparation(e)
  validateAllocationPolicy(e)
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
      !bounded(m.cutRate, 0, 10000) ||
      !bounded(m.reusableFraction, 0, 1) ||
      !bounded(m.compactionFactor, 0.1, 2) ||
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
    (h.siteSelection !== undefined && !['nearest', 'delivered-cost'].includes(h.siteSelection)) ||
    [
      h.freeHaulDistanceM,
      h.overhaulDistanceM,
      h.freeHaulRate,
      h.overhaulRate,
      h.endHaulRate,
      h.freeHaulLoadingRate,
      h.overhaulLoadingRate,
      h.endHaulLoadingRate,
      h.borrowRate,
      h.wasteRate,
    ].some((v) => !bounded(v, 0, 100000)) ||
    !bounded(h.mobilizationCost, 0, 1e9) ||
    !bounded(h.contingencyPercent, 0, 100) ||
    h.overhaulDistanceM < h.freeHaulDistanceM
  )
    throw new Error('Haul distances, rates and contingency are invalid; overhaul distance must include free haul.')
  for (const c of e.culverts) {
    if (
      !bounded(c.chainage, 0, 100000) ||
      !bounded(c.skewDegrees, -80, 80) ||
      !bounded(c.lengthM, 0.2, 500) ||
      !bounded(c.diameterM, 0.1, 20) ||
      !bounded(c.minCoverM, 0, 100) ||
      !bounded(c.unitCost, 0, 1000000) ||
      !bounded(c.fixedCost, 0, 1e9) ||
      (c.ditchDipPercent !== undefined && !bounded(c.ditchDipPercent, 0.1, 50)) ||
      (c.kind !== undefined && !['stream', 'cross-drain'].includes(c.kind)) ||
      [c.inletInvertM, c.outletInvertM].some((v) => v !== null && (!Number.isFinite(v) || Math.abs(v) > 12000))
    )
      throw new Error('Culverts need valid stationing, size, cover, ditch dip, invert elevations and costs.')
  }
  for (const s of e.sites) {
    if (
      !bounded(s.chainage, 0, 100000) ||
      !bounded(s.accessDistanceM, 0, 100000) ||
      !bounded(s.unitRate, 0, 100000) ||
      !bounded(s.fixedCost, 0, 1e9) ||
      !['borrow', 'waste'].includes(s.kind) ||
      (s.enabled !== undefined && typeof s.enabled !== 'boolean') ||
      (s.sourceNotes !== undefined && (typeof s.sourceNotes !== 'string' || s.sourceNotes.length > 2000)) ||
      (s.capacityM3 !== null && !bounded(s.capacityM3, 0, 1e12))
    )
      throw new Error('Borrow/waste sites need valid stationing, access distance, capacity and costs.')
  }
  const supply = e.surfacingSupply
  if (
    supply &&
    (typeof supply.enabled !== 'boolean' ||
      typeof supply.name !== 'string' ||
      !supply.name.trim() ||
      supply.name.length > 200 ||
      typeof supply.sourceNotes !== 'string' ||
      supply.sourceNotes.length > 2000 ||
      [supply.acquisitionRate, supply.processingRate, supply.loadingRate, supply.haulRate, supply.placementRate].some(
        (v) => !bounded(v, 0, 100000),
      ) ||
      !bounded(supply.haulDistanceKm, 0, 1000) ||
      (supply.capacityM3 !== null && !bounded(supply.capacityM3, 0, 1e12)))
  )
    throw new Error('Surfacing supply needs valid rates, haul distance, compacted capacity and source notes.')
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
    if (alignment.template.components || named.template.components) {
      const others = (template.components ?? []).filter((c) => c.side !== side)
      template.components = [...others, ...blendedComponents(alignment.template, named.template, side, ratio)]
    }
    if (alignment.template.layers || named.template.layers) {
      const others = (template.layers ?? []).flatMap((l) =>
        l.side === side
          ? []
          : l.side === 'both'
            ? [{ ...l, side: side === 'left' ? ('right' as const) : ('left' as const) }]
            : [l],
      )
      const blend = (source: RoadTemplate, weight: number) =>
        (
          source.layers ?? [
            { id: 'surfacing', name: 'Surfacing', side, depthM: sideValue(source, side, 'SurfaceDepth') },
          ]
        )
          .filter((l) => (l.side === side || l.side === 'both') && weight > 1e-7)
          .map((l) => ({ ...l, side, depthM: l.depthM * weight }))
      template.layers = [...others, ...blend(alignment.template, 1 - ratio), ...blend(named.template, ratio)]
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
  for (const a of [
    ...(e.sitePreparation ?? []),
    ...(e.fillRequirements ?? []),
    ...(e.haul.directionRanges ?? []),
    ...(e.haul.sidecastRanges ?? []),
  ])
    knots.push(a.start - 1e-5, a.start, a.end - 1e-5, a.end, a.end + 1e-5)
  for (const a of [...e.culverts, ...e.sites]) knots.push(a.chainage)
  return knots
}
