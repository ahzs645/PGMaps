import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'
import { Protocol } from 'pmtiles'

let pmtilesProtocolRegistered = false

type SharedPmtilesTooltipState = {
  ownerLayerId: string | null
  popup: MapLibreGLRuntime.Popup
}

const pmtilesHoverLayersByMap = new WeakMap<MapLibreGL.Map, Set<string>>()
const pmtilesTooltipByMap = new WeakMap<MapLibreGL.Map, SharedPmtilesTooltipState>()

export function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return
  const protocol = new Protocol()
  MapLibreGLRuntime.addProtocol('pmtiles', protocol.tile)
  pmtilesProtocolRegistered = true
}

export function registerPmtilesHoverLayer(map: MapLibreGL.Map, layerId: string) {
  const layerIds = pmtilesHoverLayersByMap.get(map) ?? new Set<string>()
  layerIds.add(layerId)
  pmtilesHoverLayersByMap.set(map, layerIds)

  return () => {
    layerIds.delete(layerId)
    if (layerIds.size === 0) pmtilesHoverLayersByMap.delete(map)
  }
}

export function isTopPmtilesHoverLayer(map: MapLibreGL.Map, point: MapLibreGL.PointLike, layerId: string) {
  const registeredLayerIds = pmtilesHoverLayersByMap.get(map)
  if (!registeredLayerIds) return true
  const existingLayerIds = [...registeredLayerIds].filter((registeredLayerId) => map.getLayer(registeredLayerId))
  if (existingLayerIds.length === 0) return true

  return map.queryRenderedFeatures(point, { layers: existingLayerIds })[0]?.layer?.id === layerId
}

export function showPmtilesTooltip(
  map: MapLibreGL.Map,
  ownerLayerId: string,
  lngLat: MapLibreGL.LngLatLike,
  html: string,
) {
  let state = pmtilesTooltipByMap.get(map)
  if (!state) {
    state = {
      ownerLayerId: null,
      popup: new MapLibreGLRuntime.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'mapcn-tooltip pointer-events-none',
        offset: 12,
      }),
    }
    pmtilesTooltipByMap.set(map, state)
  }

  state.ownerLayerId = ownerLayerId
  state.popup.setLngLat(lngLat).setHTML(html).addTo(map)
}

export function removePmtilesTooltip(map: MapLibreGL.Map, ownerLayerId: string) {
  const state = pmtilesTooltipByMap.get(map)
  if (!state || state.ownerLayerId !== ownerLayerId) return
  state.popup.remove()
  state.ownerLayerId = null
}
