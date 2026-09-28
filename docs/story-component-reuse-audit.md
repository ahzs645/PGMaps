# Story presentation reuse audit

Reviewed 2026-09-27 against the local Prague document, its renderer, the eleven
packages in `public/data/projects/example`, and their tests. This is an inventory
of implemented capabilities and remaining authoring gaps, not a proposed schema.
The authoritative configuration contract is [project-map-stories.md](project-map-stories.md).

## Implementation follow-up

The gaps below describe the original audit. Native authoring and both diagram
components are now available through `pgmaps-editorial-v1`; see the
[native editorial contract](native-editorial-stories.md) and
`example-native-editorial`. There are now twelve example packages. Prague and
the native example share `EditorialShell` and the presentation components.
Original source images remain unchanged. Consult the current contract for
supported transports and options; this historical inventory is not the schema.

## Finding

The Prague presentation is reusable at the React component level. Its cover,
chapter navigation, sidecars, tours, carousels and media expansion accept content
props or React slots; they do not contain Prague coordinates, node IDs or asset
paths. Maps use the shared PGMaps MapLibre stack. New content does not require
copying the Prague page or replacing the PGMaps header.

Not every component is available through the ordinary scene JSON contract.
There are currently three ways to reuse this work:

| Authoring route | Available today | Boundary |
| --- | --- | --- |
| Native `story-map-v1` scenes | Panel, scrolly, slides, docked/floating/slideshow sidecars, map actions, comparison, relationship controls | Scene JSON does not describe arbitrary images, carousels, photo tours or video covers. |
| `workspace.document` | The complete imported editorial sequence, original media, tours and map actions | Requires `arcgis-story-document-v1` graph/resources and supported WebMap data. Setting ordinary `workspace.options.layout` does not restyle this document. |
| React composition | Exported editorial components with arbitrary media and map slots | Requires developer composition, the editorial stylesheet, a bounded scroll root, viewport measurement and caller-owned map/selection state. |

## Every section of the Prague example

Counts below describe the supplied local document, not a limit on future stories.
It has seven navigation entries, three sidecars with eighteen slides, four tours
with fifteen stops, fifteen carousels and four comparison swipes.

| Example section or presentation | Implementation | Reuse and limitation |
| --- | --- | --- |
| Opening video, title, subtitle and byline | `StoryCover` | Reusable video or poster cover; play/pause, reduced motion and start-reading action. The imported `Cover` adapter reads the cover's child video resource. |
| Sticky chapter navigation | `StoryChapterNavigation` | Supply chapter IDs/labels, active ID and selection callback. The caller owns observing sections and scrolling to them. |
| Introductory prose, headings, quotes, lists and separators | `SafeRichText` plus `StoryBlock` and editorial CSS | Reusable through the document adapter; these are not all independent exported content-block components. Direct compositions can use semantic markup in the content slots. |
| “What is urban diversity?” | `StoryTour`, `StoryCarousel`, `EditorialMap` | Four photo stops with numbered/map/scroll selection. The tour layout accepts any map through `renderMap`; the imported map wrapper accepts WebMap resources. |
| “Urban patterns of Prague” | `StoryImage` | The circular taxonomic tree is a supplied image. The figure layout is reusable; generating an interactive radial hierarchy from another dataset is not implemented. |
| “Description of individual branches…” | `StorySidecar`, docked/left/medium, plus `EditorialMap` | Seven scroll-linked map slides. Reusable content/media slots; consecutive compatible map children retain the map instance. |
| “What do they capture?” | `StorySidecar`, docked/right/large, plus `EditorialSwipe` | Four historical/current comparisons. `MapSwipe` supplies the reusable divider; `EditorialSwipe` supplies MapLibre camera and popup coordination for imported maps. |
| “Diversity of urban structure” | `StorySidecar`, floating/center/large | Seven centered illustration/prose slides. Replace the image slots for another explanation. The colored-dot illustrations are assets, not a data-driven diagram generator. |
| “Three different views of the city” | Three instances of `StoryTour` with `EditorialMap` | Pedestrian, cyclist and driver tours have six, three and two stops. No transport mode is hardcoded into the tour component. |
| Expandable photographs and image galleries | `ExpandableMedia`, `StoryCarousel`, internal `StoryImage` | Expansion and carousel are exported. Caption, attribution and width handling remain in the imported image adapter. Carousel navigation is bounded buttons; it does not implement a general touch-swipe gallery. |
| Inline “look closer” map actions | `SafeRichText` action callback and `EditorialStory` action state | Reusable for supported imported actions. Native scenes separately offer `mapActions` for camera/layer changes. |
| “Author team”, source links and publisher credit | `StoryBlock`, `PublisherCredit` | Content comes from the document; publisher identity stays in credits. No exported general `StoryCredits` component yet. |
| PGMaps header and return to project folder | App navbar, project toolbar, shared `ProjectBackButton` | App navigation remains outside story content. Use the project workspace to inherit folder navigation. |

Component exports are in
[`editorial/components/index.ts`](../src/maps/project-story/editorial/components/index.ts).
Imported content mapping is in
[`EditorialStory.tsx`](../src/maps/project-story/editorial/EditorialStory.tsx).
The shared reveal control is
[`map-swipe.tsx`](../src/components/ui/map-swipe.tsx).

## Other presentation examples in the folder

These already work through native project JSON, without an imported document.

| Example slug | Reusable setting |
| --- | --- |
| `example-docked` | `workspace.options.layout: "panel"`; desktop sidebar and mobile bottom sheet |
| `example-slides` | `layout: "slides"`; map over slides with arrows, dots and touch swipe |
| `example-scrolly` | `layout: "scrolly"`; scrolling cards and mobile Explore map / Read story |
| `example-comparison` | Scene `interaction.type: "choices"`; switch named map views |
| `example-relationships` | Scene `interaction.type: "bars"`; supplied shares linked to scenes |
| `example-hierarchy` | Scene `interaction.type: "hierarchy"`; grouped membership paths linked to scenes |
| `example-sidecar-docked` | `layout: "sidecar"`, `sidecarVariant: "docked"` |
| `example-sidecar-floating` | `layout: "sidecar"`, `sidecarVariant: "floating"` |
| `example-sidecar-slideshow` | `layout: "sidecar"`, `sidecarVariant: "slideshow"` |
| `example-sidecar-mixed` | `layout: "sidecar"` plus each scene's `presentation` |

The choices example switches one map. The sidecar examples also use
`scene.comparison` for two synchronized maps and a reveal slider. The native
hierarchy control renders supplied membership paths; it is not the Prague
circular-tree graphic and does not calculate crosswalks. Relationship bars need
authored shares and an explicit denominator.

Native sidecar `storyTheme` is explicitly `paper` or `ink`. The imported editorial
renderer follows app light/dark mode. These theme contracts are currently
different. Likewise, native sidecars support a slideshow variant; the exported
editorial `StorySidecar` supports docked/floating scroll sequences only.

## What future projects inherit

- Responsive editorial styling, with docked/floating media beside prose on
  desktop and a sticky media pane above prose on phones. Use the existing CSS
  and measure `--editorial-viewport` from the actual story scroll container.
- MapLibre controls, markers and authored feature popups through `EditorialMap`.
  Its input remains a supported WebMap resource; it is not an arbitrary GeoJSON
  loader. For other data use the native scene renderer or supply a shared PGMaps
  map through the presentation components' slots.
- The shared basemap via `workspace.document.basemap: "pgmaps"`, including
  paint-only theme changes. This uses hosted CARTO tiles/fonts, not an offline
  archive. `pgmaps-dark` fixes the map to charcoal; `source` retains its basemap.
- Retained buildings during viewport refresh, cancellation of obsolete queries,
  bounded completed-view caching and compact progress in the imported map path.
  These are shared renderer behaviors, not Prague-only patches. They do not
  automatically apply to an arbitrary map placed in a React media slot.
- Keyboard controls and reduced-motion handling provided by the relevant
  components. Preserve stable component identities and clean up map listeners
  when composing them; a new child `key` or component type can remount a map.

See the [component composition example](project-map-stories.md#reusable-editorial-components)
and [native sidecar configuration](project-map-stories.md#editorial-sidecars)
for working invocation patterns.

## Remaining gaps before a unified authoring kit

The [native editorial implementation design](native-editorial-story-design.md)
describes how to close these gaps. Its proposed schemas/components are not yet
runtime capabilities.

1. **Native editorial block schema.** A new PGMaps story cannot yet express the
   whole Prague-style mix as straightforward native scene JSON. Add an optional,
   typed editorial block contract within the existing story workspace for cover,
   prose, figure, carousel, sidecar, comparison, tour and credits. Reuse the
   components above and adapt imported documents into that contract. This is a
   recommendation, not an available option.
2. **Shared reading shell.** Direct composition still has to supply scroll-root
   measurement, chapter observation, typography and project-toolbar wiring.
   Extract that setup if adding a second native editorial composition. Figure
   and credits presentation can then be exported alongside the existing blocks.
3. **Capability validation.** The import audit checks node names and basic
   references, not every subtype or placement. For example, `video` is supported
   as the cover's media, but `StoryBlock` has no standalone video case. Immersive
   variants other than floating currently fall back to docked, and tours use one
   map-focused layout. Do not claim arbitrary StoryMaps documents are supported.
   Validate subtype/context and report unsupported content before registering a
   new import.
4. **Data-driven diagrams.** The radial hierarchy and colored-dot explanations
   need separate chart components if future projects should generate them from
   data. Their current assets can be replaced without rebuilding the layout.
5. **Independent reuse fixture.** Current editorial browser tests use Prague.
   Add a small native fixture with different content/data when extending the
   authoring contract, so reuse is exercised independently of this import.
   New options must update types, normalization, audit, docs, examples and tests
   together, as required by the renderer contract.

These gaps concern portability and authoring breadth. They do not require
rebuilding the existing cover, sidecar, tour, expansion or comparison controls.

## Audit evidence and limits

- All eleven example packages pass the project-package structural audit.
- The audit run passed sixty focused tests across the editorial renderer,
  example-package integrity and project-package normalization (eight files).
- Local document integrity tests cover all 257 nodes, 59 resources, eighteen
  immersive slides, four tours, local asset hashes, nineteen captured map
  definitions and source credits. Seven map actions are referenced; eight stale
  source action records are retained separately.
- Existing `project-editorial.spec.ts` covers desktop/phone reading order,
  chapter navigation, map actions, tour polygons/popups, retained canvases,
  comparison interaction, basemaps, theme changes and delayed zoom refresh.
  The preceding implementation run reported nineteen passing tests but timed
  out during suite cleanup; it was not a clean runner exit.
- This audit changes documentation only. It does not claim a fresh visual or
  remote-service verification. Four captured maps depend on original services
  recorded as unavailable; local structure passing cannot make them available.
