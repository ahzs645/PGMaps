# Choosing story components

Read this when selecting a presentation for a future project, composing Prague-
style sections, or adding native editorial/diagram capabilities. The implemented
contract is [project-map-stories.md](../../../../docs/project-map-stories.md).
The [reuse audit](../../../../docs/story-component-reuse-audit.md) maps every
Prague section to its component and records the limits.

## Choose an implemented route

| Need | Use now |
| --- | --- |
| Sidebar and phone bottom sheet | Native scenes, `workspace.options.layout: "panel"` |
| Cards scrolling over a map | Native scenes, `layout: "scrolly"` |
| Map above guided slides | Native scenes, `layout: "slides"` |
| Docked/floating/slideshow map chapters | Native scenes, `layout: "sidecar"` and `sidecarVariant`; scene `presentation` for mixed stories |
| Named choices, supplied shares or membership paths | Scene `interaction` with `choices`, `bars` or `hierarchy` |
| Synchronized map reveal | Native scene `comparison`, or shared `MapSwipe` plus caller-owned map synchronization |
| Original captured story and its content | `workspace.document.schema: "arcgis-story-document-v1"` with supported imported nodes/resources |
| Native cover, gallery, photo tour, centered illustration or linked diagram | `workspace.document.schema: "pgmaps-editorial-v1"`; see the native authoring contract below |
| True circular hierarchy | Native `radial-hierarchy` diagram or shared `RadialHierarchy` component |
| Step-driven categorical dot explanation | Native `category-dots` diagram or shared `CategoryDotDiagram` component |

The reusable editorial components are exported from
`src/maps/project-story/editorial/components/index.ts`. Direct composition needs
`EditorialStory.css`, a bounded scroll root and its measured
`--editorial-viewport`. Media/map slots are caller-owned. Preserve stable map
instances, the PGMaps navbar and the shared project-folder back button.

Native sidecars and imported editorial documents have different authoring and
theme contracts. Do not add ordinary `workspace.options` fields expecting them
to control an imported graph. `EditorialMap` consumes supported WebMap resources;
use native story layers or a shared PGMaps map for other data.

## Native editorial authoring

Read [native-editorial-stories.md](../../../../docs/native-editorial-stories.md)
when authoring `pgmaps-editorial-v1`. It is the shipped contract. Copy the
structure of `public/data/projects/example/native-editorial.json` and
`public/data/story-documents/native-example/story.json`, replacing content and
source metadata truthfully. Runtime and package audit share
`editorial/model/validate.mjs`. Run the audit before registration.

Use scene packages for climate-grid layers and slideshow sidecars. Native
editorial documents currently support GeoJSON polygon/point and polygon PMTiles
maps; map views accept opacity/line-width overrides, not per-view recoloring.
Diagram/map selection uses the document category registry and a map's explicit
`categoryProperty`. View actions require a real target region and compatible
view. Reading sections measure their actual sticky media height.

The [implementation design](../../../../docs/native-editorial-story-design.md)
records the original design and delivered scope. Follow the authoring contract
and current types if a proposed field there differs from the implementation.
Do not add unsupported fields hoping the renderer will interpret them. Preserve
source graph adapters for faithful imports; native documents do not need a fake
ArcGIS graph. Both routes share the reading shell and presentation components.

## Data and capability boundaries

The Prague circular hierarchy and colored dots are images. Retain them when
exact source reproduction matters. Do not infer quantitative data from the
picture and label it original. A radial hierarchy requires a true parent-child
tree; overlapping economic/health crosswalks are not a tree. For a dot
explanation, distinguish measured data from illustrative data and define any
reported statistic independently of presentation.

When a new capability ships, update its types/normalization, runtime validation,
component, audit coverage, authoritative docs, this reference and a working
example together. Document availability here only after desktop/phone behavior and
meaningful data/interaction checks pass. Prefer the existing skill and focused
references over creating a separate skill for each visual block.
