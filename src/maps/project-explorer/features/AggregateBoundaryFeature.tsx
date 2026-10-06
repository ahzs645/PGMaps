import { useEffect, useState, type ReactNode } from 'react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { SidebarSection, InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { fetchJson } from '@/lib/fetchJson'
import { useIsMobile } from '@/hooks/useIsMobile'
import { selectResearchBoundary } from '../adapters/researchBoundary'
import type { ExplorerFeature } from './featureTypes'

export function useAggregateBoundary(feature: ExplorerFeature<'aggregate-boundary'> | undefined) {
  const [visible, setVisible] = useState(false)
  const [opacity, setOpacity] = useState(0.18)
  const [boundary, setBoundary] = useState<ReturnType<typeof selectResearchBoundary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    if (!feature || !visible || boundary) return
    const controller = new AbortController()
    fetchJson<GeoJSON.FeatureCollection>(feature.data, controller.signal)
      .then((source) => {
        if (!controller.signal.aborted) {
          setBoundary(selectResearchBoundary(source, feature.idProperty, feature.featureId))
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Boundary unavailable')
      })
    return () => controller.abort()
  }, [feature, visible, boundary, retryKey])
  return {
    visible,
    setVisible,
    opacity,
    setOpacity,
    boundary,
    error,
    retry: () => {
      setError(null)
      setRetryKey((key) => key + 1)
    },
  }
}

export type AggregateBoundaryState = ReturnType<typeof useAggregateBoundary>

export function AggregateBoundaryFeature({
  feature,
  state,
  records,
}: {
  feature: ExplorerFeature<'aggregate-boundary'>
  state: AggregateBoundaryState
  records?: ReactNode
}) {
  return (
    <SidebarSection title={records ? feature.title : 'Regional boundary'} className="p-3">
      {records && <div className="mb-2">{records}</div>}
      <ToggleRow
        label={`Show ${feature.title} boundary`}
        active={state.visible}
        tone="primary"
        onClick={() => state.setVisible(!state.visible)}
      />
      <p className="mt-2 text-xs text-muted-foreground">{feature.description}</p>
      {state.visible && (
        <div className="mt-3 space-y-2">
          <label htmlFor="regional-boundary-opacity" className="flex justify-between text-xs">
            <span>Boundary shading</span>
            <span>{Math.round(state.opacity * 100)}%</span>
          </label>
          <input
            id="regional-boundary-opacity"
            type="range"
            min={0.05}
            max={0.6}
            step={0.01}
            value={state.opacity}
            onChange={(event) => state.setOpacity(Number(event.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Lighter</span>
            <span>Darker</span>
          </div>
          {state.error ? (
            <InlineAlert tone="error" title="Boundary unavailable">
              {state.error}
              <button type="button" onClick={state.retry} className="ml-2 underline">
                Retry boundary
              </button>
            </InlineAlert>
          ) : !state.boundary ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading boundary…
            </p>
          ) : null}
        </div>
      )}
    </SidebarSection>
  )
}

export function AggregateBoundaryMapFeature({
  feature,
  state,
  count,
}: {
  feature: ExplorerFeature<'aggregate-boundary'>
  state: AggregateBoundaryState
  count: number
}) {
  const isMobile = useIsMobile()
  if (!state.visible || !state.boundary || state.error) return null
  return (
    <>
      <MapFillLayer
        data={state.boundary.data}
        sourceKey="research-regional-boundary"
        fillColor="#3b82f6"
        fillOpacity={state.opacity}
        lineColor="#2563eb"
        lineOpacity={0.85}
        lineWidth={2}
        layerOrder={10}
      />
      <MapMarker
        longitude={state.boundary.anchor[0]}
        latitude={state.boundary.anchor[1]}
        offset={isMobile ? [0, -55] : [-80, -55]}
        className="pointer-events-none"
      >
        <MarkerContent className="pointer-events-none cursor-default">
          <div
            data-regional-boundary-count
            className="rounded-md border border-blue-500/50 bg-background/95 px-3 py-2 text-center text-xs shadow-sm"
          >
            <div className="font-medium">{feature.title}</div>
            <div className="text-base font-semibold tabular-nums">{count.toLocaleString()}</div>
            <div className="text-muted-foreground">regional-only publications</div>
          </div>
        </MarkerContent>
      </MapMarker>
    </>
  )
}
