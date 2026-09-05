import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ProjectStoryLayerDef } from '@/lib/projectPackages'
import { StorySourceStore } from './storySources'

export function useStorySources(layers: ProjectStoryLayerDef[]) {
  const [store] = useState(() => new StorySourceStore())
  const sources = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    store.setSources(layers)
  }, [layers, store])
  useEffect(() => () => store.dispose(), [store])
  return { sources, retry: store.retry }
}
