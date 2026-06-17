"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type MapLibreGL from "maplibre-gl";

import { cn } from "@/lib/utils";
import { useMap } from "@/components/ui/map-context";
import { MapBadgeMarker, MapIconPin } from "@/components/ui/map-story";

/**
 * Core editor model + map primitives for the tasmap-style studio: the marker /
 * path data types, the map-click capture helper, the on-map marker renderer,
 * and serialization to tasmap's saved-map shape.
 */

export type LngLat = [number, number];

export type EditorMarkerVariant = "pin" | "badge" | "dot";

export type EditorMarker = {
  id: string;
  longitude: number;
  latitude: number;
  variant: EditorMarkerVariant;
  label: string;
  /** Iconify name (e.g. "mdi:flag") */
  icon: string;
  color1: string;
  color2: string;
  size: number;
};

export type EditorPath = {
  id: string;
  points: LngLat[];
  curved: boolean;
  dashed: boolean;
  arrow: boolean;
  color: string;
  width: number;
};

/** Default colors for newly created overlays. */
export const DEFAULT_MARKER_FILL = "#2563eb";
export const DEFAULT_MARKER_INSET = "#f8fafc";
export const PATH_COLOR = "#ff9800";

/** tasmap's 8 path types, as curve/dash/arrow toggle combinations. */
export const PATH_TYPE_OPTIONS = [
  { key: "line", label: "Line", curved: false, dashed: false, arrow: false },
  { key: "curve", label: "Curve", curved: true, dashed: false, arrow: false },
  { key: "dashedLine", label: "Dashed line", curved: false, dashed: true, arrow: false },
  { key: "dashedCurve", label: "Dashed curve", curved: true, dashed: true, arrow: false },
  { key: "arrow", label: "Arrow", curved: false, dashed: false, arrow: true },
  { key: "curveArrow", label: "Curve arrow", curved: true, dashed: false, arrow: true },
  { key: "dashedArrow", label: "Dashed arrow", curved: false, dashed: true, arrow: true },
  { key: "dashedCurveArrow", label: "Dashed curve arrow", curved: true, dashed: true, arrow: true },
] as const;

/* -------------------------------------------------------------------------- */
/* Map click capture                                                          */
/* -------------------------------------------------------------------------- */

type MapClickHandlerProps = {
  /** Called with [lng, lat] for every click on the map surface */
  onClick: (lngLat: LngLat) => void;
  /** When false, the listener is unbound (default true) */
  enabled?: boolean;
  /** Canvas cursor while active (e.g. "crosshair"); empty string keeps default */
  cursor?: string;
};

/** Headless helper: reports map-canvas clicks as lng/lat. Render inside the map. */
export function MapClickHandler({ onClick, enabled = true, cursor = "" }: MapClickHandlerProps) {
  const { map, isLoaded } = useMap();
  const cbRef = useRef(onClick);
  useEffect(() => {
    cbRef.current = onClick;
  });

  useEffect(() => {
    if (!isLoaded || !map || !enabled) return;
    const handler = (event: MapLibreGL.MapMouseEvent) => {
      cbRef.current([event.lngLat.lng, event.lngLat.lat]);
    };
    map.on("click", handler);
    const canvas = map.getCanvas();
    const previousCursor = canvas.style.cursor;
    if (cursor) canvas.style.cursor = cursor;
    return () => {
      map.off("click", handler);
      canvas.style.cursor = previousCursor;
    };
  }, [isLoaded, map, enabled, cursor]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* On-map marker renderer                                                     */
/* -------------------------------------------------------------------------- */

type EditorMarkerViewProps = {
  variant: EditorMarkerVariant;
  label?: string;
  icon?: ReactNode;
  color1: string;
  color2: string;
  size?: number;
  selected?: boolean;
};

/**
 * Renders an editor marker by variant, mapping to tasmap's marker types:
 * `pin` → location_fill, `badge` → icon_fill (label pill), `dot` → circle_fill.
 * Place inside `<MarkerContent>`.
 */
export function EditorMarkerView({
  variant,
  label = "",
  icon,
  color1,
  color2,
  size = 44,
  selected = false,
}: EditorMarkerViewProps) {
  const inner =
    variant === "badge" ? (
      <MapBadgeMarker label={label} icon={icon} color={color1} textColor={color2} />
    ) : variant === "pin" ? (
      <MapIconPin icon={icon} color={color1} iconColor={color2} size={size} />
    ) : (
      <div
        className="flex items-center justify-center rounded-full shadow-lg ring-2 ring-white/80 [&_svg]:size-[55%]"
        style={{
          width: size * 0.6,
          height: size * 0.6,
          backgroundColor: color1,
          color: color2,
        }}
      >
        {icon}
      </div>
    );

  return (
    <div className={cn("relative transition-transform", selected && "scale-110")}>
      {selected ? (
        <span className="pointer-events-none absolute -inset-2 rounded-2xl ring-2 ring-primary" />
      ) : null}
      {inner}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Serialization (tasmap saved-map shape)                                     */
/* -------------------------------------------------------------------------- */

/** tasmap path-type name from the curve/dash/arrow toggles. */
function tasmapPathType(path: Pick<EditorPath, "curved" | "dashed" | "arrow">): string {
  const base = path.curved
    ? path.arrow
      ? "CurveArrow"
      : "Curve"
    : path.arrow
      ? "Arrow"
      : "Line";
  const name = `${path.dashed ? "dashed" : ""}${base}`;
  return path.dashed ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

const VARIANT_TO_TASMAP_TYPE: Record<EditorMarkerVariant, string> = {
  pin: "location_fill",
  dot: "circle_fill",
  badge: "icon_fill",
};

/** Serialize the editor state into tasmap's saved-map data model (for export). */
export function serializeEditorMap({
  markers,
  paths,
  theme,
}: {
  markers: EditorMarker[];
  paths: EditorPath[];
  theme?: Record<string, unknown>;
}) {
  return {
    meta: { template: "classic", storySizePercent: 40 },
    studio: {
      markers: markers.map((marker) => ({
        id: marker.id,
        type: VARIANT_TO_TASMAP_TYPE[marker.variant],
        size: marker.size,
        label: marker.label,
        color1: marker.color1,
        color2: marker.color2,
        iconDescription: marker.icon,
        lngLat: [marker.longitude, marker.latitude],
      })),
      paths: paths.map((path) => ({
        id: path.id,
        type: tasmapPathType(path),
        width: path.width,
        fillColors: [path.color],
        points: path.points.map(([lng, lat]) => ({ lng, lat })),
      })),
    },
    theme,
  };
}
