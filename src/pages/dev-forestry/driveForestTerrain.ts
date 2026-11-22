/**
 * The road view's background band (View options → *Distant trees*): a coarse terrain mosaic and an open-ground
 * inventory read out to `DRIVE_FOREST_CONTEXT_METERS`, so the hills behind a small scene carry timber. Display only:
 * the camera, the sightline run, the scene package and every figure keep the road view's own ground and inventory.
 *
 * Free of DOM and network access: the hook (`useDriveTerrain.ts`) reads the tiles and the inventory and hands them
 * here.
 */
import { demTileRange, type Bounds, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import {
  groundCoverFromBclcs,
  speciesFromCode,
  speciesMixFromInventory,
  type GroundCover,
  type InventoryStand,
} from './forest'
import { polygonBounds, type PolygonGeometry } from './visibility'

/** Illustrative hills behind the assessed area. Keep these tiles out of the camera and sightline elevations. */
export const DRIVE_FOREST_CONTEXT_METERS = 8000
export const DRIVE_FOREST_CONTEXT_MAX_TILES = 25

export function driveForestTerrainRange(bounds: Bounds) {
  for (const zoom of [11, 10, 9]) {
    const range = demTileRange(bounds, zoom, DRIVE_FOREST_CONTEXT_METERS)
    if (range.tileCount <= DRIVE_FOREST_CONTEXT_MAX_TILES) return range
  }
  return null
}

/** One polygon of the background's open-ground read (`fetchOpenGround`), reduced to what the drawing needs. */
export type BackgroundVriStand = {
  geometry: PolygonGeometry
  landCover?: { level2: string | null; level3: string | null; level4: string | null; level5: string | null }
  speciesCode?: string | null
  speciesComposition?: Array<{ code: string; percent: number; heightMeters: number | null }>
  heightMeters?: number | null
  crownClosurePercent?: number | null
  stemsPerHa?: number | null
}

/** The background read: its terrain, the boxes its inventory read completely, and the open ground it found there. */
export type ForestContextRead = {
  /** What the read was for; the background band's patches are kept under it. */
  key: string
  source: ElevationSource
  complete: ReadonlyArray<Bounds>
  stands: ReadonlyArray<BackgroundVriStand>
}

/**
 * The background band as `ForestOverlay` grows it: its own ground, its own inventory and where its ground is known.
 * Never part of the forest configuration, so its arrival regrows no other band and changes no scene package.
 */
export type ForestBackground = {
  key: string
  /** The road view's own ground where it has one, else the coarse mosaic where the read knows the ground. */
  elevation: ElevationSource
  /** The core inventory first, then the background's own stands, so the core's answer wins wherever it has one. */
  inventory: ReadonlyArray<InventoryStand>
  /** Where the band's ground is known: canopy tiles stop short of the rest (`placeTrees`' `canopyKnownAt`). */
  knownAt: (lng: number, lat: number) => boolean
}

/**
 * Trees on the assessed hillside keep their original elevation. The extra mosaic only fills gaps in the view, and only
 * where `readAt` says the background's inventory was read: unread background stays open.
 */
export function forestGround(
  core: ElevationSource,
  context: ElevationSource,
  readAt: (lng: number, lat: number) => boolean = () => true,
): ElevationSource {
  return {
    elevationAt(lng, lat) {
      const surveyed = core.elevationAt(lng, lat)
      if (Number.isFinite(surveyed)) return surveyed
      return readAt(lng, lat) ? context.elevationAt(lng, lat) : NaN
    },
  }
}

/**
 * The background read's polygons as the drawing's stands, by the core's own rules (`groundCoverFromBclcs`, as the
 * analysis builds `renderCover`): water, wetland, rock, herb, low shrub and other non-treed ground grow nothing; tall
 * shrub a low thicket; a sparse treed stand its recorded species, height, density and closure. A polygon whose record
 * does not say what covers it is unknown, not open: it is left out, and inside a complete box grows the regional
 * stand, as the core grows it on ground its inventory does not describe.
 *
 * A polygon wholly inside one of `coreRead` (the boxes the road view's own inventory read) is dropped: there the core
 * read decides. One reaching past it is kept and listed after the core inventory, so it counts only where the core
 * holds no polygon of its own.
 */
export function backgroundStands(
  stands: ReadonlyArray<BackgroundVriStand>,
  coreRead: ReadonlyArray<Bounds> = [],
): InventoryStand[] {
  const inside = (geometry: PolygonGeometry) => {
    if (!coreRead.length) return false
    const [w, s, e, n] = polygonBounds(geometry)
    return coreRead.some((box) => w >= box[0] && s >= box[1] && e <= box[2] && n <= box[3])
  }
  return stands.flatMap((stand): InventoryStand[] => {
    if (inside(stand.geometry)) return []
    const land = stand.landCover
    const level2 = land?.level2?.trim().toUpperCase() ?? ''
    if (level2 === 'T') {
      return [
        {
          geometry: stand.geometry,
          species: speciesFromCode(stand.speciesCode),
          heightMeters: stand.heightMeters && stand.heightMeters > 0 ? stand.heightMeters : null,
          crownClosurePercent: stand.crownClosurePercent ?? null,
          stemsPerHa: stand.stemsPerHa ?? null,
          speciesMix: stand.speciesComposition ? speciesMixFromInventory(stand.speciesComposition) : undefined,
        },
      ]
    }
    const cover: GroundCover | null = land
      ? groundCoverFromBclcs(land.level2, land.level3, land.level4, land.level5)
      : null
    return cover ? [{ geometry: stand.geometry, species: null, heightMeters: null, cover }] : []
  })
}

/**
 * The background band from its read and the road view's own ground and inventory. Outside the core terrain, ground is
 * known only inside a box the background's inventory read completely and where the mosaic has a height.
 */
export function forestBackground(
  read: ForestContextRead,
  core: ElevationSource,
  coreInventory: ReadonlyArray<InventoryStand>,
  coreRead: ReadonlyArray<Bounds> = [],
): ForestBackground {
  const readAt = (lng: number, lat: number) =>
    read.complete.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n)
  const elevation = forestGround(core, read.source, readAt)
  return {
    // The core read's boxes decide which background polygons count, so they are part of what the band was grown from.
    key: coreRead.length ? `${read.key}|${coreRead.map((box) => box.join(',')).join(';')}` : read.key,
    elevation,
    inventory: [...coreInventory, ...backgroundStands(read.stands, coreRead)],
    knownAt: (lng, lat) => Number.isFinite(elevation.elevationAt(lng, lat)),
  }
}
