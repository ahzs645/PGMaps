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
| Switch which panel shows | `TabBar` (`tab-bar.tsx`), tablist semantics and arrow keys. Opt-in: `stretch` (tabs share the width), `stacked` (marker above the label, for five or so tabs in a sidebar), and per option `marker` (in place of `icon`) and `ariaLabel` (when the visible label is abbreviated). |
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
