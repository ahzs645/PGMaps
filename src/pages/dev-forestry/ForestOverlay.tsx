/** Stable geographic forest tiles, grown progressively against a fixed DEM. */
import { useEffect, useRef } from 'react'
import { useMap } from '@/components/ui/map'
import { coniferMesh, type InventoryStand, type TreeInstance } from './forest'
import { buildImpostorAtlas } from './impostor'
import { createTreeLayer, type TreeStyle } from './treeLayer'
import { canopyRange, forestBands, forestPatches, growForestPatch } from './forestPatches'
import { haversineMeters, type PolygonGeometry } from './visibility'
import type { ElevationSource } from './terrain'

export type ForestStatus = {
  ready?: boolean
  treeCount: number
  trianglesPerTree: number
  error: string | null
  nearTreeCount?: number
  patchCount?: number
  coverageMeters?: number
  inventoryStandCount?: number
}
export type ForestOverlayProps = {
  active: boolean
  anchorLatitude?: number
  centre: { lng: number; lat: number } | null
  stands: PolygonGeometry[]
  clearings: PolygonGeometry[]
  standHeightMeters: number
  inventory?: ReadonlyArray<InventoryStand>
  style?: TreeStyle
  farRadiusMeters?: number
  elevation: ElevationSource | null
  terrainMessage?: string | null
  onStatus?: (status: ForestStatus) => void
}
const LAYER_ID = 'forestry-trees'
export function ForestOverlay(props: ForestOverlayProps) {
  const { map, isLoaded } = useMap()
  const eyeRef = useRef(props.centre)
  const statusRef = useRef(props.onStatus)
  eyeRef.current = props.centre
  statusRef.current = props.onStatus
  const {
    active,
    anchorLatitude: sceneLatitude,
    stands,
    clearings,
    standHeightMeters,
    inventory,
    style = 'hybrid',
    farRadiusMeters = 3500,
    elevation,
    terrainMessage,
  } = props
  useEffect(() => {
    if (!active || !isLoaded || !map) return
    if (!elevation) {
      statusRef.current?.({ treeCount: 0, trianglesPerTree: 0, error: terrainMessage ?? 'Loading preview terrain…' })
      return
    }
    statusRef.current?.({ treeCount: 0, trianglesPerTree: 0, error: null, ready: false })
    const initialEye = eyeRef.current
    if (!initialEye) return
    const anchorLatitude = sceneLatitude ?? initialEye.lat
    const bands = forestBands(farRadiusMeters)
    const atlas = style !== 'solid' ? buildImpostorAtlas() : undefined
    const distantLayers = bands.map((_, i) =>
      createTreeLayer(`${LAYER_ID}-${i}`, {
        style: style === 'solid' ? 'solid' : 'billboard',
        atlas,
        mesh: style === 'solid' ? coniferMesh() : undefined,
        // Far cards represent groups of crowns, not individually inventoried stems.
        widthScale: i === 2 ? 3.5 : i === 1 ? 1.7 : 1,
        crossedCards: i === 0 ? (style === 'hybrid' ? 3 : 2) : undefined,
        range: canopyRange(bands, i),
      }),
    )
    // One representation for every foreground stem, from the horizon band to
    // the road edge. Adding a second mesh only near the eye changed its shape.
    const layers = distantLayers
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
        if (eye)
          for (const layer of layers) {
            layer.setEye(eye)
            layer.render(gl, args)
          }
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
    const cache = new Map<string, TreeInstance[]>()
    const uploadedKeys = bands.map(() => '')
    let lastEye = initialEye,
      disposed = false,
      frame = 0,
      dirty = true,
      lastUpload = -Infinity
    let wanted = forestPatches(initialEye, bands, anchorLatitude)
    const upload = () => {
      const grouped: TreeInstance[][] = bands.map(() => [])
      for (const patch of wanted) grouped[patch.band].push(...(cache.get(patch.key) ?? []))
      count = grouped.reduce((sum, group) => sum + group.length, 0)
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
      const close = grouped[0].filter((tree) => haversineMeters(lastEye, tree) < 180)
      nearCount = style === 'hybrid' ? close.length : 0
      patchCount = cache.size
      const triangles = layers.reduce((sum, layer) => sum + layer.treeCount * layer.trianglesPerTree, 0)
      statusRef.current?.({
        treeCount: count,
        ready: cache.size === wanted.length,
        nearTreeCount: nearCount,
        patchCount,
        coverageMeters: farRadiusMeters,
        inventoryStandCount: inventory?.length ?? 0,
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
            { stands, clearings, inventory, heightMeters: standHeightMeters },
            elevation,
            anchorLatitude,
          ),
        )
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
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      cache.clear()
    }
  }, [
    active,
    sceneLatitude,
    isLoaded,
    map,
    elevation,
    terrainMessage,
    stands,
    clearings,
    inventory,
    standHeightMeters,
    style,
    farRadiusMeters,
  ])
  return null
}
