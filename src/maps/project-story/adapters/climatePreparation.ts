import { sameStoryCamera, type ResolvedLayer } from '../storyScene'
import type { ClimateTile } from './climateStore'

export type ClimateFrame = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  width: number
  height: number
}

/** A single consumable staging slot, separate from the bounded transport LRU.
 * Never show a prepared scene for a different selection, pane or camera.
 */
export class ClimatePreparation {
  private next?: { selection: string; frame: ClimateFrame; tiles: ClimateTile[] }

  clear() {
    this.next = undefined
  }

  set(layers: ResolvedLayer[], frame: ClimateFrame, tiles: ClimateTile[]) {
    this.next = tiles.length ? { selection: JSON.stringify(layers), frame, tiles } : undefined
  }

  take(layers: ResolvedLayer[], frame: ClimateFrame) {
    const next = this.next
    this.clear()
    return next &&
      next.selection === JSON.stringify(layers) &&
      next.frame.width === frame.width &&
      next.frame.height === frame.height &&
      sameStoryCamera(next.frame, frame)
      ? next.tiles
      : undefined
  }
}
