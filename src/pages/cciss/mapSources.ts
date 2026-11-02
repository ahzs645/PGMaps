import { type CcissLayerSelection, ccissTileId, ccissTileUrl } from './layers'

export type CcissRenderSource = 'trace' | 'vector' | 'native' | 'tiles'
export type CcissMapEvidence = 'published-image' | 'inferred-display' | 'numeric-raster'

export interface CcissPreparedMapProduct {
  id: string
  label: string
  selection: Pick<CcissLayerSelection, 'kind' | 'period'> & Partial<CcissLayerSelection>
  /** These products are published maps, never model-member prediction bundles. */
  family: 'published-spatial'
  numeric: { url: string; fallbackUrl?: string; cellSizeDegrees: number }
  vectorManifest?: string
  gridTraceManifest?: string
  pixelTraceManifest?: string
  limits: string
}

/** Additional prepared species/period/condition products use this same contract.
 * Legacy rasters intentionally do not match this registry: their model edition,
 * grid and scenario differ from the published spatial map.
 */
export const CCISS_PREPARED_MAP_PRODUCTS: readonly CcissPreparedMapProduct[] = [
  {
    id: 'mapped-1961-1990-C4-Pl',
    label: 'Mapped reference · 1961–1990 · Pl · C4',
    selection: { kind: 'suitability', period: '1961_1990_ref', species: 'Pl', edatope: 'C4' },
    family: 'published-spatial',
    numeric: {
      url: '/data/cciss/historical-download-1961-1990-C4-Pl.cog.tif',
      fallbackUrl: '/data/cciss/historical-download-1961-1990-C4-Pl.tif',
      cellSizeDegrees: 1 / 360,
    },
    vectorManifest: '/data/cciss/historical-Pl-C4-overviews/manifest.json',
    gridTraceManifest: '/data/cciss/province-grid-trace/overviews/manifest.json',
    pixelTraceManifest: '/data/cciss/public-tile-trace/polygons/manifest.json',
    limits:
      'The numeric download and public image tiles differ at some locations. Traced colours describe the image display; numeric inspection uses the GeoTIFF.',
  },
]

export interface CcissSourceRuntime {
  /** A local file supersedes the hosted numeric raster only for Direct GeoTIFF. */
  localRaster?: boolean
  numericRasterLoaded?: boolean
  /** TileJSON is checked at runtime; a catalogue entry alone cannot verify it. */
  publishedTilesAvailable?: boolean
}

export interface CcissMapSourceOption {
  id: CcissRenderSource
  label: string
  available: boolean
  reason: string | null
  evidence: CcissMapEvidence
  description: string
  product: CcissPreparedMapProduct | null
  url: string | null
  requiresNetwork: boolean
}

export function ccissPreparedMapProduct(
  selection: CcissLayerSelection,
  products = CCISS_PREPARED_MAP_PRODUCTS,
): CcissPreparedMapProduct | null {
  const matches = products.filter((product) =>
    (Object.keys(product.selection) as (keyof CcissLayerSelection)[]).every(
      (key) => product.selection[key] === selection[key],
    ),
  )
  if (matches.length > 1) throw new Error('Multiple prepared CCISS map products match this selection.')
  return matches[0] ?? null
}

/** Source availability and evidence are independent: a display reconstruction
 * can be available without supplying a measured value or a site assessment.
 */
export function ccissSourceOptions(
  selection: CcissLayerSelection,
  runtime: CcissSourceRuntime = {},
  products = CCISS_PREPARED_MAP_PRODUCTS,
): CcissMapSourceOption[] {
  const product = ccissPreparedMapProduct(selection, products)
  const missingProduct = 'No prepared map source matches this species, period and site condition.'
  const localOverride = 'A local GeoTIFF is selected. Use Direct GeoTIFF to inspect that file.'
  const supportedNumeric = product !== null || runtime.localRaster === true
  return [
    {
      id: 'trace',
      label: 'Tile trace',
      available: Boolean(product?.gridTraceManifest) && !runtime.localRaster,
      reason: runtime.localRaster ? localOverride : product?.gridTraceManifest ? null : missingProduct,
      evidence: 'inferred-display',
      description: 'Reconstructed public image colours. Picking reports inferred display classes.',
      product,
      url: product?.gridTraceManifest ?? null,
      requiresNetwork: true,
    },
    {
      id: 'vector',
      label: 'Numeric vector',
      available: Boolean(product?.vectorManifest) && !runtime.localRaster,
      reason: runtime.localRaster ? localOverride : product?.vectorManifest ? null : missingProduct,
      evidence: 'numeric-raster',
      description:
        'Zoom-dependent polygons from the numeric download. Full detail preserves original cells; generalized overviews are labelled when picked.',
      product,
      url: product?.vectorManifest ?? null,
      requiresNetwork: true,
    },
    {
      id: 'native',
      label: 'Direct GeoTIFF',
      available: supportedNumeric && runtime.numericRasterLoaded !== false,
      reason: !supportedNumeric
        ? missingProduct
        : runtime.numericRasterLoaded === false
          ? 'The numeric GeoTIFF is loading or unavailable. Select a local file to retry.'
          : null,
      evidence: 'numeric-raster',
      description: runtime.localRaster
        ? 'The selected local GeoTIFF stays in this browser. Confirm its product, legend and resolution.'
        : 'Draw and inspect the same numeric GeoTIFF. Its cells do not change with display zoom.',
      product: runtime.localRaster ? null : product,
      url: runtime.localRaster ? null : (product?.numeric.url ?? null),
      requiresNetwork: !runtime.localRaster,
    },
    {
      id: 'tiles',
      label: 'Original CCISS tiles',
      available: runtime.publishedTilesAvailable !== false,
      reason:
        runtime.publishedTilesAvailable === false
          ? 'The selected tile set is unavailable from the CCISS tile server.'
          : null,
      evidence: 'published-image',
      description:
        'External CCISS image tiles. Tile colours do not supply numeric samples or model-member predictions.',
      product: null,
      url: ccissTileUrl(ccissTileId(selection)),
      requiresNetwork: true,
    },
  ]
}

export function resolveCcissMapSource(
  selection: CcissLayerSelection,
  source: CcissRenderSource,
  runtime: CcissSourceRuntime = {},
  products = CCISS_PREPARED_MAP_PRODUCTS,
): CcissMapSourceOption {
  return ccissSourceOptions(selection, runtime, products).find((option) => option.id === source)!
}
