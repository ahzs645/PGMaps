# Forestry tool standard

What every tool under `/dev/forestry` shares, and where a tool may differ. Reach for
these first; when one cannot express what a tool needs, add an opt-in prop in
`packages/geo-toolkit` rather than writing it locally. See [shared UI](shared-ui.md)
for the full catalogue.

## Every tool

| Need                 | Use                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab title            | `useDocumentTitle('<Tool> · PGMaps')`, matching the tool's `h1`                                                                                                |
| Hub card name        | The tool's `h1` exactly, in `DevForestry.tsx`                                                                                                                  |
| Way back to the hub  | `ForestryBackLink`: `icon` in a sidebar or workspace header, `text` on a scrolling page                                                                        |
| Local files          | `FileDropField`. It does not filter drops by `accept`; a tool that needs only some types filters in `onFiles`. An import of one file passes `multiple={false}` |
| A numbered procedure | `TabBar` with `StepMarker` when steps are long; `StepSection collapsible={false}` when they fit on one screen                                                  |

## The three tool shapes

A tool picks the shape its work needs. These are deliberate, not drift to remove.

- **Map with a sidebar** (Restoration, THLB, AVAST, Visual quality, CCISS):
  `MapSectionLayout` + `MapSidebarShell density="compact"` + `MAP_SIDEBAR_CLASS`.
- **Scrolling page** (Castor, Drought risk): `ToolPageHeader`, with content in cards.
- **Engineering workspace** (Road design): `ResizableSplit` panes around a dense
  sidebar. It has its own type scale because it shows many linked views at once; do not
  copy that scale into the other shapes.

## Maps

Every map is the toolkit's `Map` from `@/components/ui/map`. A tool keeps its own look
through props, not through its own map code:

| Own look                | Through                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Basemap                 | `styles`                                                                |
| Controls                | `controls={WORKSPACE_MAP_CONTROLS}` by default, or a tool-specific set  |
| Elevation, relief, 3D   | `MapTerrain`, with the tool's own `dem`, `sky` and `terrainGroundColor` |
| Data                    | `MapFillLayer`, `MapLineLayer`, `MapCircleLayer`, `MapRasterLayer`      |
| One georeferenced image | `MapImageLayer`, with `id` if something has to look the layer up        |
| A painted canvas        | `MapCanvasLayer`                                                        |

`map.addSource` and `map.addLayer` in a tool are a sign a toolkit layer is missing.
These remain on purpose:

- `dev-forestry/treeLayer.ts` is a MapLibre custom layer that needs the renderer's own
  matrix; `ForestOverlay.tsx` mounts it. See the Forestry visual quality notes in
  `AGENTS.md`.
- `dev-forestry-roads/PlanView.tsx` builds its alignment, terrain and selection layers
  as one ordered group with shared visibility rules. Moving them needs its own pass
  against the road e2e suite.
- `cciss/NativeSuitabilityLayer.tsx` registers a tile protocol, which the toolkit does
  not wrap. Its layer is a `MapRasterLayer`.
- `dev-lidar` uses the toolkit `Map` through `LidarMap.tsx` and keeps its own layers, added
  in `onMapCreate`. They depend on insertion order and anchors, and `basemaps.ts` switches
  the basemap in place, so the style stays fixed for the map's life. `maplibre-gl-lidar`
  brings its own deck.gl 9.4, which must stay apart from the toolkit's.
  Relief uses `MapTerrain reliefOnly`, because that package owns the map's 3D terrain.

## Candidates to share next

Road design stays as it is, but these parts are general. Move one into the toolkit when
a second tool needs it, not before:

- Screen presets with saved layouts (`LayoutPicker.tsx`, `RoadPaneLayout.tsx`).
- The `<preset> · edited` pattern, for any preset a person can adjust.
- `planLegendModel.ts`'s split of legend data from legend rendering.
