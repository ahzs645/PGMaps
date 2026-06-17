"use client";

import { Plus, Search, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { EditorMarkerView, type EditorMarkerVariant } from "./editor-core";
import { IconifyIcon } from "./iconify";
import { MapColorPicker } from "./color-picker";
import { MapEditorPanel, MapSubToolButton } from "./tool-rail";
import type { MapEditorController } from "./use-map-editor";

const MARKER_VARIANTS: EditorMarkerVariant[] = ["dot", "pin", "badge"];

/**
 * tasmap's marker submenu: a column of sub-buttons (new / recolor / the marker
 * list) plus an editor popover (type tiles, color pickers, iconify search grid,
 * size). Picking a type drops a marker at the map center. Theme-aware.
 */
export function MarkerFlyout({
  editor,
  swatches,
}: {
  editor: MapEditorController;
  swatches: string[];
}) {
  const {
    markers,
    markerDraft,
    setMarkerDraft,
    markerEditorOpen,
    setMarkerEditorOpen,
    selectedId,
    selectMarker,
    recolorMarkersToTheme,
    addMarkerAtCenter,
    iconQuery,
    setIconQuery,
    iconResults,
  } = editor;

  return (
    <div className="relative flex flex-col gap-3">
      <MapSubToolButton
        icon={<Plus />}
        label="New marker"
        active={markerEditorOpen}
        onClick={() => setMarkerEditorOpen(!markerEditorOpen)}
      />
      <MapSubToolButton icon={<Wand2 />} label="Recolor markers to theme" onClick={recolorMarkersToTheme} />
      {markers.map((marker) => (
        <MapSubToolButton
          key={marker.id}
          label={marker.label || "Marker"}
          active={selectedId === marker.id}
          onClick={() => selectMarker(marker.id)}
        >
          <span className="pointer-events-none scale-[0.5]">
            <EditorMarkerView
              variant={marker.variant}
              label=""
              icon={<IconifyIcon name={marker.icon} />}
              color1={marker.color1}
              color2={marker.color2}
              size={marker.size}
            />
          </span>
        </MapSubToolButton>
      ))}

      {markerEditorOpen ? (
        <div className="absolute left-full top-0 ml-3">
          <MapEditorPanel className="w-[300px]">
            <div className="flex items-start justify-between gap-3">
              <div className="grid grid-cols-3 gap-2">
                {MARKER_VARIANTS.map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => addMarkerAtCenter(variant)}
                    aria-label={variant}
                    className={cn(
                      "flex h-[60px] w-[60px] items-center justify-center rounded-lg border transition-colors",
                      markerDraft.variant === variant ? "border-primary bg-accent" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="pointer-events-none scale-[0.7]">
                      <EditorMarkerView
                        variant={variant}
                        label=""
                        icon={<IconifyIcon name={markerDraft.icon} />}
                        color1={markerDraft.color1}
                        color2={markerDraft.color2}
                        size={44}
                      />
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <MapColorPicker
                  value={markerDraft.color1}
                  onChange={(value) => setMarkerDraft((current) => ({ ...current, color1: value }))}
                  title="Fill (color1)"
                  swatches={swatches}
                />
                <MapColorPicker
                  value={markerDraft.color2}
                  onChange={(value) => setMarkerDraft((current) => ({ ...current, color2: value }))}
                  title="Icon (color2)"
                  swatches={swatches}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md border border-input bg-background px-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                placeholder="Search icons"
                className="h-8 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <div className="mt-2 grid max-h-[160px] grid-cols-8 gap-1 overflow-y-auto">
              {iconResults.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setMarkerDraft((current) => ({ ...current, icon: name }))}
                  aria-label={name}
                  title={name}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md transition-colors",
                    markerDraft.icon === name ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <IconifyIcon name={name} className="h-5 w-5" />
                </button>
              ))}
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Size</span>
                <span>{markerDraft.size}px</span>
              </div>
              <input
                type="range"
                min={28}
                max={64}
                value={markerDraft.size}
                onChange={(event) => setMarkerDraft((current) => ({ ...current, size: Number(event.target.value) }))}
                className="w-full accent-primary"
              />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Pick a type to drop a marker at the map center, or click the map.
            </p>
          </MapEditorPanel>
        </div>
      ) : null}
    </div>
  );
}
