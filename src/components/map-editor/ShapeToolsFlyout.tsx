"use client";

import { MapSubToolButton } from "./tool-rail";
import type { MapEditorController } from "./use-map-editor";

/**
 * tasmap's "add a place" rail flyout: a column of round buttons, each dropping a
 * themed marker at the viewport centre with a matching icon. Icons are drawn
 * inline (mdi paths) so the rail matches tasmap exactly; the dropped marker uses
 * the equivalent iconify name.
 */

type ShapeTool = {
  id: string;
  label: string;
  /** iconify name used for the dropped marker */
  icon: string;
  /** mdi path (24x24) drawn on the rail button */
  path: string;
};

export const SHAPE_TOOLS: ShapeTool[] = [
  {
    id: "document",
    label: "Document",
    icon: "mdi:file-document",
    path: "M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m9 16v-2H6v2zm3-4v-2H6v2z",
  },
  {
    id: "area",
    label: "Area",
    icon: "mdi:square-outline",
    path: "M19 3H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 2v14H5V5z",
  },
  {
    id: "text",
    label: "Text label",
    icon: "mdi:format-text",
    path: "M9.62 12L12 5.67L14.37 12M11 3L5.5 17h2.25l1.12-3h6.25l1.13 3h2.25L13 3z",
  },
  {
    id: "landmark",
    label: "Landmark",
    icon: "mdi:office-building",
    path: "M18.1 4.8c-.1-.5-.5-.8-1-.8H13l.2 3h-2.4l.2-3H6.8c-.5 0-.9.4-1 .8l-2.7 14c-.1.6.4 1.2 1 1.2H10l.3-5h3.4l.3 5h5.8c.6 0 1.1-.6 1-1.2zM10.4 13l.2-4h2.6l.2 4z",
  },
  {
    id: "tree",
    label: "Tree / park",
    icon: "mdi:pine-tree",
    path: "M10 21v-3H3l5-5H5l5-5H7l5-5l5 5h-3l5 5h-3l5 5h-7v3z",
  },
  {
    id: "city",
    label: "City",
    icon: "mdi:city",
    path: "M6 19h2v2H6zm6-16L2 8v13h2v-8h16v8h2V8zm-4 8H4V9h4zm6 0h-4V9h4zm6 0h-4V9h4zM6 15h2v2H6zm4 0h2v2h-2zm0 4h2v2h-2zm4 0h2v2h-2z",
  },
  {
    id: "marker",
    label: "Place marker",
    icon: "mdi:map-marker",
    path: "M12 11.5A2.5 2.5 0 0 1 9.5 9A2.5 2.5 0 0 1 12 6.5A2.5 2.5 0 0 1 14.5 9a2.5 2.5 0 0 1-2.5 2.5M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7",
  },
];

export function ShapeToolsFlyout({
  editor,
  onPlaced,
}: {
  editor: MapEditorController;
  onPlaced?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {SHAPE_TOOLS.map((shape) => (
        <MapSubToolButton
          key={shape.id}
          label={shape.label}
          onClick={() => {
            editor.addMarkerAtCenter("pin", { icon: shape.icon });
            onPlaced?.();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={shape.path} fill="currentColor" />
          </svg>
        </MapSubToolButton>
      ))}
    </div>
  );
}
