# Story interaction examples

Open `/dev/projects?collection=example`. Each example is an independently usable
`story-map-v1` package and works on desktop and phones.

| Package | Interaction |
| --- | --- |
| `docked.json` | Desktop narrative sidebar; phone bottom sheet with chapter controls |
| `slides.json` | Map above slides; arrows, dots and touch swipe |
| `scrolly.json` | Scrolling chapters; phone Explore map / Read story |
| `comparison.json` | Economic / Census / Health / Overlap buttons, common authored camera |
| `relationships.json` | Selectable Cariboo population-share bars linked to authority highlights |
| `hierarchy.json` | Two clickable membership paths linked to boundary highlights |
| `sidecar-docked.json` | Dark editorial narrative alongside a persistent map |
| `sidecar-floating.json` | Light narrative cards over a full-width map |
| `sidecar-slideshow.json` | Guided chapters with a right-hand narrative pane |
| `sidecar-mixed.json` | Continuous story combining docked and floating chapters |
| `native-editorial.json` | Native JSON blocks, linked maps, radial hierarchy and dot explanation |
| `prague.json` | Full imported editorial story with video, sidecars, comparisons, galleries and photo tours |

These are working design examples, not new source datasets. They reuse the
connected-geographies story's boundary snapshots. Population shares come from
GeographyBridge's economicRegionCode → healthAuthorityCode records for Cariboo;
the denominator is 159,910 covered 2021 residents. Cariboo has no unresolved
health parents. The complete bridge retains 533 unresolved blocks elsewhere.
Health polygon vintage is not established as 2021. Highlighted health polygons
show whole authorities, not the exact block intersection underlying each share.

`comparison.json` uses one map with explicit view selection. The four sidecar
examples include synchronized dual maps with a reveal slider in chapter four.
They present the same six chapters and data, with cover, chapter navigation,
map-action links, prose and mobile map expansion. Their cover uses the live map.
Photo/video covers and image-based tours are available through the editorial
components and Prague document adapter, but are not fields in the native scene
JSON contract used by these four sidecar examples.
Hierarchy arrows mean membership within each classification. They do not imply
that an economic region is a parent of a health authority.

Regenerate presentation after updating the source snapshots:

```sh
node scripts/generate-story-examples.mjs
node scripts/generate-sidecar-examples.mjs
npm run projects:index
```

Keep scraper-owned boundaries and crosswalk snapshots in `vendor/bcdatamapper`.
The `interaction` scene schema and renderer rules are documented in
`docs/project-map-stories.md`.

`prague.json` recreates **The Diverse Prague** using the original supplied story
content, media, tours and map definitions. Its document and credited assets live
under `public/data/story-documents/prague`; the wrapper selects the reusable
`workspace.document` adapter. Open `/dev/projects/example-prague`.

See the [story presentation reuse audit](../../../../docs/story-component-reuse-audit.md)
for the component behind every Prague section, which styles are configurable in
project JSON, and the remaining authoring gaps.

`native-editorial.json` is an independently authored example of
`pgmaps-editorial-v1`. Its content is in
`public/data/story-documents/native-example/story.json`. It uses real 2021
region boundaries and explicitly illustrative diagrams. See the
[native editorial contract](../../../../docs/native-editorial-stories.md).
