import { describe, expect, it } from 'vitest'
import {
  CCISS_MAP_CATALOG,
  DEFAULT_CCISS_SELECTION,
  ccissMapOptions,
  ccissTileId,
  normalizeCcissSelection,
} from './layers'
import {
  CCISS_PREPARED_MAP_PRODUCTS,
  ccissPreparedMapProduct,
  ccissSourceOptions,
  resolveCcissMapSource,
  type CcissPreparedMapProduct,
} from './mapSources'

describe('CCISS published map catalogue and sources', () => {
  it('preserves source tile identifiers and only offers controls that affect them', () => {
    expect(ccissTileId(DEFAULT_CCISS_SELECTION)).toBe('NewFeas_1961_1990_ref_C4_Pl')
    const future = { ...DEFAULT_CCISS_SELECTION, period: '2061_2080' as const, statistic: 'MeanChange' as const }
    expect(ccissTileId(future)).toBe('MeanChange_2061_2080_C4_Pl')
    expect(ccissMapOptions(future)).toMatchObject({ gcms: [], showZoneGrouping: false })
    expect(ccissMapOptions(future).statistics.map((option) => option.id)).toEqual(['NewFeas', 'MeanChange'])
    const bgc = { ...future, kind: 'bgc' as const, gcm: 'MIROC6' as const, byZone: true }
    expect(ccissTileId(bgc)).toBe('bgc_MIROC6_2061_2080_Subzone')
    expect(ccissMapOptions(bgc)).toMatchObject({ species: [], edatopes: [], statistics: [], showZoneGrouping: false })
    expect(ccissMapOptions(bgc).gcms).toHaveLength(CCISS_MAP_CATALOG.gcms.length)
    expect(ccissMapOptions({ ...bgc, period: '2001_2020_obs' }).gcms).toEqual([])
    expect(ccissTileId({ ...bgc, period: '2001_2020_obs' })).toBe('bgc_Ensemble_2001_2020_obs_Zone')
  })

  it('only retains zone grouping for historical BGC products and future ensembles', () => {
    const base = { ...DEFAULT_CCISS_SELECTION, kind: 'bgc' as const, byZone: true }
    for (const period of ['1961_1990', '1961_1990_ref', '2001_2020_obs'] as const) {
      const selection = { ...base, period, gcm: 'MIROC6' as const }
      expect(ccissMapOptions(selection).showZoneGrouping).toBe(true)
      expect(normalizeCcissSelection(selection).byZone).toBe(true)
      expect(ccissTileId(selection)).toBe(`bgc_Ensemble_${period}_Zone`)
    }
    const ensemble = { ...base, period: '2081_2100' as const, gcm: 'Ensemble' as const }
    expect(ccissMapOptions(ensemble).showZoneGrouping).toBe(true)
    expect(normalizeCcissSelection(ensemble).byZone).toBe(true)
    expect(ccissTileId(ensemble)).toBe('bgc_Ensemble_2081_2100_Zone')
    const member = { ...ensemble, gcm: 'MIROC6' as const }
    expect(ccissMapOptions(member).showZoneGrouping).toBe(false)
    expect(normalizeCcissSelection(member).byZone).toBe(false)
    expect(ccissTileId(member)).toBe('bgc_MIROC6_2081_2100_Subzone')
    expect(normalizeCcissSelection({ ...ensemble, kind: 'suitability' }).byZone).toBe(false)
  })

  it('validates saved options without assigning change statistics to reference maps', () => {
    expect(normalizeCcissSelection({})).toEqual(DEFAULT_CCISS_SELECTION)
    expect(normalizeCcissSelection({ ...DEFAULT_CCISS_SELECTION, statistic: 'MeanChange' }).statistic).toBe('NewFeas')
    const bad = { period: 'unknown', species: 'unknown', byZone: 'false' }
    expect(normalizeCcissSelection(bad as unknown as Parameters<typeof normalizeCcissSelection>[0])).toEqual(
      DEFAULT_CCISS_SELECTION,
    )
    const custom = {
      ...CCISS_MAP_CATALOG,
      species: [{ id: 'Fd' as const, label: 'Douglas-fir' }],
      edatopes: [{ id: 'D6' as const, label: 'Rich / hygric' }],
    }
    expect(normalizeCcissSelection({}, custom)).toMatchObject({ species: 'Fd', edatope: 'D6' })
    expect(ccissMapOptions(DEFAULT_CCISS_SELECTION, custom).species).toEqual(custom.species)
  })

  it('never borrows numeric or traced values from another product', () => {
    const future = { ...DEFAULT_CCISS_SELECTION, period: '2061_2080' as const }
    const otherSpecies = { ...DEFAULT_CCISS_SELECTION, species: 'Fd' as const }
    const otherSite = { ...DEFAULT_CCISS_SELECTION, edatope: 'B2' as const }
    for (const unsupported of [future, otherSpecies, otherSite, { ...DEFAULT_CCISS_SELECTION, kind: 'bgc' as const }]) {
      expect(ccissPreparedMapProduct(unsupported)).toBeNull()
      expect(
        ccissSourceOptions(unsupported)
          .filter((option) => option.available)
          .map((option) => option.id),
      ).toEqual(['tiles'])
    }
    expect(resolveCcissMapSource(DEFAULT_CCISS_SELECTION, 'trace')).toMatchObject({
      available: true,
      evidence: 'inferred-display',
    })
    expect(resolveCcissMapSource(DEFAULT_CCISS_SELECTION, 'vector')).toMatchObject({
      available: true,
      evidence: 'numeric-raster',
    })
    expect(resolveCcissMapSource(DEFAULT_CCISS_SELECTION, 'tiles').product).toBeNull()
  })

  it('keeps local raster inspection separate from prepared overlays and tile availability', () => {
    const runtime = { localRaster: true, numericRasterLoaded: true, publishedTilesAvailable: false }
    const options = ccissSourceOptions(DEFAULT_CCISS_SELECTION, runtime)
    expect(options.filter((option) => option.available).map((option) => option.id)).toEqual(['native'])
    expect(options.find((option) => option.id === 'native')).toMatchObject({
      product: null,
      url: null,
      requiresNetwork: false,
      evidence: 'numeric-raster',
    })
    expect(resolveCcissMapSource(DEFAULT_CCISS_SELECTION, 'native', { numericRasterLoaded: false })).toMatchObject({
      available: false,
      evidence: 'numeric-raster',
    })
  })

  it('selects additional prepared products through their registry instead of a species branch', () => {
    const second: CcissPreparedMapProduct = {
      ...CCISS_PREPARED_MAP_PRODUCTS[0],
      id: 'test-Fd-product',
      label: 'Test numeric source',
      selection: { kind: 'suitability', period: '1961_1990_ref', species: 'Fd', edatope: 'C4' },
      numeric: { url: '/test-Fd.tif', cellSizeDegrees: 0.01 },
      vectorManifest: undefined,
      gridTraceManifest: undefined,
      pixelTraceManifest: undefined,
    }
    const selection = { ...DEFAULT_CCISS_SELECTION, species: 'Fd' as const }
    const products = [...CCISS_PREPARED_MAP_PRODUCTS, second]
    expect(ccissPreparedMapProduct(selection, products)?.id).toBe(second.id)
    expect(resolveCcissMapSource(selection, 'native', {}, products)).toMatchObject({
      available: true,
      url: '/test-Fd.tif',
    })
    expect(resolveCcissMapSource(selection, 'vector', {}, products).available).toBe(false)
    expect(resolveCcissMapSource(selection, 'trace', {}, products).available).toBe(false)
    expect(() => ccissPreparedMapProduct(selection, [...products, { ...second, id: 'duplicate' }])).toThrow(
      'Multiple prepared',
    )
  })
})
