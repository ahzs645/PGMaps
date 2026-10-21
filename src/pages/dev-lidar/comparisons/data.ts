import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { TreeCrop } from '../treeIsolation'
import type { BenchmarkData } from '../TreeBenchmarks'
import { checkBenchmarks } from '../TreeBenchmarks'
import type { TreeIsolation } from '../treeIsolation'

export interface RgbPrediction {
  box: number[]
  score: number
  geometry: Polygon
  mask?: MultiPolygon
}
export interface RgbRun {
  model: string
  status: string
  weights_sha256: string
  sample_sha256: string
  truth_sha256: string
  result_sha256: string
  strict_state_dict: boolean
  inference_seconds: number
  load_seconds: number
  predictions: RgbPrediction[]
}
export interface RgbSample {
  id: string
  name: string
  image: string
  width: number
  height: number
  coordinates: [number, number][]
  centre: [number, number]
  source_crs: string
  transform: number[]
  image_sha256: string
  georeference_sha256: string
  georeference_pixels_verified: boolean
  truth: number[][]
  truth_geometries: Polygon[]
  models: Record<string, RgbRun>
}
export interface ComparisonData {
  benchmark: BenchmarkData
  rgb: { schema_version: number; scope: string; mask_display: string; samples: RgbSample[] }
  shapes: { schema_version: number; source_sha256: string; crops: (TreeCrop & { review_note: string })[] }
  provenance: Pick<TreeIsolation, 'source_sha256' | 'label_grid_sha256' | 'input_sha256'>
}
export const EMPTY_FEATURES: FeatureCollection = { type: 'FeatureCollection', features: [] }
export function validateComparisonData(data: ComparisonData, sourceSha: string) {
  if (data.provenance.source_sha256 !== sourceSha) throw Error('Comparison data belongs to a different LiDAR tile')
  checkBenchmarks(data.benchmark, data.provenance)
  if (data.rgb.schema_version !== 1 || !data.rgb.samples.length || data.rgb.samples.length > 10)
    throw Error('Invalid RGB comparison schema')
  for (const sample of data.rgb.samples) {
    if (
      !sample.georeference_pixels_verified ||
      !sample.image.startsWith('data:image/png;base64,') ||
      sample.coordinates.length !== 4 ||
      sample.truth.length !== sample.truth_geometries.length
    )
      throw Error('RGB georeference or reference data mismatch')
    for (const run of Object.values(sample.models)) {
      if (run.status !== 'inference_completed' || !run.strict_state_dict || run.sample_sha256 !== sample.image_sha256)
        throw Error('Unverified RGB model run')
      if (
        run.predictions.some(
          (p) =>
            !Number.isFinite(p.score) ||
            p.score < 0 ||
            p.score > 1 ||
            p.box.length !== 4 ||
            p.box.some((n) => !Number.isFinite(n)),
        )
      )
        throw Error('Invalid RGB output')
    }
  }
  if (
    data.shapes.schema_version !== 1 ||
    data.shapes.source_sha256 !== sourceSha ||
    !data.shapes.crops.length ||
    data.shapes.crops.length > 10
  )
    throw Error('Shape review source mismatch')
  for (const crop of data.shapes.crops) {
    if (crop.source_sha256 !== sourceSha || crop.points.length > 150000 || crop.budget_limited)
      throw Error('Invalid original-return crop')
    if (crop.points.some((p) => ![p.lon, p.lat, p.z, p.height, p.index].every(Number.isFinite)))
      throw Error('Invalid original return')
  }
}
export function boxDiagnostics(
  predictions: Pick<RgbPrediction, 'box' | 'score'>[],
  truth: number[][],
  threshold: number,
) {
  const selected = predictions.filter((p) => p.score >= threshold).sort((a, b) => b.score - a.score),
    used = new Set<number>()
  const matched = new Set<number>()
  for (const p of selected) {
    let best = -1,
      bestIou = -1
    truth.forEach((b, j) => {
      if (used.has(j)) return
      const a = p.box,
        intersection =
          Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
          Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
      const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
      const iou = union > 0 ? intersection / union : 0
      if (iou > bestIou) {
        best = j
        bestIou = iou
      }
    })
    if (best >= 0 && bestIou >= 0.5) {
      used.add(best)
      matched.add(predictions.indexOf(p))
    }
  }
  return {
    selected,
    predictions: selected.length,
    matched: used.size,
    falsePositives: selected.length - used.size,
    missed: truth.length - used.size,
    precision: selected.length ? used.size / selected.length : null,
    recall: truth.length ? used.size / truth.length : null,
    matchedIndexes: matched,
  }
}
export function rgbFeatures(sample: RgbSample, model: string, threshold: number, masks: boolean): FeatureCollection {
  const run = sample.models[model]
  if (!run) return EMPTY_FEATURES
  return {
    type: 'FeatureCollection',
    features: run.predictions.flatMap((p, index) =>
      p.score >= threshold
        ? [
            {
              type: 'Feature' as const,
              geometry: masks && p.mask ? p.mask : p.geometry,
              properties: {
                kind: 'prediction',
                id: `${model}-${index}`,
                score: p.score,
                colour: ['#f59e0b', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'][index % 5],
              },
            },
          ]
        : [],
    ),
  }
}
