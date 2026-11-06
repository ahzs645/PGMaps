import { useEffect, useMemo, useState } from 'react'
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import proj4 from 'proj4'
import { Map, MapScaleBar, useMap, WORKSPACE_MAP_CONTROLS } from '@/components/ui/map'
import { MapImageLayer, type MapQuadCoordinates } from '@/components/ui/map-layers'
import { indexAt, type RestorationResult } from './model'
import { ALL_PRODUCTS as PRODUCTS, type AnalysisProduct as Product } from './products'
import { projectionDefinition, rasterCorners, rasterStats } from './outputs'

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}
const STYLES = { light: STYLE, dark: STYLE }

function RasterLayer({ result, product }: { result: RestorationResult; product: Product }) {
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
      pixels.data.set([Math.round(240 - 220 * t), Math.round(248 - 110 * t), Math.round(210 - 160 * t), 230], pixel * 4)
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
  return (
    <>
      <MapImageLayer
        id="restoration-raster"
        url={preview.url}
        coordinates={coordinates}
        opacity={0.9}
        resampling="nearest"
      />
      <div
        className="absolute bottom-12 left-3 z-10 max-w-xs rounded-lg border bg-background/95 p-3 text-xs shadow"
        aria-label="Raster legend"
      >
        <p className="font-semibold">
          {PRODUCTS[product].label} · {g.cellM} m cells
        </p>
        <div className="my-2 h-2 rounded bg-gradient-to-r from-[#f0f8d2] to-[#148a32]" />
        <p>
          {preview.stats.min?.toFixed(2) ?? 'NoData'} – {preview.stats.max?.toFixed(2) ?? 'NoData'}{' '}
          {PRODUCTS[product].unit}
        </p>
        <p className="mt-1">Transparent = NoData. Click for a source cell value.</p>
        <p role="status">{picked?.product === product ? picked.text : ''}</p>
      </div>
    </>
  )
}

export function RestorationMap({ result, product }: { result: RestorationResult | null; product: Product }) {
  return (
    <Map center={[-122.8, 53.9]} zoom={10} styles={STYLES} controls={WORKSPACE_MAP_CONTROLS}>
      <MapScaleBar />
      {result && <RasterLayer result={result} product={product} />}
      {!result && (
        <div className="absolute left-4 top-4 max-w-sm rounded-lg border bg-background/95 p-4 text-sm shadow">
          Choose local LiDAR files and run the analysis to display restoration metrics here.
        </div>
      )}
    </Map>
  )
}
