export type TravelMode = 'walk' | 'bike'
export type Manifest = { arrays: Record<string, { t: string; o: number; n: number }>; strings: Record<string, { o: number; b: number }>; bytes: number }
export type GraphMeta = { n_nodes: number; n_arcs: number; n_edges: number; scales: { dm: number; cm: number; grade: number; coord: number; stress: number }; names: string[]; classes: string[]; multipliers: Record<string, number[]> }
export type Profile = { d: number[]; z: number[] }
export type RouteStats = { distance_m: number; stress_m: number; elev_gain_m: number; elev_loss_m: number; steepest: number; max_grade: number; avg_abs_grade: number; n_edges: number; start_elev_m: number; end_elev_m: number; profile: Profile }
export type Weights = { alpha: number; beta: number; gamma: number; penalties: number[]; extreme: number; use_class_multiplier: boolean; stress: boolean }
export type Route = { arcs: number[]; cost: number; settled: number; kind?: string }
export type ParetoSearch = { step(budgetMs: number): boolean; solutions: Route[] }
export type LoopSearch = { step(budgetMs: number): boolean; loops: Route[]; accepted: Route[]; last?: Route; tried: number; shortfall: boolean }
export function loadBundle(data: { bundle_url: string; bundle_bytes: number }, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array>
export class Bundle {
  constructor(bytes: Uint8Array, manifest: Manifest)
  text(name: string): string
}
export class Graph {
  constructor(bundle: Bundle, meta: GraphMeta)
  n: number
  m: number
  DM: number
  CM: number
  nodeFlags: Uint8Array
  head: Int32Array
  arcEdge: Int32Array
  nodeLon(node: number): number
  nodeLat(node: number): number
  nodeZ(node: number): number
  modeBit(mode: TravelMode): number
  arcTail(arc: number): number
  route(from: number, to: number, mode: TravelMode, weights: Weights): Route | null
  pareto(from: number, to: number, mode: TravelMode, options: { eps: number; epsNode: number; stress: boolean; dCap: number; gCap: number }): ParetoSearch
  loops(from: number, mode: TravelMode, options: { targetM: number; stress: boolean; outBack: boolean; sectors?: number }): LoopSearch
  summarise(arcs: number[]): RouteStats
  geometry(arcs: number[], geometry: Geometry): [number, number][]
}
export class Geometry {
  constructor(bundle: Bundle, meta: GraphMeta)
  nEdges: number
  DM: number
  bbox: Float32Array
  len: Uint32Array
  starts: Int32Array
  coords: Float32Array
  name: Uint16Array
  names: string[]
  edgeCoords(edge: number): Float32Array
}
export class Grid {
  constructor(longitudes: Float32Array, latitudes: Float32Array, cell: number)
  nearest(longitude: number, latitude: number, accept?: (node: number) => boolean): number
}
