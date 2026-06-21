"use client";

import { useState } from "react";
import { ImageOff, Plus, Search, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { EditorMarkerView, type EditorMarkerVariant } from "./editor-core";
import { IconifyIcon, MarkerGlyph } from "./iconify";
import { MapColorPicker } from "./color-picker";
import { MapEditorPanel, MapSubToolButton } from "./tool-rail";
import type { MapEditorController } from "./use-map-editor";

const MARKER_VARIANTS: EditorMarkerVariant[] = ["dot", "pin", "badge"];

/** Colourful sample images for the "Image" tab (Twemoji SVGs render as <img>). */
const SAMPLE_IMAGES = [
  "https://api.iconify.design/twemoji/round-pushpin.svg",
  "https://api.iconify.design/twemoji/camera.svg",
  "https://api.iconify.design/twemoji/national-park.svg",
  "https://api.iconify.design/twemoji/department-store.svg",
  "https://api.iconify.design/twemoji/fork-and-knife-with-plate.svg",
  "https://api.iconify.design/twemoji/mountain.svg",
  "https://api.iconify.design/twemoji/tent.svg",
  "https://api.iconify.design/twemoji/hot-beverage.svg",
];

/**
 * tasmap's marker submenu: a column of sub-buttons (new / recolor / the marker
 * list) plus an editor popover — marker-type tiles, colour pickers, and an
 * Icon / Image tabbed picker (iconify search grid, or an image URL / sample).
 * Picking a type drops a marker at the map center. Theme-aware.
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

  const [tab, setTab] = useState<"icon" | "image">("icon");

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
              icon={<MarkerGlyph icon={marker.icon} image={marker.image} />}
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
                        icon={<MarkerGlyph icon={markerDraft.icon} image={markerDraft.image} />}
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

            <div role="tablist" className="mt-3 flex gap-1 border-b border-border">
              {(["icon", "image"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    tab === value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            {tab === "icon" ? (
              <>
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
                      onClick={() => setMarkerDraft((current) => ({ ...current, icon: name, image: undefined }))}
                      aria-label={name}
                      title={name}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md transition-colors",
                        markerDraft.icon === name && !markerDraft.image
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <IconifyIcon name={name} className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
                  <input
                    value={markerDraft.image ?? ""}
                    onChange={(event) =>
                      setMarkerDraft((current) => ({ ...current, image: event.target.value || undefined }))
                    }
                    placeholder="Paste an image URL"
                    spellCheck={false}
                    className="h-8 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {markerDraft.image ? (
                    <button
                      type="button"
                      onClick={() => setMarkerDraft((current) => ({ ...current, image: undefined }))}
                      aria-label="Remove image"
                      title="Remove image"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ImageOff className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="grid max-h-[160px] grid-cols-4 gap-2 overflow-y-auto">
                  {SAMPLE_IMAGES.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setMarkerDraft((current) => ({ ...current, image: url }))}
                      aria-label="Use image"
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border p-1.5 transition-colors",
                        markerDraft.image === url ? "border-primary bg-accent" : "border-border hover:bg-accent",
                      )}
                    >
                      <img src={url} alt="" className="size-full object-contain" />
                    </button>
                  ))}
                </div>
              </div>
            )}

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
