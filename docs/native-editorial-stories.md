# Native editorial story authoring

`pgmaps-editorial-v1` is the native JSON document format inside the existing
`story-map-v1` workspace. It composes the same cover, navigation, sidecar, tour,
carousel, expansion and map-reveal components used by the Prague reconstruction.
PGMaps retains its app header and project-folder navigation.

The working example is `/dev/projects/example-native-editorial`, in the
**example** folder. Its document is
[`native-example/story.json`](../public/data/story-documents/native-example/story.json)
and its wrapper is
[`example/native-editorial.json`](../public/data/projects/example/native-editorial.json).
Regenerate its app-owned content with `node scripts/generate-native-editorial-example.mjs`.

## Package and document

Set `workspace.document` in an ordinary story package:

```json
{
  "schema": "pgmaps-editorial-v1",
  "data": "/data/story-documents/my-story/story.json"
}
```

Keep the wrapper's required catalog metadata, scenes, map, layers and places
fields. The wrapper's layers/places may be empty: the document supplies its map
definitions. Ordinary `workspace.options.layout` does not control document
blocks. Assets/documents live outside `public/data/projects`; register only the
wrapper and run `npm run projects:index`.

The document root has `schema`, `title`, optional `cover`, `categories`, `maps`,
`views`, `diagrams`, `actions` and ordered `chapters`. Each chapter has a unique
`id`, `title` and `blocks`. Empty registries are `{}`; empty categories are `[]`.
IDs for chapters, blocks, steps and stops must start with a letter and contain
letters, numbers, `_` or `-`, and be unique across the document.

The TypeScript types are in
[`model/types.ts`](../src/maps/project-story/editorial/model/types.ts).
[`model/validate.mjs`](../src/maps/project-story/editorial/model/validate.mjs)
is shared by runtime parsing and the Node package audit. Run:

```sh
node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs public/data/projects/example/native-editorial.json
```

## Blocks and media

| Type | Required fields beyond `id` / `type` | Behavior |
| --- | --- | --- |
| `paragraph`, `heading`, `quote` | `text: Inline[]` | Semantic prose; `heading` renders an h3 under the chapter's h2 |
| `list` | `items: Inline[][]` | Bulleted content |
| `separator` | None | Reading break |
| `image` | `src`, `alt` | Optional `caption`, `credit`, `expandable` |
| `carousel` | `items: ImageMedia[]` | Previous/next image controls |
| `map` | `mapId`, `viewId` | Native PGMaps map and legend |
| `comparison` | `mapId`, `leftViewId`, `rightViewId`, `leftLabel`, `rightLabel` | Two synchronized views; shared source loading and reveal slider |
| `diagram` | `diagramId` | Optional `stepId` selects a dot-diagram step |
| `sidecar` | `presentation`, `steps` | `docked` / `floating`; `side` left/right/center and `width` medium/large; center is floating-only |
| `tour` | `mapId`, `stops` | Numbered map/photo stops, scroll and arrow selection |
| `credits` | `text: Inline[]` | Source and author text |

`cover` accepts `title`, optional `summary`, `byline`, `poster`, `video`. A poster
creates an image cover; video adds reduced-motion-aware playback controls.
Native story surfaces follow the app's light/dark mode. The native format does
not currently expose a document-specific theme override.

An `Inline` is a string, or `{text, strong?, emphasis?, href?, actionId?}`.
Links accept HTTPS, local absolute paths or `mailto:`. Media/data accept local
absolute paths or HTTPS. Text remains React text; JSON does not execute HTML,
CSS, JavaScript or expressions.

Each sidecar step has `id`, `content: CopyBlock[]`, and `media`. Copy blocks are
paragraph/heading/quote/list/separator. Media is image/map/comparison/diagram,
without a block ID. A sidecar's map steps retain one `mapId`. Images and diagrams
can replace the media slot; changing media type naturally changes its component.
Nested sidecars/tours are rejected. The editorial component supports scroll
sidecars, not a new native-document slideshow mode; ordinary scene packages
continue to offer `sidecarVariant: "slideshow"`.

Each tour stop has `id`, `label`, `coordinates: [longitude, latitude]`, `viewId`,
image `media` and prose `content`. Map markers, numbered controls, arrows and
scrolling share the active stop. Use the image's caption/credit for provenance.

## Maps, views and interactions

A map definition contains `layers`, `attribution` and optional
`categoryProperty`. Layers reuse `ProjectStoryLayerDef` for GeoJSON polygon/point
and polygon PMTiles sources, including attribute joins. Native editorial maps
do not yet support the climate-grid transport; use the existing native scene
renderer for climate stories. ArcGIS WebMaps retain their imported document
adapter rather than being disguised as native layer data.

A view has `mapId`, required `camera` and `visibleLayerIds`. It can supply
`highlights`, `legend` and per-layer `fillOpacity`, `lineOpacity`, `lineWidth`
overrides. Cameras use the shared scene pane-fitting rule. Native editorial
view overrides do not currently accept per-view category recoloring.

`categories` is a list of `{id, label, color}` with six-digit hex colors. With
`categoryProperty`, a map uses that registry for category colors and selecting a
feature selects its matching category. Diagram selection and map selection
share the same category state. A selected category dims unmatched map features.
Without that binding, the layer retains its own authored palette. Views without
an explicit legend use the category registry as their legend.

Inline `actionId` references one of:

```json
{
  "select-cariboo": { "type": "select-category", "categoryId": "5950" },
  "clear-selection": { "type": "select-category", "categoryId": null },
  "zoom": { "type": "set-map-view", "targetId": "region-sidecar", "viewId": "cariboo" },
  "continue": { "type": "go-to-chapter", "chapterId": "diagrams-chapter" }
}
```

View actions target a map block, sidecar or tour and must reference a view of
that target's map. They persist for that target until another view action
replaces them; they do not scroll the story. Category selection persists through
chapters until changed/cleared. Chapter actions explicitly scroll. No rendering
callback redispatches an action, preventing selection loops.

Nearby map regions mount on approach and release their canvases when distant.
Sidecar/tour steps retain their map while the region is active. Camera snapshots
for the region and authored camera survive re-entry. Returning to a saved view
on the live canvas animates just like a first visit; a newly mounted canvas
restores its saved camera immediately. Reduced-motion preferences disable camera
animation. Comparison shares one source store and synchronizes camera movement;
the reveal changes clipping,
not map dimensions. Both sides use the same map definition and different views.
The reader can select features from the revealed side.

## Data-driven diagrams

### `radial-hierarchy`

Fields: `title`, `description`, and `nodes: {id, label, parentId?, categoryId?}[]`.
The validator requires a single rooted, acyclic tree with existing parents and
1–300 nodes. Authored sibling order is preserved. D3 computes radial cluster
geometry; React renders SVG and a nested, keyboard-operable selection list.
Selecting a category highlights its node and ancestor path, as well as bound
maps. Layout geometry is deterministic and does not encode population or
analytical distance. Provide a description explaining the relationship.

Do not force many-to-many economic/health crosswalks into a hierarchy. The
example shows only economic regions belonging to British Columbia.

### `category-dots`

Fields: `title`, `description`, `mode` (`illustrative` / `measured`), `unit`,
`points: {id, x, y, categoryId}[]` and `steps`.
Coordinates are normalized 0–1; 1–1,000 points are supported. IDs and categories
must be valid. Positions are authored once and remain unchanged between steps
and screen sizes. The example generator uses a deterministic grid.

Each step has `id`, `label`, optional `categoryIds` and optional
`region: {x,y,radius}` in normalized coordinates. Region and category filters
combine with AND. Step counts describe all included points; category selection
dims points without changing that step's denominator. A circle in normalized
coordinates is drawn as an ellipse when the SVG axes have unequal scales.
The renderer supplies counts and controls, not an inferred diversity index.
Measured inputs must explain the unit/source; illustrations are visibly labeled.
Use `stepId` in successive sidecar media slots to drive the explanation.

The original Prague hierarchy/dot images remain intact: their underlying data
was not supplied. The new charts demonstrate reusable behavior without claiming
to reconstruct the original quantitative data.

## Shared presentation and extension

`EditorialShell` owns viewport measurement, app-integrated project controls and
chapter navigation for both native and imported documents. Each format adapts
its own content into the shared components. Native JSON does not generate an
ArcGIS node graph, and the original source graph remains available for fidelity
and provenance. Imported subtype/placement checks now reject unsupported
immersive layouts, tour layouts, text variants and standalone body video.

Generic diagram components live under `src/components/ui/diagrams`; pure layout
and point selection live in `src/lib/diagrams/storyDiagrams.ts`. The native map
surface uses `useStorySources`, `resolveLayer`, `paneZoomOffset` and shared PGMaps
map layers. It does not mount a whole nested `ProjectStoryMap`.

To add a block or source capability, update types, shared validator, renderer,
this contract, skill reference and a working example together. Keep unimplemented
options out of packages. Tests should check real map layers/selections, stable
canvases, keyboard/touch behavior, and desktop/phone layouts. Imported fidelity
and live remote-service checks remain separate from native document validation.
