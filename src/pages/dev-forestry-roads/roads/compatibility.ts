/** Review inventory of all nine public exports in the pinned LandSciTech/roads NAMESPACE. */
export const ROADS_UPSTREAM = {
  repository: 'LandSciTech/roads',
  version: '1.2.2',
  commit: '08c462de51076b550473cb709da633314c32cd87',
  source: 'https://github.com/LandSciTech/roads/tree/08c462de51076b550473cb709da633314c32cd87',
  license: 'Apache-2.0',
} as const

export const ROADS_COMPATIBILITY = [
  {
    api: 'projectRoads',
    browser: 'Four network methods, neighbourhoods, landing order and staged graph reuse',
    level: 'algorithm-adaptation',
    note: 'Projected-metre grids and cell targets replace sf/terra objects. Disconnected and blocked targets are explicit. Engineering constraints remain a separate design review.',
  },
  {
    api: 'simpleCostFn',
    browser: 'Distance × mean endpoint cost',
    level: 'formula-port',
    note: 'Returns a relative objective; non-negative finite graph weights are required.',
  },
  {
    api: 'gradePenaltyFn',
    browser: 'Upstream grade formula plus a separate terrain-aware planning mode',
    level: 'formula-port',
    note: 'Raw compatibility retains overloaded zero/negative values and upstream unit scaling; terrain mode keeps elevations separate from road masks.',
  },
  {
    api: 'getLandingsFromTarget',
    browser: 'Interior, regular-density and seeded random landing candidates',
    level: 'geometry-adaptation',
    note: 'Supports polygon holes, multipolygons, labelled raster blocks and binary patches. Uses metres/hectares, a different deterministic sampler and explicit budgets.',
  },
  {
    api: 'getDistFromSource',
    browser: 'Exact Euclidean source-cell proximity raster',
    level: 'replacement-for-deprecated-api',
    note: 'Upstream now delegates to terra::distance. Browser output is straight-line metres, not travel or haul distance.',
  },
  {
    api: 'rasterizeLine',
    browser: 'Supercover road-cell mask',
    level: 'replacement-for-deprecated-api',
    note: 'Upstream now delegates to terra::rasterize. Browser burning preserves missing terrain by default and explicitly includes touched corners.',
  },
  {
    api: 'rasterToLineSegments',
    browser: 'Nearest-pair or least-cost MST raster reconstruction',
    level: 'geometry-adaptation',
    note: 'Inferred cells and disconnected components are reported. It cannot establish surveyed junctions or bridge topology.',
  },
  {
    api: 'plotRoads',
    browser: 'Interactive map, network comparison and downloadable spatial results',
    level: 'interface-equivalent',
    note: 'Browser rendering replaces the R plotting function; it is not an R graphics-device port.',
  },
  {
    api: 'prepExData',
    browser: 'Browser-native teaching scenario factory',
    level: 'data-format-equivalent',
    note: 'Includes the exact numeric CLUS reference fixture and five new synthetic scenarios. Packed R demoScen/DEM objects are not bundled.',
  },
] as const
