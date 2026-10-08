# Shared UI building blocks

Map sections and dev pages build their sidebars, dialogs and popups from the
pieces below. Reach for these before hand-rolling markup; when a page needs
something they cannot express, add an opt-in prop here rather than copying
the markup, so every page that adopts it later gets the same behaviour.

All live in `src/components/ui/` unless noted.

## Sidebars

| Need | Use |
|---|---|
| Sidebar frame (header, dataset info, scroll port) | `MapSidebarShell` (`map-panels.tsx`). `icon` for an icon tile; `hideTitleOnMobile` when the mobile top bar already names the section. |
| A titled block inside it | `SidebarSection` (`title`, `icon`, `actions`; `headingLevel={3}` when nested under another heading) |
| Numbered steps of a procedure | `StepSection` (`step-section.tsx`): `step`, `title`, `status` (`done` / `current` / `todo`), `reference`, one-line `summary`; folds to its header and keeps its content mounted. `collapsible={false}` gives a plain heading for a step already in its own tab panel. `StepMarker` is the numbered/checked circle on its own, for tabs. For a long procedure, show one step at a time: `TabBar` with a `StepMarker` per tab, each step's panel kept mounted and `hidden` when not selected (the forestry visual-quality sidebar is the reference). |
| Settings people set once (mode, period) | `MobileCollapsibleSection` (folds on phones only) |
| A disclosure at every width | `CollapsibleSection collapseOn="always"` |
| Headline numbers | `StatGroup` (`stat-group.tsx`): `variant="inline"` for a row of numbers, `variant="tiles"` with `size="sm"` (dense sidebar grid) or `size="md"` (dialogs). `StatGrid`/`StatTile` are legacy wrappers around it. |
| Pick one of 2–4 views | `SegmentedControl` (`segmented-control.tsx`). `variant="solid"`, per-option `icon`/`activeClassName` for toolbars. |
| Switch which panel shows | `TabBar` (`tab-bar.tsx`), tablist semantics and arrow keys. Opt-in: `stretch` (tabs share the width without a nested scroll area; long labels truncate), `stacked` (marker above the label, for five or so tabs in a sidebar), and per option `marker` (in place of `icon`) and `ariaLabel` (when the visible label is abbreviated). Default label-sized tabs can scroll horizontally. Keep underline borders inside the row: negative bottom margins create vertical overflow in a horizontal scroll port. |
| Layer / data-source on-off | `ToggleRow` (`toggle-row.tsx`), `layout="tile"` for grids. |
| Multi-select filter chips | `FilterChipGroup variant="filled"` + `SelectAllActions` (`text-button.tsx`) in the group heading. |
| Notes, warnings, errors, loading text | `InlineAlert` (`tone`, `title`, `loading`) |
| Label/value details | `KeyValueRows` (`variant="stack" \| "divided" \| "grid"`, `size`), falsy rows skipped |
| Selected item card | `SelectedItemCard` (hover follows `tone`) |
| Search field | `SearchInput` (`icon`, `onClear`, forwards `ref`); 16px on phones so iOS does not zoom. It marks itself as the target of the map search shortcut; pass `data-map-search-input="false"` on secondary search fields in the same sidebar. |
| Small link-style actions | `TextButton` (`tone`) |
| Tags and counts | `Badge` (`badge.tsx`: `tone`, `variant`, `pill`) |
| "View source" links | `ExternalLink` (`variant="link" \| "button"`) |

## Result lists

- `VirtualResultList` for any list that can exceed ~50 rows. Do not cap with
  `slice(0, N)`; if a cap is unavoidable, say so with `ListHeader shown={N}`.
- `ResultRow` for a row (marker, title, subtitle, meta, trailing value,
  `selected` + `accent`, aria-pressed).
- `ListHeader` for the "N items" line, `ListState` for loading / error / empty
  (with `onReset`), `EmptyHint` for a small empty note inside a panel.
- `StickyListToolbar` + `useStickyListToolbar` + `FilterToggleButton` +
  `ResetFiltersButton` (`sticky-list-toolbar.tsx`) pin search, filters and sort
  above a long list. `useRevealBelowSticky` scrolls a newly inserted card
  (e.g. the selected item) into view under the toolbar. The food map sidebar
  is the reference implementation.

## Dialogs

- `DialogShell` (`dialog-shell.tsx`): pinned title row with a finger-sized
  close button, optional header (toolbar, summary, notes), scrolling body,
  optional footer. Bottom sheet on phones; on phones only the title row stays
  pinned.
- `RecordDialog` (`record-dialog.tsx`): one record's history and its source,
  with "Data from …", source link, `footerActions`, `footerStart`, Close.
  `RecordEmptyState` when the record has nothing to show.
- `PanelDialog`: settings, pickers and libraries (optional footer).

## Map overlays

- `MapCircleLayer` accepts `hoverEnabled={false}` to dismiss and suspend hover
  cards during marker dragging or another external interaction. Normal hovering
  resumes when enabled; cards also stay dismissed while the map is moving or a
  pointer button is held.

- Comparisons: `MapSwipe` (`map-swipe.tsx`) takes full-size `left` and `right`
  React slots, labels, and an optional `onPositionChange(percent)` callback.
  It reveals the right surface with a clipped divider; the caller owns camera
  synchronization. Pointer capture supports mouse/touch dragging, with Home/End,
  arrows and Page Up/Down for keyboard use. The divider updates CSS once per
  animation frame without rendering its map children on every pointer move.

- Loading: shared `Map` keeps its standard loader by default. Set
  `showLoadingOverlay={false}` for embedded editorial maps to omit it entirely,
  including the initial load. This leaves map readiness and errors intact;
  the caller supplies accessible progress text.

- Categorical raster polygons: `MapCategoricalRaster` (`map-categorical-raster.tsx`)
  loads `categorical-raster-polygons-v1` native blocks for the viewport and renders
  pickable deck.gl polygons. Supply a colour function, pick/status callbacks and
  attribution; numeric values stay in feature properties. The reusable source
  converter is documented in `vendor/bcdatamapper/datascrapers/lib/categorical-raster.md`.
  It also accepts `categorical-raster-pyramid-v1` for zoom-dependent display
  overviews, retaining the previous level until replacement coverage is ready.
  Pick callbacks include `overview: true` for generalized grids; label those
  results accordingly instead of describing them as exact cell values.
  Polygon fetch/decode/triangulation runs in a two-worker pool with transferable
  binary geometry; retain Float64 positions and use binary feature indices for
  picking. Newly prepared blocks wait for camera movement to finish. Recently
  drawn blocks remain as hidden, non-pickable deck.gl layers (up to 48 inactive
  blocks), so cached levels can switch during a gesture without GPU uploads.
  New block requests wait for the settled viewport; cached views remain usable.

- Image box grids: `createRasterGridLayer` (`map-raster-grid.ts`) composes
  a pickable `TileLayer` into an existing deck.gl overlay. Supply XYZ
  `sourceZoom` (one level or `{ min, max }` saved bounds), `tileUrl`, explicit RGB/class `palette`, `cellPixels`, and
  `colorForValue`; optional outlines, hover/click callbacks and tile errors.
  By default it keeps one box per source pixel (`cellPixels=1`), original RGBA
  bytes and no outlines. `pngPixels.ts` decodes 8-bit RGBA PNG directly, avoiding
  canvas colour conversion and alpha rounding. Classification serves picking
  only; uncertain colours retain their original appearance. Set the same
  `opacity` as the source image to compare; nearest texture filtering on a
  source bitmap compares pixels without introducing interpolated edge colours.
  Larger boxes explicitly opt out of source preservation, infer one class per
  box from its interior, and keep mixed evidence uncertain. `rasterClassGrid.ts` owns classification,
  voting and shared global pixel edges. `GRID_NO_DATA` means transparent image
  evidence; a failed fetch has no verified class. Class labels are inferred
  display classes on the source Web Mercator grid; box size adds no
  source detail. Boxes never dissolve into larger shapes. A source range follows
  the same native tile selection as the source image; it does not resample one
  zoom into another. Requests stay within the viewport, with six requests at once
  and a cache cap of four tiles for original pixels, rising to 32 for larger boxes
  (visible tiles are retained). See `/dev/networks` for every raster band, automatic
  levels, fixed-level comparison, native CRTC/TELUS layers and shared tooltips.

- Native road lines: `MapLineLayer` accepts `sourceKey` for map-local source
  sharing, `sourceTolerance={0}` to disable GeoJSON tiling simplification, and
  `hoverHtml` for themed pointer-dismissed tooltips. Identical data references
  are indexed once; the final owner releases the source. Large CRTC road
  collections use this worker-tiled renderer with their original GeoJSON.
  The raster comparison mode does not alter native vector data.

- Scale: `MapScaleBar` (`map-controls.tsx`, `position`, `maxWidth`), a metric
  bar measured great-circle across the map's middle (so Mercator's stretch at
  our latitude, 1.7×, is not read off the zoom), in the app's theme. It hides
  itself on a map pitched past 60°. Any page reporting areas or distances
  should show one.

- Legends: `MapLegendPanel` with `defaultCollapsed="mobile"` (or the same rule
  for a controlled legend: `useState(isMobileViewport)`), `LegendItem`,
  `MapGradientLegendItem`, `MapSteppedLegend`, `MapSizeLegend`.
  Keep a layer's colour ramp in one constant that both the layer and its
  legend read.
- Popup / floating detail content: `MapPopupCard` (`map-popup-card.tsx`) with
  `KeyValueRows` inside.
- Hover tooltips: `MapTooltipCard` (`map-tooltip-card.tsx`) for React content;
  `mapTooltipHtml({ title, subtitle, lines, rows, footer })` for layer `hoverHtml`
  and imperative MapLibre/deck.gl popups. Pass plain text; the helper escapes
  all content and skips empty rows (keeping zero). Both share the themed surface,
  padding, border, shadow and wrapping. `.mapcn-tooltip` removes MapLibre's own
  chrome, so bare HTML there has no card. `MarkerTooltip` uses this surface too.
- Phone peek text: `mobilePeekTitle` / `mobilePeekSubtitle` on
  `MapSectionLayout`, parts separated with ` · `.

## Touch

`touch:` is a Tailwind variant for `(pointer: coarse)`. Use it to grow hit
areas on phones and tablets (`touch:min-h-10`, `touch:p-2`) without changing
the mouse layout. The shared controls above already do.

## Helpers (`src/lib/`)

- `format.ts`: `formatNumber`, `formatCurrency`, `formatCompactCurrency`,
  `formatPercent`, `formatDate`, `formatMonthYear`, `formatBytes`,
  `formatArea` (m²/ha), `formatSquareKm`, `formatLength`, `MONTH_NAMES`,
  `MONTH_SHORT_NAMES`. Pass `DEFAULT_LOCALE` to any direct `toLocaleString`.
- `color.ts`: `hexToRgba`, `readableTextColor`, `colorForKey`.
- `download.ts`: `downloadBlob`, `downloadText`.

## Story diagrams and editorial reading

`RadialHierarchy` and `CategoryDotDiagram` in `src/components/ui/diagrams` take
structured data, category colors, a selected category and an `onSelect`
callback. They do not fetch data or control a map. The hierarchy includes a
keyboard-operable nested list; dots preserve authored normalized coordinates
and label measured versus illustrative input. Layout and sample selection live
in `src/lib/diagrams/storyDiagrams.ts`.

`EditorialShell` is shared by native and imported stories and owns project
navigation, viewport measurement and chapter navigation. See the
[native editorial contract](native-editorial-stories.md) for JSON invocation.
