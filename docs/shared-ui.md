# Shared UI building blocks

Map sections and dev pages build their sidebars, dialogs and popups from the
pieces below. Reach for these before hand-rolling markup; when a page needs
something they cannot express, add an opt-in prop here rather than copying
the markup, so every page that adopts it later gets the same behaviour.

Application imports remain in `src/components/ui/` unless noted. Shared
implementations now live in `packages/geo-toolkit/src/ui`, `map` and `workspace`;
the application paths provide compatibility exports and PG Maps integrations.
Add generic behavior in the package and host-specific behavior in the adapter.
See [toolkit extraction](toolkit-extraction.md) for ownership and checks.
See [interface motion](interface-motion.md) for interruptible sheets/cards,
desktop panel lifecycles, selection framing, reduced motion, and dialog close
callback timing.

## Design tokens

Token **names** live in the toolkit's `src/tailwind-theme.mjs`; both Tailwind builds
(the toolkit's and `tailwind.config.js`) extend it, so a class means the same inside
and outside a map workspace. Token **values** live in `src/index.css`. Its rules also
name `.geo-toolkit` with the toolkit stylesheet's own selectors and load after it, so
one edit there reaches every page and every workspace. `src/designTokens.test.ts`
fails if the toolkit gains a token the app does not set, in either theme.

Open **Appearance** in the site navigation or **Branding → Interface theme** in
the road workspace. Start with a preset or edit either palette and the shared
corner radius. The component preview updates while you edit. **Apply theme**
saves the theme in this browser and updates shared controls across pages,
including dialogs and map toolbars. **Export CSS** copies the configured
shadcn-style variables for light and dark mode. A custom primary colour takes
precedence over the workspace's Brandkit primary. Reset the field to use the
brand colour or built-in theme. Map symbols and reports have their own settings.

- **Surfaces.** The page is `background`; a card on it (`bg-card`: a plain `insetBox`, a
  stat tile, a list of rows in a sidebar) is one step up, 9% against the page's 3.9% in the
  dark theme, which are shadcn's values, and white on white in the light theme, where the
  border does the work. A menu, tooltip or dialog is `popover`, the same raised step, and
  the theme's card colour when Appearance sets a card but no popover. A dialog needs no class for this:
  `src/index.css` sets `--background` to the popover colour on `.geo-motion-dialog-content`,
  so `bg-background` fields, headers and tables inside any `Dialog`, `DialogShell` or
  `PanelDialog` sit on the raised tone. Never give a dialog its own surface colour. A docked
  panel that should read apart from the page (the road designer's sidebar) takes the same
  layers with the `raised-surface` class and `bg-background`. The dark
  `border` (18%) and `input` (22.7%) are shadcn's 10% and 15% white edges as solid colours,
  chosen so a box outline stays visible on the raised surface. Two more steps exist only
  inside a dialog: `--raised` for a box (`bg-card` is rebound to it there, so a plain
  `insetBox` climbs with its surface) and `--raised-muted` for tracks, tabs and hovers on it, bound to `muted`,
  `secondary` and `accent` unless the theme sets those. Dark climbs 3.9 → 9 → 13 → 17%; light
  uses a faint 98% well. A field inside a card keeps `bg-background`, so it reads as a well. For an Appearance theme `interfaceTheme.ts` derives both from the
  theme's popover or card colour, in its hue.
- **Surfaces under an Appearance theme.** A theme may give the page its own colour while
  cards stay white, and then a `bg-background` field on a card showed the page colour as a
  tinted patch. While a theme sets any colour, `interfaceTheme.ts` puts `data-interface-theme`
  on `<html>` (the Appearance preview sets it on itself), and `src/index.css` rebinds
  `--background` inside `bg-card` and `bg-popover` to that surface, as a dialog does. A
  selected card tinted with fixed palette classes for the built-in theme marks itself
  `data-selected-card`; under a theme it takes `accent` with a `primary` edge. The built-in
  theme never has the attribute, so it looks as before. A theme's `muted` colour leaves
  `muted-foreground` (the hint-text grey) at its default rather than deriving black or white.
- **Corners.** `--radius` (0.5rem) drives every step: `rounded-sm`/`rounded` 4 px,
  `rounded-md` 6, `rounded-lg` 8, `rounded-xl` 12, `rounded-2xl` 16. Pick by role:
  `rounded-sm` for small marks (swatches, tags, map labels), `rounded-md` for controls
  and bordered boxes, `rounded-lg` for cards, popovers and floating panels,
  `rounded-full` for pills and dots. Plain CSS uses `calc(var(--radius) ± n)`, never a
  pixel value.
- **Status colours.** `warning`, `danger`, `success` and `info`: `text-warning` for text
  and icons on the page; `border-warning-border bg-warning-surface text-warning-foreground`
  for a tinted box. They carry their own dark values, so never pair them with `dark:`.
  `destructive` stays the fill of a destructive button. Category colours (a layer's or a
  feature's identity, legend swatches) are not status and stay in their palettes, such as
  `planLegendModel.ts`.
- **Type.** `text-3xs` (10 px), `text-2xs` (11 px), `text-xs`, `text-sm`; no `text-[Npx]`.
  A fixed-size SVG that needs smaller text uses its `fontSize` attribute.
- **Control heights.** `Button` sizes `xs` (28 px) for dense tool panels, `2xs` (24 px)
  for an action inside a row, `field` (32 px) for a button sharing a row with a dense
  form field (`roadFieldClass`), and `icon-xs`/`icon-2xs`; no `h-*` override on a `Button`.
- **Bordered groups.** `insetBox({ padding, tone })` (`inset-box.tsx`) on any element, or
  `<InsetBox>`: one radius and padding scale for a fieldset, details block, figure or
  bordered list inside a section. Notes and warnings use `InlineAlert`. `hoverRows` highlights
  the row under the pointer in a `padding: 'none'` list a reader acts on (`li` and `div` rows
  and `CollapsibleSection` headers); leave it off for rows that only read.

The forestry tools (`/dev/forestry/*` and `src/components/interfaces`) enforce these with a
lint rule (`designTokenSelectors` in `eslint.config.js`): no plain `rounded`, arbitrary
radius, pixel font size or palette status text in a className or `cn` call. Other pages
can join by adding their folders to its `files` list once swept.

## Sidebars

Basemap appearance: `buildBasemapStyle` (`map-styles.ts`) recolors a supplied
Carto/OpenMapTiles style using explicit colors and visibility flags. It preserves
tile sources, filters and zoom constraints; fetching and named host presets stay
with the application. `/dev/design` and `/dev/water-temperature` share it.

| Need                                              | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar frame (header, dataset info, scroll port) | `MapSidebarShell` (`map-panels.tsx`). `icon` for an icon tile; `hideTitleOnMobile` when the mobile top bar already names the section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tighter sidebar                                   | `MapSidebarShell density="compact"` tightens every `SidebarSection` inside it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Head of a scrolling tool page                     | `ToolPageHeader` (`tool-page-header.ts`): `back`, `eyebrow`, `eyebrowIcon`, `title`, `description`, `aside`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Local files                                       | `FileDropField` (`file-drop-field.ts`): `Add files`, optional `folderLabel`, and drag and drop, including dropped folders. `multiple={false}` for an import that reads one file (a drop still hands over every file; take the first). `filesFromInput` and `filesFromDrop` (`picked-files.ts`) are the DOM-only helpers, with no React. For an import button in a toolbar or panel, `FileButton` (`file-button.ts`): a `Button` over a hidden input named by `label`; `onFiles` gets `File[]`, and the input clears so the same file can be picked again. The LiDAR inventory toolbar is the reference.     |
| A titled block inside it                          | `SidebarSection` (`title`, `icon`, `actions`; `headingLevel={3}` when nested under another heading; `variant="subsection"` for a block inside a step: a hairline above, none below, heading level 3)                                                                                                                                                                                                                                                                                                                                                                                                        |
| A dense tool sidebar's sections                   | `ToolSection` (`tool-section.tsx`, app-level): a flat section with `title`, its explanation as `help` behind an (i), `actions` on the heading row, and `summary` to fold it to one row of live values (`toggleProps` for test hooks). `ToolDisclosure` is a fold inside one: a hairline above, label aligned with the section, no card, and its own `help` behind an (i) instead of a paragraph inside it. Every fold's header row highlights under the pointer. The forestry road designer (`RoadSection` wraps it) and visual-quality sidebars use them; don't nest a `ToolSection` in another.           |
| Numbered steps of a procedure                     | `StepSection` (`step-section.tsx`): `step`, `title`, `status` (`done` / `current` / `todo`), `reference`, one-line `summary`; folds to its header and keeps its content mounted. `collapsible={false}` gives a plain heading for a step already in its own tab panel. `StepMarker` is the numbered/checked circle on its own, for tabs. For a long procedure, show one step at a time: `TabBar` with a `StepMarker` per tab, each step's panel kept mounted and `hidden` when not selected (the forestry visual-quality sidebar is the reference: the tabs at the top of the scroll, `ToolSection`s below). |
| Settings people set once (mode, period)           | `MobileCollapsibleSection` (folds on phones only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A disclosure at every width                       | `CollapsibleSection collapseOn="always"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Headline numbers                                  | `StatGroup` (`stat-group.tsx`): `variant="inline"` for a row of numbers, `variant="tiles"` with `size="sm"` (dense sidebar grid) or `size="md"` (dialogs). `StatGrid`/`StatTile` are legacy wrappers around it. Per item, `onToggle` + `pressed` (+ `pressedClassName`) turn a tile into an on/off switch, e.g. highlighting the blocks it counts. `aria-label` names a group of counts that no heading names.                                                                                                                                                                                              |
| Pick one of 2–4 views                             | `SegmentedControl` (`segmented-control.tsx`). `variant="solid"`, per-option `icon`/`activeClassName` for toolbars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Switch which panel shows                          | `TabBar` (`tab-bar.tsx`), tablist semantics and arrow keys. Opt-in: `stretch` (tabs share the width without a nested scroll area; long labels truncate), `stacked` (marker above the label, for five or so tabs in a sidebar), and per option `marker` (in place of `icon`) and `ariaLabel` (when the visible label is abbreviated). Default label-sized tabs can scroll horizontally. Keep underline borders inside the row: negative bottom margins create vertical overflow in a horizontal scroll port.                                                                                                 |
| Layer / data-source on-off                        | `ToggleRow` (`toggle-row.tsx`), `layout="tile"` for grids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Multi-select filter chips                         | `FilterChipGroup variant="filled"` + `SelectAllActions` (`text-button.tsx`) in the group heading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Notes, warnings, errors, loading text             | `InlineAlert` (`tone`, `title`, `loading`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Floating notifications                            | `Notification` (`notification.tsx`) joins the one stack `Shell`'s `NotificationProvider` places: bottom-right, full width on phones. `tone` (`error` is an alert, the rest polite), `title`, `message`, `icon`, `progress`, `action` (beside the text), `actions` (below), `onDismiss`. Render it while your state lasts (a job, an error); `useNotifications().push` for one-off events. Never position a notice yourself.                                                                                                                                                                                 |
| Explanations a reader needs once                  | `InfoTip` (`info-tip.tsx`, app-level): an (i) button whose bubble opens on hover or focus, pins on click or tap, closes on Escape, and renders in a portal so a scroll port cannot clip it. `showLabel` prints the label beside the icon. Field helpers can take a `hint` that puts one beside the label, outside the `<label>`, so it never becomes the input's name. Keep warnings inline in `InlineAlert`.                                                                                                                                                                                               |
| Label/value details                               | `KeyValueRows` (`variant="stack" \| "divided" \| "grid"`, `size`), falsy rows skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Selected item card                                | `SelectedItemCard` (hover follows `tone`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Search field                                      | `SearchInput` (`icon`, `onClear`, forwards `ref`); 16px on phones so iOS does not zoom. It marks itself as the target of the map search shortcut; pass `data-map-search-input="false"` on secondary search fields in the same sidebar.                                                                                                                                                                                                                                                                                                                                                                      |
| Search with a result list (combobox)              | `useSearchCombobox`, `SearchComboboxInput`, `SearchResultList` (`search-combobox.tsx`). Use these before hand-rolling a combobox; see **Search comboboxes** below.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Small link-style actions                          | `TextButton` (`tone`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tags and counts                                   | `Badge` (`badge.tsx`: `tone`, `variant`, `pill`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| "View source" links                               | `ExternalLink` (`variant="link" \| "button"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Search comboboxes

A text box that drives a result list through `aria-activedescendant` (focus stays in the box) is
`useSearchCombobox` plus its two renderers in `search-combobox.tsx`. The ribbon tool finder, the
site search, Flatten's place boxes and the searchable `AppSelect` are built on it.

- The hook takes the shown `items` and `onPick`. Arrows wrap (`loop={false}` stops at the ends),
  `homeEnd` claims Home/End, Enter picks, and keys pressed while an input method is composing are
  left alone. `isDisabled` options are never picked and are skipped unless `skipDisabled={false}`
  (the ribbon finder keeps them reachable so "Unavailable" is read out). `resetKey`, usually the
  query, returns the highlight to the first option. Only keyboard moves scroll the list, so it
  never chases a moving pointer; `scrollIntoView="always"` follows every change.
  `activateOnHover` highlights under the pointer.
- `SearchComboboxInput variant="field"` is the sidebar `SearchInput`, which takes the map search
  shortcut; `variant="bare"` is a borderless palette row (`boxClassName`, a leading `icon`,
  `onClear` and `onClose` buttons) that never takes it. The page's own `onKeyDown` (Escape, a blur
  after a pick) runs after the list's keys; `event.defaultPrevented` tells it a key was used.
- `SearchResultList` renders each option through `renderOption` (`SearchResultContent` gives an
  icon, a title and a secondary line), groups consecutive options under named headings
  (`getGroup`), and shows `empty` inside the list when nothing matches. `keepInputFocus` keeps a
  click from blurring a box whose list closes on blur; `isSelected` marks a select's chosen value
  rather than the highlight.
- Markup the renderers cannot express spreads `inputProps`, `listProps` and `getOptionProps`.

## Form fields and ranges

Use `form-field.tsx` exports `FormField`, `StyledSelect`, `SelectField`,
`NumberField` and `NullableNumberField`. `FormField` associates a label and
help/error text with direct native children; compound controls can pass
`htmlFor` / `descriptionId`. `group` names a group of controls, and `hintAction`
keeps an optional `InfoTip` outside the input's label.

### Dropdowns

Every dropdown is the shared styled select; a native `<select>` is only for
multi-select. `StyledSelect` (`styled-select.tsx`) is a drop-in for a native
select: it takes `<option>` and `<optgroup>` children (through fragments, arrays
and conditionals; groups get a heading), or `options`; `value` or `defaultValue`;
and `onChange(event)` with `event.target.value` and `name`, or
`onValueChange(value)`. It also takes `disabled`, `id`, `name`, `title`,
`required` and `aria-label` / `-labelledby` / `-describedby` / `-invalid`, and
`placeholder` for a value that matches no option (without one it shows the
first option, as a native select does). The menu is the Radix one from `AppSelect`,
layered at `z-workspace-popover` so it opens above dialogs and fullscreen panes;
past `SEARCHABLE_FROM` (10) options it becomes a combobox with a filter box, and
`searchable` forces either way. `multiple` or a `size` above 1 renders a real
`<select>`.

`className` is read as a native select's: width, flex, grid, margin and display
classes (`splitSelectClasses`) size the wrapper and the rest style the trigger,
which brings no border, height or padding of its own. An omitted class gives
`FORM_INPUT_CLASS`. Page CSS that styled `select` reaches the trigger through
`[data-select-trigger]`. `SelectField` is `FormField` around it: its
`className` styles the trigger, `fieldClassName` the wrapper and `menuClassName`
the menu. A wrapping `<label>` or `htmlFor` names the trigger button, so
`getByLabel` and `getByRole('combobox', { name })` keep working.

For a dropdown with an options array and no native heritage, `AppSelect`
(`select.tsx`) is the underlying piece: `searchable` adds the filter box,
`searchText` gives a non-text label something to match, and an option's `group`
puts it under a heading. The road design page uses `RoadSelect`
(`dev-forestry-roads/Controls.tsx`), which sizes it like the other road fields
and reuses `StyledSelect`'s option and class helpers.

Triggers and options carry their value in `data-value`. E2E specs pick and read
dropdowns with `tests/e2e/styled-select.ts` (`choose`, `expectSelected`,
`selectedValue`, `optionLabels`, `optionEntries`, `optionDisabled`,
`selectTriggers`), since `selectOption`, `toHaveValue` and `option` locators only
work on native selects. Unit tests that render a page without a DOM (react-test-renderer
under Node, or static markup) mock `@/components/ui/styled-select` with
`StyledSelectTestDouble` (`styledSelectTestDouble.ts`), a plain `<select>` with the
same props: Radix's menu needs `window`, and a closed menu renders no options.

Radix renders a closed dropdown's whole option list on every render. `AppSelect` therefore keeps
its handler stable and reuses the option list while the options read the same (text labels, value,
disabled, title), so a page that re-renders often skips its menus. A list with a non-text label is
rebuilt each render; on a hot path, give it text labels.

To skip a large subtree whose parent rebuilds its props each render (inline handlers, object
literals), wrap it with `memoWithLatestHandlers` (`src/lib/memoWithLatestHandlers.ts`). Function
props become stable proxies to the latest handler; name an object the parent spreads afresh each
render (a workspace) in `bags` to proxy its functions too. Top-level objects compare by content, a
bag's fields by identity. Nothing else is copied, because subtrees compare objects by identity: a
first version copied every object holding a function, and the road template editor, which checks
`candidate.source === workspace.source`, discarded its edits on every render. A value the subtree
shows must arrive as data, never through a function's identity. The road design sidebar is the
reference.

Numeric fields take `value` / `onValueChange` and retain partial drafts. Choose
`updateOn="change" | "commit"` and `clampOn="change" | "commit" | "never"`
explicitly when adapting an existing editor. Required blank input restores the
current value unless `blankValue="zero"`; nullable blank input stays `null`.
`invalidValue="null"` is opt-in for nullable imported fields. Supply `unit` or
`suffix` rather than rebuilding unit rows. Source precision is retained by
default, and untouched blur does not emit a rounded value. Road adapters request
`precision={6}` and `stepMode="increment"` to retain their existing edit/keyboard
convention. Other numeric fields keep native arrow-key step alignment by default.

`NumericRangeField` (`numeric-range-field.tsx`) shares the label, numeric
`onChange`, value/unit readout and description for a range. Supply `display` for
a formatted value, `layout="inline"` for a compact engineering header, or
`renderControl` for an existing custom slider. Its native input forwards refs
and native attributes. Keep host recalculation timing in the caller.

For an option checkbox ("Hide tile-edge candidates") use `CheckboxField`
(`label`, `checked`, `onCheckedChange`, optional `description`); `aria-label`
and other input props reach the native checkbox. A layer or data source switched
on and off stays a `ToggleRow`.

## Shares and distributions

`ShareBars` (`share-bars.tsx`) draws rows of percentage bars against a fixed
`max`: `layout="inline"` for a distribution across bins (the LiDAR return-height
profile), `layout="stacked"` with two `series` to compare A and B per row (the
forestry plot fingerprint). `StackedShareBar` splits one bar into coloured
segments, e.g. a recorded species mixture. A gradient legend with more than two
labels is `MapGradientLegendItem ticks={…}`.

## Copy actions

Use `CopyButton` (`copy-button.tsx`) or `useClipboardText`
(`src/hooks/useClipboardText.ts`) for copy feedback. Each instance owns
`idle` / `pending` / `copied` / `failed` state, the text/error, and timer cleanup.
`copy` accepts text or an async text producer and returns whether copying
succeeded. `resetAfterMs` / `failureResetAfterMs` control feedback lifetime;
zero keeps feedback until reset. Superseded async attempts cannot overwrite a
newer result.

Hosts provide serialization, manual-copy UI and an optional transport/fallback.
`CopyButton.onResult` receives `{ copied, text }` for that UI. Missing clipboard
support is a failure. `copyTextWithSelection` is an opt-in compatibility fallback
that restores focus and selection; AVAST and dataset-information adapters retain
their existing specialized fallback behavior. Keep serialization errors distinct
from clipboard rejection when presenting a share-link failure.

## Floating notifications

Anything that pops in over the page to report an event (an update is ready, a
job is running, a job failed, an export failed) is a `Notification`
(`notification.tsx`, from the toolkit's `/ui`). Notes that belong to a panel stay
inline in `InlineAlert`.

- **One stack.** `Shell` mounts the only `NotificationProvider`, so the app
  update prompt and a road job stack instead of overlapping. The stack sits
  bottom-right (24rem wide) on `sm` and up, full width along the bottom on
  phones, above the safe area and above dialogs and sheets (`z-notification`,
  2200). It passes clicks through between cards. Never position a notice per page.
- **Held state:** render `<Notification id=… />` for as long as the state you own
  lasts (`w.busy`, `error`). It leaves when you unmount it; `onDismiss` adds a
  close button and should clear your state.
- **Events:** `useNotifications().push({ tone, message })` returns an id for
  `update` / `dismiss`. Pushed `success` (5 s) and `info` (6 s) notices close
  themselves; the clock pauses while the pointer or focus is in the stack.
  `loading`, `warning` and `error` stay until dismissed. `duration` overrides it.
- **Card:** `tone`, `title`, `message`, `icon` (or `null`), `progress`
  (`{ value, max, label?, valueText? }`), `action` beside the text (Cancel),
  `actions` in a row below (Later / Reload), `onDismiss` + `dismissLabel`.
  `error` is `role="alert"`; every other tone is a polite `role="status"`. Other
  props, such as `aria-label` and `data-testid`, land on the card itself, so in
  e2e the test id element _is_ the status; its text is `[data-notification-message]`.
- Cards rise in once and leave at once (no exit animation), so a dismissed notice
  is gone the moment the click lands, including under `page.clock`.

## Result lists

- `VirtualResultList` for any list that can exceed ~50 rows. Do not cap with
  `slice(0, N)`; if a cap is unavoidable, say so with `ListHeader shown={N}`.
  Pass `revealKey` to scroll a row into view when it changes (a map click, a deep
  link). For a selection in a long list, render its detail under the row inside
  the list's `children` rather than above the list, where it lands out of view;
  rows are re-measured, so they can grow. Wrap it in `ResultRowDetail`, which
  continues the row's tint and left bar, rather than a card of its own. BC
  Assessment is the reference.
- `ResultRow` for a row (marker, title, subtitle, meta, trailing value,
  `selected` + `accent`, aria-pressed).
- `ListHeader` for the "N items" line, `ListState` for loading / error / empty
  (with `onReset`), `EmptyHint` for a small empty note inside a panel.
- `StickyListToolbar` + `useStickyListToolbar` + `FilterToggleButton` +
  `ResetFiltersButton` (`sticky-list-toolbar.tsx`) pin search, filters and sort
  above a long list. `useRevealBelowSticky` scrolls a newly inserted card
  (e.g. the selected item) into view under the toolbar. The food map sidebar
  is the reference implementation.

## Layer workspaces

Felt-style "layers, legend, table" pages. `/dev/data` is the reference.

- `LayerListItem` (`layer-list-item.tsx`): one layer in a list that is also
  the legend. It shows the swatch, the name, a line of facts (rows, snapshot
  date), a loading or error state, an `actions` slot for an `ActionMenu`, and
  an eye toggle. `children` are the legend rows, hidden while the layer is off.
  `onOpen` makes the name a button that opens the layer's own panel.
  `LayerSwatch` draws the mark on its own (`fill`, `line` or `point`); the
  feature table uses it too.
- `ActionMenu` (`action-menu.tsx`): an overflow menu with actions,
  `checked`/`radio` items, separators and labels. Arrow keys, Home/End and
  Escape work, and Escape returns focus to the trigger. Pass `trigger` to
  replace the "⋯" icon, for example with a column header's label. `label` is
  always the trigger's accessible name.
- `AnchoredPopover` (`anchored-popover.tsx`): the portal panel `ActionMenu` is
  built on. Use it on its own for small read-only panels, such as column
  statistics. It flips above the anchor when there is no room below, and
  closes when its anchor has no size (a hidden mobile copy). Neither piece
  belongs inside a modal dialog: the portal sits outside the dialog's focus
  trap.
  A `FullscreenPanel` stacks above the portal's level and keeps Tab inside itself,
  so a popover opened from one needs `container` set to that panel.
- `ToolbarPopover` (`toolbar-popover.tsx`): an icon button that opens a small
  panel of form controls, with a count of the settings in force, so a narrow
  toolbar stays on one row at any pane width. `ActiveFilterChip` shows one such
  setting beside the closed button and clears it. It sets `container` itself when
  its button is in a `FullscreenPanel`. Pass `children` as a function to get a
  `close` for a control that starts work elsewhere. The road design station table is the
  reference: in a panel it portals both buttons into the panel header
  (`variant="ghost"`, `buttonClassName="size-8"`, `align="end"`) through
  `useChartHeaderControls`, and its chips take a row only while a filter is on.
- `FileDropTarget` (`file-drop-target.tsx`): wraps a map. While files are
  dragged over it, it shows a "drop to add" overlay, then hands the parent a
  `File[]`. Dragged text and links are ignored.
- `ColumnStatsSummary` (`column-stats.tsx`): Felt's column stats: rows with a
  value, empty rows, distinct values, min/median/max/mean/sum for numbers, and
  the most common values for text. Pass the column's own `formatValue`.
- `MapFeatureTablePanel` (`components/map/MapFeatureTable.tsx`) opts into a
  column header menu with `sortable` (Sort ascending/descending, Reset sort,
  read through each column's `getSortValue`). `renderColumnStats(columnId,
rows)` adds "Column stats" to the same menu. Its phone card is mounted only
  on phones. An open `MobileFeatureCard` makes `MapSectionLayout` swallow the
  next sidebar click at any width, so keep feature cards behind
  `ResponsiveFeatureDetail` or an `isMobile` check.

Logic for these pages lives in `src/lib/` and has no DOM access:

- `featureAttributes.ts` infers column types, display names and formats from
  GeoJSON properties. Overrides set curated names, formats and order; the
  bookkeeping columns (OBJECTID, GlobalID, Shape\_\_\*) go last. The module
  formats cells, sorts values and computes `columnStats`. Use one schema for
  the table, popups, tooltips and legends.
- `layerStyle.ts` holds a layer's style as data (`simple`, `categories`,
  `range`, `size`). One object yields the MapLibre colour and size
  expressions and the legend rows, so the layer and its legend cannot drift
  apart. Classes come from the toolkit's `resolvePaletteScale`.
- `geoFileImport.ts` reads dropped files (GeoJSON, zipped shapefile, KML, CSV
  with latitude/longitude columns) into a FeatureCollection in the page. Its
  `GeoFileImportError` messages are written for the person who dropped the
  file.

## Table view

Any map page with rows offers the same table: a docked pane on desktop, a
`MobileFeatureCard` on phones, search, sort, column stats, column show/hide, CSV
of what is shown, All/Visible, fly-to on row click, and `?table=&row=` links. A
page supplies rows and columns and nothing else. Remediation is the reference.

```tsx
const sources = useMemo(
  () => [
    defineTableSource<Site>({
      id: 'sites',
      label: 'Sites',
      color: SITE_COLOR,
      shape: 'point',
      rows: filteredSites, // what the map and filters show right now
      columns: SITE_COLUMNS, // module-level, or memoized
      getRowId: (site) => String(site.id),
      getRowCenter: (site) => site.geometry.coordinates as [number, number],
    }),
  ],
  [filteredSites],
)
const table = useMapTable({ sources, selectedRowId, onSelectRow: selectSite })

<MapSectionLayout table={table} sidebar={sidebar}>
  <Map deferResize={table.deferResize}>
    <MapTableBridge table={table} />
  </Map>
</MapSectionLayout>
```

- **Rows must match the map.** Pass the page's filtered rows, never the raw
  dataset. A table that disagrees with the map is worse than no table.
- **No rows to offer:** pass `sources: []` (a tiles-only page, or while the page
  has no usable data) and no button shows. A source still loading sets
  `status: 'loading'`.
- **Columns:** `textColumn`, `numberColumn`, `dateColumn` (`tableColumns.ts`) give
  each kind of value its width, sort, CSV value and statistics. A CSV holds the raw
  number; `format` only changes the display. For inferred GeoJSON schemas use
  `attributeTableColumns`, which starts source ids (OBJECTID, GlobalID) hidden.
- **Button:** `MapSectionLayout table={…}` puts it in the map's top-left corner. If
  the page already has a map toolbar there, pass `inlineButton: true` and render
  `table.button` in that toolbar, with `buttonClassName` to match the toolbar's control
  height (`h-8 min-w-8` beside 32 px controls). Never position it per page.
- **Camera:** rows fly by default. Pass `flyOnSelect: false` when `onSelectRow`
  already moves the camera, so the two do not fight.
- **URL:** pass `url: false` on a page that writes its URL outside the router
  (aqmap, a hash, share tokens), or that replaces its search params wholesale.
  Row ids go in the URL, so keep them stable across reloads, never an array index
  into filtered rows.
- **Several layers:** one source per layer; the table's title becomes a layer
  picker. Use `rows: () => …` when building rows is costly.
- **Language:** pass `labels` (every word the table adds), `buttonLabel` and
  `buttonText`. The AQ map's `aqTableLabels` is the reference.
- `useMapTableState` is for a page that must know the open table before it can
  build its sources, as `/dev/data` does to fetch that layer.
- Keep sidebar lists: they are for quick picking, the table for comparing.
- Schedules on the forestry tools stay `EngineeringTable`. The table is for rows
  that sit on the map.

Search matches a prebuilt index and each keystroke is deferred. `tableGridLayout`
gives the grid a definite width on purpose: sized to its content, every flexible
track grows to the longest cell in any column.

## Dialogs

- `DialogShell` (`dialog-shell.tsx`): pinned title row with a finger-sized
  close button, optional header (toolbar, summary, notes), scrolling body,
  optional footer. Bottom sheet on phones; on phones only the title row stays
  pinned.
- `RecordDialog` (`record-dialog.tsx`): one record's history and its source,
  with "Data from …", source link, `footerActions`, `footerStart`, Close.
  `RecordEmptyState` when the record has nothing to show.
- `PanelDialog`: settings, pickers and libraries (optional footer).

## Workspaces and engineering data

- Resizable panes: `ResizableSplit` (`resizable-split.tsx`) lays `panes` out side
  by side (`direction="row"`, drag left/right) or stacked (`"column"`, drag up/down;
  give it a parent of definite height). Each pane has a relative `size`, pixel
  `min`/`max` and a `label` that names its separator ("Resize plan and data").
  Separators are `role="separator"` with arrow-key steps and double-click reset;
  `storageKey` remembers sizes, so key it per layout. Below `splitQuery` (default
  `(min-width: 1280px)`) the panes stack with their own `stackedHeight` and a
  height handle under each; use `stackedHeight: 'auto'` for a pane that holds a
  nested split. Keep the tree shape the same across layouts so heavy children such
  as a map stay mounted. The sizing rules are pure functions in `pane-sizes.ts`.
  `/dev/forestry/road-design` is the reference.
  A pane's optional `hidden` keeps its content mounted while visible neighbours
  take its space. Active pointer resizing is shared through `pane-resize.ts`;
  the application's `Map` adapter defers WebGL buffer reallocation until release,
  scaling its existing frame during the drag to avoid white flashes. Scaling
  stretches the picture and leaves HTML markers where they were until release, so
  a map whose markers must track it through a drag passes `deferResize={false}`;
  `resizeMap` redraws in the same frame, so it does not flash. The road design plan
  does this.
- Plot text is nonselectable through the application stylesheet (`svg`, `canvas`,
  `.recharts-wrapper`, `[data-chart-container]`), covering existing and future charts.
  Keep ordinary readouts, tables and form fields copyable.
- Dense readouts: `ReadoutGrid` (`readout-grid.tsx`) lists abbreviated
  `label:` / value pairs in as many columns as fit, values right-aligned in a
  monospace face, with a `title` for each abbreviation and a `warning` tone.
- Engineering schedules: `EngineeringTable` + `ColumnHeader` (`engineering-table.tsx`)
  give ruled columns, banded rows, a tinted `aria-selected` row and two-line
  quantity / unit headers. Format numbers with fixed decimals so columns align.
  In a narrow sidebar pass `compact`: it halves the cells' side padding and lets
  row headers wrap at word boundaries, so three or four numeric columns fit without
  scrolling sideways. A text-valued cell that should wrap too takes `whitespace-normal`.
  `variant="text"` keeps the rules, banding and headers but left-aligns and wraps,
  for tables of text, chips, actions or checkboxes. `rowHeaders` styles a `tbody th`.
  Editable numbers inside one use `engineeringCellInputClass` (borderless, right-aligned,
  outlined on hover/focus, no spinner) with the field's label hidden and its `<td>` at `!p-0.5`;
  `engineeringPinnedColumnClass` keeps the identifying first column in view. The road design
  wraps this as `CellNumberField` (`dev-forestry-roads/Controls.tsx`); never put a labelled form
  field in a table cell, where every row repeats the column header above its input.
- Configurable workspaces (`src/components/interfaces/`): define each command once in
  `workspaceCommands.ts` (label, icon, `kind`, editor, investigation availability) and render it
  only through `CommandButton`, whose `surface` (`ribbon`, `quick`, `header`, `sidebar`) and
  `presentation` (caption breakpoint, short label, accessible name, emphasis) decide how it looks.
  Layouts in `public/workspace-layouts.json` arrange command and widget IDs; `WorkspaceTools`
  renders a top ribbon or a side guide and `WorkspaceHeader` a header line from the same IDs, so a
  new arrangement (a dashboard, a compact bar) is a layout entry, not new components. The page
  supplies one handler, one `CommandState` and one widget node per ID. Parse the layout file with
  `workspaceLayoutSchema.ts` (pure, takes the ID vocabulary as an argument). `RibbonTaskPane` /
  `RibbonPaneHost` give a task pane beside the drawing, and `PanelCorner` (`panel-corner.tsx`) the
  dotted resize grip the panels share. `/dev/forestry/road-design` is the reference.
- Tiled workspaces: `TiledWorkspace` (`tiled-workspace.tsx`) lays columns of panes out in nested
  `ResizableSplit`s whose tree is the same in every preset, so a map in one pane stays mounted when
  the layout changes. Describe the tool once as a `TiledWorkspaceConfig` (storage `namespace`, the
  panel list, `TilePreset`s with the panes each hides and a two-by-two `thumbnail`) and its columns
  as `TileColumnSpec`s; `useTilePanels` remembers the hidden panes per layout, `focusedPane` shows one
  pane at a time on phones, and `tilePaneKey` names the stored sizes. `TileLayoutPicker`
  (`tile-layout-picker.tsx`) is the preset dropdown with its `· edited` entry and the Screen presets
  & panels dialog (panel checklist, saved layouts). Frame a pane with `TilePane` (the
  `FullscreenPanel` title bar, optional `PanelCorner` grip) and `TilePaneClose` (pass `title` when
  closing does something else, such as leaving a mode). The road designer
  (`RoadPaneLayout.tsx`, `LayoutPicker.tsx`) and the visual-quality tool (`visualsWorkspace.ts`) are
  the references.
- Headline measurements beside a workspace: `MetricSummary` (`metric-summary.tsx`) is a titled stack
  of keyed `StatItem` rows (`MetricSummaryItem`), each hidden, value, or value and detail; a
  right-click or Shift+F10 on a row opens its settings, and on a small screen the heading collapses
  it. An optional `qualifier` ("perspective scale", "whole road") prints under the label and joins
  it in the row's name (`metricName`), so keep labels short; a row's tooltip carries its name and,
  while only its value shows, its note. `MetricSummaryLayout` puts it beside (`left`) or above
  (`top`) the views; `variant="pane"` fills a tiled pane instead, as hairline-ruled cards of one
  height whose labels wrap rather than truncate. `MetricSummarySettings` is the settings form for the tool's own frame
  (ribbon task pane, dialog), with `MetricSummaryReset` as its footer and `children` for a tool's
  own option; leave out `visibility`/`placement` where a preset decides them.
  `useMetricSummaryPreferences(storageKey, defaults, parse?)` keeps the choices on this device. The
  road designer's Road summary and the visual-quality Viewpoint summary are the references.
- A viewer in another view, on a plan map: `MapViewerCone` (`map-viewer-cone.tsx`) draws a dot and a
  field-of-view wedge from one GeoJSON source, so a moving viewer is one `setData`; the geometry is
  `viewerConeFeatures` and `horizontalFov` in `src/lib/geo/viewerCone.ts`. Round the viewer before
  passing it so the plan does not redraw every frame.

## Mobile sheets

On phones every non-modal sheet over the map belongs to one stack: the layout's
controls sheet plus each `MobileFeatureCard` (feature cards, the feature table,
CANUE graphs). The toolkit's [Mobile sheet stack](../packages/geo-toolkit/API.md#mobile-sheet-stack)
guide covers how a stack looks, how to add a card and how to test one; the
behaviour is summarised in [interface motion](interface-motion.md#mobile-sheet-stack).

- `MapSearchSheet` on `/dev/interact` is a deliberate exception: it is a modal search,
  and it reopens during its own exit, which `DialogShell` cannot do because it reports
  a close only once the exit ends. `interface-motion.spec.ts` pins this.
- New map detail on phones is a `MobileFeatureCard`, normally through
  `ResponsiveFeatureDetail`. Do not add a separate fixed bottom sheet: it sits
  outside the stack and covers, or hides behind, the other sheets.
- Give a card its own `stackId` when it should stack with others rather than
  replace them (`map-feature-table` for the table, `dev-data-feature` for
  `/dev/data` features). Cards that share an id are one sheet.
- Pass `cardKey` for a new selection (front, compact detent) and `focusKey` to
  bring an existing sheet forward without resetting it. `MapFeatureTablePanel`
  passes its layer as `focusKey`, so opening another layer's table from the
  controls brings the table forward.
- e2e: find cards by `[data-map-feature-card-panel="true"]` and header text, check
  `data-stack-role` (`primary`, `secondary`, `docked`), and tap a rear card's top
  strip to swap it. See the phone tests in `tests/e2e/dev-data.spec.ts`.

## Map overlays

- Basemap and overlays: `MapLayersControl` (`map-layers-control.tsx`) is a
  Layers button that opens a small panel on hover, tap or keyboard focus: a
  radio list of `basemaps` (`basemap`, `onBasemapChange`) and a checkbox list
  of `overlays` (`{ id, label, checked, onCheckedChange, description? }`), plus
  any `children`. Put it inside `MapControls` as a child, which stacks it under
  the zoom, compass and fullscreen buttons and opens the panel towards the
  map's middle (`MapControls` now takes `children`). The control only reports
  choices; the page applies them, as a `styles` swap or, where a `setStyle`
  would drop layers, as a raster layer under the labels. Escape or a press
  outside closes it. Clickable legend rows (`LegendItem` `onClick` + `active`)
  stay the place to hide what the page itself draws.

- Chart/panel expansion: `FullscreenPanel` provides a titled frame and full-window
  expansion button; its render child receives the fullscreen state for layout.
  Pass `heading` to put a control (such as a view picker whose value names the
  panel) in the title's place; `title` stays the accessible name and a visually
  hidden heading. Opt into `detachable` for the shared window/tab chooser, synced React portals,
  return/focus controls and lifecycle cleanup. Keep shared model state above the
  panel; local view state remounts on detach/return. Custom frames can use the
  toolkit's `usePanelWindow` and `PanelWindowButton`. The main workspace stays
  open while its detached panels are in use.
  `TiledWorkspace` uses the toolkit's `PanelWindowProvider` / `PanelWindowSlot`
  registry to remove detached panes and empty columns from sizing without
  unmounting them. The remaining views fill the space, and one compact
  `PanelWindowControls` button supplies Show/Return actions.
  A host can wrap its whole workspace in `PanelWindowProvider` and use
  `windowControls="external"` to place that button in its ribbon/header;
  `windowControls="inline"` shares that registry but keeps the button above
  the panes. `TileLayoutPicker` includes detached windows/tabs and their bounds
  in named layouts when it is inside that shared provider. Road design restores
  the selection through `PanelWindowLayoutRestore` even with its picker on an
  inactive ribbon tab.
  Opt into `compact` for a single-row header with smaller chrome and truncated
  long titles. `FullscreenButton` also accepts `compact` for a 32px icon button.
  `useElementFullscreen` and `FullscreenButton` support an existing dashboard
  frame. The content stays mounted; Escape or the exit button restores it.

- `MapFillLayer` accepts `interactive={false}` (fixed at mount), as
  `MapLineLayer` does: no click or hover listeners. Use it for drawn-only fills
  on a 3D-terrain map, where each hover query is a synchronous GPU readback.

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

- Satellite basemap: `IMAGERY_BASEMAPS` and `SatelliteImagery`
  (`map-satellite-imagery.tsx`) are the Map / Satellite choice the forestry
  visual-quality maps and the road-design plan share. Pass `IMAGERY_BASEMAPS` to
  `MapLayersControl`'s `basemaps` and render `<SatelliteImagery visible />`
  inside the map: Esri World Imagery as a raster layer under the basemap's
  first label layer, capped at z18, re-added on `style.load`. Never a `styles`
  swap, which `setStyle`s away every layer a page added.
  `useStoredImageryBasemap(key)` remembers the choice in this browser.

- Drawing and measuring on a map: `src/lib/geo/mapSketch.ts` holds the rules
  (DOM-free, unit-tested) and `map-sketch.tsx` the map side, lifted from
  `/dev/interact`. A polygon closes on a click on its first point (within
  18 px), a double-click or Finish once it has three points; a line finishes on
  a double-click or Finish; a circle takes its centre, then its edge. Vertices
  are numbered markers, a dashed rubber band runs to the pointer (and back to
  the first point once a polygon can close), Undo/Redo take points back.
  - **Measure tool.** `useMapSketch()` keeps the sketch; render
    `<MapSketch sketch />` inside the map and `MapMeasurePanel` (a
    `MapToolPanel`: Distance / Area / Circle, the values, Undo / Redo / Finish)
    where the page's tool cards go. `MapMeasureControl` is a Measure button for
    `MapControls`; `useMeasureKeys` gives Escape, Backspace and Enter.
    `/dev/interact` keeps its phone sheets through `MapMeasureOverlay`.
  - **Drawing a polygon the page keeps** (a block, an avoidance area, a
    retention patch): keep the draft in the page and render
    `<MapSketchDraft shape="polygon" points onAdd onFinish />`, which captures
    the clicks and tracks the pointer itself so the page's other layers do not
    re-render on every move. `onFinish` is the page's own Finish (parse the
    ring with `sketchPolygon`, commit, clear the draft). Where the page's own
    click handler must keep placing points (the road plan, so a pick or a note
    can still take the click), use `MapSketchLayers capture={false}` to draw it
    and close with `nearFirstVertex` / `canFinishSketch` in that handler.
  - While a sketch is drawing, the page's own click actions stand aside
    (selecting, adopting, inspecting, moving the road view): a vertex click must
    do nothing else. Read areas with `sketchStats` and print them with
    `formatSketchArea` / `formatSketchDistance`.

- Tool cards: `MapToolPanel` (`map-tool-panel.tsx`) is the card a map tool shows while it
  is in hand (pegging, extending, sketching, measuring a point). It floats over the map, so
  starting a tool moves nothing: a header with the tool's name, its explanation behind an (i)
  (`help`) and a close button naming its key; an optional one-line `hint` (what to click); the
  tool's fields and readouts (`ReadoutGrid`) as children; a `status` line; and `actions` in a
  footer with the primary action last. Don't put a tool's live state in a banner above the map
  or repeat it in a sidebar with a second Finish button. The host positions the card.
- Overlays: `MapOverlay` (`position`). Pass `clearChrome` rather than writing
  your own `calc(…)` offsets: it keeps clear of the phone toolbar above, the
  bottom sheet, safe area and timeline below, and the corner controls and
  legend. A `className` inset still overrides it.
- Playback: `PlaybackControls` steps through frames; `mode="continuous"` seeks a
  position the page's own animation loop advances (metres along a road), with
  `skip`/`skipLabel` steps, `canPlay`, `valueLabel` and an `actions` slot. The
  visual-quality road view is the reference.
- Colours a person picks: `ColorField` (`value`/`onChange` with `null` for
  unset, `presets`, `presetDisplay="picker"` in a dense row, `size="sm"`). Unset
  is drawn striped, never as white.
- Scale: `MapScaleBar` (`map-controls.tsx`, `position`, `maxWidth`), a metric
  bar measured great-circle across the map's middle (so Mercator's stretch at
  our latitude, 1.7×, is not read off the zoom), in the app's theme. It hides
  itself on a map pitched past 60°. Any page reporting areas or distances
  should show one.

- Legends: `MapLegendPanel` with `defaultCollapsed="mobile"` (or the same rule
  for a controlled legend: `useState(isMobileViewport)`), `LegendItem`,
  `MapGradientLegendItem`, `MapSteppedLegend`, `MapSizeLegend`.
  Keep a layer's colour ramp in one constant that both the layer and its
  legend read. Size the panel with its `width` prop (`sm`, `md`, `lg`, `fit`),
  not a `className` width, `100vw` or `md:` breakpoint: the widths follow the
  map rather than the viewport, and a collapsed panel shrinks to its title. Don't
  fix a width on the content either (`md:w-56`); it overflows the panel's
  padding. MapLibre's attribution keeps the bottom-right corner and the panel
  sits on top of it (the map publishes the attribution's height as
  `--map-bottom-right-controls-height`, the panel publishes its footprint as
  `--map-legend-panel-visible-height`), so opening a legend moves nothing below
  it; anything else in a bottom corner stacks above both. Zoom and compass stay
  top right on phones too, below the floating toolbar. The legend clears a
  mounted timeline by itself; `elevated` is deprecated and does nothing. Don't
  render a panel that only says its layers are off: drop it, unless its rows
  are the only way to turn those layers back on.
- Timelines: `Timeline` (`src/components/ui/timeline.tsx`) adapts the
  toolkit's `MapTimeline` to the date props pages already pass. New pages can
  use `MapTimeline` with `buildTimelineBuckets`, `timelineBucketKey` and
  `timelineWindow` from `@pgmaps/geo-toolkit/calculations` directly, and filter
  their records with the same window the timeline highlights. It sizes itself
  from its own width, so don't wrap it in viewport breakpoints. With 12 or fewer
  buckets it turns into a compact picker and hides controls that do nothing at
  that length, so pass your full option lists and let it drop them.
- Our Tailwind utilities inside a map workspace: `postcss.config.js` gives each
  generated utility a second `.geo-toolkit`-prefixed selector
  (`scripts/postcss/workspace-utilities.js`). Without it the toolkit's scoped
  `.geo-toolkit .hidden` outweighs our `md:block` on our own markup inside a
  workspace, and responsive classes there silently stop working.
- Popup / floating detail content: `MapPopupCard` (`map-popup-card.tsx`) with
  `KeyValueRows` inside.
- Hover tooltips: `MapTooltipCard` (`map-tooltip-card.tsx`) for React content;
  `mapTooltipHtml({ title, subtitle, lines, rows, footer })` for layer `hoverHtml`
  and imperative MapLibre/deck.gl popups. Pass plain text; the helper escapes
  all content and skips empty rows (keeping zero). Both share the themed surface,
  padding, border, shadow and wrapping. `.mapcn-tooltip` removes MapLibre's own
  chrome, so bare HTML there has no card. `MarkerTooltip` uses this surface too.
- Phone peek text: `mobilePeekTitle` / `mobilePeekSubtitle` on
  `MapSectionLayout`, parts separated with `·`.
- Icon markers: `MapIconButton` (`map-icon-button.tsx`) is the square button a
  `MapMarker` draws, with `tone` colours. Give it an SVG icon rather than a text
  glyph: a glyph's position comes from its font's metrics, so it does not centre,
  and it sizes the box to itself.

## Settled map observation and HTML-marker clustering

`map-viewport.ts` exports `MapViewportSnapshot` (`bounds` in west/south/east/north
order, `zoom`, canvas `width` and `height`), `readMapViewport`,
`observeMapViewport`, `useObserveMapViewport` and `useMapViewport`.
The observer returns exact unsubscribe cleanup. Defaults are `load`, `moveend`,
`zoomend` and `resize`, with an initial publication only if the map is loaded.
Callers can override `events` and `initial`; hooks also accept `enabled` and a
`refreshKey` to republish for a changed filter or calculation configuration.
Callback changes do not create duplicate event subscriptions. Use this for
settled viewport calculations, while per-frame drawing stays on its specialized
map/canvas path.

`screen-point-clusters.ts` exports `clusterScreenPoints` and
`useScreenPointClusters` for projected HTML markers. Supply ID/coordinate
accessors, pixel radius, optional ascending priority, padding and ID prefix.
The pure helper accepts a projection and viewport; without projection it returns
singletons in input order. Both preserve original records in each cluster.
ER and specialist maps share this mechanism while retaining different marker
content, priority and expand/reveal actions. This differs from source-based
`MapClusterLayer` clustering.

Use existing toolkit `pointBounds`, `fitMapToPoints` and `geometryBounds` for
fitting where appropriate, passing each app's own padding/span/zoom policy.

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
- `jsonGuards.ts`: `object`, `strictObject`, `text`, `bool`, `int`, `oneOf`, `list`,
  `optional`, `distinct` for parsing served configuration or browser storage by hand. Each throws
  an Error naming the field; there is no schema library in the browser bundle.

## Shared application behavior

- `src/hooks/useFetchData.ts`: static JSON loading, optional/fallback URLs,
  in-flight deduplication and retry. Cached transform exceptions become error
  state just like asynchronous failures. Repeated retry attempts rerun, and a
  superseded request cannot refill a retry-invalidated cache. Keep source
  validation in transforms and preserve development-only dataset gating.
- `src/features/walkability/WalkabilityFactorControls.tsx`: factor rows and report
  options shared by MISC and Index Lab. The factor catalog, dropped-term rules,
  direct-control and reset policies stay with the walkability feature.
- `src/maps/nechako/data/usePortalWorkspace.ts`: the two portal interfaces share
  session-bound workspace lifetime and local-vector styling. Navigation and
  source/session transports remain domain-owned.
- `src/pages/dev-lidar/coloredVertexLayer.ts`: mesh/point GPU lifetime is shared;
  source vertices, shading and shader/draw-mode choices stay with each tool.
- `PaginationControls` takes optional `previousLabel`, `nextLabel` and
  `formatPage(page, pageCount)` for existing preview/table conventions. Page
  indexes are zero-based; the caller owns the page size and current-page bounds.

See [implementation coverage](shared-component-implementation.md) for the
completed audit migrations and verification record.

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

## Chart dashboards

Use toolkit `/ui` exports `DashboardToolbar` for a compact title/control row,
`RangeControls` for controlled date/numeric input fields and host-defined presets,
and `SeriesLegend` / `SelectedSeriesList` for stable series colors and visibility.
`DashboardToolbar` observes its own container width (default inline threshold
1000px); narrower containers wrap controls. Selection and color assignment remain
host-owned. Hiding a series and removing its selection have separate callbacks.

Use `/visualizations/react` for `TimeSeriesChart` (linked numeric brush/drag
range), `LineBandChart` (lines and supplied bounds), and `ScatterPlot` (high-DPI
canvas, point hover and local XY zoom). `ChartViewport` measures a host-defined
height slot. `XYPlot` also supports controlled zoom and supplied plot insets for
custom renderers. Axis units, tooltip content, calendars and calculations belong
to the host. See the toolkit API guide and independent consumer's `/charts` page.
