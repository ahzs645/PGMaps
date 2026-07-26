/**
 * Mobility Index (MI) band definitions shared by everything that draws the
 * walkability surface — the Walkability tab, the score-builder source raster,
 * and any project package whose recipe renders that raster.
 *
 * The generated citywide grid carries its own `bandColors` and `bandLabels`, so
 * legends resolve from the data first and fall back to the constants below only
 * when the grid has not loaded (or a rebuild drops the metadata). Regenerating
 * the grid with different colours or ranges therefore updates every legend
 * without a code change.
 *
 * The one part a rebuild cannot move on its own is `max`: the band *thresholds*
 * are also hardcoded in `scoreBand()` in `walkabilityLiveHeatmap.worker.js`,
 * which bins live recalculations. Changing the score ranges means changing both.
 */
import { useMemo } from 'react'
import { useFetchData } from '@/hooks/useFetchData'

export interface WalkabilityMiBand {
  /** Band value 1-5, matching the values stored in the generated grid RLE. */
  value: number
  /** Exclusive upper bound of the band's MI score. */
  max: number
  /** Display label, e.g. `28-45`. */
  label: string
  color: string
}

/** Band metadata as the generated grid carries it. */
export interface WalkabilityMiBandSource {
  bandColors?: Record<string, string> | null
  bandLabels?: Record<string, string> | null
}

export const WALKABILITY_HEATMAP_MANIFEST_PATH = '/data/walkability/heatmap/manifest.json'

/** Used when the manifest has not resolved; the manifest is authoritative. */
export const WALKABILITY_MI_GRID_FALLBACK_PATH = '/data/walkability/heatmap/citywide_mi_grid.json'

/**
 * Report-calibrated defaults. Colours and labels mirror the generated grid;
 * thresholds mirror the worker's `scoreBand()`.
 */
export const WALKABILITY_MI_BANDS: readonly WalkabilityMiBand[] = [
  { value: 1, max: 27.4, label: '1-27', color: '#4f9ad6' },
  { value: 2, max: 45.7, label: '28-45', color: '#9ec99c' },
  { value: 3, max: 63.9, label: '46-63', color: '#f5e451' },
  { value: 4, max: 82.2, label: '64-82', color: '#e89c4a' },
  { value: 5, max: Number.POSITIVE_INFINITY, label: '83+', color: '#d33b3b' },
] as const

/** Band colours keyed by grid value, for the raster's `bandColors` fallback. */
export const WALKABILITY_MI_BAND_COLORS: Record<string, string> = Object.fromEntries(
  WALKABILITY_MI_BANDS.map((band) => [String(band.value), band.color]),
)

/**
 * The generator writes labels as `Component 28-45`; legends show the range on
 * its own. Any other wording is passed through untouched. Returns null for
 * anything blank or non-textual so the caller can fall back.
 */
function formatBandLabel(rawLabel: unknown): string | null {
  if (typeof rawLabel !== 'string') return null
  const trimmed = rawLabel.replace(/^\s*component\s+/i, '').trim()
  return trimmed || null
}

function readBandColor(rawColor: unknown): string | null {
  if (typeof rawColor !== 'string') return null
  return rawColor.trim() || null
}

/**
 * Merges generated band metadata over the defaults, per band, so a grid that
 * defines only colours still gets labels (and vice versa).
 */
export function resolveWalkabilityMiBands(source?: WalkabilityMiBandSource | null): WalkabilityMiBand[] {
  return WALKABILITY_MI_BANDS.map((band) => {
    const key = String(band.value)
    return {
      ...band,
      color: readBandColor(source?.bandColors?.[key]) ?? band.color,
      label: formatBandLabel(source?.bandLabels?.[key]) ?? band.label,
    }
  })
}

/** Legend-shaped view of the bands, for `MapSteppedLegend`. */
export function toWalkabilityMiLegendBands(bands: WalkabilityMiBand[]): Array<{ label: string; color: string }> {
  return bands.map(({ label, color }) => ({ label, color }))
}

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
