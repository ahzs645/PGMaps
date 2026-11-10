# Forestry Castor: source audit and browser contract

Reviewed 2 November 2026; native-comparison supplement added 5 November 2026. This audit covers every file and callable entry point in
the requested `bcgov/forestryCastor` repository, the growth/data dependencies
needed to execute its core, and the provenance of the bundled browser example.

The browser workbench is a **PGMaps adaptation of Castor's forest-management
simulation**. It uses explicit scenario inputs and records its model version and
preparation choices. Provincial results, calibration and complete R/SpaDES
equivalence require additional evidence beyond this source audit.

## 1. What the repository actually contains

The [pinned forestryCastor repository](https://github.com/bcgov/forestryCastor/tree/e2a580eb1fcc634780bb3599da7265a1e871484f)
contains one 54,844-byte R module, a README, two R Markdown tutorials, a conceptual
partial-cutting Word document, an illustrative caribou diagram, an empty data
checksum file, a licence, and test templates. There is no R package `DESCRIPTION`
or exported-function `NAMESPACE`, no harvest-results dataset, no operational
inventory, and no ready-to-run full simulation in this repository.

The [Castor parent repository](https://github.com/bcgov/castor/blob/4a47a0498a0dd073bc3b1880cca802327035c108/.gitmodules)
now keeps its modules in separate repositories/submodules. Several links in the
older forestry README point to removed `R/SpaDES-modules` paths. The current module
repositories below are the traceable sources; stale links should not be treated
as evidence that the dependency is unavailable.

| Component | Audited revision | Role |
| --- | --- | --- |
| [forestryCastor](https://github.com/bcgov/forestryCastor/tree/e2a580eb1fcc634780bb3599da7265a1e871484f) | `e2a580eb1fcc634780bb3599da7265a1e871484f` | Constraints, harvest queue, scheduled harvest and outputs |
| [growingStockCastor](https://github.com/bcgov/growingStockCastor/tree/8ea945a91b4ec71d0ddd28714641b6dcae229c5c) | `8ea945a91b4ec71d0ddd28714641b6dcae229c5c` | Yield interpolation, aging and stock reporting |
| [dataCastor](https://github.com/bcgov/dataCastor/tree/884ce9d726942b3d2eae7b88120bd1b7ad863a19) | `884ce9d726942b3d2eae7b88120bd1b7ad863a19` | PostgreSQL/raster preparation and SQLite schema/sample |
| [blockingCastor](https://github.com/bcgov/blockingCastor/tree/98743da76a69fbf30ec46c60228a1d38c9a2a2f7) | `98743da76a69fbf30ec46c60228a1d38c9a2a2f7` | Generates blocks, adjacency and landing associations |
| [disturbanceCastor](https://github.com/bcgov/disturbanceCastor/tree/d3201b5f95477b443885eaa39ae10e1feb58f270) | `d3201b5f95477b443885eaa39ae10e1feb58f270` | Distance and cumulative disturbance updates |
| [roadCastor](https://github.com/bcgov/roadCastor/tree/a5a7a316304f96a4b9a93f52ba9d36f9c44094b2) | `a5a7a316304f96a4b9a93f52ba9d36f9c44094b2` | Road simulation from landings and cost surfaces |

Source files and the SQLite sample are Apache-2.0 with Province of British
Columbia attribution. Exact reference R files retain their headers. The public
data folder contains `LICENSE`, `NOTICE` and a machine-readable `provenance.json`.
The original input example remains byte-for-byte unchanged.

## 2. Complete callable-function and event mapping

All references in this section are to
[forestryCastor.R](https://github.com/bcgov/forestryCastor/blob/e2a580eb1fcc634780bb3599da7265a1e871484f/forestryCastor.R).
These are SpaDES module functions rather than an R package API.

| Function / event | Actual source behavior | Browser responsibility |
| --- | --- | --- |
| `doEvent.forestryCastor` / `init` | Initializes; chooses queue or prescribed-schedule path; schedules final save and optional zone-priority refresh | Validate project, initialize worker state, run selected mode, preserve provenance |
| `Init` | Checks scenario; records compartments; creates report/zone-management tables; initializes output rasters; sets culmination and optional salvage attribution | Explicit configuration and input preparation; no hidden database connection |
| `schedule` | Calls `setConstraints`, then `getHarvestQueue`, once per period | Deterministic period loop with progress/cancellation |
| `followSchedule` | Calls `simHarvestQueue`; does not call `setConstraints` | Clearly labelled prescribed schedule; constraint diagnostics and overrides need explicit semantics |
| `setConstraints` | Resets reservation flags, reserves non-clearcut treatments and `nh` zones; applies temporal/denominator rules; adds adjacency and cumulative constraint raster | Typed constraints and auditable per-period reservations |
| `getHarvestQueue` | For each compartment, builds ranked candidate pixels, handles live/dead partitions and partial-cut transitions, applies flow/stock limits, records selected harvest | Queue mode, per-compartment demand, source-aware priority and accounting |
| `simHarvestQueue` | Reads raster layer `hsq_<elapsed years>` and harvests its nonzero cells; uses supplied block IDs | Importable explicit schedule in browser project data |
| `reportConstraints` | Reads `zoneManagement` from SQLite at final save | Export/show constraint diagnostics throughout the run |
| `updateZonePriorityTable` | Recomputes mean age, mean distance and mean `vol*thlb` by priority zone | Configurable zone-priority refresh, with aggregation semantics recorded |
| `saveForestry` | Writes the latest `harvestBlocks` raster as GeoTIFF; the constraint-raster write is commented out | Explicit exports for every output; preserve timeline separately from the final raster |
| `runCoCela` | Invokes `castor.CellularAutomata` through `rJava`/`jdx` and a local JDBC JAR | External Java path; not a part of the normal event loop and not ported by translating the SQL scheduler |
| `.inputObjects` | Sets local NULL defaults for missing flow/schedule inputs | Explicit optional-input defaults rather than SpaDES injection |

Queue ordering is a greedy, current-period heuristic. It is not a global
optimization model and does not find an optimal long-term harvest schedule. The
[parent Castor README](https://github.com/bcgov/castor/blob/4a47a0498a0dd073bc3b1880cca802327035c108/README.md)
describes strategic scenario comparison and notes limited operational planning
ability. A browser interface must preserve this interpretation.

## 3. Management rules that must remain visible

### Temporal and area rules

Constraints have `start` and `stop` elapsed years, inclusive. Harvest-flow `period`
is a one-based simulation step; `flow` is volume for the entire period. Original
reports divide harvested volume and area by `updateInterval` to report annualized
values. Annual rates and period totals must be separate fields in browser tables.

The original model counts cells for `t_area`, sums `thlb` for harvested area, and
sums `vol*thlb` for harvested volume. It does not multiply by geometric cell area.
The public example uses 100 m square cells, where one full cell equals one
hectare. An arbitrary-resolution imported raster must not be silently treated as
one hectare per cell. The browser's area-aware project schema records full cell
area and harvestable hectares explicitly; importing the original SQLite format
requires verifying the grid/units or an explicit, documented conversion.

### Constraint selection, including README differences

`ge` reserves `ROUND(percentage/100 * t_area)` cells. `le` reserves
`ROUND((1-percentage/100) * t_area)` cells. General constraints select matching
zone/denominator cells with `own=1`. The original population used to calculate
`t_area` can include unowned cells, while reported threshold percentages select
`own=1`; this denominator distinction matters.

| Rule | SQL ordering after zone/denominator filtering |
| --- | --- |
| Scalar `ge` | Threshold achievers first, `thlb` ascending, already reserved first, variable descending |
| Scalar `le` | Threshold **non-achievers** first, `thlb` ascending, already reserved first, variable ascending |
| Distance `ge` | Threshold achievers first, distance descending, age descending |
| Distance `le` | Threshold non-achievers first, `thlb` ascending, already reserved first, distance descending |
| Multiple conditions `ge` | Whole predicate true first, `thlb` ascending, already reserved first, age descending |
| Multiple conditions `le` | Whole predicate false first, `thlb` ascending, already reserved first, age ascending |
| Equivalent clearcut area `le` | Uses accumulated `SUM(eca*thlb)` to derive the number reserved; sorts `thlb`, existing reservation, ECA descending |
| `nh` | Reserves all cells in the active no-harvest zone |

The README's simplified sorting explanation is not an exact specification of
these SQL orders. In particular, multiple-condition sorting does **not** inspect
and sort by each field in the condition. Independent SQLite fixtures preserve the
implemented orders rather than rewriting expectations to match the prose.

ECA uses `threshold` as the allowable percentage. Its source limit is
`trunc((1 - (threshold/100 - current_eca/t_area)) * t_area)`. That expression can
be outside a sensible cell-count range; SQLite interprets a negative `LIMIT` as
unlimited. Browser bounds must be explicit corrections. Distance values are
input attributes unless a disturbance update is run. A static imported distance
must not be labelled as continuously recomputed proximity.

Adjacency reserves young blocks at or below the configured green-up height and
their listed adjacent blocks. The source consumes `blocks` and `adjacentBlocks`;
it does not derive adjacency from geometry in forestryCastor itself.

### Growth and treatment rules

[growingStockCastor.R](https://github.com/bcgov/growingStockCastor/blob/8ea945a91b4ec71d0ddd28714641b6dcae229c5c/growingStockCastor.R)
interpolates volume, height, ECA and several stand attributes between ten-year
yield knots. Its first increment is `max(1, round(periodLength/2))`, with R's
half-to-even rounding; five-year periods therefore begin with a two-year age
increment. Subsequent steps use the full period. Harvest/report labels use the
full elapsed period even though the first age increment is shorter. The age
update has a configurable maximum, but interpolation SQL hardcodes 350 years.

When the upper knot is absent, the SQL retains the previous attribute rather
than using the final knot. In the supplied example, an initial NULL volume at age
250 remains NULL despite an available age-250 yield. Holding the final endpoint
in the browser is a documented numerical correction.

The [partial-cutting conceptual note](https://github.com/bcgov/forestryCastor/blob/e2a580eb1fcc634780bb3599da7265a1e871484f/partial_cutting_conceptual.docx)
specifies eligible stands, age/height/basal-area entry criteria, a post-treatment
yield curve, the next silvicultural system, and an age-reset decision. It explains
why converting a partial cut to an equivalent younger stand can misrepresent
forest structure. A generic percentage-removal sensitivity option is a browser
extension, not the same model as a calibrated curve transition.

## 4. Every declared and advertised output

The browser output contract is broader than the single GeoTIFF written by the
original `saveForestry`. Download files must preserve units, scenario/model
version, input provenance, elapsed time and relevant assumptions.

| Source output | What is actually populated upstream | Web presentation / export |
| --- | --- | --- |
| `compartment_list` | Unique compartments from supplied flow table | Compartment filters and scenario metadata |
| `landings` | Landing pixel IDs for selected blocks, replaced each period | Period-aware points/table; GeoJSON for map/road handoff |
| `harvestPeriod` | Declared but not assigned in the module | Explicit period/year fields in browser results |
| `harvestReport` | Scenario, time, compartment, annual target/area/volume, mean age, block-size proxy, available THLB and transitions | Charts and CSV, with period totals and annualized rates labelled separately |
| `harvestBlocks` | Most recent harvest elapsed year for each cell; later harvest overwrites the earlier cell value | Raster/map plus separate time-series snapshots and event ledger |
| `harvestBlocksVolume` | Selected live volume per cell in queue mode; prescribed mode resolves `$vol` to `vol_h` through R partial matching | Correctly labelled harvested-volume raster and event-volume ledger |
| `harvestBlockList` | Appended aggregate block volume/height/elevation; no explicit time column added | Period-aware block table/CSV and spatial outputs |
| `harvestPixelList` | Reset each period, appended across its compartments | Full run pixel-event ledger/CSV |
| `ras.zoneConstraint` | Adds a 0/1 reservation mask each queue period | Counts of constrained periods **and** derived years; separate raster legends |
| `zoneManagement` | Per-rule percentages recorded before harvest; exported at final save | Before/after diagnostics, unmet-target indicators, CSV |
| `salvageReport` | Declared and optionally initialized, but never appended in the module | Browser extension: available, harvested and remaining salvage by period |
| `growingStockReport` | Supplied by growingStockCastor, not computed by forestryCastor | Initial/before/after stock curves and CSV |
| Yield uncertainty / 90% prediction interval | Advertised in README; calibration/Monte Carlo implementation absent from this module | Only an explicitly labelled sensitivity calculation when user-specified uncertainty inputs exist |

CSV/JSON tables, GeoJSON features and GeoTIFF grids can all be generated locally
from these results. Landings are inputs to road planning; they are not engineered
road alignments. The separate roadCastor module's road-year raster is a different
output requiring a cost surface and a road-generation workflow.

## 5. Upstream omissions and behaviors requiring explicit decisions

1. **Uncertainty is not implemented here.** The README mentions a calibrated
   gamma model and calibration data, but the R file only sets an empty
   `yieldUncertaintyCovar`. It has no model fit, prediction or Monte Carlo code.
   A user-selected coefficient of variation is scenario sensitivity, not an
   official Castor 90% prediction interval.
2. **Partial cuts are incomplete.** The branch changes curves and silvicultural
   systems, with a TODO to account for volume and landings. It is queried without
   a compartment restriction inside a compartment loop. Complete browser
   accounting must be marked as changed behavior.
3. **The optional Java optimizer is external.** `runCoCela` expects local
   `/Java/castor/bin` classes and `sqlite-jdbc-3.41.2.1.jar`, neither bundled here.
   Its two method calls do not provide the missing algorithm implementation.
4. **Tests are scaffolding.** The shipped tests use Windows developer paths,
   placeholder objects and old `forestryCLUS` function names. They provide no
   usable reference-output acceptance cases.
5. **The candidate queue has an arbitrary cap.** SQL uses
   `LIMIT trunc(sum(target)/50)`, which can exclude enough low-volume cells to
   prevent reaching an otherwise attainable target. Removing it is a change.
6. **A block-ranked queue still selects pixels.** Cumulative target selection can
   take only part of a block. A whole-block option needs a separate policy.
7. **Overlapping partitions can double count.** Selected pixel IDs are unioned,
   but each partition subsequently reports/updates its matching subset. A
   deduplicated browser ledger changes this accounting deliberately.
8. **Some summaries are not compartment-scoped.** Available-THLB queries omit a
   compartment predicate. The stock-floor lookup is also not scoped consistently
   and reads a current-period report before the normal report event. The browser
   should use actual current stock within the relevant compartment.
9. **Raster units and history differ.** Constraint accumulation counts periods,
   not years. Harvest rasters keep the latest event, not every harvest. Explicit
   event history is necessary for complete web outputs.
10. **Prescribed-schedule volume uses R partial matching.** The schedule query
    aliases `vol` as `vol_h`, then the raster assignment reads `$vol`. In the
    executed native fixture, R resolves that partial name to `vol_h` and writes
    the expected 204 m³. This is not evidence of a broken native raster. Browser
    output uses an explicit, unit-aware field.
11. **Area and missing values need an import contract.** Source cell counts and
    `thlb` assume the input preparation is compatible; missing volumes and absent
    yield knots are not permission to fill arbitrary forestry values.
12. **Constraint order and timing matter.** Earlier reservations influence later
    rules, and source diagnostics are before harvest. An after-harvest diagnostic
    is additional evidence, not the original `zoneManagement` row.

These observations follow the pinned source rather than assuming its comments,
README and implementation are interchangeable specifications.

## 6. Original public example: contents and preparation

The [dataCastor SQLite sample](https://github.com/bcgov/dataCastor/blob/884ce9d726942b3d2eae7b88120bd1b7ad863a19/simple_castordb.sqlite)
is bundled unchanged as `public/data/forestry-castor/simple_castordb.sqlite`:

- Size: **696,320 bytes**.
- SHA-256: `8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d`.
- Grid: **100 × 100 cells**, 100 m square, EPSG:3005; bounds `(1170000, 834000)`
  through `(1180000, 844000)`.
- Tables: 10,000 `pixels`, 26 `yields`, five `silvSystem`, one `transitions`, one
  `raster_info`, one `zone`, and one `zoneConstraints` row.
- One yield curve, with ages 0–250 in ten-year knots. All initial pixel volumes
  are NULL; all initial heights are 10; ages range 0–250.
- One `zone1` / `default` constraint: age `ge` 140, percentage **0**. It reserves
  no cells unless edited.
- No `blocks`, `adjacentBlocks`, `harvestFlow`, calibration model or calibration
  dataset; pixels have no `blockid`.
- Its transition-table schema is older than the current `createCastorDB` schema.

The sample is illustrative. Preserving its coordinates does not verify that its
forest attributes represent that location. Per-cell harvest units, generated
adjacency, landing choices, harvest targets and scenario duration are preparation
choices that must be disclosed and reviewable. No unknown partial-cut removal
fraction should be inferred from the five treatment descriptions.

The forestry R Markdown random-landscape example uses 220,000 m³ per five-year
period for two periods, with `vol > 110` and live harvest. That is a separate
tutorial scenario, not a validated prescribed flow for the SQLite sample. The
older Revelstoke tutorial likewise contains historical and hypothetical values;
they must not be displayed as current approved harvest targets.

Exact schemas and all preparation observations are recorded in the public
`provenance.json`. The input file is app-owned, versioned static data and must
survive the scraper-data synchronization step.

## 7. Browser execution and integration boundaries

The module's core is table sorting, filtering, arithmetic and state updates.
Those operations can run in a Web Worker with a pure TypeScript engine; SQLite
Wasm can read an original uploaded database. A browser does not need R, a Java
VM or a calculation server to perform the implemented scenario workflow.

The input-preparation PostgreSQL connection is a separate concern. Do not ship
database credentials or attempt direct database connections from the page.
Prepared local SQLite/project/CSV files and same-origin static samples provide
explicit alternatives. They also avoid dependence on cross-origin data services.
Any future remote endpoint needs its own CORS, access and provenance check.

Preserve raster coordinates, CRS, row order and no-data values. `pixelid` is an
upstream one-based row-major raster ID; normalized projects carry an explicit
zero-based `gridIndex`, so arbitrary user IDs cannot silently reorder a map.

Regional/provincial-scale performance remains a profiling question. The parent
project describes landscapes larger than a million hectares and horizons longer
than a century. A 10,000-cell example does not prove that workload fits browser
memory. Use explicit cell/period/replicate budgets and report them before running;
consider more compact arrays, persisted tiles or native/Wasm kernels only when a
measured workload requires them.

## 8. Validation evidence and remaining equivalence work

[Reference-generation instructions](../scripts/forestry-castor/reference/README.md)
describe independent Python SQLite fixtures built from the pinned sources. They
cover constraint ordering/limits, SQLite versus R rounding, actual-source growth
SQL, endpoint behavior, and cumulative-prefix harvesting. The generator uses no
TypeScript output and verifies original source/sample checksums.

These SQL tests establish selected algorithm contracts. They do not execute SpaDES,
its full event/dependency chain, PostgreSQL preparation, the missing Java class,
or a calibrated uncertainty model. Complete equivalence requires a fixed R
environment, a complete prepared case, matched event ordering and independently
recorded outputs. Browser changes listed above should have their own tests and
remain visible in the model version and exported assumptions.

The [native R/SpaDES suite](../scripts/forestry-castor/native-reference/README.md)
now supplies a bounded execution comparison: 13 synthetic three-period cases,
4,492 values/ID arrays, 4,010 agreements and 482 explicitly recorded differences.
It invokes the unchanged modules through the real scheduler and verifies their
source, input and harness checksums. It does not exercise the entire dependency
chain or establish operational equivalence. In addition to previously noted
queue-cap, endpoint and schedule differences, execution confirms that the browser
resets all clearcut stand attributes immediately, writes dead rather than live
volume for salvage rasters, and clamps age at 350 rather than allowing native
349 → 351 overshoot. Every changed value has an exact reviewed expectation.

The independent input/output and persistence tests additionally exercise the real
bundled SQLite database through SQLite Wasm, the browser engine, and a GeoTIFF
reader. They check source hashes and grid footprints, reject corrupt inputs and
unsupported legacy SQL, preserve non-integer Float64 values and no-data cells,
verify all ZIP contents, escape report text, and restore exact inputs/settings
before deterministically rerunning. Saved result objects are not accepted as
verified calculations on import.

```sh
npx vitest run src/features/forestry-castor/io.test.ts src/features/forestry-castor/persistence.test.ts
```

These are application tests against the actual input and encoded outputs; they
do not substitute for an interactive browser check or the R comparison described
above.
