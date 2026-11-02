# LandSciTech roads: browser implementation and compatibility

## Scope and provenance

The browser network planner adapts the public utilities of
[`LandSciTech/roads` 1.2.2](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/DESCRIPTION),
pinned to commit `08c462de51076b550473cb709da633314c32cd87`.
Its [NAMESPACE](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/NAMESPACE)
contains nine exported functions. All nine have a browser role in the inventory
below. The implementation is TypeScript with transferable numeric grids and
browser workers. It does not execute the R package, and does not promise identical
`sf`, `terra`, `igraph`, random-number-generator or geometry tie-breaking behaviour.

This is a network **projection** layer: choose a set of landing targets and
compare how they might share new access. PGMaps' existing detailed alignment,
profile, curve, switchback, cross-section, earthwork and connected haul models
still perform their respective jobs after selecting a candidate. A raster
projection neither fits a truck around a bend nor proves that an inferred road
can be built.

Copyright and the Apache 2.0 licence are preserved under
`src/pages/dev-forestry-roads/roads/NOTICE.md` and `LICENSE`. Those notices identify
the Province of British Columbia, the Government of Canada and the upstream
authors. The browser changes are identified explicitly.

## Public utility inventory

| Upstream export | Browser implementation | Compatibility and evidence |
| --- | --- | --- |
| `projectRoads` | `roads/projectRoads.ts` and the network planner | LCP, ILCP, MST and straight-line snap; rook, queen and octagon neighbours; explicit seed roads and landing cells; reusable graph state. Algorithm tests include the upstream CLUS reference. Tie-breaking and no-data failures are deterministic browser behaviours, not a universal R-parity claim. |
| `simpleCostFn` | `roads/weights.ts` | The formula is `distance × (x1 + x2) / 2`. Graph inputs require non-negative costs; NaN is blocked. |
| `gradePenaltyFn` | `roads/weights.ts` | Raw formula compatibility is kept separate from the terrain-aware planning extension described below. |
| `getLandingsFromTarget` | `roads/utilities.ts` | Interior points, regular spacing, seeded random density; polygon holes and multipolygons; binary raster patches and numeric raster IDs. Tests check containment, reproducibility, density and invalid inputs. The random generator and interior-point algorithm differ from R/GEOS. |
| `getDistFromSource` | `roads/utilities.ts` | Exact Euclidean distance transform to supplied source-cell centres. Upstream deprecated the old focal approximation and now calls `terra::distance`. The browser result is in metres, keeps source no-data missing, and optionally truncates at a requested distance. A brute-force reference checks off-axis distances. |
| `rasterizeLine` | `roads/utilities.ts` | Supercover rasterization, including boundary and corner touches; missing grid cells stay missing unless explicitly requested for a geometry-only mask. Upstream now delegates to `terra::rasterize`. Boundary tie conventions can differ. |
| `rasterToLineSegments` | `roads/utilities.ts` | Approximate nearest-pair or least-cost MST reconstruction. Uses 0.001 on road cells and 1 on valid background cells for the MST, as upstream does. Reports inferred non-road cells and disconnected components; rejects excessive work. |
| `plotRoads` | Browser map and comparison interface | Existing roads, projected paths, targets and spatial results replace R's plotting device. Presentation equivalence, not pixel-identical plots. |
| `prepExData` | `roads/examples.ts` | Ready-to-run browser fixtures replace recursive `terra::unwrap`. Exact CLUS numbers plus five synthetic browser scenarios; the ten packed `demoScen` R objects and upstream DEM asset are not bundled. |

The machine-readable table is `roads/compatibility.ts`. Public helpers remain
pure, with no DOM, map-renderer or network dependency.

## Four methods and their actual meaning

The [upstream projectRoads source](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/R/projectRoads.R)
defines four methods:

- **LCP:** solve each landing's least-cost route independently on the initial
  graph. This can produce parallel or redundant access.
- **ILCP:** solve one landing at a time, setting traversed graph edges to zero
  before the next landing. Earlier spurs can therefore be shared.
- **MST:** compute least-cost distances between terminals, choose a minimum
  spanning tree of those terminals, then recover its raster paths. This is not
  a globally optimal geometric road network or a Steiner-tree solver.
- **Snap:** join a landing to its nearest road target by a straight grid trace.
  This baseline does not optimize terrain cost. Unlike the upstream straight-line
  geometry, the browser rejects traces crossing missing or graph-excluded cells
  and grade-rejected edges. It therefore cannot silently adopt a straight line
  through a blocked area. That is a deliberate compatibility difference.

The original LCP/ILCP endpoints are selected by Euclidean proximity to the
initial road geometry. An initial `closest` ordering is also Euclidean, not a
fresh cheapest-landing choice after every addition. The browser's cell-based
input uses seed-cell centres, so a continuous vector road's exact nearest point
can differ by up to the rasterization scale. Additional farthest and seeded
random orders are browser experiments, not extra upstream API modes.

**Rook** uses four cardinal neighbours. **Queen** uses eight neighbours but gives
diagonals the cardinal distance in its objective. **Octagon** uses eight neighbours
and the actual square-root-of-two diagonal distance. Physical lengths remain
physical lengths, even when queen's objective intentionally treats them
differently. A browser option prevents diagonal shortcuts through blocked
orthogonal neighbours; this is a conservative planning extension.

ILCP and multi-period reuse preserve **edge weights**, not merely a raster mask.
Zeroing every edge incident to a newly reached cell would change the algorithm.
The returned simulation retains its graph and constructed-edge identity. Input
cell indexes are zero-based; R's cells are one-based.

The browser also handles a single-landing MST explicitly, where the pinned R
`mstList` only constructs its terminal list when more than one landing remains.
A target-only disconnected component is reported unreachable rather than
returning an isolated tree as though it had road access. The `roadsConnected`
shortcut checks that seed roads connect through **zero-cost edges** before
collapsing their terminals. Geometric connectivity alone is insufficient when
supplied road costs are preserved: collapsing those terminals can change the
selected tree. Use the general MST mode when existing-road travel has a cost.
These are documented repairs or stricter checks, not claims of exact behaviour matching.
Snap uses geometric diagonal adjacency independently of the selected raster
neighbourhood. Switching a retained simulation between snap and a routed method
requires a fresh run, so a hidden graph interpretation cannot change mid-series.

## Grade formula: source behaviour and the planning extension

The pinned [weightFunctions.R](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/R/weightFunctions.R)
overloads one raster: positive values are elevations, zero means road, negative
values mean crossing penalties, and NA means unavailable ground. For ordinary
positive elevations it uses:

`grade = 100 × abs(z2 − z1) / horizontalDistance`

`weight = horizontalDistance × (baseCost + grade × penalty)`

An over-limit grade is excluded unless a finite `limitWeight` is supplied.
The default parameters are historical package values, not current BC construction
quotes. Upstream multiplies a per-kilometre parameter by distance in raster units
without dividing by 1,000; that constant does not change relative route ranking.
**A raw objective is therefore not a CAD estimate.** Detailed road quantities and
cost estimates must still use PGMaps' engineering models and entered rates.

There are two material source-code quirks:

1. A zero-road endpoint suppresses the *slope surcharge*, but the grade threshold
   still uses its difference from the other endpoint's elevation. A zero cell
   beside a 500 m cell can therefore be blocked by an artificial grade.
2. Two zero endpoints still return `baseCost × distance` in the raw formula,
   rather than a free existing-road edge.

Those behaviours are retained by the formula utility for reviewable compatibility.
The planning adapter uses a **separate elevation raster** and explicit road mask,
so it does not replace a road's ground elevation with zero. Positive grid values
act as cost multipliers in that mode; crossing penalties remain explicit. Burning
selected road weights makes their connecting edges free. With `roadsInWeight = true`,
nonzero supplied seed-road weights are preserved, and already-zero seed edges
stay free. This extension is labelled and tested separately, and is the appropriate default
when using PGMaps terrain rather than reproducing upstream formula behaviour.

Raw grade penalties also treat sea-level/negative real elevations ambiguously;
separate elevations avoid confusing them with roads or barriers. Neither mode
models minimum turning radii, sight distance, geotechnical stability, equipment
performance or construction access permission.

## Landing geometry and raster helpers

`getLandingsFromTarget` uses projected metres and a user-facing density in points
per hectare. It converts to the package's points-per-square-metre concept by
dividing by 10,000. The `centroid` method name is retained for familiarity, but
the result is an interior point: a concave polygon's geometric centroid can be
outside its boundary, or inside a hole. The browser computes a valid scanline
interior. Regular sampling uses one common grid and falls back to an interior
point when a target receives no grid point. Random counts round ties to even,
as R does, with at least one point per target. Singleton samples use the interior
point. Seeded coordinates use a TypeScript generator and are **not** R seed parity.

Binary raster targets use eight-neighbour connected patches. Other positive
values are explicit block IDs, including non-contiguous cells with the same ID.
Raster interior samples remain inside their own cells/patches. All source inputs
must represent valid, non-overlapping polygon components with correctly assigned
holes; the utility is not a polygon-topology repair engine.
The road project's existing import parser expands MultiPolygon context into
Polygon features; the workspace adapter therefore receives those normalized
parts, while the utility also accepts multipolygon components directly.

The Euclidean proximity raster is a straight-line distance to pixel centres.
It is neither route length nor connected haul distance and does not detour around
barriers. Missing terrain stays missing, while a known finite empty cell can
receive a proximity value. With no valid sources, output is all missing.

Raster-to-line reconstruction is intrinsically ambiguous. The browser's nearest
method keeps unique undirected pairs at the global nearest distance, including
all ties. It does not reproduce upstream's incidental two-record trimming.
The MST can add valid non-road cells to bridge a gap and reports those cells;
no-data gaps remain disconnected, and diagonal corner-cutting is disabled.
Neither output can establish the presence of a junction where two real roads
cross, or resolve a bridge from the road underneath. Existing PGMaps' reviewed,
directed haul network continues to own those facts.

## Scenario library and questions it answers

| Scenario | Question to explore | What is synthetic or assumed |
| --- | --- | --- |
| CLUS reference | Do the algorithm results match the upstream's small published example? | Exact synthetic 5 × 5 costs and four landing cells copied from the upstream fixture. |
| Shared spurs | How much independent access becomes shared when successive landings can reuse a spur? | Six candidate landing cells and a lower-cost central corridor. |
| Wetland crossing or detour | When does an expensive narrow crossing beat travelling around a no-build area? | A raster exclusion and one high-cost crossing strip; no hydraulic or permitting conclusion. |
| Hillside grade | How do grade limits and terrain penalties alter the projected network? | Analytic hillside/ridge, separate terrain samples and a 12% screening limit; no real survey. |
| Staged harvest | How does building in three periods differ from planning every target at once? | Three ordered landing groups and persistent constructed edges. |
| Disconnected targets | Does the result honestly report targets that cannot reach the existing road? | An impassable raster barrier and targets on either side. |

The upstream [roads vignette](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/vignettes/roads-vignette.Rmd)
also discusses alternative independent landing sets, sequential development,
and sampling several landings within harvest polygons. Its
[road-history vignette](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/vignettes/ReconstructRoadHistory.Rmd)
uses a known network and dated harvest targets to estimate a **maximum construction
year**. A phased browser projection can illustrate that reasoning, but it is not
evidence of actual construction dates. Do not write inferred years back into road
condition or tenure evidence as observed facts.

## Limits and budgets

| Budget | Enforcing constant or validation | Response |
| --- | --- | --- |
| 250,000 grid cells | `graph.ts`, `MAX_ROADS_CELLS` | Reject the input; crop or coarsen explicitly. |
| 64 projection targets | `graph.ts`, `MAX_ROADS_TARGETS` and projection validation | Reject excessive target batches. |
| 1,000 sampled landing points | `utilities.ts`, `MAX_LANDING_POINTS` | Reject sampling instead of truncating targets. Reduce to the projection target budget before routing. |
| 500 target polygons/IDs/patches | `MAX_LANDING_TARGETS` | Reject excessive harvest target sets. |
| 2,000,000 geometry/sampling operations | `MAX_UTILITY_OPERATIONS` | Reject excessive geometry or sample density. |
| 512 source pixels for raster vectorization | `MAX_VECTORIZE_CELLS` | Crop or thin a raster before approximate line reconstruction. |
| Source pixels × grid cells ≤8,000,000 for MST vectorization | `MAX_VECTORIZE_WORK` | Reject excessive pairwise raster work. |

Changing these constants requires updating this table. Budgets prevent unbounded
browser work; changing language alone would not remove the algorithm's cost.

## Validation record and reproducibility

The upstream [CLUS generator](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/data-raw/CLUSexample.R)
hard-codes 25 numeric costs and landing cells 11, 13, 22 and 25 (R indexing).
The [CLUS tests](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/tests/testthat/test-projectRoads_CLUSexample.R)
publish expected output cell sets for snap, LCP and MST. `examples.ts` retains the
exact double values and converts the cell numbers to zero-based indexing.

`utilities.test.ts` checks Euclidean distances against brute force, supercover
boundary and corner handling, no-data gaps, inferred vectorization gaps,
concave/hole/multipolygon containment, binary and labelled raster patches,
deterministic random sampling, invalid inputs and bounded workloads.
`projection.test.ts` owns the network algorithm and package-fixture checks.

The focused projection tests reproduce the pinned upstream CLUS LCP, MST and
snap expected road-cell sets. These are source-derived and mathematical checks.
The separate [native R comparison harness](../../scripts/roads-reference/README.md)
and `.github/workflows/roads-reference.yml` install the pinned R package and
execute 25 scalar formula cases plus those three CLUS methods. Its generator
verifies the installed source revision; its comparator checks exact fixture/cell
arrays and finite values at a relative/absolute tolerance of 1e-12. R/package
versions, spatial library versions, native outputs and comparisons are retained
as workflow evidence. One-shot and staged ILCP results are visible informational
comparisons because vector-versus-cell endpoint conventions can differ.

Native R was unavailable in the development workspace when the harness was
written. Its configuration and TypeScript comparator were checked locally;
native execution is established only by a successful workflow run or an explicit
local R run. A committed workflow alone is not a passing comparison. Running the
upstream package with a representative real forestry dataset remains a separate
reference-validation exercise. A matching fixture does not establish universal
`terra`/`sf` parity, construction readiness, or suitability of a planning cost surface.

## Runtime choice

TypeScript is the primary browser implementation because the useful core is a
bounded numeric raster graph, shortest paths, MST selection and geometry helpers.
Typed arrays and a worker keep that logic compatible with the existing interface,
and make inputs/results easy to save and test. R/Wasm would also need the specific
spatial package stack and binary data contracts; it is not a drop-in wrapper
around this repository. Rust/Wasm is a reasonable future acceleration target for
a measured hot loop, using the same input/output contracts. It should follow
profiling and reference validation rather than becoming a prerequisite for
usable browser workflows.
