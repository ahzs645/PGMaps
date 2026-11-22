import { describe, expect, it } from 'vitest'
import {
  capturePixelRatio,
  demZoomAt,
  MAX_CAPTURE_PIXEL_RATIO,
  SETTLE_LIMITS,
  settleFailure,
  settleGivenUp,
} from './mapCapture'

describe('waiting for a framed view to settle', () => {
  const at = (now: number, lastTileAt: number | null) => settleGivenUp({ now, startedAt: 0, lastTileAt })
  it('waits at least the old 45 s, then while tiles keep loading, up to its cap', () => {
    expect(at(44_000, null)).toBeNull()
    // No tile at all: given up once past the least wait.
    expect(at(46_000, null)).toBe('stalled')
    // Tiles still arriving every few seconds: waited for well past 45 s.
    expect(at(120_000, 110_000)).toBeNull()
    expect(at(131_000, 110_000)).toBe('stalled')
    expect(at(SETTLE_LIMITS.maxMs + 1, SETTLE_LIMITS.maxMs)).toBe('too long')
  })
  it('says what did not draw, and that its tiles were still loading', () => {
    expect(settleFailure('The framed view', 'stalled')).toBe(
      'The framed view did not finish drawing: no tile loaded for 20 s (its tiles were still loading).',
    )
    expect(settleFailure('The framed view', 'too long')).toBe(
      'The framed view did not finish drawing within 180 s (its tiles were still loading).',
    )
  })
})

describe('the framed capture’s pixel ratio', () => {
  it('draws each frame’s window at the frame’s own width, within the cap', () => {
    // One frame 2400 px wide from a 1100 px canvas whose window is 94% of it: 2.32×, drawn at 2.5×.
    expect(capturePixelRatio({ frameWidth: 2400, clientWidth: 1100, cropWidth: 0.94, current: 1 })).toBe(2.5)
    // A 515 px canvas would want 4.7×; the cap holds it to 3.
    expect(capturePixelRatio({ frameWidth: 2400, clientWidth: 515, cropWidth: 1, current: 1 })).toBe(
      MAX_CAPTURE_PIXEL_RATIO,
    )
    // Never below the map's own ratio.
    expect(capturePixelRatio({ frameWidth: 600, clientWidth: 1100, cropWidth: 1, current: 2 })).toBe(2)
  })
})

describe('the DEM detail the map draws a point from', () => {
  // Argenta Beach, 2.6 km out on the line to block 3: inside z11 terrain tile (358, 692).
  const point = [-116.93, 50.19] as const
  const terrain = { deltaZoom: 1, minzoom: 0, maxzoom: 14 }
  it('is the covering terrain tile less deltaZoom, within the source range', () => {
    const tiles = [
      { z: 9, x: 89, y: 173, overscaledZ: 9 },
      { z: 11, x: 358, y: 692, overscaledZ: 11 },
    ]
    expect(demZoomAt(tiles, point[0], point[1], terrain)).toBe(10)
    // An overscaled tile past the source's range reads the source's last zoom.
    expect(demZoomAt([{ z: 11, x: 358, y: 692, overscaledZ: 17 }], point[0], point[1], terrain)).toBe(14)
  })
  it('is null where no drawn tile covers the point', () => {
    expect(demZoomAt([{ z: 11, x: 359, y: 692, overscaledZ: 11 }], point[0], point[1], terrain)).toBeNull()
    expect(demZoomAt([], point[0], point[1], terrain)).toBeNull()
  })
})
