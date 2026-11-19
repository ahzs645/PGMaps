/**
 * The layers laid on a photo for a camera, made in the photo worker (`layPhotoFeatures`) a layer at a time and kept by
 * camera and layer, so nothing is laid twice: a camera looked at before, or one more layer switched on, costs only
 * what is new. Laid on the page's thread, a layer of roads or stands held every change of camera for a few tenths of
 * a second.
 *
 * `ahead` are cameras the reviewer may take next (the options card's): once the camera in use has its layers, the same
 * layers are laid for each of them in turn, so *Use* finds them ready.
 *
 * Shared by every mount (the window and the docked pane draw the same photo). `docs/forestry-visual-quality.md`,
 * "A photo of your own", *Off the page's thread*.
 */
import { useEffect, useMemo, useState } from 'react'

import { PhotoCache } from './photoCache'
import type { PhotoFeature } from './photoOverlay'
import type { DrawnFeature } from './photoOverlayDraw'
import type { PhotoPose } from './photoPose'
import { layPhotoFeatures, type PhotoTerrainSpec } from './photoWorkClient'

/** A camera to lay layers for: its pose, the terrain round it, and `photoPoseKey(pose)`. */
export type LaidCamera = { key: string; pose: PhotoPose; terrain: PhotoTerrainSpec }

// A few hundred kilobytes of path data a camera with every layer on: room for a flight's worth of cameras.
const laid = new PhotoCache<DrawnFeature[]>({ maxEntries: 400, sizeOf: () => 0 })

/**
 * Names a layer's features by what they are, not by the list that holds them: the list is made again whenever anything
 * round it changes (the ground a camera sees, a read arriving), and named by the list a camera's layers were laid
 * again at every change of camera, and what was laid ahead was never found. The count, each feature's shape and size
 * and its first and last vertices, hashed: two different sets of a layer's features sharing all of that is not a
 * case worth the cost of reading every vertex at each render.
 */
export function layerSignature(features: readonly PhotoFeature[]): string {
  let hash = 2166136261
  const mix = (value: number) => {
    hash ^= value | 0
    hash = Math.imul(hash, 16777619)
  }
  const ends = (coordinates: unknown, depth = 0): void => {
    if (!Array.isArray(coordinates) || !coordinates.length) return
    if (typeof coordinates[0] === 'number') {
      mix(Math.round((coordinates[0] as number) * 1e6))
      mix(Math.round((coordinates[1] as number) * 1e6))
      return
    }
    mix(coordinates.length + depth * 31)
    ends(coordinates[0], depth + 1)
    ends(coordinates[coordinates.length - 1], depth + 1)
  }
  for (const feature of features) {
    const geometry = feature.geometry
    mix(geometry.type.length)
    if (geometry.type === 'GeometryCollection') mix(geometry.geometries.length)
    else ends(geometry.coordinates)
  }
  return `${features.length}:${(hash >>> 0).toString(36)}`
}

export function usePhotoLaidLayers({
  camera,
  features,
  layers,
  ahead,
  idle = false,
}: {
  /** The camera in use; null until the photo has a place and terrain. */
  camera: LaidCamera | null
  /** Every feature that could be drawn, each under its layer. The same list while nothing was read again. */
  features: readonly PhotoFeature[]
  /** The layers switched on, in drawing order. */
  layers: readonly string[]
  ahead?: readonly LaidCamera[]
  /** Nothing is laid while the photo is not shown. */
  idle?: boolean
}): {
  /** What is laid so far for the camera in use, in `layers`' order. */
  drawn: DrawnFeature[]
  /** Every layer switched on is laid for the camera in use. */
  complete: boolean
} {
  const byLayer = useMemo(() => {
    const grouped = new Map<string, PhotoFeature[]>()
    for (const feature of features) {
      const list = grouped.get(feature.layer)
      if (list) list.push(feature)
      else grouped.set(feature.layer, [feature])
    }
    // Each layer under its name and what it holds (`layerSignature`): the key it is laid, kept and sent by.
    return new Map([...grouped].map(([layer, list]) => [layer, { key: `${layer}:${layerSignature(list)}`, list }]))
  }, [features])
  const wanted = useMemo(() => layers.flatMap((layer) => byLayer.get(layer) ?? []), [layers, byLayer])
  const wantedKey = wanted.map((layer) => layer.key).join('|')
  const aheadKey = (ahead ?? []).map((entry) => entry.key).join('|')
  const cameraKey = camera?.key ?? null
  const [arrived, setArrived] = useState(0)

  useEffect(() => {
    if (idle || !camera || !wanted.length) return
    const controller = new AbortController()
    type Layer = (typeof wanted)[number]
    const entry = (at: LaidCamera, layer: Layer) => `${at.key}|${layer.key}`
    const lay = (at: LaidCamera, layer: Layer) =>
      laid
        .getOrCreate(
          entry(at, layer),
          async (shared) => {
            const paths = await layPhotoFeatures(
              { pose: at.pose, terrain: at.terrain, features: { key: layer.key, value: layer.list } },
              shared,
            )
            return paths.map((path, i) => ({ paths: path, properties: layer.list[i].properties }))
          },
          controller.signal,
        )
        .catch(() => {
          // The terrain did not load, or the worker stopped: the layer is left off this camera rather than waited
          // for without end. Another camera, or the layer switched off and on, tries again.
          if (!controller.signal.aborted) laid.set(entry(at, layer), [])
        })
    void (async () => {
      await Promise.all(
        wanted
          .filter((layer) => !laid.peek(entry(camera, layer)))
          .map((layer) =>
            lay(camera, layer).then(() => {
              if (!controller.signal.aborted) setArrived((count) => count + 1)
            }),
          ),
      )
      // A camera's layers go together: they share its cast in the worker.
      for (const next of ahead ?? []) {
        if (controller.signal.aborted) return
        if (next.key !== camera.key)
          await Promise.all(wanted.filter((layer) => !laid.peek(entry(next, layer))).map((layer) => lay(next, layer)))
      }
    })()
    return () => controller.abort()
    // The camera, the layers and the cameras ahead are named by their keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, cameraKey, wantedKey, aheadKey])

  return useMemo(() => {
    if (!cameraKey || idle) return { drawn: [], complete: false }
    const parts = wanted.map((layer) => laid.get(`${cameraKey}|${layer.key}`))
    return { drawn: parts.flatMap((part) => part ?? []), complete: parts.every(Boolean) }
    // `arrived` counts the layers that have come since: the cache itself tells React nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, cameraKey, wantedKey, arrived])
}
