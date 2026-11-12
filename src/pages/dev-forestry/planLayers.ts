import type { AssessmentMaskKind } from './types'
import type { EvqoCode } from './visualsNarrative'
import type { VisualQualityClassId } from './vqo'

/**
 * What the plan map draws. The basemap and the reference overlays are chosen
 * from the map's Layers button; everything else the page draws has a legend
 * row, and clicking the row hides it (`hidden`). The road view keeps its own
 * set in the sidebar.
 *
 * Kept free of DOM access: the legend, the layers and the tests share it.
 */
export type PlanBasemap = 'map' | 'satellite'

/** One legend row's switch. Grouped rows (`mask:`, `unit:`, …) filter one layer's features. */
export type PlanLegendKey =
  | 'block'
  | 'landform'
  | 'opening'
  | `mask:${AssessmentMaskKind}`
  | 'road'
  | 'tree-free'
  | 'samples:visible'
  | 'samples:hidden'
  | 'samples:unknown'
  | 'viewpoint'
  | 'exposure'
  | 'candidate:ridge-layer'
  | 'candidate:facing'
  | 'other-ridge-layers'
  | `clue:${LandformCluePosition}`
  | `unit:${VisualQualityClassId | 'none'}`
  | 'vli-viewpoint'
  | 'arrow'
  | 'rec-site'
  | 'screening'
  | `evqo:${EvqoCode}`

export type LandformCluePosition = 'ridge' | 'hollow' | 'other'

export type PlanShow = {
  basemap: PlanBasemap
  hillshade: boolean
  /** The established VQO polygons, read from the inventory only once switched on. */
  evqo: boolean
  hidden: ReadonlySet<PlanLegendKey>
}

export const DEFAULT_PLAN_SHOW: PlanShow = { basemap: 'map', hillshade: true, evqo: false, hidden: new Set() }

export function togglePlanLegendKey(show: PlanShow, key: PlanLegendKey): PlanShow {
  const hidden = new Set(show.hidden)
  if (hidden.has(key)) hidden.delete(key)
  else hidden.add(key)
  return { ...show, hidden }
}

type Collection = GeoJSON.FeatureCollection

/**
 * The collection without the features whose legend row is hidden. `keyOf`
 * names a feature's row; a collection with nothing hidden comes back as the
 * same object, so a layer only re-uploads its data when a row changes.
 */
export function withoutHiddenFeatures(
  collection: Collection,
  hidden: ReadonlySet<PlanLegendKey>,
  keyOf: (properties: Record<string, unknown>) => PlanLegendKey,
): Collection {
  if (!hidden.size || !collection.features.length) return collection
  const features = collection.features.filter((feature) => !hidden.has(keyOf(feature.properties ?? {})))
  return features.length === collection.features.length ? collection : { ...collection, features }
}

/** Sample points: `visible` is 1 seen, 0 hidden or out of range, 2 unknown. */
export function sampleLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  const visible = Number(properties.visible)
  return visible === 2 ? 'samples:unknown' : visible === 1 ? 'samples:visible' : 'samples:hidden'
}

export function maskLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  const kind = properties.kind
  return kind === 'natural' || kind === 'private' || kind === 'permanent' ? `mask:${kind}` : 'mask:retained'
}

export function clueLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  const position = properties.position
  return position === 'ridge' || position === 'hollow' ? `clue:${position}` : 'clue:other'
}

export function candidateLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  return properties.method === 'facing' ? 'candidate:facing' : 'candidate:ridge-layer'
}

/** Sensitivity units carry `objectiveId`, empty when nothing is established. */
export function unitLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  const objective = properties.objectiveId
  return typeof objective === 'string' && objective ? (`unit:${objective}` as PlanLegendKey) : 'unit:none'
}

export function inventoryPointLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  return properties.kind === 'rec-site' ? 'rec-site' : 'vli-viewpoint'
}

export function evqoLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  return `evqo:${String(properties.code)}` as PlanLegendKey
}
