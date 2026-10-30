import { describe, expect, it } from 'vitest'
import { previewCamera } from './previewCamera'

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
                  pan: { x: 0, y: 0 },
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

  it('preserves manual zoom and pan after the initial fit', () => {
    const options = {
      bounds: [-120, -120, 120, 120],
      low: 700,
      high: 967.5,
      target: [0, 0],
      targetZ: 967.5,
      angle: 0.49,
      tilt: 0.73,
      exaggeration: 1,
      width: 320,
      height: 220,
      zoom: 1,
      pan: { x: 0, y: 0 },
    }
    const vertex = { x: 30, y: 60, z: 700 }
    const initial = previewCamera(options).project(vertex)
    const changed = previewCamera({ ...options, zoom: 2, pan: { x: 15, y: -10 } }).project(vertex)
    expect(changed.x).toBeCloseTo(160 + (initial.x - 160) * 2 + 15)
    expect(changed.y).toBeCloseTo(110 + (initial.y - 110) * 2 - 10)
    expect(changed.depth).toBe(initial.depth)
  })
})
