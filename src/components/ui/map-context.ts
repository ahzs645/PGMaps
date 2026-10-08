// Compatibility adapter for legacy application-owned feature renderers.
export * from "@pgmaps/geo-toolkit/map/map-context";
import {
  dispatchMobileMapFeatureClick as dispatchFeatureClick,
  dispatchMobileMapBlankClick as dispatchBlankClick,
  dispatchMobileMapInteraction as dispatchInteraction,
} from "@pgmaps/geo-toolkit/map/map-context";
import type MapLibreGL from "maplibre-gl";
import {
  MOBILE_MAP_FEATURE_CLICK_EVENT,
  MOBILE_MAP_BLANK_CLICK_EVENT,
  MOBILE_MAP_INTERACTION_EVENT,
} from "@pgmaps/geo-toolkit/workspace/workspace-events";
export function dispatchMobileMapFeatureClick(map?: MapLibreGL.Map | null) {
  if (map) dispatchFeatureClick(map);
  else window.dispatchEvent(new CustomEvent(MOBILE_MAP_FEATURE_CLICK_EVENT));
}
export function dispatchMobileMapBlankClick(map?: MapLibreGL.Map | null) {
  if (map) dispatchBlankClick(map);
  else window.dispatchEvent(new CustomEvent(MOBILE_MAP_BLANK_CLICK_EVENT));
}
export function dispatchMobileMapInteraction(type: "click" | "gesture" = "gesture", map?: MapLibreGL.Map | null) {
  if (map) dispatchInteraction(type, map);
  else window.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, { detail: { type } }));
}
