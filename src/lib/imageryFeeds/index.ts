/**
 * The imagery feeds a page can offer on a timeline, in chooser order. A new feed is one module
 * meeting `ImageryFeed` (`feed.ts`) and one entry here; `docs/imagery-feeds.md` is the recipe.
 */
import type { ImageryFeed } from './feed'
import { GIBS_HLS_FEED } from './gibsHlsFeed'
import { WAYBACK_FEED } from './waybackFeed'

export const IMAGERY_FEEDS: readonly ImageryFeed<unknown>[] = [
  WAYBACK_FEED as ImageryFeed<unknown>,
  GIBS_HLS_FEED as ImageryFeed<unknown>,
]

export function imageryFeedById(id: string | null | undefined): ImageryFeed<unknown> | undefined {
  return IMAGERY_FEEDS.find((feed) => feed.id === id)
}

export { GIBS_HLS_FEED, WAYBACK_FEED }
