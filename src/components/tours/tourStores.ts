import { createTutorialCompletionStore, createTutorialProgressStore } from 'tourkit/player'

type TourStores = {
  progress: ReturnType<typeof createTutorialProgressStore>
  completions: ReturnType<typeof createTutorialCompletionStore>
}
const stores = new Map<string, TourStores>()

/**
 * One progress store and one completion store per page namespace (`pgmaps-road-design`), shared by
 * the player and the help pages, so a reload resumes the run it interrupted and the help shows which
 * lessons are finished. Progress is per tab (sessionStorage); completions last (localStorage).
 */
export function tourStoresFor(namespace: string): TourStores {
  let found = stores.get(namespace)
  if (!found) {
    found = {
      progress: createTutorialProgressStore({ namespace }),
      completions: createTutorialCompletionStore({ namespace }),
    }
    stores.set(namespace, found)
  }
  return found
}
