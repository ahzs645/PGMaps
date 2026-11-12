/** Stable geographic forest tiles, grown progressively against a fixed DEM. */
import { useEffect, useMemo, useRef } from 'react'
import { useMap } from '@/components/ui/map'
import {
  TREE_SPECIES_IDS,
  coniferMesh,
  viewingGapToward,
  type InventoryStand,
  type Thinning,
  type TreeInstance,
} from './forest'
import { buildImpostorAtlas } from './impostor'
import { createTreeLayer, type TreeLook, type TreeStyle } from './treeLayer'
import { detailedTreeMesh } from './treeGeometry'
import { debrisMesh, placeDebris } from './harvestedGround'

/** Slash and stumps are drawn this far out; past it a pile is under a pixel. */
const DEBRIS_REACH_METERS = 600

/**
 * How long the view must hold still before the nearest stems are drawn in
 * detail. Moving, every stem is a card and the frame stays cheap; stopped,
 * one heavier frame is worth drawing.
 */
export const DETAIL_SETTLE_MS = 450
/**
 * Detailed stems hand over to cards at the detail radius, cleanly: both draw
 * the same stem at the same size, and a dithered overlap speckled the crowns.
 */
const DETAIL_BLEND_METERS = 0
import { canopyRange, forestBands, forestPatches, growForestPatch } from './forestPatches'
import { haversineMeters, type PolygonGeometry } from './visibility'
import type { ElevationSource } from './terrain'

export type ForestStatus = {
  configuration?: ForestConfiguration
  ready?: boolean
  nearbyReady?: boolean
  totalPatches?: number
  reusedPatches?: number
  treeCount: number
  trianglesPerTree: number
  error: string | null
  nearTreeCount?: number
  patchCount?: number
  coverageMeters?: number
  inventoryStandCount?: number
  /** Stems drawn in detail when the view holds still (0 with detail off). */
  detailTreeCount?: number
}
export type ForestConfiguration = {
  anchorLatitude?: number
  stands: PolygonGeometry[]
  clearings: PolygonGeometry[]
  /**
   * Ground actually cut (a block after harvest, an opening still counting):
   * carries slash and stumps, and its edge a wall of timber at distance.
   */
  openings?: PolygonGeometry[]
  thinnings?: ReadonlyArray<Thinning>
  standHeightMeters: number
  inventory?: ReadonlyArray<InventoryStand>
  style?: TreeStyle
  /** Shading: `flat` as before, `lit` crown-volume lighting. Never changes coverage. */
  look?: TreeLook
  /**
   * Draw the stems within this many metres of the eye as detailed meshes
   * whenever the view holds still; 0 or absent never does.
   */
  detailRadiusMeters?: number
  farRadiusMeters?: number
  elevation: ElevationSource | null
}
export type ForestOverlayProps = {
  active: boolean
  configuration: ForestConfiguration
  centre: { lng: number; lat: number } | null
  /** A block to keep a viewing gap open toward, from wherever the eye is. */
  gapTarget?: PolygonGeometry | null
  terrainMessage?: string | null
  onStatus?: (status: ForestStatus) => void
  /**
   * Placed patches kept by the caller, so an overlay remounted with its map (the road view's map
   * mounts only while it is open) reuses the stand it already placed. Make a new one whenever
   * `configuration` changes; without it the overlay keeps its own.
   */
  patches?: Map<string, TreeInstance[]>
}
const LAYER_ID = 'forestry-trees'
export function ForestOverlay(props: ForestOverlayProps) {
  const { map, isLoaded } = useMap()
  const eyeRef = useRef(props.centre)
  const statusRef = useRef(props.onStatus)
  eyeRef.current = props.centre
  // Read each frame, so the gap follows the eye without regrowing the stand.
  const gapTargetRef = useRef(props.gapTarget ?? null)
  gapTargetRef.current = props.gapTarget ?? null
  statusRef.current = props.onStatus
  const { active, configuration, terrainMessage } = props
  const {
    anchorLatitude: sceneLatitude,
    stands,
    clearings,
    openings,
    thinnings,
    standHeightMeters,
    inventory,
    style = 'hybrid',
    look = 'flat',
    detailRadiusMeters = 0,
    farRadiusMeters = 3500,
    elevation,
  } = configuration
  // Placement and readiness share an identity. A source/geometry change must
  // invalidate readiness during render, before the replacement effect runs.
  const ownPatches = useMemo(() => ({ configuration, tiles: new Map<string, TreeInstance[]>() }), [configuration]).tiles
  const patches = props.patches ?? ownPatches
  const atlas = useMemo(() => (style !== 'solid' ? buildImpostorAtlas() : undefined), [style])
  const clumpAtlas = useMemo(() => (style !== 'solid' ? buildImpostorAtlas(128, 'clump') : undefined), [style])
  useEffect(() => {
    if (!active || !isLoaded || !map) return
    if (!elevation) {
      statusRef.current?.({
        configuration,
        treeCount: 0,
        trianglesPerTree: 0,
        error: terrainMessage ?? 'Loading preview terrain…',
      })
      return
    }
    statusRef.current?.({ configuration, treeCount: 0, trianglesPerTree: 0, error: null, ready: false })
    const initialEye = eyeRef.current
    if (!initialEye) return
    const anchorLatitude = sceneLatitude ?? initialEye.lat
    const bands = forestBands(farRadiusMeters)
    // Coarse bands draw clumps of trees per card, not one stretched tree.
    const clumpBand = (i: number) => bands[i].spacing >= 20
    const distantLayers = bands.map((_, i) =>
      createTreeLayer(`${LAYER_ID}-${i}`, {
        style: style === 'solid' ? 'solid' : 'billboard',
        atlas: clumpBand(i) ? clumpAtlas : atlas,
        clumps: style !== 'solid' && clumpBand(i),
        mesh: style === 'solid' ? coniferMesh() : undefined,
        crossedCards: i === 0 ? (style === 'hybrid' ? 3 : 2) : i === 1 ? 2 : undefined,
        range: canopyRange(bands, i),
        look,
      }),
    )
    // One representation for every foreground stem while the view moves.
    // Held still, the stems nearest the eye are drawn again as detailed meshes
    // — the same stems, at the same positions, heights and crown widths — and
    // the cards step back from that ring. A second representation only near
    // the eye once changed the stand's shape; this one replaces like for like,
    // and only for the still frame.
    const detailLayers =
      detailRadiusMeters > 0 && style !== 'solid'
        ? TREE_SPECIES_IDS.map((species, index) =>
            createTreeLayer(`${LAYER_ID}-detail-${species}`, {
              style: 'solid',
              mesh: detailedTreeMesh(species, index + 1),
              range: [-2, -1, detailRadiusMeters - DETAIL_BLEND_METERS, detailRadiusMeters + 0.01],
              look,
            }),
          )
        : []
    // Slash and stumps on cut ground near enough to see them.
    const debrisLayer =
      openings && openings.length > 0
        ? createTreeLayer(`${LAYER_ID}-debris`, {
            style: 'solid',
            mesh: debrisMesh(1),
            range: [-2, -1, DEBRIS_REACH_METERS - 50, DEBRIS_REACH_METERS],
            look,
          })
        : null
    const debrisCache = new Map<string, TreeInstance[]>()
    const layers = [...distantLayers, ...(debrisLayer ? [debrisLayer] : []), ...detailLayers]
    let lastMatrix: ArrayLike<number> | null = null
    let movedAt = performance.now()
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let detailCount = 0
    let nearCount = 0,
      patchCount = 0,
      count = 0
    const wrapper = {
      id: LAYER_ID,
      type: 'custom' as const,
      renderingMode: '3d' as const,
      onAdd: (host: unknown, gl: WebGLRenderingContext | WebGL2RenderingContext) =>
        layers.forEach((layer) => layer.onAdd(host, gl)),
      onRemove: () => layers.forEach((layer) => layer.onRemove()),
      render: (
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        args: Parameters<(typeof layers)[0]['render']>[1],
      ) => {
        const eye = eyeRef.current
        if (eye) {
          const target = gapTargetRef.current
          const gap = target ? viewingGapToward(eye, target) : null
          // Moving or still, read off the matrix the frame is drawn with: a
          // turn of the head counts as moving as much as a step does.
          const matrix = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix
          const now = performance.now()
          if (matrix && (!lastMatrix || Array.from(matrix).some((value, i) => value !== lastMatrix![i]))) {
            lastMatrix = Array.from(matrix)
            movedAt = now
            if (detailLayers.length > 0) {
              if (settleTimer) clearTimeout(settleTimer)
              // One more frame once the view has settled, to draw the detail.
              settleTimer = setTimeout(() => {
                settleTimer = null
                map.triggerRepaint()
              }, DETAIL_SETTLE_MS + 20)
            }
          }
          const still = detailLayers.length > 0 && detailCount > 0 && now - movedAt >= DETAIL_SETTLE_MS
          for (const layer of distantLayers) {
            layer.setEye(eye)
            layer.setGap(gap)
            layer.setNearCut(still ? detailRadiusMeters - DETAIL_BLEND_METERS : 0)
            layer.render(gl, args)
          }
          if (debrisLayer) {
            debrisLayer.setEye(eye)
            debrisLayer.render(gl, args)
          }
          if (still) {
            for (const layer of detailLayers) {
              layer.setEye(eye)
              layer.setGap(gap)
              layer.render(gl, args)
            }
          }
        }
      },
      /** True when the last frame drew the nearest stems in detail. */
      get detailShown() {
        return detailLayers.length > 0 && detailCount > 0 && performance.now() - movedAt >= DETAIL_SETTLE_MS
      },
      // Read-only diagnostics also let browser checks catch accidental close LODs.
      get distanceRanges() {
        return bands.map((_, i) => canopyRange(bands, i))
      },
      get renderLayerCount() {
        return layers.length
      },
      get treeCount() {
        return count
      },
      get nearTreeCount() {
        return nearCount
      },
      get detailTreeCount() {
        return detailCount
      },
      get reusedPatches() {
        return reusedPatches
      },
      get patchCount() {
        return patchCount
      },
      get coverageMeters() {
        return farRadiusMeters
      },
      get error() {
        return layers.find((layer) => layer.error)?.error ?? null
      },
    }
    map.addLayer(wrapper as never)
    const cache = patches
    const uploadedKeys = bands.map(() => '')
    let lastEye = initialEye,
      disposed = false,
      frame = 0,
      dirty = true,
      lastUpload = -Infinity
    let wanted = forestPatches(initialEye, bands, anchorLatitude)
    const wantedKeys = new Set(wanted.map((patch) => patch.key))
    for (const key of cache.keys()) if (!wantedKeys.has(key)) cache.delete(key)
    const reusedPatches = cache.size
    // The stems nearest the eye, by species, for the detailed layers. Kept
    // with the eye as it moves, independent of the patch bands.
    let detailEye = initialEye
    let detailKeys = ''
    const refreshDetail = (nearest: TreeInstance[]) => {
      if (detailLayers.length === 0) return
      const within = nearest.filter((tree) => haversineMeters(detailEye, tree) < detailRadiusMeters)
      const key = `${within.length}:${detailEye.lng.toFixed(5)},${detailEye.lat.toFixed(5)}`
      if (key === detailKeys) return
      detailKeys = key
      detailCount = within.length
      TREE_SPECIES_IDS.forEach((species, index) =>
        detailLayers[index].setTrees(within.filter((tree) => tree.species === species)),
      )
    }
    let nearestTrees: TreeInstance[] = []
    const upload = () => {
      const grouped: TreeInstance[][] = bands.map(() => [])
      for (const patch of wanted) grouped[patch.band].push(...(cache.get(patch.key) ?? []))
      count = grouped.reduce((sum, group) => sum + group.length, 0)
      if (debrisLayer) {
        const piles: TreeInstance[] = []
        for (const patch of wanted) piles.push(...(debrisCache.get(patch.key) ?? []))
        debrisLayer.setTrees(piles)
      }
      grouped.forEach((trees, i) => {
        const keys = wanted
          .filter((patch) => patch.band === i && cache.has(patch.key))
          .map((patch) => patch.key)
          .sort()
          .join('|')
        if (keys !== uploadedKeys[i]) {
          distantLayers[i].setTrees(trees)
          uploadedKeys[i] = keys
        }
      })
      nearestTrees = grouped[0]
      refreshDetail(nearestTrees)
      const close = grouped[0].filter((tree) => haversineMeters(lastEye, tree) < 180)
      nearCount = style === 'hybrid' ? close.length : 0
      patchCount = cache.size
      const triangles = layers.reduce((sum, layer) => sum + layer.treeCount * layer.trianglesPerTree, 0)
      statusRef.current?.({
        configuration,
        treeCount: count,
        ready: cache.size === wanted.length,
        nearbyReady: wanted.filter((patch) => patch.band <= 1).every((patch) => cache.has(patch.key)),
        totalPatches: wanted.length,
        reusedPatches,
        nearTreeCount: nearCount,
        patchCount,
        coverageMeters: farRadiusMeters,
        inventoryStandCount: inventory?.length ?? 0,
        detailTreeCount: detailCount,
        trianglesPerTree: count ? Math.ceil(triangles / count) : 0,
        error: wrapper.error ?? terrainMessage ?? null,
      })
      map.triggerRepaint()
    }
    const tick = (time: number) => {
      if (disposed) return
      const eye = eyeRef.current
      // Keep a preloaded guard outside the visible bands before moving the
      // membership anchor. Existing foreground stems never change representation.
      // The detail ring follows the eye more closely than the patch bands do.
      if (eye && detailLayers.length > 0 && haversineMeters(detailEye, eye) > 10) {
        detailEye = eye
        refreshDetail(nearestTrees)
      }
      if (eye && haversineMeters(lastEye, eye) > 75) {
        lastEye = eye
        wanted = forestPatches(eye, bands, anchorLatitude)
        const keys = new Set(wanted.map((patch) => patch.key))
        for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key)
        dirty = true
      }
      const start = performance.now()
      for (const patch of wanted) {
        if (cache.has(patch.key)) continue
        cache.set(
          patch.key,
          growForestPatch(
            patch,
            bands[patch.band],
            { stands, clearings, openings, thinnings, inventory, heightMeters: standHeightMeters },
            elevation,
            anchorLatitude,
          ),
        )
        if (debrisLayer && bands[patch.band].near < DEBRIS_REACH_METERS) {
          debrisCache.set(
            patch.key,
            placeDebris(openings!, patch.bounds, 12, patch.band + 1).flatMap((pile) => {
              const height = elevation.elevationAt(pile.lng, pile.lat)
              return Number.isFinite(height) ? [{ ...pile, elevationMeters: height }] : []
            }),
          )
        }
        dirty = true
        if (performance.now() - start > 5) break
      }
      if (dirty && time - lastUpload > 250) {
        upload()
        dirty = false
        lastUpload = time
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      if (settleTimer) clearTimeout(settleTimer)
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      } catch {
        // The map was removed first: React runs a removed tree's cleanups parent first.
      }
      statusRef.current?.({ configuration, treeCount: 0, trianglesPerTree: 0, error: null, ready: false })
      // Keep this configuration's CPU placements for reopening; GPU layers are released.
    }
  }, [
    active,
    configuration,
    patches,
    atlas,
    clumpAtlas,
    sceneLatitude,
    isLoaded,
    map,
    elevation,
    terrainMessage,
    stands,
    clearings,
    openings,
    thinnings,
    inventory,
    standHeightMeters,
    style,
    look,
    detailRadiusMeters,
    farRadiusMeters,
  ])
  return null
}
