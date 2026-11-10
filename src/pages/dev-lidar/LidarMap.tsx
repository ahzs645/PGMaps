import { useState, type ReactNode } from 'react'
import type { Map as MapLibreMap, MapOptions, StyleSpecification } from 'maplibre-gl'
import type { LidarControl } from 'maplibre-gl-lidar'
import { captureMapImage } from '@pgmaps/geo-toolkit/map/map-capture'
import { ImageDown } from 'lucide-react'
import { Map as ToolkitMap, MapControls, MapScaleBar, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'
import { MAX_DEM_ZOOM, TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '../dev-forestry/terrain'

const MAX_PITCH = 75

/**
 * The point cloud's frame, for a saved image. Its deck.gl canvas clears between frames and
 * reads back blank later, so the copy happens inside deck's own after-render callback.
 * maplibre-gl-lidar keeps deck private; if it moves, the image is the map without the cloud.
 */
export function pointCloudFrame(control: LidarControl | null) {
  const overlay = control?.getDeckOverlay() as unknown as { _overlay?: { _deck?: DeckFrame } } | undefined
  const deck = overlay?._overlay?._deck
  if (!deck) return Promise.resolve<HTMLCanvasElement[]>([])
  return new Promise<HTMLCanvasElement[]>((resolve) => {
    const previous = deck.props.onAfterRender
    const finish = (frames: HTMLCanvasElement[]) => {
      window.clearTimeout(timeout)
      deck.setProps({ onAfterRender: previous })
      resolve(frames)
    }
    const timeout = window.setTimeout(() => finish([]), 2000)
    deck.setProps({
      onAfterRender: (context) => {
        previous?.(context)
        const canvas = deck.getCanvas()
        const copy = document.createElement('canvas')
        copy.width = canvas?.width ?? 0
        copy.height = canvas?.height ?? 0
        if (canvas) copy.getContext('2d')?.drawImage(canvas, 0, 0)
        finish(canvas ? [copy] : [])
      },
    })
    deck.redraw('map image')
  })
}

interface DeckFrame {
  props: { onAfterRender?: (context: unknown) => void }
  setProps(props: { onAfterRender?: (context: unknown) => void }): void
  redraw(reason: string): void
  getCanvas(): HTMLCanvasElement | null
}

const REGIONAL_DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: MAX_DEM_ZOOM,
  attribution: TERRAIN_ATTRIBUTION,
}

/**
 * Relief around the survey, under its layers. `reliefOnly` matters: maplibre-gl-lidar owns
 * the map's 3D terrain, and a plain `MapTerrain` would clear it.
 */
export function RegionalHillshade({ beforeId }: { beforeId: string }) {
  return <MapTerrain id="lidar-regional" dem={REGIONAL_DEM} reliefOnly beforeId={beforeId} hillshadeIntensity={0.35} />
}

/** Saves what the map shows; `overlays` adds a point cloud drawn on a separate canvas. */
function SaveMapImage({ overlays }: { overlays?: () => Promise<CanvasImageSource[]> }) {
  const { map, isLoaded } = useMap()
  const [saving, setSaving] = useState(false)
  if (!map || !isLoaded) return null
  const save = async () => {
    setSaving(true)
    try {
      const blob = await captureMapImage(map, { overlays })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'lidar-map.png'
      link.click()
      URL.revokeObjectURL(link.href)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      // Under the zoom, compass and fullscreen buttons, which are 44 px on phones and 32 px from md up.
      className="absolute right-2 top-[calc(var(--map-mobile-toolbar-height,0px)_+_13.125rem)] z-10 size-11 bg-background md:top-[10rem] md:size-8"
      aria-label="Save map image"
      title="Save map image"
      disabled={saving}
      onClick={() => void save()}
    >
      <ImageDown className="size-4" aria-hidden="true" />
    </Button>
  )
}

/**
 * The toolkit map for LiDAR work. Layers here depend on insertion order and anchors, and
 * nothing re-adds them, so the style is fixed for the map's life: `basemaps.ts` switches
 * the basemap in place and a theme change must not replace the style.
 */
export function LidarMap({
  style,
  label,
  onMapCreate,
  onCreateError,
  children,
  saveImage = false,
  imageOverlays,
  ...options
}: {
  style: StyleSpecification
  label?: string
  onMapCreate: (map: MapLibreMap) => void | (() => void)
  onCreateError: (error: unknown) => void
  children?: ReactNode
  saveImage?: boolean
  /** Frames of anything drawn outside the map's canvas, for a saved image to include. */
  imageOverlays?: () => Promise<CanvasImageSource[]>
} & Pick<MapOptions, 'bounds' | 'fitBoundsOptions' | 'center' | 'zoom' | 'bearing' | 'pitch'>) {
  const [styles] = useState(() => ({ light: style, dark: style }))
  return (
    <ToolkitMap
      {...options}
      className="absolute inset-0"
      styles={styles}
      maxPitch={MAX_PITCH}
      renderWorldCopies
      showLoadingOverlay={false}
      controls={<MapControls position="top-right" showZoom showCompass draggableCompass showFullscreen />}
      containerProps={{ 'aria-label': label }}
      onMapCreate={onMapCreate}
      onCreateError={onCreateError}
    >
      {/* MapLibre's scale control stayed on at any pitch, so this never hides; it clears the status strip. */}
      <MapScaleBar hideAbovePitch={MAX_PITCH} className="bottom-[4.5rem]" />
      {saveImage && <SaveMapImage overlays={imageOverlays} />}
      {children}
    </ToolkitMap>
  )
}
