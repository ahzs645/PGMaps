import { describe, expect, it } from 'vitest'
import {
  autoPreviewExaggeration,
  focusHoldingPoint,
  focusOnGround,
  groundUnder,
  pixelsPerMetreAtFocus,
  previewCamera,
  previewDetailWindow,
  scaleBarLength,
} from './previewCamera'

describe('3D terrain and design camera fit', () => {
  it('fits high fills, deep cuts and steep profiles at mobile/desktop sizes and all view angles', () => {
    const bounds = [-120, -120, 120, 120]
    for (const [width, height] of [
      [320, 220],
      [1120, 640],
    ])
      for (const [low, high] of [
        [700, 967.5],
        [-1000, 700],
        [700, 9000],
        [700, 700],
      ])
        for (const targetZ of [(low + high) / 2, high])
          for (const angle of [0, 0.49, 1.5, 3.8])
            for (const tilt of [0.26, 0.73, 1.39])
              for (const exaggeration of [1, 2, 4]) {
                const camera = previewCamera({
                  bounds,
                  low,
                  high,
                  target: [0, 0],
                  targetZ,
                  angle,
                  tilt,
                  exaggeration,
                  width,
                  height,
                  zoom: 1,
                })
                for (const x of [-120, 0, 120])
                  for (const y of [-120, 0, 120])
                    for (const z of [low, (low + high) / 2, high]) {
                      const point = camera.project({ x, y, z })
                      expect(Number.isFinite(point.depth)).toBe(true)
                      expect(camera.cameraDistance + point.depth).toBeGreaterThan(0)
                      expect(point.x).toBeGreaterThanOrEqual(12 - 1e-8)
                      expect(point.x).toBeLessThanOrEqual(width - 12 + 1e-8)
                      expect(point.y).toBeGreaterThanOrEqual(12 - 1e-8)
                      expect(point.y).toBeLessThanOrEqual(height - 12 + 1e-8)
                    }
              }
  })

  const options = {
    bounds: [-120, -120, 120, 120],
    low: 700,
    high: 967.5,
    target: [0, 0],
    targetZ: 967.5,
    angle: 0.49,
    tilt: 0.73,
    exaggeration: 2,
    width: 320,
    height: 220,
    zoom: 1,
  }

  it('zooms about the focus, which stays at the same place on screen', () => {
    const vertex = { x: 30, y: 60, z: 700 }
    const initial = previewCamera(options)
    const zoomed = previewCamera({ ...options, zoom: 2 })
    const a = initial.project(vertex),
      b = zoomed.project(vertex)
    expect(zoomed.anchor).toEqual(initial.anchor)
    expect(b.x).toBeCloseTo(initial.anchor.x + (a.x - initial.anchor.x) * 2)
    expect(b.y).toBeCloseTo(initial.anchor.y + (a.y - initial.anchor.y) * 2)
    expect(b.depth).toBe(a.depth)
    const focus = { x: 40, y: -20, z: 800 }
    const moved = previewCamera({ ...options, focus })
    expect(moved.project(focus).x).toBeCloseTo(initial.anchor.x)
    expect(moved.project(focus).y).toBeCloseTo(initial.anchor.y)
    // A focus taken by a gesture keeps its place on screen while the view turns.
    const held = { ...focus, screen: moved.focus.screen }
    const turned = previewCamera({ ...options, focus: held, angle: 2.1, tilt: 1.2 })
    expect(turned.project(focus).x).toBeCloseTo(initial.anchor.x)
    expect(turned.project(focus).y).toBeCloseTo(initial.anchor.y)
    // Without one, the fit places it by the turned window's outline.
    expect(previewCamera({ ...options, angle: 2.1, tilt: 1.2 }).anchor.x).not.toBeCloseTo(initial.anchor.x)
  })

  it('reads back the ground at a screen point on any level plane', () => {
    for (const angle of [0, 0.49, 2.4])
      for (const tilt of [0.3, 0.73, 1.35])
        for (const focus of [null, { x: -50, y: 70, z: 760 }]) {
          const camera = previewCamera({ ...options, angle, tilt, focus, zoom: 3 })
          for (const vertex of [
            { x: 30, y: 60, z: 700 },
            { x: -110, y: 10, z: 900 },
            { x: 0, y: -100, z: 967.5 },
          ]) {
            const screen = camera.project(vertex)
            const ground = camera.unproject(screen.x, screen.y, vertex.z)!
            expect(ground.x).toBeCloseTo(vertex.x, 6)
            expect(ground.y).toBeCloseTo(vertex.y, 6)
          }
        }
    // Looking just above the horizon finds no ground.
    const low = previewCamera({ ...options, tilt: 0.26 })
    expect(low.unproject(low.anchor.x, -1e6, 700)).toBeNull()
  })

  it('zooms toward the pointer and pans with the ground under it', () => {
    const vertex = { x: 70, y: -40, z: 967.5 }
    const before = previewCamera(options)
    const pointer = before.project(vertex)
    const zoomed = previewCamera({ ...options, zoom: 2.5 })
    const focus = focusHoldingPoint(before, zoomed, pointer)!
    const after = previewCamera({ ...options, zoom: 2.5, focus })
    expect(after.project(vertex).x).toBeCloseTo(pointer.x, 6)
    expect(after.project(vertex).y).toBeCloseTo(pointer.y, 6)
    // A drag moves the focus so the grabbed ground follows the pointer.
    const to = { x: pointer.x + 37, y: pointer.y - 18 }
    const panned = focusHoldingPoint(after, after, pointer, to)!
    const dragged = previewCamera({ ...options, zoom: 2.5, focus: panned })
    expect(dragged.project(vertex).x).toBeCloseTo(to.x, 6)
    expect(dragged.project(vertex).y).toBeCloseTo(to.y, 6)
  })

  it('finds the ground under a screen point and pivots on it without changing the picture', () => {
    // A hillside rising 30 m per 100 m to the north-east.
    const elevation = (x: number, y: number) => 800 + 0.3 * x + 0.2 * y
    // A pivot 20 m above the slope, as after a pan; its line of sight meets the ground inside the window.
    const camera = previewCamera({ ...options, zoom: 3, focus: { x: 0, y: 0, z: 820 } })
    const point = { x: 140, y: 130 }
    const ground = groundUnder(camera, point, elevation)!
    expect(ground.z).toBeCloseTo(elevation(ground.x, ground.y), 1)
    const screen = camera.project(ground)
    expect(screen.x).toBeCloseTo(point.x, 3)
    expect(screen.y).toBeCloseTo(point.y, 3)
    const grounded = focusOnGround(camera, 3, elevation)!
    expect(grounded.focus.z).toBeCloseTo(elevation(grounded.focus.x, grounded.focus.y), 1)
    expect(Math.hypot(grounded.focus.x, grounded.focus.y)).toBeGreaterThan(5)
    const moved = previewCamera({ ...options, zoom: grounded.zoom, focus: grounded.focus })
    // Ground near the centre stays within a pixel; the far edge moves by the slight change of perspective.
    for (const [dx, dy] of [
      [0, 0],
      [15, -10],
      [-20, 12],
    ]) {
      const vertex = { x: grounded.focus.x + dx, y: grounded.focus.y + dy, z: 0 }
      vertex.z = elevation(vertex.x, vertex.y)
      const a = camera.project(vertex),
        b = moved.project(vertex)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1)
    }
    // Missing terrain, or ground beyond the window, leaves the focus where it is.
    expect(focusOnGround(camera, 3, () => NaN)).toBeNull()
    expect(focusOnGround(previewCamera({ ...options, zoom: 3 }), 3, elevation)).toBeNull()
  })

  it('keeps a focus outside the window inside it', () => {
    const camera = previewCamera({ ...options, focus: { x: 900, y: -900, z: 2000 } })
    expect(camera.focus).toMatchObject({ x: 120, y: -120, z: 967.5 })
  })

  it('labels the scale bar with a round length that fits', () => {
    const camera = previewCamera(options)
    const perMetre = pixelsPerMetreAtFocus(camera, options.angle)
    const bar = scaleBarLength(perMetre)!
    expect([1, 2, 5]).toContain(bar.metres / 10 ** Math.floor(Math.log10(bar.metres)))
    expect(bar.pixels).toBeLessThanOrEqual(96)
    expect(bar.pixels).toBeGreaterThan(96 / 2.5 - 1e-9)
    expect(pixelsPerMetreAtFocus(previewCamera({ ...options, zoom: 4 }), options.angle)).toBeCloseTo(perMetre * 4)
    expect(scaleBarLength(0)).toBeNull()
  })

  it('meshes a finer window around the focus only once zoomed in, snapped to the coarse cells', () => {
    const bounds = [-400, -300, 400, 300]
    expect(previewDetailWindow(bounds, 1.9, { x: 0, y: 0 }, 10)).toBeNull()
    const window = previewDetailWindow(bounds, 4, { x: 133, y: -41 }, 10)!
    expect(window.every((value) => value % 10 === 0)).toBe(true)
    expect(window[2] - window[0]).toBeLessThan(800 / 2)
    expect(window[0]).toBeLessThan(133)
    expect(window[2]).toBeGreaterThan(133)
    expect(window[1]).toBeGreaterThanOrEqual(-300)
    // A short pan inside a step keeps the same window, so the mesh is not rebuilt.
    expect(previewDetailWindow(bounds, 4, { x: 136, y: -44 }, 10)).toEqual(window)
    expect(previewDetailWindow(bounds, 8, { x: 133, y: -41 }, 10)![2]).toBeLessThan(window[2])
  })

  it('exaggerates gentle relief until it reads, and never steep relief', () => {
    expect(autoPreviewExaggeration(200, 700)).toBe(1)
    expect(autoPreviewExaggeration(40, 700)).toBe(2)
    expect(autoPreviewExaggeration(10, 700)).toBe(4)
    expect(autoPreviewExaggeration(0, 700)).toBe(1)
  })
})
