import { useEffect, useMemo, useRef, useState } from 'react'
import type * as MapLibreGL from 'maplibre-gl'

import { boundsToQuad, MapImageLayer, MapLineLayer } from '@/components/ui/map-layers'
import { lineSymbolPaint } from '@/lib/mapSheet/mapSymbols'

import { boundsBox, closedFootprint, drapeLookImage, hiddenGroundTile, type PhotoDrapeLook } from './photoDrapeImage'
import { PHOTO_PLAN_SYMBOLS } from './photoPlanStyle'
import type { PlanBasemap, PlanShow } from './planLayers'
import type { Bounds, Rgba } from './photoViews'

export type { PhotoDrapeLook } from './photoDrapeImage'

/** One photo laid on the plan for one camera: the camera found, or the runner-up. */
export type PlanPhotoDrape = {
  /** Stable for the candidate (`'camera'`, `'runner-up'`, or a record id): the image updates in place under it. */
  id: string
  /** The drape's cells (`photoViews.drapePhoto`). Needed for the edges look and the hidden-ground hatch. */
  rgba?: Rgba | null
  /** An image already encoded, used only when `rgba` is not given; it draws the filled look and nothing else. */
  url?: string | null
  /** West, south, east, north of the raster, WGS84. */
  bounds: Bounds
  look: PhotoDrapeLook
  /** The frame on the ground, traced from the edge rays, as [lng, lat]. */
  footprint: ReadonlyArray<readonly [number, number]>
  /** One byte a cell of `rgba`, 1 where the frame covers ground that nearer terrain hides. */
  hiddenMask?: Uint8Array | null
}

const FOOTPRINT = lineSymbolPaint(PHOTO_PLAN_SYMBOLS.footprint)[0]
const OTHER_FOOTPRINT = lineSymbolPaint(PHOTO_PLAN_SYMBOLS.otherFootprint)[0]
const ACTIVE_FILTER = ['==', ['get', 'active'], 1] as never
const OTHER_FILTER = ['==', ['get', 'active'], 0] as never

/** The basemap's first label layer: the drape goes under it, as the imagery does, so labels stay readable. */
const firstLabelLayer = (map: MapLibreGL.Map) => map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id

/**
 * An image as an object URL, encoded by the browser's own PNG encoder. While a new image encodes, the last URL
 * stays, so a live drape never blinks out between updates; each URL is released once a newer one replaces it
 * (the map's image source has decoded it by then), and the last on unmount. No image: no URL.
 */
function useImageUrl(image: Rgba | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  useEffect(() => {
    if (!image) return
    let cancelled = false
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    canvas.toBlob((blob) => {
      if (!blob || cancelled) return
      const previous = current.current
      current.current = URL.createObjectURL(blob)
      setUrl(current.current)
      // Later, not now: MapLibre may still be reading the replaced image when the new URL arrives.
      if (previous) setTimeout(() => URL.revokeObjectURL(previous), 2000)
    }, 'image/png')
    return () => {
      cancelled = true
    }
  }, [image])
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current)
      current.current = null
    },
    [],
  )
  return image ? url : null
}

function DrapeImage({
  drape,
  shown,
  opacity,
  hatch,
}: {
  drape: PlanPhotoDrape
  shown: boolean
  opacity: number
  hatch: ReturnType<typeof hiddenGroundTile>
}) {
  const image = useMemo(
    () => (drape.rgba ? drapeLookImage(drape.rgba, drape.look, { hiddenMask: drape.hiddenMask, hatch }) : null),
    [drape.rgba, drape.look, drape.hiddenMask, hatch],
  )
  const encoded = useImageUrl(image)
  const url = drape.rgba ? encoded : drape.look === 'filled' ? (drape.url ?? null) : null
  const coordinates = useMemo(() => boundsToQuad(boundsBox(drape.bounds)), [drape.bounds])
  if (!url) return null
  return (
    <MapImageLayer
      url={url}
      coordinates={coordinates}
      opacity={opacity}
      // Edges are one cell wide: smoothing them would grey them out.
      resampling={drape.look === 'edges' ? 'nearest' : 'linear'}
      visible={shown}
      beforeId={firstLabelLayer}
    />
  )
}

/**
 * An own photo laid on the plan: one image for each candidate camera (the one found and its runner-up), the
 * active one shown and the other kept loaded but hidden, so switching between them, or holding B to blink the
 * imagery through, shows at once. Each image updates in place (`updateImage`) when the camera, the look or the
 * cells change; nothing is remounted. Every candidate's footprint is outlined, the active one solid.
 *
 * Display only, and terrain only: the hatch marks ground nearer terrain hides, never the run's visibility. The
 * plan does not fly to the drape; the card's *Show the photo's ground* does that.
 *
 * `basemap` remounts the images when it changes: imagery switched on later inserts itself under the labels too,
 * which would put it over a drape already there.
 */
export function PhotoDrapeLayer({
  drapes,
  active,
  opacity = 0.85,
  blink = false,
  visible = true,
  hidden,
  basemap,
}: {
  drapes: readonly PlanPhotoDrape[]
  /** The drape shown; the others keep only their footprint. */
  active: string | null
  opacity?: number
  /** Held down: the photo is hidden so the imagery under it shows. */
  blink?: boolean
  visible?: boolean
  hidden: PlanShow['hidden']
  basemap?: PlanBasemap
}) {
  const hatch = useMemo(() => hiddenGroundTile(), [])
  const footprints = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: drapes.flatMap((drape) => {
        const ring = closedFootprint(drape.footprint)
        return ring
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: ring },
                properties: { kind: 'footprint', id: drape.id, active: drape.id === active ? 1 : 0 },
              },
            ]
          : []
      }),
    }),
    [drapes, active],
  )
  const drapeShown = visible && !blink && !hidden.has('photo:drape')
  const footprintShown = visible && !hidden.has('photo:footprint') && footprints.features.length > 0
  return (
    <>
      {drapes.map((drape) => (
        <DrapeImage
          key={`${drape.id}-${basemap ?? ''}`}
          drape={drape}
          shown={drapeShown && drape.id === active}
          opacity={opacity}
          hatch={hatch}
        />
      ))}
      <MapLineLayer
        data={footprints}
        interactive={false}
        visible={footprintShown}
        filter={OTHER_FILTER}
        color={OTHER_FOOTPRINT['line-color']}
        width={OTHER_FOOTPRINT['line-width']}
        opacity={OTHER_FOOTPRINT['line-opacity'] ?? 1}
        dashArray={OTHER_FOOTPRINT['line-dasharray']}
      />
      <MapLineLayer
        data={footprints}
        interactive={false}
        visible={footprintShown}
        filter={ACTIVE_FILTER}
        color={FOOTPRINT['line-color']}
        width={FOOTPRINT['line-width']}
        opacity={FOOTPRINT['line-opacity'] ?? 1}
        lineJoin="round"
      />
    </>
  )
}
