# Browser road-network planning

Open **Design → Plan road network** in `/dev/forestry/road-design`. The network
planner connects multiple independent landing targets to selected existing-road
cells. Its relative construction objective and unique new-edge length help
compare network alternatives before detailed alignment design.

The implementation adapts all nine public exports of LandSciTech/roads 1.2.2.
The [compatibility inventory](roads-package-compatibility.md) records the pinned
upstream source, exact formulas, deliberate algorithm differences, deprecated
utility replacements, examples and validation evidence.

## Explore the six scenarios

Choose **Example or imported raster scenario** as the input source. Choosing a
scenario resets routing assumptions to that example's documented defaults.

| Scenario | What to do | What to compare |
| --- | --- | --- |
| CLUS reference | Select **Compare all four methods**, then calculate. | Small published upstream reference; inspect the weights and exact road-cell sets. |
| Shared spurs | Compare LCP, ILCP and MST; change the ILCP landing order. | Shared construction, unique new length and relative objective. Different orders can change ILCP results. |
| Wetland crossing or detour | Compare routed methods with the straight-line baseline. | A hard exclusion, an expensive crossing strip and explicit failed connections. |
| Hillside grade | Change the grade limit, penalty and optional over-limit weight. | Ground-grade screening and terrain-sensitive paths; these are not fitted road profiles. |
| Staged harvest | Run the three periods with graph reuse. | New construction added at each stage and cumulative network length, without repricing previously constructed edges. |
| Disconnected ground | Run any method and inspect target outcomes. | Explicit unreachable targets instead of a falsely complete network. |

These examples use their own local coordinates. Their SVG preview, raster data,
results and exports are usable without geographic terrain. They cannot be
inserted into an unrelated geographic project or presented as surveyed sites.

The [worked scenario comparison](network-scenarios.md) records actual results
for all six examples, explains their differences and includes a reproduction command.

## Plan with project terrain

1. Load the project's DEM or use a training project. Import existing roads and
   harvest polygons through the existing context controls. MultiPolygon imports
   are normalized into Polygon features by the existing project importer.
2. Review existing roads and enable reuse for the sources you intend to use.
   The network dialog lists eligible roads explicitly. Closed roads, closed
   structures, unresolved closure evidence, changed unreviewed geometry and
   unresolved permission restrictions cannot become network seeds.
3. Select source roads. Enter longitude/latitude targets, use an active-road
   endpoint, or generate candidates from harvest polygons. Targets are distinct
   from the designer's station-based landing widening ranges.
4. Give targets stage numbers when modelling sequential development. Set grid
   spacing and the search margin. The adapter uses local UTM metres and reports
   its actual resolution. Requested cells smaller than the source terrain are
   raised to the source resolution; this is reported, not hidden.
5. Select the method, weights and applicable assumptions. Compare all four
   methods on the same prepared grid when evaluating network shape. Target
   ordering applies to ILCP; the neighborhood selector does not alter snap's
   straight baseline.
6. Calculate. Review connected, already-connected, unreachable, outside and
   blocked target statuses, total unique new/reused lengths and warnings.
7. Use **Inspect network on project map** to view the current result over the
   actual terrain. Choose a projected branch and **Use branch as new road** to
   add a separate editable alignment.
8. Review exact junction and landing positions, horizontal curves, switchbacks,
   the vertical profile, road footprint, drainage and engineering quantities
   with the existing detailed design tools.

Geographic planning enforces separate real elevations and blocked-corner checks,
including after opening an imported configuration. A missing-terrain cell or
hard exclusion cannot be reopened simply by burning a road through it. Hard
polygon boundaries occupy every touched cell, so narrow exclusions remain
effective at the planning grid's scale. Source road endpoints are still raster
approximations; adopting a branch does not establish an exact vector junction.

Soft exclusion values become additional relative raster weights. In terrain-aware
grade mode, positive weights multiply the grade cost. The result is not a full
estimate of the project's CAD crossing or construction costs. Stream context
remains visible in the designer, but the network projection does not design or
price culverts/bridges: use explicit exclusions or an imported cost raster to
control those crossings, then complete the detailed crossing review.

Preserving supplied road weights keeps nonzero existing-road travel costs in
route selection; burning selected seed cells makes those road edges free. The
MST connected-road shortcut requires a continuous zero-cost road network and
checks that condition. Use general MST when roads are disconnected or retained
road weights are nonzero.

Landing sampling is reproducible. A generated batch with missing terrain or
hard-blocked candidates is refused with the affected counts; the prior target
list remains intact. This prevents silently dropping harvest areas from a run.

## Branches and quantity accounting

The raster network result counts each undirected new edge once, even when
several paths share it. A later stage retains constructed-edge identity and
reuses its original graph. The worker aggregates all stage paths and outcomes;
it does not replace the report with the last stage alone.

The reported construction objective sums original weights on unique **new**
edges. It excludes existing-road travel, even when preserved road weights
influence route selection. Individual path objectives record the solver's cost
at that stage; adding those path scores is not the unique construction total.

When adopting a path, original seed-road-only prefixes/suffixes are removed.
A landing-to-road branch is reversed so stationing starts at its road junction
and ends at the landing.
A path containing an existing-road run between two proposed branches must be
split before construction quantities are assigned. Collinear-only simplification
preserves the exact raster route; arbitrary smoothing could cut across an
exclusion and is not applied.

An adopted path has zero curve radii and no designed vertical profile. Shared
*proposed* portions may still occur in separately adopted alignments. Treat those
as alternatives or split the shared trunk before adding their detailed quantities;
summing every independently adopted alignment would double-count shared work.
The package objective is not the detailed earthwork or complete access estimate.

## Raster utilities and exports

The results page exposes:

- **Network scenario JSON:** all actual grid values, optional elevations,
  seed-road cells, target cells, stages, computation options, provenance and
  compact results. JSON `null` preserves missing cells. Reopening recalculates
  results; the stored graph is not trusted as current evidence. Computation
  options in the recorded input override stale editor settings.
- **Network results CSV:** path/target status and relative objective, with
  unique network-level construction/reuse totals.
- **Weight and road-cell grid CSV:** projected cell centres, weights, elevations,
  seed and projected masks, and the EPSG when the grid is geographic.
- **Distance to existing roads CSV:** exact Euclidean distance to seed-cell
  centres, which is different from a routed or haul distance.
- **Network GeoJSON:** geographic projected paths and landing outcomes for a
  current project result; local-coordinate examples do not fabricate WGS84.
- **Reconstruct raster road lines:** nearest or raster-MST reconstruction with
  inferred cells, disconnected components and warnings retained in the JSON.
  This diagnostic is not surveyed topology and cannot be adopted as a design.

An imported raster scenario can contain custom per-cell cost values, barriers,
landings and stages. Its local grid is retained exactly. Geographic project
adoption always requires preparation against the current project terrain and
reviewed source-road selection.

Planning inputs are part of the existing versioned project file and local project
library. Worker graphs/results are transient. Any input or terrain edit marks an
existing review stale and disables its map/adoption/current-result exports until
recalculation. Cancellation terminates the worker; it does not replace roads.

## Limits and budgets

| Limit | Enforced by | User response |
| --- | --- | --- |
| 250,000 raster cells | `graph.ts: MAX_ROADS_CELLS`, `planning.ts: MAX_NETWORK_CELLS` | Crop, increase cell size or reduce the margin. |
| 64 targets across all phases | `graph.ts: MAX_ROADS_TARGETS`, `stages.ts` | Reduce sampling density or plan a smaller scope. |
| 12 stages | `planning.ts: MAX_NETWORK_STAGES` | Group planning periods explicitly. |
| 100 km across a geographic analysis | `prepareNetworkScenario` | Use a local study area and UTM grid. |
| 30 million cell/vertex tests per exclusion | `polygonCells` | Crop the region or simplify the supplied constraint geometry. |
| 32 MiB scenario-file upload | `NetworkPlanningDialog` | Crop larger raster scenarios. |
| 20 alignments; 2,000 design control points | Existing `project.ts` validation | Adopt selected branches and respect the existing project budget. |
| Reconstruction and sampling work | [Compatibility guide](roads-package-compatibility.md#limits-and-budgets) | Reduce raster extent, source pixels, polygons or sample density. |

Calculations run in a disposable browser worker. Completed graph buffers transfer
ownership to avoid duplicating large typed arrays. Four-method comparisons run
sequentially. The largest supported MST can take appreciably longer than ILCP;
the UI remains cancellable. TypeScript is the current engine. The serializable
grid and result contracts leave room for replacing measured hot loops with
Rust/Wasm later without replacing the UI or project format.

## Verification

Run the focused mathematical, lifecycle, project and component suite with:

```sh
npx vitest run src/pages/dev-forestry-roads/roads src/pages/dev-forestry-roads/NetworkPlanningDialog.test.tsx
npx tsc -b
npx eslint src/pages/DevForestryRoads.tsx src/pages/dev-forestry-roads tests/e2e/forestry-road-network.spec.ts
npx vite build
```

The existing forestry road workflow includes `forestry-road-network.spec.ts` in
its browser suite. It covers desktop/390 px method comparison, worker results,
failure reporting, custom-grid export/import, raster utility exports, actual
MapLibre overlays, selected-branch adoption and project reopening. Mathematical
checks include the published CLUS road-cell fixtures and independent distance,
barrier, stage-accounting and input-preservation cases. See the compatibility
guide for the limits of package parity and source-derived validation.
