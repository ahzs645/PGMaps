/**
 * The class pass's layers: the scene's figure classes as flat-colour polygons, split at the
 * landform's edge so a block inside the landform and one outside it read as different classes.
 * `mapCapture.ts` draws them on the road view's own camera and reads the pixels back; the codes
 * then come from `decodeClassRaster`. Inside the landform the order bottom to top is landform,
 * rock, existing opening, proposed block, partial cut, private land: a block over an opening is a block, and
 * private land covers both, because the run counts no alteration under a private-land mask
 * (`maskAt`, `assessmentMasks.ts`) and the pixel figure must measure the same ground as the
 * sightline figure printed beside it. A partial-cut block is its own class (`partialIn`/`partialOut`): outlined as a
 * block, but not cleared ground, so the pixel figure leaves it out of Proposed as the run leaves it out of its
 * ledger (handbook 3.4.4). A scene with none paints exactly the layers it did before. No DOM or network access.
 */
import clipping, { type MultiPolygon } from 'polygon-clipping'
import { classColor, zoneColor, type FigureClass } from '@/lib/forestry/viaFigure/composeFigure'
import { VQO_ZONE_ROLES } from '@/lib/forestry/viaFigure/presets'
import { polygonAreaMeters, type PolygonGeometry } from './visibility'

export type ClassPassInput = {
  /** The landform being assessed; null makes every class an outside one. */
  landform: PolygonGeometry | null
  /** Proposed blocks cut clear (clearcut or dispersed retention): cleared ground. */
  blocks: readonly PolygonGeometry[]
  /** Proposed partial-cut blocks: drawn as blocks, counted apart (handbook 3.4.4). */
  partialCuts?: readonly PolygonGeometry[]
  /** Existing openings still counting (alteration weight above zero). */
  existing: readonly PolygonGeometry[]
  /** Private land: the scene's private-land assessment masks. */
  privateLand: readonly PolygonGeometry[]
  /** Rock / non-vegetated ground; only the part in the landform is a class. */
  rock: readonly PolygonGeometry[]
  /**
   * Retention inside the blocks (wildlife tree patches and group reserves, the `retained` masks): left standing, so
   * not proposed alteration. Cut out of the blocks, as the run treats them.
   */
  retained?: readonly PolygonGeometry[]
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
  const kept = netOfRetained(input.blocks, input.retained ?? [])
  const blocks = splitAtLandform(kept.blocks, input.landform)
  const keptPartial = netOfRetained(input.partialCuts ?? [], input.retained ?? [])
  const partial = splitAtLandform(keptPartial.blocks, input.landform)
  const layers = [
    layer('landform', input.landform ? asMulti(input.landform) : []),
    layer('rock', rock.inside),
    layer('existingOut', existing.outside),
    layer('existingIn', existing.inside),
    layer('proposedOut', blocks.outside),
    layer('proposedIn', blocks.inside),
    layer('partialOut', partial.outside),
    layer('partialIn', partial.inside),
    // Over the blocks and openings: the run counts no alteration under private land.
    layer('privateOut', privateLand.outside),
    layer('privateIn', privateLand.inside),
  ].filter((entry) => entry.data.features.length)
  return {
    layers,
    failed:
      kept.failed || keptPartial.failed || [rock, privateLand, existing, blocks, partial].some((split) => split.failed),
  }
}

/**
 * Most other landforms one saved view takes a class pass of (sub-landforms, or the whole landform beside an active
 * sub-landform): each is one more class pass per frame, at the frame's own camera.
 */
export const MAX_LANDFORM_PASSES = 6

/**
 * Less overlap than this between a block and a landform is where two outlines meet, not ground in it, square metres
 * (about one 10 m cell). Klein Lake 2's 5b, drawn beside 5a, took 14 m² of EGG13's 14.6 ha.
 */
export const MIN_BLOCK_GROUND_IN_LANDFORM_M2 = 100

/**
 * The blocks (by id) with ground in `landform`, for the row a landform's reading prints and the landform a block is
 * cited on: which blocks it holds is read off the plan, never a figure. An overlap under
 * `MIN_BLOCK_GROUND_IN_LANDFORM_M2` is an edge, not ground. A block whose clipping fails is kept.
 */
export function blocksInLandform(
  blocks: ReadonlyArray<{ id: string; geometry: PolygonGeometry }>,
  landform: PolygonGeometry,
): string[] {
  const land = asMulti(landform) as Geom
  return blocks
    .filter((block) => {
      try {
        const overlap = clipping.intersection(asMulti(block.geometry) as Geom, land)
        return (
          overlap.length > 0 &&
          polygonAreaMeters({ type: 'MultiPolygon', coordinates: overlap }) >= MIN_BLOCK_GROUND_IN_LANDFORM_M2
        )
      } catch {
        return true
      }
    })
    .map((block) => block.id)
}

/** Whether the pass paints a partial cut, so its decode needs the partial-cut colours (`classPaletteEntries`). */
export const paintsPartialCut = (layers: readonly ClassPassLayer[]) =>
  layers.some((layer) => layer.id === 'partialIn' || layer.id === 'partialOut')

/** The blocks less their retention; when clipping fails on a degenerate shape the blocks stay whole and `failed` says so. */
function netOfRetained(
  blocks: readonly PolygonGeometry[],
  retained: readonly PolygonGeometry[],
): { blocks: PolygonGeometry[]; failed: boolean } {
  if (!retained.length || !blocks.length) return { blocks: [...blocks], failed: false }
  try {
    const net = clipping.difference(blocks.flatMap(asMulti) as Geom, retained.flatMap(asMulti) as Geom)
    return {
      blocks: net.length ? [{ type: 'MultiPolygon', coordinates: net as GeoJSON.Position[][][] }] : [],
      failed: false,
    }
  } catch {
    return { blocks: [...blocks], failed: true }
  }
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
