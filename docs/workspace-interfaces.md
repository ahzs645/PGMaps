# Workspace interfaces

A tool with workspace interfaces lets the person choose how its controls are arranged (a guided
sidebar, a tabbed ribbon, a dashboard) without the tool becoming two tools. Each interface is an
arrangement of the same commands, the same panels and the same project. Three tools use it:

| Tool                                            | Layout file                          | Kit                                                  | Interfaces                                 |
| ----------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------------ |
| Block planning (`/dev/forestry/block-planning`) | `public/block-planning-layouts.json` | `src/pages/block-planning/interface/`                | Guided mode, Ribbon, Guided map, Dashboard |
| Road design (`/dev/forestry/road-design`)       | `public/workspace-layouts.json`      | `src/pages/dev-forestry-roads/interface/roadKit.tsx` | Ribbon, Guided map, Guided mode, Dashboard |
| Visual quality (`/dev/forestry/visual-quality`) | `public/visuals-layouts.json`        | `src/pages/dev-forestry/interface/visualsKit.tsx`    | Guided mode, Ribbon                        |

The road designer's guide to its own file is
[forestry-road-design/workspace-layouts.md](forestry-road-design/workspace-layouts.md); the
format and the renderers described there are this kit's, so everything it says about sections,
`primary`, `more`, `rows`, the compact ribbon, Find tools, Customize ribbon and the header strip
holds for every tool.

## What is shared and what each tool brings

The shared pieces live in `src/components/interfaces/` and name no tool:

- `workspaceKit.tsx`: the `CommandDef` shape, `CommandState`, `resolveCommandIn`, the
  `WorkspaceKit` a tool hands its renderers through `WorkspaceKitProvider`, the default header
  groups and the layout icons.
- `workspaceLayoutSchema.ts`: the layout file's types and its hand-written parser. A tool passes
  its vocabulary: icons, command IDs, widget IDs, its workflow `editors`, its screen `presets` (the
  first is the default) and the named tool lists a section can `collect`. `resolveToolbar`
  expands those lists.
- `layoutCatalog.ts` reads a tool's file and falls back to its built-in layout; `interfacePreference.ts`
  (`interfacePreferences(storage, defaultId)`) decides which interface opens: `?interface=`, then
  the one this browser last used for this tool, then the tool's default.
- `useWorkspaceLayout` (the interface in use, its screen preset per interface, the controls'
  collapse), `useWorkflowPlacement` (which workflow editor shows, and whether it is in the sidebar
  or a ribbon tab's task pane), `useRibbonPreferences` (personal ribbon arrangements).
- The renderers: `CommandButton`, `CommandMenu`, `WorkspaceTools` (ribbon or side guide),
  `WorkspaceHeader` (the two-line header), `InterfaceChooser`, `CustomizeRibbonPane`,
  `RibbonFinder`, `RibbonTaskPane` / `RibbonPaneColumns` / `RibbonPaneHost`.
- `workspaceFrame.ts`: `workspaceFrameProps(active)` puts the interface's panel canvas
  (`panelFrame`) and dock on the workspace root, which carries the `lp-workspace` class the shared
  styles (`workspaceFrame.css`, `interfaces.css`, `workspaceHeader.css`, `panel-corner.css`) read.

A tool brings, in its own folder:

- a command registry: one entry per command (label, icon, optional description, `altLabels`,
  `kind`, `editor`), every icon its own (a test per tool pins it);
- a layout vocabulary and loader (its widgets, editors, presets and collections) and its layout file;
- a `WorkspaceKit`: its `storage` name (browser keys are `pgmaps-<storage>-…`), the registry,
  widget captions, which widgets are ribbon fields, and optionally its brand, lesson anchors,
  help link, header groups and phone header tools;
- in its page: one handler and one `CommandState` per command, one node per widget, and the
  editors' content, portalled into the stable `editorHost` that `useWorkflowPlacement` returns, so
  an editor keeps its state when it moves between the sidebar and a task pane.

Commands that mean the same thing in both tools share an ID (`controls`, `open`, `export`,
`chooseInterface`, `customizeRibbon`, `fullscreen`), so their header group and phone placement
come from the defaults.

## Rules

- Never import one tool from the kit. A tool's names go through its `WorkspaceKit` or its
  vocabulary; `road-design:check-boundary` holds the road designer to it, and the kit must stay
  usable by a tool that is not the road designer.
- Render a registry command only through `CommandButton`, wherever it appears. A page keeps its own
  forms; it does not hand-build a second button for a command the registry has.
- Opening a tool never stops at the chooser, and a link's `?interface=` is rewritten to the
  interface chosen (`storeInterface`), so a reload opens what was chosen.
- An interface only arranges. Switching keeps the project, the run, the selection and the edit
  history; nothing a person made is stored per interface. Screen presets and ribbon arrangements
  are browser preferences, kept per tool and per interface.
- A layout file is fetched network-first (`public/sw.js`) and listed in its tool's offline group
  (`vite.config.ts`, `extras`). An entry that fails validation makes the whole file fall back to
  the tool's built-in layout, with the reason in the console.

## Adding an interface to a tool

Add an entry to the tool's layout file. A ribbon (`toolbar.dock: "top"`) with `header: "controls"`
takes the header's place; give each workflow editor one tab (`editor`, optionally `editorTitle`,
the task pane's title) and the tab's **All settings** opens that editor in the task pane beside
the views. An entry without a toolbar keeps the editors in the sidebar and draws the two-line
header from `headerTools`. Add a preview picture under `public/interface-previews/` for the
chooser, or the layout's icon stands in.

## Adding a tool

1. Write its registry, vocabulary, loader and kit beside the tool (visual quality's four files in
   `src/pages/dev-forestry/interface/` are the smallest example).
2. Load the layouts before the page renders and wrap it in `WorkspaceKitProvider`
   (`ForestryVisualsWorkspace.tsx`).
3. In the page, call `useWorkspaceLayout`, `useRibbonPreferences` and `useWorkflowPlacement`;
   render `WorkspaceHeader` or `WorkspaceTools` from the active layout; give the root
   `lp-workspace` and `workspaceFrameProps(active)`; wrap the views in `RibbonPaneColumns` under a
   `RibbonPaneHost.Provider`; portal the editors into `editorHost` and mount `attachEditor` where
   the sidebar should hold them.
4. Network-first and offline: add the file to `public/sw.js` and to the tool's `offlinePrecache`
   group.

## How the kit came to be shared (20 November 2026)

The ribbon, header and chooser were written for the road designer and imported its registry,
field captions, lesson anchors, brand and storage keys directly. They were made tool-neutral in
two steps: the road's vocabulary moved to `src/pages/dev-forestry-roads/interface/` behind
`ROAD_KIT`, with every browser key (`pgmaps-road-*`) and every lesson anchor unchanged, and
visual quality became the second tool on the kit. The header's and panel frame's styles moved
from the road's `workspace.css` to the kit, keyed on `.lp-workspace` (the road's root carries both
`lp-workspace` and `road-workspace`; the header's class names keep their `road-` prefix because
the road's tests and lessons read them).

What changed in the shared pieces, for anyone extending them:

- `LayoutVocabulary` gained `editors`, `presets` and `collections`; `LayoutGroup` gained
  `editorTitle` (the task pane's title, else "<label> settings").
- `useWorkflowPlacement(layout, investigation, defaultEditor)`; its `selectWorkflow(editor,
{ reveal: false })` changes the tab without opening or closing the pane.
- `useWorkspaceLayout(initial, { defaultPane, storeInterface, legacyPresetKey })`.
- `WorkspaceHeader`'s `roadSwitcher` prop is now `crumb`; `RibbonPaneColumns` takes `viewsLabel`
  for its divider's name.
- `ToolbarPopover` gained an opt-in `caption`, for a popover button placed in a ribbon group.

## Known limits

- **Pop-out panels in visual quality.** The road designer's panels open in another window or tab;
  visual quality's do not yet. Moving the road view to another window would rebuild its map, its
  terrain and any external engine (the 1.4 s reload the page's `roadViewHeld` exists to avoid), so
  it waits for a design that keeps them.
- **Visual quality's Ribbon on a phone.** The ribbon keeps its tab row and opens a step in a side
  sheet, but the plan map's tool column is taller than the map pane at 390 × 844 and its last
  tools need the pane enlarged. Guided mode, the default, keeps the phone sheet as before.
- **Corner grips in visual quality.** Only the plan map has one. The road view's pane has none: the
  grip's 20 px reserve pushed the road view's bar into its status card at 1280 × 720.
- **Find tools in visual quality** searches the ribbon's commands and every step's sections (each
  step panel is a `data-workflow-editor`); it does not search the road view's own bar or popovers.
