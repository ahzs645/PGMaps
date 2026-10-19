import type { Map } from 'maplibre-gl'
import type { WorkflowOptions } from './analysisWorkflows'
import { LABEL_ANCHOR } from './basemaps'
import { heightAtLocation } from './data'
export type HeatmapMode = 'canopy-height' | 'canopy-density'
export type HeatmapKey = 'height' | 'density2' | 'density5'
export interface HeatmapRaster {
  png_data_url: string
  samples_base64: string
  sample_maximum: number
  display_maximum: number
  source_valid_cells: number
  source_min: number
  source_max: number
}
export interface CanopyHeatmaps {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  colors: string[]
  coordinates: [number, number][]
  grid: { width: number; height: number; bounds_mercator: number[]; resolution_mercator_m: number }
  density_window_m: number
  minimum_window_support_percent: number
  roof_exclusion_m: number
  method: string
  rasters: Record<HeatmapKey, HeatmapRaster>
}
export const HEATMAP_COLORS = ['#2c1e85', '#2877b8', '#2ab7a9', '#fde725', '#ef3b2c']
export function isHeatmapMode(value: unknown): value is HeatmapMode {
  return value === 'canopy-height' || value === 'canopy-density'
}
export function heatmapKey(options: WorkflowOptions): HeatmapKey {
  return options.mode === 'canopy-height' ? 'height' : options.threshold === 2 ? 'density2' : 'density5'
}
export function heatmapLegend(options: WorkflowOptions) {
  const height = options.mode === 'canopy-height'
  return {
    min: 0,
    max: height ? 40 : 100,
    colors: HEATMAP_COLORS,
    unit: height ? 'm' : '%',
    label: height ? 'Canopy height · 0–40+ m' : `Canopy cover >${options.threshold} m · 0–100%`,
  }
}
const samplesCache = new WeakMap<HeatmapRaster, Float32Array>()
export function sampleHeatmap(data: CanopyHeatmaps, key: HeatmapKey, lng: number, lat: number) {
  const raster = data.rasters[key]
  let samples = samplesCache.get(raster)
  if (!samples) {
    const bytes = Uint8Array.from(atob(raster.samples_base64), (c) => c.charCodeAt(0))
    if (bytes.length !== data.grid.width * data.grid.height) throw Error('Invalid heatmap sample grid')
    samples = Float32Array.from(bytes, (value) => (value === 255 ? NaN : (value / 254) * raster.sample_maximum))
    samplesCache.set(raster, samples)
  }
  return heightAtLocation(samples, { ...data.grid, file: '' }, lng, lat)
}
const KEYS: HeatmapKey[] = ['height', 'density2', 'density5']
export function installCanopyHeatmaps(map: Map, data: CanopyHeatmaps) {
  for (const key of KEYS) {
    const id = `canopy-heatmap-${key}`
    if (!map.getSource(id))
      map.addSource(id, {
        type: 'image',
        url: data.rasters[key].png_data_url,
        coordinates: data.coordinates as [[number, number], [number, number], [number, number], [number, number]],
      })
    if (!map.getLayer(id))
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
        },
        map.getLayer('workflow-gaps') ? 'workflow-gaps' : LABEL_ANCHOR,
      )
  }
}
export function applyCanopyHeatmaps(
  map: Pick<Map, 'getLayer' | 'setLayoutProperty' | 'setPaintProperty'>,
  options: WorkflowOptions,
) {
  for (const key of KEYS) {
    const id = `canopy-heatmap-${key}`
    if (!map.getLayer(id)) continue
    map.setLayoutProperty(
      id,
      'visibility',
      isHeatmapMode(options.mode) && heatmapKey(options) === key ? 'visible' : 'none',
    )
    map.setPaintProperty(id, 'raster-opacity', options.heatOpacity)
  }
}
