/**
 * Mobility Index (MI) band scale, shared by everything that draws the
 * walkability surface — the Walkability tab, the score-builder raster and its
 * legend, and any project package whose recipe renders that raster.
 *
 * Built on the generic {@link ValueBand} shape, so legends, ramps and lookups
 * come from `@/lib/valueBands` and this module only owns what is specific to MI:
 * the report-calibrated defaults and how a generated grid overrides them.
 *
 * The generated citywide grid carries its own `bandColors` and `bandLabels`, and
 * the heatmap manifest carries the grid's path, so legends resolve from the data
 * and fall back to the constants below only when the grid has not loaded.
 * Regenerating the grid updates every legend without a code change.
 *
 * The one part a rebuild cannot move on its own is the band *ranges*: the
 * thresholds are also hardcoded in `scoreBand()` in
 * `walkabilityLiveHeatmap.worker.js`, which bins live recalculations. Changing
 * the score ranges means changing both.
 */
import { useMemo } from 'react'
import { useFetchData } from '@/hooks/useFetchData'
import {
  mergeValueBandMetadata,
  valueBandColorsById,
  valueBandLegendItems,
  type ValueBand,
  type ValueBandMetadata,
} from '@/lib/valueBands'

/** `id` is the band value 1-5 stored in the generated grid's RLE. */
export type WalkabilityMiBand = ValueBand<number>

/** Band metadata as the generated grid carries it. */
export type WalkabilityMiBandSource = {
  bandColors?: Record<string, string> | null
  bandLabels?: Record<string, string> | null
}

export const WALKABILITY_HEATMAP_MANIFEST_PATH = '/data/walkability/heatmap/manifest.json'

/** Used when the manifest has not resolved; the manifest is authoritative. */
export const WALKABILITY_MI_GRID_FALLBACK_PATH = '/data/walkability/heatmap/citywide_mi_grid.json'

/**
 * Report-calibrated defaults. Colours and labels mirror the generated grid;
 * ranges mirror the worker's `scoreBand()`.
 */
export const WALKABILITY_MI_BANDS: readonly WalkabilityMiBand[] = [
  { id: 1, min: 0, max: 27.4, label: '1-27', color: '#4f9ad6' },
  { id: 2, min: 27.4, max: 45.7, label: '28-45', color: '#9ec99c' },
  { id: 3, min: 45.7, max: 63.9, label: '46-63', color: '#f5e451' },
  { id: 4, min: 63.9, max: 82.2, label: '64-82', color: '#e89c4a' },
  { id: 5, min: 82.2, max: Number.POSITIVE_INFINITY, label: '83+', color: '#d33b3b' },
] as const

/** Band colours keyed by grid value, for the raster's `bandColors` fallback. */
export const WALKABILITY_MI_BAND_COLORS: Record<string, string> = valueBandColorsById(WALKABILITY_MI_BANDS)

/**
 * The generator writes labels as `Component 28-45`; legends show the range on
 * its own. Any other wording is passed through untouched. Returns null for
 * anything blank so the band's own label is kept.
 */
function formatBandLabel(rawLabel: string): string | null {
  return rawLabel.replace(/^\s*component\s+/i, '').trim() || null
}

function toBandMetadata(source?: WalkabilityMiBandSource | null): ValueBandMetadata {
  return { colors: source?.bandColors, labels: source?.bandLabels }
}

/**
 * Merges generated band metadata over the defaults, per band, so a grid that
 * defines only colours still gets labels (and vice versa).
 */
export function resolveWalkabilityMiBands(source?: WalkabilityMiBandSource | null): WalkabilityMiBand[] {
  return mergeValueBandMetadata(WALKABILITY_MI_BANDS, toBandMetadata(source), { formatLabel: formatBandLabel })
}

/** Legend-shaped view of the bands, for `MapSteppedLegend`. */
export const toWalkabilityMiLegendBands = valueBandLegendItems

interface WalkabilityHeatmapManifest {
  citywideGrid?: { path?: string | null } | null
}

/**
 * Resolves MI bands for consumers that do not already hold the grid.
 *
 * Both fetches are served from `useFetchData`'s module cache once anything else
 * on the page has loaded them, so a legend costs no extra network work when the
 * raster is on screen.
 */
export function useWalkabilityMiBands(enabled = true): WalkabilityMiBand[] {
  const manifest = useFetchData<WalkabilityHeatmapManifest>(enabled ? WALKABILITY_HEATMAP_MANIFEST_PATH : null)
  const gridPath = manifest.data?.citywideGrid?.path || WALKABILITY_MI_GRID_FALLBACK_PATH
  const grid = useFetchData<WalkabilityMiBandSource>(enabled ? gridPath : null)
  return useMemo(() => resolveWalkabilityMiBands(grid.data), [grid.data])
}
