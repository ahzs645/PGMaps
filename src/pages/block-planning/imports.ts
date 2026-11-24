/**
 * GeoJSON files as blocks or as baseline disturbances. Nothing is classified by its geometry: the
 * planner says which kind of file it is by the command they use. A year the file does not give is
 * assumed and marked as assumed (`editor-default`), never invented quietly.
 *
 * DOM- and network-free.
 */
import { object } from '@/lib/jsonGuards'
import { addBlock, addDisturbance, setEntry } from './edits'
import type { Position } from 'geojson'
import { disturbanceKinds, parseShape, YEAR_RANGE, type DisturbanceKind, type Plan, type Shape } from './plan'

function featuresOf(data: unknown) {
  const root = object(data, 'file')
  if (root.format) throw Error('This is a saved plan. Use Open a plan instead.')
  const features =
    root.type === 'Feature'
      ? [root]
      : root.type === 'FeatureCollection' && Array.isArray(root.features)
        ? root.features
        : null
  if (!features?.length) throw Error('The file has no GeoJSON features.')
  return features.map((f, i) => {
    const feature = object(f, `feature ${i + 1}`)
    const properties = (
      feature.properties && typeof feature.properties === 'object' ? feature.properties : {}
    ) as Record<string, unknown>
    return { feature, properties, label: `feature ${i + 1}` }
  })
}

const nameOf = (properties: Record<string, unknown>, fallback: string) => {
  for (const key of ['name', 'NAME', 'id', 'ID', 'block', 'BLOCK_ID', 'OPENING_ID']) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return fallback
}

const yearOf = (properties: Record<string, unknown>) => {
  for (const key of ['year', 'YEAR', 'harvestYear', 'HARVEST_YEAR', 'DISTURBANCE_YEAR']) {
    const value = Number(properties[key])
    if (Number.isInteger(value) && value >= YEAR_RANGE[0] && value <= YEAR_RANGE[1]) return value
  }
  return null
}

/**
 * Adds each polygon as a block. A feature's `year` puts the block in the schedule under review at
 * that year; without one it starts at the first projection year, as a drawn block does.
 */
export function importBlocks(plan: Plan, data: unknown, fileName: string) {
  let next = plan
  const added: string[] = []
  for (const { feature, properties, label } of featuresOf(data)) {
    const geometry = parseShape(feature.geometry, `${fileName} ${label}`)
    const made = addBlock(next, nameOf(properties, `${fileName} #${added.length + 1}`), geometry)
    next = { ...made.plan, blocks: made.plan.blocks.map((b) => (b.id === made.id ? { ...b, source: fileName } : b)) }
    const year = yearOf(properties)
    if (year !== null) next = setEntry(next, next.reviewSchedule, made.id, { year })
    added.push(made.id)
  }
  return { plan: next, added }
}

/** Adds each polygon to the baseline. `assumedYear` stands in where the file gives no year. */
export function importBaseline(plan: Plan, data: unknown, fileName: string, assumedYear: number) {
  let next = plan
  let assumed = 0
  const features = featuresOf(data)
  for (const { feature, properties, label } of features) {
    const year = yearOf(properties)
    if (year === null) assumed++
    const rawKind = String(properties.kind ?? properties.KIND ?? '').toLowerCase()
    const kind: DisturbanceKind = (disturbanceKinds as readonly string[]).includes(rawKind)
      ? (rawKind as DisturbanceKind)
      : 'unspecified'
    next = addDisturbance(next, {
      name: nameOf(properties, `${fileName} #${next.baseline.length + 1}`),
      kind,
      year: year ?? assumedYear,
      yearBasis: year === null ? 'editor-default' : 'source-attribute',
      source: fileName,
      geometry: parseShape(feature.geometry, `${fileName} ${label}`),
    }).plan
  }
  return { plan: next, added: features.length, assumed }
}

/**
 * A reporting unit's boundary from a GeoJSON file: every polygon in it, as one shape. Lines and
 * points are refused rather than skipped, because a boundary that lost a part would clip wrongly.
 */
export function importUnit(data: unknown, fileName: string): { source: string; geometry: Shape } {
  const polygons: Position[][][] = []
  for (const { feature, label } of featuresOf(data)) {
    const shape = parseShape(feature.geometry, `${fileName} ${label}`)
    if (shape.type === 'Polygon') polygons.push(shape.coordinates)
    else polygons.push(...shape.coordinates)
  }
  const geometry: Shape =
    polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons }
  return { source: fileName, geometry }
}

/**
 * Spatial retention or recruitment areas that section D.1 counts whole toward Objectives A and B.
 * Each feature keeps its name and its approval reference (`reference`, `REFERENCE` or `approval`);
 * one without a reference is still read, and the panel shows it as unreferenced.
 */
export function importRetentionAreas(
  existing: { id: string }[],
  data: unknown,
  fileName: string,
): { id: string; name: string; reference: string; geometry: Shape }[] {
  const taken = new Set(existing.map((r) => r.id))
  return featuresOf(data).map(({ feature, properties, label }, i) => {
    let n = existing.length + i + 1
    while (taken.has(`retention-${n}`)) n++
    const id = `retention-${n}`
    taken.add(id)
    const reference = ['reference', 'REFERENCE', 'approval', 'APPROVAL']
      .map((k) => properties[k])
      .find((v): v is string => typeof v === 'string' && v.trim() !== '')
    return {
      id,
      name: nameOf(properties, `${fileName} ${label}`),
      reference: reference?.trim() ?? '',
      geometry: parseShape(feature.geometry, `${fileName} ${label}`),
    }
  })
}
