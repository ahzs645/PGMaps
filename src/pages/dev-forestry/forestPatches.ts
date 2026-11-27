/** Stable geographic tiles, independent of the eye and of browser/network state. */
import { placeTrees, type TreeInstance, type TreePlacementOptions } from './forest'
import { placeEdgeTrees } from './harvestedGround'
import type { PolygonGeometry } from './visibility'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { haversineMeters } from './visibility'

// Load beyond visibility before the anchor advances by 75 m.
export const FOREST_PATCH_GUARD_METERS = 200

export type ForestBand = {
  size: number
  spacing: number
  near: number
  far: number
  /**
   * The background band (View options → *Distant trees*): grown on its own ground and inventory
   * (`ForestBackground`, `driveForestTerrain.ts`), and only once that read has come.
   */
  background?: true
}
export type ForestPatch = {
  key: string
  band: number
  centre: { lng: number; lat: number }
  bounds: [number, number, number, number]
  radius: number
}
export function forestBands(farRadius: number, backgroundRadius?: number): ForestBand[] {
  const coreFar = Math.max(3500, farRadius)
  return [
    // 4 m holds up to 625 stems/ha, enough for the region's mature stands
    // (VRI median 426–664), so the first 300 m is drawn stem for stem. Past
    // it every band is coarser and widens crowns to keep the stand's canopy
    // closure instead (`placeTrees`).
    { size: 256, spacing: 4, near: 0, far: 300 },
    { size: 512, spacing: 9, near: 250, far: 600 },
    { size: 1024, spacing: 24, near: 550, far: 3000 },
    { size: 2048, spacing: 80, near: 2800, far: coreFar },
    // The hills behind a small scene: one stem for every 160 m, out to the background read's reach.
    ...(backgroundRadius && backgroundRadius > coreFar
      ? [{ size: 4096, spacing: 160, near: coreFar - 300, far: backgroundRadius, background: true as const }]
      : []),
  ]
}
/**
 * The patches round the eye. A background band is left out until `backgroundKey` names the read it grows from, and its
 * patches' keys carry that key: a stand placed from one read is never taken for another's, and every other band's
 * patches keep their keys whether the background is there or not.
 */
export function forestPatches(
  eye: { lng: number; lat: number },
  bands: ForestBand[],
  anchorLatitude: number,
  backgroundKey: string | null = null,
): ForestPatch[] {
  const result: ForestPatch[] = []
  const lngMeters = 111320 * Math.cos((anchorLatitude * Math.PI) / 180)
  bands.forEach((band, index) => {
    if (band.background && backgroundKey === null) return
    const suffix = band.background ? `@${backgroundKey}` : ''
    const dx = band.size / lngMeters,
      dy = band.size / 111320
    const cx = eye.lng / dx,
      cy = eye.lat / dy,
      cells = Math.ceil((band.far + FOREST_PATCH_GUARD_METERS) / band.size) + 1
    for (let y = Math.floor(cy) - cells; y <= Math.floor(cy) + cells; y++) {
      for (let x = Math.floor(cx) - cells; x <= Math.floor(cx) + cells; x++) {
        const centre = { lng: (x + 0.5) * dx, lat: (y + 0.5) * dy }
        const distance = haversineMeters(eye, centre),
          diagonal = (band.size * Math.SQRT2) / 2
        if (
          distance - diagonal > band.far + FOREST_PATCH_GUARD_METERS ||
          distance + diagonal < band.near - FOREST_PATCH_GUARD_METERS
        )
          continue
        result.push({
          key: `${index}/${x}/${y}${suffix}`,
          band: index,
          centre,
          bounds: [x * dx, y * dy, (x + 1) * dx, (y + 1) * dy],
          radius: diagonal + 1,
        })
      }
    }
  })
  // Foreground first, then the hillside. Work can be spread across frames. The background band comes last: it reads
  // ground of its own and arrives after the rest, and a stand at 3–8 km matters less than the hillside before it.
  return result.sort((a, b) => a.band - b.band || haversineMeters(eye, a.centre) - haversineMeters(eye, b.centre))
}
/**
 * Grow patches in and just beyond the view first, with the near bands retaining priority for driving.
 * Sorting changes only the build order. Membership and the keys of already drawn patches stay the same.
 */
export function orderForestPatches(
  patches: ForestPatch[],
  eye: { lng: number; lat: number },
  bearingDegrees: number,
  horizontalFovDegrees: number,
): ForestPatch[] {
  const bearing = (bearingDegrees * Math.PI) / 180
  const east = Math.sin(bearing)
  const north = Math.cos(bearing)
  const longitudeMeters = 111320 * Math.cos((eye.lat * Math.PI) / 180)
  const viewHalfAngle = ((horizontalFovDegrees / 2 + 20) * Math.PI) / 180
  return patches
    .map((patch) => {
      const x = (patch.centre.lng - eye.lng) * longitudeMeters
      const y = (patch.centre.lat - eye.lat) * 111320
      const distance = Math.hypot(x, y)
      const angle = Math.atan2(Math.abs(x * north - y * east), x * east + y * north)
      const nearView = angle <= viewHalfAngle + Math.atan2(patch.radius, distance)
      const priority = patch.band < 2 ? patch.band * 2 + Number(!nearView) : nearView ? 4 : 5
      return { patch, distance, priority }
    })
    .sort((a, b) => a.priority - b.priority || a.patch.band - b.patch.band || a.distance - b.distance)
    .map(({ patch }) => patch)
}

export function growForestPatch(
  patch: ForestPatch,
  band: ForestBand,
  inputs: Pick<
    TreePlacementOptions,
    'stands' | 'clearings' | 'thinnings' | 'inventory' | 'heightMeters' | 'canopyKnownAt'
  > & {
    /** Cut ground: the coarse bands stand a row of edge stems along it (`placeEdgeTrees`). */
    openings?: ReadonlyArray<PolygonGeometry>
  },
  elevation: ElevationSource,
  anchorLatitude: number,
): TreeInstance[] {
  const [west, south, east, north] = patch.bounds
  // In the coarse bands a drawn stem stands for many and a block's edge goes
  // ragged by half the spacing (12 m and more); a row of edge stems keeps it a
  // wall. Not in the nearer bands: there the edge is already within a few
  // metres, and a second row dithering in over the first speckles the crowns.
  const edges =
    band.spacing >= 20 && inputs.openings?.length
      ? placeEdgeTrees({
          openings: inputs.openings,
          clearings: inputs.clearings,
          bounds: patch.bounds,
          inventory: inputs.inventory,
          heightMeters: inputs.heightMeters,
          spacingMeters: Math.min(12, band.spacing * 0.6),
          seed: patch.band + 1,
        })
      : []
  const far = isFarBand(band)
  // The slope is read across about half the band's spacing: the hill a far card stands on, not the
  // hummock under one stem.
  const reach = Math.max(12, Math.min(40, band.spacing / 2))
  const reachLat = reach / 111_320
  return [
    ...placeTrees({
      ...inputs,
      centre: patch.centre,
      radiusMeters: patch.radius,
      spacingMeters: band.spacing,
      maxTrees: 10000,
      seed: patch.band + 1,
      anchorLatitude,
      // The patch is a square tile: grow only it, not the circle around it.
      bounds: [west, south, east, north],
      ...(far ? { canopyTileMeters: canopyTileMeters(band) } : {}),
      // The background band lists the core read before its own: there the first stand decides open ground. The core
      // bands keep any open polygon's word, so a regrowth stand listed first never lets a tile over a fresh block.
      ...(band.background ? { canopyOpenByFirstStand: true } : {}),
    }),
    ...edges,
  ].flatMap((tree) => {
    const height = elevation.elevationAt(tree.lng, tree.lat)
    if (!Number.isFinite(height)) return []
    if (!far) return [{ ...tree, elevationMeters: height }]
    const reachLng = reachLat / Math.max(0.05, Math.cos((tree.lat * Math.PI) / 180))
    const east = elevation.elevationAt(tree.lng + reachLng, tree.lat)
    const west = elevation.elevationAt(tree.lng - reachLng, tree.lat)
    const north = elevation.elevationAt(tree.lng, tree.lat + reachLat)
    const south = elevation.elevationAt(tree.lng, tree.lat - reachLat)
    // Off the edge of the elevation the ground is taken as level rather than guessed.
    const slope: [number, number] = [
      Number.isFinite(east) && Number.isFinite(west) ? (east - west) / (2 * reach) : 0,
      Number.isFinite(north) && Number.isFinite(south) ? (north - south) / (2 * reach) : 0,
    ]
    return [{ ...tree, elevationMeters: height, slope }]
  })
}

/** The coarse bands, where a drawn stem stands for many: clump cards, canopy tiles, the hill's light. */
export function isFarBand(band: ForestBand): boolean {
  return band.spacing >= 20
}

/**
 * The side of the canopy tile a far band's stem lays over its own ground, metres: a quarter wider
 * than the band's spacing, so the tiles of neighbouring stems overlap as crowns do and a jittered
 * stem still roofs its cell.
 */
export function canopyTileMeters(band: ForestBand): number {
  return band.spacing * 1.25
}

/** Keep the same foreground representation all the way to the eye. */
export function canopyRange(bands: ForestBand[], index: number): [number, number, number, number] {
  const band = bands[index]
  return [
    index === 0 ? -2 : band.near,
    index === 0 ? -1 : bands[index - 1].far,
    index + 1 < bands.length ? bands[index + 1].near : band.far - 300,
    band.far,
  ]
}

/** How many stand placements keep their placed patches: one harvest phase and the other. */
export const KEPT_PATCH_PLACEMENTS = 2

/**
 * The placed patches kept for a stand placement (the road view's `forestPatches`): the map made for this very
 * placement when it is one of the last `limit` asked for (equal element by element, by identity), else a new one.
 * `kept` holds them newest first and is updated in place. Switching the harvest phase and back hands the stand the
 * same arrays (each phase keeps its own), so the after-harvest stand is found again rather than grown a third time.
 * What a placement holds is the caller's: nothing here reads it, and a stem is placed as it would be from a new map.
 */
export function patchCacheFor<T>(
  kept: Array<{ placement: readonly unknown[]; patches: Map<string, T> }>,
  placement: readonly unknown[],
  limit = KEPT_PATCH_PLACEMENTS,
): Map<string, T> {
  const index = kept.findIndex(
    (entry) =>
      entry.placement.length === placement.length && entry.placement.every((value, i) => value === placement[i]),
  )
  const entry = index >= 0 ? kept.splice(index, 1)[0] : { placement, patches: new Map<string, T>() }
  kept.unshift(entry)
  kept.splice(Math.max(1, limit))
  return entry.patches
}

/**
 * Lets go of every kept placement but the one whose patches are `current` (the stand the road view draws now), in
 * place. Asked once as an engine starts drawing a place's views, after the before-harvest render: the other phase's
 * stand is not drawn again there, and two road-view stands beside the engine's scenes and final stands were the peak
 * that crashed the tab. The cache keeps its two placements from then on, as before. Returns how many were let go.
 */
export function keepOnlyPatchPlacement<T>(
  kept: Array<{ placement: readonly unknown[]; patches: Map<string, T> }>,
  current: Map<string, T>,
): number {
  const before = kept.length
  const keep = kept.filter((entry) => entry.patches === current)
  kept.splice(0, kept.length, ...keep)
  return before - kept.length
}

/**
 * Whether the road view's own stand is put away while another engine draws a capture's place
 * (`ViewCaptureHost.render`): its tree layers leave the eye map, releasing their GPU buffers and textures, and its
 * placed patches are emptied (`releasePatchPlacements`), so PGMaps' stand and the engine's final stand and atlas
 * are never held on the GPU together. The stand regrows once that place's renders settle. Off, the stand stays drawn
 * through the renders and only the other phase's placement is let go (`keepOnlyPatchPlacement`).
 */
export const RELEASE_ROAD_VIEW_STAND_FOR_ENGINE = true

/**
 * Empties every kept placement's patches in place and keeps only the entry whose patches are `current` (the map the
 * road view's stand is handed), so the placed stems can be collected while the map itself stays the one the stand
 * fills again. Nothing about where a stem stands changes: the patches are grown again from the same placement.
 * Returns how many placed patches were let go.
 */
export function releasePatchPlacements<T>(
  kept: Array<{ placement: readonly unknown[]; patches: Map<string, T> }>,
  current: Map<string, T> | null,
): number {
  let released = 0
  for (const entry of kept) {
    released += entry.patches.size
    entry.patches.clear()
  }
  if (current && current.size) {
    released += current.size
    current.clear()
  }
  if (current) keepOnlyPatchPlacement(kept, current)
  else kept.splice(0)
  return released
}
