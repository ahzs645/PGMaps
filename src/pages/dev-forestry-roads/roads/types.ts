/** Serializable, projected-metre inputs for the browser adaptation of LandSciTech/roads. */
export interface RoadsGrid {
  /** Centre of the north-west cell. Rows progress south; columns progress east. */
  origin: [number, number]
  cellM: number
  width: number
  height: number
  /** Row-major weights. NaN cells cannot be traversed. */
  values: Float64Array
}

export type RoadsMethod = 'lcp' | 'ilcp' | 'mst' | 'snap'
export type RoadsNeighbourhood = 'rook' | 'queen' | 'octagon'
export type RoadsOrdering = 'closest' | 'farthest' | 'input' | 'random'

export interface GradePenaltyOptions {
  baseCost: number
  limit: number
  penalty: number
  /** Omit for an impassable grade limit; finite values are soft penalties. */
  limitWeight?: number
}

export interface RoadsOptions {
  method: RoadsMethod
  neighbourhood: RoadsNeighbourhood
  weightFunction: 'simple' | 'grade'
  /** True when the input raster already contains road values; false burns supplied road cells to zero. */
  roadsInWeight: boolean
  /** Upstream MST shortcut: seed roads must connect at zero cost; the browser verifies this condition. */
  roadsConnected: boolean
  ordering: RoadsOrdering
  randomSeed: number
  grade: GradePenaltyOptions
  /** Planning extension: disallow a diagonal across either blocked orthogonal neighbour. */
  preventCornerCutting: boolean
  /** Upstream uses overloaded weight values; terrain mode uses a separate unmodified elevation raster. */
  gradeMode: 'upstream' | 'terrain'
}

export interface RoadsLanding {
  id: string
  name?: string
  /** Zero-based cell index. Preserve out-of-grid indexes for explicit rejection. */
  cell: number
}

export interface RoadsInput {
  grid: RoadsGrid
  roadCells: number[]
  landings: RoadsLanding[]
  options?: Partial<Omit<RoadsOptions, 'grade'>> & { grade?: Partial<GradePenaltyOptions> }
  /** Required for gradeMode='terrain'. Same dimensions and units as grid. */
  elevations?: Float64Array
}

/** Compact undirected graph. A path zeroes weights only, never recomputes adjacent edge costs. */
export interface RoadsGraph {
  cellCount: number
  offsets: Uint32Array
  neighbours: Uint32Array
  edgeIds: Uint32Array
  from: Uint32Array
  to: Uint32Array
  weights: Float64Array
  /** Original edge weights, retained for reproducible objective accounting. */
  baseWeights: Float64Array
  lengths: Float64Array
  passable: Uint8Array
}

export interface RoadsCallbacks {
  shouldAbort?: () => boolean
  onProgress?: (progress: { phase: 'graph' | 'routing' | 'mst'; completed: number; total: number }) => void
}

export interface RoadsDistanceTree {
  distances: Float64Array
  previous: Int32Array
  previousEdge: Int32Array
}

export interface RoadsPath {
  id: string
  fromCell: number
  toCell: number
  cells: number[]
  /** Relative package objective, not a currency estimate. */
  objective: number
  lengthM: number
  newLengthM: number
  reusedLengthM: number
  targetIds: string[]
}

export interface RoadsTargetResult extends RoadsLanding {
  status: 'connected' | 'already-connected' | 'unreachable' | 'outside' | 'blocked'
  pathIds: string[]
  message?: string
}

export interface RoadsSimulation {
  version: 1
  grid: RoadsGrid
  options: RoadsOptions
  graph: RoadsGraph
  /** Original supplied seed cells, retained separately from subsequently constructed roads. */
  seedRoadCells: number[]
  /** Supplied seed cells plus cells reached by previous stages. */
  roadCells: number[]
  /** Distinguishes zero-cost new construction from an already existing road. */
  constructedEdges: Uint32Array
  stage: number
  cumulativeNewLengthM: number
  cumulativeObjective: number
}

export interface RoadsResult {
  method: RoadsMethod
  paths: RoadsPath[]
  targets: RoadsTargetResult[]
  /** Unique edge lengths over this stage, so overlapping paths are never double-counted. */
  newLengthM: number
  reusedLengthM: number
  /** Sum of original weights on unique newly constructed edges; excludes existing-road travel. */
  objective: number
  warnings: string[]
  simulation: RoadsSimulation
}

/**
 * A result without its routing graph (~50 MB at the cell limit). Workers return this form so
 * the main thread does not retain one graph per compared method; continue a simulation in the worker.
 */
export type RoadsResultSummary = Omit<RoadsResult, 'simulation'> & {
  simulation: Omit<RoadsSimulation, 'graph'>
}
