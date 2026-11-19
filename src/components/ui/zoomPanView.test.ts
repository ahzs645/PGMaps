import { describe, expect, it } from 'vitest'

import { clampView, fitBox, zoomAbout, FIT_VIEW } from './zoomPanView'

const box = { width: 600, height: 400 }

describe('zoomAbout', () => {
  it('keeps the spot under the pointer under it', () => {
    const at = { x: 450, y: 100 }
    const view = zoomAbout(FIT_VIEW, 3, at)
    // The picture point that was at `at` before is (at - offset) / scale after.
    expect((at.x - view.x) / view.scale).toBeCloseTo(450)
    expect((at.y - view.y) / view.scale).toBeCloseTo(100)
    const again = zoomAbout(view, 5, { x: 10, y: 390 })
    expect((10 - again.x) / again.scale).toBeCloseTo((10 - view.x) / view.scale)
    expect((390 - again.y) / again.scale).toBeCloseTo((390 - view.y) / view.scale)
  })

  it('holds the scale to its limits without moving the picture past them', () => {
    const top = zoomAbout(FIT_VIEW, 8, { x: 300, y: 200 }, 8)
    expect(zoomAbout(top, 20, { x: 0, y: 0 }, 8)).toEqual(top)
    expect(zoomAbout(FIT_VIEW, 0.2, { x: 100, y: 100 }, 8)).toEqual(FIT_VIEW)
  })
})

describe('clampView', () => {
  it('never leaves a gap between the picture and an edge of its box', () => {
    const dragged = clampView({ scale: 2, x: 500, y: -5000 }, box, 8)
    expect(dragged).toEqual({ scale: 2, x: 0, y: -400 })
    const within = clampView({ scale: 2, x: -250, y: -120 }, box, 8)
    expect(within).toEqual({ scale: 2, x: -250, y: -120 })
  })

  it('has one place to stand when fitted', () => {
    expect(clampView({ scale: 1, x: -40, y: 12 }, box, 8)).toBe(FIT_VIEW)
    expect(clampView({ scale: 0.4, x: 0, y: 0 }, box, 8)).toBe(FIT_VIEW)
    expect(clampView({ scale: Number.NaN, x: Number.NaN, y: 0 }, box, 8)).toBe(FIT_VIEW)
  })
})

describe('fitBox', () => {
  it('fits a picture whole, by its tighter side', () => {
    expect(fitBox(box, 4 / 3)).toEqual({ width: 400 * (4 / 3), height: 400 })
    expect(fitBox(box, 3)).toEqual({ width: 600, height: 200 })
    const portrait = fitBox(box, 3 / 4)
    expect(portrait.height).toBeCloseTo(400)
    expect(portrait.width).toBeCloseTo(300)
  })

  it('is empty until its space is measured', () => {
    expect(fitBox({ width: 0, height: 0 }, 1.5)).toEqual({ width: 0, height: 0 })
    expect(fitBox(box, 0)).toEqual({ width: 0, height: 0 })
  })
})
