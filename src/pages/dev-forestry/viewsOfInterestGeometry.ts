/**
 * What the plan map draws for the views of interest (`viewsOfInterest.ts`): each view as a numbered point with a cone
 * of its lens's width along the way it faces, and the inventory arrows the views (and the finder's open row) use.
 *
 * Pure: no DOM or network access. The page's `ViewsOfInterestLayers` only draws these.
 */
import { viewerConeFeatures } from '@/lib/geo/viewerCone'
import { haversineMeters, type PolygonGeometry } from './visibility'
import { blockCentre, isIncluded, lensHfovDeg, viewBearing, type ViewOfInterest } from './viewsOfInterest'

/** A cone reaches a little past the block's centre, within these bounds, metres. */
export const VIEW_CONE_MIN_METERS = 400
export const VIEW_CONE_MAX_METERS = 8000
/** A view whose block is gone still shows which way it faces, this far. */
export const VIEW_CONE_DEFAULT_METERS = 2000
const VIEW_CONE_REACH = 1.15

/** One view as the plan shows it: its number in the list, where it stands and which way it faces. */
export type PlannedViewMark = {
  id: string
  /** 1-based, the row's number in the panel. */
  number: number
  name: string
  lng: number
  lat: number
  /** Null when the view faces a block that is no longer in the scene. */
  bearing: number | null
  open: boolean
  included: boolean
}

type Block = { id: string; geometry: PolygonGeometry }

/** How far a view's cone reaches: just past its block's centre, clamped. */
export function viewConeLengthMeters(view: ViewOfInterest, block: Block | null | undefined): number {
  const centre = block ? blockCentre(block.geometry) : null
  if (!centre) return VIEW_CONE_DEFAULT_METERS
  const reach = haversineMeters(view, centre) * VIEW_CONE_REACH
  return Math.min(VIEW_CONE_MAX_METERS, Math.max(VIEW_CONE_MIN_METERS, reach))
}

/**
 * The views' marks and cones. Each cone is `viewerConeFeatures`' wedge with the view's id, number and whether it is
 * the open view (`open` 1/0) and included in exports (`included` 1/0) as properties; the eye points are left out,
 * since the marks carry the number.
 */
export function viewsOfInterestPlan(
  views: readonly ViewOfInterest[],
  blocks: readonly Block[],
  openViewId: string | null,
): { marks: PlannedViewMark[]; cones: GeoJSON.FeatureCollection } {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const marks: PlannedViewMark[] = []
  const features: GeoJSON.Feature[] = []
  views.forEach((view, index) => {
    const block = byId.get(view.blockId) ?? null
    const bearing = viewBearing(view, block ? blockCentre(block.geometry) : null)
    const open = view.id === openViewId
    const included = isIncluded(view)
    marks.push({
      id: view.id,
      number: index + 1,
      name: view.name,
      lng: view.lng,
      lat: view.lat,
      bearing,
      open,
      included,
    })
    if (bearing === null) return
    const cone = viewerConeFeatures(
      { lng: view.lng, lat: view.lat, bearing, fovDegrees: lensHfovDeg(view.focalMm) },
      viewConeLengthMeters(view, block),
    ).features.find((feature) => feature.properties?.kind === 'cone')
    if (!cone) return
    features.push({
      ...cone,
      id: view.id,
      properties: { id: view.id, number: index + 1, open: open ? 1 : 0, included: included ? 1 : 0 },
    })
  })
  return { marks, cones: { type: 'FeatureCollection', features } }
}

/**
 * The inventory arrows a view faces along, and those the finder's open row would add (`previewArrowIds`), from the
 * plan's arrow collection (features carrying `arrowId`). Each keeps its geometry and gains `preview` (1 when only the
 * finder's row picks it) and `open` (1 when the open view faces it). Nothing chosen gives an empty collection.
 */
export function chosenArrowCollection(
  arrows: GeoJSON.FeatureCollection,
  views: readonly ViewOfInterest[],
  previewArrowIds: readonly string[],
  openViewId: string | null,
): GeoJSON.FeatureCollection {
  const planned = new Set<string>()
  let openArrow: string | null = null
  for (const view of views) {
    if (view.facing.kind !== 'bearing' || !view.facing.arrowId) continue
    planned.add(view.facing.arrowId)
    if (view.id === openViewId) openArrow = view.facing.arrowId
  }
  const preview = new Set(previewArrowIds)
  if (!planned.size && !preview.size) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: arrows.features
      .filter((feature) => {
        const id = String(feature.properties?.arrowId ?? '')
        return planned.has(id) || preview.has(id)
      })
      .map((feature) => {
        const id = String(feature.properties?.arrowId)
        return {
          ...feature,
          properties: {
            ...feature.properties,
            preview: planned.has(id) ? 0 : 1,
            open: id === openArrow ? 1 : 0,
          },
        }
      }),
  }
}
