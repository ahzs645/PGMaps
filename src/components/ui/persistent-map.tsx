"use client";

import MapLibreGL from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { MapLoader, type MapLoaderVariant } from "./map-loader";
import { MAP_STYLES, PG_CENTER, PG_DEFAULT_ZOOM } from "./map-styles";
import { MapContext, MapControls } from "./map";
import { MapOverlayRoot } from "./map-overlays";
import { MOBILE_MAP_BLANK_CLICK_EVENT, MOBILE_MAP_INTERACTION_EVENT } from "./mobile-feature-card";

type MapStyleOption = string | MapLibreGL.StyleSpecification;
export type MapStylePair = { light?: MapStyleOption; dark?: MapStyleOption };

type PersistentMapContextValue = {
  map: MapLibreGL.Map | null;
  isLoaded: boolean;
  container: HTMLDivElement | null;
  routeLoadingKey?: string;
  /** Swap the active basemap. Applied via setStyle (no map teardown). */
  setStyles: (styles: MapStylePair) => void;
};

const PersistentMapContext = createContext<PersistentMapContextValue | null>(null);

export function usePersistentMap() {
  const context = useContext(PersistentMapContext);
  if (!context) {
    throw new Error("usePersistentMap must be used within a PersistentMapProvider");
  }
  return context;
}

type PersistentMapProviderProps = {
  children: ReactNode;
  /** Initial basemap styles. Sections can override at runtime via setStyles. */
  defaultStyles?: MapStylePair;
  center?: [number, number];
  zoom?: number;
  routeLoadingKey?: string;
};

/**
 * Owns a single long-lived MapLibre instance. Mounted above the routes that
 * share a map (via a layout route), so navigating between those routes never
 * destroys the WebGL context. The map's container lives in a detached div that
 * PersistentMapHost re-parents into whichever section is currently active.
 */
export function PersistentMapProvider({
  children,
  defaultStyles = MAP_STYLES,
  center = PG_CENTER,
  zoom = PG_DEFAULT_ZOOM,
  routeLoadingKey,
}: PersistentMapProviderProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const containerRef = useRef<HTMLDivElement | null>(null);
  if (containerRef.current === null && typeof document !== "undefined") {
    const el = document.createElement("div");
    el.className = "relative h-full w-full";
    containerRef.current = el;
  }

  const [map, setMap] = useState<MapLibreGL.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const [styles, setStylesState] = useState<MapStylePair>(defaultStyles);

  const stylesRef = useRef(styles);
  stylesRef.current = styles;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const currentStyleRef = useRef<MapStyleOption | null>(null);
  const styleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStyles = useCallback((next: MapStylePair) => {
    setStylesState((prev) =>
      prev.light === next.light && prev.dark === next.dark ? prev : next
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialStyle =
      (themeRef.current === "dark" ? stylesRef.current.dark : stylesRef.current.light) ??
      MAP_STYLES.light;
    currentStyleRef.current = initialStyle;

    const instance = new MapLibreGL.Map({
      container,
      style: initialStyle,
      center,
      zoom,
      renderWorldCopies: false,
      attributionControl: { compact: true },
    });

    const styleDataHandler = () => {
      if (styleTimeoutRef.current) clearTimeout(styleTimeoutRef.current);
      // Mirror the delay used by the standalone Map to avoid layer-op races.
      styleTimeoutRef.current = setTimeout(() => setIsStyleLoaded(true), 150);
    };
    const loadHandler = () => setIsLoaded(true);
    const handleUserMapInteraction = (event?: { originalEvent?: Event; defaultPrevented?: boolean }) => {
      if (event && !event.originalEvent) return;
      if (event?.defaultPrevented || event?.originalEvent?.defaultPrevented) return;
      window.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, {
        detail: { type: event?.originalEvent?.type === "click" ? "click" : "gesture" },
      }));
    };

    instance.on("load", loadHandler);
    instance.on("styledata", styleDataHandler);
    instance.on("click", handleUserMapInteraction);
    instance.on("movestart", handleUserMapInteraction);
    instance.on("dragstart", handleUserMapInteraction);
    instance.on("rotatestart", handleUserMapInteraction);
    instance.on("pitchstart", handleUserMapInteraction);
    instance.on("zoomstart", handleUserMapInteraction);
    setMap(instance);

    return () => {
      if (styleTimeoutRef.current) clearTimeout(styleTimeoutRef.current);
      instance.off("load", loadHandler);
      instance.off("styledata", styleDataHandler);
      instance.off("click", handleUserMapInteraction);
      instance.off("movestart", handleUserMapInteraction);
      instance.off("dragstart", handleUserMapInteraction);
      instance.off("rotatestart", handleUserMapInteraction);
      instance.off("pitchstart", handleUserMapInteraction);
      instance.off("zoomstart", handleUserMapInteraction);
      instance.remove();
      setMap(null);
      setIsLoaded(false);
      setIsStyleLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;

    const nextStyle = (theme === "dark" ? styles.dark : styles.light) ?? MAP_STYLES.light;
    if (currentStyleRef.current === nextStyle) return;

    if (styleTimeoutRef.current) clearTimeout(styleTimeoutRef.current);
    currentStyleRef.current = nextStyle;
    setIsStyleLoaded(false);
    map.setStyle(nextStyle, { diff: true });
  }, [map, theme, styles]);

  const ready = isLoaded && isStyleLoaded;

  const mapContextValue = useMemo(() => ({ map, isLoaded: ready }), [map, ready]);

  const persistentValue = useMemo(
    () => ({ map, isLoaded: ready, container: containerRef.current, routeLoadingKey, setStyles }),
    [map, ready, routeLoadingKey, setStyles]
  );

  return (
    <PersistentMapContext.Provider value={persistentValue}>
      <MapContext.Provider value={mapContextValue}>{children}</MapContext.Provider>
    </PersistentMapContext.Provider>
  );
}

type PersistentMapHostProps = {
  className?: string;
  loading?: boolean;
  loadingLabel?: string;
  /** Loading animation to show: the ASCII "globe" (default) or "spinner". */
  loader?: MapLoaderVariant;
};

/**
 * Renders the shared map's canvas into the current section. On mount it
 * re-parents the provider's detached container into this slot and resizes;
 * on unmount it releases the container (the next host re-claims it), so the
 * MapLibre instance survives the route change.
 */
export function PersistentMapHost({ className, loading = false, loadingLabel, loader }: PersistentMapHostProps) {
  const { container, map, isLoaded, routeLoadingKey } = usePersistentMap();
  const hostRef = useRef<HTMLDivElement>(null);

  const pointerStartRef = useRef<{ x: number; y: number; dispatched: boolean } | null>(null);
  const lastGestureAtRef = useRef(0);
  // Guarded render-phase adjustment: a new route key flips the overlay on
  // immediately instead of one effect-render later.
  const [routeLoadingState, setRouteLoadingState] = useState({
    key: routeLoadingKey,
    loading: false,
  });
  if (routeLoadingState.key !== routeLoadingKey) {
    setRouteLoadingState({ key: routeLoadingKey, loading: true });
  }
  const routeLoading = routeLoadingState.loading;
  const routeLoadingStartedAtRef = useRef(0);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !container) return;

    host.appendChild(container);
    map?.resize();
    const raf = requestAnimationFrame(() => map?.resize());

    const observer = new ResizeObserver(() => map?.resize());
    observer.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (container.parentElement === host) {
        host.removeChild(container);
      }
    };
  }, [container, map]);

  useEffect(() => {
    routeLoadingStartedAtRef.current = Date.now();
  }, [routeLoadingKey]);

  useEffect(() => {
    if (!routeLoading || !isLoaded || loading) return;

    const elapsed = Date.now() - routeLoadingStartedAtRef.current;
    const remaining = Math.max(0, 250 - elapsed);
    const timeout = window.setTimeout(
      () => setRouteLoadingState((current) => ({ ...current, loading: false })),
      remaining,
    );
    return () => window.clearTimeout(timeout);
  }, [isLoaded, loading, routeLoading]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div
        ref={hostRef}
        className="absolute inset-0"
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
          window.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, { detail: { type: "gesture" } }));
        }}
        onClickCapture={(event) => {
          if (!(event.target instanceof Element)) return;
          if (event.target.closest(".maplibregl-marker")) return;
          if (!event.target.closest(".maplibregl-canvas-container")) return;
          if (event.defaultPrevented) return;
          if (Date.now() - lastGestureAtRef.current < 450) return;
          window.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, { detail: { type: "click" } }));
          window.dispatchEvent(new CustomEvent(MOBILE_MAP_BLANK_CLICK_EVENT));
        }}
        onPointerUpCapture={() => {
          pointerStartRef.current = null;
        }}
        onPointerCancelCapture={() => {
          pointerStartRef.current = null;
        }}
      />
      <MapLoader
        visible={routeLoading || !isLoaded || loading}
        label={routeLoading ? "Switching map" : loadingLabel}
        variant={loader}
      />
    </div>
  );
}

/**
 * Declare the active basemap for the section currently using the shared map.
 * Applied via setStyle, so swapping basemaps never tears the map down. Call
 * this once per section (the last section to mount wins, which matches the
 * single-active-route model).
 */
export function useMapBasemap(styles: MapStylePair) {
  const { setStyles } = usePersistentMap();
  const { light, dark } = styles;
  useEffect(() => {
    setStyles({ light, dark });
  }, [setStyles, light, dark]);
}

type SharedMapProps = {
  children?: ReactNode;
  /** Basemap for this section. Defaults to the standard Carto styles. */
  styles?: MapStylePair;
  className?: string;
  loading?: boolean;
  loadingLabel?: string;
  /** Loading animation to show: the ASCII "globe" (default) or "spinner". */
  loader?: MapLoaderVariant;
  /**
   * Map controls to render. Defaults to zoom + compass at top-right. Pass
   * `null` to render none, or your own element to customize.
   */
  controls?: ReactNode;
};

/**
 * High-level slot for a section that participates in a shared map group.
 * Bundles the canvas host, the standard controls, and the basemap declaration
 * so a section's map is just `<SharedMap>{overlays}</SharedMap>`. Overlays
 * (markers, layers, popups) attach to the shared instance via useMap() and can
 * be rendered as children regardless of DOM nesting.
 */
export function SharedMap({
  children,
  styles,
  className,
  loading,
  loadingLabel,
  loader,
  controls,
}: SharedMapProps) {
  useMapBasemap(styles ?? MAP_STYLES);

  return (
    <MapOverlayRoot className={className} initializeVariables={false}>
      <PersistentMapHost loading={loading} loadingLabel={loadingLabel} loader={loader} />
      {controls === undefined ? (
        <MapControls
          position="top-right"
          mobilePosition="bottom-right"
          showZoom
          showCompass
        />
      ) : (
        controls
      )}
      {children}
    </MapOverlayRoot>
  );
}
