import { describe, expect, it } from 'vitest'
import { capturePixelRatio, MAX_CAPTURE_PIXEL_RATIO } from './mapCapture'

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
