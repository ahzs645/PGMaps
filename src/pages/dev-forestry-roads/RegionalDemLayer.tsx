import { MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'
import { useMap } from '@/components/ui/map'
import { TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '../dev-forestry/terrain'

/** Context relief streams only the visible tiles, at no finer than the regional analysis source. */
const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: 12,
  attribution: TERRAIN_ATTRIBUTION,
}

export function RegionalDemLayer({ visible, imagery }: { visible: boolean; imagery: boolean }) {
  const { map, isLoaded } = useMap()
  if (!visible || !map || !isLoaded) return null
  const beforeId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
  return (
    <MapTerrain id="road-regional" dem={DEM} reliefOnly beforeId={beforeId} hillshadeIntensity={imagery ? 0.2 : 0.35} />
  )
}
