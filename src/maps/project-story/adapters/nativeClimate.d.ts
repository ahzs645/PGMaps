/** Types for the scraper-owned adapter. Bundle its local code, never remote JS. */
declare module '*bc-climate/deckgl.mjs' {
  import type { FeatureCollection, Polygon } from 'geojson'
  export interface Band {
    horizon: string
    percentile: string | null
    measure: string
    baseline: string | null
    season: string
    units: string
    min: number
    max: number
  }
  export interface Product {
    id: string
    grid: string
    label: string
    units: string
    bands: Band[]
    tiles: { id: string; path: string }[]
    unitNote?: string
  }
  export interface Tile {
    id: string
    row: number
    col: number
    width: number
    height: number
    count: number
    geometry: string
    bounds: [number, number, number, number]
  }
  export interface Grid {
    id: string
    xEdges: number[]
    yEdges: number[]
    tiles: Tile[]
  }
  export interface CellProperties extends Band {
    cellId: string
    value: number
    indicator: string
  }
  export type Cells = FeatureCollection<Polygon, CellProperties>
  export type Selection = Pick<Band, 'horizon' | 'percentile' | 'measure' | 'baseline' | 'season'>
  export interface Climate {
    manifest: { scenario?: string }
    product(id: string, options?: { signal?: AbortSignal }): Promise<Product>
    grid(id: string, options?: { signal?: AbortSignal }): Promise<Grid>
    tile(
      product: Product,
      grid: Grid,
      tile: Tile,
      selection: Selection,
      options?: { signal?: AbortSignal },
    ): Promise<Cells>
    clearCache(): void
  }
  export function openClimate(url: string, options?: { signal?: AbortSignal; cacheEntries?: number }): Promise<Climate>
  export function fetchBytes(url: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>
  export function tilesInBounds(grid: Grid, bounds?: [number, number, number, number]): Tile[]
  export function selectBand(product: Product, selection: Selection): { band: Band; index: number }
  export function decodeTile(
    grid: Grid,
    tile: Tile,
    indices: number[],
    bytes: Uint8Array,
    product: Product,
    bandIndex: number,
  ): Cells
}
