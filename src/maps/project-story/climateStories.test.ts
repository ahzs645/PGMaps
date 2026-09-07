import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { normalizeProjectPackage, type ProjectStoryClimateDef } from '@/lib/projectPackages'
import { climateColor, climateLegend } from './adapters/climateStyle'
import {
  decodeTile,
  selectBand,
  type Product,
  type Grid,
} from '../../../vendor/bcdatamapper/datascrapers/climate/climatedata-ca/bc-climate/deckgl.mjs'

const filenames = readdirSync('public/data/projects').filter(
  (name) => name.startsWith('bc-climate-') || name === 'northern-health-climate-resilience.json',
)
const projects = filenames.map((name) => JSON.parse(readFileSync(`public/data/projects/${name}`, 'utf8')))

describe('R2 climate story collection', () => {
  it('registers 18 categories and a separate report narrative without embedded climate data', () => {
    expect(projects).toHaveLength(19)
    const products = new Set<string>()
    for (const raw of projects) {
      const p = normalizeProjectPackage(raw)!
      expect(p.workspace?.type).toBe('story-map')
      if (p.workspace?.type !== 'story-map') throw new Error('Missing story workspace')
      expect(p.workspace.layers).toHaveLength(raw.workspace.layers.length)
      for (const layer of p.workspace.layers) {
        if (layer.climate) {
          products.add(layer.climate.product)
          expect(layer.data).toBe(
            'https://data.map.ahmad.sh/climate/bc-climate-u6/releases/01b4b7e982f9b2e6d042/manifest.json',
          )
          expect(layer).not.toHaveProperty('features')
          expect(layer.climate).not.toHaveProperty('values')
        }
      }
      for (const scene of p.scenes)
        for (const id of scene.visibleLayerIds) expect(p.workspace.layers.some((layer) => layer.id === id)).toBe(true)
      const scales = new Map<string, string>()
      for (const layer of p.workspace.layers)
        if (layer.climate) {
          const scale = JSON.stringify([layer.climate.domain, layer.climate.colors, layer.climate.breaks])
          expect(scales.get(layer.climate.product) ?? scale).toBe(scale)
          scales.set(layer.climate.product, scale)
        }
    }
    expect(products.size).toBe(18)
  })
  it('covers all seasons and archive snow periods without fabricating snow percentiles', () => {
    const seasonal = projects.find((p) => p.slug === 'bc-climate-seasonal-precipitation')
    expect(
      new Set(seasonal.workspace.layers.map((l: { climate: ProjectStoryClimateDef }) => l.climate.season)),
    ).toEqual(new Set(['winter', 'spring', 'summer', 'autumn']))
    const snow = projects.find((p) => p.slug === 'bc-climate-precipitation-as-snow')
    expect(snow.scenes).toHaveLength(4)
    for (const layer of snow.workspace.layers) expect(layer.climate.percentile).toBeNull()
    for (const scene of snow.scenes) expect(scene.camera.zoom - 1.5).toBeGreaterThanOrEqual(7)
  })
  it('separates report-reported regional summaries and flags hospital location uncertainty', () => {
    const nh = projects.find((p) => p.slug === 'northern-health-climate-resilience')
    const sites = nh.scenes.filter((s: { kicker: string }) => s.kicker.includes('Hospital communities'))
    expect(sites).toHaveLength(18)
    expect(nh.sourceNote).toContain('not an official Northern Health')
    expect(sites.some((s: { text: string }) => s.text.includes('geocoded_needs_review'))).toBe(true)
    for (const scene of nh.scenes)
      if (scene.callout?.label.includes('population-weighted'))
        expect(scene.callout.detail).toContain('not recalculated')
  })
})

describe('native climate display and decoder integration', () => {
  const style: ProjectStoryClimateDef = {
    product: 'test',
    horizon: '2071-2100',
    percentile: 'p50',
    measure: 'absolute',
    baseline: null,
    season: 'annual',
    units: 'days',
    domain: [0, 20],
    colors: ['#000000', '#ffffff'],
  }
  it('uses matching fixed bins for cells and the legend, including clamped endpoints', () => {
    expect(climateColor(-1, style)).toEqual([0, 0, 0, 255])
    expect(climateColor(9.99, style)).toEqual([0, 0, 0, 255])
    expect(climateColor(10, style)).toEqual([255, 255, 255, 255])
    expect(climateColor(200, style)).toEqual([255, 255, 255, 255])
    expect(climateLegend(style).map((e) => e.label)).toEqual(['< 10 days', '≥ 10 days'])
    const unequal = { ...style, breaks: [5] }
    expect(climateColor(5, unequal)).toEqual([255, 255, 255, 255])
    expect(climateLegend(unequal).map((e) => e.label)).toEqual(['< 5 days', '≥ 5 days'])
  })
  it('runs the scraper-owned decoder without rounding values or turning nodata into zero', () => {
    const product: Product = {
      id: 'test',
      grid: 'test',
      label: 'Test',
      units: 'days',
      tiles: [],
      bands: [{ ...style, min: 0, max: 4 }],
    }
    const tile = {
      id: 'r0-c0',
      row: 0,
      col: 0,
      width: 2,
      height: 1,
      count: 2,
      geometry: 'g.json',
      bounds: [-123, 53, -121, 54] as [number, number, number, number],
    }
    const grid: Grid = { id: 'test', xEdges: [-123, -122, -121], yEdges: [54, 53], tiles: [tile] }
    const bytes = new Uint8Array(16),
      view = new DataView(bytes.buffer)
    view.setFloat64(0, 3.141592653589793, true)
    view.setFloat64(8, NaN, true)
    expect(
      selectBand(product, {
        horizon: style.horizon,
        percentile: 'p50',
        measure: 'absolute',
        baseline: null,
        season: 'annual',
      }).index,
    ).toBe(0)
    const cells = decodeTile(grid, tile, [0, 1], bytes, product, 0)
    expect(cells.features).toHaveLength(1)
    expect(cells.features[0].properties.value).toBe(Math.PI)
    expect(cells.features[0].geometry.coordinates[0]).toEqual([
      [-123, 53],
      [-122, 53],
      [-122, 54],
      [-123, 54],
      [-123, 53],
    ])
    expect(() =>
      selectBand(
        { ...product, bands: [...product.bands, ...product.bands] },
        { horizon: style.horizon, percentile: 'p50', measure: 'absolute', baseline: null, season: 'annual' },
      ),
    ).toThrow('exactly one band')
  })
})
