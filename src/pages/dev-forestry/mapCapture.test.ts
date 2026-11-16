import { describe, expect, it } from 'vitest'
import { capturePixelRatio, demZoomAt, MAX_CAPTURE_PIXEL_RATIO } from './mapCapture'

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
