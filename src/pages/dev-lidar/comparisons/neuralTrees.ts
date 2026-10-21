import type { FeatureCollection, Point, Polygon } from 'geojson'
import type { TreeCrop } from '../treeIsolation'
import type { NeuralModel, NeuralSample, NeuralSnapshot } from './neuralData'
export interface NeuralTreeExample {
  id: string
  model: NeuralModel
  chunk: string
  instance: number
  centre: [number, number]
  ground_m: number
  core_returns: number
  height_max_m: number
  height_p95_m: number
  width_m: number
  touches_core_boundary: boolean
  points: NeuralSample['points']
  semantic: number[]
}
export interface NeuralTreeExamples {
  schema_version: number
  source_sha256: string
  snapshot_utc: string
  scope: string
  display_thinned: boolean
  trees: NeuralTreeExample[]
}
export function checkTreeExamples(data: NeuralTreeExamples, snapshot: NeuralSnapshot) {
  if (
    data.schema_version !== 1 ||
    data.source_sha256 !== snapshot.source_sha256 ||
    data.snapshot_utc !== snapshot.snapshot_utc ||
    data.scope !== 'chunk_local_core_candidates' ||
    data.display_thinned ||
    !data.trees.length
  )
    throw Error('Tree examples do not match this preliminary run')
  if (new Set(data.trees.map((t) => t.id)).size !== data.trees.length) throw Error('Duplicate candidate identity')
  for (const t of data.trees) {
    if (
      !['sat', 'forainet'].includes(t.model) ||
      t.instance < 0 ||
      !snapshot.samples.some((s) => s.id === t.chunk) ||
      t.points.length !== t.core_returns ||
      t.semantic.length !== t.points.length ||
      new Set(t.points.map((p) => p[4])).size !== t.points.length ||
      t.points.some((p) => p.length !== 5 || p.some((n) => !Number.isFinite(n)))
    )
      throw Error('Invalid candidate source points')
  }
}
export function treeExampleCrop(data: NeuralTreeExamples, tree: NeuralTreeExample, sample?: NeuralSample): TreeCrop {
  const ids = new Set(tree.points.map((p) => p[4]))
  const points = [...tree.points]
  if (sample) {
    const cos = Math.cos((tree.centre[1] * Math.PI) / 180)
    const radius = tree.width_m / 2 + 4
    points.push(
      ...sample.points.filter(
        (p) =>
          !ids.has(p[4]) &&
          Math.hypot((p[0] - tree.centre[0]) * 111320 * cos, (p[1] - tree.centre[1]) * 111320) <= radius,
      ),
    )
  }
  return {
    id: tree.id,
    centre: tree.centre,
    ground_m: tree.ground_m,
    source_sha256: data.source_sha256,
    loaded_points: points.length,
    loaded_nodes: 1,
    available_nodes: 1,
    budget_limited: !!sample,
    withheld_filtered: false,
    points: points.map(([lon, lat, z, height, index]) => ({
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
export function treeExampleAssignments(tree: NeuralTreeExample, crop: TreeCrop, semantic: boolean) {
  const labels = new Map(
    tree.points.map((p, i) => [p[4], semantic ? `${tree.model}-class-${tree.semantic[i]}` : tree.id]),
  )
  return Object.fromEntries(crop.points.map((p) => [`${p.node}:${p.index}`, labels.get(p.index) ?? '0']))
}
export function treeLocations(
  trees: NeuralTreeExample[],
  selected: NeuralTreeExample,
): FeatureCollection<Point | Polygon> {
  const xs = selected.points.map((p) => p[0]),
    ys = selected.points.map((p) => p[1])
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys)
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
              [x0, y0],
            ],
          ],
        },
        properties: { id: selected.id, selected: true, colour: '#e11d48' },
      },
      ...trees.map((t) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: t.centre },
        properties: { id: t.id, selected: t.id === selected.id, colour: t.id === selected.id ? '#e11d48' : '#047857' },
      })),
    ],
  }
}
export function treePointCsv(data: NeuralTreeExamples, tree: NeuralTreeExample) {
  return (
    `# ${tree.id}; source_sha256=${data.source_sha256}; core-only model candidate, not a verified tree\nlongitude,latitude,elevation_m,height_above_dtm_m,source_row,model_class\n` +
    tree.points.map((p, i) => [...p, tree.semantic[i]].join(',')).join('\n') +
    '\n'
  )
}
