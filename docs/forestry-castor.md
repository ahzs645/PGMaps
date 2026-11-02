# Forestry Castor in the browser

`/dev/forestry/castor` is a local forest-management scenario workbench adapted
from the Province of British Columbia's forestryCastor and growingStockCastor
modules. A pure TypeScript worker performs the simulation. SQLite Wasm reads
local legacy databases; it is not a remote database connection. The same page
can be built as a standalone static application for the forestryCastor fork.

This document is the implementation contract. The [source audit](forestry-castor-source-audit.md)
maps every upstream function, declared output and missing dependency to the
browser implementation. The [reference checks](../scripts/forestry-castor/reference/README.md)
define what has been compared independently with the original SQL.

## Start a scenario

1. Open **Forestry → Castor forest scenarios**.
2. Load the synthetic demonstration, load the original dataCastor example, or
   import local inputs. The two examples are explicitly illustrative.
3. Review the inventory, source notes, period length and horizon. Harvest targets
   are **cubic metres per period**, not annual cubic metres. A five-year target
   of 220,000 m³ corresponds to 44,000 m³/year.
4. Set compartments/partitions, priority, constraints, adjacency, retained stock,
   and optional treatments or a prescribed schedule.
5. Run the scenario. The worker reports progress and can be cancelled. Changing
   an input invalidates the displayed result; old worker replies cannot restore it.
6. Review reports, before/after constraint attainment and maps. Keep a baseline
   to compare another scenario, then export the report or a recoverable session.

The browser saves the most recent valid inputs/settings in a dedicated IndexedDB
store. A storage failure is visible. A downloaded session contains inputs,
settings and any completed result. Import restores the inputs/settings and
requires a fresh calculation; imported result JSON is not treated as a verified
current run. An older model version is recorded in provenance when importing it.

## Implemented workflows

| Workflow | Browser behavior |
| --- | --- |
| Growth and yield | Interpolates supplied volume, height, ECA and other stand attributes by age; supports natural/managed curves and post-harvest transitions. |
| Harvest flow | One or more live/salvage targets per compartment and period, with structured partition conditions. |
| Priority | Ordered block attributes and optional zone priority with an explicit refresh interval. |
| Harvest unit | Pixel selection or complete eligible block units; an oversized priority unit can leave a shortfall. This is a priority queue, not a global optimizer. |
| Cover constraints | `ge`, `le`, no-harvest zones, structured multiple conditions, explicit denominator predicates and start/stop windows. |
| ECA | Aggregate equivalent clearcut area by zone, with an incremental budget check on proposed harvest. |
| Disturbance distance | Constraints on imported distance and optional proximity updates from newly harvested cells. Road recovery and disturbanceCastor's time windows are not reproduced. |
| Adjacency | Supplied block adjacency and a height-based green-up threshold; relationships must be supplied for actual blocks. |
| Growing stock | Retains the configured fraction of initial merchantable stock and checks the current compartment's remaining reserve before removal. |
| Salvage | Dead-volume targets, selected cells/blocks, and per-period available/harvested/remaining balances. |
| Partial cuts | Explicit entry rules, removed fraction or post-treatment curve, age retention/reset, and subsequent curve/treatment transitions. Removed-volume accounting completes an upstream TODO. |
| Prescribed schedule | Local JSON schedules or an aligned harvest-period/schedule GeoTIFF; the browser keeps its constraint and reserve checks. |
| Sensitivity | Seeded fixed-plan lognormal yield sensitivity, percentile range and probability of achieving a target. This is a browser extension, not the absent upstream gamma calibration. |
| Scenario comparison | Keeps a completed baseline for comparison while input changes require a fresh run. Importing a different project clears the baseline. |

## Outputs

Every report is available in the interface and as a complete CSV; table previews
may show fewer rows. Display limits never truncate the downloaded CSV or event
ledger. The final report bundle includes a printable HTML report; browser printing
can save that report as PDF without a server.

| Upstream object / requested output | Web equivalent |
| --- | --- |
| `compartment_list` | Inventory compartments and the compartment fields on all relevant reports. |
| `harvestPeriod` | Explicit period, elapsed years and calendar year in event/report rows. |
| `harvestReport` | Target/effective target, actual volume, annualized volume/area, average age, block count/size, available THLB, transition totals and shortfall. |
| Companion growing-stock report | Initial, before-harvest and after-harvest standing volume and salvage stock by compartment. |
| `harvestPixelList` | Complete harvest/treatment event ledger across every period, including partial-cut fractions. |
| `harvestBlockList` | Per-period harvested block summaries with area, volume and height. |
| `landings` | Provided planning landing pixels or explicitly identified candidate harvest-cell locations; CSV and GeoJSON. These are not road designs. |
| `harvestBlocks` | Most recent harvest year by selected snapshot; earlier harvests remain in the event ledger. |
| `harvestBlocksVolume` | Cumulative harvested m³ per cell, explicitly labelled; this extends the upstream last-written volume raster. |
| `ras.zoneConstraint` | Current constraint state, cumulative constrained periods, and cumulative constrained years as separate map/export choices. |
| `zoneManagement` | Before/after actual percentage, denominator, protected area, target and attainment. |
| `salvageReport` | Completed salvage balance reports rather than the upstream initialized-but-unfilled table. |
| Yield uncertainty | 5th/50th/95th percentiles and target probability under the chosen sensitivity assumptions. |

### Spatial outputs

Map choices are harvest year, cumulative harvested volume, constrained state,
constrained periods, constrained years, stand age, standing volume, height and
ECA. The user selects the period. MapLibre renders actual imported/generated
features on a neutral background; synthetic data are not overlaid as if they were
an operational forest inventory.

GeoJSON uses WGS84 longitude/latitude. Grid polygons preserve the original cell
footprint after projection. Irregular imported GeoJSON geometry is retained.
An inventory with no spatial metadata still supports numerical reports; no
location is invented for it. Projected x/y require an explicit projected CRS.

GeoTIFF requires a regular, north-up grid, an EPSG identifier, metre cell size,
and an explicit zero-based `gridIndex` for each inventory cell. Output is one
Float64 band with the original origin/resolution/CRS and `-9999` NoData. Zeros are
preserved as zeros. The encoder has independent read-back checks because the
installed geotiff.js writer only writes 8-bit image values.

The ZIP contains all reports, original normalized inputs, run configuration,
all-period result snapshots and final-period GeoJSON/GeoTIFF views. The manifest
states that spatial files represent the final period; individual other periods
can be downloaded from the map. It also lists omitted spatial products when the
input lacks a grid or coordinates.

## Data loading and CORS

The only example-data request is a bundled, same-origin SQLite asset:

```text
<Vite BASE_URL>data/forestry-castor/simple_castordb.sqlite?v=<SHA-256>
```

The loader verifies its exact bytes before opening it. The versioned query avoids
reusing an older unversioned service-worker data cache. The worker JavaScript and
SQLite Wasm are compiled asset URLs on the same origin. The standalone build uses
`/forestryCastor/` as its base and includes only Castor data, not PGMaps' unrelated
scraper data.

Local imports use browser file reads. The simulation, data preparation described
below, charts and downloads stay local. No input file is uploaded. No PostgreSQL,
R, ClimateBC, ECCC, GitHub raw-content or remote calculation request is made by a
run. Upstream links in the Methods tab are informational, not data dependencies.
Serving over HTTPS (or localhost for development) supplies the secure context
needed for source checksum verification. This design needs no CORS proxy.

## Original example database

The unchanged public example comes from dataCastor at
`884ce9d726942b3d2eae7b88120bd1b7ad863a19`:

- 696,320 bytes; SHA-256
  `8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d`.
- 10,000 one-hectare cells in a 100 × 100 EPSG:3005 grid.
- 26 yield knots, ages 0–250; one zone, five silvicultural definitions and one
  transition.
- No blocks, block adjacency, harvest-flow targets or yield-error calibration.
- Initial volume is NULL and must be initialized from the yield curves.

The importer assigns separate pixel planning-unit identifiers when block IDs are
absent and records that assumption. They are not operational cutblocks. Targets
added through the interface are scenario assumptions, not published sample
results. The sample's coordinates do not establish that its forest attributes
describe a real stand at that location.

Apache-2.0 licence, NOTICE, schema and source checksums accompany the example in
`public/data/forestry-castor`. That directory is app-owned and explicitly preserved
by the clean scraper-data synchronization script.

## Input contracts

### Normalized project JSON

`src/features/forestry-castor/types.ts` defines the complete versioned contract;
`validation.ts` validates untrusted nested input before a worker runs. Start from
the downloadable demonstration/session rather than reconstructing the schema.

Required top-level fields are `schema: "pgmaps-castor-project-v1"`, `name`,
`description`, `provenance`, `pixels`, `yieldCurves`, `constraints`, `harvestFlows`,
`adjacency` and `landings`. Optional fields include `grid`, `crs`, `treatments`,
`schedule` and `config`.

Each inventory pixel has:

| Field | Meaning |
| --- | --- |
| `id`, `blockId`, `compartment` | Unique numeric cell ID; string block and compartment IDs. |
| `areaHa` | Full represented ground area in hectares. |
| `thlbHa` | Timber-harvesting land-base hectares, from zero to `areaHa`. |
| `owned` | Whether the model may select the cell for harvesting. |
| `age`, `height` | Years and metres. |
| `volume`, `salvageVolume` | Live/dead merchantable volume densities in m³/ha of THLB. |
| `eca` | Equivalent clearcut area fraction, 0–1. |
| `distance` | Metres from the imported disturbance basis. |
| `curveId`, `managedCurveId` | Existing and post-clearcut yield curves where supplied. |
| `zones` | Zone-name → string zone-ID mapping. |
| `x`, `y`, `gridIndex`, `geometry` | Optional explicit spatial placement; geometry is WGS84. |
| `attributes` | Extra scalar attributes; cannot shadow normalized model fields. |

Yield points have an age, m³/ha volume and height; ECA, basal area, crown closure,
deciduous percentage and quadratic mean diameter are optional. Ages must be
strictly increasing. Curve IDs and transition references are checked. If no growth
curve is supplied, volume/height/ECA are held while age advances, with a visible
warning; this is not an inferred growth model.

A structured partition/constraint condition, for example:

```json
{
  "all": [
    { "field": "age", "op": "ge", "value": 80 },
    { "field": "volume", "op": "gt", "value": 110 }
  ]
}
```

Supported comparisons are `eq`, `ne`, `gt`, `ge`, `lt`, `le`; compound conditions
use `all`, `any` or `not`. Ordered comparisons require numeric values. Field names,
depth, node count and scalar types are checked. Neither SQL nor JavaScript from
an input file is executed.

Constraint `startYear`/`stopYear` are **elapsed simulation years**, distinct from
configuration `startYear`, which is the calendar-year label. For ordinary cover
constraints, `threshold` is the stand-attribute threshold and `percentage` is the
zone share. For `variable: "eca"`, `type` must be `le` and `threshold` is the
allowed zone ECA **percentage**, from 0 to 100.

### CSV tables and GeoJSON inventory

Select related CSV files together. Names identify the table:

| File | Required content |
| --- | --- |
| `inventory.csv` / `pixels.csv` | Normalized inventory columns; explicit `areaHa` and `thlbHa` unless an aligned grid supplies cell area. |
| `yields.csv` | `curveId,age,volume,height` plus optional yield attributes. |
| `harvest-flow.csv` | `id,compartment,period,targetM3,type`; optional legacy `partition` text. |
| `constraints.csv` | `id,zone,zoneId,type,variable,threshold,percentage` plus optional time windows/conditions. |
| `adjacency.csv` | `blockId,adjblockid`, or `from,to`. |
| `landings.csv` | `blockId,pixelId`. |
| `grid.csv` | `width,height,originX,originY,cellSize,crs`. |

An optional JSON manifest with schema `pgmaps-castor-tables-v1` can supply the grid,
name, description and configuration alongside CSVs. A complete project/session
JSON is imported on its own to avoid ambiguous merging.

Inventory GeoJSON is a FeatureCollection of valid WGS84 points, polygons or
multipolygons. Properties use the normalized inventory columns; explicit area
and THLB inputs remain required. The importer preserves geometry and does not
replace assessed forest area with an implicit polygon-area estimate. Related
yield/constraint CSVs may be selected with it.

Quoted CSV fields, escaped quotes, BOMs and embedded line breaks are supported.
Duplicate headers, missing required numbers, invalid IDs and broken references
are rejected. Text cells in CSV downloads are escaped to prevent spreadsheet
formula execution.

### Original SQLite castordb

Import `.sqlite`, `.sqlite3` or `.db` on its own. The reader checks the SQLite
header, opens the database locally in query-only mode and reads known tables with
row limits. It translates `pixels`, `yields`, `zone`, `zoneConstraints`,
`raster_info`, blocks/adjacency, landings, flows and active silvicultural
transitions into the normalized model.

Legacy area arithmetic is only accepted with the original **100 m, one-hectare
projected grid**. Upstream computes area with cell counts/THLB sums without a
general cell-area multiplier. For other resolutions, prepare normalized inputs
with explicit hectares; the importer will not guess that a THLB fraction is an
area.

Legacy conditions support literal comparisons, parentheses, AND/OR/NOT, IN and
BETWEEN through a restricted parser. Unsupported functions, subqueries and SQL
statements fail explicitly. Partitions are not passed to the SQLite engine.

Active partial-cut systems require unambiguous entry rules and supplied
post-treatment curves. The importer translates those into explicit browser
treatments and records its completed volume-accounting assumption. Ambiguous
multi-stage transitions require normalized JSON instead of an arbitrary choice.

### Aligned GeoTIFF overlays

After loading a project with a grid, import one of these roles:

- **Salvage:** one band of nonnegative m³/ha dead-volume density.
- **Blocks:** one band of positive integer block IDs. Replacing blocks removes
  old adjacency/landing relationships; those cannot be reused for different blocks.
- **Zone:** one integer categorical band and an explicit zone name.
- **Harvest period:** one band of one-based period numbers; zero explicitly
  means no scheduled harvest.
- **Harvest schedule:** one band per period; positive values select cells.
  Existing inventory block IDs are retained in reports. Import a block raster
  separately if source labels are meant to define block grouping.

Projection, dimensions, origin, cell size and pixel-area convention must match.
NoData within an inventory cell is rejected rather than treated as zero. There
is no silent reprojection, interpolation, downsampling or coastline masking.
An explicit raster schedule changes the run mode to `schedule` and extends the
horizon if needed; it does not shorten an existing horizon.

## Deliberate model differences

The source is a collection of SpaDES events and SQL, with several incomplete or
inconsistent branches. This browser version is named `pgmaps-castor-1`; it must
not be presented as an interchangeable R execution.

- Default growth timing retains the R midpoint convention, including ties-to-even
  rounding: a five-year interval initially advances two years, then five years
  on subsequent growth events. Period-end timing is an explicit alternative.
- Yield interpolation holds the last supplied endpoint. Upstream can leave a
  NULL or stale value when the next ten-year knot is absent. This correction is
  tested separately from the matching interior-knot cases.
- Constraints use consistent represented hectares and whole-cell retention,
  avoiding a silent mix of area fractions and rounded cell counts. SQL ranking
  order is checked independently where the assumptions match.
- The arbitrary upstream candidate limit `target / 50` is removed. Priority and
  indivisible-unit/prefix behavior still explain possible shortfalls; there is
  no claim of an optimal global harvest schedule.
- Before/after constraint reports, complete multi-period event histories,
  partial-cut removal accounting and salvage balances fill upstream reporting
  gaps. Prescribed schedules retain the browser's constraints/reserve checks,
  whereas the original follow-schedule event bypasses normal constraints.
- Sensitivity assumes one mean-one lognormal multiplier shared by all periods
  within a replicate, representing systematic yield error in the already chosen
  plan. It does not recalibrate the growth curves, rerun scheduling or implement
  a fitted gamma model.
- Optional distance updating uses proximity to new clearcuts and the supplied
  starting distances. It does not replace disturbanceCastor's road and recovery
  calculations, fireCastor, caribouSurvivalCastor or roadCastor.

The optional `runCoCela` hook calls an external Java class that is not bundled
with forestryCastor and is not scheduled by its normal event dispatcher. It is
not represented as a working browser feature. Private PostgreSQL raster
preparation and locally calibrated growth/uncertainty data remain input tasks.

## Limits and verification

Limits are enforced by `CASTOR_LIMITS` in `validation.ts` and the import adapters:

| Budget | Limit |
| --- | --- |
| Inventory | 50,000 cells |
| Horizon | 100 periods |
| Cell × period combinations | 2,000,000 |
| Constraint cell-period work | 40,000,000 |
| Harvest events | 250,000 |
| Flow candidate visits | 40,000,000 |
| Spatial coordinates | 500,000 |
| Local input batch | 20 files, 64 MB total |
| Regular grid | 2,000,000 cells |
| Raster import | 100 bands and 2,000,000 cell-band combinations |

These are workload guards, not a measured promise that every allowed combination
will be comfortable on every phone. Province-wide rasters should be prepared as
bounded study areas. Large source preprocessing is distinct from browser scenario
calculation.

Run the relevant checks from PGMaps:

```sh
python scripts/forestry-castor/reference/generate.py --check
npx vitest run src/features/forestry-castor
npx tsc -b
npx eslint src/features/forestry-castor src/pages/forestry-castor src/pages/DevForestryCastor.tsx
npx vite build
```

The dedicated `forestry-castor.yml` workflow serves the actual production build
and tests the compiled worker, original same-origin SQLite bytes, SQLite Wasm,
actual rendered map features, period selection, complete downloads, GeoTIFF
read-back/reimport, stale-result handling, scenario comparison, local recovery,
malformed input handling and phone layout. It repeats the same acceptance suite
against the standalone subpath build. Sample responses and calculation results
are not intercepted by fixtures.

Reference fixtures execute SQL extracted from the pinned R source and resolved
source ordering templates using Python's independent SQLite runtime. They do not
load R/SpaDES or prove complete end-to-end parity. Operational model validation
requires an agreed inventory, the full relevant dependency chain, calibration
inputs and reference R simulations.
