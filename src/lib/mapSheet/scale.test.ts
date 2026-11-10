import { describe, expect, it } from 'vitest'
import {
  fitScale,
  formatDms,
  formatScale,
  frameProjection,
  graticuleTicks,
  metresPerPoint,
  scaleBar,
  zoomForScale,
} from './scale'

const frame = { x: 28.8, y: 50, w: 872, h: 720 }

describe('sheet scale', () => {
  it('gives a 28.35 pt (1 cm) segment of 100 m at 1:10,000', () => {
    const bar = scaleBar(10000, 220)
    expect(bar.segmentM).toBe(100)
    expect(bar.segmentPt).toBeCloseTo(28.35, 2)
    expect(bar.labels.slice(0, 3).map((label) => label.value)).toEqual([100, 50, 0])
  })

  it('labels a 1:50,000 bar 500 250 0 500 1,000 1,500', () => {
    const bar = scaleBar(50000, 4 * 28.35)
    expect(bar.labels.map((label) => label.value)).toEqual([500, 250, 0, 500, 1000, 1500])
  })

  it('keeps the stated scale at the frame centre', () => {
    const projection = frameProjection(frame, [-121.5, 54.06], 10000)
    const [west, , east] = projection.bounds
    // Ground width across the centre: frame width in metres at 1:10,000.
    const groundM = (east - west) * 111_319.49 * Math.cos((54.06 * Math.PI) / 180)
    expect(groundM).toBeCloseTo(frame.w * metresPerPoint(10000), -1)
    const [x, y] = projection.project(-121.5, 54.06)
    expect(x).toBeCloseTo(frame.x + frame.w / 2, 6)
    expect(y).toBeCloseTo(frame.y + frame.h / 2, 6)
    const back = projection.unproject(x, y)
    expect(back[0]).toBeCloseTo(-121.5, 9)
    expect(back[1]).toBeCloseTo(54.06, 9)
  })

  it('round-trips MapLibre zoom with metres per CSS pixel at 54°N', () => {
    const zoom = zoomForScale(10000, 54)
    const metresPerCssPixel = (40075016.686 * Math.cos((54 * Math.PI) / 180)) / (512 * 2 ** zoom)
    expect(metresPerCssPixel).toBeCloseTo((10000 * 0.0254) / 96, 6)
  })

  it('fits a box at the smallest listed scale that holds it', () => {
    expect(fitScale([-121.51, 54.055, -121.49, 54.065], frame)).toBe(7500)
    expect(fitScale([-123, 53, -120, 56], frame)).toBe(250000)
  })

  it('formats DMS and graticule ticks', () => {
    expect(formatDms(-121.541666667, 'lng')).toBe('121°32\'30"W')
    expect(formatDms(54.066666667, 'lat')).toBe('54°4\'0"N')
    const ticks = graticuleTicks(-121.56, -121.5, 6)
    expect(ticks.intervalSec).toBe(60)
    expect(formatScale(50000)).toBe('1:50,000')
  })
})
