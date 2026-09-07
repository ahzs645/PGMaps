import {
  decodeTile,
  fetchBytes,
  selectBand,
  tilesInBounds,
  type Cells,
  type Grid,
  type Product,
  type Tile,
} from '../../../../vendor/bcdatamapper/datascrapers/climate/climatedata-ca/bc-climate/deckgl.mjs'
import type { ResolvedLayer } from '../storyScene'

export const MAX_VIEW_CELLS = 180_000
const MIB = 1024 * 1024
export const PREFETCH_BYTES = 32 * MIB
export type Extent = [number, number, number, number]
type Manifest = {
  format: string
  manifest?: string
  scenario?: string
  products: { id: string; path: string }[]
  grids: Record<string, { path: string }>
}
type ReadOptions = { signal: AbortSignal; speculative?: { remaining: number } }
export type ClimateTile = {
  id: string
  resolved: ResolvedLayer
  data: Cells
  scenario: string
}
export class ClimateZoomError extends Error {}
class PrefetchBudgetError extends Error {}

export function canPrefetch(hidden: boolean, connection?: { saveData?: boolean; effectiveType?: string }) {
  return !hidden && !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '')
}

/** App-owned transport policy; source parsing/Float64 decoding stay scraper-owned.
 * One store per mounted story, keyed by absolute release URL. Raw decompressed
 * bytes use a byte-budgeted LRU; speculative reads never evict foreground data.
 * Decoded GeoJSON is owned only by the displayed/staging scene, not this cache.
 */
export class ClimateStore {
  private cache = new Map<string, Uint8Array>()
  private bytes = 0
  private pins = new Map<string, string>()
  constructor(
    readonly maxBytes = 96 * MIB,
    private fetcher = fetchBytes,
  ) {}
  get retainedBytes() {
    return this.bytes
  }
  clear() {
    this.clearCache()
    this.pins.clear()
  }
  /** Retry transport/decoding failures without changing the pinned release. */
  clearCache() {
    this.cache.clear()
    this.bytes = 0
  }

  private async read(url: string, options: ReadOptions, expectedBytes = 0) {
    options.signal.throwIfAborted()
    const hit = this.cache.get(url)
    if (hit) {
      // Speculation must not change the foreground working set's eviction order.
      if (!options.speculative) {
        this.cache.delete(url)
        this.cache.set(url, hit)
      }
      return hit
    }
    const room = this.maxBytes - this.bytes
    if (options.speculative && (expectedBytes > Math.min(room, options.speculative.remaining) || room <= 0))
      throw new PrefetchBudgetError()
    const bytes = await this.fetcher(url, { signal: options.signal })
    options.signal.throwIfAborted() // canceled responses must never populate a later scene's cache
    if (options.speculative) {
      options.speculative.remaining -= bytes.byteLength
      if (options.speculative.remaining < 0 || bytes.byteLength > this.maxBytes - this.bytes)
        throw new PrefetchBudgetError()
    }
    if (bytes.byteLength <= this.maxBytes) {
      while (this.bytes + bytes.byteLength > this.maxBytes) {
        const oldest = this.cache.keys().next().value!
        this.bytes -= this.cache.get(oldest)!.byteLength
        this.cache.delete(oldest)
      }
      this.cache.set(url, bytes)
      this.bytes += bytes.byteLength
    }
    return bytes
  }
  private async json<T>(url: string, options: ReadOptions): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.read(url, options))) as T
  }

  private async plan(layers: ResolvedLayer[], extent: Extent, zoom: number, options: ReadOptions) {
    const plans: {
      resolved: ResolvedLayer
      product: Product
      grid: Grid
      tiles: Tile[]
      base: URL
      scenario: string
      slot: number
    }[] = []
    let cells = 0
    for (const [slot, resolved] of layers.entries()) {
      const c = resolved.layer.climate!
      if (zoom < (c.minZoom ?? 0))
        throw new ClimateZoomError(
          `Zoom in to level ${c.minZoom} to view ${resolved.label} at its native resolution. Coverage remains BC-wide.`,
        )
      const source = new URL(resolved.layer.data, globalThis.location?.href ?? 'http://localhost/').href
      let url = this.pins.get(source) ?? source
      let manifest = await this.json<Manifest>(url, options)
      if (manifest.manifest) {
        url = new URL(manifest.manifest, url).href
        manifest = await this.json<Manifest>(url, options)
      }
      if (manifest.format !== 'bcdatamapper-native-grid-v1') throw new Error('Unsupported climate format')
      this.pins.set(source, url)
      const base = new URL('.', url)
      const item = manifest.products.find((p) => p.id === c.product)
      if (!item) throw new Error(`Unknown climate indicator: ${c.product}`)
      const product = await this.json<Product>(new URL(item.path, base).href, options)
      if (!manifest.grids[product.grid]) throw new Error(`Unknown grid: ${product.grid}`)
      const grid = await this.json<Grid>(new URL(manifest.grids[product.grid].path, base).href, options)
      const { band } = selectBand(product, bandSelection(resolved))
      if (band.units !== c.units) throw new Error(`Display units do not match ${resolved.label}`)
      const tiles = tilesInBounds(grid, extent)
      cells += tiles.reduce((sum, t) => sum + t.count, 0)
      if (cells > MAX_VIEW_CELLS)
        throw new ClimateZoomError(
          'Zoom in or turn off a climate layer to inspect native cells without loading the entire fine grid.',
        )
      plans.push({
        resolved,
        product,
        grid,
        tiles,
        base,
        slot,
        scenario: manifest.scenario === 'ssp585' ? 'SSP5-8.5' : (manifest.scenario ?? 'Scenario not specified'),
      })
    }
    return plans
  }

  async load(
    layers: ResolvedLayer[],
    extent: Extent,
    zoom: number,
    signal: AbortSignal,
    prefetch = false,
  ): Promise<ClimateTile[]> {
    const options: ReadOptions = { signal, ...(prefetch ? { speculative: { remaining: PREFETCH_BYTES } } : {}) }
    const loaded: ClimateTile[] = []
    // Validate the entire view's cell budget BEFORE requesting any value blocks.
    const plans = await this.plan(layers, extent, zoom, options)
    for (const { resolved, product, grid, tiles, base, scenario, slot } of plans) {
      const { index } = selectBand(product, bandSelection(resolved))
      for (const tile of tiles) {
        const item = product.tiles.find((t) => t.id === tile.id)
        if (!item) throw new Error(`Missing value tile: ${tile.id}`)
        const geometry = await this.json<{ indices: number[] }>(new URL(tile.geometry, base).href, options)
        const values = await this.read(new URL(item.path, base).href, options, product.bands.length * tile.count * 8)
        signal.throwIfAborted()
        // Read-ahead retains bytes only, never a second fine-grid polygon scene.
        if (!prefetch)
          loaded.push({
            id: `climate-${base.href}-${slot}-${grid.id}-${tile.id}`,
            resolved,
            scenario,
            data: decodeTile(grid, tile, geometry.indices, values, product, index),
          })
      }
    }
    return loaded
  }
}

function bandSelection({ layer: { climate: c } }: ResolvedLayer) {
  return {
    horizon: c!.horizon,
    percentile: c!.percentile,
    season: c!.season,
    measure: c!.measure,
    baseline: c!.baseline,
  }
}

/** Stable geometry lets Deck update colours without re-tessellating the grid.
 * A changed nodata mask must replace geometry. Properties always come from the
 * newly selected band, including picking; never from retained geometry objects.
 */
export function reuseClimateGeometry(previous: Cells | undefined, next: Cells): Cells {
  return previous &&
    previous.features.length === next.features.length &&
    previous.features.every((f, i) => f.properties.cellId === next.features[i].properties.cellId)
    ? previous
    : next
}
