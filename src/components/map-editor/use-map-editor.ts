"use client";

import { useEffect, useState, type RefObject } from "react";

import { PG_CENTER } from "@/components/ui/map-styles";
import type { MapRef } from "@/components/ui/map";
import {
  DEFAULT_MARKER_FILL,
  DEFAULT_MARKER_INSET,
  PATH_COLOR,
  serializeEditorMap,
  type EditorMarker,
  type EditorMarkerVariant,
  type EditorPath,
  type LngLat,
} from "./editor-core";
import { DEFAULT_MARKER_ICONS, searchIconify } from "./iconify";

export type EditorTool = "select" | "marker" | "path";

export type EditorTheme = {
  primaryColor: string;
  backgroundColor: string;
  waterColor: string;
  landcoverColor: string;
};

type MarkerDraft = {
  variant: EditorMarkerVariant;
  icon: string;
  size: number;
  color1: string;
  color2: string;
};

type PathDraft = {
  curved: boolean;
  dashed: boolean;
  arrow: boolean;
  color: string;
};

const INITIAL_MARKERS: EditorMarker[] = [
  { id: "start", longitude: -122.815, latitude: 53.9225, variant: "badge", label: "Start", icon: "mdi:flag", color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: "river", longitude: -122.731, latitude: 53.9205, variant: "pin", label: "", icon: "mdi:waves", color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: "market", longitude: -122.7245, latitude: 53.8975, variant: "pin", label: "", icon: "mdi:silverware-fork-knife", color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: "lookout", longitude: -122.804, latitude: 53.8865, variant: "badge", label: "Lookout", icon: "mdi:camera", color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
];

const INITIAL_PATHS: EditorPath[] = [
  {
    id: "route",
    points: INITIAL_MARKERS.map((marker) => [marker.longitude, marker.latitude] as LngLat),
    curved: true,
    dashed: true,
    arrow: true,
    color: PATH_COLOR,
    width: 3,
  },
];

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.round(performance.now())}-${Math.floor(performance.now() % 1000)}`;
}

/**
 * Owns all studio editor state — markers, paths, the active tool, the
 * marker/path drafts, the icon-search results, and the unsaved flag — plus the
 * actions that mutate them (place, draw, drop-at-center, recolor, export).
 */
export function useMapEditor({
  theme,
  mapRef,
}: {
  theme: EditorTheme;
  mapRef: RefObject<MapRef | null>;
}) {
  const [tool, setTool] = useState<EditorTool>("select");
  const [markers, setMarkers] = useState<EditorMarker[]>(INITIAL_MARKERS);
  const [paths, setPaths] = useState<EditorPath[]>(INITIAL_PATHS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [markerEditorOpen, setMarkerEditorOpen] = useState(false);
  const [iconQuery, setIconQuery] = useState("");
  const [iconResults, setIconResults] = useState<string[]>(DEFAULT_MARKER_ICONS);
  const [markerDraft, setMarkerDraft] = useState<MarkerDraft>({
    variant: "pin",
    icon: "mdi:map-marker",
    size: 44,
    color1: DEFAULT_MARKER_FILL,
    color2: DEFAULT_MARKER_INSET,
  });
  const [pathDraft, setPathDraft] = useState<PathDraft>({
    curved: true,
    dashed: true,
    arrow: true,
    color: PATH_COLOR,
  });

  // Unsaved-changes indicator for the Save tool (tasmap's dirty dot). Set by the
  // mutation actions below rather than an effect (avoids cascading renders).
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);

  // Debounced iconify search.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      searchIconify(iconQuery).then((icons) => {
        if (!cancelled) setIconResults(icons);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [iconQuery]);

  const selectedMarker = markers.find((marker) => marker.id === selectedId) ?? null;

  const updateMarker = (id: string, patch: Partial<EditorMarker>) => {
    markDirty();
    setMarkers((current) => current.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)));
  };

  const deleteMarker = (id: string) => {
    markDirty();
    setMarkers((current) => current.filter((marker) => marker.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const recolorMarkersToTheme = () => {
    markDirty();
    setMarkers((current) =>
      current.map((marker) => ({ ...marker, color1: theme.primaryColor, color2: theme.backgroundColor })),
    );
  };

  const updatePathDraft = (patch: Partial<PathDraft>) => {
    setPathDraft((current) => ({ ...current, ...patch }));
    if (activePathId) {
      markDirty();
      setPaths((current) => current.map((path) => (path.id === activePathId ? { ...path, ...patch } : path)));
    }
  };

  const enterTool = (next: EditorTool, options?: { keepEditor?: boolean }) => {
    setTool(next);
    setSelectedId(null);
    if (next !== "path") setActivePathId(null);
    if (next !== "marker" && !options?.keepEditor) setMarkerEditorOpen(false);
  };

  const selectMarker = (id: string) => {
    setTool("select");
    setSelectedId(id);
    setMarkerEditorOpen(false);
  };

  /** tasmap behavior: a new marker drops at the current viewport center. */
  const addMarkerAtCenter = (variant: EditorMarkerVariant) => {
    const center = mapRef.current?.getCenter();
    const lngLat: LngLat = center ? [center.lng, center.lat] : [PG_CENTER[0], PG_CENTER[1]];
    const marker: EditorMarker = {
      id: newId(),
      longitude: lngLat[0],
      latitude: lngLat[1],
      variant,
      label: variant === "badge" ? "Label" : "",
      icon: markerDraft.icon,
      color1: markerDraft.color1,
      color2: markerDraft.color2,
      size: markerDraft.size,
    };
    markDirty();
    setMarkerDraft((current) => ({ ...current, variant }));
    setMarkers((current) => [...current, marker]);
    setSelectedId(marker.id);
  };

  const handleMapClick = (lngLat: LngLat) => {
    if (tool === "marker") {
      markDirty();
      const marker: EditorMarker = {
        id: newId(),
        longitude: lngLat[0],
        latitude: lngLat[1],
        variant: markerDraft.variant,
        label: markerDraft.variant === "badge" ? "Label" : "",
        icon: markerDraft.icon,
        color1: markerDraft.color1,
        color2: markerDraft.color2,
        size: markerDraft.size,
      };
      setMarkers((current) => [...current, marker]);
      setSelectedId(marker.id);
      return;
    }
    if (tool === "path") {
      markDirty();
      if (!activePathId) {
        const id = newId();
        setPaths((current) => [...current, { id, points: [lngLat], ...pathDraft, width: 3 }]);
        setActivePathId(id);
      } else {
        setPaths((current) =>
          current.map((path) => (path.id === activePathId ? { ...path, points: [...path.points, lngLat] } : path)),
        );
      }
      return;
    }
    setSelectedId(null);
  };

  const finishPath = () => {
    setActivePathId(null);
    enterTool("select");
  };

  const clearAll = () => {
    markDirty();
    setMarkers([]);
    setPaths([]);
    setActivePathId(null);
    setSelectedId(null);
  };

  const exportMap = () => {
    const data = serializeEditorMap({ markers, paths, theme });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pgmap.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setDirty(false);
  };

  return {
    tool,
    setTool,
    markers,
    paths,
    selectedId,
    setSelectedId,
    selectedMarker,
    activePathId,
    markerEditorOpen,
    setMarkerEditorOpen,
    iconQuery,
    setIconQuery,
    iconResults,
    markerDraft,
    setMarkerDraft,
    pathDraft,
    dirty,
    updateMarker,
    deleteMarker,
    recolorMarkersToTheme,
    updatePathDraft,
    enterTool,
    selectMarker,
    addMarkerAtCenter,
    handleMapClick,
    finishPath,
    clearAll,
    exportMap,
  };
}

export type MapEditorController = ReturnType<typeof useMapEditor>;
