"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type MapLibreGL from "maplibre-gl";
import { GripVertical, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMap } from "./map-context";
import { MapMarker, MarkerContent } from "./map-markers";

/**
 * tasmap-style "story map" overlays ported to the shared MapLibre + Tailwind
 * stack. These mirror the presentation layer of tasmap.app's classic template
 * (story panel + on-map marker badges, icon pins, a curved route, and a map
 * title chip) without any of its editing chrome.
 */

const STORY_ACCENT = "#09558c";
const STORY_BG = "#f5f5f5";

/* -------------------------------------------------------------------------- */
/* Story panel (classic template)                                             */
/* -------------------------------------------------------------------------- */

type MapStoryPanelProps = {
  /** Panel heading, rendered in the accent color */
  title: ReactNode;
  /** Small uppercase label above the title */
  eyebrow?: ReactNode;
  /** Story body — rich text / sections */
  children: ReactNode;
  /** Accent color for the eyebrow + title (default tasmap navy) */
  accentColor?: string;
  /** Panel background (default tasmap off-white) */
  backgroundColor?: string;
  /** Initial panel width in px */
  defaultWidth?: number;
  /** Minimum drag width in px */
  minWidth?: number;
  /** Maximum drag width in px */
  maxWidth?: number;
  /** Optional close handler — renders a close button when provided */
  onClose?: () => void;
  className?: string;
};

/**
 * Right-docked, resizable content panel. Designed to sit as a flex sibling of
 * the map so the map keeps its own coordinate space (corner overlays never
 * overlap the panel), matching tasmap's `storySizePercent` split.
 */
export function MapStoryPanel({
  title,
  eyebrow,
  children,
  accentColor = STORY_ACCENT,
  backgroundColor = STORY_BG,
  defaultWidth = 384,
  minWidth = 280,
  maxWidth = 560,
  onClose,
  className,
}: MapStoryPanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const cleanupRef = useRef<(() => void) | null>(null);

  const startDragging = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;

    function handleMove(moveEvent: PointerEvent) {
      // Panel is docked to the right, so dragging left widens it.
      const next = startWidth + (startX - moveEvent.clientX);
      setWidth(Math.min(maxWidth, Math.max(minWidth, next)));
    }
    function stop() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      cleanupRef.current = null;
    }

    cleanupRef.current = stop;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Tear down any in-progress drag if the panel unmounts mid-resize.
  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <div
      className={cn(
        "relative hidden h-full shrink-0 md:flex",
        className,
      )}
      style={{ width, maxWidth: "85vw" }}
    >
      <button
        type="button"
        aria-label="Resize story panel"
        onPointerDown={startDragging}
        className="group absolute left-0 top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center"
      >
        <span className="flex h-10 w-1.5 items-center justify-center rounded-full bg-border transition-colors group-hover:bg-foreground/40">
          <GripVertical className="h-3.5 w-3.5 text-background" />
        </span>
      </button>

      <div
        className="flex h-full w-full flex-col overflow-y-auto border-l border-black/10 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.25)]"
        style={{ backgroundColor }}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            {eyebrow ? (
              <div
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: accentColor }}
              >
                {eyebrow}
              </div>
            ) : null}
            <h2
              className="mt-0.5 text-2xl font-bold leading-tight"
              style={{ color: accentColor }}
            >
              {title}
            </h2>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close story panel"
              className="shrink-0 rounded-md p-1 text-black/40 transition-colors hover:bg-black/5 hover:text-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="space-y-3 px-5 pb-6 text-sm leading-relaxed text-neutral-600">
          {children}
        </div>
      </div>
    </div>
  );
}

type MapStorySectionProps = {
  heading?: ReactNode;
  children: ReactNode;
  accentColor?: string;
  className?: string;
};

/** A titled block inside a {@link MapStoryPanel}. */
export function MapStorySection({
  heading,
  children,
  accentColor = STORY_ACCENT,
  className,
}: MapStorySectionProps) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {heading ? (
        <h3
          className="border-b border-black/10 pb-1 text-sm font-semibold"
          style={{ color: accentColor }}
        >
          {heading}
        </h3>
      ) : null}
      <div className="space-y-2 text-neutral-600">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Map title chip                                                             */
/* -------------------------------------------------------------------------- */

type MapTitleChipProps = {
  /** Map name */
  title: ReactNode;
  /** Icon rendered inside the circular badge */
  icon?: ReactNode;
  /** Image source for the circular badge (overrides icon) */
  image?: string;
  /** Badge background color */
  badgeColor?: string;
  className?: string;
};

/** Rounded chip with a circular app-icon badge — tasmap's bottom-left map title. */
export function MapTitleChip({
  title,
  icon,
  image,
  badgeColor = STORY_ACCENT,
  className,
}: MapTitleChipProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full bg-background/95 py-1.5 pl-1.5 pr-4 shadow-lg ring-1 ring-black/5 backdrop-blur",
        className,
      )}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-white [&_svg]:size-4"
        style={{ backgroundColor: badgeColor }}
      >
        {image ? (
          <img src={image} alt="" className="size-full object-cover" />
        ) : (
          icon
        )}
      </span>
      <span className="truncate text-sm font-semibold text-foreground">
        {title}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* On-map markers                                                             */
/* -------------------------------------------------------------------------- */

type MapBadgeMarkerProps = {
  /** Label text */
  label: ReactNode;
  /** Optional leading icon */
  icon?: ReactNode;
  /** Pill background color (default tasmap navy) */
  color?: string;
  /** Text + icon color */
  textColor?: string;
  className?: string;
};

/**
 * Speech-bubble style marker: a rounded pill with an icon + label and a
 * downward pointer tail. Use inside `<MapMarker anchor="bottom">` so the tail
 * tip lands on the coordinate.
 */
export function MapBadgeMarker({
  label,
  icon,
  color = STORY_ACCENT,
  textColor = "#ffffff",
  className,
}: MapBadgeMarkerProps) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-lg [&_svg]:size-3.5"
        style={{ backgroundColor: color, color: textColor }}
      >
        {icon ? <span className="flex items-center">{icon}</span> : null}
        <span className="whitespace-nowrap">{label}</span>
      </div>
      <span
        className="-mt-1 size-2.5 rotate-45 rounded-[2px] shadow-lg"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

type MapIconPinProps = {
  /** Icon rendered inside the pin head */
  icon?: ReactNode;
  /** Pin fill color (color1) */
  color?: string;
  /** Icon color inside the pin (color2) */
  iconColor?: string;
  /** Pin height in px */
  size?: number;
  className?: string;
};

/**
 * Two-tone teardrop location pin (tasmap `location_fill`). Use inside
 * `<MapMarker anchor="bottom">` so the tip lands on the coordinate.
 */
export function MapIconPin({
  icon,
  color = STORY_ACCENT,
  iconColor = "#ffffff",
  size = 40,
  className,
}: MapIconPinProps) {
  return (
    <div
      className={cn("relative", className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="drop-shadow-lg"
        aria-hidden="true"
      >
        <path
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          fill={color}
        />
      </svg>
      {icon ? (
        <span
          className="absolute left-1/2 top-[37%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center [&_svg]:size-full"
          style={{
            width: size * 0.42,
            height: size * 0.42,
            color: iconColor,
          }}
        >
          {icon}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Curved route path                                                          */
/* -------------------------------------------------------------------------- */

type LngLat = [number, number];

/** Densify control points into a smooth Catmull-Rom curve. */
function catmullRomCurve(points: LngLat[], samples = 24): LngLat[] {
  if (points.length < 2) return points;
  const pts: LngLat[] = [points[0], ...points, points[points.length - 1]];
  const out: LngLat[] = [];

  for (let i = 1; i < pts.length - 2; i += 1) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let j = 0; j < samples; j += 1) {
      const t = j / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Compass bearing (deg, 0 = north) from point a to point b. */
function bearingBetween(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

type MapCurvePathProps = {
  /** Control points the line passes through */
  points: LngLat[];
  /** Line color (default tasmap orange) */
  color?: string;
  /** Line width in px */
  width?: number;
  /** Line opacity */
  opacity?: number;
  /** Smooth the points into a Catmull-Rom curve (default true) */
  curved?: boolean;
  /** Render a dashed line (default true) */
  dashed?: boolean;
  /** Dash pattern in line-width units */
  dashArray?: [number, number];
  /** Render an arrowhead at the final point (default true) */
  arrow?: boolean;
};

/**
 * tasmap's editable path. Covers all 8 tasmap path types via the `curved`,
 * `dashed` and `arrow` toggles. Manages its own GeoJSON source/line layer and
 * renders a rotated arrow marker so it tilts flat with the map in 3D.
 */
export function MapCurvePath({
  points,
  color = "#ff9800",
  width = 3,
  opacity = 0.95,
  curved = true,
  dashed = true,
  dashArray = [1.6, 1.4],
  arrow = true,
}: MapCurvePathProps) {
  const { map, isLoaded } = useMap();
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sourceId = `curve-source-${rawId}`;
  const layerId = `curve-layer-${rawId}`;

  // A near-zero gap renders as a solid line, so a single layer covers both.
  const dash = useMemo<[number, number]>(
    () => (dashed ? dashArray : [1, 0]),
    [dashed, dashArray],
  );
  const curve = useMemo(
    () => (curved ? catmullRomCurve(points) : points),
    [curved, points],
  );

  const arrowMeta = useMemo(() => {
    if (!arrow || curve.length < 2) return null;
    const end = curve[curve.length - 1];
    const prev = curve[curve.length - 2];
    return { position: end, bearing: bearingBetween(prev, end) };
  }, [arrow, curve]);

  // Add the source + layer once the style is ready (re-runs after style swaps).
  useEffect(() => {
    if (!isLoaded || !map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: curve },
        },
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": color,
          "line-width": width,
          "line-opacity": opacity,
          "line-dasharray": dash,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // style already torn down
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  // Keep the curve geometry in sync.
  useEffect(() => {
    if (!isLoaded || !map) return;
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined;
    source?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: curve },
    });
  }, [isLoaded, map, curve, sourceId]);

  // Keep paint properties in sync.
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return;
    map.setPaintProperty(layerId, "line-color", color);
    map.setPaintProperty(layerId, "line-width", width);
    map.setPaintProperty(layerId, "line-opacity", opacity);
    map.setPaintProperty(layerId, "line-dasharray", dash);
  }, [isLoaded, map, layerId, color, width, opacity, dash]);

  if (!arrowMeta) return null;

  return (
    <MapMarker
      longitude={arrowMeta.position[0]}
      latitude={arrowMeta.position[1]}
      rotation={arrowMeta.bearing}
      rotationAlignment="map"
      pitchAlignment="map"
    >
      <MarkerContent>
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          className="drop-shadow"
          aria-hidden="true"
        >
          <path d="M12 3 L19.5 20 L12 15.5 L4.5 20 Z" fill={color} />
        </svg>
      </MarkerContent>
    </MapMarker>
  );
}

/* -------------------------------------------------------------------------- */
/* Tool rail                                                                  */
/* -------------------------------------------------------------------------- */

type MapToolRailProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Vertical dock of floating circular tool buttons — tasmap's left tool rail,
 * rebuilt with the shared design-system tokens (theme-aware, not the original
 * dark pills). Position it inside a `relative` map container.
 */
export function MapToolRail({ children, className }: MapToolRailProps) {
  return (
    <div
      className={cn(
        "absolute left-4 top-4 z-20 flex flex-col gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

type MapToolRailButtonProps = {
  /** Icon node (sized to 20px by the button) */
  icon: ReactNode;
  /** Accessible label + hover tooltip */
  label: string;
  /** Highlighted (active tool / enabled toggle) */
  active?: boolean;
  /** Show a primary "dirty"/notification dot, like tasmap's unsaved indicator */
  badge?: boolean;
  onClick?: () => void;
  /** Panel rendered to the right of the button when `flyoutOpen` is true */
  flyout?: ReactNode;
  flyoutOpen?: boolean;
};

export function MapToolRailButton({
  icon,
  label,
  active = false,
  badge = false,
  onClick,
  flyout,
  flyoutOpen = false,
}: MapToolRailButtonProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "relative flex size-11 items-center justify-center rounded-full shadow-xl ring-1 ring-black/5 backdrop-blur transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-background/95 text-foreground hover:bg-accent",
        )}
      >
        {icon}
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-primary shadow ring-2 ring-background" />
        ) : null}
      </button>
      {flyout && flyoutOpen ? (
        <div className="absolute left-full top-0 z-30 ml-3">{flyout}</div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor: map click capture, marker views, serialization                     */
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
  cbRef.current = onClick;

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

export type EditorMarkerVariant = "pin" | "badge" | "dot";

export type EditorMarker = {
  id: string;
  longitude: number;
  latitude: number;
  variant: EditorMarkerVariant;
  label: string;
  /** Icon registry key (serializable); rendered by the consumer */
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
