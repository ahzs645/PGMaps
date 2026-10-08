import { buildLegend as buildGenericLegend } from '@pgmaps/geo-toolkit/stories/storyScene'
import type { ProjectSceneDef } from '@pgmaps/geo-toolkit/projects/storyTypes'
import type { ResolvedLayer, LegendEntry } from '@pgmaps/geo-toolkit/stories/storyScene'
import { climateLegend } from './adapters/climateStyle'

export {
  baseFillColor,
  paneZoomOffset,
  resolveLayer,
  sameLayerSet,
  sameStoryCamera,
} from '@pgmaps/geo-toolkit/stories/storyScene'
export type { PaintValue, ResolvedLayer, LegendEntry, StoryCamera } from '@pgmaps/geo-toolkit/stories/storyScene'

/** PGMaps supplies its optional native climate-grid legend adapter. */
export function buildLegend(
  scene: ProjectSceneDef | undefined,
  resolvedLayers: ResolvedLayer[],
  visibleLayerIds: Set<string>,
  accent: string,
): LegendEntry[] {
  return buildGenericLegend(scene, resolvedLayers, visibleLayerIds, accent, (layer) =>
    layer.format === 'climate-grid' && layer.climate ? climateLegend(layer.climate) : undefined,
  )
}
