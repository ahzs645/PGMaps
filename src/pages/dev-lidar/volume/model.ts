import type { ForestData, ForestProperties } from '../forestry'

export interface VolumeReference {
  plot_id: string
  volume_m3_ha: number
}
export type VolumePoint = [number, number]
export interface VolumeModel {
  method: 'OLS: gross volume ~ CHM p95 + canopy fraction'
  coefficients: [number, number, number]
  hull: VolumePoint[]
  references: VolumeReference[]
  diagnostics: {
    n: number
    loo_rmse_m3_ha: number
    loo_bias_m3_ha: number
    loo_r2: number | null
    observed: number[]
    predicted: number[]
  }
}
export const volumeEligible = (p: ForestProperties) =>
  p.sampled_m2 === 2500 && p.support_percent === 100 && p.canopy_percent >= 5 && p.surface_p95_m >= 2
export const volumePredictors = (p: ForestProperties): VolumePoint => [p.surface_p95_m, p.canopy_percent / 100]
export function parseVolumeReferences(text: string, data: ForestData): VolumeReference[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter((s) => s.trim())
  const fields = (line: string) => line.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
  const headers = fields(lines[0] ?? '')
  if (headers.join(',') !== 'plot_id,volume_m3_ha') throw Error('Expected CSV columns: plot_id,volume_m3_ha')
  if (lines.length - 1 < 10 || lines.length - 1 > 200)
    throw Error(
      'Provide 10–200 matched reference plots. Ten is a software minimum, not a survey-design recommendation.',
    )
  const known = new Map(data.plots.features.map((f) => [f.properties.id, f.properties])),
    seen = new Set<string>()
  return lines.slice(1).map((line, i) => {
    const row = fields(line),
      [id, value] = row,
      p = known.get(id)
    if (row.length !== 2 || !value || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10000)
      throw Error(`Row ${i + 2}: provide a nonnegative gross stem volume in m³/ha (maximum 10,000).`)
    if (!p) throw Error(`Row ${i + 2}: unknown source plot ${id}.`)
    if (seen.has(id)) throw Error(`Duplicate reference plot ${id}.`)
    if (!volumeEligible(p))
      throw Error(`${id} is not a fully supported 50 × 50 m forest plot. Match the template footprint and area.`)
    seen.add(id)
    return { plot_id: id, volume_m3_ha: Number(value) }
  })
}
const cross = (o: VolumePoint, a: VolumePoint, b: VolumePoint) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
export function convexDomain(points: VolumePoint[]): VolumePoint[] {
  const sorted = [...new Map(points.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: VolumePoint[] = [],
    upper: VolumePoint[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}
export function withinVolumeDomain(point: VolumePoint, hull: VolumePoint[]) {
  return hull.length >= 3 && hull.every((p, i) => cross(p, hull[(i + 1) % hull.length], point) >= -1e-8)
}
function leastSquares(x: VolumePoint[], y: number[]): [number, number, number] {
  const mean = [0, 1].map((j) => x.reduce((s, p) => s + p[j], 0) / x.length),
    scale = [0, 1].map((j) => Math.sqrt(x.reduce((s, p) => s + (p[j] - mean[j]) ** 2, 0) / x.length))
  if (scale.some((s) => s < 1e-8)) throw Error('Reference plots need independent variation in height and canopy cover.')
  const rows = x.map((p) => [1, (p[0] - mean[0]) / scale[0], (p[1] - mean[1]) / scale[1]])
  const matrix = [0, 1, 2].map((i) => [
    ...Array.from({ length: 3 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    rows.reduce((s, r, k) => s + r[i] * y[k], 0),
  ])
  for (let i = 0; i < 3; i++) {
    let pivot = i
    for (let j = i + 1; j < 3; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j
    if (Math.abs(matrix[pivot][i]) < 1e-8)
      throw Error('Reference predictors are collinear. Add plots spanning height and canopy-cover conditions.')
    ;[matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]]
    const div = matrix[i][i]
    matrix[i] = matrix[i].map((v) => v / div)
    for (let j = 0; j < 3; j++)
      if (j !== i) {
        const factor = matrix[j][i]
        matrix[j] = matrix[j].map((v, k) => v - factor * matrix[i][k])
      }
  }
  const bh = matrix[1][3] / scale[0],
    bc = matrix[2][3] / scale[1]
  return [matrix[0][3] - bh * mean[0] - bc * mean[1], bh, bc]
}
const evaluate = (b: number[], p: VolumePoint) => b[0] + b[1] * p[0] + b[2] * p[1]
export function fitVolumeModel(data: ForestData, references: VolumeReference[]): VolumeModel {
  if (
    references.length < 10 ||
    references.length > 200 ||
    new Set(references.map((r) => r.plot_id)).size !== references.length
  )
    throw Error('Use 10–200 distinct matched plots.')
  const known = new Map(data.plots.features.map((f) => [f.properties.id, f.properties]))
  const x = references.map((r) => {
      const p = known.get(r.plot_id)
      if (!p || !volumeEligible(p) || !Number.isFinite(r.volume_m3_ha) || r.volume_m3_ha < 0 || r.volume_m3_ha > 10000)
        throw Error('Invalid reference plot or volume.')
      return volumePredictors(p)
    }),
    y = references.map((r) => r.volume_m3_ha)
  const coefficients = leastSquares(x, y),
    hull = convexDomain(x)
  if (hull.length < 3) throw Error('Reference plots do not span a two-dimensional predictor domain.')
  const predicted = x.map((p, i) =>
      evaluate(
        leastSquares(
          x.filter((_, j) => j !== i),
          y.filter((_, j) => j !== i),
        ),
        p,
      ),
    ),
    errors = predicted.map((v, i) => v - y[i])
  const mse = errors.reduce((s, e) => s + e * e, 0) / y.length,
    mean = y.reduce((s, v) => s + v, 0) / y.length,
    tss = y.reduce((s, v) => s + (v - mean) ** 2, 0)
  return {
    method: 'OLS: gross volume ~ CHM p95 + canopy fraction',
    coefficients,
    hull,
    references,
    diagnostics: {
      n: y.length,
      loo_rmse_m3_ha: Math.sqrt(mse),
      loo_bias_m3_ha: errors.reduce((s, e) => s + e, 0) / y.length,
      loo_r2: tss > 0 ? 1 - (mse * y.length) / tss : null,
      observed: y,
      predicted,
    },
  }
}
export function predictVolume(
  model: VolumeModel | null,
  p: ForestProperties,
): { volume_m3_ha: number | null; status: string } {
  if (!model) return { volume_m3_ha: null, status: 'Calibration required' }
  if (!volumeEligible(p)) return { volume_m3_ha: null, status: 'Insufficient supported forest area' }
  const x = volumePredictors(p)
  if (!withinVolumeDomain(x, model.hull)) return { volume_m3_ha: null, status: 'Outside calibration domain' }
  const value = evaluate(model.coefficients, x)
  return Number.isFinite(value) && value >= 0
    ? { volume_m3_ha: value, status: 'Experimental local estimate' }
    : { volume_m3_ha: null, status: 'Nonphysical model prediction' }
}
export function harvestScenario(
  volumes: (number | null)[],
  merchantableShare: number,
  retention: number,
  recovery: number,
) {
  if ([merchantableShare, retention, recovery].some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw Error('Scenario factors must be between 0 and 1.')
  const valid = volumes.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0),
    areaHa = valid.length * 0.25,
    gross = valid.reduce((s, v) => s + v * 0.25, 0)
  return {
    supported_plots: valid.length,
    unsupported_plots: volumes.length - valid.length,
    area_ha: areaHa,
    gross_stem_m3: gross,
    scenario_delivered_m3: gross * merchantableShare * (1 - retention) * recovery,
  }
}
