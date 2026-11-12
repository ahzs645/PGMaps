/**
 * The block's visual measures, drafted for the Site Plan and the Logging Plan.
 *
 * Practitioners write the measures that achieve the visual objective into the
 * site plan and the logging plan, so the crew knows what to keep and when to
 * stop. This drafts that list from what the assessment records: the objective
 * and the measured and adjusted figure, VAC, the wildlife tree patches and
 * retention masks with their area, the block's harvest system, the step-4
 * design ratings, the run's skyline check and road visibility — and always
 * ends with a stop-work condition.
 *
 * Like the Visuals paragraph it is a draft the reviewer signs: the panel keeps
 * the reviewer's text (`viaReview.visualMeasures`) and offers the draft beside
 * it, each measure with what it was written from. No DOM, no network.
 */
import { MASK_LABELS } from './assessmentMasks'
import type { LandformDesignReview } from './landformDesign'
import type { AssessmentMask, HarvestSystem, TargetPolygon } from './types'
import {
  percentStanding,
  ROADS_VISIBILITY,
  table2Range,
  type DesignElementId,
  type DesignRating,
  type PercentStanding,
  type RoadsVisibility,
  type ViaAssessment,
} from './via'
import { metersPerDegree, pointInPolygon, polygonAreaMeters, polygonBounds, type PolygonGeometry } from './visibility'
import { EVQO_CODE_FOR_CLASS, EVQO_NAMES } from './visualsNarrative'
import { VAC_LABELS, type VacRating, type VisualQualityClassId } from './vqo'

export type VisualMeasure = {
  id: string
  text: string
  /** What the measure was drafted from, for the reviewer. */
  basis: string
}

export type PatchLocation = 'inside' | 'boundary' | 'beside'

export type RunState = 'none' | 'stale' | 'current'

export type MeasuresInput = {
  block: {
    name: string
    areaHa: number
    harvestSystem: HarvestSystem
    retentionPercent: number | null
    volumeRemovedPercent: number | null
    residualHeightMeters: number | null
  }
  /** The landform's objective; null until a landform is adopted. */
  objective: { id: VisualQualityClassId; vac: VacRating | null; landformName: string } | null
  viewpointName: string
  /** X and the adjusted figure, when a current run gives them. */
  figures: {
    /** Whether a run stands behind the figures: none yet, one the scene has changed since, or the current one. */
    run: RunState
    initialPercent: number | null
    adjustedPercent: number | null
  }
  /** Wildlife tree patches / retention masks in or beside the block. */
  patches: ReadonlyArray<{ name: string; areaHa: number; location: PatchLocation }>
  /** Each design element's rating as used in step 4 (the reviewer's, else measured). */
  design: Partial<Record<DesignElementId, DesignRating | null>>
  roads: RoadsVisibility | null
  /** Stations from which the run puts the block near the landform's silhouette. */
  skyline: { stations: number; stationCount: number } | null
}

/** Where the wording changes; exported for the docs and the panel. */
export const MEASURE_LIMITS = {
  /** A retention mask this close to the block (bounds to bounds) is listed with it. */
  patchNearMeters: 500,
  /** Patches named one by one; any more are summed in one measure. */
  namedPatches: 6,
  /** The reviewer's stored text, as `parseViaReview` keeps it. */
  maxTextLength: 4000,
} as const

const ha = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)} ha`
const pct = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)}%`

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`
}

const LOCATION_WORDS: Record<PatchLocation, string> = {
  inside: 'inside the block',
  boundary: 'on the block boundary',
  beside: 'beside the block',
}

function standingWords(standing: PercentStanding): string {
  if (standing === 'over')
    return ' This is over the range: do not start harvesting until the block is redesigned and reassessed.'
  if (standing === 'near-boundary')
    return ' This is near the top of the range, so the layout leaves little room for change in the field.'
  return ' This is within the range.'
}

function objectiveMeasure(input: MeasuresInput): VisualMeasure | null {
  const objective = input.objective
  if (!objective) return null
  const code = EVQO_CODE_FOR_CLASS[objective.id]
  const range = table2Range(objective.id).label
  const from = input.viewpointName ? ` from ${input.viewpointName}` : ''
  const vac = objective.vac ? `; visual absorption capability ${VAC_LABELS[objective.vac].toLowerCase()}` : ''
  let text = `Visual quality objective: ${EVQO_NAMES[code]} '${code}', ${range} alteration in perspective view${from}${vac}.`
  const basis = [`Landform ${objective.landformName}: objective ${EVQO_NAMES[code]}, Table 2 ${range}`]
  if (objective.vac) basis.push(`VAC ${VAC_LABELS[objective.vac].toLowerCase()}`)
  const { initialPercent, adjustedPercent } = input.figures
  if (adjustedPercent !== null && initialPercent !== null) {
    text += ` The design is assessed at ${pct(initialPercent)} (${pct(adjustedPercent)} after the design adjustments).`
    text += standingWords(percentStanding(adjustedPercent, objective.id))
    basis.push(`X ${pct(initialPercent)} from the run, adjusted ${pct(adjustedPercent)} in step 4`)
  } else if (initialPercent !== null) {
    text += ` The design is measured at ${pct(initialPercent)} before the design adjustments.`
    text += standingWords(percentStanding(initialPercent, objective.id))
    basis.push(`X ${pct(initialPercent)} from the run; step 4 not complete, so no adjusted figure`)
  } else if (input.figures.run === 'current') {
    text += ' The run has not given a percent alteration yet: see step 4.'
    basis.push('The current run withholds X (provisional, or a visible partial cut lacks its Table 6 values)')
  } else if (input.figures.run === 'stale') {
    text += ' The scene changed since the run: run it again for the percent alteration.'
    basis.push('The scene changed since the run')
  } else {
    text += ' The percent alteration has not been measured yet.'
    basis.push('No run yet')
  }
  return { id: 'objective', text, basis: basis.join('; ') }
}

function patchMeasures(input: MeasuresInput): VisualMeasure[] {
  const patches = input.patches
  if (!patches.length) return []
  const label = MASK_LABELS.retained
  const named = patches.slice(0, MEASURE_LIMITS.namedPatches).map((patch, i) => ({
    id: `patch-${i}`,
    text: `Keep ${/^wildlife tree patch\b/i.test(patch.name) ? patch.name : `wildlife tree patch '${patch.name}'`} (${ha(patch.areaHa)}, ${LOCATION_WORDS[patch.location]}) standing as mapped: no falling, yarding or road building inside it.`,
    basis: `${label} mask '${patch.name}', ${ha(patch.areaHa)}, ${LOCATION_WORDS[patch.location]}`,
  }))
  const rest = patches.slice(MEASURE_LIMITS.namedPatches)
  if (rest.length) {
    const area = rest.reduce((sum, patch) => sum + patch.areaHa, 0)
    named.push({
      id: 'patch-rest',
      text: `Keep the other ${rest.length} wildlife tree patches (${ha(area)} in all) standing as mapped.`,
      basis: `${rest.length} more ${label} masks: ${rest.map((patch) => patch.name).join(', ')}`,
    })
  }
  const inside = patches.filter((patch) => patch.location !== 'beside')
  if (inside.length && input.block.areaHa > 0) {
    const area = inside.reduce((sum, patch) => sum + patch.areaHa, 0)
    named[0] = {
      ...named[0],
      basis: `${named[0].basis}. Patches in or on the block: ${ha(area)}, about ${Math.round((area / input.block.areaHa) * 100)}% of its ${ha(input.block.areaHa)}`,
    }
  }
  return named
}

function harvestMeasure(input: MeasuresInput): VisualMeasure | null {
  const block = input.block
  if (block.harvestSystem === 'retention') {
    const share = block.retentionPercent
    return {
      id: 'harvest',
      text:
        share !== null
          ? `Leave ${Math.round(share)}% of the stand standing as dispersed retention, spread across the visible face of the block.`
          : 'Leave the dispersed retention prescribed for the block standing, spread across its visible face.',
      basis:
        share !== null
          ? `Block harvest system: dispersed retention, ${Math.round(share)}% retained`
          : 'Block harvest system: dispersed retention, share not yet recorded',
    }
  }
  if (block.harvestSystem === 'partial') {
    const removed = block.volumeRemovedPercent
    const height = block.residualHeightMeters
    const parts = [
      removed !== null ? `remove no more than ${Math.round(removed)}% of the volume` : null,
      height !== null ? `leave a residual stand with a mean height of at least ${Math.round(height)} m` : null,
    ].filter((part): part is string => part !== null)
    return {
      id: 'harvest',
      text: parts.length
        ? `Partial cut: ${parts.join(' and ')}.`
        : 'Partial cut: keep to the prescribed volume removal and residual stand height.',
      basis: `Block harvest system: partial cut, ${removed !== null ? `${Math.round(removed)}% volume removed` : 'volume removed not recorded'}, ${height !== null ? `residual height ${Math.round(height)} m` : 'residual height not recorded'}`,
    }
  }
  return null
}

const RATING_WORDS: Record<DesignRating, string> = { 1: 'good', 0: 'moderate', [-1]: 'poor' }

function designMeasures(input: MeasuresInput): VisualMeasure[] {
  const out: VisualMeasure[] = []
  const rated = (id: DesignElementId) => input.design[id] ?? null
  const edge = rated('edge-treatment')
  if (edge === 1)
    out.push({
      id: 'edges',
      text: 'Feather the block edges and keep the irregular, interlocking boundary as flagged; do not straighten it.',
      basis: 'Step 4 edge treatment rated good: feathering and irregular boundaries',
    })
  else if (edge === 0)
    out.push({
      id: 'edges',
      text: 'Keep the edge treatment as laid out (feathered edges or an irregular boundary); do not straighten the boundary.',
      basis: 'Step 4 edge treatment rated moderate: one of feathering or an irregular boundary',
    })
  if (rated('force-lines') === 1)
    out.push({
      id: 'force-lines',
      text: 'Hold the boundary to the landform as flagged: up into the hollows and down off the ridges.',
      basis: 'Step 4 response to visual force lines rated good',
    })
  if (rated('natural-character') === 1)
    out.push({
      id: 'natural-character',
      text: 'Keep the opening’s shape as flagged so it echoes the natural openings around it; do not square off its corners.',
      basis: 'Step 4 borrows from natural character rated good',
    })
  if (rated('position') === 1)
    out.push({
      id: 'position',
      text: 'Keep the opening low on the landform and to one side, as laid out; do not extend it upslope or toward the centre of the face.',
      basis: 'Step 4 position on the landform rated good',
    })
  const spacing = rated('number-size-spacing')
  out.push({
    id: 'scale',
    text: `Keep the opening to the ${ha(input.block.areaHa)} flagged; any boundary change needs the visuals reassessed.`,
    basis: `Block area ${ha(input.block.areaHa)}${spacing !== null ? `; step 4 number, size and spacing rated ${RATING_WORDS[spacing]}` : ''}`,
  })
  return out
}

function skylineMeasure(input: MeasuresInput): VisualMeasure | null {
  const skyline = input.skyline
  if (!skyline || skyline.stations <= 0) return null
  return {
    id: 'skyline',
    text: 'Keep standing timber between the top of the opening and the skyline: do not cut through to the ridgeline.',
    basis: `The run puts the block near the landform’s silhouette from ${skyline.stations} of ${skyline.stationCount} stations (Landform design review)`,
  }
}

function roadsMeasure(input: MeasuresInput): VisualMeasure | null {
  if (input.roads === null || input.roads === 0) return null
  const where = input.viewpointName ? ` where they face ${input.viewpointName}` : ' where they are in view'
  return {
    id: 'roads',
    text: `Keep road right-of-way clearing, cut slopes and sidecast to the minimum${where}.`,
    basis: `Step 4 road visibility: ${ROADS_VISIBILITY.find((entry) => entry.value === input.roads)?.label ?? input.roads}`,
  }
}

function stopWorkMeasure(input: MeasuresInput, measures: VisualMeasure[]): VisualMeasure {
  const has = (id: string) => measures.some((measure) => measure.id === id || measure.id.startsWith(`${id}-`))
  const conditions: string[] = []
  if (has('patch')) conditions.push('the wildlife tree patches cannot be placed or kept as mapped')
  if (has('edges') || has('force-lines') || has('natural-character'))
    conditions.push('the feathered or irregular edges cannot be laid out as planned')
  if (has('skyline')) conditions.push('the timber below the skyline cannot be kept')
  if (has('harvest')) conditions.push('the retention or partial-cut prescription cannot be met')
  const objective = input.objective
    ? `, which could exceed the ${EVQO_NAMES[EVQO_CODE_FOR_CLASS[input.objective.id]]} objective`
    : ''
  conditions.push(
    `the boundary has to move or the opening would grow past the ${ha(input.block.areaHa)} flagged${objective}`,
  )
  return {
    id: 'stop-work',
    text: `Stop operations in the affected area and contact the visual specialist or planning forester ${joinOr(conditions.map((c) => `if ${c}`))}.`,
    basis: 'Always included; its conditions follow the measures above',
  }
}

/** The drafted measures, in the order a site plan lists them, ending with the stop-work condition. */
export function draftVisualMeasures(input: MeasuresInput): { measures: VisualMeasure[]; text: string } {
  const measures = [
    objectiveMeasure(input),
    ...patchMeasures(input),
    harvestMeasure(input),
    ...designMeasures(input),
    skylineMeasure(input),
    roadsMeasure(input),
  ].filter((measure): measure is VisualMeasure => measure !== null)
  measures.push(stopWorkMeasure(input, measures))
  return { measures, text: measures.map((measure) => measure.text).join('\n') }
}

/**
 * The reviewer's text as a list: one measure per line, with any bullet or
 * number they typed taken off (the files number the list themselves).
 */
export function measureItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0)
}

// ---------------------------------------------------------------------------
// From the scene

function outerVertices(geometry: PolygonGeometry): Array<[number, number]> {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0])
  return rings.flatMap((ring) => (ring ?? []).slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]))
}

/** Where a patch sits against the block: most of its outline inside, some, or none. */
export function patchLocation(block: PolygonGeometry, patch: PolygonGeometry): PatchLocation {
  const vertices = outerVertices(patch)
  if (!vertices.length) return 'beside'
  const inside = vertices.filter(([lng, lat]) => pointInPolygon(block, lng, lat)).length
  if (inside === vertices.length) return 'inside'
  if (inside > 0) return 'boundary'
  // A patch can enclose the block's own vertices without any of its outline inside.
  return outerVertices(block).some(([lng, lat]) => pointInPolygon(patch, lng, lat)) ? 'boundary' : 'beside'
}

/** The retention masks in or within `patchNearMeters` of the block. */
export function patchesForBlock(block: PolygonGeometry, masks: ReadonlyArray<AssessmentMask>) {
  const bounds = polygonBounds(block)
  const scale = metersPerDegree((bounds[1] + bounds[3]) / 2)
  const padLng = MEASURE_LIMITS.patchNearMeters / scale.lng
  const padLat = MEASURE_LIMITS.patchNearMeters / scale.lat
  return masks.flatMap((mask) => {
    if (mask.kind !== 'retained') return []
    const b = polygonBounds(mask.geometry)
    if (
      b[0] > bounds[2] + padLng ||
      b[2] < bounds[0] - padLng ||
      b[1] > bounds[3] + padLat ||
      b[3] < bounds[1] - padLat
    )
      return []
    return [
      {
        name: mask.name,
        areaHa: polygonAreaMeters(mask.geometry) / 10_000,
        location: patchLocation(block, mask.geometry),
      },
    ]
  })
}

export function measuresInputFromScene(args: {
  block: TargetPolygon
  masks: ReadonlyArray<AssessmentMask>
  landform: TargetPolygon | null
  /** Step 4's assessment; null without a landform. */
  assessment: ViaAssessment | null
  /** The run behind `assessment`; its figures are left out unless it is current. */
  run: RunState
  landformDesign: LandformDesignReview | null | undefined
  viewpointName: string
}): MeasuresInput {
  const { block, assessment } = args
  const current = args.run === 'current' && !!assessment
  const design: MeasuresInput['design'] = {}
  if (assessment)
    for (const [id, entry] of Object.entries(assessment.design) as Array<
      [DesignElementId, ViaAssessment['design'][DesignElementId]]
    >)
      design[id] = entry.rating
  const review = current ? args.landformDesign?.blocks.find((entry) => entry.id === block.id) : undefined
  return {
    block: {
      name: block.name,
      areaHa: polygonAreaMeters(block.geometry) / 10_000,
      harvestSystem: block.harvestSystem ?? 'clearcut',
      retentionPercent: block.retentionPercent ?? null,
      volumeRemovedPercent: block.volumeRemovedPercent ?? null,
      residualHeightMeters: block.residualHeightMeters ?? null,
    },
    objective: args.landform
      ? { id: args.landform.objectiveId, vac: args.landform.vac, landformName: args.landform.name }
      : null,
    viewpointName: args.viewpointName,
    figures: {
      run: args.run,
      initialPercent: current ? (assessment?.initialPercent ?? null) : null,
      adjustedPercent: current ? (assessment?.adjusted?.percent ?? null) : null,
    },
    patches: patchesForBlock(block.geometry, args.masks),
    design,
    roads: assessment?.roads ?? null,
    skyline: review ? { stations: review.silhouetteStations.length, stationCount: review.stationCount } : null,
  }
}
