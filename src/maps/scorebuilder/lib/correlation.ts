import { SCORE_METRICS } from '../constants'
import type { ScoreMetricKey } from '../types'
import type { RegionMetricRow } from './scoring'

export interface CorrelationStats {
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  n: number
  pearson: number
  rSquared: number
  spearman: number
  slope: number
  intercept: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface CorrelationPoint {
  regionId: string
  regionName: string
  x: number
  y: number
  yHat: number
  residual: number
}

export interface CorrelationResult {
  stats: CorrelationStats | null
  points: CorrelationPoint[]
  residualMaxAbs: number
}

export interface MetricCorrelation {
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  pearson: number
  rSquared: number
  spearman: number
  n: number
}

function mean(values: number[]): number {
  if (!values.length) return 0
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

function pearsonCoefficient(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0
  const meanX = mean(xs)
  const meanY = mean(ys)
  let num = 0
  let denomX = 0
  let denomY = 0
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  const denom = Math.sqrt(denomX * denomY)
  if (!Number.isFinite(denom) || denom <= 0) return 0
  return num / denom
}

function rankWithTies(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }))
  indexed.sort((a, b) => a.value - b.value)
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j += 1
    const averageRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[indexed[k].index] = averageRank
    i = j + 1
  }
  return ranks
}

function spearmanCoefficient(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0
  return pearsonCoefficient(rankWithTies(xs), rankWithTies(ys))
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  if (xs.length < 2) return { slope: 0, intercept: ys.length ? ys[0] : 0 }
  const meanX = mean(xs)
  const meanY = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX
    num += dx * (ys[i] - meanY)
    den += dx * dx
  }
  if (den <= 0) return { slope: 0, intercept: meanY }
  const slope = num / den
  return { slope, intercept: meanY - slope * meanX }
}

export function computeCorrelation(
  rows: RegionMetricRow[],
  metricX: ScoreMetricKey,
  metricY: ScoreMetricKey,
): CorrelationResult {
  const xs: number[] = []
  const ys: number[] = []
  const sources: Array<{ regionId: string; regionName: string }> = []

  for (const row of rows) {
    const xValue = row.metrics[metricX]
    const yValue = row.metrics[metricY]
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
    xs.push(xValue)
    ys.push(yValue)
    sources.push({ regionId: row.region.id, regionName: row.region.name })
  }

  if (xs.length < 2) {
    return { stats: null, points: [], residualMaxAbs: 0 }
  }

  const pearson = pearsonCoefficient(xs, ys)
  const spearman = spearmanCoefficient(xs, ys)
  const { slope, intercept } = linearFit(xs, ys)

  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] < xMin) xMin = xs[i]
    if (xs[i] > xMax) xMax = xs[i]
    if (ys[i] < yMin) yMin = ys[i]
    if (ys[i] > yMax) yMax = ys[i]
  }

  let residualMaxAbs = 0
  const points: CorrelationPoint[] = sources.map((source, index) => {
    const x = xs[index]
    const y = ys[index]
    const yHat = slope * x + intercept
    const residual = y - yHat
    const absResidual = Math.abs(residual)
    if (absResidual > residualMaxAbs) residualMaxAbs = absResidual
    return { regionId: source.regionId, regionName: source.regionName, x, y, yHat, residual }
  })

  return {
    stats: {
      metricX,
      metricY,
      n: xs.length,
      pearson,
      rSquared: pearson * pearson,
      spearman,
      slope,
      intercept,
      xMin,
      xMax,
      yMin,
      yMax,
    },
    points,
    residualMaxAbs,
  }
}

export function quantileBreaks(values: number[], n: number): number[] {
  if (n < 2 || values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const breaks: number[] = []
  for (let i = 1; i < n; i += 1) {
    const fractional = (i / n) * (sorted.length - 1)
    const lo = Math.floor(fractional)
    const hi = Math.ceil(fractional)
    const t = fractional - lo
    breaks.push(sorted[lo] * (1 - t) + sorted[hi] * t)
  }
  return breaks
}

export function bucketIndex(value: number, breaks: number[]): number {
  for (let i = 0; i < breaks.length; i += 1) {
    if (value <= breaks[i]) return i
  }
  return breaks.length
}

export function topMetricCorrelations(
  rows: RegionMetricRow[],
  options: { limit?: number; minN?: number; absoluteOnly?: boolean } = {},
): MetricCorrelation[] {
  const limit = options.limit ?? 10
  const minN = options.minN ?? 8
  const allKeys = SCORE_METRICS.map((metric) => metric.key)
  const keyValueLists = new Map<ScoreMetricKey, Array<{ rowIndex: number; value: number }>>()
  for (const key of allKeys) {
    const list: Array<{ rowIndex: number; value: number }> = []
    for (let i = 0; i < rows.length; i += 1) {
      const value = rows[i].metrics[key]
      if (Number.isFinite(value)) list.push({ rowIndex: i, value })
    }
    keyValueLists.set(key, list)
  }

  const skipPairs = new Set<string>()
  const equivalenceGroups: ScoreMetricKey[][] = [
    ['cimdComposite', 'cimdResidentialInstability', 'cimdEconomicDependency', 'cimdSituationalVulnerability', 'cimdEthnoCulturalComposition'],
  ]
  for (const group of equivalenceGroups) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        skipPairs.add(`${group[a]}|${group[b]}`)
        skipPairs.add(`${group[b]}|${group[a]}`)
      }
    }
  }

  const candidates: MetricCorrelation[] = []
  for (let i = 0; i < allKeys.length; i += 1) {
    for (let j = i + 1; j < allKeys.length; j += 1) {
      const keyA = allKeys[i]
      const keyB = allKeys[j]
      if (skipPairs.has(`${keyA}|${keyB}`)) continue
      const aList = keyValueLists.get(keyA) || []
      const bList = keyValueLists.get(keyB) || []
      if (aList.length < minN || bList.length < minN) continue
      const xs: number[] = []
      const ys: number[] = []
      let aIdx = 0
      let bIdx = 0
      while (aIdx < aList.length && bIdx < bList.length) {
        const aRow = aList[aIdx].rowIndex
        const bRow = bList[bIdx].rowIndex
        if (aRow === bRow) {
          xs.push(aList[aIdx].value)
          ys.push(bList[bIdx].value)
          aIdx += 1
          bIdx += 1
        } else if (aRow < bRow) {
          aIdx += 1
        } else {
          bIdx += 1
        }
      }
      if (xs.length < minN) continue
      const r = pearsonCoefficient(xs, ys)
      if (!Number.isFinite(r) || r === 0) continue
      const rho = spearmanCoefficient(xs, ys)
      candidates.push({ metricX: keyA, metricY: keyB, pearson: r, rSquared: r * r, spearman: rho, n: xs.length })
    }
  }

  candidates.sort((a, b) => {
    if (options.absoluteOnly === false) return b.pearson - a.pearson
    return Math.abs(b.pearson) - Math.abs(a.pearson)
  })
  return candidates.slice(0, limit)
}
