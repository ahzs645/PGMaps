/** Stable geographic tiles, independent of the eye and of browser/network state. */
import { placeTrees, type TreeInstance, type TreePlacementOptions } from './forest'
import type { ElevationSource } from './terrain'
import { haversineMeters } from './visibility'

// Load beyond visibility before the anchor advances by 75 m.
export const FOREST_PATCH_GUARD_METERS = 200

export type ForestBand = { size: number; spacing: number; near: number; far: number }
export type ForestPatch = {
  key: string
  band: number
  centre: { lng: number; lat: number }
  bounds: [number, number, number, number]
  radius: number
}
export function forestBands(farRadius: number): ForestBand[] {
  return [
    // 4 m holds up to 625 stems/ha, enough for the region's mature stands
    // (VRI median 426–664), so the first 300 m is drawn stem for stem. Past
    // it every band is coarser and widens crowns to keep the stand's canopy
    // closure instead (`placeTrees`).
    { size: 256, spacing: 4, near: 0, far: 300 },
    { size: 512, spacing: 9, near: 250, far: 600 },
    { size: 1024, spacing: 24, near: 550, far: 3000 },
    { size: 2048, spacing: 80, near: 2800, far: Math.max(3500, farRadius) },
  ]
}
export function forestPatches(
  eye: { lng: number; lat: number },
  bands: ForestBand[],
  anchorLatitude: number,
): ForestPatch[] {
  const result: ForestPatch[] = []
  const lngMeters = 111320 * Math.cos((anchorLatitude * Math.PI) / 180)
  bands.forEach((band, index) => {
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
        if (distance - diagonal > band.far + FOREST_PATCH_GUARD_METERS || distance + diagonal < band.near - FOREST_PATCH_GUARD_METERS) continue
        result.push({
          key: `${index}/${x}/${y}`,
          band: index,
          centre,
          bounds: [x * dx, y * dy, (x + 1) * dx, (y + 1) * dy],
          radius: diagonal + 1,
        })
      }
    }
  })
  // Foreground first, then the hillside. Work can be spread across frames.
  return result.sort((a, b) => a.band - b.band || haversineMeters(eye, a.centre) - haversineMeters(eye, b.centre))
}
export function growForestPatch(
  patch: ForestPatch,
  band: ForestBand,
  inputs: Pick<TreePlacementOptions, 'stands' | 'clearings' | 'thinnings' | 'inventory' | 'heightMeters'>,
  elevation: ElevationSource,
  anchorLatitude: number,
): TreeInstance[] {
  const [west, south, east, north] = patch.bounds
  return placeTrees({
    ...inputs,
    centre: patch.centre,
    radiusMeters: patch.radius,
    spacingMeters: band.spacing,
    maxTrees: 10000,
    seed: patch.band + 1,
    anchorLatitude,
  })
    .filter((tree) => tree.lng >= west && tree.lng < east && tree.lat >= south && tree.lat < north)
    .flatMap((tree) => {
      const height = elevation.elevationAt(tree.lng, tree.lat)
      return Number.isFinite(height) ? [{ ...tree, elevationMeters: height }] : []
    })
}

/** Keep the same foreground representation all the way to the eye. */
export function canopyRange(bands: ForestBand[], index: number): [number, number, number, number] {
  const band = bands[index]
  return [index === 0 ? -2 : band.near, index === 0 ? -1 : bands[index - 1].far,
    index + 1 < bands.length ? bands[index + 1].near : band.far - 300, band.far]
}
