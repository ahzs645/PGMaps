import { describe, expect, it } from 'vitest'
import {
  FIT_CRS,
  GEOREFERENCE_SCHEMA,
  PIXEL_CONVENTION,
  type GeoreferenceProject,
  type Point,
  type TransformType,
} from './model'
import { fitTransformation, lngLatToMercator, mercatorToLngLat } from './transforms'

const SOURCE: Point[] = [
  [100, 100],
  [900, 100],
  [100, 700],
  [900, 700],
  [500, 250],
  [350, 550],
  [700, 450],
]
const ORIGIN: Point = lngLatToMercator([-125, 54])

function project(type: TransformType, pixels: Point[], forward: (p: Point) => Point): GeoreferenceProject {
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    source: {
      id: 'test-sheet',
      url: null,
      sha256: 'a'.repeat(64),
      width: 1000,
      height: 800,
      frame: { kind: 'original-image', description: 'Exact original image pixel frame.' },
    },
    transform: type,
    points: pixels.map((pixel, i) => ({
      id: `P${i}`,
      pixel,
      coordinate: mercatorToLngLat(forward(pixel)),
      enabled: true,
      role: 'control',
    })),
  }
}

function closePoint(a: Point | null, b: Point, precision = 6): void {
  expect(a).not.toBeNull()
  expect(a![0]).toBeCloseTo(b[0], precision)
  expect(a![1]).toBeCloseTo(b[1], precision)
}

describe('metric image transformations', () => {
  it('rejects invalid projection queries and transformed points beyond the Web Mercator world', () => {
    expect(() => mercatorToLngLat([0, 1e100])).toThrow(/outside/)
    expect(() => lngLatToMercator([-125, 90])).toThrow(/Mercator/)
    expect(() => mercatorToLngLat([Infinity, 0])).toThrow(/finite/)
    closePoint(mercatorToLngLat(lngLatToMercator([180, 0])), [180, 0])
    const fit = fitTransformation(project('similarity', SOURCE.slice(0, 2), ([x, y]) => [ORIGIN[0] + x, ORIGIN[1] - y]))
    expect(() => fit.forward([1e12, 0])).toThrow(/outside/)
  })

  it('fits image-y-down similarity, including translation and rotation, with two controls', () => {
    const forward = ([x, y]: Point): Point => [ORIGIN[0] + 3 * x + 0.7 * y, ORIGIN[1] + 0.7 * x - 3 * y]
    const fit = fitTransformation(project('similarity', SOURCE.slice(0, 2), forward))
    closePoint(fit.forwardProjected([348.25, 653.75]), forward([348.25, 653.75]))
    closePoint(fit.inverse(mercatorToLngLat(forward([348.25, 653.75]))), [348.25, 653.75])
    expect(fit.matrix3857?.[0][2]).toBeCloseTo(ORIGIN[0], 6)
    expect(fit.diagnostics.inverseMethod).toBe('analytical')
    expect(fit.stats.check.groundMetres.rmse).toBeNull()
    expect(fit.diagnostics.warnings.join(' ')).toContain('No enabled held-out checks')
  })

  it('fits affine shear using three noncollinear controls and evaluates pixel outer edges', () => {
    const forward = ([x, y]: Point): Point => [ORIGIN[0] + 2 * x + 0.4 * y, ORIGIN[1] + 0.2 * x - 3.5 * y]
    const fit = fitTransformation(project('affine', SOURCE.slice(0, 3), forward))
    for (const pixel of [
      [-0.5, -0.5],
      [999.5, 799.5],
      [425.5, 321.25],
    ] as Point[]) {
      closePoint(fit.forwardProjected(pixel), forward(pixel))
      closePoint(fit.inverse(mercatorToLngLat(forward(pixel))), pixel)
    }
  })

  it('holds check points out and separates projected metres from ground distance at 54°N', () => {
    const forward = ([x, y]: Point): Point => [ORIGIN[0] + x, ORIGIN[1] - y]
    const input = project('affine', SOURCE.slice(0, 4), forward)
    input.points[3].role = 'check'
    const target = lngLatToMercator(input.points[3].coordinate)
    input.points[3].coordinate = mercatorToLngLat([target[0] + 100, target[1]])
    const fit = fitTransformation(input)
    expect(fit.stats.control.projectedMetres.max).toBeLessThan(1e-6)
    expect(fit.stats.check.projectedMetres.rmse).toBeCloseTo(100, 5)
    expect(fit.stats.check.groundMetres.rmse).toBeGreaterThan(58)
    expect(fit.stats.check.groundMetres.rmse).toBeLessThan(60)
    expect(fit.residuals.find((point) => point.role === 'check')?.usedInFit).toBe(false)
    const unchanged = fit.forwardProjected([400, 350])
    input.points[3].coordinate = [-125.5, 54.25]
    closePoint(fitTransformation(input).forwardProjected([400, 350]), unchanged)
  })

  it('excludes disabled pairs from both fitting and reported statistics', () => {
    const input = project('similarity', SOURCE.slice(0, 3), ([x, y]) => [ORIGIN[0] + x, ORIGIN[1] - y])
    input.points[2].enabled = false
    input.points[2].pixel = [...input.points[0].pixel]
    const fit = fitTransformation(input)
    expect(fit.stats.control.count).toBe(2)
    expect(fit.residuals).toHaveLength(2)
    expect(fit.diagnostics.excludedCount).toBe(1)
  })

  it('interpolates nonlinear TPS controls and solves the forward inverse at independent probes', () => {
    const input = project('thin-plate-spline', SOURCE, ([x, y]) => [
      ORIGIN[0] + 3 * x + 45 * Math.sin(x / 350) * Math.sin(y / 400),
      ORIGIN[1] - 3 * y + 30 * Math.sin(x / 300) * Math.cos(y / 450),
    ])
    const fit = fitTransformation(input)
    expect(fit.stats.control.projectedMetres.max).toBeLessThan(1e-6)
    expect(fit.diagnostics.folded).toBe(false)
    expect(fit.diagnostics.inverseMethod).toBe('damped-newton')
    expect(fit.matrix3857).toBeUndefined()
    for (const pixel of [
      [400, 400],
      [225.25, 625.75],
      [999.5, -0.5],
    ] as Point[]) {
      const inverse = fit.inverseDetailed(fit.forward(pixel))
      expect(inverse.converged).toBe(true)
      expect(inverse.residualProjectedMetres).toBeLessThan(1e-5)
      closePoint(inverse.pixel, pixel, 5)
    }
  })

  it('TPS reproduces an affine field despite its radial kernel and normalization', () => {
    const forward = ([x, y]: Point): Point => [ORIGIN[0] + x * 2 + y * 0.3, ORIGIN[1] + x * 0.2 - y * 1.5]
    const fit = fitTransformation(project('thin-plate-spline', SOURCE, forward))
    closePoint(fit.forwardProjected([600.125, 799.5]), forward([600.125, 799.5]), 5)
  })

  it('rejects insufficient, repeated, nonfinite and degenerate controls', () => {
    const forward = ([x, y]: Point): Point => [ORIGIN[0] + x, ORIGIN[1] - y]
    for (const type of ['similarity', 'affine', 'thin-plate-spline'] as const) {
      expect(() => fitTransformation(project(type, SOURCE.slice(0, 1), forward))).toThrow(/at least/)
    }
    const repeated = project('affine', SOURCE.slice(0, 3), forward)
    repeated.points[2].pixel = [...repeated.points[0].pixel]
    expect(() => fitTransformation(repeated)).toThrow(/repeat/)
    const repeatedTarget = project('affine', SOURCE.slice(0, 3), forward)
    repeatedTarget.points[2].coordinate = [...repeatedTarget.points[0].coordinate]
    expect(() => fitTransformation(repeatedTarget)).toThrow(/repeat/)
    const collinear: Point[] = [
      [100, 100],
      [200, 200],
      [300, 300],
      [400, 400],
      [500, 500],
      [600, 600],
    ]
    expect(() => fitTransformation(project('affine', collinear, forward))).toThrow(/collinear|degenerate/)
    expect(() => fitTransformation(project('thin-plate-spline', collinear, forward))).toThrow(/collinear|degenerate/)
    const collapsed = project('affine', SOURCE.slice(0, 3), ([x, y]) => [ORIGIN[0] + x + y, ORIGIN[1] + x + y])
    expect(() => fitTransformation(collapsed)).toThrow(/collapses/)
    const nonfinite = project('similarity', SOURCE.slice(0, 2), forward)
    nonfinite.points[0].coordinate[0] = Infinity
    expect(() => fitTransformation(nonfinite)).toThrow(/finite/)
  })

  it('rejects checks coincident with fit controls and dateline ambiguity', () => {
    const input = project('similarity', SOURCE.slice(0, 3), ([x, y]) => [ORIGIN[0] + x, ORIGIN[1] - y])
    input.points[2] = { ...input.points[0], id: 'check', role: 'check' }
    expect(() => fitTransformation(input)).toThrow(/not an independent check/)
    const dateline = project('similarity', SOURCE.slice(0, 2), ([x, y]) => [ORIGIN[0] + x, ORIGIN[1] - y])
    dateline.points[0].coordinate = [-179, 54]
    dateline.points[1].coordinate = [179, 54]
    expect(() => fitTransformation(dateline)).toThrow(/Dateline/)
  })

  it('reports TPS folding and refuses to label an ambiguous inverse as converged', () => {
    const pixels: Point[] = [
      [100, 100],
      [900, 100],
      [100, 700],
      [900, 700],
      [500, 250],
      [500, 550],
      [250, 400],
      [750, 400],
    ]
    const input = project('thin-plate-spline', pixels, ([x, y]) => [ORIGIN[0] + x * 2, ORIGIN[1] - y * 2])
    input.points[4].coordinate = mercatorToLngLat([ORIGIN[0] + 1000, ORIGIN[1] - 1300])
    input.points[5].coordinate = mercatorToLngLat([ORIGIN[0] + 1000, ORIGIN[1] - 300])
    const fit = fitTransformation(input)
    expect(fit.diagnostics.folded).toBe(true)
    expect(fit.inverseDetailed(fit.forward([500, 400])).converged).toBe(false)
    expect(fit.inverse(fit.forward([500, 400]))).toBeNull()
  })
})
