# `story-map-v1`

Use this mode when a scene sequence drives map state and narrative.

For component selection, full editorial composition, or diagram capabilities,
read [story-components.md](story-components.md). It identifies which patterns
are available through scene JSON, imported documents, or React composition.

Read `docs/project-map-stories.md` completely before changing the renderer,
especially **Changing the renderer**. That document is authoritative for the
scene/layer schema and every `workspace.options` field.

Preserve these non-obvious invariants:

- scene cameras are re-fitted to the actual map pane;
- `scrolly` and `slides` chrome uses a pointer-events-none overlay with
  interactive descendants restored deliberately;
- the slides pane measures every slide stacked so stepping does not resize it;
- adding an option requires synchronized parser types/defaults, renderer
  behavior, docs, tests, and a package example.

Do not reproduce the story contract in this skill reference; keeping the full
schema in one repository document prevents drift.

For editorial covers, named chapter navigation, docked/floating/slideshow
sidecars, in-chapter map actions, or synchronized map reveals, use the
**Editorial sidecars** section of `docs/project-map-stories.md`. These are
capabilities of `story-map-v1`, not new project types. Presentation lives in
`src/maps/project-story/layouts/SidecarStory.tsx`; comparison rendering lives in
`StoryComparison.tsx`. Reuse scene and source definitions across style examples
and keep their boundary vintages and crosswalk limitations unchanged.

## Story verification loop

After the shared audit and unit-test gates, exercise the changed package and any
renderer layouts it can affect:

1. Run the project-package audit and the focused parser/story-scene tests. For a
   renderer change, also run `tests/e2e/project-story-map.spec.ts` and
   `tests/e2e/project-story-layouts.spec.ts`.
2. Open `/dev/projects/<slug>` at a representative desktop size. Visit every
   scene in both directions and verify active-card state, layer visibility,
   highlights/overrides, legend, callouts, places/popups, camera framing, map
   controls, and a clean console.
3. Repeat at a phone-sized viewport. For `panel`, exercise the configured sheet
   start state, peek copy/ticker, dragging, and scene navigation. For `scrolly`,
   verify the card lane scrolls while the exposed desktop map remains
   interactive. For `slides`, verify arrows, dots, keyboard/swipe behavior,
   overflow, swipe hint, and that changing slides does not resize the map pane.
4. When shared story renderer code or an option contract changes, test one
   shipped package for each affected layout: `where-is-north-bc` for `panel`,
   `bc-population-distribution` for `scrolly`, and
   `roadless-areas-bc-ecoregions` for `slides`.
5. Fix failures in the owning layer—package JSON, parser/defaults, pure scene
   logic, renderer, or shared shell—then repeat the failing gate and the full
   browser pass for every affected layout.

Story verification is complete only when all scenes are reachable in both
directions, scene state and map state agree, each affected layout passes desktop
and mobile checks, the map canvas fits its container without layout jumps, and
the console has no new warning or error. A missing/CORS-blocked data source is an
unverified external dependency, not a visual pass.

For a faithful reconstruction of a supplied complete StoryMaps document, use
**Imported editorial documents** in the story contract. `workspace.document`
selects the source adapter; its assets belong under `public/data/story-documents`,
not inside the recursively indexed project package directory. Preserve original
content and credits when the user requests the actual source story. This differs
from using the same interaction patterns with a new dataset.
