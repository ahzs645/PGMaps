import { MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'

import { MAX_DEM_ZOOM, TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/lib/forestry/terrain/terrain'

const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: MAX_DEM_ZOOM,
  attribution: TERRAIN_ATTRIBUTION,
}

// From eye level the top half of the frame is sky. Without one the horizon ends
// in a hard edge against the page background. The ground gets no fog
// (`fog-ground-blend: 1` puts its start at the horizon): MapLibre places terrain
// fog from the camera's height above sea level, so at a viewpoint a few metres
// above a lake or the sea it began tens of metres out and turned every hillside
// the fog colour behind the unfogged trees. Distance haze is `hazeRings`.
const EYE_LEVEL_SKY: MapTerrainProps['sky'] = {
  'sky-color': '#8ab4dd',
  'horizon-color': '#dce9f5',
  'fog-color': '#e6eef5',
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 1,
  'sky-horizon-blend': 0.8,
}

/**
 * Puts the same elevation data the analysis uses onto the map, as relief
 * shading and as 3D terrain.
 *
 * Sharing one DEM matters for drive mode: the ridge that hides a block in the
 * numbers is then the same ridge that hides it on screen. The pale plan-map
 * background reads as snow at eye level, so the base ground changes with terrain
 * on; water and mapped land-cover layers retain their meaning.
 */
export function TerrainSupport(
  props: Pick<MapTerrainProps, 'terrain' | 'hillshade' | 'exaggeration' | 'hillshadeIntensity'>,
) {
  return (
    <MapTerrain
      {...props}
      id="forestry"
      dem={DEM}
      sky={EYE_LEVEL_SKY}
      terrainGroundColor="#798564"
      hillshadeShadowColor="#1e293b"
      hillshadeHighlightColor="#f8fafc"
    />
  )
}
