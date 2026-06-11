"use client";

import type MapLibreGL from "maplibre-gl";
import { createContext, useContext } from "react";

import {
  MOBILE_MAP_BLANK_CLICK_EVENT,
  MOBILE_MAP_FEATURE_CLICK_EVENT,
  MOBILE_MAP_INTERACTION_EVENT,
} from "./mobile-feature-card";

type MapContextValue = {
  map: MapLibreGL.Map | null;
  isLoaded: boolean;
};

const MapContext = createContext<MapContextValue | null>(null);

function useMap() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error("useMap must be used within a Map component");
  }
  return context;
}

function dispatchMobileMapInteraction(type: "click" | "gesture" = "gesture") {
  window.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, { detail: { type } }));
}

function dispatchMobileMapBlankClick() {
  window.dispatchEvent(new CustomEvent(MOBILE_MAP_BLANK_CLICK_EVENT));
}

function dispatchMobileMapFeatureClick() {
  window.dispatchEvent(new CustomEvent(MOBILE_MAP_FEATURE_CLICK_EVENT));
}

export {
  MapContext,
  useMap,
  dispatchMobileMapInteraction,
  dispatchMobileMapBlankClick,
  dispatchMobileMapFeatureClick,
};

export type { MapContextValue };
