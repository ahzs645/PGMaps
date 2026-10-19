import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { initialLidarStyle, LABEL_ANCHOR } from './basemaps'
import { INITIAL_ANALYSIS } from './analysisWorkflows'
import {
  applyCanopyHeatmaps,
  heatmapLegend,
  installCanopyHeatmaps,
  sampleHeatmap,
  type CanopyHeatmaps,
} from './canopyHeatmaps'
const data = JSON.parse(readFileSync(new URL('./heatmaps.generated.json', import.meta.url), 'utf8')) as CanopyHeatmaps
function location(col: number, row: number) {
  const b = data.grid.bounds_mercator,
    x = b[0] + ((col + 0.5) * (b[2] - b[0])) / data.grid.width,
    y = b[3] - ((row + 0.5) * (b[3] - b[1])) / data.grid.height
  return [
    (x / 20037508.342789244) * 180,
    ((2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180) / Math.PI,
  ] as const
}
describe('canopy heatmap measurements and layer transitions', () => {
  it('decodes valid zero, unknown and sampled height/cover independently', () => {
    for (const key of ['height', 'density2', 'density5'] as const) {
      const raster = data.rasters[key],
        bytes = Buffer.from(raster.samples_base64, 'base64')
      expect(bytes.length).toBe(data.grid.width * data.grid.height)
      const valid = bytes.findIndex((v) => v !== 255),
        missing = bytes.findIndex((v) => v === 255)
      const point = location(valid % data.grid.width, Math.floor(valid / data.grid.width))
      expect(sampleHeatmap(data, key, ...point)).toBeCloseTo((bytes[valid] / 254) * raster.sample_maximum, 4)
      const absent = location(missing % data.grid.width, Math.floor(missing / data.grid.width))
      expect(sampleHeatmap(data, key, ...absent)).toBeNull()
      expect(sampleHeatmap(data, key, 0, 0)).toBeNull()
      const zero = bytes.findIndex((v) => v === 0)
      if (zero >= 0)
        expect(sampleHeatmap(data, key, ...location(zero % data.grid.width, Math.floor(zero / data.grid.width)))).toBe(
          0,
        )
    }
    expect(heatmapLegend({ ...INITIAL_ANALYSIS, mode: 'canopy-height' }).max).toBe(40)
    expect(heatmapLegend({ ...INITIAL_ANALYSIS, mode: 'canopy-density', threshold: 5 }).label).toContain('>5 m')
  })
  it('installs once, keeps raster below labels, and replaces opacity/visibility on every transition', () => {
    const style = initialLidarStyle('satellite'),
      sources = new Set<string>(),
      visibility: Record<string, unknown> = {},
      opacity: Record<string, unknown> = {}
    const map = {
      getSource: (id: string) => sources.has(id),
      getLayer: (id: string) => style.layers.find((l) => l.id === id),
      addSource: (id: string, source: unknown) => {
        if (sources.has(id)) throw Error('Duplicate source')
        sources.add(id)
        style.sources[id] = source as never
      },
      addLayer: (layer: (typeof style.layers)[number], before: string) => {
        if (style.layers.some((l) => l.id === layer.id)) throw Error('Duplicate layer')
        style.layers.splice(
          style.layers.findIndex((l) => l.id === before),
          0,
          layer,
        )
      },
      setLayoutProperty: (id: string, _name: string, value: unknown) => {
        visibility[id] = value
      },
      setPaintProperty: (id: string, _name: string, value: unknown) => {
        opacity[id] = value
      },
    }
    installCanopyHeatmaps(map as never, data)
    installCanopyHeatmaps(map as never, data)
    expect(validateStyleMin(style)).toEqual([])
    expect(style.layers.findIndex((l) => l.id === 'canopy-heatmap-height')).toBeLessThan(
      style.layers.findIndex((l) => l.id === LABEL_ANCHOR),
    )
    for (const [mode, threshold, expected] of [
      ['canopy-height', 2, 'height'],
      ['canopy-density', 2, 'density2'],
      ['canopy-density', 5, 'density5'],
      ['strata', 2, null],
    ] as const) {
      applyCanopyHeatmaps(map as never, { ...INITIAL_ANALYSIS, mode, threshold, heatOpacity: 0.35 })
      expect(
        Object.entries(visibility)
          .filter(([, v]) => v === 'visible')
          .map(([id]) => id),
      ).toEqual(expected ? [`canopy-heatmap-${expected}`] : [])
      expect(Object.values(opacity).every((v) => v === 0.35)).toBe(true)
    }
    applyCanopyHeatmaps(map as never, { ...INITIAL_ANALYSIS, mode: 'canopy-height', heatOpacity: 0 })
    expect(opacity['canopy-heatmap-height']).toBe(0)
  })
})
