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
import { MAP_STYLES, PG_CENTER, PG_DEFAULT_ZOOM } from "./map-styles";
import { MapContext } from "./map";

type MapStyleOption = string | MapLibreGL.StyleSpecification;
type MapStylePair = { light?: MapStyleOption; dark?: MapStyleOption };

type PersistentMapContextValue = {
  map: MapLibreGL.Map | null;
  isLoaded: boolean;
  container: HTMLDivElement | null;
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

    instance.on("load", loadHandler);
    instance.on("styledata", styleDataHandler);
    setMap(instance);

    return () => {
      if (styleTimeoutRef.current) clearTimeout(styleTimeoutRef.current);
      instance.off("load", loadHandler);
      instance.off("styledata", styleDataHandler);
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
    () => ({ map, isLoaded: ready, container: containerRef.current, setStyles }),
    [map, ready, setStyles]
  );

  return (
    <PersistentMapContext.Provider value={persistentValue}>
      <MapContext.Provider value={mapContextValue}>{children}</MapContext.Provider>
    </PersistentMapContext.Provider>
  );
}

const PersistentMapLoader = () => (
  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-xs">
    <div className="flex gap-1">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:300ms]" />
    </div>
  </div>
);

type PersistentMapHostProps = {
  className?: string;
  loading?: boolean;
};

/**
 * Renders the shared map's canvas into the current section. On mount it
 * re-parents the provider's detached container into this slot and resizes;
 * on unmount it releases the container (the next host re-claims it), so the
 * MapLibre instance survives the route change.
 */
export function PersistentMapHost({ className, loading = false }: PersistentMapHostProps) {
  const { container, map, isLoaded } = usePersistentMap();
  const hostRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={hostRef} className="absolute inset-0" />
      {(!isLoaded || loading) && <PersistentMapLoader />}
    </div>
  );
}
