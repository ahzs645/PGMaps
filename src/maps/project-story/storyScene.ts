import type { ProjectSceneDef, ProjectStoryCategoryDef, ProjectStoryLayerDef } from '@/lib/projectPackages'

/**
 * Pure scene resolution for JSON map stories: turning a scene's declarative
 * layer set, overrides, and highlights into MapLibre paint values and a legend.
 * Kept out of the renderer so the story contract can be unit tested.
 */

/** Map pane the authored scene cameras assume — roughly a desktop story's map
 *  at 1440x900. A smaller pane shows less ground at the same zoom, so it is
 *  zoomed out to bring the authored extent back into frame. */
const CAMERA_REFERENCE_PANE = { width: 1000, height: 700 }
/** Ceiling on that correction, however small the pane gets. Past ~1.5 levels a
 *  province-wide frame stops reading as a place and starts reading as a globe. */
const MAX_CAMERA_ZOOM_OUT = 1.5

/**
 * Zoom correction that keeps the authored ground extent in frame on a map pane
 * smaller than the one the story was written against. Zoom is log2 of scale, so
 * a pane at half the reference size costs exactly one level; taking the smaller
 * of the two axis ratios guarantees both the authored width and height still
 * fit. Never positive — a roomier pane keeps the author's own framing.
 */
export function paneZoomOffset(pane: { width: number; height: number }): number {
  if (!(pane.width > 0) || !(pane.height > 0)) return 0
  const fit = Math.log2(Math.min(pane.width / CAMERA_REFERENCE_PANE.width, pane.height / CAMERA_REFERENCE_PANE.height))
  return Math.max(-MAX_CAMERA_ZOOM_OUT, Math.min(0, fit))
}

/** MapLibre paint expression. The shared map layers type these as `any` too. */
export type PaintValue = string | number | unknown[]

export type ResolvedLayer = {
  layer: ProjectStoryLayerDef
  label: string
  fillColor: PaintValue
  fillOpacity: PaintValue
  lineColor: PaintValue
  lineWidth: PaintValue
  lineOpacity: number
  category?: ProjectStoryCategoryDef
  /** Restricts rendering (and hover hit-testing) to matching features. */
  filter?: unknown[]
}

export type LegendEntry = {
  key: string
  label: string
  color: string
  /** Layer this entry belongs to, when clicking it should toggle the layer. */
  layerId?: string
}

/** Categorical fill expression, or the flat fill colour when the layer has no categories. */
export function baseFillColor(layer: ProjectStoryLayerDef, category = layer.category): PaintValue {
  if (!category) return layer.fillColor
  const matches = Object.entries(category.colors).flatMap(([value, color]) => [value, color])
  return ['match', ['get', category.property], ...matches, category.fallback]
}

/**
 * Folds a scene's overrides and highlight onto a layer's base paint. A highlight
 * keeps matched features at full strength, dims the rest, and thickens the matched
 * outline so the spotlighted regions read at province-wide zoom.
 */
export function resolveLayer(
  layer: ProjectStoryLayerDef,
  label: string,
  scene: ProjectSceneDef | undefined,
  accent: string,
): ResolvedLayer {
  const override = scene?.layerOverrides?.[layer.id]
  const fillOpacity = override?.fillOpacity ?? layer.fillOpacity
  const lineOpacity = override?.lineOpacity ?? layer.lineOpacity
  const lineWidth = override?.lineWidth ?? layer.lineWidth
  const category = override?.category ?? layer.category

  const resolved: ResolvedLayer = {
    layer,
    label,
    fillColor: baseFillColor(layer, category),
    fillOpacity,
    lineColor: layer.lineColor,
    lineWidth,
    lineOpacity,
    category,
  }

  const highlight = scene?.highlights?.find((entry) => entry.layerId === layer.id)
  if (!highlight || highlight.values.length === 0) return resolved

  const matched = ['in', ['get', highlight.property], ['literal', highlight.values]]
  const dim = highlight.dimOpacity ?? Math.min(fillOpacity, 0.08)
  return {
    ...resolved,
    // A fully hidden remainder is filtered out entirely — invisible features
    // would otherwise still catch hover tooltips.
    filter: dim === 0 ? matched : undefined,
    fillOpacity: ['case', matched, fillOpacity, dim],
    lineColor: ['case', matched, highlight.color ?? accent, layer.lineColor],
    lineWidth: ['case', matched, Math.max(lineWidth * 2, 2.4), lineWidth],
  }
}

/** True when the reader has not toggled away from the scene's declared layer set. */
export function sameLayerSet(left: Set<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((id) => left.has(id))
}

/**
 * Legend for the active scene: an explicit scene legend when the package sets one,
 * otherwise the categories of every visible layer plus a caption per highlight.
 */
export function buildLegend(
  scene: ProjectSceneDef | undefined,
  resolvedLayers: ResolvedLayer[],
  visibleLayerIds: Set<string>,
  accent: string,
): LegendEntry[] {
  if (scene?.legend) {
    return scene.legend.map((entry, index) => ({
      key: `scene-${index}-${entry.label}`,
      label: entry.label,
      color: entry.color,
    }))
  }

  const entries: LegendEntry[] = []
  for (const resolved of resolvedLayers) {
    if (!visibleLayerIds.has(resolved.layer.id)) continue
    const { category } = resolved
    if (category) {
      for (const [label, color] of Object.entries(category.colors)) {
        entries.push({ key: `${resolved.layer.id}-${label}`, label, color, layerId: resolved.layer.id })
      }
    } else {
      entries.push({
        key: resolved.layer.id,
        label: resolved.label,
        // The fill reads as the layer's identity; outlines are often near-black.
        color: resolved.layer.fillColor,
        layerId: resolved.layer.id,
      })
    }
  }

  for (const highlight of scene?.highlights ?? []) {
    if (!highlight.label || !visibleLayerIds.has(highlight.layerId)) continue
    entries.push({
      key: `highlight-${highlight.layerId}-${highlight.label}`,
      label: highlight.label,
      color: highlight.color ?? accent,
    })
  }

  return entries
}
