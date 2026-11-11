import { useEffect, useRef, useState } from 'react'

import { useMap } from '@/components/ui/map'
import { MapLineLayer, MapRasterLayer, MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'
import { escapeHtml } from '@/lib/escapeHtml'
import { SATELLITE_ATTRIBUTION, SATELLITE_TILES } from '@/pages/dev-forestry/SatelliteImagery'
import { MAX_DEM_ZOOM, TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/pages/dev-forestry/terrain'

import {
  EMPTY_RAILWAYS,
  RAILWAY_MIN_ZOOM,
  boundsContain,
  describeRailway,
  fetchRailways,
  padBounds,
  type Bounds,
  type RailwayCollection,
} from './railways'

const TERRAIN_ID = 'outdoors'
const HILLSHADE_LAYER_ID = `${TERRAIN_ID}-hillshade`

/**
 * Lifts the rail lines above the management-unit fill. That fill covers the
 * whole province and shows a hover card, and only the topmost card layer under
 * the pointer shows its card, so a line beneath it could never be read.
 */
const RAIL_LAYER_ORDER = 20

const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: MAX_DEM_ZOOM,
  attribution: TERRAIN_ATTRIBUTION,
}

export interface BaseLayerChoices {
  satellite: boolean
  relief: boolean
  rail: boolean
}

export const DEFAULT_BASE_LAYERS: BaseLayerChoices = { satellite: false, relief: false, rail: false }

export type RailLayerStatus =
  | { state: 'off' }
  | { state: 'zoom-in' }
  | { state: 'loading' }
  | { state: 'ready'; segments: number; truncated: boolean }
  | { state: 'error'; message: string }

/**
 * Satellite imagery under the labels and under the relief shading when that is
 * on, so the hills still read on the photo. A raster added above the hillshade
 * would hide it, and the two can be switched on in either order, so the anchor
 * is looked up after the relief has had its turn to mount.
 */
function ImageryLayer({ visible, relief }: { visible: boolean; relief: boolean }) {
  const { map, isLoaded } = useMap()
  const [anchor, setAnchor] = useState<{ id: string | undefined } | null>(null)

  useEffect(() => {
    if (!map || !isLoaded || !visible) return
    const find = () => {
      const firstLabel = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id
      setAnchor({ id: map.getLayer(HILLSHADE_LAYER_ID) ? HILLSHADE_LAYER_ID : firstLabel })
    }
    find()
    map.on('style.load', find)
    return () => {
      map.off('style.load', find)
      setAnchor(null)
    }
    // `relief` is a dependency on purpose: the hillshade layer appears and
    // disappears with it, and the imagery has to be re-anchored each time.
  }, [map, isLoaded, visible, relief])

  if (!visible || !anchor) return null
  return (
    <MapRasterLayer
      key={anchor.id ?? 'top'}
      tiles={SATELLITE_TILES}
      tileSize={256}
      // Esri answers z19 in rural BC with a grey placeholder tile; z18 is real.
      maxZoom={18}
      attribution={SATELLITE_ATTRIBUTION}
      beforeId={anchor.id}
    />
  )
}

function viewBounds(map: NonNullable<ReturnType<typeof useMap>['map']>): Bounds {
  const bounds = map.getBounds()
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
}

function railwayHoverHtml(properties: Record<string, unknown>): string {
  const { title, detail, caution } = describeRailway(properties)
  return `<div class="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    <div class="font-semibold">${escapeHtml(title)}</div>
    ${detail ? `<div class="mt-1 text-muted-foreground">${escapeHtml(detail)}</div>` : ''}
    <div class="mt-1 text-amber-700 dark:text-amber-400">${escapeHtml(caution)}</div>
  </div>`
}

/**
 * Rail lines for the view, asked for again only when the map leaves the box
 * the last answer covered. Zoomed out past `RAILWAY_MIN_ZOOM` nothing is asked
 * for and the last lines stay hidden.
 */
function RailwayLayer({ onStatus }: { onStatus: (status: RailLayerStatus) => void }) {
  const { map, isLoaded } = useMap()
  const [collection, setCollection] = useState<RailwayCollection>(EMPTY_RAILWAYS)
  const [zoomedIn, setZoomedIn] = useState(false)
  const coveredRef = useRef<Bounds | null>(null)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

  useEffect(() => {
    if (!map || !isLoaded) return
    let controller: AbortController | null = null

    const refresh = () => {
      const near = map.getZoom() >= RAILWAY_MIN_ZOOM
      setZoomedIn(near)
      if (!near) {
        controller?.abort()
        onStatusRef.current({ state: 'zoom-in' })
        return
      }
      const view = viewBounds(map)
      if (coveredRef.current && boundsContain(coveredRef.current, view)) return
      controller?.abort()
      const request = new AbortController()
      controller = request
      onStatusRef.current({ state: 'loading' })
      fetchRailways(padBounds(view, 0.5), request.signal)
        .then((result) => {
          if (request.signal.aborted) return
          // A clamped or truncated answer does not cover the padded box, so
          // only what was really asked for and fully returned counts.
          coveredRef.current = result.truncated ? null : result.bounds
          setCollection(result.collection)
          onStatusRef.current({
            state: 'ready',
            segments: result.collection.features.length,
            truncated: result.truncated,
          })
        })
        .catch((error: unknown) => {
          if (request.signal.aborted) return
          coveredRef.current = null
          onStatusRef.current({
            state: 'error',
            message: error instanceof Error ? error.message : 'Rail lines could not be loaded',
          })
        })
    }

    refresh()
    map.on('moveend', refresh)
    return () => {
      map.off('moveend', refresh)
      controller?.abort()
      onStatusRef.current({ state: 'off' })
    }
  }, [map, isLoaded])

  if (!zoomedIn) return null
  return (
    <>
      <MapLineLayer
        data={collection}
        color="#111827"
        width={['case', ['get', 'through'], 3.6, 2.2]}
        opacity={0.9}
        interactive={false}
        layerOrder={RAIL_LAYER_ORDER}
      />
      <MapLineLayer
        data={collection}
        color="#ffffff"
        width={['case', ['get', 'through'], 1.8, 1]}
        dashArray={[3, 3]}
        interactive={false}
        layerOrder={RAIL_LAYER_ORDER + 1}
      />
      {/* A line two pixels wide is hard to point at, so a wide, near-invisible
          copy on top takes the pointer and shows the card. */}
      <MapLineLayer
        data={collection}
        color="#ffffff"
        width={14}
        opacity={0.01}
        hoverHtml={railwayHoverHtml}
        layerOrder={RAIL_LAYER_ORDER + 2}
      />
    </>
  )
}

/** The outdoors planner's optional base layers. Render inside the planner's `Map`. */
export function OutdoorsBaseLayers({
  choices,
  onRailStatus,
}: {
  choices: BaseLayerChoices
  onRailStatus: (status: RailLayerStatus) => void
}) {
  return (
    <>
      {choices.relief && (
        <MapTerrain
          id={TERRAIN_ID}
          dem={DEM}
          reliefOnly
          // Over a photo the shading only has to hint at the slope; on the
          // pale plan map it carries the whole picture of the ground.
          hillshadeIntensity={choices.satellite ? 0.35 : 0.6}
          hillshadeShadowColor="#1e293b"
          hillshadeHighlightColor="#f8fafc"
        />
      )}
      <ImageryLayer visible={choices.satellite} relief={choices.relief} />
      {choices.rail && <RailwayLayer onStatus={onRailStatus} />}
    </>
  )
}
