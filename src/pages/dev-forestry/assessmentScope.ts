/**
 * The reviewed scope of an assessment (backlog VQ-14): which landform was assessed and which visual landscape
 * inventory unit(s) it came from, each block's gross and net footprint and its treatment, the masks and exclusions and
 * which denominator each leaves or keeps, and where every one of them came from (the inventory, an adopted candidate,
 * drawn, imported). Two figures measured on different scopes (a whole unit and gross blocks against a face and net
 * blocks) are not the same measurement; the scope is what says so, beside each figure.
 *
 * Derived from the scene and the run, never entered where the scene already holds the fact: the landform, blocks and
 * masks are the scene's, the denominators' rules the run's settings, and the treed area the run's own figure
 * (`landformForestedAreaMeters`), read, never recomputed. Areas of the scene's own shapes (gross, net of masks) are
 * planar measurements of that geometry, as the report's project table prints them. What only the reviewer can say
 * (whether the landform is the whole unit or part of it, a note) is the review record's (`LandformRecord.reviewedAs`,
 * `scopeNote`): a record of review that never stales the run. No DOM or network access.
 */
import difference from '@turf/difference'
import intersect from '@turf/intersect'

import { MASK_LABELS, masksForLandform } from './assessmentMasks'
import { unitValues, type BadgeUnit } from './inventoryBadge'
import type { AnalysisResult, AnalysisSettings, AssessmentMask, AssessmentMaskKind, TargetPolygon } from './types'
import { REVIEWED_EXTENTS, type ReviewedExtent, type ViaReview } from './via'
import { polygonAreaMeters, polygonBounds, preparePolygons, type PolygonGeometry } from './visibility'

/** Where a piece of the scope came from. */
export type ScopeOrigin = 'inventory' | 'candidate' | 'drawn' | 'imported' | 'sample' | 'recorded'

export const SCOPE_ORIGIN_LABELS: Record<ScopeOrigin, string> = {
  inventory: 'Inventory',
  candidate: 'Adopted candidate',
  drawn: 'Drawn',
  imported: 'Imported',
  sample: 'Sample scenario',
  recorded: 'As recorded',
}

export type ScopeProvenance = { origin: ScopeOrigin; label: string; detail: string }

/** One visual landscape inventory unit under the landform, with the share of the landform's ground in it. */
export type ScopeUnit = { id: string; label: string; sharePercent: number; adopted: boolean }

/** What a mask does to each figure, as the run's ledger treats its kind (`analysis.ts`, `maskAt`). */
export type MaskEffect = { planimetric: 'out' | 'in'; perspective: 'out' | 'in'; alteration: 'none' }

export type ScopeMask = {
  id: string
  name: string
  kind: AssessmentMaskKind
  /** The page's wording for the kind (`MASK_LABELS`); the stored kind never changes. */
  kindLabel: string
  areaHa: number
  /** Its part inside the landform, hectares; null without a landform. */
  insideLandformHa: number | null
  provenance: ScopeProvenance
  effect: MaskEffect
}

export type ScopeBlock = {
  id: string
  name: string
  grossHa: number
  /** Gross less every applicable mask over it, clipped (masks that overlap are taken once). */
  netHa: number
  /** The masks over it and each one's hectares inside the block (overlapping masks may add to more than gross − net). */
  deductions: Array<{ id: string; name: string; kindLabel: string; ha: number }>
  harvestSystem: NonNullable<TargetPolygon['harvestSystem']>
  /** How the block counts, in words: cleared ground, retention kept whole, or a partial cut's Table 6 equivalent. */
  treatment: string
  /** The ground the block clears in the run's ledger, hectares: its net footprint, or 0 for a partial cut. */
  clearedHa: number
  /** The run's own figure for the block's map area inside the landform (sampled, gross of masks); null without one. */
  insideLandformHa: number | null
  provenance: ScopeProvenance
}

export type ScopeDenominator = {
  /** The rule in words. */
  rule: string
  /** What leaves it, one entry each. */
  excluded: string[]
  /** The run's own figure, hectares (planimetric only); null when the run has none or there is no run. */
  areaHa: number | null
  /** Where the figure stands: from the run, not run yet, or the run did not verify the green area. */
  note: string | null
}

export type AssessmentScope = {
  landform: {
    id: string
    name: string
    grossHa: number
    provenance: ScopeProvenance
    /** The inventory unit the landform was adopted from, when it was. */
    adoptedUnitId: string | null
    /** Inventory units under the landform, largest share first; null when the inventory was not read. */
    units: ScopeUnit[] | null
    /** What the geometry suggests the landform is against the inventory; never written to the record. */
    suggestedExtent: ReviewedExtent | null
    /** The reviewer's own statement and note (`LandformRecord`); null when not given. */
    reviewedAs: ReviewedExtent | null
    note: string | null
  } | null
  blocks: ScopeBlock[]
  masks: ScopeMask[]
  /** Masks kept in the scene for another landform: out of this scope. */
  otherLandformMasks: number
  privateLandOut: boolean
  denominators: { planimetric: ScopeDenominator; perspective: ScopeDenominator }
  /** One line naming the scope, printed beside every figure that uses it. */
  statement: string
  /** Whether the run read here is a run against this landform; false when no run or another landform's. */
  fromRun: boolean
}

export type ScopeInput = {
  /** The scene's targets, with their sources. */
  targets: readonly TargetPolygon[]
  masks?: readonly AssessmentMask[]
  /** The scene's settings; the run's are read in their place when the run is this landform's. */
  settings: AnalysisSettings
  /** The landform assessed (the run's: `findSceneLandform`), or a view's own. */
  landformId: string | null
  review?: Pick<ViaReview, 'landformRecords'> | null
  /** The current run; read only when it was made against `landformId`. */
  result?: Pick<
    AnalysisResult,
    'settings' | 'landformForestedAreaMeters' | 'landformAreaMeters' | 'quality' | 'targets' | 'activeLandformId'
  > | null
  /** The visual landscape inventory as read live, when it has been. */
  inventoryUnits?: readonly BadgeUnit[]
}

const TERRAIN_CANDIDATE = /^(Ridge layer|Visible face|Face turned|Face in front|Terrain landform)/i
const FILE_NAME = /\.(kml|kmz|geojson|json|zip|shp|gpkg|gml|csv|gpx|dxf)$/i

/** Where a target's or mask's shape came from, read from what the scene recorded when it was added. */
export function scopeProvenance(item: { source?: string | null; inventoryUnitId?: string | null }): ScopeProvenance {
  const source = (item.source ?? '').trim()
  const of = (origin: ScopeOrigin, detail = source): ScopeProvenance => ({
    origin,
    label: SCOPE_ORIGIN_LABELS[origin],
    detail,
  })
  if (item.inventoryUnitId) return of('inventory', source || 'BC visual landscape inventory')
  if (/^Sample scenario|^Illustrative/i.test(source)) return of('sample')
  if (/ParcelMap BC|RESULTS forest cover|visual landscape inventory|DataBC/i.test(source)) return of('inventory')
  if (TERRAIN_CANDIDATE.test(source) || /^Visible face|^Face /i.test(source)) return of('candidate')
  if (/^Drawn/i.test(source)) return of('drawn')
  if (FILE_NAME.test(source)) return of('imported')
  return of('recorded', source || 'Not recorded')
}

/** What a mask kind does to each figure, as the run's ledger treats it. */
export function maskEffect(kind: AssessmentMaskKind, privateLandOut: boolean): MaskEffect {
  const out = kind === 'natural' || (kind === 'private' && privateLandOut)
  return { planimetric: out ? 'out' : 'in', perspective: out ? 'out' : 'in', alteration: 'none' }
}

const feature = (geometry: PolygonGeometry): GeoJSON.Feature<PolygonGeometry> => ({
  type: 'Feature',
  properties: {},
  geometry,
})
const overlaps = (a: PolygonGeometry, b: PolygonGeometry) => {
  const x = polygonBounds(a),
    y = polygonBounds(b)
  return !(x[2] <= y[0] || x[0] >= y[2] || x[3] <= y[1] || x[1] >= y[3])
}
const hectares = (geometry: PolygonGeometry | null | undefined) => (geometry ? polygonAreaMeters(geometry) / 10_000 : 0)
function overlapHa(a: PolygonGeometry, b: PolygonGeometry): number {
  if (!overlaps(a, b)) return 0
  try {
    return hectares(intersect(feature(a), feature(b))?.geometry as PolygonGeometry | undefined)
  } catch {
    return 0
  }
}
/** `geometry` less every mask over it, hectares: the masks taken once however they overlap. */
function netHa(geometry: PolygonGeometry, masks: readonly AssessmentMask[]): number {
  let current: GeoJSON.Feature<PolygonGeometry> | null = feature(geometry)
  for (const mask of masks) {
    if (!current) break
    if (!overlaps(current.geometry, mask.geometry)) continue
    try {
      current = difference(current, feature(mask.geometry)) as GeoJSON.Feature<PolygonGeometry> | null
    } catch {
      // A degenerate clip keeps the block as it was rather than dropping it.
    }
  }
  return current ? Math.min(hectares(geometry), hectares(current.geometry)) : 0
}

/** Grid points inside a polygon, about `count` of them. */
function gridInside(geometry: PolygonGeometry, count = 900): Array<[number, number]> {
  const [w, s, e, n] = polygonBounds(geometry)
  const side = Math.max(2, Math.ceil(Math.sqrt(count * 2)))
  const inside = preparePolygons([geometry]).contains
  const out: Array<[number, number]> = []
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const lng = w + ((i + 0.5) / side) * (e - w)
      const lat = s + ((j + 0.5) / side) * (n - s)
      if (inside(lng, lat)) out.push([lng, lat])
    }
  return out
}

/** Units under the landform, by the share of its ground in each (grid samples), largest first. Shares under 1% drop. */
function unitsUnder(landform: TargetPolygon, units: readonly BadgeUnit[]): ScopeUnit[] {
  const points = gridInside(landform.geometry)
  if (!points.length || !units.length) return []
  const prepared = preparePolygons(units.map((unit) => unit.geometry))
  const counts = new Map<number, number>()
  for (const [lng, lat] of points) {
    const index = prepared.indexAt(lng, lat)
    if (index >= 0) counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  return [...counts]
    .map(([index, count]) => ({
      id: units[index].id,
      label: unitValues(units[index]).vsu,
      sharePercent: (100 * count) / points.length,
      adopted: units[index].id === landform.inventoryUnitId,
    }))
    .filter((unit) => unit.sharePercent >= 1 || unit.adopted)
    .sort((a, b) => b.sharePercent - a.sharePercent)
}

/** What the geometry suggests the landform is against the inventory: only ever offered, never recorded. */
function suggestExtent(provenance: ScopeProvenance, units: ScopeUnit[] | null): ReviewedExtent | null {
  if (units) {
    const real = units.filter((unit) => unit.sharePercent >= 5)
    if (real.length >= 2) return 'several-units'
    if (provenance.origin === 'inventory' && real.length === 1) return 'whole-unit'
    if (real.length === 1) return 'part-of-unit'
    if (!real.length) return 'not-from-inventory'
  }
  return provenance.origin === 'inventory' ? 'whole-unit' : null
}

const SYSTEM_TREATMENT = {
  clearcut: () => 'Clearcut: its net footprint is cleared ground',
  retention: (block: TargetPolygon) =>
    `Dispersed retention${block.retentionPercent != null ? ` (${block.retentionPercent}%)` : ''}: its geometry is kept whole and Table 5 adjusts the rating`,
  partial: (block: TargetPolygon) =>
    `Partial cut${block.volumeRemovedPercent != null ? ` (${block.volumeRemovedPercent}% of volume removed)` : ''}: not cleared ground; its Table 6 equivalent is added to X only where the run sees it`,
} as const

const fixed = (value: number) => value.toFixed(1)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The scope of the assessment against `landformId`, from the scene and the run. */
export function assessmentScope(input: ScopeInput): AssessmentScope {
  const landform = input.targets.find((target) => target.id === input.landformId && target.role === 'landscape') ?? null
  const result =
    input.result && landform && (input.result.activeLandformId ?? null) === landform.id ? input.result : null
  const settings = result?.settings ?? input.settings
  const privateLandOut = settings.privateLandOutOfDenominator === true
  const perspectiveRule = settings.perspectiveDenominator ?? 'non-vegetated-out'
  const all = input.masks ?? []
  const applying = masksForLandform([...all], landform?.id)
  const masks: ScopeMask[] = applying.map((mask) => ({
    id: mask.id,
    name: mask.name,
    kind: mask.kind,
    kindLabel: mask.kind === 'natural' && mask.mappedRock ? 'Mapped rock' : MASK_LABELS[mask.kind],
    areaHa: hectares(mask.geometry),
    insideLandformHa: landform ? overlapHa(landform.geometry, mask.geometry) : null,
    provenance: scopeProvenance(mask),
    effect: maskEffect(mask.kind, privateLandOut),
  }))

  const units = landform && input.inventoryUnits ? unitsUnder(landform, input.inventoryUnits) : null
  const landformProvenance = landform ? scopeProvenance(landform) : null
  const record = landform ? input.review?.landformRecords?.[landform.name] : undefined

  const blocks: ScopeBlock[] = input.targets
    .filter((target) => target.role === 'block')
    .map((block) => {
      const over = applying.filter((mask) => overlaps(block.geometry, mask.geometry))
      const deductions = over
        .map((mask) => ({
          id: mask.id,
          name: mask.name,
          kindLabel: MASK_LABELS[mask.kind],
          ha: overlapHa(block.geometry, mask.geometry),
        }))
        .filter((entry) => entry.ha > 0)
      const system = block.harvestSystem ?? 'clearcut'
      const net = deductions.length ? netHa(block.geometry, over) : hectares(block.geometry)
      const inRun = result?.targets.find((target) => target.targetId === block.id)
      return {
        id: block.id,
        name: block.name,
        grossHa: hectares(block.geometry),
        netHa: net,
        deductions,
        harvestSystem: system,
        treatment: SYSTEM_TREATMENT[system](block),
        clearedHa: system === 'partial' ? 0 : net,
        insideLandformHa:
          inRun && inRun.areaInsideLandformMeters !== null ? inRun.areaInsideLandformMeters / 10_000 : null,
        provenance: scopeProvenance(block),
      }
    })

  const natural = masks.filter((mask) => mask.kind === 'natural')
  const privateMasks = masks.filter((mask) => mask.kind === 'private')
  const commonOut = [
    ...(natural.length
      ? [`${plural(natural.length, 'natural non-green mask')} (${natural.map((m) => m.name).join(', ')})`]
      : []),
    ...(privateLandOut && privateMasks.length ? [`${plural(privateMasks.length, 'private land mask')}`] : []),
  ]
  const greenBasis = result?.quality?.greenBasis ?? null
  const planimetric: ScopeDenominator = {
    rule:
      greenBasis === 'confirmed-landform'
        ? 'The whole landform, confirmed green by the reviewer'
        : 'The landform’s treed area (VRI rank-1, BCLCS level 2 T)',
    excluded: [
      ...(greenBasis === 'confirmed-landform' ? [] : ['VRI non-treed ground (water, rock, shrub, herb, clearing)']),
      ...commonOut,
    ],
    areaHa: result?.landformForestedAreaMeters != null ? result.landformForestedAreaMeters / 10_000 : null,
    note: !landform
      ? 'No landform'
      : !result
        ? 'Read from the run once it is run against this landform'
        : result.landformForestedAreaMeters == null
          ? 'Green area not verified: the run divides by the whole landform and the figure is provisional'
          : null,
  }
  const perspective: ScopeDenominator = {
    rule:
      perspectiveRule === 'non-treed-out'
        ? 'The landform’s visible apparent area, treed ground only'
        : 'The landform’s visible apparent area, net of non-vegetated ground',
    excluded: [
      perspectiveRule === 'non-treed-out'
        ? 'VRI non-treed ground (water, rock, shrub, herb, clearing)'
        : 'VRI non-vegetated ground (rock, water, ice)',
      ...commonOut,
    ],
    areaHa: null,
    note: 'Measured as apparent size from the station, not as an area',
  }

  const scopeLandform: AssessmentScope['landform'] = landform
    ? {
        id: landform.id,
        name: landform.name,
        grossHa: hectares(landform.geometry),
        provenance: landformProvenance!,
        adoptedUnitId: landform.inventoryUnitId ?? null,
        units,
        suggestedExtent: suggestExtent(landformProvenance!, units),
        reviewedAs: record?.reviewedAs ?? null,
        note: record?.scopeNote?.trim() || null,
      }
    : null

  return {
    landform: scopeLandform,
    blocks,
    masks,
    otherLandformMasks: all.length - applying.length,
    privateLandOut,
    denominators: { planimetric, perspective },
    statement: scopeStatement(scopeLandform, blocks, masks, privateLandOut, planimetric, perspectiveRule),
    fromRun: !!result,
  }
}

/** The units line: "VLI 337 (62%) and 350 (38%)", or null when the inventory was not read or holds none. */
export function unitsText(units: readonly ScopeUnit[] | null): string | null {
  if (!units?.length) return null
  const each = units.map((unit) =>
    units.length > 1 ? `${unit.label} (${Math.round(unit.sharePercent)}%)` : unit.label,
  )
  return `VLI ${each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}` : each[0]}`
}

/** The blocks line: "1 block, 24.0 ha gross, 21.3 ha net of 1 mask". */
export function blocksText(blocks: readonly ScopeBlock[]): string {
  if (!blocks.length) return 'no blocks'
  const gross = blocks.reduce((sum, block) => sum + block.grossHa, 0)
  const net = blocks.reduce((sum, block) => sum + block.netHa, 0)
  const deducted = new Set(blocks.flatMap((block) => block.deductions.map((entry) => entry.id))).size
  const partial = blocks.filter((block) => block.harvestSystem === 'partial').length
  return [
    `${plural(blocks.length, 'block')}, ${fixed(gross)} ha gross`,
    deducted ? `${fixed(net)} ha net of ${plural(deducted, 'mask')}` : 'no masks over them (net = gross)',
    ...(partial ? [`${plural(partial, 'partial cut')} counted by Table 6, not as cleared ground`] : []),
  ].join(', ')
}

function scopeStatement(
  landform: AssessmentScope['landform'],
  blocks: readonly ScopeBlock[],
  masks: readonly ScopeMask[],
  privateLandOut: boolean,
  planimetric: ScopeDenominator,
  perspectiveRule: NonNullable<AnalysisSettings['perspectiveDenominator']>,
): string {
  if (!landform) return `No landform assessed; ${blocksText(blocks)}`
  const from = [
    landform.provenance.origin === 'inventory'
      ? 'from the inventory'
      : landform.provenance.origin === 'candidate'
        ? 'an adopted terrain candidate'
        : landform.provenance.origin === 'drawn'
          ? 'drawn'
          : landform.provenance.origin === 'imported'
            ? 'imported'
            : landform.provenance.origin === 'sample'
              ? 'sample scenario'
              : 'as recorded',
    unitsText(landform.units),
    landform.reviewedAs ? `reviewed as ${REVIEWED_EXTENTS[landform.reviewedAs].toLowerCase()}` : null,
  ].filter(Boolean)
  const hasPrivate = masks.some((mask) => mask.kind === 'private')
  return [
    `${landform.name} (${fixed(landform.grossHa)} ha; ${from.join('; ')})`,
    blocksText(blocks),
    `planimetric over ${
      planimetric.areaHa !== null ? `${fixed(planimetric.areaHa)} ha treed` : planimetric.rule.toLowerCase()
    }`,
    `perspective net of ${perspectiveRule === 'non-treed-out' ? 'non-treed' : 'non-vegetated'} ground`,
    ...(hasPrivate ? [`private land ${privateLandOut ? 'out of' : 'in'} the denominators`] : []),
  ].join(' · ')
}

/** The scope as label, value and provenance rows, for the step 1 panel and the report part. */
export type ScopeRow = { label: string; value: string | null; source: 'run' | 'reviewer' | 'scene' }

export function scopeRows(scope: AssessmentScope): ScopeRow[] {
  const rows: ScopeRow[] = []
  const { landform } = scope
  if (landform) {
    rows.push({
      label: 'Landform assessed',
      value: `${landform.name}, ${fixed(landform.grossHa)} ha (${landform.provenance.label.toLowerCase()}${
        landform.provenance.detail ? `: ${landform.provenance.detail}` : ''
      })`,
      source: 'scene',
    })
    rows.push({
      label: 'Inventory units under it',
      value:
        landform.units === null
          ? 'Inventory not read'
          : landform.units.length
            ? landform.units
                .map(
                  (unit) => `${unit.label} (${Math.round(unit.sharePercent)}%${unit.adopted ? ', adopted from' : ''})`,
                )
                .join(', ')
            : 'None: the landform lies outside the inventory',
      source: 'run',
    })
    rows.push({
      label: 'Reviewed as',
      value: landform.reviewedAs ? REVIEWED_EXTENTS[landform.reviewedAs] : null,
      source: 'reviewer',
    })
    if (landform.note) rows.push({ label: 'Scope note', value: landform.note, source: 'reviewer' })
  } else rows.push({ label: 'Landform assessed', value: null, source: 'scene' })
  for (const block of scope.blocks)
    rows.push({
      label: `Block ${block.name}`,
      value: `${fixed(block.grossHa)} ha gross, ${fixed(block.netHa)} ha net${
        block.deductions.length
          ? ` (less ${block.deductions.map((entry) => `${entry.name}, ${fixed(entry.ha)} ha`).join('; ')})`
          : ''
      }; ${block.treatment.charAt(0).toLowerCase()}${block.treatment.slice(1)} (${block.provenance.label.toLowerCase()})`,
      source: 'scene',
    })
  const byKind = new Map<string, ScopeMask[]>()
  for (const mask of scope.masks) byKind.set(mask.kindLabel, [...(byKind.get(mask.kindLabel) ?? []), mask])
  for (const [kindLabel, list] of byKind) {
    const effect = list[0].effect
    const origins = [...new Set(list.map((mask) => mask.provenance.label.toLowerCase()))].join(', ')
    rows.push({
      label: kindLabel,
      value: `${plural(list.length, 'mask')}, ${fixed(list.reduce((sum, mask) => sum + mask.areaHa, 0))} ha (${origins}): ${
        effect.planimetric === 'out' ? 'out of both denominators' : 'kept in both denominators'
      }, no alteration counted`,
      source: 'scene',
    })
  }
  if (scope.otherLandformMasks)
    rows.push({
      label: 'Masks for other landforms',
      value: `${plural(scope.otherLandformMasks, 'mask')} traced on another landform, out of this scope`,
      source: 'scene',
    })
  const denominator = (label: string, d: ScopeDenominator) =>
    rows.push({
      label,
      value: [
        d.areaHa !== null ? `${d.rule}, ${fixed(d.areaHa)} ha` : d.rule,
        d.excluded.length ? `less ${d.excluded.join('; ')}` : null,
        d.note,
      ]
        .filter(Boolean)
        .join('; '),
      source: 'run',
    })
  denominator('Planimetric denominator', scope.denominators.planimetric)
  denominator('Perspective denominator', scope.denominators.perspective)
  return rows
}
