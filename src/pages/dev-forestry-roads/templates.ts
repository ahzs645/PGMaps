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
import type { TemplateAssignment } from './engineeringTypes'
import { EngineeringInputError, requireInRange, requireStationRange, type EngineeringInputTarget } from './inputErrors'
import { validatePreparation, validateSectionAssembly } from './sectionAssembly'
import { validateAllocationPolicy } from './allocationPolicy'
import { parseMaterialVolumeFactorProvenance } from './materialFactors'
import { MAX_HORIZON_DEPTH_M } from './groundHorizons'
import { blendRockCut, rockCutAt, validateRockCut } from './rockExcavation'
import {
  blendSectionStructures,
  MAX_DITCH_DEPTH_M,
  MAX_DITCH_WIDTH_M,
  validateSectionStructures,
} from './sectionStructures'
import { batterSource } from './groundBatters'
import {
  applyParameterOverrides,
  parameterOverrideKnots,
  validateParameterOverride,
} from './templateParameterOverrides'

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

/**
 * Why one side of two templates cannot be interpolated component by component, or null when it
 * can: matching component identities interpolate once; reordered components, a changed type,
 * condition, material or reference, an anchored component added or removed, and overlapping keys
 * with different identities need a step.
 */
export function componentTransitionProblem(from: RoadTemplate, to: RoadTemplate, side: Side): string | null {
  const a = (from.components ?? []).filter((c) => c.side === side)
  const b = (to.components ?? []).filter((c) => c.side === side)
  const sharedA = a.filter((c) => b.some((d) => d.id === c.id)).map((c) => c.id)
  const sharedB = b.filter((c) => a.some((d) => d.id === c.id)).map((c) => c.id)
  if (JSON.stringify(sharedA) !== JSON.stringify(sharedB))
    return 'Reordered components require a step assignment (transition 0).'
  for (const c of a) {
    const next = b.find((d) => d.id === c.id)
    if (
      next &&
      (['kind', 'condition', 'materialId', 'referenceFeatureId', 'referenceSurfaceId'] as const).some(
        (key) => c[key] !== next[key],
      )
    )
      return 'Changing component type, condition, material or reference requires a step assignment (transition 0).'
    if (!next && (c.referenceFeatureId || c.referenceSurfaceId))
      return 'Adding or removing an anchored component requires a step assignment (transition 0).'
    if (c.kind === 'key')
      for (const d of b)
        if (
          d.kind === 'key' &&
          d.id !== c.id &&
          (c.condition === 'always' || d.condition === 'always' || c.condition === d.condition) &&
          Math.min((c.offsetM ?? 0) + c.widthM, (d.offsetM ?? 0) + d.widthM) > Math.max(c.offsetM ?? 0, d.offsetM ?? 0)
        )
          return 'Overlapping key transitions need matching component IDs or a step assignment (transition 0).'
  }
  for (const c of b)
    if (!a.some((d) => d.id === c.id) && (c.referenceFeatureId || c.referenceSurfaceId))
      return 'Adding or removing an anchored component requires a step assignment (transition 0).'
  return null
}

/**
 * Matching component identities interpolate once. Topology/reference changes need a deliberate step.
 * Transitions to a neighbouring range (`transitionInM`/`transitionOutM`) are never refused here:
 * where the two templates cannot be interpolated they step at the transition's midpoint
 * (`templateTransitions` says where).
 */
export function validateComponentTransitions(alignment: Alignment) {
  const e = alignment.engineering
  if (!e) return
  for (const assignment of e.assignments) {
    if (!assignment.transitionM) continue
    const target = e.templates.find((t) => t.id === assignment.templateId)?.template
    if (!target) continue
    for (const side of ['left', 'right'] as const) {
      if (assignment.side !== 'both' && assignment.side !== side) continue
      const problem = componentTransitionProblem(alignment.template, target, side)
      if (problem) throw Error(problem)
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
 *
 * With a tangent runout (`curve.rotationRatio`, `curveDesignAt`) the outside lane turns first, at one
 * rate from its crown through level to the superelevation, and the inside lane holds its crown until
 * the outside lane is its mirror (reverse crown), then turns with it to the superelevation.
 */
export function sectionCrossfall(
  template: RoadTemplate,
  side: Side,
  curve: { inside: Side; superPercent: number; ratio: number; rotationRatio?: number } | null,
): number {
  const crossfall = sideValue(template, side, 'CrossfallPercent')
  if (!curve || curve.superPercent <= 0) return crossfall
  const insideCrown = sideValue(template, curve.inside, 'CrossfallPercent')
  const e = Math.max(curve.superPercent, insideCrown)
  if (curve.rotationRatio === undefined) {
    const target = side === curve.inside ? e : -e
    return crossfall + (target - crossfall) * curve.ratio
  }
  const t = Math.max(0, Math.min(1, curve.rotationRatio))
  const outsideCrown = sideValue(template, curve.inside === 'left' ? 'right' : 'left', 'CrossfallPercent')
  const outside = outsideCrown + (-e - outsideCrown) * t
  if (side !== curve.inside) return outside
  // The inside lane starts turning where the outside lane reaches its mirror.
  const span = outsideCrown + e
  const reverseAt = span > 0 ? Math.max(0, Math.min(1, (outsideCrown + insideCrown) / span)) : 1
  if (t <= reverseAt || reverseAt >= 1) return insideCrown
  return insideCrown + (e - insideCrown) * ((t - reverseAt) / (1 - reverseAt))
}

/**
 * The ditch's side slope, H:V. A ditch is a top width, a depth and a flat bottom centred in it, so
 * its inslope and backslope are equal: each runs (top − bottom) / 2 for the depth. Null when the
 * ditch has no depth.
 */
export function ditchSideSlope(topWidthM: number, depthM: number, bottomWidthM: number): number | null {
  return depthM > 0 ? Math.max(0, topWidthM - Math.min(topWidthM, bottomWidthM)) / 2 / depthM : null
}

/** The top width that gives a ditch of this depth and bottom width the side slope `slope` H:V. */
export function ditchTopWidthForSlope(slope: number, depthM: number, bottomWidthM: number): number {
  return Math.max(0, bottomWidthM) + 2 * Math.max(0, slope) * Math.max(0, depthM)
}

/**
 * The template with every value of one side copied to the other: lane width, crossfall,
 * surfacing, ditch, batters, section components and one-sided surface courses. Values the source
 * side inherits from the base are written out, so the two sides match even where the destination
 * had its own override. `newId` names the copied components and courses.
 */
export function copyTemplateSide(template: RoadTemplate, from: Side, newId: () => string): RoadTemplate {
  const to: Side = from === 'left' ? 'right' : 'left'
  const next: RoadTemplate = { ...template, [`${to}Width`]: template[`${from}Width`] }
  for (const attribute of attributes) {
    const own = template[`${from}${attribute}`]
    // An inherited value stays inherited on both sides; an own value is copied across.
    if (own === undefined) delete next[`${to}${attribute}`]
    else next[`${to}${attribute}`] = own
  }
  // A side's own rock cut is copied across; an inherited one stays inherited on both sides.
  if (template[`${from}RockCut`]) next[`${to}RockCut`] = { ...template[`${from}RockCut`] }
  else delete next[`${to}RockCut`]
  // Ditch inslope, benches and sub-cut follow the same rule as the side values.
  if (template[`${from}DitchInslope`] !== undefined) next[`${to}DitchInslope`] = template[`${from}DitchInslope`]
  else delete next[`${to}DitchInslope`]
  if (template[`${from}Benches`]) next[`${to}Benches`] = structuredClone(template[`${from}Benches`])
  else delete next[`${to}Benches`]
  if (template[`${from}SubCut`]) next[`${to}SubCut`] = { ...template[`${from}SubCut`]! }
  else delete next[`${to}SubCut`]
  if (template.walls)
    next.walls = template.walls.flatMap((wall) =>
      wall.side === to ? [] : wall.side === from ? [wall, { ...wall, id: newId(), side: to }] : [wall],
    )
  if (template.barriers)
    next.barriers = template.barriers.flatMap((barrier) =>
      barrier.side === to ? [] : barrier.side === from ? [barrier, { ...barrier, id: newId(), side: to }] : [barrier],
    )
  if (template.components)
    next.components = template.components.flatMap((component) =>
      component.side === to ? [] : [component, { ...component, id: newId(), side: to }],
    )
  if (template.layers)
    next.layers = template.layers.flatMap((layer) =>
      layer.side === to ? [] : layer.side === from ? [layer, { ...layer, id: newId(), side: to }] : [layer],
    )
  return next
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
/**
 * What a keyed rock-fill template sets. The rock slope is the template's fill batter and the
 * subgrade width its lane width on each side; each key is an excavated-key component on the fill
 * side. A rock-fill thickness is not an input: the model does not divide an embankment into a rock
 * zone and ordinary fill, so there is nothing for it to change.
 */
export interface RockFillOptions {
  /** Fill batter H:V. */
  rockSlope: number
  keyWidthM: number
  keyDepthM: number
  /** Lane width per side; omitted keeps the widths of the section it starts from. */
  subgradeWidthM?: number
}
export const ROCK_FILL_DEFAULTS: RockFillOptions = { rockSlope: 1, keyWidthM: 2, keyDepthM: 1 }

/**
 * A new template for a keyed-in rock fill, built from `base` without changing it: the same lane,
 * crossfall, ditches, cut batter and surfacing, with the fill batter at the rock slope and a key
 * under each fill-side toe. A key is built only where its side is in fill, so cut sides keep their
 * ditch. `newId` supplies the two component ids. Throws when the result is out of range.
 */
export function keyedRockFillTemplate(
  base: RoadTemplate,
  newId: () => string,
  options: Partial<RockFillOptions> = {},
): RoadTemplate {
  const { rockSlope, keyWidthM, keyDepthM, subgradeWidthM } = { ...ROCK_FILL_DEFAULTS, ...options }
  const template: RoadTemplate = { ...base, fillSlope: rockSlope }
  delete template.leftFillSlope
  delete template.rightFillSlope
  if (subgradeWidthM !== undefined) {
    template.leftWidth = subgradeWidthM
    template.rightWidth = subgradeWidthM
  }
  template.components = [
    // Keys the base already has would overlap the new ones; its benches and walls are kept.
    ...(base.components ?? []).filter((component) => component.kind !== 'key').map((c) => ({ ...c })),
    ...(['left', 'right'] as const).map(
      (side): SectionComponent => ({
        id: newId(),
        name: `${side === 'left' ? 'Left' : 'Right'} keyed rock fill`,
        side,
        kind: 'key',
        condition: 'fill',
        widthM: keyWidthM,
        riseM: 0,
        depthM: keyDepthM,
        offsetM: 0,
      }),
    ),
  ]
  if (base.layers) template.layers = base.layers.map((layer) => ({ ...layer }))
  validateTemplate(template)
  return template
}

export function templateFromStarter(base: RoadTemplate, starter: TemplateStarter): RoadTemplate {
  const template: RoadTemplate = { ...base }
  if (starter !== 'current') {
    delete template.components
    delete template.layers
    for (const key of [
      'leftDitchInslope',
      'rightDitchInslope',
      'leftBenches',
      'rightBenches',
      'leftSubCut',
      'rightSubCut',
      'walls',
      'barriers',
    ] as const)
      delete template[key]
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
 * The range a ditch width field accepts so that no side's flat bottom is wider than its top: the
 * rule `validateTemplate` enforces, for the field it is typed in. A base value is limited by every
 * side that inherits it. Null for any other template key.
 */
export function ditchWidthRange(t: RoadTemplate, key: string): { min: number; max: number } | null {
  const sides = ['left', 'right'] as const
  const side = /^(left|right)Ditch(Bottom)?Width$/.exec(key)?.[1] as Side | undefined
  if (side)
    return key.endsWith('BottomWidth')
      ? { min: 0, max: Math.min(MAX_DITCH_WIDTH_M, sideValue(t, side, 'DitchWidth')) }
      : { min: Math.min(MAX_DITCH_WIDTH_M, sideValue(t, side, 'DitchBottomWidth')), max: MAX_DITCH_WIDTH_M }
  if (key === 'ditchBottomWidth') {
    const tops = sides.filter((s) => t[`${s}DitchBottomWidth`] === undefined).map((s) => sideValue(t, s, 'DitchWidth'))
    return { min: 0, max: Math.min(MAX_DITCH_WIDTH_M, ...tops) }
  }
  if (key === 'ditchWidth') {
    const bottoms = sides
      .filter((s) => t[`${s}DitchWidth`] === undefined)
      .map((s) => sideValue(t, s, 'DitchBottomWidth'))
    return { min: Math.min(MAX_DITCH_WIDTH_M, Math.max(0, ...bottoms)), max: MAX_DITCH_WIDTH_M }
  }
  return null
}

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
  base('ditchWidth', 'ditch width (m)', 0, MAX_DITCH_WIDTH_M)
  base('ditchDepth', 'ditch depth (m)', 0, MAX_DITCH_DEPTH_M)
  base('surfaceDepth', 'surfacing depth (m)', 0, 2)
  validateRockCut(t, owner, target)
  validateSectionStructures(t, owner, target)
  for (const side of ['left', 'right'] as const) {
    const value = (attribute: Attribute, label: string, low: number, high: number) =>
      requireInRange(sideValue(t, side, attribute), low, high, owner, `${side} ${label}`, {
        ...target,
        field: `${side}${attribute}`,
      })
    value('CrossfallPercent', 'crossfall (%)', -20, 20)
    value('CutSlope', 'cut batter (H:V)', 0.1, 10)
    value('FillSlope', 'fill batter (H:V)', 0.1, 10)
    value('DitchWidth', 'ditch width (m)', 0, MAX_DITCH_WIDTH_M)
    value('DitchDepth', 'ditch depth (m)', 0, MAX_DITCH_DEPTH_M)
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
  for (const o of e.parameterOverrides ?? []) {
    try {
      validateParameterOverride(o)
    } catch (cause) {
      throw new EngineeringInputError(cause instanceof Error ? cause.message : String(cause), {
        list: 'parameterOverrides',
        id: o.id,
        field: 'points',
      })
    }
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
    for (const field of ['transitionInM', 'transitionOutM'] as const)
      if (a[field] !== undefined)
        requireInRange(
          a[field],
          0,
          a.end - a.start,
          owner,
          `transition ${field === 'transitionInM' ? 'in' : 'out'} (m)`,
          {
            ...target,
            field,
          },
        )
    if ((a.transitionInM ?? 0) + (a.transitionOutM ?? 0) > a.end - a.start + EPS)
      throw new EngineeringInputError(
        `${owner}: its transitions in and out together are longer than the range (${plain(a.end - a.start)} m).`,
        { ...target, field: 'transitionOutM' },
      )
    if (a.transitionM > 0 && ((a.transitionInM ?? 0) > 0 || (a.transitionOutM ?? 0) > 0))
      throw new EngineeringInputError(
        `${owner}: blend to the base section (transition) or to the neighbouring ranges (transition in and out), not both.`,
        { ...target, field: 'transitionM' },
      )
    for (let j = 0; j < i; j++) {
      const b = e.assignments[j],
        from = Math.max(a.start, b.start),
        to = Math.min(a.end, b.end)
      const sameSide = a.side === b.side || a.side === 'both' || b.side === 'both'
      if (to > from + EPS && sameSide)
        throw new EngineeringInputError(
          `${owner} and template range ${j + 1} overlap on the same side between ${plain(from)} and ${plain(to)} m. Change a station, or give each range its own side.`,
          target,
        )
      // Two transitions meeting at one boundary would each blend the other way and jump there.
      const meets = (x: TemplateAssignment, y: TemplateAssignment) =>
        Math.abs(x.end - y.start) <= EPS && (x.transitionOutM ?? 0) > 0 && (y.transitionInM ?? 0) > 0
      if (sameSide && (meets(a, b) || meets(b, a)))
        throw new EngineeringInputError(
          `${owner} and template range ${j + 1} both transition at ${plain(meets(a, b) ? a.end : a.start)} m. Give the transition to one of them.`,
          { ...target, field: meets(a, b) ? 'transitionOutM' : 'transitionInM' },
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
    if (m.rock !== undefined && typeof m.rock !== 'boolean')
      throw new EngineeringInputError(`${owner}: rock must be on or off.`, { ...target, field: 'rock' })
    if (m.rock && m.purpose === 'stripping')
      throw new EngineeringInputError(`${owner}: a stripping material cannot also be rock.`, {
        ...target,
        field: 'rock',
      })
    if (m.shallowCutRate !== undefined)
      requireInRange(m.shallowCutRate, 0, 10000, owner, 'shallow rock rate ($/bank m³)', {
        ...target,
        field: 'shallowCutRate',
      })
    if (m.overbreakRate !== undefined)
      requireInRange(m.overbreakRate, 0, 10000, owner, 'overbreak rate ($/bank m³)', {
        ...target,
        field: 'overbreakRate',
      })
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
    requireInRange(a.topDepthM, 0, MAX_HORIZON_DEPTH_M, owner, 'top depth (m)', { ...target, field: 'topDepthM' })
    if (a.bottomDepthM !== null) {
      requireInRange(a.bottomDepthM, 0, MAX_HORIZON_DEPTH_M, owner, 'bottom depth (m)', {
        ...target,
        field: 'bottomDepthM',
      })
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
    field('skewDegrees', 'skew from square (°)', -80, 80)
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
    if (s.pastRoadEndM !== undefined) field('pastRoadEndM', "access past the road's end (m)", 0, 100000)
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

type Assignment = TemplateAssignment
const onSide = (a: Assignment, side: Side) => a.side === side || a.side === 'both'
const transitionIn = (a: Assignment) => ((a.transitionInM ?? 0) > 0 ? a.transitionInM! : 0)
const transitionOut = (a: Assignment) => ((a.transitionOutM ?? 0) > 0 ? a.transitionOutM! : 0)

/**
 * The template in force on one side just before (`-1`) or just after (`+1`) a range boundary,
 * leaving the range itself out: the other range there, else the base section.
 */
function neighbourAt(alignment: Alignment, self: Assignment, side: Side, at: number, direction: -1 | 1) {
  const e = alignment.engineering!
  const c = at + direction * 1e-6
  const other = e.assignments
    .filter((a) => a !== self && onSide(a, side) && c >= a.start && c <= a.end)
    .sort((a, b) => b.start - a.start)[0]
  const named = other ? e.templates.find((t) => t.id === other.templateId) : undefined
  return named
    ? { template: named.template, name: named.name, assignment: other! }
    : { template: alignment.template, name: 'Base section', assignment: null }
}

/** One side's transition to a neighbouring range at a station, or null outside every such transition. */
function neighbourTransition(alignment: Alignment, assignment: Assignment, side: Side, chainage: number) {
  const into = transitionIn(assignment),
    out = transitionOut(assignment)
  // Where both would apply (a range no longer than its two transitions) the nearer end wins.
  const fromStart = chainage - assignment.start,
    fromEnd = assignment.end - chainage
  const edge =
    into > 0 && fromStart < into && (out <= 0 || fromStart <= fromEnd) ? 'in' : out > 0 && fromEnd < out ? 'out' : null
  if (!edge) return null
  const neighbour = neighbourAt(
    alignment,
    assignment,
    side,
    edge === 'in' ? assignment.start : assignment.end,
    edge === 'in' ? -1 : 1,
  )
  const ratio = clamp(edge === 'in' ? fromStart / into : fromEnd / out)
  return { edge, neighbour, ratio } as const
}

export function templateAt(alignment: Alignment, chainage: number): ResolvedTemplate {
  const result = resolvedTemplateAt(alignment, chainage)
  // Values entered at stations (RoadEng's parameter overrides) go over whichever template is in force.
  const overrides = alignment.engineering?.parameterOverrides
  if (overrides?.length)
    applyParameterOverrides(
      result.template,
      chainage,
      overrides,
      (station) => resolvedTemplateAt(alignment, station).template,
    )
  return result
}

function resolvedTemplateAt(alignment: Alignment, chainage: number): ResolvedTemplate {
  const template = { ...alignment.template }
  const result: ResolvedTemplate = { template, leftName: 'Base section', rightName: 'Base section', assignmentIds: [] }
  const e = alignment.engineering
  if (!e) return result
  // Batter sources resolve per side, so a range on one side leaves the other side's alone.
  const sources = [
    ['Cut', 'cut'],
    ['Fill', 'fill'],
  ] as const
  if (e.assignments.length && sources.some(([, which]) => template[`${which}SlopeFrom`] !== undefined)) {
    for (const [Kind, which] of sources) {
      for (const side of ['left', 'right'] as const) {
        const value = batterSource(alignment.template, side, which)
        if (value === undefined) delete template[`${side}${Kind}SlopeFrom`]
        else template[`${side}${Kind}SlopeFrom`] = value
      }
      delete template[`${which}SlopeFrom`]
    }
  }
  // A touching boundary belongs to the range that starts there, not the preceding one.
  for (const side of ['left', 'right'] as const) {
    const assignment = e.assignments
      .filter((a) => a.side !== (side === 'left' ? 'right' : 'left') && chainage >= a.start && chainage <= a.end)
      .sort((a, b) => b.start - a.start)[0]
    if (!assignment) continue
    const named = e.templates.find((t) => t.id === assignment.templateId)
    if (!named) continue // Analysis validation reports the unknown ID.
    // What the side blends from: the base section (`transitionM`), or over a transition to a
    // neighbouring range, that range's template (RoadEng's Taper).
    const toNeighbour = neighbourTransition(alignment, assignment, side, chainage)
    let from: RoadTemplate = alignment.template
    let ratio =
      assignment.transitionM > 0
        ? clamp(Math.min(chainage - assignment.start, assignment.end - chainage) / assignment.transitionM)
        : 1
    let stepped = false
    if (toNeighbour) {
      from = toNeighbour.neighbour.template
      ratio = toNeighbour.ratio
      // Templates that differ in structure cannot be interpolated: they step at the midpoint.
      if (componentTransitionProblem(from, named.template, side) !== null) {
        stepped = true
        ratio = ratio < 0.5 ? 0 : 1
      }
    }
    const widthKey = `${side}Width` as const
    template[widthKey] = from[widthKey] + (named.template[widthKey] - from[widthKey]) * ratio
    for (const attribute of attributes) {
      const base = sideValue(from, side, attribute)
      template[`${side}${attribute}`] = base + (sideValue(named.template, side, attribute) - base) * ratio
    }
    if (rockCutAt(from, side) || rockCutAt(named.template, side)) {
      const rock = blendRockCut(rockCutAt(from, side), rockCutAt(named.template, side), ratio)
      // Each side resolves to a block of its own, so a one-sided assignment leaves the other alone.
      const other = side === 'left' ? 'right' : 'left'
      if (template[`${other}RockCut`] === undefined && template.rockCut)
        template[`${other}RockCut`] = { ...template.rockCut }
      delete template.rockCut
      if (rock) template[`${side}RockCut`] = rock
      else delete template[`${side}RockCut`]
      if (!template[`${other}RockCut`]) delete template[`${other}RockCut`]
    }
    // Where the batters come from is a choice, not a value: the nearer template's holds.
    for (const [Kind, which] of sources) {
      const value = batterSource(ratio >= 0.5 ? named.template : from, side, which)
      if (value === undefined) delete template[`${side}${Kind}SlopeFrom`]
      else template[`${side}${Kind}SlopeFrom`] = value
    }
    blendSectionStructures(template, from, named.template, side, ratio)
    if (from.components || named.template.components) {
      const others = (template.components ?? []).filter((c) => c.side !== side)
      template.components = [...others, ...blendedComponents(from, named.template, side, ratio)]
    }
    if (from.layers || named.template.layers) {
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
      template.layers = [...others, ...blend(from, 1 - ratio), ...blend(named.template, ratio)]
    }
    result[`${side}Name`] = toNeighbour
      ? `${toNeighbour.edge === 'in' ? `${toNeighbour.neighbour.name} → ${named.name}` : `${named.name} → ${toNeighbour.neighbour.name}`} · transition${stepped ? ', stepped at its midpoint' : ''}`
      : ratio < 1
        ? `${named.name} · transition`
        : named.name
    if (!result.assignmentIds.includes(assignment.id)) result.assignmentIds.push(assignment.id)
  }
  return result
}

/** One transition between neighbouring ranges, on one side, in road chainage. */
export interface TemplateTransition {
  assignmentId: string
  side: Side
  /** `in`: from the section before the range; `out`: to the section after it. */
  edge: 'in' | 'out'
  start: number
  end: number
  fromName: string
  toName: string
  /**
   * Set where the two templates differ in structure and cannot be interpolated: the section steps
   * from one to the other at the transition's midpoint. Names the difference ("reordered components").
   */
  steppedBecause: string | null
}

/** Every transition to a neighbouring range (`transitionInM`/`transitionOutM`), side by side. */
export function templateTransitions(alignment: Alignment): TemplateTransition[] {
  const e = alignment.engineering
  if (!e) return []
  const out: TemplateTransition[] = []
  for (const a of e.assignments) {
    const named = e.templates.find((t) => t.id === a.templateId)
    if (!named || (!transitionIn(a) && !transitionOut(a))) continue
    for (const side of ['left', 'right'] as const) {
      if (!onSide(a, side)) continue
      for (const edge of ['in', 'out'] as const) {
        const length = edge === 'in' ? transitionIn(a) : transitionOut(a)
        if (!(length > 0)) continue
        const neighbour = neighbourAt(alignment, a, side, edge === 'in' ? a.start : a.end, edge === 'in' ? -1 : 1)
        const problem = componentTransitionProblem(neighbour.template, named.template, side)
        out.push({
          assignmentId: a.id,
          side,
          edge,
          start: edge === 'in' ? a.start : a.end - length,
          end: edge === 'in' ? a.start + length : a.end,
          fromName: edge === 'in' ? neighbour.name : named.name,
          toName: edge === 'in' ? named.name : neighbour.name,
          steppedBecause: problem && problem.replace(/ (requires?|need) .*$/, '').toLowerCase(),
        })
      }
    }
  }
  return out.sort((x, y) => x.start - y.start || x.side.localeCompare(y.side))
}

/** Include discontinuity neighbours so an area change is not smeared over an ordinary interval. */
export function engineeringKnots(alignment: Alignment): number[] {
  const e = alignment.engineering
  if (!e) return []
  const knots: number[] = []
  for (const a of e.assignments) {
    knots.push(a.start, a.end, a.start + a.transitionM, a.end - a.transitionM)
    if (!a.transitionM) knots.push(a.start - 1e-5, a.end + 1e-5)
    // A transition to a neighbouring range ends on a station, and one that steps at its midpoint
    // samples both sides of the step.
    if (transitionIn(a)) knots.push(a.start + transitionIn(a))
    if (transitionOut(a)) knots.push(a.end - transitionOut(a))
  }
  for (const t of templateTransitions(alignment))
    if (t.steppedBecause) {
      const mid = (t.start + t.end) / 2
      knots.push(mid - 1e-5, mid, mid + 1e-5)
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
  for (const station of parameterOverrideKnots(e.parameterOverrides))
    knots.push(station - 1e-5, station, station + 1e-5)
  return knots
}
