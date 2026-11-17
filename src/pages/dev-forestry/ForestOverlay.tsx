/** Stable geographic forest tiles, grown progressively against a fixed DEM. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import {
  TREE_DRAWING_IDS,
  coniferMesh,
  treeDrawing,
  viewingGapToward,
  type InventoryStand,
  type Thinning,
  type TreeInstance,
} from './forest'
import { TREE_DRAWINGS, buildImpostorAtlas, drawingPalette } from './impostor'
import {
  BAKED_VARIANTS,
  bakeClumpAtlas,
  bakeImpostorAtlasInSteps,
  bakedImpostorAtlas,
  bakedTreeMesh,
} from './impostorBake'
import { FIXED_TREE_SUN, createTreeLayer, type TreeLook, type TreeStyle } from './treeLayer'
import { detailedCrownBase } from './treeGeometry'
import { SHADOW_REACH_METERS, createTreeShadowLayer } from './treeShadows'
import { debrisMesh, felledTreeMesh, logMesh, placeDebris, snagMesh, stumpMesh } from './harvestedGround'
import type { TreatedStemKind } from './stand/prescribedCells'

/**
 * Canopy tiles begin this far from the eye and are fully drawn by the second distance, metres.
 * Nearer than that the standing cards close a stand by themselves and a tile would read as a
 * plate; farther, the rows of cards open up and the hillside between them showed floor.
 */
const CANOPY_TILE_FADE: [number, number] = [900, 1800]
/**
 * How far a far card runs on below its stem's foot, metres. MapLibre draws distant ground from
 * coarser elevation than the stems are stood on: a summit 3.6 km off was drawn about 30 m lower
 * than its trees' feet (Purden Lake, November 2026), which left a row of them in the sky.
 */
const FAR_CARD_SKIRT_METERS = 45

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
import { canopyRange, canopyTileMeters, forestBands, forestPatches, growForestPatch, isFarBand } from './forestPatches'
import { haversineMeters, type PolygonGeometry } from './visibility'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'

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
  /**
   * What stand prescriptions leave of each tree they take (`stand/prescribedCells.ts`, `treatedStems`):
   * stumps, felled trees and logs, drawn near the eye like slash. Display only.
   */
  treated?: Record<TreatedStemKind, TreeInstance[]> | null
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
  /**
   * Where the trees' light comes from: a unit vector in the mercator frame (x east, y south, z up).
   * Null or absent is the page's fixed late-morning light. Read each frame, so changing the hour
   * never regrows the stand. Display only: light changes no pixel a tree covers.
   */
  sun?: readonly [number, number, number] | null
  /**
   * The nearest stems lay a shadow on the ground, away from the light (`treeShadows.ts`). Read each
   * frame. Display only: a shadow is drawn before the trees and covers no part of one.
   */
  shadows?: boolean
  onStatus?: (status: ForestStatus) => void
  /**
   * Placed patches kept by the caller, so an overlay remounted with its map (the road view's map
   * mounts only while it is open) reuses the stand it already placed. Make a new one whenever
   * `configuration` changes; without it the overlay keeps its own.
   */
  patches?: Map<string, TreeInstance[]>
}
const LAYER_ID = 'forestry-trees'
/** How often a whole stand looks at the eye again, ms: no frame is asked for while nothing moves. */
const FOREST_IDLE_POLL_MS = 200

export function ForestOverlay(props: ForestOverlayProps) {
  const { map, isLoaded } = useMap()
  const eyeRef = useRef(props.centre)
  const statusRef = useRef(props.onStatus)
  eyeRef.current = props.centre
  // Read each frame, so the gap follows the eye without regrowing the stand.
  const gapTargetRef = useRef(props.gapTarget ?? null)
  gapTargetRef.current = props.gapTarget ?? null
  const sunRef = useRef(props.sun ?? null)
  sunRef.current = props.sun ?? null
  const shadowsRef = useRef(props.shadows ?? false)
  shadowsRef.current = props.shadows ?? false
  statusRef.current = props.onStatus
  const { active, configuration, terrainMessage } = props
  // The stand is grown round the eye, so it starts once there is one. Without this in the effect's dependencies, a
  // road view that opened before its camera was placed (a view of interest's capture standing at a new place) never
  // grew a stand: its status stayed "not ready" and the capture timed out after two minutes waiting for timber.
  const hasEye = !!props.centre
  const {
    anchorLatitude: sceneLatitude,
    stands,
    clearings,
    openings,
    thinnings,
    treated,
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
  // The baked cards take about two seconds to make the first time, a drawing at a time between
  // frames; until they are ready the stand is drawn from the silhouettes, then drawn again.
  const [bakedTrees, setBakedTrees] = useState(bakedImpostorAtlas)
  useEffect(() => {
    if (style !== 'baked' || bakedTrees) return
    let cancelled = false
    void bakeImpostorAtlasInSteps(() => new Promise((resolve) => setTimeout(resolve, 0))).then((made) => {
      if (!cancelled) setBakedTrees(made)
    })
    return () => {
      cancelled = true
    }
  }, [style, bakedTrees])
  const baked = style === 'baked' && !!bakedTrees
  const atlas = useMemo(
    () => (baked ? (bakedTrees ?? undefined) : style !== 'solid' ? buildImpostorAtlas() : undefined),
    [style, baked, bakedTrees],
  )
  const clumpAtlas = useMemo(
    () => (baked ? bakeClumpAtlas() : style !== 'solid' ? buildImpostorAtlas(128, 'clump') : undefined),
    [style, baked],
  )
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
    const clumpBand = (i: number) => isFarBand(bands[i])
    const distantLayers = bands.map((_, i) =>
      createTreeLayer(`${LAYER_ID}-${i}`, {
        style: style === 'solid' ? 'solid' : 'billboard',
        atlas: clumpBand(i) ? clumpAtlas : atlas,
        clumps: style !== 'solid' && clumpBand(i),
        mesh: style === 'solid' ? coniferMesh() : undefined,
        // Single-tree cards know the crown base they were made with: a drawn one its silhouette's, a
        // baked one its mesh's. Clumps and the plain cone do not.
        crownBaseOf:
          style !== 'solid' && !clumpBand(i)
            ? (drawing) => (baked ? detailedCrownBase(drawing) : TREE_DRAWINGS[drawing].crownBase)
            : undefined,
        // A baked card is the tree from where the eye stands: one card, facing it. A drawn
        // silhouette is one face, so near stems stand as crossed planes instead.
        crossedCards: baked
          ? undefined
          : i === 0
            ? style === 'hybrid' || style === 'baked'
              ? 3
              : 2
            : i === 1
              ? 2
              : undefined,
        range: canopyRange(bands, i),
        look,
        // A far stem stands for many: it also lays its canopy over its own ground, is lit by the
        // hill it stands on, and runs on below its foot.
        ...(style !== 'solid' && clumpBand(i)
          ? {
              canopyTileMeters: canopyTileMeters(bands[i]),
              tileFade: CANOPY_TILE_FADE,
              skirtMeters: FAR_CARD_SKIRT_METERS,
              hillLight: true,
            }
          : {}),
      }),
    )
    // One representation for every foreground stem while the view moves.
    // Held still, the stems nearest the eye are drawn again as detailed meshes
    // — the same stems, at the same positions, heights and crown widths — and
    // the cards step back from that ring. A second representation only near
    // the eye once changed the stand's shape; this one replaces like for like,
    // and only for the still frame.
    // One mesh for each drawing and variant: the tree a baked card is taken from, so the stem
    // that stops is the stem that was moving. Foliage as cut-out boughs, coloured as its card is.
    const detailKinds =
      detailRadiusMeters > 0 && style !== 'solid'
        ? TREE_DRAWING_IDS.flatMap((drawing) =>
            Array.from({ length: BAKED_VARIANTS }, (_, variant) => ({ drawing, variant })),
          )
        : []
    const detailLayers = detailKinds.map(({ drawing, variant }) =>
      createTreeLayer(`${LAYER_ID}-detail-${drawing}-${variant}`, {
        style: 'solid',
        mesh: bakedTreeMesh(drawing, variant),
        palette: drawingPalette(drawing),
        crownBaseOf: detailedCrownBase,
        range: [-2, -1, detailRadiusMeters - DETAIL_BLEND_METERS, detailRadiusMeters + 0.01],
        look,
      }),
    )
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
    // A prescription's stumps, felled trees and logs: placed once, they do not follow the eye's patches.
    const treatedLayers = treated
      ? (
          [
            ['stump', stumpMesh(), false],
            ['felled', felledTreeMesh(), true],
            ['log', logMesh(), true],
            ['snag', snagMesh(), false],
          ] as const
        ).flatMap(([kind, mesh, headings]) => {
          const stems = treated[kind].flatMap((stem) => {
            const height = elevation.elevationAt(stem.lng, stem.lat)
            return Number.isFinite(height) ? [{ ...stem, elevationMeters: height }] : []
          })
          if (stems.length === 0) return []
          const layer = createTreeLayer(`${LAYER_ID}-treated-${kind}`, {
            style: 'solid',
            mesh,
            headings,
            range: [-2, -1, DEBRIS_REACH_METERS - 50, DEBRIS_REACH_METERS],
            look,
          })
          layer.setTrees(stems)
          return [layer]
        })
      : []
    const layers = [...distantLayers, ...(debrisLayer ? [debrisLayer] : []), ...treatedLayers, ...detailLayers]
    const shadowLayer = createTreeShadowLayer()
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
      onAdd: (host: unknown, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
        layers.forEach((layer) => layer.onAdd(host, gl))
        shadowLayer.onAdd(host, gl)
      },
      onRemove: () => {
        layers.forEach((layer) => layer.onRemove())
        shadowLayer.onRemove()
      },
      render: (
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        args: Parameters<(typeof layers)[0]['render']>[1],
      ) => {
        const eye = eyeRef.current
        if (eye) {
          for (const layer of layers) layer.setSun(sunRef.current)
          // Shadows first: they lie on the ground, and every stem is drawn over them.
          if (shadowsRef.current) {
            shadowLayer.setEye(eye)
            shadowLayer.render(gl, args)
          }
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
          // The eye's own height, for the canopy tiles: seen from a hill above, a stand opens up.
          const eyeGround = elevation.elevationAt(eye.lng, eye.lat)
          const placedEye = Number.isFinite(eyeGround) ? { ...eye, altitudeMeters: eyeGround + 1.6 } : eye
          for (const layer of distantLayers) {
            layer.setEye(placedEye)
            layer.setGap(gap)
            layer.setNearCut(still ? detailRadiusMeters - DETAIL_BLEND_METERS : 0)
            layer.render(gl, args)
          }
          if (debrisLayer) {
            debrisLayer.setEye(eye)
            debrisLayer.render(gl, args)
          }
          for (const layer of treatedLayers) {
            layer.setEye(eye)
            layer.render(gl, args)
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
      /** True once the stand is drawn from cards baked off the detailed meshes, not the silhouettes. */
      get bakedCards() {
        return baked
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
      detailKinds.forEach(({ drawing, variant }, index) =>
        detailLayers[index].setTrees(
          within.filter(
            (tree) => treeDrawing(tree.species, tree.form) === drawing && tree.variant % BAKED_VARIANTS === variant,
          ),
        ),
      )
    }
    let nearestTrees: TreeInstance[] = []
    // The stems near enough to lay a shadow, laid again when the eye has moved or the light has.
    let shadowKey = ''
    const refreshShadows = (nearest: TreeInstance[]) => {
      if (!shadowsRef.current) return
      const sun = sunRef.current ?? FIXED_TREE_SUN
      // A stem the viewing gap leaves undrawn lays no shadow either: a wedge of bare ground under
      // the shadows of the trees taken out of it was a black band across the foreground.
      const target = gapTargetRef.current
      const gap = target ? viewingGapToward(detailEye, target) : null
      const gapCos = gap ? Math.cos((gap.halfAngleDegrees * Math.PI) / 180) : 1
      const gapBearing = gap ? (gap.bearingDegrees * Math.PI) / 180 : 0
      const eastPerDegree = 111_320 * Math.cos((detailEye.lat * Math.PI) / 180)
      const within = nearest.filter((tree) => {
        const east = (tree.lng - detailEye.lng) * eastPerDegree
        const north = (tree.lat - detailEye.lat) * 111_320
        const metres = Math.hypot(east, north)
        if (metres >= SHADOW_REACH_METERS) return false
        if (!gap || metres > gap.lengthMeters || metres < 0.5) return true
        return (east * Math.sin(gapBearing) + north * Math.cos(gapBearing)) / metres <= gapCos
      })
      const key = `${within.length}:${detailEye.lng.toFixed(5)},${detailEye.lat.toFixed(5)}:${sun.join(',')}:${gap ? `${gap.bearingDegrees.toFixed(1)},${gap.lengthMeters.toFixed(0)}` : ''}`
      if (key === shadowKey) return
      shadowKey = key
      shadowLayer.setTrees(within, sun, elevation)
    }
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
      refreshShadows(nearestTrees)
      const close = grouped[0].filter((tree) => haversineMeters(lastEye, tree) < 180)
      nearCount = style === 'hybrid' || style === 'baked' ? close.length : 0
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
      if (eye && haversineMeters(detailEye, eye) > 10) {
        detailEye = eye
        refreshDetail(nearestTrees)
      }
      // Its own key says whether anything changed: the eye, the light, or shadows switched on.
      refreshShadows(nearestTrees)
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
      // Every frame only while there is work: a stand still growing or an upload waiting. Once the stand is whole the
      // eye is looked at a few times a second, so a still road view stops asking the page for frames (it drew about
      // 120 a second while an export waited, competing with the export's own captures).
      if (dirty || wanted.some((patch) => !cache.has(patch.key))) frame = requestAnimationFrame(tick)
      else
        idleTimer = window.setTimeout(() => {
          idleTimer = 0
          if (!disposed) frame = requestAnimationFrame(tick)
        }, FOREST_IDLE_POLL_MS)
    }
    let idleTimer = 0
    frame = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      if (idleTimer) clearTimeout(idleTimer)
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
    hasEye,
    configuration,
    patches,
    atlas,
    clumpAtlas,
    baked,
    sceneLatitude,
    isLoaded,
    map,
    elevation,
    terrainMessage,
    stands,
    clearings,
    openings,
    thinnings,
    treated,
    inventory,
    standHeightMeters,
    style,
    look,
    detailRadiusMeters,
    farRadiusMeters,
  ])
  return null
}
