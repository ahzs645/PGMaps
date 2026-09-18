/**
 * The stand, drawn.
 *
 * Driving the road with a red polygon painted on the hillside tells you where
 * the block is; driving it with the timber standing tells you whether you can
 * see it. The trees are removed from the ground the block takes, so the opening
 * shows up as an opening — which is the thing a visual quality objective is
 * written about.
 *
 * This component owns the patch: where to grow it, how high the ground is under
 * each stem, and when to regrow it. The drawing is in `treeLayer.ts`.
 */

import { useEffect, useMemo, useRef } from 'react'

import { useMap } from '@/components/ui/map'

import { coniferMesh, placeTrees, type InventoryStand, type TreeInstance } from './forest'
import { buildImpostorAtlas } from './impostor'
import { createTreeLayer, type TreeStyle } from './treeLayer'
import { haversineMeters, type PolygonGeometry } from './visibility'

export type ForestOverlayProps = {
  active: boolean
  /**
   * Where the eye is — the viewing station on the road, not `map.getCenter()`.
   * With the camera at ground level and pitched at the horizon, the map's centre
   * is the point the view ray meets the ground plane, ten-odd kilometres off and
   * below sea level. A patch grown there is a two-pixel smudge on the skyline.
   */
  centre: { lng: number; lat: number } | null
  /** Ground the timber stands on. Empty grows forest across the whole patch. */
  stands: PolygonGeometry[]
  /** Ground with the timber off it — the proposal, and anything already cut. */
  clearings: PolygonGeometry[]
  standHeightMeters: number
  /**
   * Stands the province has surveyed. Where one covers a stem it supplies the
   * species and height, so the drawn stand is the recorded one rather than a
   * regional guess.
   */
  inventory?: ReadonlyArray<InventoryStand>
  /**
   * How a stem is drawn. Billboards are two triangles carrying a drawn tree;
   * solid cones carry real geometry at roughly fifteen times the cost.
   */
  style?: TreeStyle
  /**
   * How far the near, fully stocked patch reaches, in metres. Beyond it a
   * coarser shell carries out to `farRadiusMeters`.
   */
  radiusMeters?: number
  /**
   * How far the coarse shell reaches. It has to cover the block for the cut to
   * read as a gap, and a block is usually kilometres off — but stems that far
   * out are a pixel or two, so they are placed far apart.
   */
  farRadiusMeters?: number
  /** Matches the map's terrain exaggeration so stems sit on the rendered ground. */
  exaggeration?: number
  /** Reports what was drawn and any failure, for the panel to show. */
  onStatus?: (status: { treeCount: number; trianglesPerTree: number; error: string | null }) => void
}

const LAYER_ID = 'forestry-trees'

/** Posts across the patch for the elevation lookup. Finer than the DEM is waste. */
const ELEVATION_GRID = 33

/** Regrow once the camera has left this share of the patch behind. */
const REGROW_FRACTION = 0.3

type ElevationPatch = {
  minLng: number
  minLat: number
  stepLng: number
  stepLat: number
  values: Float32Array
}

type TerrainQuery = { queryTerrainElevation: (point: { lng: number; lat: number }) => number | null }

/**
 * Terrain heights over the patch, sampled once on a coarse grid.
 *
 * Querying the terrain per stem would be tens of thousands of texture reads on
 * every regrow; the ground between two posts twenty metres apart is well within
 * what the DEM itself resolves, so interpolating between them costs nothing
 * visible.
 */
function sampleElevationPatch(
  map: TerrainQuery,
  centre: { lng: number; lat: number },
  radiusMeters: number,
): ElevationPatch {
  const halfLat = radiusMeters / 111_320
  const halfLng = halfLat / Math.max(0.05, Math.cos((centre.lat * Math.PI) / 180))
  const stepLat = (halfLat * 2) / (ELEVATION_GRID - 1)
  const stepLng = (halfLng * 2) / (ELEVATION_GRID - 1)
  const values = new Float32Array(ELEVATION_GRID * ELEVATION_GRID)

  for (let row = 0; row < ELEVATION_GRID; row += 1) {
    for (let column = 0; column < ELEVATION_GRID; column += 1) {
      const elevation = map.queryTerrainElevation({
        lng: centre.lng - halfLng + column * stepLng,
        lat: centre.lat - halfLat + row * stepLat,
      })
      // Terrain that has not loaded reads as null, and NaN would put a tree at
      // an undefined height rather than on the ground.
      values[row * ELEVATION_GRID + column] = Number.isFinite(elevation) ? (elevation as number) : 0
    }
  }

  return { minLng: centre.lng - halfLng, minLat: centre.lat - halfLat, stepLng, stepLat, values }
}

/** Bilinear lookup into the patch, clamped at the edges. */
export function elevationAt(patch: ElevationPatch, lng: number, lat: number): number {
  const x = Math.max(0, Math.min(ELEVATION_GRID - 1.0001, (lng - patch.minLng) / patch.stepLng))
  const y = Math.max(0, Math.min(ELEVATION_GRID - 1.0001, (lat - patch.minLat) / patch.stepLat))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const at = (column: number, row: number) => patch.values[row * ELEVATION_GRID + column]
  const lower = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
  const upper = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
  return lower * (1 - fy) + upper * fy
}

export function ForestOverlay({
  active,
  centre,
  stands,
  clearings,
  standHeightMeters,
  inventory,
  style = 'billboard',
  radiusMeters = 500,
  farRadiusMeters = 3000,
  exaggeration = 1,
  onStatus,
}: ForestOverlayProps) {
  const { map, isLoaded } = useMap()
  const mesh = useMemo(() => (style === 'solid' ? coniferMesh() : undefined), [style])
  // Drawn once and kept: the atlas is the same whatever the stand does, and
  // rebuilding it on a regrow would redraw sixteen trees every station.
  const atlas = useMemo(() => (style === 'billboard' ? buildImpostorAtlas() : undefined), [style])

  // The layer owns GPU buffers, so it is created once per drive and fed new
  // stems — rebuilding it whenever the eye moved would re-upload the mesh at
  // every station. Inputs reach the regrow through a ref for the same reason.
  const patchCentreRef = useRef<{ lng: number; lat: number } | null>(null)
  const inputsRef = useRef({
    centre,
    stands,
    clearings,
    standHeightMeters,
    inventory,
    radiusMeters,
    farRadiusMeters,
    exaggeration,
  })
  const onStatusRef = useRef(onStatus)
  useEffect(() => {
    inputsRef.current = {
      centre,
      stands,
      clearings,
      standHeightMeters,
      inventory,
      radiusMeters,
      farRadiusMeters,
      exaggeration,
    }
    onStatusRef.current = onStatus
  })
  const regrowRef = useRef<((force?: boolean) => void) | null>(null)

  useEffect(() => {
    if (!map || !isLoaded || !active) return

    const layer = createTreeLayer(LAYER_ID, { style, mesh, atlas })
    try {
      // A style reload between renders can leave the old layer behind; removing
      // first keeps adding idempotent.
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      map.addLayer(layer as never)
    } catch (error) {
      // A style still settling refuses new layers. Say so rather than leaving
      // the view bare with no explanation.
      onStatusRef.current?.({
        treeCount: 0,
        trianglesPerTree: layer.trianglesPerTree,
        error: `Could not add the 3D stand: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    onStatusRef.current?.({ treeCount: 0, trianglesPerTree: layer.trianglesPerTree, error: layer.error })

    let disposed = false

    const regrow = (force = false) => {
      const inputs = inputsRef.current
      if (disposed || !inputs.centre || !map.getLayer(LAYER_ID)) return
      const previous = patchCentreRef.current
      if (!force && previous && haversineMeters(previous, inputs.centre) < inputs.radiusMeters * REGROW_FRACTION) {
        return
      }

      const centre = inputs.centre
      /** Grows one shell and sets each stem on the ground, on its own grid. */
      const shell = (options: Omit<Parameters<typeof placeTrees>[0], 'stands' | 'clearings' | 'centre'>) => {
        const grown = placeTrees({
          stands: inputs.stands,
          clearings: inputs.clearings,
          centre,
          heightMeters: inputs.standHeightMeters,
          inventory: inputs.inventory,
          ...options,
        })
        // Each shell samples the terrain over its own extent, so the near stand
        // is set on a grid fine enough to follow a road cut.
        const patch = sampleElevationPatch(map, centre, options.radiusMeters)
        for (const tree of grown) {
          tree.elevationMeters = elevationAt(patch, tree.lng, tree.lat) * inputs.exaggeration
        }
        return grown
      }

      // Near the eye the stand has to be stocked or it reads as parkland; out at
      // the block, stems are a pixel or two and only the texture matters, so the
      // same budget is spread much thinner.
      const farRadius = Math.max(inputs.radiusMeters, inputs.farRadiusMeters)
      const trees: TreeInstance[] = [
        ...shell({ radiusMeters: inputs.radiusMeters, maxTrees: 26_000 }),
        ...shell({
          radiusMeters: farRadius,
          innerRadiusMeters: inputs.radiusMeters,
          spacingMeters: 14,
          maxTrees: 34_000,
          seed: 2,
        }),
      ]

      layer.setTrees(trees)
      patchCentreRef.current = { lng: inputs.centre.lng, lat: inputs.centre.lat }
      map.triggerRepaint()
      onStatusRef.current?.({
        treeCount: trees.length,
        trianglesPerTree: layer.trianglesPerTree,
        error: layer.error,
      })
    }

    regrowRef.current = regrow

    // The terrain source may still be loading when the drive starts, and an
    // unloaded tile reads as sea level — so the first patch is regrown once the
    // map settles rather than trusted as it stands.
    regrow(true)
    const onIdle = () => regrow(true)
    map.on('idle', onIdle)

    return () => {
      disposed = true
      regrowRef.current = null
      patchCentreRef.current = null
      map.off('idle', onIdle)
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [active, atlas, isLoaded, map, mesh, style])

  // Driving past the far edge of the patch is the common case: the eye moves on,
  // the trees behind it are wasted, and the ground ahead has none.
  useEffect(() => {
    regrowRef.current?.()
  }, [centre])

  // A change to the block, the stand or the exaggeration invalidates the patch
  // on the spot: the gap has moved, and the old trees are standing in it.
  useEffect(() => {
    regrowRef.current?.(true)
  }, [stands, clearings, standHeightMeters, inventory, radiusMeters, farRadiusMeters, exaggeration])

  return null
}
