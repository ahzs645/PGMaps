import type { ImageryBasemap } from '@/components/ui/map-satellite-imagery'

import type { PhotoPlanSymbolId } from './photoPlanStyle'
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
/** The shared Map / Satellite choice (`map-satellite-imagery.tsx`); a type import only, so this file stays DOM-free. */
export type PlanBasemap = ImageryBasemap

/** One legend row's switch. Grouped rows (`mask:`, `unit:`, …) filter one layer's features. */
export type PlanLegendKey =
  | 'block'
  | 'landform'
  | 'opening'
  | `mask:${AssessmentMaskKind}`
  | 'road'
  | 'tree-free'
  | 'stand:kept'
  | 'stand:removed'
  | 'stand:protected'
  | 'stand:strip'
  | 'samples:visible'
  | 'samples:hidden'
  | 'samples:unknown'
  | 'viewpoint'
  | 'exposure'
  | 'candidate:ridge-layer'
  | 'candidate:facing'
  | 'candidate:visible-face'
  /** ParcelMap BC's private parcels found round the landform and not yet added (`usePrivateParcels`). */
  | 'candidate:private'
  | 'other-ridge-layers'
  | `clue:${LandformCluePosition}`
  | `unit:${VisualQualityClassId | 'none'}`
  | 'vli-viewpoint'
  | 'arrow'
  | 'rec-site'
  | 'screening'
  | `evqo:${EvqoCode}`
  /** The planned views of interest: a numbered point and its lens's cone (`viewsOfInterestGeometry.ts`). */
  | 'view-of-interest'
  /** The inventory arrows the planned views face along, and those the finder's open row would add. */
  | 'view-arrow'
  | PhotoLegendKey

/**
 * An own photo on the plan (`PhotoDrapeLayer`, `PhotoCamerasLayer`): the photo laid on the ground, its frame's
 * footprint, the cameras with their cones, the flight track and the paired points. Never in the project file
 * (it rebuilds from the pose) and never on a report map (those are captured on their own hidden map).
 */
export type PhotoLegendKey = 'photo:drape' | 'photo:footprint' | 'photo:camera' | 'photo:track' | 'photo:pair'

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
  return properties.method === 'facing'
    ? 'candidate:facing'
    : properties.method === 'visible-face'
      ? 'candidate:visible-face'
      : 'candidate:ridge-layer'
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

/** A stand prescription's tree on the plan, by what its prescription does with it (`standTreeCollection`). */
export function standTreeLegendKey(properties: Record<string, unknown>): PlanLegendKey {
  return properties.status === 'removed'
    ? 'stand:removed'
    : properties.status === 'protected'
      ? 'stand:protected'
      : 'stand:kept'
}

/** What of an own photo the plan draws now, for its legend rows. */
export type PhotoLegendShown = {
  /** A drape is laid (any look but footprint only). */
  drape: boolean
  /** A footprint is outlined. */
  footprint: boolean
  /** Cameras drawn; the cones and points share one row. */
  cameras: number
  /** A flight track is drawn (two or more timed cameras of one flight). */
  track: boolean
  /** Paired or reference points are drawn. */
  pairs: boolean
}

export type PhotoLegendRow = {
  key: PhotoLegendKey
  label: string
  /** The `PHOTO_PLAN_SYMBOLS` entry its swatch draws. */
  symbol: PhotoPlanSymbolId
  /** A second line under the row. */
  note?: string
  /** The row carries the drape's opacity under it (the legend's rows are buttons and cannot hold a control). */
  opacity?: true
}

/**
 * The photo's legend rows, in the order the plan draws them. The drape's row says that its hatch is terrain
 * only, so it is never read as the run's visibility.
 */
export function photoLegendRows(shown: PhotoLegendShown): PhotoLegendRow[] {
  const rows: PhotoLegendRow[] = []
  if (shown.drape)
    rows.push({
      key: 'photo:drape',
      label: 'Photo laid on the ground',
      symbol: 'drape',
      note: "Hatched: hidden by terrain only, not the run's visibility",
      opacity: true,
    })
  if (shown.footprint) rows.push({ key: 'photo:footprint', label: "Photo's footprint", symbol: 'footprint' })
  if (shown.cameras > 0)
    rows.push({
      key: 'photo:camera',
      label: shown.cameras > 1 ? 'Photo cameras · their views' : 'Photo camera · its view',
      symbol: 'camera',
    })
  if (shown.track) rows.push({ key: 'photo:track', label: 'Flight track, in time order', symbol: 'track' })
  if (shown.pairs) rows.push({ key: 'photo:pair', label: 'Paired or reference point', symbol: 'pair' })
  return rows
}

/** A photo feature's legend row, by the `kind` the photo layers give it. */
export function photoLegendKey(properties: Record<string, unknown>): PhotoLegendKey {
  switch (properties.kind) {
    case 'cone':
    case 'eye':
      return 'photo:camera'
    case 'track':
      return 'photo:track'
    case 'pair':
    case 'residual':
    case 'reference':
      return 'photo:pair'
    case 'footprint':
      return 'photo:footprint'
    default:
      return 'photo:drape'
  }
}
