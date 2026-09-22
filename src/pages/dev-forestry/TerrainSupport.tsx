import type MapLibreGL from 'maplibre-gl'
import { useEffect } from 'react'

import { useMap } from '@/components/ui/map'

import { MAX_DEM_ZOOM, TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from './terrain'

// MapLibre asks for separate sources for relief shading and for 3D terrain —
// sharing one degrades rendering quality, because each wants its own tile
// resolution for the same view.
const HILLSHADE_SOURCE_ID = 'forestry-dem-hillshade'
const TERRAIN_SOURCE_ID = 'forestry-dem-terrain'
const HILLSHADE_LAYER_ID = 'forestry-hillshade'

type TerrainSupportProps = {
  /** Lifts the basemap onto 3D terrain. Off, only the hillshade is drawn. */
  terrain?: boolean
  hillshade?: boolean
  exaggeration?: number
  /** How hard the relief shading is driven, 0–1. */
  hillshadeIntensity?: number
}

/** Labels read badly under a hillshade, so it goes below the first symbol layer. */
function firstSymbolLayerId(map: MapLibreGL.Map): string | undefined {
  return map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id
}

/**
 * Puts the same elevation data the analysis uses onto the map, as relief
 * shading and as 3D terrain.
 *
 * Sharing one DEM source matters for drive mode: the ridge that hides a block
 * in the numbers is then the same ridge that hides it on screen.
 */
export function TerrainSupport({
  terrain = false,
  hillshade = true,
  exaggeration = 1,
  hillshadeIntensity = 0.45,
}: TerrainSupportProps) {
  const { map, isLoaded } = useMap()

  // Mount the source and hillshade layer. A style swap (theme change) resets
  // `isLoaded`, which tears this down and rebuilds it on the new style.
  useEffect(() => {
    if (!isLoaded || !map) return

    const demSource = {
      type: 'raster-dem' as const,
      tiles: [TERRARIUM_TILE_URL],
      encoding: 'terrarium' as const,
      tileSize: 256,
      maxzoom: MAX_DEM_ZOOM,
      attribution: TERRAIN_ATTRIBUTION,
    }
    if (!map.getSource(HILLSHADE_SOURCE_ID)) map.addSource(HILLSHADE_SOURCE_ID, demSource)
    if (!map.getSource(TERRAIN_SOURCE_ID)) map.addSource(TERRAIN_SOURCE_ID, demSource)

    if (!map.getLayer(HILLSHADE_LAYER_ID)) {
      map.addLayer(
        {
          id: HILLSHADE_LAYER_ID,
          type: 'hillshade',
          source: HILLSHADE_SOURCE_ID,
          paint: {
            'hillshade-shadow-color': '#1e293b',
            'hillshade-highlight-color': '#f8fafc',
          },
        },
        firstSymbolLayerId(map),
      )
    }

    return () => {
      // Terrain has to be released before the source it reads from.
      if (map.getTerrain()) map.setTerrain(null)
      if (map.getLayer(HILLSHADE_LAYER_ID)) map.removeLayer(HILLSHADE_LAYER_ID)
      if (map.getSource(HILLSHADE_SOURCE_ID)) map.removeSource(HILLSHADE_SOURCE_ID)
      if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID)
    }
  }, [isLoaded, map])

  useEffect(() => {
    if (!terrain || !isLoaded || !map) return
    // The pale plan-map background reads as snow at eye level. Change only
    // the base ground; water and mapped land-cover layers retain their meaning.
    const backgrounds = map.getStyle().layers.filter((layer) => layer.type === 'background')
    const original = backgrounds.map((layer) => ({
      id: layer.id,
      color: map.getPaintProperty(layer.id, 'background-color'),
    }))
    for (const layer of backgrounds) map.setPaintProperty(layer.id, 'background-color', '#798564')
    return () => {
      for (const layer of original)
        if (map.getLayer(layer.id)) map.setPaintProperty(layer.id, 'background-color', layer.color)
    }
  }, [terrain, isLoaded, map])

  useEffect(() => {
    if (!isLoaded || !map || !map.getSource(TERRAIN_SOURCE_ID)) return
    map.setTerrain(terrain ? { source: TERRAIN_SOURCE_ID, exaggeration } : null)

    // From eye level the top half of the frame is sky. Without one the horizon
    // ends in a hard edge against the page background, and distant ridges lose
    // the haze that makes them read as distant. Looking straight down it is
    // only haze over the map, so it is blended away rather than left on.
    map.setSky(
      terrain
        ? {
            'sky-color': '#8ab4dd',
            'horizon-color': '#dce9f5',
            'fog-color': '#e6eef5',
            'horizon-fog-blend': 0.6,
            'fog-ground-blend': 0.05,
            'sky-horizon-blend': 0.8,
          }
        : { 'atmosphere-blend': 0 },
    )
  }, [exaggeration, isLoaded, map, terrain])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(HILLSHADE_LAYER_ID)) return
    map.setLayoutProperty(HILLSHADE_LAYER_ID, 'visibility', hillshade ? 'visible' : 'none')
    map.setPaintProperty(HILLSHADE_LAYER_ID, 'hillshade-exaggeration', hillshadeIntensity)
  }, [hillshade, hillshadeIntensity, isLoaded, map])

  return null
}
