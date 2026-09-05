import { useEffect, useState } from 'react'
import { initialLookupState } from '../data'
import {
  loadRelationshipGraph,
  localVerifiedMatches,
  matchBoundaryRelationshipPlace,
  matchRelationshipPlace,
  queryNativeLandSource,
  queryReserveSource,
  queryTreatySources,
  relationshipMatches,
} from '../spatial'
import type { MatchType, RelationshipGraph, SourceKey, SourceLookupState } from '../types'
import type { BuilderLocation } from '../builder'

/** Every location uses the same source pipeline; cancelled generations cannot publish stale results. */
export function useBuilderLocations(
  initial: BuilderLocation[],
  enabled: Record<SourceKey, boolean>,
  matchTypes: Record<MatchType, boolean>,
) {
  const [locations, setLocations] = useState(initial)
  const [graph, setGraph] = useState<RelationshipGraph | null>(null)
  const [retry, setRetry] = useState(0)
  const locationKey = JSON.stringify(locations.map(({ id, result }) => [id, result]))
  const configKey = JSON.stringify([enabled, matchTypes])
  useEffect(() => {
    if (!locations.length) return
    const controller = new AbortController()
    const current = () => !controller.signal.aborted
    const lookupKey = `${configKey}:${retry}`
    const snapshot = locations.filter((item) => item.lookupKey !== lookupKey)
    if (!snapshot.length) return
    const pendingIds = new Set(snapshot.map((item) => item.id))
    setLocations((items) => items.map((item) => (pendingIds.has(item.id) ? { ...item, status: 'loading' } : item)))
    void (async () => {
      let loadedGraph: RelationshipGraph | null = null
      try {
        loadedGraph = await loadRelationshipGraph()
        if (current()) setGraph(loadedGraph)
      } catch {
        /* Each curated lookup below exposes the failure with a retry action. */
      }
      if (!current()) return
      await Promise.allSettled(
        snapshot.map(async (location) => {
          const lookups = { ...initialLookupState }
          let match: BuilderLocation['match'] = null
          const run = async (source: SourceKey, query: () => Promise<SourceLookupState['matches']>) => {
            if (!enabled[source]) return
            try {
              lookups[source] = { status: 'success', matches: await query() }
            } catch {
              lookups[source] = { status: 'error', matches: [], message: 'This source could not be loaded. Try again.' }
            }
          }
          await Promise.allSettled([
            run('verified', async () => {
              if (!loadedGraph) throw new Error('Relationship data unavailable')
              match =
                matchRelationshipPlace(loadedGraph, location.result, location.result.fullAddress, matchTypes) ??
                (matchTypes.boundary ? await matchBoundaryRelationshipPlace(loadedGraph, location.result) : null)
              return match ? relationshipMatches(loadedGraph, match) : []
            }),
            run('nativeLand', () =>
              queryNativeLandSource(location.result.latitude, location.result.longitude, controller.signal),
            ),
            run('treaty', () => queryTreatySources(location.result.latitude, location.result.longitude)),
            run('reserve', () => queryReserveSource(location.result.latitude, location.result.longitude)),
            run('local', () => localVerifiedMatches(location.result)),
          ])
          if (!current()) return
          setLocations((items) =>
            items.map((item) =>
              item.id === location.id
                ? {
                    ...item,
                    lookups,
                    match,
                    lookupKey,
                    status: enabled.verified && lookups.verified.status === 'error' ? 'error' : 'done',
                  }
                : item,
            ),
          )
        }),
      )
    })()
    return () => controller.abort()
    // Serialized configuration and coordinates exclude lookup and selection updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey, configKey, retry])
  return { locations, setLocations, graph, retry: () => setRetry((value) => value + 1) }
}
