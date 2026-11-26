/**
 * The geographic illustration's hatch on a live map: the same recipe and coverage as the drawing,
 * as map tiles drawn in a worker (`MapHatchLayer`), so a pan shows more of the same field and zooming
 * keeps the strokes' size on screen. The land is the drawing's own, put back on the ground.
 */
import { useMemo } from 'react'
import { organicHatchRecipe, type OrganicHatchRecipe } from '@pgmaps/geo-toolkit/patterns'
import { geojsonBasemapStyle } from '@pgmaps/geo-toolkit/map'
import { Map, MapControls } from '@/components/ui/map'
import { MapFillLayer, MapHatchLayer } from '@/components/ui/map-layers'
import type { HatchOptions, PatchHatchStyleOptions } from '@/lib/illustratedMap'
import { MAP_PALETTE } from '@/lib/illustratedMap/layout'
import type { GeographicMapOptions } from '@/lib/illustratedMap/geographic'
import { liveFrameBounds, liveHatchAreas, liveLandGeoJson } from '@/lib/illustratedMap/liveGeography'

/** The layer's id, which measurements and captures look up. */
export const LIVE_HATCH_LAYER_ID = 'illustrated-live-hatch'

export interface LiveHatchMapProps {
  coverage: NonNullable<GeographicMapOptions['coverage']>
  hatchStyle: NonNullable<GeographicMapOptions['hatchStyle']>
  hatch: HatchOptions
  patchHatch: PatchHatchStyleOptions
  /** Water kept along every shore, CSS pixels, as the drawing's channel gap in its units. */
  channelGap?: number
  /** `false` fills every lake as land, as the drawing's `lakes` option does. */
  lakes?: boolean
}

/** The workshop's settings as a saved recipe: artboard pixels become CSS pixels on the map. */
export function liveRecipe({
  hatchStyle,
  hatch,
  patchHatch,
}: Omit<LiveHatchMapProps, 'coverage' | 'channelGap' | 'lakes'>): OrganicHatchRecipe {
  const color = MAP_PALETTE.hatch.toLowerCase()
  if (hatchStyle === 'patch') {
    const { patchSize, lean, leanBias, seam, ...rest } = patchHatch
    return organicHatchRecipe({ style: 'patch', ...rest, patch: { patchSize, lean, leanBias, seam }, color })
  }
  return organicHatchRecipe({ ...hatch, color })
}

export default function LiveHatchMap(props: LiveHatchMapProps) {
  const styles = useMemo(() => {
    const style = geojsonBasemapStyle({
      land: liveLandGeoJson('land'),
      water: MAP_PALETTE.ocean,
      landColor: MAP_PALETTE.surrounding,
      borderWidth: 0,
    })
    return { light: style, dark: style }
  }, [])
  const lakes = props.lakes ?? true
  // The basemap keeps its lakes (a new style would reload the map); without lakes, the frame's land
  // is filled again over it, lakes and all, under the province.
  const province = useMemo(() => liveLandGeoJson('bcLand', lakes), [lakes])
  const land = useMemo(() => liveLandGeoJson('land', lakes), [lakes])
  const areas = liveHatchAreas(props.coverage, lakes)
  const recipe = useMemo(
    () => liveRecipe(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the recipe follows these values, not the props object
    [props.hatchStyle, props.hatch, props.patchHatch],
  )
  const [[west, south], [east, north]] = useMemo(() => liveFrameBounds(), [])
  return (
    <div className="h-[min(72vh,760px)] min-h-[420px] overflow-hidden rounded-lg border" data-testid="live-hatch-map">
      <Map
        styles={styles}
        viewport={{ center: [(west + east) / 2, (south + north) / 2], zoom: 4.6 }}
        controls={<MapControls showZoom />}
      >
        {!lakes && (
          <MapFillLayer
            data={land}
            fillColor={MAP_PALETTE.surrounding}
            fillOpacity={1}
            lineWidth={0}
            lineOpacity={0}
            interactive={false}
            layerOrder={0}
          />
        )}
        <MapFillLayer
          data={province}
          fillColor={MAP_PALETTE.paper}
          fillOpacity={1}
          lineWidth={0}
          lineOpacity={0}
          interactive={false}
          layerOrder={1}
        />
        <MapHatchLayer id={LIVE_HATCH_LAYER_ID} recipe={recipe} areas={areas} layerOrder={2} />
        {(props.channelGap ?? 0) > 0 && (
          // Every shore drawn in the sea's colour over the land and hatch: the drawing's channel gap.
          <MapFillLayer
            data={land}
            fillColor={MAP_PALETTE.ocean}
            fillOpacity={0}
            lineColor={MAP_PALETTE.ocean}
            lineWidth={props.channelGap}
            lineOpacity={1}
            interactive={false}
            layerOrder={3}
          />
        )}
      </Map>
    </div>
  )
}
