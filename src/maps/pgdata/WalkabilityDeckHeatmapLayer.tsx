import { useEffect, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { BitmapLayer } from '@deck.gl/layers'
import { useMap } from '@/components/ui/map'
import maplibregl from 'maplibre-gl'

type WalkabilityImageCoordinates = [[number, number], [number, number], [number, number], [number, number]]

export type WalkabilityDeckHeatmapLayerProps = {
  rows: number
  cols: number
  imageCoordinates: WalkabilityImageCoordinates
  rle: Array<[number, number]>
  layerKey: string
}

const WALKABILITY_GRID_COLORS: Record<number, [number, number, number, number]> = {
  1: [79, 154, 214, 217],
  2: [158, 201, 156, 217],
  3: [245, 228, 81, 217],
  4: [232, 156, 74, 217],
  5: [211, 59, 59, 217],
}

const WALKABILITY_GRID_LABELS: Record<number, string> = {
  1: '1-27',
  2: '28-45',
  3: '46-63',
  4: '64-82',
  5: '83-170',
}

function walkabilityTooltipHtml(label: string): string {
  return `
    <div class="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div class="tooltip_title font-semibold text-foreground">Walkability</div>
      <div class="text-muted-foreground">Mobility Index ${label}</div>
    </div>
  `
}

function renderWalkabilityGridCanvas(rows: number, cols: number, rle: Array<[number, number]>) {
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create walkability heatmap canvas context')

  const image = context.createImageData(cols, rows)
  const values = new Uint8Array(rows * cols)
  let pixel = 0
  const maxPixels = rows * cols

  for (const [value, count] of rle) {
    const color = WALKABILITY_GRID_COLORS[value] ?? [0, 0, 0, 0]
    const end = Math.min(maxPixels, pixel + count)
    for (; pixel < end; pixel += 1) {
      const offset = pixel * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
      values[pixel] = value
    }
  }

  context.putImageData(image, 0, 0)
  return { canvas, values }
}

function toDeckBitmapBounds(
  coordinates: WalkabilityImageCoordinates,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [topLeft, topRight, bottomRight, bottomLeft] = coordinates
  return [bottomLeft, topLeft, topRight, bottomRight]
}

export function WalkabilityDeckHeatmapLayer({
  rows,
  cols,
  imageCoordinates,
  rle,
  layerKey,
}: WalkabilityDeckHeatmapLayerProps) {
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const tooltipRef = useRef<maplibregl.Popup | null>(null)
  const [overlayRevision, setOverlayRevision] = useState(0)

  function removeTooltip() {
    tooltipRef.current?.remove()
  }

  useEffect(() => {
    if (!isLoaded || !map) return

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    setOverlayRevision((current) => current + 1)
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
      overlayRef.current = null
    }
  }, [isLoaded, map])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !map || !overlayRevision) return

    const { canvas, values } = renderWalkabilityGridCanvas(rows, cols, rle)
    overlay.setProps({
      layers: [
        new BitmapLayer({
          id: `walkability-deck-heatmap-${layerKey}`,
          image: canvas,
          bounds: toDeckBitmapBounds(imageCoordinates),
          opacity: 0.78,
          pickable: true,
          onHover: (info: { coordinate?: [number, number]; bitmap?: { pixel: [number, number] } | null }) => {
            const popup = tooltipRef.current
            if (!popup || !map || !info.coordinate || !info.bitmap?.pixel) {
              tooltipRef.current?.remove()
              return
            }

            const [rawX, rawY] = info.bitmap.pixel
            const x = Math.max(0, Math.min(cols - 1, Math.floor(rawX)))
            const y = Math.max(0, Math.min(rows - 1, Math.floor(rawY)))
            const value = values[y * cols + x]
            const label = WALKABILITY_GRID_LABELS[value]

            if (!label) {
              popup.remove()
              return
            }

            popup
              .setLngLat(info.coordinate)
              .setHTML(walkabilityTooltipHtml(label))
              .addTo(map)
          },
          textureParameters: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipmapFilter: 'none',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          },
          parameters: {
            depthTest: false,
          },
        } as unknown as ConstructorParameters<typeof BitmapLayer>[0]),
      ],
    })

    return () => {
      tooltipRef.current?.remove()
      overlay.setProps({ layers: [] })
    }
  }, [cols, imageCoordinates, layerKey, map, overlayRevision, rle, rows])

  return null
}
