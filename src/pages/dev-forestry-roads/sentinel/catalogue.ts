/**
 * When a pan needs a new scene search, and which listed scenes still apply to a new window.
 * DOM-free and network-free.
 */
import type { LonLatBounds, SentinelScene } from '@/lib/sentinel2/stac'

export const boundsContain = (outer: LonLatBounds | null, inner: LonLatBounds) =>
  !!outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]

export const boundsIntersect = (a: LonLatBounds | null, b: LonLatBounds) =>
  !!a && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/** One search's answer: the window it was asked for, in which UTM zone and date range, and its scenes. */
export type SceneCatalogue = {
  searched: LonLatBounds
  epsg: number
  /** The date range's key (`recent` or a year). */
  range: string
  scenes: readonly SentinelScene[]
}

/**
 * True when the scenes a search listed still serve `window`, so a pan needs no new search: the same
 * date range and UTM zone, and every listed tile whose footprint held the searched window still
 * holds the new one (when none held it, the new window must lie inside the searched one). A tile
 * that held the old window but not the new one may have a neighbour that does, so that pan searches.
 */
export function catalogueServes(
  catalogue: SceneCatalogue | null,
  window: LonLatBounds,
  epsg: number,
  range: string,
): boolean {
  if (!catalogue || catalogue.range !== range || catalogue.epsg !== epsg || !catalogue.scenes.length) return false
  const holders = catalogue.scenes.filter((scene) => boundsContain(scene.bbox, catalogue.searched))
  return holders.length
    ? holders.every((scene) => boundsContain(scene.bbox, window))
    : boundsContain(catalogue.searched, window)
}

/** A scene can be read over `window` when its footprint reaches it (or the item gave none). */
export const sceneReaches = (scene: Pick<SentinelScene, 'bbox'>, window: LonLatBounds) =>
  !scene.bbox || boundsIntersect(scene.bbox, window)
