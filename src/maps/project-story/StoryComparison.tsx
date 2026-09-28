import type MapLibreGL from 'maplibre-gl'
import { useEffect, useState, type ComponentProps, type MutableRefObject, type ReactNode } from 'react'

import { Map } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { ResolvedLayer } from './storyScene'
import { storySourceKey, type StorySourceState } from './storySources'

export type StoryComparisonProps = {
  enabled: boolean
  primaryMapRef: MutableRefObject<MapLibreGL.Map | null>
  /** Only the comparison's right-hand layer set, in authored draw order. */
  resolvedLayers: ResolvedLayer[]
  /** Reuse the story's active source store; comparison never fetches GeoJSON. */
  sources: ReadonlyMap<string, StorySourceState>
  styles: ComponentProps<typeof Map>['styles']
  labels: { left: string; right: string }
  children: ReactNode
}

/** A second full-size camera is clipped, never resized, so both sides align. */
export function StoryComparison({ enabled, children, ...comparison }: StoryComparisonProps) {
  return (
    <div className="relative h-full min-h-0 w-full" data-testid="story-comparison" data-enabled={enabled}>
      {/* Reset only the optional comparison surface; the primary stays mounted. */}
      {children}
      {enabled && <ComparisonSurface key={JSON.stringify(comparison.labels)} {...comparison} />}
    </div>
  )
}

function ComparisonSurface({
  primaryMapRef,
  resolvedLayers,
  sources,
  styles,
  labels,
}: Omit<StoryComparisonProps, 'enabled' | 'children'>) {
  const [secondary, setSecondary] = useState<MapLibreGL.Map | null>(null)
  const [position, setPosition] = useState(50)
  // Synchronization belongs to one concrete map instance, rather than a flag
  // that must be cleared in an effect when the ref changes.
  const [synchronizedMap, setSynchronizedMap] = useState<MapLibreGL.Map | null>(null)
  const synchronized = secondary !== null && synchronizedMap === secondary

  useEffect(() => {
    if (!secondary) return
    let frame = 0
    let primary: MapLibreGL.Map | null = null
    let disposed = false

    const mirror = () => {
      if (!primary || disposed) return
      // Scene fitting can lower the primary's zoom floor on small screens.
      secondary.setMinZoom(primary.getMinZoom())
      secondary.setMaxZoom(primary.getMaxZoom())
      secondary.setMinPitch(primary.getMinPitch())
      secondary.setMaxPitch(primary.getMaxPitch())
      secondary.jumpTo({
        center: primary.getCenter(),
        zoom: primary.getZoom(),
        bearing: primary.getBearing(),
        pitch: primary.getPitch(),
        roll: primary.getRoll(),
        padding: primary.getPadding(),
      })
      setSynchronizedMap(secondary)
    }
    const resize = () => {
      secondary.resize()
      mirror()
    }
    const connect = () => {
      if (disposed) return
      primary = primaryMapRef.current
      if (!primary) {
        frame = requestAnimationFrame(connect)
        return
      }
      primary.on('move', mirror)
      primary.on('resize', resize)
      secondary.on('resize', mirror)
      resize()
    }
    connect()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      primary?.off('move', mirror)
      primary?.off('resize', resize)
      secondary.off('resize', mirror)
    }
  }, [secondary, primaryMapRef])

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="story-comparison-right"
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${position}%)`, visibility: synchronized ? 'visible' : 'hidden' }}
      >
        <Map
          ref={setSecondary}
          className="h-full w-full"
          styles={styles}
          controls={null}
          interactive={false}
          attributionControl={false}
          showStyleLoadingOverlay={false}
        >
          {resolvedLayers.map((resolved, index) => {
            const { layer } = resolved
            if (layer.format === 'climate-grid') return null
            const shared = {
              layerOrder: index,
              idProperty: layer.idProperty,
              fillColor: resolved.fillColor,
              fillOpacity: resolved.fillOpacity,
              lineColor: resolved.lineColor,
              lineWidth: resolved.lineWidth,
              lineOpacity: resolved.lineOpacity,
              filter: resolved.filter,
            }
            if (layer.format === 'pmtiles') {
              return layer.sourceLayer ? (
                <MapPmtilesFillLayer key={layer.id} {...shared} url={layer.data} sourceLayer={layer.sourceLayer} />
              ) : null
            }
            const source = sources.get(storySourceKey(layer))
            if (source?.status !== 'ready') return null
            const sourceKey = JSON.stringify([storySourceKey(layer), layer.idProperty])
            return layer.geometry === 'point' ? (
              <MapCircleLayer
                key={layer.id}
                layerOrder={index}
                sourceKey={sourceKey}
                data={source.data}
                idProperty={layer.idProperty}
                color={resolved.fillColor}
                opacity={resolved.fillOpacity}
                radius={layer.circleRadius ?? 5.5}
                strokeColor={resolved.lineColor}
                strokeWidth={resolved.lineWidth}
                filter={resolved.filter}
              />
            ) : (
              <MapFillLayer key={layer.id} {...shared} sourceKey={sourceKey} data={source.data} />
            )
          })}
        </Map>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_#0006]"
        style={{ left: `${position}%`, display: position === 0 || position === 100 ? 'none' : undefined }}
      />
      <div
        className="pointer-events-none absolute left-3 right-14 top-16 flex justify-between gap-4"
        aria-hidden="true"
      >
        <span className="max-w-[45%] rounded bg-background/95 px-2 py-1 text-xs font-semibold text-foreground shadow">
          {labels.left}
        </span>
        <span className="max-w-[45%] rounded bg-background/95 px-2 py-1 text-xs font-semibold text-foreground shadow">
          {labels.right}
        </span>
      </div>
      <div
        className="pointer-events-auto absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-xl border bg-background/95 p-2 shadow-lg"
        style={{ width: 'min(22rem, calc(100% - 2rem))' }}
        role="group"
        aria-label={`Compare ${labels.left} and ${labels.right}`}
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label="Comparison divider"
          aria-valuetext={`${position}% ${labels.left}, ${100 - position}% ${labels.right}`}
          className="block h-8 w-full cursor-ew-resize accent-primary"
        />
        <SegmentedControl
          label="Comparison view"
          value={position === 100 ? 'left' : position === 0 ? 'right' : 'both'}
          options={[
            { value: 'left', label: 'Show left', title: labels.left },
            { value: 'both', label: 'Both' },
            { value: 'right', label: 'Show right', title: labels.right },
          ]}
          onChange={(value) => setPosition(value === 'left' ? 100 : value === 'right' ? 0 : 50)}
        />
      </div>
    </>
  )
}
