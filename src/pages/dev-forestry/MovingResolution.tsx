/**
 * Draws the road view at a lower resolution while it moves, and at the screen's own once it holds
 * still.
 *
 * A high-density screen draws four pixels where a plain one draws one, and a stand is the same
 * ground drawn over many times, stem behind stem. Moving, the eye cannot use that sharpness; still,
 * it can. (octahedral-impostor's showcase caps its pixel ratio at 1.25 for the same reason; see
 * `NOTICE-OCTAHEDRAL-IMPOSTOR.md`.) Display only: a saved view or image is taken with the view
 * still, and a capture sets the ratio it needs itself (`mapCapture.ts`).
 *
 * The drive camera places itself by the canvas's size in CSS pixels (`driveController.ts`), which a
 * pixel ratio does not change, so this never moves the eye.
 */
import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'

/** Device pixels to a CSS pixel while the view moves, where the screen has more. */
export const MOVING_PIXEL_RATIO = 1.25
/** How long the view holds still before it is drawn at the screen's own resolution again, ms. */
export const SHARPEN_AFTER_MS = 350

/** The ratio a moving view is drawn at on a screen of `deviceRatio`: never above the screen's own. */
export function movingPixelRatio(deviceRatio: number): number {
  return Math.min(deviceRatio, MOVING_PIXEL_RATIO)
}

export function MovingResolution({ active }: { active: boolean }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!active || !isLoaded || !map) return
    const full = () => window.devicePixelRatio || 1
    let reduced = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const sharpen = () => {
      timer = null
      if (!reduced) return
      reduced = false
      map.setPixelRatio(full())
    }
    const moved = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(sharpen, SHARPEN_AFTER_MS)
      if (reduced || movingPixelRatio(full()) >= full()) return
      reduced = true
      map.setPixelRatio(movingPixelRatio(full()))
    }
    map.on('move', moved)
    return () => {
      map.off('move', moved)
      if (timer) clearTimeout(timer)
      if (reduced) map.setPixelRatio(full())
    }
  }, [active, isLoaded, map])
  return null
}
