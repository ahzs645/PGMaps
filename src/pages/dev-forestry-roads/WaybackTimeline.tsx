import { ROAD_DESIGN_DEPLOYMENT } from './deployment'
import { isLocalPlane } from './localPlane'
import type { TerrainMetadata } from './types'

/**
 * Whether the plan offers its Wayback timeline: the deployment allows it and the project has a
 * place on Earth. The timeline itself is the shared `ImageryTimeline` over `WAYBACK_FEED`
 * (`src/components/ui/imagery-timeline.tsx`, `src/lib/imageryFeeds/waybackFeed.ts`).
 */
export function waybackTimelineAvailable(terrain: Pick<TerrainMetadata, 'epsg'>) {
  return ROAD_DESIGN_DEPLOYMENT.waybackTimeline && !isLocalPlane(terrain)
}
