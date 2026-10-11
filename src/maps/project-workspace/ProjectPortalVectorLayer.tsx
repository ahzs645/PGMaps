import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GeoJsonLayer } from '@deck.gl/layers'
import { useDeckOverlay } from '@/components/ui/map-deck'
import { Button } from '@/components/ui/button'
import { useMap } from '@/components/ui/map'
import {
  MapCategoricalRaster,
  type CategoricalRasterPick,
  type CategoricalRasterStatus,
} from '@/components/ui/map-categorical-raster'
import { MapGradientLegendItem } from '@/components/ui/map-panels'
import { fetchJson } from '@/lib/fetchJson'
import type { ProjectPortalRasterLayerDef } from '@/lib/projectPackages'
import {
  numericRasterColor,
  numericRasterGradient,
  parseNumericRasterManifest,
  type NumericRasterManifest,
} from './numericRaster'

export type ProjectVectorPick = CategoricalRasterPick & { layerId: string; label: string; units: string }

const VectorLayersContext = createContext<((id: string, layers: GeoJsonLayer[]) => void) | null>(null)

/** MapboxOverlay shares one deck instance per map; publish the complete ordered stack together. */
export function ProjectPortalVectorStack({ layerIds, children }: { layerIds: string[]; children: ReactNode }) {
  const blocks = useRef(new Map<string, GeoJsonLayer[]>())
  const order = useRef(layerIds)
  const publishRef = useRef<() => void>(() => {})
  const overlay = useDeckOverlay({ enabled: layerIds.length > 0, onAttach: () => publishRef.current() })
  useEffect(() => {
    order.current = layerIds
    publishRef.current = () =>
      overlay.current?.setProps({ layers: order.current.flatMap((id) => blocks.current.get(id) ?? []) })
    publishRef.current()
  }, [layerIds, overlay])
  const onLayers = useCallback((id: string, layers: GeoJsonLayer[]) => {
    if (layers.length) blocks.current.set(id, layers)
    else blocks.current.delete(id)
    publishRef.current()
  }, [])
  return <VectorLayersContext.Provider value={onLayers}>{children}</VectorLayersContext.Provider>
}

/** Reserve the climate stack position before asynchronous climate data arrives. */
export function ProjectPortalVectorAnchor({ id }: { id: string }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id, source: id, type: 'circle', paint: { 'circle-radius': 0 } })
    return () => {
      if (!map.getStyle()) return
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
  }, [map, isLoaded, id])
  return null
}

function useNumericRasterManifest(url: string) {
  const [result, setResult] = useState<{ url: string; manifest?: NumericRasterManifest; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<unknown>(url, controller.signal)
      .then(parseNumericRasterManifest)
      .then((manifest) => {
        if (!controller.signal.aborted) setResult({ url, manifest })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({ url, error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [url])
  return result?.url === url ? result : undefined
}

export function ProjectPortalVectorLayer({
  layer,
  opacity,
  onStatus,
  onPick,
  beforeId,
}: {
  layer: ProjectPortalRasterLayerDef
  opacity: number
  onStatus: (id: string, status: CategoricalRasterStatus) => void
  onPick: (pick: ProjectVectorPick) => void
  beforeId: string
}) {
  const result = useNumericRasterManifest(layer.vectorManifest!)
  const sink = useContext(VectorLayersContext)
  const onLayers = useCallback((layers: GeoJsonLayer[]) => sink?.(layer.id, layers), [sink, layer.id])
  const status = useCallback((value: CategoricalRasterStatus) => onStatus(layer.id, value), [layer.id, onStatus])
  useEffect(() => {
    if (result?.error) status({ state: 'error', message: result.error })
    else if (!result?.manifest) status({ state: 'loading', message: 'Loading original climate style…' })
  }, [result, status])
  const color = useMemo(() => (value: number) => numericRasterColor(result!.manifest!.style, value), [result])
  const pick = useCallback(
    (value: CategoricalRasterPick) => {
      if (result?.manifest)
        onPick({ ...value, layerId: layer.id, label: result.manifest.label, units: result.manifest.units })
    },
    [layer.id, onPick, result],
  )
  if (!result?.manifest) return null
  return (
    <MapCategoricalRaster
      manifestUrl={layer.vectorManifest!}
      beforeId={beforeId}
      onLayers={sink ? onLayers : undefined}
      colorForValue={color}
      onPick={pick}
      onStatus={status}
      opacity={opacity * result.manifest.style.opacity}
      attribution={result.manifest.attribution}
    />
  )
}

export function ProjectPortalVectorLegend({
  layer,
  status,
  onRetry,
}: {
  layer: ProjectPortalRasterLayerDef
  status?: CategoricalRasterStatus
  onRetry: () => void
}) {
  const result = useNumericRasterManifest(layer.vectorManifest!)
  const manifest = result?.manifest
  const error = result?.error ?? (status?.state === 'error' ? status.message : undefined)
  return (
    <div
      className="space-y-1"
      data-testid="project-vector-status"
      data-layer={layer.id}
      data-status={error ? 'error' : (status?.state ?? 'loading')}
      aria-live="polite"
    >
      {manifest && (
        <>
          <MapGradientLegendItem
            colors={numericRasterGradient(manifest.style)}
            minLabel={`${manifest.style.stops[0].value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${manifest.units}`}
            maxLabel={`${manifest.style.stops.at(-1)!.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${manifest.units}`}
          />
          <div className="text-xs leading-snug text-muted-foreground">
            {[manifest.scenario, manifest.percentile, manifest.period].filter(Boolean).join(' · ')}
            {manifest.units === 'mm' && <> relative to {manifest.baseline}</>}
          </div>
          <div className="text-xs leading-snug text-muted-foreground">
            Consultant archive · original continuous colours
          </div>
        </>
      )}
      <div className="text-xs leading-snug text-muted-foreground">
        {error ?? status?.message ?? 'Loading climate vectors…'}
      </div>
      {error && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry climate layer
        </Button>
      )}
    </div>
  )
}
