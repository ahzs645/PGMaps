import { useEffect, useMemo, useState } from 'react'
import type { MapMouseEvent } from 'maplibre-gl'
import proj4 from 'proj4'
import { Map, MapControls, MapLayersControl, MapScaleBar, useMap } from '@/components/ui/map'
import { MapImageLayer, type MapQuadCoordinates } from '@/components/ui/map-layers'
import { MapGradientLegendItem, MapLegendPanel, MapOverlay } from '@/components/ui/map-panels'
import {
  IMAGERY_BASEMAPS,
  SatelliteImagery,
  useStoredImageryBasemap,
  type ImageryBasemap,
} from '@/components/ui/map-satellite-imagery'
import { PG_CENTER } from '@/components/ui/map-styles'
import { indexAt, type RestorationResult } from './model'
import { ALL_PRODUCTS as PRODUCTS, type AnalysisProduct as Product } from './products'
import { projectionDefinition, rasterCorners, rasterStats } from './outputs'

/** The preview ramp, low to high; the legend draws the same two stops. */
const RAMP_LOW = [240, 248, 210] as const
const RAMP_HIGH = [20, 138, 50] as const
const RAMP_COLORS = [RAMP_LOW, RAMP_HIGH].map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`)

function RasterLayer({
  result,
  product,
  basemap,
}: {
  result: RestorationResult
  product: Product
  basemap: ImageryBasemap
}) {
  const { map, isLoaded } = useMap()
  const [picked, setPicked] = useState<{ product: Product; text: string } | null>(null)
  const g = result.rasters[product]
  const preview = useMemo(() => {
    const stats = rasterStats(g),
      min = stats.min ?? 0,
      max = stats.max ?? 1
    const canvas = document.createElement('canvas')
    // MapLibre 5 requests mipmaps for square power-of-two image textures when
    // nearest resampling is selected, but ImageSource creates no mipmaps. One
    // transparent east column avoids that black-texture path without changing data.
    const pad = g.width === g.height && (g.width & (g.width - 1)) === 0 ? 1 : 0
    canvas.width = g.width + pad
    canvas.height = g.height
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(canvas.width, g.height)
    g.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return
      const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
      const pixel = Math.floor(i / g.width) * canvas.width + (i % g.width)
      pixels.data.set(
        [
          Math.round(RAMP_LOW[0] + (RAMP_HIGH[0] - RAMP_LOW[0]) * t),
          Math.round(RAMP_LOW[1] + (RAMP_HIGH[1] - RAMP_LOW[1]) * t),
          Math.round(RAMP_LOW[2] + (RAMP_HIGH[2] - RAMP_LOW[2]) * t),
          230,
        ],
        pixel * 4,
      )
    })
    context.putImageData(pixels, 0, 0)
    return { url: canvas.toDataURL(), stats, width: canvas.width }
  }, [g])
  const coordinates = rasterCorners({ ...g, width: preview.width }, result.epsg) as MapQuadCoordinates
  useEffect(() => {
    if (!map || !isLoaded) return
    const corners = rasterCorners(result.rasters.terrain, result.epsg)
    map.fitBounds(
      [
        [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1]))],
        [Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))],
      ],
      { padding: 35, duration: 0 },
    )
  }, [map, isLoaded, result])
  useEffect(() => {
    if (!map) return
    const projection = proj4('EPSG:4326', projectionDefinition(result.epsg))
    const click = (event: MapMouseEvent) => {
      const coordinate: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      const [x, y] = projection.forward(coordinate)
      const i = indexAt(g, x, y),
        value = g.values[i]
      setPicked({
        product,
        text:
          i < 0 || !Number.isFinite(value)
            ? 'NoData at this location'
            : `${value.toFixed(3)} ${PRODUCTS[product].unit} · cell ${(i % g.width) + 1}, ${Math.floor(i / g.width) + 1}`,
      })
    }
    map.on('click', click)
    return () => {
      map.off('click', click)
    }
  }, [map, g, product, result.epsg])
  const unit = PRODUCTS[product].unit
  return (
    <>
      {/* Re-added on top after a basemap switch: imagery goes in under the basemap's labels, or on top of
          everything when the style has none, and must never cover the results. */}
      <MapImageLayer
        key={basemap}
        id="restoration-raster"
        url={preview.url}
        coordinates={coordinates}
        opacity={0.9}
        resampling="nearest"
      />
      <MapLegendPanel
        title={PRODUCTS[product].label}
        description={`${g.cellM} m cells`}
        collapsible
        defaultCollapsed="mobile"
        aria-label="Raster legend"
      >
        <MapGradientLegendItem
          colors={RAMP_COLORS}
          minLabel={preview.stats.min === null ? 'NoData' : `${preview.stats.min.toFixed(2)} ${unit}`}
          maxLabel={preview.stats.max === null ? 'NoData' : `${preview.stats.max.toFixed(2)} ${unit}`}
        />
        <p className="mt-2 text-xs text-muted-foreground">Transparent = NoData. Click for a source cell value.</p>
        <p role="status" className="mt-1 text-xs">
          {picked?.product === product ? picked.text : ''}
        </p>
      </MapLegendPanel>
    </>
  )
}

export function RestorationMap({ result, product }: { result: RestorationResult | null; product: Product }) {
  const [basemap, setBasemap] = useStoredImageryBasemap('pgmaps-restoration-basemap')
  return (
    <Map
      center={PG_CENTER}
      zoom={10}
      controls={
        <MapControls position="top-right" showZoom showCompass showFullscreen>
          <MapLayersControl
            label="Basemap"
            basemaps={IMAGERY_BASEMAPS}
            basemap={basemap}
            onBasemapChange={setBasemap}
          />
        </MapControls>
      }
    >
      <SatelliteImagery visible={basemap === 'satellite'} />
      <MapScaleBar />
      {result && <RasterLayer result={result} product={product} basemap={basemap} />}
      {!result && (
        <MapOverlay position="top-left" clearChrome className="max-w-sm p-4 text-sm">
          Choose local LiDAR files and run the analysis to display restoration metrics here.
        </MapOverlay>
      )}
    </Map>
  )
}
