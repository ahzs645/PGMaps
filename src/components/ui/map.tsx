"use client";

import MapLibreGL from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { MapLoader, type MapLoaderVariant } from "./map-loader";
import { MAP_STYLES } from "./map-styles";
import { MOBILE_MAP_FEATURE_CLICK_EVENT } from "./mobile-feature-card";
import {
  MapContext,
  dispatchMobileMapBlankClick,
  dispatchMobileMapInteraction,
} from "./map-context";

const defaultStyles = MAP_STYLES;

type Theme = "light" | "dark";

/** Map viewport state */
type MapViewport = {
  /** Center coordinates [longitude, latitude] */
  center: [number, number];
  /** Zoom level */
  zoom: number;
  /** Bearing (rotation) in degrees */
  bearing: number;
  /** Pitch (tilt) in degrees */
  pitch: number;
};

type MapStyleOption = string | MapLibreGL.StyleSpecification;

type MapProps = {
  children?: ReactNode;
  /** Additional CSS classes for the map container */
  className?: string;
  /**
   * Theme for the map. If not provided, automatically detects from next-themes.
   * Pass a value here to override the provider.
   */
  theme?: Theme;
  /** Custom map styles for light and dark themes. Overrides the default Carto styles. */
  styles?: {
    light?: MapStyleOption;
    dark?: MapStyleOption;
  };
  /** Map projection type. Use `{ type: "globe" }` for 3D globe view. */
  projection?: MapLibreGL.ProjectionSpecification;
  /**
   * Controlled viewport. When provided with onViewportChange,
   * the map becomes controlled and viewport is driven by this prop.
   */
  viewport?: Partial<MapViewport>;
  /**
   * Callback fired continuously as the viewport changes (pan, zoom, rotate, pitch).
   * Can be used standalone to observe changes, or with `viewport` prop
   * to enable controlled mode where the map viewport is driven by your state.
   */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Show a loading indicator on the map */
  loading?: boolean;
  /** Loading animation to show: "spinner" (default) or the ASCII "globe". */
  loader?: MapLoaderVariant;
  /** Show the loading indicator during style swaps after the initial map load. */
  showStyleLoadingOverlay?: boolean;
} & Omit<MapLibreGL.MapOptions, "container" | "style">;

type MapRef = MapLibreGL.Map;

function getViewport(map: MapLibreGL.Map): MapViewport {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    children,
    className,
    theme: themeProp,
    styles,
    projection,
    viewport,
    onViewportChange,
    loading = false,
    loader,
    showStyleLoadingOverlay = true,
    ...props
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreGL.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const { resolvedTheme: providerTheme } = useTheme();
  const resolvedTheme = themeProp ?? (providerTheme === "dark" ? "dark" : "light");
  const currentStyleRef = useRef<MapStyleOption | null>(null);
  const styleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internalUpdateRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; dispatched: boolean } | null>(null);
  const lastGestureAtRef = useRef(0);
  const lastFeatureClickAtRef = useRef(0);

  const isControlled = viewport !== undefined && onViewportChange !== undefined;

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  const mapStyles = useMemo(
    () => ({
      dark: styles?.dark ?? defaultStyles.dark,
      light: styles?.light ?? defaultStyles.light,
    }),
    [styles]
  );

  useImperativeHandle(ref, () => mapInstance as MapLibreGL.Map, [mapInstance]);

  const clearStyleTimeout = useCallback(() => {
    if (styleTimeoutRef.current) {
      clearTimeout(styleTimeoutRef.current);
      styleTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;
    currentStyleRef.current = initialStyle;

    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: initialStyle,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
      },
      ...props,
      ...viewport,
    });

    const styleDataHandler = () => {
      clearStyleTimeout();
      // Delay to ensure style is fully processed before allowing layer operations
      // This is a workaround to avoid race conditions with the style loading
      styleTimeoutRef.current = setTimeout(() => {
        setIsStyleLoaded(true);
        if (projection) {
          map.setProjection(projection);
        }
      }, 150);
    };
    const loadHandler = () => setIsLoaded(true);
    const handleMove = () => {
      if (internalUpdateRef.current) return;
      onViewportChangeRef.current?.(getViewport(map));
    };
    const handleFeatureClick = () => {
      lastFeatureClickAtRef.current = Date.now();
    };
    const handleUserMapInteraction = (event?: { originalEvent?: Event; defaultPrevented?: boolean; type?: string }) => {
      if (event && !event.originalEvent) return;
      if (event?.defaultPrevented || event?.originalEvent?.defaultPrevented) return;
      dispatchMobileMapInteraction(event?.type === "click" ? "click" : "gesture");
      if (event?.type === "click") {
        window.setTimeout(() => {
          if (Date.now() - lastFeatureClickAtRef.current < 250) return;
          if (event.defaultPrevented || event.originalEvent?.defaultPrevented) return;
          dispatchMobileMapBlankClick();
        }, 0);
      }
    };

    map.on("load", loadHandler);
    map.on("styledata", styleDataHandler);
    map.on("move", handleMove);
    map.on("click", handleUserMapInteraction);
    map.on("movestart", handleUserMapInteraction);
    map.on("dragstart", handleUserMapInteraction);
    map.on("rotatestart", handleUserMapInteraction);
    map.on("pitchstart", handleUserMapInteraction);
    map.on("zoomstart", handleUserMapInteraction);
    window.addEventListener(MOBILE_MAP_FEATURE_CLICK_EVENT, handleFeatureClick);
    setMapInstance(map);

    return () => {
      clearStyleTimeout();
      map.off("load", loadHandler);
      map.off("styledata", styleDataHandler);
      map.off("move", handleMove);
      map.off("click", handleUserMapInteraction);
      map.off("movestart", handleUserMapInteraction);
      map.off("dragstart", handleUserMapInteraction);
      map.off("rotatestart", handleUserMapInteraction);
      map.off("pitchstart", handleUserMapInteraction);
      map.off("zoomstart", handleUserMapInteraction);
      window.removeEventListener(MOBILE_MAP_FEATURE_CLICK_EVENT, handleFeatureClick);
      map.remove();
      setIsLoaded(false);
      setIsStyleLoaded(false);
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInstance || !isControlled || !viewport) return;
    if (mapInstance.isMoving()) return;

    const current = getViewport(mapInstance);
    const next = {
      center: viewport.center ?? current.center,
      zoom: viewport.zoom ?? current.zoom,
      bearing: viewport.bearing ?? current.bearing,
      pitch: viewport.pitch ?? current.pitch,
    };

    if (
      next.center[0] === current.center[0] &&
      next.center[1] === current.center[1] &&
      next.zoom === current.zoom &&
      next.bearing === current.bearing &&
      next.pitch === current.pitch
    ) {
      return;
    }

    internalUpdateRef.current = true;
    mapInstance.jumpTo(next);
    internalUpdateRef.current = false;
  }, [mapInstance, isControlled, viewport]);

  useEffect(() => {
    if (!mapInstance || !resolvedTheme) return;

    const newStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;

    if (currentStyleRef.current === newStyle) return;

    clearStyleTimeout();
    currentStyleRef.current = newStyle;
    setIsStyleLoaded(false);

    mapInstance.setStyle(newStyle, { diff: true });
  }, [mapInstance, resolvedTheme, mapStyles, clearStyleTimeout]);

  const isLoading = !isLoaded || (showStyleLoadingOverlay && !isStyleLoaded) || loading;

  const contextValue = useMemo(
    () => ({
      map: mapInstance,
      isLoaded: isLoaded && isStyleLoaded,
    }),
    [mapInstance, isLoaded, isStyleLoaded]
  );

  return (
    <MapContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        data-map-layout-root="true"
        className={cn("relative h-full w-full", className)}
        onPointerDownCapture={(event) => {
          if (!(event.target instanceof Element)) return;
          if (!event.target.closest(".maplibregl-canvas-container")) return;
          pointerStartRef.current = { x: event.clientX, y: event.clientY, dispatched: false };
        }}
        onPointerMoveCapture={(event) => {
          const start = pointerStartRef.current;
          if (!start || start.dispatched) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) < 8) return;
          start.dispatched = true;
          lastGestureAtRef.current = Date.now();
          dispatchMobileMapInteraction("gesture");
        }}
        onPointerUpCapture={() => {
          pointerStartRef.current = null;
        }}
        onPointerCancelCapture={() => {
          pointerStartRef.current = null;
        }}
      >
        {isLoading && <MapLoader variant={loader} />}
        {/* SSR-safe: children render only when map is loaded on client */}
        {mapInstance && children}
      </div>
    </MapContext.Provider>
  );
});

export { Map };

export { MapContext, useMap } from "./map-context";

export { MapLoader, DEFAULT_MAP_LOADER, type MapLoaderVariant } from "./map-loader";

export {
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  MarkerLabel,
  MapPopup,
} from "./map-markers";

export { MapControls } from "./map-controls";

export { MapRoute, MapClusterLayer } from "./map-routes";

export type { MapRef };
