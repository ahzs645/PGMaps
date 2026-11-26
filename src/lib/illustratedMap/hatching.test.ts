import { describe, expect, it } from 'vitest'
import { buildHatchPaths, buildHatchSwatchSvg, DEFAULT_HATCH_OPTIONS } from './hatching'

function strokes(svg: string): string[] {
  return svg.match(/<path\b[^>]*\/>/g) ?? []
}

describe('procedural forest hatching', () => {
  it('reproduces a saved seed, and a different seed actually changes the drawing', () => {
    const first = buildHatchPaths(600, 360, { seed: 42 })
    expect(buildHatchPaths(600, 360, { seed: 42 })).toBe(first)
    expect(buildHatchPaths(600, 360, { seed: 43 })).not.toBe(first)
    expect(strokes(first).length).toBeGreaterThan(2_000)
  })

  it('keeps existing marks anchored when an artboard grows within the budget', () => {
    const smaller = strokes(buildHatchPaths(300, 180, { seed: 42 }))
    const larger = new Set(strokes(buildHatchPaths(600, 360, { seed: 42 })))
    expect(smaller.every((stroke) => larger.has(stroke))).toBe(true)
  })

  it('keeps the reference-size map at its requested pitch without counting invisible padding', () => {
    const svg = buildHatchPaths(1536, 945)
    expect(svg).toContain('data-budget-limited="false"')
    expect(svg).toContain(`data-effective-spacing="${DEFAULT_HATCH_OPTIONS.spacing}"`)
    expect(strokes(svg).length).toBeGreaterThan(28_000)
    expect(strokes(svg).length).toBeLessThanOrEqual(30_000)
  })

  it('exports editable curves without images, external links, scripts or filters', () => {
    const svg = buildHatchSwatchSvg()
    expect(svg).toContain('viewBox="0 0 600 360"')
    expect(svg).not.toMatch(/<(?:image|script|foreignObject|filter)\b|(?:href|onload)=/)
    expect(strokes(svg).every((stroke) => /d="M[-\d. ]+C[-\d. ]+"/.test(stroke))).toBe(true)
  })

  it('uses straight upright strokes when wave strength is zero', () => {
    const paths = strokes(buildHatchPaths(60, 60, { curvature: 0 }))
    for (const path of paths) {
      const values = path
        .match(/d="([^"]+)"/)![1]
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
      expect(values[0]).toBe(values[2])
      expect(values[0]).toBe(values[4])
      expect(values[0]).toBe(values[6])
      expect(values[1]).toBeLessThan(values[7])
    }
  })

  it('keeps curves moving down the ribbon at the strongest permitted warp', () => {
    const paths = strokes(buildHatchPaths(600, 360, { curvature: 24, bandHeight: 40 }))
    for (const path of paths) {
      const values = path
        .match(/d="([^"]+)"/)![1]
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
      const [y0, y1, y2, y3] = [values[1], values[3], values[5], values[7]]
      // The derivative is a quadratic; test its endpoints and interior minimum.
      const a = -y0 + 3 * y1 - 3 * y2 + y3
      const b = 2 * (y0 - 2 * y1 + y2)
      const c = y1 - y0
      const vertex = a > 0 ? Math.max(0, Math.min(1, -b / (2 * a))) : 0
      expect(Math.min(c, a + b + c, a * vertex * vertex + b * vertex + c)).toBeGreaterThan(0)
    }
  })

  it('bounds extreme dense requests without leaving the bottom of the field empty', () => {
    const svg = buildHatchPaths(Number.MAX_VALUE, Number.MAX_VALUE, {
      spacing: -100,
      bandHeight: -100,
      strokeWidth: Number.MAX_VALUE,
      curvature: Number.MAX_VALUE,
    })
    const paths = strokes(svg)
    expect(paths.length).toBeGreaterThan(20_000)
    expect(paths.length).toBeLessThanOrEqual(30_000)
    expect(svg).toContain('data-budget-limited="true"')
    expect(svg).not.toMatch(/NaN|Infinity/)
    const ends = paths.map((path) => {
      const numbers = path
        .match(/d="([^"]+)"/)![1]
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
      return numbers[7]
    })
    expect(Math.max(...ends)).toBeGreaterThan(4090)
  })

  it('replaces non-finite options with defaults and handles invalid extents without loops', () => {
    const invalidOptions = {
      seed: NaN,
      spacing: Infinity,
      bandHeight: NaN,
      strokeWidth: -Infinity,
      curvature: NaN,
    }
    expect(buildHatchPaths(60, 60, invalidOptions)).toBe(buildHatchPaths(60, 60, DEFAULT_HATCH_OPTIONS))
    for (const dimension of [0, -1, NaN, Infinity, -Infinity]) {
      expect(strokes(buildHatchPaths(dimension, 50))).toHaveLength(0)
      expect(strokes(buildHatchPaths(50, dimension))).toHaveLength(0)
    }
  })
})
