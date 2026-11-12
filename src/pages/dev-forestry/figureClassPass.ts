/**
 * The class pass's layers: the scene's figure classes as flat-colour polygons, split at the
 * landform's edge so a block inside the landform and one outside it read as different classes.
 * `mapCapture.ts` draws them on the road view's own camera and reads the pixels back; the codes
 * then come from `decodeClassRaster`. Inside the landform the order bottom to top is landform,
 * rock, private land, existing opening, proposed block, so the class a pixel shows follows the
 * VIA precedence (a block on private land is a block). No DOM or network access.
 */
import clipping, { type MultiPolygon } from 'polygon-clipping'
import { classColor, zoneColor, type FigureClass } from '@/lib/forestry/viaFigure/composeFigure'
import { VQO_ZONE_ROLES } from '@/lib/forestry/viaFigure/presets'
import type { PolygonGeometry } from './visibility'

export type ClassPassInput = {
  /** The landform being assessed; null makes every class an outside one. */
  landform: PolygonGeometry | null
  blocks: readonly PolygonGeometry[]
  /** Existing openings still counting (alteration weight above zero). */
  existing: readonly PolygonGeometry[]
  /** Private land: the scene's private-land assessment masks. */
  privateLand: readonly PolygonGeometry[]
  /** Rock / non-vegetated ground; only the part in the landform is a class. */
  rock: readonly PolygonGeometry[]
}

export type ClassPassLayer = {
  /** A figure class, or a VQO zone (`zone-P` …) in the zone pass. */
  id: Exclude<FigureClass, 'sky' | 'terrain'> | `zone-${string}`
  color: string
  data: GeoJSON.FeatureCollection
}

/** Colour of all other terrain: the class pass's background layer. */
export const CLASS_PASS_BACKGROUND = classColor('terrain')

type Geom = Parameters<typeof clipping.intersection>[0]

const asMulti = (geometry: PolygonGeometry): MultiPolygon =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as MultiPolygon

const collection = (parts: MultiPolygon): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: parts.length
    ? [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiPolygon', coordinates: parts as GeoJSON.Position[][][] },
        },
      ]
    : [],
})

/**
 * The parts of `geometries` inside and outside `landform`. When polygon clipping fails on a
 * degenerate shape, the whole shape counts as inside, and `failed` says so.
 */
export function splitAtLandform(
  geometries: readonly PolygonGeometry[],
  landform: PolygonGeometry | null,
): { inside: MultiPolygon; outside: MultiPolygon; failed: boolean } {
  const all = geometries.flatMap(asMulti)
  if (!all.length) return { inside: [], outside: [], failed: false }
  if (!landform) return { inside: [], outside: all, failed: false }
  const land = asMulti(landform) as Geom
  try {
    return {
      inside: clipping.intersection(all as Geom, land),
      outside: clipping.difference(all as Geom, land),
      failed: false,
    }
  } catch {
    return { inside: all, outside: [], failed: true }
  }
}

/** The class pass's layers, bottom first, and whether any split had to fall back. */
export function classPassLayers(input: ClassPassInput): { layers: ClassPassLayer[]; failed: boolean } {
  const layer = (id: Exclude<FigureClass, 'sky' | 'terrain'>, parts: MultiPolygon): ClassPassLayer => ({
    id,
    color: classColor(id),
    data: collection(parts),
  })
  const rock = splitAtLandform(input.rock, input.landform)
  const privateLand = splitAtLandform(input.privateLand, input.landform)
  const existing = splitAtLandform(input.existing, input.landform)
  const blocks = splitAtLandform(input.blocks, input.landform)
  const layers = [
    layer('landform', input.landform ? asMulti(input.landform) : []),
    layer('rock', rock.inside),
    layer('privateOut', privateLand.outside),
    layer('privateIn', privateLand.inside),
    layer('existingOut', existing.outside),
    layer('existingIn', existing.inside),
    layer('proposedOut', blocks.outside),
    layer('proposedIn', blocks.inside),
  ].filter((entry) => entry.data.features.length)
  return { layers, failed: [rock, privateLand, existing, blocks].some((split) => split.failed) }
}

/**
 * The zone pass's layers: the established VQO polygons (features with a `code` of P, R, PR, M or
 * MM) each in its zone colour, so the figure can tint the objectives the view shows. The pass's
 * background is the same flat terrain colour as the class pass's.
 */
export function zonePassLayers(evqo: GeoJSON.FeatureCollection): ClassPassLayer[] {
  return VQO_ZONE_ROLES.flatMap(([, code], i) => {
    const features = evqo.features.filter((feature) => feature.properties?.code === code)
    return features.length
      ? [{ id: `zone-${code}` as const, color: zoneColor(i + 1), data: { type: 'FeatureCollection', features } }]
      : []
  })
}
