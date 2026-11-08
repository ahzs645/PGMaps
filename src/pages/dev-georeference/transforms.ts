import proj4 from 'proj4'
import { BC_ALBERS } from '@/lib/geo/projectedCrs'
import {
  parseProject,
  validateCoordinate,
  MAX_MERCATOR_LATITUDE,
  type Coordinate,
  type GeoreferenceProject,
  type Pixel,
  type Point,
  type PointRole,
  type TransformType,
} from './model'

const EARTH_RADIUS = 6_378_137
const MEAN_EARTH_RADIUS = 6_371_008.8
const RADIANS = Math.PI / 180
export const MINIMUM_CONTROLS: Record<TransformType, number> = {
  similarity: 2,
  affine: 3,
  'thin-plate-spline': 6,
}

export class TransformationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransformationError'
  }
}

export interface MetricSummary {
  rmse: number | null
  mean: number | null
  median: number | null
  max: number | null
}

export interface ResidualStatistics {
  count: number
  /** Great-circle distance on a mean-radius sphere; not a survey accuracy estimate. */
  groundMetres: MetricSummary
  /** Distances in EPSG:3857 coordinate units, which stretch with latitude. */
  projectedMetres: MetricSummary
}

export interface PointResidual {
  id: string
  role: PointRole
  pixel: Pixel
  coordinate: Coordinate
  predicted: Coordinate
  usedInFit: boolean
  projectedError: Point
  projectedMetres: number
  groundMetres: number
}

export interface InverseResult {
  pixel: Pixel | null
  converged: boolean
  iterations: number
  residualProjectedMetres: number | null
  reason?: string
}

export interface TransformationDiagnostics {
  warnings: string[]
  controlCount: number
  checkCount: number
  excludedCount: number
  minimumControls: number
  fitCrs: 'EPSG:3857' | 'EPSG:3005'
  inverseMethod: 'analytical' | 'damped-newton'
  /** Sampled orientation reversals; absence is not a proof of global injectivity. */
  folded: boolean
  sampledFoldChecks: number
  inverseSampleFailures: number
}

export interface FittedTransformation {
  forward(pixel: Pixel): Coordinate
  forwardProjected(pixel: Pixel): Point
  inverse(coordinate: Coordinate): Pixel | null
  inverseDetailed(coordinate: Coordinate): InverseResult
  /** Native pixel-centre to EPSG:3857; absent for TPS. */
  matrix3857?: [[number, number, number], [number, number, number]]
  /** Native archived matrix; export must use its own CRS before projecting the raster. */
  nativeMatrix?: { crs: 'EPSG:3005'; matrix: Matrix2x3 }
  recovered?: boolean
  residuals: PointResidual[]
  stats: { control: ResidualStatistics; check: ResidualStatistics }
  diagnostics: TransformationDiagnostics
}

type Matrix2x3 = [[number, number, number], [number, number, number]]
type Jacobian = [[number, number], [number, number]]
interface Normalization {
  centre: Point
  scale: number
}
interface MetricModel {
  evaluate(point: Point): Point
  jacobian(point: Point): Jacobian
}

function finitePoint(point: Point): void {
  if (point.length !== 2 || !point.every(Number.isFinite)) {
    throw new TransformationError('A transformation query must contain two finite numbers.')
  }
}

export function lngLatToMercator(coordinate: Coordinate): Point {
  const [longitude, latitude] = validateCoordinate(coordinate)
  return [EARTH_RADIUS * longitude * RADIANS, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (latitude * RADIANS) / 2))]
}

export function mercatorToLngLat(point: Point): Coordinate {
  finitePoint(point)
  const limit = EARTH_RADIUS * Math.PI
  if (Math.abs(point[0]) > limit + 1e-6 || Math.abs(point[1]) > limit + 1e-6) {
    throw new TransformationError('The transformed point lies outside the supported Web Mercator world.')
  }
  const result: Coordinate = [
    Math.min(180, Math.max(-180, point[0] / EARTH_RADIUS / RADIANS)),
    Math.min(
      MAX_MERCATOR_LATITUDE,
      Math.max(-MAX_MERCATOR_LATITUDE, (2 * Math.atan(Math.exp(point[1] / EARTH_RADIUS)) - Math.PI / 2) / RADIANS),
    ),
  ]
  if (!result.every(Number.isFinite)) throw new TransformationError('Projection produced a nonfinite coordinate.')
  return result
}

export function groundDistance(a: Coordinate, b: Coordinate): number {
  const latitudeDifference = (b[1] - a[1]) * RADIANS
  const longitudeDifference = (b[0] - a[0]) * RADIANS
  const term =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(a[1] * RADIANS) * Math.cos(b[1] * RADIANS) * Math.sin(longitudeDifference / 2) ** 2
  return 2 * MEAN_EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, term))))
}

function normalization(points: Point[], label: string): Normalization {
  const centre: Point = [0, 0]
  for (const point of points) {
    centre[0] += point[0] / points.length
    centre[1] += point[1] / points.length
  }
  const scale = Math.sqrt(
    points.reduce((sum, p) => sum + (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2, 0) / points.length,
  )
  if (!Number.isFinite(scale) || scale <= 1e-9) {
    throw new TransformationError(`${label} points do not span a usable distance.`)
  }
  return { centre, scale }
}

function normalize(point: Point, frame: Normalization): Point {
  return [(point[0] - frame.centre[0]) / frame.scale, (point[1] - frame.centre[1]) / frame.scale]
}

function denormalize(point: Point, frame: Normalization): Point {
  return [point[0] * frame.scale + frame.centre[0], point[1] * frame.scale + frame.centre[1]]
}

/** Reorthogonalized QR, avoiding normal equations for nearly aligned control configurations. */
function leastSquares(matrix: number[][], target: number[]): number[] {
  const rows = matrix.length
  const columns = matrix[0].length
  const q: number[][] = []
  const r = Array.from({ length: columns }, () => Array<number>(columns).fill(0))
  for (let column = 0; column < columns; column += 1) {
    const v = matrix.map((row) => row[column])
    for (let pass = 0; pass < 2; pass += 1) {
      for (let previous = 0; previous < column; previous += 1) {
        const dot = v.reduce((sum, value, index) => sum + value * q[previous][index], 0)
        r[previous][column] += dot
        for (let row = 0; row < rows; row += 1) v[row] -= dot * q[previous][row]
      }
    }
    const length = Math.hypot(...v)
    if (length <= 1e-10 * Math.sqrt(rows)) {
      throw new TransformationError('Control points are collinear or the transformation is degenerate.')
    }
    r[column][column] = length
    q.push(v.map((value) => value / length))
  }
  const result = q.map((column) => column.reduce((sum, value, row) => sum + value * target[row], 0))
  for (let row = columns - 1; row >= 0; row -= 1) {
    for (let column = row + 1; column < columns; column += 1) result[row] -= r[row][column] * result[column]
    result[row] /= r[row][row]
  }
  return result
}

/** Partial-pivot elimination of the small normalized TPS system, with both output columns. */
function solveSquare(matrix: number[][], targets: Point[]): Point[] {
  const count = matrix.length
  const augmented = matrix.map((row, index) => [...row, ...targets[index]])
  const tolerance = Math.max(...matrix.flat().map(Math.abs)) * 1e-11
  for (let column = 0; column < count; column += 1) {
    let pivot = column
    for (let row = column + 1; row < count; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) <= tolerance) {
      throw new TransformationError('TPS controls are degenerate or too poorly conditioned.')
    }
    ;[augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]]
    for (let row = column + 1; row < count; row += 1) {
      const factor = augmented[row][column] / augmented[column][column]
      for (let k = column + 1; k < count + 2; k += 1) {
        augmented[row][k] -= factor * augmented[column][k]
      }
      augmented[row][column] = 0
    }
  }
  const result = Array.from({ length: count }, (): Point => [0, 0])
  for (let row = count - 1; row >= 0; row -= 1) {
    for (let axis = 0; axis < 2; axis += 1) {
      let value = augmented[row][count + axis]
      for (let column = row + 1; column < count; column += 1) value -= augmented[row][column] * result[column][axis]
      result[row][axis] = value / augmented[row][row]
    }
  }
  return result
}

function applyMatrix(matrix: Matrix2x3, point: Point): Point {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2],
  ]
}

function determinant(matrix: Jacobian): number {
  return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
}

function inverseMatrix(matrix: Matrix2x3): Matrix2x3 {
  const det = determinant([
    [matrix[0][0], matrix[0][1]],
    [matrix[1][0], matrix[1][1]],
  ])
  if (Math.abs(det) <= 1e-10)
    throw new TransformationError('The transformation collapses an axis and cannot be inverted.')
  const inverse: Matrix2x3 = [
    [matrix[1][1] / det, -matrix[0][1] / det, 0],
    [-matrix[1][0] / det, matrix[0][0] / det, 0],
  ]
  inverse[0][2] = -inverse[0][0] * matrix[0][2] - inverse[0][1] * matrix[1][2]
  inverse[1][2] = -inverse[1][0] * matrix[0][2] - inverse[1][1] * matrix[1][2]
  return inverse
}

function linearFit(type: 'similarity' | 'affine', source: Point[], target: Point[]): Matrix2x3 {
  if (type === 'affine') {
    const design = source.map(([x, y]) => [1, x, y])
    const x = leastSquares(
      design,
      target.map((p) => p[0]),
    )
    const y = leastSquares(
      design,
      target.map((p) => p[1]),
    )
    return [
      [x[1], x[2], x[0]],
      [y[1], y[2], y[0]],
    ]
  }
  // Reflection of image y-down to metric north-up is part of the declared pixel convention.
  const design = source.flatMap(([x, y]) => [
    [x, y, 1, 0],
    [-y, x, 0, 1],
  ])
  const [a, b, tx, ty] = leastSquares(design, target.flat())
  return [
    [a, b, tx],
    [b, -a, ty],
  ]
}

function kernel(squaredRadius: number): number {
  return squaredRadius === 0 ? 0 : squaredRadius * Math.log(squaredRadius)
}

function tpsFit(source: Point[], target: Point[]): MetricModel {
  // P must have rank three in both directions; inverse fitting also requires a 2D target frame.
  leastSquares(
    source.map(([x, y]) => [1, x, y]),
    target.map((p) => p[0]),
  )
  const count = source.length
  const system = Array.from({ length: count + 3 }, () => Array<number>(count + 3).fill(0))
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      system[i][j] = kernel((source[i][0] - source[j][0]) ** 2 + (source[i][1] - source[j][1]) ** 2)
    }
    ;[1, ...source[i]].forEach((value, j) => {
      system[i][count + j] = value
      system[count + j][i] = value
    })
  }
  const weights = solveSquare(system, [...target, [0, 0], [0, 0], [0, 0]])
  return {
    evaluate([x, y]) {
      const result: Point = [0, 0]
      for (let axis = 0; axis < 2; axis += 1) {
        result[axis] = weights[count][axis] + x * weights[count + 1][axis] + y * weights[count + 2][axis]
      }
      source.forEach(([cx, cy], index) => {
        const radial = kernel((x - cx) ** 2 + (y - cy) ** 2)
        result[0] += weights[index][0] * radial
        result[1] += weights[index][1] * radial
      })
      return result
    },
    jacobian([x, y]) {
      const result: Jacobian = [
        [weights[count + 1][0], weights[count + 2][0]],
        [weights[count + 1][1], weights[count + 2][1]],
      ]
      source.forEach(([cx, cy], index) => {
        const dx = x - cx
        const dy = y - cy
        const radius = dx * dx + dy * dy
        if (radius === 0) return
        const factor = 2 * (Math.log(radius) + 1)
        for (let axis = 0; axis < 2; axis += 1) {
          result[axis][0] += weights[index][axis] * factor * dx
          result[axis][1] += weights[index][axis] * factor * dy
        }
      })
      return result
    },
  }
}

function summary(values: number[]): MetricSummary {
  if (!values.length) return { rmse: null, mean: null, median: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    rmse: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted[sorted.length - 1],
  }
}

function residualStatistics(residuals: PointResidual[], role: PointRole): ResidualStatistics {
  const rows = residuals.filter((row) => row.role === role)
  return {
    count: rows.length,
    groundMetres: summary(rows.map((row) => row.groundMetres)),
    projectedMetres: summary(rows.map((row) => row.projectedMetres)),
  }
}

/** Reopen an archived model exactly, without replacing a constrained/weighted fit with a new least-squares fit. */
function recoveredTransformation(project: GeoreferenceProject): FittedTransformation {
  const recovered = project.recoveredPlacement!
  const matrix = recovered.matrix
  const inverse = inverseMatrix(matrix)
  const forward = (pixel: Pixel): Coordinate => {
    finitePoint(pixel)
    return validateCoordinate(proj4(BC_ALBERS, 'EPSG:4326', applyMatrix(matrix, pixel)))
  }
  const forwardProjected = (pixel: Pixel): Point => lngLatToMercator(forward(pixel))
  const inverseDetailed = (coordinate: Coordinate): InverseResult => {
    const valid = validateCoordinate(coordinate)
    const native = proj4('EPSG:4326', BC_ALBERS, valid) as Point
    finitePoint(native)
    const pixel = applyMatrix(inverse, native)
    finitePoint(pixel)
    const expected = lngLatToMercator(valid)
    const actual = forwardProjected(pixel)
    return {
      pixel,
      converged: true,
      iterations: 0,
      residualProjectedMetres: Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
    }
  }
  const active = project.points.filter((point) => point.enabled)
  const residuals = active.map((point): PointResidual => {
    const predicted = forward(point.pixel)
    const actual = lngLatToMercator(predicted)
    const target = lngLatToMercator(point.coordinate)
    const error: Point = [actual[0] - target[0], actual[1] - target[1]]
    return {
      id: point.id,
      role: point.role,
      pixel: [...point.pixel],
      coordinate: [...point.coordinate],
      predicted,
      usedInFit: false,
      projectedError: error,
      projectedMetres: Math.hypot(...error),
      groundMetres: groundDistance(point.coordinate, predicted),
    }
  })
  const diagnostics: TransformationDiagnostics = {
    warnings: [
      'This is the recovered native placement. The displayed points are archived evidence, not a newly fitted model.',
      'Archived shoreline constraints, inherited grid relationships and weights remain in the recovery evidence. Point residuals alone do not reproduce that evidence.',
      'Recovery preserves the recorded placement and its limitations; it does not certify ground accuracy.',
    ],
    controlCount: active.filter((point) => point.role === 'control').length,
    checkCount: active.filter((point) => point.role === 'check').length,
    excludedCount: project.points.length - active.length,
    minimumControls: 0,
    fitCrs: 'EPSG:3005',
    inverseMethod: 'analytical',
    folded: false,
    sampledFoldChecks: 0,
    inverseSampleFailures: 0,
  }
  for (let row = 0; row <= 8; row += 1) {
    for (let column = 0; column <= 8; column += 1) {
      const pixel: Pixel = [-0.5 + (column * project.source.width) / 8, -0.5 + (row * project.source.height) / 8]
      const position = forward(pixel)
      const roundTrip = inverseDetailed(position)
      if (!roundTrip.pixel || Math.hypot(roundTrip.pixel[0] - pixel[0], roundTrip.pixel[1] - pixel[1]) > 0.01) {
        throw new TransformationError('Recovered placement cannot be inverted across its declared source frame.')
      }
      diagnostics.sampledFoldChecks += 1
    }
  }
  return {
    forward,
    forwardProjected,
    inverse: (coordinate) => inverseDetailed(coordinate).pixel,
    inverseDetailed,
    nativeMatrix: { crs: recovered.crs, matrix },
    recovered: true,
    residuals,
    stats: { control: residualStatistics(residuals, 'control'), check: residualStatistics(residuals, 'check') },
    diagnostics,
  }
}

/** Fits only enabled controls. Check points are reported separately and never affect the model. */
export function fitTransformation(input: GeoreferenceProject): FittedTransformation {
  const project = parseProject(input)
  const active = project.points.filter((point) => point.enabled)
  const controls = active.filter((point) => point.role === 'control')
  const minimum = MINIMUM_CONTROLS[project.transform]
  if (!project.recoveredPlacement?.active && controls.length < minimum) {
    throw new TransformationError(`${project.transform} needs at least ${minimum} enabled control pairs.`)
  }
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]
      const b = active[j]
      if (Math.hypot(a.pixel[0] - b.pixel[0], a.pixel[1] - b.pixel[1]) <= 1e-7) {
        throw new TransformationError(
          'Enabled points repeat a source pixel; a repeated control is not an independent check.',
        )
      }
      const am = lngLatToMercator(a.coordinate)
      const bm = lngLatToMercator(b.coordinate)
      if (Math.hypot(am[0] - bm[0], am[1] - bm[1]) <= 1e-6) {
        throw new TransformationError('Enabled points repeat a geographic coordinate.')
      }
    }
  }
  const longitudes = controls.map((control) => control.coordinate[0])
  if (Math.max(...longitudes) - Math.min(...longitudes) > 180) {
    throw new TransformationError('Dateline-crossing controls need a common unwrapped geographic frame.')
  }
  if (project.recoveredPlacement?.active) return recoveredTransformation(project)
  const pixels = controls.map((point) => point.pixel)
  const world = controls.map((point) => lngLatToMercator(point.coordinate))
  const sourceFrame = normalization(pixels, 'Source')
  const targetFrame = normalization(world, 'Target')
  const normalizedPixels = pixels.map((point) => normalize(point, sourceFrame))
  const normalizedWorld = world.map((point) => normalize(point, targetFrame))
  const tps = project.transform === 'thin-plate-spline'
  let model: MetricModel
  let reverse: (point: Point) => Point
  let metricMatrix: Matrix2x3 | undefined
  if (tps) {
    model = tpsFit(normalizedPixels, normalizedWorld)
    const reverseModel = tpsFit(normalizedWorld, normalizedPixels)
    reverse = (point) => reverseModel.evaluate(point)
  } else {
    const matrix = linearFit(project.transform as 'similarity' | 'affine', normalizedPixels, normalizedWorld)
    const inverse = inverseMatrix(matrix)
    model = {
      evaluate: (point) => applyMatrix(matrix, point),
      jacobian: () => [
        [matrix[0][0], matrix[0][1]],
        [matrix[1][0], matrix[1][1]],
      ],
    }
    reverse = (point) => applyMatrix(inverse, point)
    const scale = targetFrame.scale / sourceFrame.scale
    metricMatrix = [
      [matrix[0][0] * scale, matrix[0][1] * scale, 0],
      [matrix[1][0] * scale, matrix[1][1] * scale, 0],
    ]
    for (let axis = 0; axis < 2; axis += 1) {
      metricMatrix[axis][2] =
        targetFrame.centre[axis] +
        targetFrame.scale * matrix[axis][2] -
        metricMatrix[axis][0] * sourceFrame.centre[0] -
        metricMatrix[axis][1] * sourceFrame.centre[1]
    }
  }
  const diagnostics: TransformationDiagnostics = {
    warnings: ['Residuals describe agreement with chosen points, not independently verified ground accuracy.'],
    controlCount: controls.length,
    checkCount: active.length - controls.length,
    excludedCount: project.points.length - active.length,
    minimumControls: minimum,
    fitCrs: 'EPSG:3857',
    inverseMethod: tps ? 'damped-newton' : 'analytical',
    folded: false,
    sampledFoldChecks: 0,
    inverseSampleFailures: 0,
  }
  if (!diagnostics.checkCount)
    diagnostics.warnings.push('No enabled held-out checks: fitted residuals cannot validate the placement.')
  if (
    !project.source.sha256 &&
    !(project.source.frame.kind === 'geotiff-pixel-grid' && project.source.geotiff?.sha256)
  ) {
    diagnostics.warnings.push('Source file identity is unverified until a SHA-256 is recorded.')
  }
  if (tps) {
    let positive = false
    let negative = false
    let singular = false
    for (let row = 0; row <= 12; row += 1) {
      for (let column = 0; column <= 12; column += 1) {
        const point: Point = [-0.5 + (column * project.source.width) / 12, -0.5 + (row * project.source.height) / 12]
        const det = determinant(model.jacobian(normalize(point, sourceFrame)))
        positive ||= det > 1e-9
        negative ||= det < -1e-9
        singular ||= !Number.isFinite(det) || Math.abs(det) <= 1e-9
        diagnostics.sampledFoldChecks += 1
      }
    }
    diagnostics.folded = (positive && negative) || singular
    if (diagnostics.folded)
      diagnostics.warnings.push(
        'TPS folds or becomes locally singular in the sampled source frame; its inverse can be ambiguous.',
      )
    diagnostics.warnings.push(
      'TPS extrapolation and inverse convergence are not guaranteed outside the controls; sampling cannot prove that every fold was detected.',
    )
  }
  const forwardProjected = (pixel: Pixel): Point => {
    finitePoint(pixel)
    const result = denormalize(model.evaluate(normalize(pixel, sourceFrame)), targetFrame)
    finitePoint(result)
    return result
  }
  const forward = (pixel: Pixel): Coordinate => mercatorToLngLat(forwardProjected(pixel))
  const inverseDetailed = (coordinate: Coordinate): InverseResult => {
    const wanted = normalize(lngLatToMercator(coordinate), targetFrame)
    if (tps && diagnostics.folded) {
      return {
        pixel: null,
        converged: false,
        iterations: 0,
        residualProjectedMetres: null,
        reason: 'Sampled TPS folding makes the inverse ambiguous.',
      }
    }
    let point = reverse(wanted)
    if (!point.every(Number.isFinite)) {
      return {
        pixel: null,
        converged: false,
        iterations: 0,
        residualProjectedMetres: null,
        reason: 'The inverse seed is nonfinite.',
      }
    }
    const tolerance = Math.max(1e-7, targetFrame.scale * 1e-11)
    let lastResidual = Infinity
    let iterations = 0
    for (let iteration = 0; iteration <= (tps ? 40 : 0); iteration += 1) {
      iterations = iteration
      const value = model.evaluate(point)
      const error: Point = [value[0] - wanted[0], value[1] - wanted[1]]
      const residual = Math.hypot(...error) * targetFrame.scale
      lastResidual = residual
      if (residual <= tolerance) {
        return {
          pixel: denormalize(point, sourceFrame),
          converged: true,
          iterations: iteration,
          residualProjectedMetres: residual,
        }
      }
      if (!tps || !Number.isFinite(residual)) break
      const jacobian = model.jacobian(point)
      const det = determinant(jacobian)
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break
      const step: Point = [
        (jacobian[1][1] * error[0] - jacobian[0][1] * error[1]) / det,
        (-jacobian[1][0] * error[0] + jacobian[0][0] * error[1]) / det,
      ]
      let improved = false
      for (let damping = 1; damping >= 1 / 1024; damping /= 2) {
        const candidate: Point = [point[0] - damping * step[0], point[1] - damping * step[1]]
        const mapped = model.evaluate(candidate)
        if (Math.hypot(mapped[0] - wanted[0], mapped[1] - wanted[1]) * targetFrame.scale < residual) {
          point = candidate
          improved = true
          break
        }
      }
      if (!improved) break
    }
    return {
      pixel: null,
      converged: false,
      iterations,
      residualProjectedMetres: Number.isFinite(lastResidual) ? lastResidual : null,
      reason: 'The numerical inverse did not converge; no pixel position is claimed.',
    }
  }
  const residuals = active.map((point): PointResidual => {
    const predictedProjected = forwardProjected(point.pixel)
    const target = lngLatToMercator(point.coordinate)
    const predicted = mercatorToLngLat(predictedProjected)
    const error: Point = [predictedProjected[0] - target[0], predictedProjected[1] - target[1]]
    return {
      id: point.id,
      role: point.role,
      pixel: [...point.pixel],
      coordinate: [...point.coordinate],
      predicted,
      usedInFit: point.role === 'control',
      projectedError: error,
      projectedMetres: Math.hypot(...error),
      groundMetres: groundDistance(point.coordinate, predicted),
    }
  })
  if (tps && !diagnostics.folded) {
    for (const control of controls) {
      if (!inverseDetailed(forward(control.pixel)).converged) diagnostics.inverseSampleFailures += 1
    }
    if (diagnostics.inverseSampleFailures)
      diagnostics.warnings.push('Some fitted controls failed the numerical inverse round-trip check.')
  }
  return {
    forward,
    forwardProjected,
    inverse: (coordinate) => inverseDetailed(coordinate).pixel,
    inverseDetailed,
    ...(metricMatrix ? { matrix3857: metricMatrix } : {}),
    residuals,
    stats: {
      control: residualStatistics(residuals, 'control'),
      check: residualStatistics(residuals, 'check'),
    },
    diagnostics,
  }
}
