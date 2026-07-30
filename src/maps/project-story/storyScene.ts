import type {
  ProjectSceneDef,
  ProjectStoryLayerDef,
} from '@/lib/projectPackages'

/**
 * Pure scene resolution for JSON map stories: turning a scene's declarative
 * layer set, overrides, and highlights into MapLibre paint values and a legend.
 * Kept out of the renderer so the story contract can be unit tested.
 */

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
}

export type LegendEntry = {
  key: string
  label: string
  color: string
  /** Layer this entry belongs to, when clicking it should toggle the layer. */
  layerId?: string
}

/** Categorical fill expression, or the flat fill colour when the layer has no categories. */
export function baseFillColor(layer: ProjectStoryLayerDef): PaintValue {
  if (!layer.category) return layer.fillColor
  const matches = Object.entries(layer.category.colors).flatMap(([value, color]) => [value, color])
  return ['match', ['get', layer.category.property], ...matches, layer.category.fallback]
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

  const resolved: ResolvedLayer = {
    layer,
    label,
    fillColor: baseFillColor(layer),
    fillOpacity,
    lineColor: layer.lineColor,
    lineWidth,
    lineOpacity,
  }

  const highlight = scene?.highlights?.find((entry) => entry.layerId === layer.id)
  if (!highlight || highlight.values.length === 0) return resolved

  const matched = ['in', ['get', highlight.property], ['literal', highlight.values]]
  const dim = highlight.dimOpacity ?? Math.min(fillOpacity, 0.08)
  return {
    ...resolved,
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
    const { category } = resolved.layer
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
