/** Which scenes the Sentinel-2 layer picks by default. DOM-free. */
import { SENTINEL_MIN_CLEAR_SHARE, SENTINEL_MIN_COVERAGE } from './limits'
import type { SentinelScene } from './stac'
import type { ClearShare } from './window'

export type RatedScene = SentinelScene & {
  /** Clear share over the terrain window; undefined while rating, null when the read failed. */
  rating?: ClearShare | null
}

export const isUsable = (scene: RatedScene) =>
  !!scene.rating && scene.rating.clear >= SENTINEL_MIN_CLEAR_SHARE && scene.rating.coverage >= SENTINEL_MIN_COVERAGE

/** The newest scene clear and complete over the window, else the one with the most clear ground. */
export function defaultScene(scenes: readonly RatedScene[]): RatedScene | undefined {
  const usable = scenes.find(isUsable)
  if (usable) return usable
  let best: RatedScene | undefined,
    bestScore = 0
  for (const scene of scenes) {
    const score = scene.rating ? scene.rating.clear * scene.rating.coverage : 0
    if (score > bestScore) [best, bestScore] = [scene, score]
  }
  return best
}

/** Default change pair: the oldest and newest usable scenes (else the oldest and newest listed). */
export function defaultPair(scenes: readonly RatedScene[]): [RatedScene, RatedScene] | null {
  const usable = scenes.filter(isUsable)
  const pool = usable.length >= 2 ? usable : scenes
  if (pool.length < 2) return null
  const sorted = [...pool].sort((a, b) => a.datetime.localeCompare(b.datetime))
  return [sorted[0], sorted[sorted.length - 1]]
}
