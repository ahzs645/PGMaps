import type { FeatureCollection, Polygon } from 'geojson'
import type { TreeCrop } from '../treeIsolation'
import { TREE_COLOURS } from '../treeIsolation'
export type NeuralModel = 'sat' | 'forainet'
export type NeuralColour = 'instance' | 'semantic'
export interface NeuralSample {
  id: string
  centre: [number, number]
  ground_m: number
  original_returns: number
  points: [number, number, number, number, number][]
  models: Record<NeuralModel, { instance: number[]; semantic: number[] }>
}
export interface NeuralSnapshot {
  schema_version: number
  stage: string
  snapshot_utc: string
  source_sha256: string
  total_returns: number
  total_chunks: number
  common_chunks: number
  common_returns: number
  assignment_disagreement_returns: number
  whole_tile_complete: boolean
  global_tree_counts_available: boolean
  same_window_inputs_verified: boolean
  models: Record<NeuralModel, { assigned: number; tree_class: number; semantic_counts: Record<string, number> }>
  bounds: [number, number, number, number]
  outline: FeatureCollection
  cells: FeatureCollection<
    Polygon,
    {
      id: string
      returns: number
      sat_share: number
      forainet_share: number
      disagreement: number
      sat_local_candidates: number
      forainet_local_candidates: number
    }
  >
  samples: NeuralSample[]
}
export const NEURAL_NAMES = { sat: 'SegmentAnyTree', forainet: 'ForAINet' }
export const SEMANTIC_NAMES = {
  sat: ['Non-tree', 'Tree'],
  forainet: ['Low vegetation', 'Ground', 'Stem points', 'Live branches', 'Branches (class 4)'],
}
export function checkNeuralSnapshot(data: NeuralSnapshot, source?: string) {
  if (
    data.schema_version !== 1 ||
    data.stage !== 'preliminary_partial_full_run' ||
    data.whole_tile_complete ||
    data.global_tree_counts_available ||
    !data.same_window_inputs_verified
  )
    throw Error('Invalid preliminary execution scope')
  if (source && data.source_sha256 !== source) throw Error('Neural snapshot belongs to a different LiDAR source')
  if (
    !data.common_returns ||
    data.common_returns > data.total_returns ||
    data.cells.features.length !== data.common_chunks ||
    data.cells.features.reduce((n, f) => n + f.properties.returns, 0) !== data.common_returns
  )
    throw Error('Neural comparison coverage mismatch')
  for (const model of ['sat', 'forainet'] as const) {
    if (
      data.models[model].assigned > data.common_returns ||
      Object.values(data.models[model].semantic_counts).reduce((a, b) => a + b, 0) !== data.common_returns
    )
      throw Error('Neural summary count mismatch')
  }
  if (!data.samples.length) throw Error('Missing original-point samples')
  for (const f of data.cells.features) {
    if (
      [f.properties.sat_share, f.properties.forainet_share, f.properties.disagreement].some(
        (n) => !Number.isFinite(n) || n < 0 || n > 1,
      )
    )
      throw Error('Invalid coverage share')
  }
  for (const s of data.samples) {
    if (
      !s.points.length ||
      s.points.length > 6000 ||
      new Set(s.points.map((p) => p[4])).size !== s.points.length ||
      s.points.some((p) => p.length !== 5 || p.some((n) => !Number.isFinite(n)))
    )
      throw Error('Invalid original-point sample')
    for (const model of ['sat', 'forainet'] as const) {
      if (
        s.models[model].instance.length !== s.points.length ||
        s.models[model].semantic.length !== s.points.length ||
        s.models[model].instance.some((n) => !Number.isInteger(n) || n < -1) ||
        s.models[model].semantic.some((n) => !Number.isInteger(n) || n < 0 || n >= SEMANTIC_NAMES[model].length)
      )
        throw Error('Neural labels do not match source points')
    }
  }
}
export function neuralCrop(snapshot: NeuralSnapshot, sample: NeuralSample): TreeCrop {
  return {
    id: sample.id,
    centre: sample.centre,
    ground_m: sample.ground_m,
    source_sha256: snapshot.source_sha256,
    loaded_points: sample.original_returns,
    loaded_nodes: 1,
    available_nodes: 1,
    budget_limited: sample.points.length < sample.original_returns,
    withheld_filtered: false,
    points: sample.points.map(([lon, lat, z, height, index]) => ({
      lon,
      lat,
      z,
      height,
      index,
      node: 'original-laz-row',
      classification: -1,
    })),
  }
}
export const semanticLabel = (model: NeuralModel, cls: number) => `${model}-class-${cls}`
export function neuralAssignments(sample: NeuralSample, model: NeuralModel, colour: NeuralColour) {
  return Object.fromEntries(
    sample.points.map((p, i) => [
      `original-laz-row:${p[4]}`,
      colour === 'semantic'
        ? semanticLabel(model, sample.models[model].semantic[i])
        : sample.models[model].instance[i] < 0
          ? '0'
          : `${model}-candidate-${sample.models[model].instance[i]}`,
    ]),
  )
}
export function neuralLabelColour(label: string) {
  return TREE_COLOURS[[...label].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TREE_COLOURS.length]
}
export function neuralCoverage(snapshot: NeuralSnapshot, model: NeuralModel, disagreement: boolean): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: snapshot.cells.features.map((f) => {
      const t = disagreement ? f.properties.disagreement : f.properties[`${model}_share`]
      const hue = disagreement ? 35 - t * 35 : 170 - t * 60
      return {
        ...f,
        properties: { ...f.properties, colour: `hsl(${hue.toFixed(0)},70%,${(92 - t * 52).toFixed(0)}%)` },
      }
    }),
  }
}
