"use client";

import { Check, Plus } from "lucide-react";

import { PATH_TYPE_OPTIONS } from "./editor-core";
import { MapColorPicker } from "./color-picker";
import { MapEditorPanel, MapSubToolButton, PathPreviewSwatch } from "./tool-rail";
import type { MapEditorController } from "./use-map-editor";

/**
 * tasmap's path submenu: an "Add path" sub-button plus a popover with the 2×4
 * grid of path-type previews, a color picker, and a Finish action. Theme-aware.
 */
export function PathFlyout({
  editor,
  swatches,
}: {
  editor: MapEditorController;
  swatches: string[];
}) {
  const { pathDraft, updatePathDraft, activePathId, finishPath, enterTool } = editor;

  return (
    <div className="relative flex flex-col gap-3">
      <MapSubToolButton icon={<Plus />} label="Add path" active onClick={() => enterTool("path")} />
      <div className="absolute left-full top-0 ml-3">
        <MapEditorPanel className="w-[252px]">
          <div className="grid grid-cols-4 gap-2">
            {PATH_TYPE_OPTIONS.map((option) => (
              <PathPreviewSwatch
                key={option.key}
                curved={option.curved}
                dashed={option.dashed}
                arrow={option.arrow}
                color={pathDraft.color}
                label={option.label}
                selected={
                  pathDraft.curved === option.curved &&
                  pathDraft.dashed === option.dashed &&
                  pathDraft.arrow === option.arrow
                }
                onClick={() => updatePathDraft({ curved: option.curved, dashed: option.dashed, arrow: option.arrow })}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Color</span>
            <MapColorPicker
              value={pathDraft.color}
              onChange={(value) => updatePathDraft({ color: value })}
              title="Path color"
              swatches={swatches}
            />
            <span className="ml-auto text-[11px] text-muted-foreground">{activePathId ? "drawing…" : "idle"}</span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Pick a style, then click the map to add points.
          </p>
          <button
            type="button"
            disabled={!activePathId}
            onClick={finishPath}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent/80 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            Finish path
          </button>
        </MapEditorPanel>
      </div>
    </div>
  );
}
