/**
 * The layers an own photo cannot read for itself (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.3):
 * the visual landscape inventory (sensitivity units, established VQOs), VRI stands and rock, the terrain candidates
 * (sub-landform dividers, lines of force) and the inventory's viewpoints. The page holds most of them for the scene;
 * this file turns what it holds into photo features and decides, layer by layer, what the photo draws.
 *
 * The inventory and VRI are read for the scene's ground. A photo from the air sees far past it, so where the page's
 * read does not take in the ground the camera sees (`photoSeenBounds`), the photo reads its own for that ground, and
 * only once such a layer is switched on (`photoInventoryWanted`). It is never a fallback: a page read that failed for
 * ground the photo sees reads *Not read* with its reason, and so does a photo's own read that failed. A layer is never
 * an empty list that reads as *None* when nothing was read.
 *
 * Free of DOM and network access.
 */
import type { BcSensitivityUnit } from './bcVisualInventory'
import type { VriStand } from './bcVegetationInventory'
import type { CanopyStand } from './canopy'
import type { Box } from './photoFeatures'
import type { PhotoLayerId } from './photoLayers'
import type { PhotoFeature } from './photoOverlay'
import type { VliViewpoint } from './viewpointInventory'
import { EVQO_CODE_FOR_CLASS } from './visualsNarrative'

/** What the page holds for one layer: its features, or why it has none, and the ground its read was for. */
export type PhotoPageLayer =
  | {
      status: 'ready'
      features: readonly PhotoFeature[]
      /** The box the read was for; null for a layer not read by box (candidates, viewpoints round a block). */
      covers: Box | null
      /** Said beside the layer's row, e.g. what part of the ground it was drawn for. */
      note?: string | null
    }
  | { status: 'loading'; covers: Box | null }
  | { status: 'failed'; covers: Box | null; message: string }

export type PhotoPageFeatures = Partial<Record<PhotoLayerId, PhotoPageLayer>>

/** The two reads a photo can make for itself, and the layers each gives. */
export type PhotoInventoryKind = 'visual' | 'vri'

export const PHOTO_INVENTORY_LAYERS: Record<PhotoInventoryKind, readonly PhotoLayerId[]> = {
  visual: ['sensitivityUnits', 'evqo'],
  vri: ['vri', 'rock'],
}

/** Every layer the page feeds, in the order the overlay lists them. */
export const PAGE_FED_LAYERS: readonly PhotoLayerId[] = [
  'sensitivityUnits',
  'evqo',
  'rock',
  'subLandforms',
  'linesOfForce',
  'vri',
  'inventoryViewpoints',
]

const kindOf = (layer: PhotoLayerId): PhotoInventoryKind | null =>
  PHOTO_INVENTORY_LAYERS.visual.includes(layer) ? 'visual' : PHOTO_INVENTORY_LAYERS.vri.includes(layer) ? 'vri' : null

/** A photo's own read of one kind, for the ground it sees. */
export type PhotoInventoryRead =
  | { status: 'loading'; box: Box }
  | {
      status: 'ready'
      box: Box
      features: Partial<Record<PhotoLayerId, readonly PhotoFeature[]>>
      /** Why the read covers less than the ground asked for (a box cut down, a feature cap); null when whole. */
      partial: string | null
    }
  | { status: 'failed'; box: Box; message: string }

// ---------------------------------------------------------------- boxes

export function boxWithin(inner: Box, outer: Box): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

const boxesMeet = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

/**
 * The box a photo's own read asks for: the ground seen, widened outwards to `stepDegrees`, so a camera nudged a few
 * metres asks for the same box and takes the read already made.
 */
export function photoReadBox(seen: Box, stepDegrees = 0.02): Box {
  const down = (value: number) => Number((Math.floor(value / stepDegrees) * stepDegrees).toFixed(6))
  const up = (value: number) => Number((Math.ceil(value / stepDegrees) * stepDegrees).toFixed(6))
  return [down(seen[0]), down(seen[1]), up(seen[2]), up(seen[3])]
}

export const photoReadKey = (kind: PhotoInventoryKind, box: Box) => `${kind}:${box.join(',')}`

/** A geometry's box, or null for one with no coordinates. */
export function geometryBox(geometry: GeoJSON.Geometry): Box | null {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      box[0] = Math.min(box[0], value[0])
      box[1] = Math.min(box[1], value[1])
      box[2] = Math.max(box[2], value[0])
      box[3] = Math.max(box[3], value[1])
      return
    }
    for (const item of value) walk(item)
  }
  // A part's box is two corners, walked as two points: walked as one array it read as its south-west corner alone.
  if (geometry.type === 'GeometryCollection')
    for (const part of geometry.geometries) {
      const partBox = geometryBox(part)
      if (partBox) walk([partBox.slice(0, 2), partBox.slice(2)])
    }
  else walk(geometry.coordinates)
  return box[2] >= box[0] && box[3] >= box[1] ? box : null
}

/** Only the features whose box meets `seen`: the page's inventory can hold far more than one photo shows. */
export function featuresSeen(features: readonly PhotoFeature[], seen: Box | null): PhotoFeature[] {
  if (!seen) return [...features]
  return features.filter((feature) => {
    const box = geometryBox(feature.geometry)
    return !!box && boxesMeet(box, seen)
  })
}

// ---------------------------------------------------------------- what the photo draws

/** Whether the page's own read answers for the ground seen: a read whose box takes all of it in. */
export function pageAnswers(layer: PhotoPageLayer | undefined, seen: Box | null): boolean {
  if (!layer || !layer.covers) return false
  // Before the camera's ground is known, the page's read is all there is to go on.
  return !seen || boxWithin(seen, layer.covers)
}

/** Which of the photo's own reads are wanted now: a layer of that kind switched on that the page does not answer for. */
export function photoInventoryWanted(
  visibility: Partial<Record<PhotoLayerId, boolean>>,
  page: PhotoPageFeatures,
  seen: Box | null,
): Record<PhotoInventoryKind, boolean> {
  const wanted = (kind: PhotoInventoryKind) =>
    !!seen && PHOTO_INVENTORY_LAYERS[kind].some((layer) => visibility[layer] && !pageAnswers(page[layer], seen))
  return { visual: wanted('visual'), vri: wanted('vri') }
}

export type PhotoExtras = {
  /** Features for each layer that has them, cut to the ground seen. */
  features: Partial<Record<PhotoLayerId, readonly PhotoFeature[]>>
  /** Why a layer cannot be drawn for this photo at all: its row stays off. */
  unavailable: Partial<Record<PhotoLayerId, string>>
  /** What a layer's row says while it can still be switched on: reading, not read and why, read for part. */
  notes: Partial<Record<PhotoLayerId, string>>
}

/**
 * What each page-fed layer draws on the photo: the page's features where its read takes in the ground seen, else the
 * photo's own read for that ground; candidates and viewpoints only ever from the page.
 */
export function resolvePhotoExtras(
  page: PhotoPageFeatures,
  reads: Partial<Record<PhotoInventoryKind, PhotoInventoryRead | null>>,
  seen: Box | null,
): PhotoExtras {
  const out: PhotoExtras = { features: {}, unavailable: {}, notes: {} }
  for (const layer of PAGE_FED_LAYERS) {
    const held = page[layer]
    const kind = kindOf(layer)
    if (!kind || pageAnswers(held, seen)) {
      if (!held) {
        out.unavailable[layer] = 'Not read for this photo'
        continue
      }
      if (held.status === 'loading') out.notes[layer] = 'Reading…'
      else if (held.status === 'failed') out.notes[layer] = `Not read: ${held.message}`
      else {
        out.features[layer] = featuresSeen(held.features, seen)
        if (held.note) out.notes[layer] = held.note
      }
      continue
    }
    const read = reads[kind]
    if (!read) out.notes[layer] = 'Read for the ground this photo sees when switched on'
    else if (read.status === 'loading') out.notes[layer] = 'Reading for the ground this photo sees…'
    else if (read.status === 'failed') out.notes[layer] = `Not read: ${read.message}`
    else {
      out.features[layer] = featuresSeen(read.features[layer] ?? [], seen)
      if (read.partial) out.notes[layer] = read.partial
    }
  }
  return out
}

// ---------------------------------------------------------------- features from what the page holds

/** Sensitivity units and established VQOs from the visual landscape inventory's units. */
export function visualInventoryFeatures(
  units: readonly BcSensitivityUnit[],
): Record<'sensitivityUnits' | 'evqo', PhotoFeature[]> {
  const sensitivityUnits: PhotoFeature[] = []
  const evqo: PhotoFeature[] = []
  for (const unit of units) {
    const label = unit.name || `VLI ${unit.polygonNumber}`
    sensitivityUnits.push({
      layer: 'sensitivityUnits',
      id: unit.id,
      label,
      properties: { vsc: unit.vsc },
      geometry: unit.geometry,
    })
    if (unit.objectiveId)
      evqo.push({
        layer: 'evqo',
        id: unit.id,
        label: `${EVQO_CODE_FOR_CLASS[unit.objectiveId]} · ${label}`,
        properties: { code: EVQO_CODE_FOR_CLASS[unit.objectiveId] },
        geometry: unit.geometry,
      })
  }
  return { sensitivityUnits, evqo }
}

/** A stand as a click names it: leading species and height. */
const standLabel = (species: string | null | undefined, height: number | null | undefined) =>
  [species, height !== null && height !== undefined ? `${Math.round(height)} m` : null].filter(Boolean).join(' · ') ||
  undefined

/** VRI stands, and its non-vegetated land as rock (display only, as on the figures). */
export function vriFeatures(stands: readonly VriStand[]): Record<'vri' | 'rock', PhotoFeature[]> {
  const vri: PhotoFeature[] = []
  const rock: PhotoFeature[] = []
  stands.forEach((stand, i) => {
    const id = stand.featureId ?? i
    const label = standLabel(stand.speciesCode, stand.heightMeters)
    vri.push({ layer: 'vri', id, ...(label ? { label } : {}), geometry: stand.geometry })
    if (stand.nonVegetatedLand) rock.push({ layer: 'rock', id, label: 'Non-vegetated land', geometry: stand.geometry })
  })
  return { vri, rock }
}

/** The page's surveyed stands (`fetchCanopyStands`) as VRI outlines. */
export function canopyStandFeatures(stands: readonly CanopyStand[]): PhotoFeature[] {
  return stands.map((stand, i) => {
    const label = standLabel(stand.speciesCode, stand.heightMeters)
    return { layer: 'vri', id: i, ...(label ? { label } : {}), geometry: stand.geometry }
  })
}

/** Plain polygons (the run's rock round the landform) as one layer's features. */
export function polygonFeatures(
  layer: PhotoLayerId,
  geometries: ReadonlyArray<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): PhotoFeature[] {
  return geometries.map((geometry, i) => ({ layer, id: i, geometry }))
}

/** The page's terrain candidates: sub-landform dividers and lines of force, each kind named for its symbol. */
export function candidateLineFeatures(
  lines: ReadonlyArray<{ role: 'subLandform' | 'forceConvex' | 'forceConcave'; points: Array<[number, number]> }>,
): Record<'subLandforms' | 'linesOfForce', PhotoFeature[]> {
  const subLandforms: PhotoFeature[] = []
  const linesOfForce: PhotoFeature[] = []
  lines.forEach((line, i) => {
    const geometry: GeoJSON.LineString = { type: 'LineString', coordinates: line.points }
    if (line.role === 'subLandform') subLandforms.push({ layer: 'subLandforms', id: i, geometry })
    else
      linesOfForce.push({
        layer: 'linesOfForce',
        id: i,
        properties: { kind: line.role === 'forceConcave' ? 'concave' : 'convex' },
        geometry,
      })
  })
  return { subLandforms, linesOfForce }
}

/** The inventory's viewpoints as markers, named as the inventory types and numbers them. */
export function inventoryViewpointFeatures(viewpoints: readonly VliViewpoint[]): PhotoFeature[] {
  return viewpoints.map((viewpoint) => ({
    layer: 'inventoryViewpoints',
    id: viewpoint.id,
    label: viewpoint.number !== null ? `${viewpoint.typeLabel} ${viewpoint.number}` : viewpoint.typeLabel,
    geometry: { type: 'Point', coordinates: [viewpoint.lng, viewpoint.lat] },
  }))
}
