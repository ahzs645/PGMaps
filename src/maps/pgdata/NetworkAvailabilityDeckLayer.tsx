import { useEffect, useRef } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { GeoJsonLayer } from '@deck.gl/layers'
import { useMap } from '@/components/ui/map'
import maplibregl from 'maplibre-gl'
import type {
  NetworkAvailabilityFeature,
  NetworkAvailabilityFeatureCollection,
  NetworkAvailabilityProperties,
} from './networkAvailability'

type NetworkAvailabilityDeckLayerProps = {
  data: NetworkAvailabilityFeatureCollection
}

const NETWORK_DECK_ANCHOR_SOURCE_ID = 'network-availability-deck-anchor-source'
const NETWORK_DECK_ANCHOR_LAYER_ID = 'network-availability-deck-anchor-layer'

const NETWORK_FILL_COLORS: Record<string, [number, number, number]> = {
  '5G': [15, 118, 110],
  LTE: [37, 99, 235],
}

function networkFillColor(properties: NetworkAvailabilityProperties | null | undefined): [number, number, number] {
  const technology = String(properties?.technology ?? properties?.Speed ?? '')
  return NETWORK_FILL_COLORS[technology] ?? [100, 116, 139]
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatNetworkYear(value: NetworkAvailabilityProperties['Year']): string | null {
  if (value == null || value === '') return null

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numericValue)) {
    if (numericValue >= 1000 && numericValue <= 3000) return String(Math.trunc(numericValue))
    if (numericValue > 100_000_000_000) {
      const date = new Date(numericValue)
      if (!Number.isNaN(date.getTime())) return String(date.getUTCFullYear())
    }
  }

  const parsedDate = new Date(String(value))
  if (!Number.isNaN(parsedDate.getTime())) return String(parsedDate.getUTCFullYear())

  return String(value)
}

function networkTooltipHtml(properties: NetworkAvailabilityProperties | null | undefined): string {
  const technology = escapeHtml(properties?.technology || properties?.Speed || properties?.title || 'Coverage')
  const year = formatNetworkYear(properties?.year ?? properties?.Year)
  const yearLine = year ? `<div class="text-muted-foreground">Year ${escapeHtml(year)}</div>` : ''

  return `
    <div class="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div class="tooltip_title font-semibold text-foreground">Network availability</div>
      <div class="text-muted-foreground">${technology}</div>
      ${yearLine}
    </div>
  `
}

function getFirstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
}

function ensureDeckAnchorLayer(map: maplibregl.Map): string {
  if (!map.getSource(NETWORK_DECK_ANCHOR_SOURCE_ID)) {
    map.addSource(NETWORK_DECK_ANCHOR_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(NETWORK_DECK_ANCHOR_LAYER_ID)) {
    map.addLayer(
      {
        id: NETWORK_DECK_ANCHOR_LAYER_ID,
        type: 'circle',
        source: NETWORK_DECK_ANCHOR_SOURCE_ID,
        paint: {
          'circle-opacity': 0,
          'circle-radius': 0,
        },
      },
      getFirstSymbolLayerId(map),
    )
  }
  return NETWORK_DECK_ANCHOR_LAYER_ID
}

function removeDeckAnchorLayer(map: maplibregl.Map): void {
  try {
    if (map.getLayer(NETWORK_DECK_ANCHOR_LAYER_ID)) map.removeLayer(NETWORK_DECK_ANCHOR_LAYER_ID)
    if (map.getSource(NETWORK_DECK_ANCHOR_SOURCE_ID)) map.removeSource(NETWORK_DECK_ANCHOR_SOURCE_ID)
  } catch {
    // MapLibre can throw during style teardown.
  }
}

export function NetworkAvailabilityDeckLayer({ data }: NetworkAvailabilityDeckLayerProps) {
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const tooltipRef = useRef<maplibregl.Popup | null>(null)

  function removeTooltip() {
    tooltipRef.current?.remove()
  }

  useEffect(() => {
    if (!isLoaded || !map) return

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    tooltipRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapcn-tooltip aqmap-tooltip pointer-events-none',
      offset: 12,
    })

    const canvas = map.getCanvas()
    const handleDocumentPointerMove = (event: PointerEvent) => {
      if (event.target instanceof Node && canvas.contains(event.target)) return
      removeTooltip()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) removeTooltip()
    }

    canvas.addEventListener('mouseleave', removeTooltip)
    document.addEventListener('pointermove', handleDocumentPointerMove, true)
    window.addEventListener('blur', removeTooltip)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      canvas.removeEventListener('mouseleave', removeTooltip)
      document.removeEventListener('pointermove', handleDocumentPointerMove, true)
      window.removeEventListener('blur', removeTooltip)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      removeTooltip()
      tooltipRef.current = null
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl)
      } catch {
        // MapLibre can throw during style teardown.
      }
      removeDeckAnchorLayer(map)
      overlayRef.current = null
    }
  }, [isLoaded, map])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !map) return
    const beforeId = ensureDeckAnchorLayer(map)

    overlay.setProps({
      layers: [
        new GeoJsonLayer<NetworkAvailabilityFeature>({
          id: 'network-availability-deck-polygons',
          data,
          beforeId,
          pickable: true,
          stroked: true,
          filled: true,
          opacity: 0.46,
          getFillColor: (feature: NetworkAvailabilityFeature) => networkFillColor(feature.properties),
          getLineColor: [8, 51, 68, 97],
          getLineWidth: 0.5,
          lineWidthUnits: 'pixels',
          parameters: {
            depthTest: false,
          },
          onHover: (info: { object?: NetworkAvailabilityFeature | null; coordinate?: [number, number] }) => {
            const popup = tooltipRef.current
            if (!popup || !map || !info.object || !info.coordinate) {
              removeTooltip()
              return
            }

            popup
              .setLngLat(info.coordinate)
              .setHTML(networkTooltipHtml(info.object.properties))
              .addTo(map)
          },
        } as unknown as ConstructorParameters<typeof GeoJsonLayer<NetworkAvailabilityFeature>>[0]),
      ],
    })

    return () => {
      removeTooltip()
      overlay.setProps({ layers: [] })
    }
  }, [data, map])

  return null
}
