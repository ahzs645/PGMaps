import type {
  Alignment,
  AlignmentEngineering,
  Culvert,
  HaulSettings,
  HaulSite,
  ResolvedTemplate,
  RoadTemplate,
  SectionComponent,
} from './types'
import { EngineeringInputError, requireInRange, requireStationRange, type EngineeringInputTarget } from './inputErrors'
import { validatePreparation, validateSectionAssembly } from './sectionAssembly'
import { validateAllocationPolicy } from './allocationPolicy'
import { parseMaterialVolumeFactorProvenance } from './materialFactors'

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

const plain = (value: number) => Number(value.toFixed(3)).toLocaleString('en-CA', { maximumFractionDigits: 3 })
/** A failure from a shared parser, attributed to the entry being validated. */
const attributed = (cause: unknown, owner: string, target: EngineeringInputTarget) =>
  cause instanceof EngineeringInputError
    ? cause
    : new EngineeringInputError(`${owner}: ${cause instanceof Error ? cause.message : 'invalid value.'}`, target)

/**
 * Checks one template. `target` says which editor holds it (the road's base section by default, or
 * a named library template) and `owner` names it in the message, so a failure can be shown there.
 */
export function validateTemplate(
  t: RoadTemplate,
  target: EngineeringInputTarget = { list: 'template' },
  owner = 'Road section',
): void {
  try {
    validateSectionAssembly(t)
  } catch (cause) {
    throw attributed(cause, owner, target)
  }
  const base = (key: keyof RoadTemplate, label: string, low: number, high: number) =>
    requireInRange(t[key], low, high, owner, label, { ...target, field: key })
  base('leftWidth', 'left half-width (m)', 0.1, 50)
  base('rightWidth', 'right half-width (m)', 0.1, 50)
  base('crossfallPercent', 'crown crossfall (%)', 0, 20)
  base('cutSlope', 'cut batter (H:V)', 0.1, 10)
  base('fillSlope', 'fill batter (H:V)', 0.1, 10)
  base('ditchWidth', 'ditch width (m)', 0, 10)
  base('ditchDepth', 'ditch depth (m)', 0, 5)
  base('surfaceDepth', 'surfacing depth (m)', 0, 2)
  for (const side of ['left', 'right'] as const) {
    const value = (attribute: Attribute, label: string, low: number, high: number) =>
      requireInRange(sideValue(t, side, attribute), low, high, owner, `${side} ${label}`, {
        ...target,
        field: `${side}${attribute}`,
      })
    value('CrossfallPercent', 'crossfall (%)', -20, 20)
    value('CutSlope', 'cut batter (H:V)', 0.1, 10)
    value('FillSlope', 'fill batter (H:V)', 0.1, 10)
    value('DitchWidth', 'ditch width (m)', 0, 10)
    value('DitchDepth', 'ditch depth (m)', 0, 5)
    value('SurfaceDepth', 'surfacing depth (m)', 0, 2)
    const width = sideValue(t, side, 'DitchWidth'),
      bottom = sideValue(t, side, 'DitchBottomWidth')
    if (!bounded(bottom, 0, width))
      throw new EngineeringInputError(
        `${owner}: the ${side} ditch bottom width (${plain(bottom)} m) must be 0 to the ditch top width (${plain(width)} m).`,
        { ...target, field: `${side}DitchBottomWidth` },
      )
  }
}

/**
 * Rejects engineering inputs the analysis cannot use, with an `EngineeringInputError` that names
 * the entry, the field and the allowed range. Numeric bounds match the editor fields and
 * project-file parsing (`engineeringProject.ts`), so a value either can enter is one the analysis
 * accepts. Template assignments must not overlap on a side; ground horizons may, and a later
 * horizon then replaces the earlier one (`groundHorizons.ts`).
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
  for (const t of e.templates) validateTemplate(t.template, { list: 'templates', id: t.id }, t.name || 'Template')
  for (let i = 0; i < e.assignments.length; i++) {
    const a = e.assignments[i],
      owner = `Template range ${i + 1}`,
      target = { list: 'assignments' as const, id: a.id }
    requireStationRange(a.start, a.end, owner, target)
    if (!templateIds.has(a.templateId))
      throw new EngineeringInputError(`${owner}: choose a template from the library.`, {
        ...target,
        field: 'templateId',
      })
    if (!['left', 'right', 'both'].includes(a.side))
      throw new EngineeringInputError(`${owner}: choose left, right or both sides.`, { ...target, field: 'side' })
    requireInRange(a.transitionM, 0, (a.end - a.start) / 2, owner, 'transition (m, at most half the range)', {
      ...target,
      field: 'transitionM',
    })
    for (let j = 0; j < i; j++) {
      const b = e.assignments[j],
        from = Math.max(a.start, b.start),
        to = Math.min(a.end, b.end)
      if (to > from + EPS && (a.side === b.side || a.side === 'both' || b.side === 'both'))
        throw new EngineeringInputError(
          `${owner} and template range ${j + 1} overlap on the same side between ${plain(from)} and ${plain(to)} m. Change a station, or give each range its own side.`,
          target,
        )
    }
  }
  for (const m of e.materials) {
    const owner = m.name || 'Material',
      target = { list: 'materials' as const, id: m.id }
    if (m.id === '__unclassified') throw new Error('A material cannot use the reserved unclassified ID.')
    requireInRange(m.cutRate, 0, 10000, owner, 'excavation rate ($/bank m³)', { ...target, field: 'cutRate' })
    requireInRange(m.reusableFraction, 0, 1, owner, 'reusable fraction', { ...target, field: 'reusableFraction' })
    requireInRange(m.compactionFactor, 0.1, 2, owner, 'compacted / bank factor', {
      ...target,
      field: 'compactionFactor',
    })
    if (m.purpose !== undefined && !['earthwork', 'stripping'].includes(m.purpose))
      throw new EngineeringInputError(`${owner}: choose earthwork or excavated stripping.`, {
        ...target,
        field: 'purpose',
      })
    if (m.purpose === 'stripping' && m.reusableFraction !== 0)
      throw new EngineeringInputError(`${owner}: Stripping must have zero reusable fraction.`, {
        ...target,
        field: 'reusableFraction',
      })
    if (m.volumeFactorProvenance !== undefined)
      parseMaterialVolumeFactorProvenance(m.volumeFactorProvenance, m.compactionFactor)
  }
  for (let i = 0; i < e.strata.length; i++) {
    const a = e.strata[i],
      owner = `Horizon ${i + 1}`,
      target = { list: 'strata' as const, id: a.id }
    requireStationRange(a.start, a.end, owner, target)
    if (!materialIds.has(a.materialId))
      throw new EngineeringInputError(`${owner}: choose one of the ground materials.`, {
        ...target,
        field: 'materialId',
      })
    requireInRange(a.topDepthM, 0, 1000, owner, 'top depth (m)', { ...target, field: 'topDepthM' })
    if (a.bottomDepthM !== null) {
      requireInRange(a.bottomDepthM, 0, 1000, owner, 'bottom depth (m)', { ...target, field: 'bottomDepthM' })
      if (a.bottomDepthM <= a.topDepthM)
        throw new EngineeringInputError(
          `${owner}: the bottom depth (${plain(a.bottomDepthM)} m) must be greater than the top depth (${plain(a.topDepthM)} m).`,
          { ...target, field: 'bottomDepthM' },
        )
    }
  }
  const h = e.haul,
    haulTarget = { list: 'haul' as const }
  if (
    typeof h.enabled !== 'boolean' ||
    (h.siteSelection !== undefined && !['nearest', 'delivered-cost'].includes(h.siteSelection))
  )
    throw new EngineeringInputError('Haul settings: choose how sites are selected.', haulTarget)
  const haulFields: [keyof HaulSettings, string, number][] = [
    ['freeHaulDistanceM', 'free-haul distance (m)', 100000],
    ['overhaulDistanceM', 'overhaul distance limit (m)', 100000],
    ['freeHaulRate', 'free haul ($/m³·km)', 100000],
    ['overhaulRate', 'overhaul ($/m³·km)', 100000],
    ['endHaulRate', 'end haul ($/m³·km)', 100000],
    ['freeHaulLoadingRate', 'free-haul loading ($/m³)', 100000],
    ['overhaulLoadingRate', 'overhaul loading ($/m³)', 100000],
    ['endHaulLoadingRate', 'end-haul loading ($/m³)', 100000],
    ['borrowRate', 'default borrow ($/compacted m³)', 100000],
    ['wasteRate', 'default waste ($/bank m³)', 100000],
    ['mobilizationCost', 'mobilization ($)', 1e9],
    ['contingencyPercent', 'contingency (%)', 100],
  ]
  for (const [key, label, high] of haulFields)
    requireInRange(h[key], 0, high, 'Haul settings', label, { ...haulTarget, field: key })
  if (h.overhaulDistanceM < h.freeHaulDistanceM)
    throw new EngineeringInputError(
      `Haul settings: the overhaul distance limit (${plain(h.overhaulDistanceM)} m) must be at least the free-haul distance (${plain(h.freeHaulDistanceM)} m).`,
      { ...haulTarget, field: 'overhaulDistanceM' },
    )
  for (const c of e.culverts) {
    const owner = c.name || 'Culvert',
      target = { list: 'culverts' as const, id: c.id }
    const field = (key: keyof Culvert, label: string, low: number, high: number) =>
      requireInRange(c[key], low, high, owner, label, { ...target, field: key })
    field('chainage', 'station (m)', 0, 100000)
    field('skewDegrees', 'skew (°)', -80, 80)
    field('lengthM', 'horizontal barrel span (m)', 0.2, 500)
    field('diameterM', 'diameter (m)', 0.1, 20)
    field('minCoverM', 'required cover (m)', 0, 100)
    field('unitCost', 'installed cost ($/m)', 0, 1000000)
    field('fixedCost', 'fixed cost ($)', 0, 1e9)
    if (c.ditchDipPercent !== undefined) field('ditchDipPercent', 'ditch dip to inlet (%)', 0.1, 50)
    if (c.kind !== undefined && !['stream', 'cross-drain'].includes(c.kind))
      throw new EngineeringInputError(`${owner}: choose a road cross-drain or a natural stream.`, {
        ...target,
        field: 'kind',
      })
    if (c.inletInvertM !== null) field('inletInvertM', 'inlet invert elevation (m)', -12000, 12000)
    if (c.outletInvertM !== null) field('outletInvertM', 'outlet invert elevation (m)', -12000, 12000)
  }
  for (const s of e.sites) {
    const owner = s.name || 'Site',
      target = { list: 'sites' as const, id: s.id }
    const field = (key: keyof HaulSite, label: string, low: number, high: number) =>
      requireInRange(s[key], low, high, owner, label, { ...target, field: key })
    field('chainage', 'station (m)', 0, 100000)
    field('accessDistanceM', 'access distance (m)', 0, 100000)
    field('unitRate', 'unit rate ($/m³)', 0, 100000)
    field('fixedCost', 'fixed cost ($)', 0, 1e9)
    if (s.capacityM3 !== null) field('capacityM3', 'capacity (m³)', 0, 1e12)
    if (
      !['borrow', 'waste'].includes(s.kind) ||
      (s.enabled !== undefined && typeof s.enabled !== 'boolean') ||
      (s.sourceNotes !== undefined && (typeof s.sourceNotes !== 'string' || s.sourceNotes.length > 2000))
    )
      throw new EngineeringInputError(`${owner}: choose borrow or waste, and keep notes to 2,000 characters.`, target)
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
