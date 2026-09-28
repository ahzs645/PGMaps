import { escapeHtml } from '@/lib/escapeHtml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type MapLibre from 'maplibre-gl'
import { Map as PGMap } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { MapMarker, MarkerContent } from '@/components/ui/map-markers'
import { useStorySources } from '../useStorySources'
import { storySourceKey, type StorySourceState } from '../storySources'
import { paneZoomOffset, resolveLayer } from '../storyScene'
import type { ProjectSceneDef } from '@/lib/projectPackages'
import type { NativeMapDefinition, NativeView, Category } from './model/types'
export function NativeStoryMap({
  definition,
  view,
  categories,
  selectedCategory,
  onSelect,
  onReady,
  passive = false,
  stops,
  activeStop,
  onStop,
  sharedSources,
  retrySources,
  cameraMemory,
  memoryKey,
}: {
  definition: NativeMapDefinition
  view: NativeView
  categories: Category[]
  selectedCategory: string | null
  onSelect: (id: string | null) => void
  onReady?: (map: MapLibre.Map | null) => void
  passive?: boolean
  stops?: { id: string; label: string; coordinates: [number, number] }[]
  activeStop?: string
  onStop?: (index: number) => void
  sharedSources?: ReadonlyMap<string, StorySourceState>
  retrySources?: () => void
  cameraMemory?: Map<string, { center: [number, number]; zoom: number; bearing: number; pitch: number }>
  memoryKey?: string
}) {
  const [map, setMap] = useState<MapLibre.Map | null>(null)
  const attach = useCallback(
    (m: MapLibre.Map | null) => {
      setMap(m)
      onReady?.(m)
    },
    [onReady],
  )
  const layers = useMemo(() => definition.layers.filter((l) => view.visibleLayerIds.includes(l.id)), [definition, view])
  const geo = useMemo(() => layers.filter((l) => l.format !== 'pmtiles'), [layers])
  const ownGeo = useMemo(() => (sharedSources ? [] : geo), [sharedSources, geo])
  const own = useStorySources(ownGeo)
  const sources = sharedSources ?? own.sources
  const retry = retrySources ?? own.retry
  const cameraKey = JSON.stringify(view.camera)
  const initializedMap = useRef<MapLibre.Map | null>(null)
  useEffect(() => {
    if (!map || passive) return
    const camera = JSON.parse(cameraKey) as NonNullable<NativeView['camera']>
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    const move = () => {
      const pane = map.getContainer()
      const zoom = Math.max(0, camera.zoom + paneZoomOffset({ width: pane.clientWidth, height: pane.clientHeight }))
      map.easeTo({
        ...camera,
        zoom,
        roll: 0,
        duration,
      })
    }
    const key = `${memoryKey}:${cameraKey}`
    const saved = cameraMemory?.get(key)
    // A new canvas can restore offscreen without travelling from its initial
    // camera. Revisiting a step on the live canvas must still animate.
    if (saved && initializedMap.current !== map) map.jumpTo({ ...saved, roll: 0 })
    else if (saved) map.easeTo({ ...saved, roll: 0, duration })
    else move()
    initializedMap.current = map
    const remember = () => {
      const c = map.getCenter()
      cameraMemory?.set(key, {
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      })
    }
    map.on('moveend', remember)
    map.on('resize', move)
    return () => {
      map.off('resize', move)
      map.off('moveend', remember)
    }
  }, [map, cameraKey, passive, cameraMemory, memoryKey])
  const scene = {
    ...view,
    label: '',
    title: '',
    text: '',
    focus: '',
    highlights: [
      ...(selectedCategory && definition.categoryProperty
        ? layers.map((l) => ({
            layerId: l.id,
            property: definition.categoryProperty!,
            values: [selectedCategory],
            dimOpacity: 0.1,
          }))
        : []),
      ...(view.highlights ?? []),
    ],
  } as ProjectSceneDef
  const failed = geo.some((l) => sources.get(storySourceKey(l))?.status === 'error')
  const loading = geo.some((l) => sources.get(storySourceKey(l))?.status !== 'ready')
  return (
    <div
      className="native-story-map"
      data-testid="native-story-map"
      data-selected-category={selectedCategory ?? ''}
      data-view-layers={view.visibleLayerIds.join(',')}
    >
      <PGMap
        ref={attach}
        center={view.camera!.center}
        zoom={view.camera!.zoom}
        minZoom={0}
        scrollZoom={false}
        interactive={!passive}
        controls={passive ? null : undefined}
        showLoadingOverlay={false}
        showStyleLoadingOverlay={false}
        attributionControl={{ customAttribution: escapeHtml(definition.attribution) }}
      >
        {layers.map((layer, index) => {
          const styledLayer = definition.categoryProperty
            ? {
                ...layer,
                category: {
                  property: definition.categoryProperty,
                  colors: Object.fromEntries(categories.map((c) => [c.id, c.color])),
                  fallback: layer.fillColor,
                },
              }
            : layer
          const resolved = resolveLayer(styledLayer, layer.id, scene, '#047857')
          const state = sources.get(storySourceKey(layer))
          if (layer.format !== 'pmtiles' && state?.status !== 'ready') return null
          const click = (_id: string, _event: unknown, properties: Record<string, unknown>) => {
            const value = String(properties[definition.categoryProperty ?? ''])
            if (categories.some((c) => c.id === value)) onSelect(value)
          }
          const shared = {
            layerOrder: index,
            idProperty: layer.idProperty,
            fillColor: resolved.fillColor,
            fillOpacity: resolved.fillOpacity,
            lineColor: resolved.lineColor,
            lineWidth: resolved.lineWidth,
            lineOpacity: resolved.lineOpacity,
            filter: resolved.filter,
            onFeatureClick: passive ? undefined : click,
          }
          if (layer.format === 'pmtiles')
            return <MapPmtilesFillLayer key={layer.id} {...shared} url={layer.data} sourceLayer={layer.sourceLayer!} />
          const data = state!.status === 'ready' ? state!.data : layer.data
          return layer.geometry === 'point' ? (
            <MapCircleLayer
              key={layer.id}
              data={data}
              sourceKey={storySourceKey(layer)}
              layerOrder={index}
              idProperty={layer.idProperty}
              color={resolved.fillColor}
              opacity={resolved.fillOpacity}
              radius={layer.circleRadius ?? 6}
              strokeColor={resolved.lineColor}
              strokeWidth={resolved.lineWidth}
              filter={resolved.filter}
              onFeatureClick={passive ? undefined : click}
            />
          ) : (
            <MapFillLayer key={layer.id} {...shared} data={data} sourceKey={storySourceKey(layer)} />
          )
        })}
        {stops?.map((s, index) => (
          <MapMarker key={s.id} longitude={s.coordinates[0]} latitude={s.coordinates[1]}>
            <MarkerContent>
              <button
                className="native-tour-marker"
                aria-label={`Tour stop ${index + 1}: ${s.label}`}
                aria-pressed={activeStop === s.id}
                onClick={() => onStop?.(index)}
              >
                {index + 1}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      </PGMap>
      {loading && (
        <div className="native-map-status" role="status">
          {failed ? (
            <>
              Map data unavailable. <button onClick={retry}>Retry</button>
            </>
          ) : (
            'Updating map…'
          )}
        </div>
      )}
      <details className="native-map-legend">
        <summary>Map legend</summary>
        {(view.legend ?? categories).map((c) => (
          <div key={c.label}>
            <span style={{ background: c.color }} />
            {c.label}
          </div>
        ))}
      </details>
    </div>
  )
}
