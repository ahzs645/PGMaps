import { useEffect, useRef, useState } from 'react'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { loadBcStreamContext } from './bcStreamData'
import { BC_STREAM_SOURCES, mergeProvincialStreams, streamQueryBounds } from './provincialStreamData'
import { parseProject } from './project'
import type { ContextFeature } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

export function ProvincialStreamsPanel({ workspace: w }: { workspace: RoadWorkspace }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(w)
  latest.current = w
  const pending = useRef<AbortController | null>(null)
  const road = w.project.alignments.find((a) => a.id === w.project.activeAlignmentId)
  const scope = JSON.stringify([w.projectId, w.project.name, w.project.terrain.name, road?.id, road?.points])
  const currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => {
    setLoading(false)
    return () => pending.current?.abort()
  }, [scope])
  const load = async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError('')
    try {
      const bounds = streamQueryBounds(road?.points.map((p) => p.coordinate) ?? [])
      const loaded = await loadBcStreamContext(bounds, controller.signal)
      if (controller.signal.aborted || currentScope.current !== scope) return
      latest.current.update((p) =>
        parseProject({
          ...p,
          context: mergeProvincialStreams(p.context, loaded.streams),
          provincialStreamData: loaded.data,
        }),
      )
      latest.current.setNotice(
        `Loaded ${loaded.streams.length} FWA flow arcs, ${loaded.data.fish.length} fish observations and ${loaded.data.watersheds.length} community watersheds for review.`,
      )
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not load provincial stream evidence.')
    } finally {
      if (pending.current === controller) setLoading(false)
    }
  }
  const data = w.project.provincialStreamData
  const outsideScope =
    data &&
    road?.points.some(
      ({ coordinate: [x, y] }) => x < data.bounds[0] || x > data.bounds[2] || y < data.bounds[1] || y > data.bounds[3],
    )
  return (
    <div className={cn(insetBox(), 'space-y-1')} data-testid="provincial-stream-context">
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1 text-xs"
          disabled={loading || !!w.busy}
          onClick={() => void load()}
        >
          {loading ? 'Loading BC stream evidence…' : 'Load BC streams & evidence'}
        </Button>
        <InfoTip label="About provincial stream evidence">
          Loads the active road plus a 500 m margin. FWA includes observed, inferred and constructed flow arcs; these
          are not surveyed banks. Fish observations and community watershed boundaries stay separate from your
          assessment. Missing records do not establish fish absence or an outside-watershed determination. Every query
          must complete before any records are added. Refresh retains your notes and makes changed reach geometry
          require review. Earlier project streams remain when the query area changes.
        </InfoTip>
        {loading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              pending.current?.abort()
              setLoading(false)
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      {outsideScope && (
        <InlineAlert tone="warning">
          The active road extends outside the saved provincial query. Load evidence for its current corridor.
        </InlineAlert>
      )}
      {data && (
        <details className="text-2xs">
          <summary className="cursor-pointer">
            BC evidence · {data.streamFeatureIds.length} flow arcs · {data.fish.length} fish observations ·{' '}
            {data.watersheds.length} watersheds
          </summary>
          <p className="mt-1 text-muted-foreground">
            Retrieved {data.retrievedAt}. Complete for this query only; no absence determination.
          </p>
          <p className="break-words text-muted-foreground">
            Query W/S/E/N: {data.bounds.map((v) => v.toFixed(5)).join(', ')}
          </p>
          <p className="text-muted-foreground">
            Fish observations are violet points; community watersheds have an amber outline.
          </p>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {Object.entries(BC_STREAM_SOURCES).map(([id, source]) => (
              <a key={id} className="underline" href={source.catalogueUrl} target="_blank" rel="noreferrer">
                {source.name}
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function ProvincialStreamSourceView({ stream }: { stream: ContextFeature }) {
  const source = stream.streamSource
  if (!source) return null
  return (
    <div className={cn(insetBox(), 'text-2xs text-muted-foreground')} data-testid="stream-source-evidence">
      <p>
        FWA source record {source.sourceId} · retrieved {source.retrievedAt.slice(0, 10)}
      </p>
      <p>
        Flow arc type {source.edgeType ?? 'unknown'} · source {source.featureSource ?? 'not recorded'} · stream order{' '}
        {source.streamOrder ?? 'unknown'}
      </p>
      <p>Stream order is a network attribute; it does not determine the riparian class.</p>
      <a
        className="underline"
        href={`${BC_STREAM_SOURCES.streams.serviceUrl}/query?${new URLSearchParams({ f: 'pjson', objectIds: source.sourceId, outFields: '*', returnGeometry: 'false' })}`}
        target="_blank"
        rel="noreferrer"
      >
        Inspect provincial source record
      </a>
    </div>
  )
}
