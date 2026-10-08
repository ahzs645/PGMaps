import type { Bundle, Geometry, Graph, Grid } from './engine.js'
import type { FlattenData } from './cities'
export type SearchResult = { name: string; kind: string; lon: number; lat: number; node?: number }
export class Index {
  constructor(graph: Graph, geometry: Geometry, bundle: Bundle, data?: FlattenData)
  search(query: string, limit?: number): SearchResult[]
  describe(node: number, grid: Grid): string
}
