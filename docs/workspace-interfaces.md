# Workspace interfaces

A tool with workspace interfaces lets the person choose how its controls are arranged (a guided
sidebar, a tabbed ribbon, a dashboard) without the tool becoming two tools. Each interface is an
arrangement of the same commands, the same panels and the same project. Two tools use it:

| Tool | Layout file | Kit | Interfaces |
| --- | --- | --- | --- |
| Road design (`/dev/forestry/road-design`) | `public/workspace-layouts.json` | `src/pages/dev-forestry-roads/interface/roadKit.tsx` | Ribbon, Guided map, Guided mode, Dashboard |
| Visual quality (`/dev/forestry/visual-quality`) | `public/visuals-layouts.json` | `src/pages/dev-forestry/interface/visualsKit.tsx` | Guided mode, Ribbon |

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
