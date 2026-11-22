import { demTileRange, type Bounds, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { InventoryStand } from './forest'
import { boxedPolygonLookup, SCENE_COVER, type SceneCoverSource } from './sceneCover'

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

/** Trees on the assessed hillside keep their original elevation. The extra mosaic only fills gaps in the view. */
export function forestGround(
  core: ElevationSource,
  context: ElevationSource,
  treedAt: (lng: number, lat: number) => boolean = () => true,
): ElevationSource {
  return {
    elevationAt(lng, lat) {
      const surveyed = core.elevationAt(lng, lat)
      if (Number.isFinite(surveyed)) return surveyed
      return treedAt(lng, lat) ? context.elevationAt(lng, lat) : NaN
    },
  }
}

/** A complete VRI read treats unlisted land as forest. Unread context is left open. */
export function forestContextCover(cover: SceneCoverSource, bounds: Bounds) {
  const openGround: InventoryStand[] = cover.polygons
    .filter(
      ({ cover, underStand }) =>
        !underStand && cover !== SCENE_COVER.forest && cover !== SCENE_COVER.sparse && cover !== SCENE_COVER.burnt,
    )
    .map(({ geometry }) => ({ geometry, species: null, heightMeters: null, cover: 'other' }))
  const openAt = boxedPolygonLookup(
    openGround.map(({ geometry }) => geometry),
    bounds,
  )
  const treedAt = (lng: number, lat: number) =>
    cover.complete.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n) && openAt(lng, lat) < 0
  return { openGround, treedAt }
}
