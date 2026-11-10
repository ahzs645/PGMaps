# RoadEng tutorial walkthrough — 9 November 2026

The earlier audits compared the workspace with the RoadEng v11 resource-road tutorial by reading
source and documents ([gap audit](reference-gap-audit-2026-10-30.md),
[follow-up](roadeng-follow-up-implementation.md)). This one did the tutorial's jobs **through the
interface**, in a browser, to answer a different question: can a designer who knows the workflow
sit down and finish a road here?

It could not be finished as taught. The features existed, but the job's own files would not come
in, the headline route search failed, the mass haul broke on any road drawn by hand, and Review
passed things nobody had checked. This page records what was tested, what was changed and what is
still open. Fixes are listed in [Known issues](known-issues.md) under **Fixed on 2026-11-09**.

## How it was tested

- **Base:** PGMaps `85b96675`. Manual: document version 20 February 2025, the same PDF the
  [contract](../forestry-road-design.md#reference-to-feature-mapping) cites.
- **Five walkthroughs**, each in its own browser tab on its own origin so saved state was not
  shared: chapters 3–8 (data and terrain), 9–12 and 15 (alignment, mass haul, pits, widening,
  pullout), 13–14 and 16–17 (materials, templates, culverts), 19 and 21–25 (route finding,
  optimization, costing, deliverables), and one first-time user taking a spur road from nothing to
  a saved, reopened, handed-over project with no manual.
- **Test data:** the tutorial's data set installs from a Windows executable, so the walkthrough
  used a kit of the same shape on the published Prince George 1 m LiDAR tile: four LAS tiles with
  no CRS in the header, a road shapefile, a KMZ block, landing points, named streams and a canopy
  image. [`scripts/forestry/tutorial-kit/`](../../scripts/forestry/tutorial-kit/README.md) builds
  it. The linework is invented; only the ground is real.
- **Then:** fixes on five branches, an independent re-test of the original failures on the merged
  build, two code reviews of the merged change, a second round of fixes for what those found, and
  the hand-run browser specs.

No RoadEng output was used as an oracle. Nothing here is a numerical comparison with RoadEng.

## What the walkthrough found, and what changed

| Tutorial step | Before | Now |
| --- | --- | --- |
| Import a road shapefile, a KMZ block, landing points (ch. 3, 7) | Only the streams import read zip, KML and KMZ, and it turned whatever it was given into a stream or an excluded constraint. Points were refused. Other pickers showed a JSON parse error. | Every picker reads GeoJSON, zipped shapefile, KML and KMZ through one reader. A dialog asks what the features are unless the picker or the file settles it. Names are kept. Points import as a reference layer and can be a road end. See [Exports and project files](exports-and-project-files.md). |
| Import LAS tiles with no CRS (ch. 3) | Refused: "Assign one (for example with PDAL)". Several tiles needed a separate folded section. | The import asks for the EPSG code and the vertical datum when a file needs them. The main control takes several tiles. The point counts, classes and extent stay on the terrain card and print in the report. See [Terrain and point clouds](terrain-and-point-clouds.md). |
| Canopy image as a background (ch. 7) | Refused over one megapixel. | Resampled to the display budget, and says so. |
| Route search between two points (ch. 21) | **Compare 4 routes** returned nothing and said "Routes ready", or never finished with Cancel dead. | Returns a road or a reason naming the limit and the place; the notice counts what came back; Cancel releases the workspace at once. A blocked end names the end, the feature and the distance. See [Alignment and optimization](alignment-and-optimization.md). |
| Polyline to alignment (ch. 22) | Missing. | **Reduce points, fit curves** reports points before and after and the deviation. |
| Profile optimization with a start control (ch. 23) | "No profile meets the limits" with the tool's own control value. | Solves; shows a run log with waste and borrow; returns only profiles whose curves the engine builds. |
| Mass haul on a hand-drawn road (ch. 11) | One missing terrain cell ended the curve and split haul into runs, so a balanced road borrowed and wasted at once. The 100 m table did not add up. | The balance carries the known earthwork across a gap, marked. Haul treats the road as continuous. Table rows add up to their total. Pits step on the diagram. See [Sections, quantities and costs](sections-quantities-and-costs.md). |
| Jump to station (ch. 11) | 85 landed on 80. | A typed station is evaluated where it was typed. |
| Materials and stripping (ch. 13) | The third "Add material horizon" blanked the workspace. Auto-created stripping was priced at $0, so adding it lowered the estimate. | Add buttons create valid entries; a later horizon replaces an earlier one where they overlap. An invalid input leaves out only itself, and every result says so. Quantities with no rate are flagged. |
| Keyed-in rock fill (ch. 14) | The starter edited the road's own template in place. | Creates a new named template to assign by range and side. |
| Culverts (ch. 17) | Inverts by hand. | A fall field, the skew convention stated, full-pipe capacity shown. |
| Review before hand-over | "Curves fitted" stayed met under a 60 m minimum radius with 35 m curves; "Drainage checked" was met with 22 unculverted low points. | Each row is met, needs attention or not assessed, with what it measured and where to fix it. See [Review checks and design standards](review-and-standards.md). |
| The project itself | No name or save state on screen; reports carried no date, author or revision. | Name and save state in the header; an issue stamp on the report and every plot sheet; design standards recorded with the project. |

## Considerations the manual makes that the workspace still does not raise

These came from the testers' notes. They are not defects in what exists; they are things a
designer is used to being asked, in rough order of how often they came up.

**Data and terrain**

- A class table at import (only ground is offered), and the tile footprints before the points load.
- The point budget is in the guide, not on screen, until an import exceeds it.
- Per-feature "modelled / breakline / boundary" flags. The manual's lesson that a boundary with
  bad elevations punches holes in a surface has no counterpart.
- A maximum triangle side length to expose sparse ground, a TIN boundary, and a contour interval.
- Thinning by an AOI polygon with the reduction shown before it is applied.
- Hydrology: a minimum pond area, and whether flow may leave the edge.

**Alignment**

- A road class as one package: template, default curve, design speed and widening table chosen
  together. The design standards record holds the limits, but a road added later still takes the
  default template.
- Widening per curve, set by hand. The override is road-wide.
- Any template parameter overridden over a station range, with a description. Turnouts and
  landings cover the common case only.
- Which materials the mass haul counts.

**Materials and sections**

- An embankment rate per material. It needs fill attributed to a material, which exists only
  after haul allocation.
- Default ground-type and template libraries for new projects.
- A rock zone with its own thickness in a keyed fill, and a ditch whose inslope differs from its
  backslope.
- A sliver-fill flag, and point-code labels in the section view.

**Optimization**

- Maximum cut and fill depth as search limits, and the search resolution as an input.
- Merging short vertical curves after an optimization (the manual's Smart Curves).
- The short-pitch and adverse grade limits in the searches. They are applied to the grade check
  only.

**Deliverables**

- Axis values and layout control on section sheets, paper sizes beyond A3 and A4, and one
  georeferenced package for the field.
- A culvert schedule as its own file.
- Terrain is stored inside each project file: 39.7 MB for a 4.2 MB GeoTIFF.

## Still open

[Known issues](known-issues.md) lists every defect found and not fixed, with the file and
function. The ones a designer is most likely to meet:

- A found road often reads "97 % of sections complete". The searches check ground under the
  centreline only, so a batter can run onto a terrain gap. Such a road is flagged and cannot lead
  a comparison.
- Economic material flow does not solve an ordinary road under a stepped haul quote (a free-haul
  distance with distance rates). Use a free-haul distance of 0 m with one rate, or wider stations.
- A permitted short pitch is still coloured as over the limit on the plan and in 3D.
- The first-visit example card covers Save on a phone until it is dismissed.

## Repeating it

1. Build the kit ([README](../../scripts/forestry/tutorial-kit/README.md)).
2. Open `/dev/forestry/road-design` on a clean browser profile and work the table above from the
   top: imports first, then a road pegged by hand (the example alignment was chosen to avoid
   terrain gaps, so it hides the mass-haul case), then materials, the optimizer, Review and the
   exports.
3. Run the hand-run specs that cover these paths: `forestry-road-workspace`, `-design`,
   `-design-rules-mobile`, `-planning`, `-new-area-desktop`, `-options-desktop`, `-schedules`,
   `-editing`, `-route-finder`, `-parity`, `-steep-3d`, `-terrain-preparation`, `-drainage`.

A browser-automation call that times out while a search is running stops the page's script. That
looks like a hung search with a dead Cancel button. Poll with short waits instead.
