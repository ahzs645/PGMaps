# Current CCISS inputs: acquisition results

Checked 2026-09-27. This audit acquires public reference data; it does not claim
that the live Shiny database has been exported or the current calculator is ready.

## 1. Ecological tables: acquired and converted

27 tables / 133,145 rows / 602,509 compressed JSON bytes. The converter retains
column order, nulls and values; CSV inputs retain their original lexical types and
NA markers. Source URLs, commit IDs, byte counts and SHA-256 hashes are recorded.

Two versions are deliberately separate:

- `package-*`: 23 R data objects from ccissr development commit
  `a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce` (DESCRIPTION says 1.0.3).
- `catalogue-*`: the four CSV tables linked by the BC Data Catalogue, pinned to
  the feas_tables commit `dacdf055cd45a6f4d6873e107a5b7615efd877cd`.

| Package table | Rows | Purpose |
|---|---:|---|
| E1 | 30,205 | Edatopic overlap |
| E1_Phase | 1,932 | Site-series phases |
| S1 | 15,620 | Species suitability |
| R1 | 21 | Suitability decision thresholds |
| F1 | 11 | Feasibility flags |
| stocking_standards | 11,018 | Stocking classifications |
| stocking_info | 1,549 | Stocking targets and related information |
| stocking_height | 8,071 | Species height requirements |
| silvics_tol/resist/regen/mature | 33 each | Silvics reference tables |

Other converted objects include site-series descriptions, WNA BGC attributes,
BGC regions, model information, tree codes, footnotes, CFRG rules and colours.
The separate catalogue CSVs contain edatopic (32,137 rows), suitability (15,620),
site-series (5,936) and WNA BGC information (417).

### Compatibility issue: do not silently alias the columns

The downloaded Shiny app filters `S1$OHR`, while its calculation path expects
`BGC`, `SS_NoSpace`, `Spp`, `Feasible`. The pinned development R object actually
has `bgc`, `ss_nospace`, `sppsplit`, `feasible`, `spp`, `newfeas`, `mod`, `outrange`.
This is not merely proven to be a casing change: split species, original/new
ratings and out-of-range semantics need confirmation. `ccissOutput` in the same
public source still selects the older uppercase names.

Main branch `4af55eb8136f33e6a54fadf302d60150004937b6` also has the newer schema
(15,074 S1 rows). Two historical S1 revisions checked, January 2026 and June 2025,
also use it. None is evidence of the build deployed behind the downloaded app.
The manifest therefore explicitly sets `readyForCurrentShiny: false`.

An export of the **deployed package's data objects**, or confirmation of its exact
commit and transformation steps, resolves this reference-version gap. Newer tables
should not silently replace the tested legacy calculator's tables.

### Encoding and conversion

R native strings without explicit encoding use a recorded CP1252 fallback; explicit
UTF-8 markers remain respected. Two catalogue CSVs (site_series and WNA_BGCs_Info)
are CP1252, not UTF-8. No replacement characters were introduced. data.table keys
are not execution semantics in the JSON: columns and rows are retained as data,
and future browser calculations must implement their joins explicitly.

## 2. Geographic lookups: public context available, exact model linkage missing

The public WFS exposes:

- `WHSE_FOREST_VEGETATION.BEC_BIOGEOCLIMATIC_POLY`, geometry field `GEOMETRY`.
- `WHSE_ADMIN_BOUNDARIES.ADM_NR_REGIONS_SPG`, geometry field `SHAPE`.

A tested point near Prince George (-122.7497, 53.9171), transformed to BC Albers,
returned exactly one BEC polygon (`SBSmh`) and one NR region (`Omineca`). The tests
use `INTERSECTS` on a native EPSG:3005 point. A bounding-box filter returned several
candidate polygons; do not mistake those envelope matches for point containment.
Audit receipts contain the exact URLs and property results.

These public results provide contextual BGC and administrative attribution. They
are **not** a replacement for Shiny's `hex_grid.siteno`, which links the point to
its prediction arrays. NR regions are not automatically the same classification
as the Shiny `bc_forest_regions.region_ref` used in stocking-standard attribution.

Still required for identical geographic attribution:

- `hex_grid` geometries with siteno; the same site IDs as the prediction tables.
- `bgc_attribution14` and `bgc14`, with exact code/label mappings.
- Versioned `bec_info`, `bc_elevation`, `bcb_hres`, `bc_forest_regions`, or a
  certified equivalent export. Public DEM/BEC products alone do not establish
  the same date/resolution/edge treatment.
- The exact `dbPointInfo` results for validation coordinates, including elevation,
  site_no, BGC labels, onbcland and forest_region.

## 3. Prediction arrays: not found as public downloads

The official Biogeoclimatic Projections catalogue entry links to the Shiny app
and its technical report. The inspected ccissr repository supplies functions and
small historical example results, but not a province-wide current prediction export.
Its DuckDB functions create/populate a database from input data; they are not a
bundled downloadable database. Its object-storage helper expects credentials and
a caller-supplied bucket; it is not an anonymous published dataset endpoint.
No public download was found in these sources. This does not assert that no export
exists elsewhere or that the owner cannot provide one.

Required tables:

- `cciss_future14_array`: siteno and bgc_id array.
- `cciss_current14`: observed prediction rows keyed by siteno.
- `cciss_novelty14_array`: novelty array, when reproducing novelty filtering.
- `gcm`, `scenario`, `futureperiod`, `run`: all IDs and labels, including missing
  member conventions.
- `bgc_attribution14`, `bgc14`: original BGC/site attribution and predicted-code labels.

The R query assigns array ordinal by sorting the Cartesian product on
`gcm_id, scenario_id, futureperiod_id, run_id`. Preserving that order is essential.
A tile palette or aggregate suitability raster cannot reconstruct these members.

### Concrete next input: a bounded pilot export

`vendor/bcdatamapper/datascrapers/bc/cciss/export-current-pilot.sql` is a read-only,
repeatable-read query for **1–25 real site IDs**. It exports raw arrays, ordered
dimensions, codebook, observations, attribution, novelty, site geometry and array
length checks as JSON. It has not been run against a CCISS database. The database
owner must confirm table schemas and provide authorized connection details on
their own host. No credentials embedded in public example code were used.

`validate-current-pilot.py pilot.json` rejects missing/duplicate sites, shifted
ordinals, mismatched array lengths and unknown future BGC codes. Passing this
structural check is not scientific validation or proof of version compatibility.

Ask for the following together (request prepared here; no message sent):

> Please provide a version-matched CCISS pilot export for a few contrasting BC
> sites: the future/observed/novelty arrays, ordered GCM/scenario/period/run
> dimensions, bgc14 and bgc_attribution14, and hex_grid geometries for those site
> IDs. Please include the deployed ccissr package or exact commit and its E1,
> E1_Phase, S1, R1, F1, stocking and silvics objects, plus dbPointInfo outputs and
> CSV/RDS suitability results for the same coordinates. Include the Shiny commit,
> model/data versions, all model/scenario/period weights, novelty cutoff and
> out-of-range setting. The attached SQL preserves the original array ordering.

After the pilot passes, use a full versioned export split into spatial shards.
Do not download all predictions into every browser session.

## Files and rebuild

```sh
uv run --with rdata==1.1.0 --with pandas==3.0.6 python \
  vendor/bcdatamapper/datascrapers/bc/cciss/prepare-current-inputs.py --download
npm run data:sync-from-bcdatamapper
```

Original reference files live in `vendor/bcdatamapper/datascrapers/bc/cciss/sources/ccissr`.
Browser files live in `output/current-reference`; the normal sync creates ignored
`public/data/cciss/current-reference`. There is no R2 upload in this step. The new
reference bundle is not wired into the legacy calculator, whose scientific inputs
remain its separately versioned package.

Validation: nine tests passed, including an independent R-file reader comparison
for the core ecological tables and all four silvics tables, plus malformed-export
checks. All 28 output files were byte-identical on a repeat conversion. The SQL
is a prepared handoff artifact, not a tested database integration.

## Sources

- https://bcgov-ffec.ca/cciss-docs/Resources.html
- https://catalogue.data.gov.bc.ca/dataset/biogeoclimatic-projections
- https://catalogue.data.gov.bc.ca/dataset/1810fdca-8762-4d6a-8886-4e8cefbdb640
- https://catalogue.data.gov.bc.ca/dataset/cciss-western-north-america-bec-tables
- https://github.com/bcgov/ccissr/tree/a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce
- https://github.com/bcgov/ccissr/tree/dacdf055cd45a6f4d6873e107a5b7615efd877cd/tables

## Dataset size audit (2026-09-27)

Measured logical file lengths, in decimal MB (1 MB = 1,000,000 bytes):

| Dataset | Bytes | MB | Meaning |
|---|---:|---:|---|
| Downloaded old spatial-app data | 488,832,679 | 488.83 | 5,166 files: 4,961 TIFFs and 200 CSVs, plus ancillary files. |
| Browser legacy analysis package | 12,887,741 | 12.89 | 46 files including 32 numeric TIFFs. |
| Converted public reference package | 627,769 | 0.63 | 27 compressed tables plus manifest; table payload alone is 602,509 bytes. |
| All local CCISS output folders | 46,937,125 | 46.94 | Includes the preceding browser packages and rendering experiments; overlapping total, not an additional dataset. |
| Full current calculator inputs | Unknown | Unknown | The per-member prediction arrays and matching site grid have not been acquired. |

Receipt: `sources/current-input-audit/local-dataset-sizes.json` under the CCISS
scraper directory. These are storage totals, not the size of each point request.
The browser should fetch only the needed spatial shard and reference tables.

The live BC catalogue API was rechecked: its BGC Projections data resource links
to `https://bcgov-ffec.ca/cciss/` and has `size: null`. Its PDF size is documentation,
not dataset size. The GitHub releases APIs for `bcgov/CCISS_ShinyApp` and
`bcgov/ccissr` returned no releases/assets. These checks did not reveal a full
current-array download. They do not establish that no other export exists.

`measure-current-storage.sql` is a prepared **read-only, unexecuted** query for
the database owner. It lists each required table's data/TOAST, index and total
physical size, plus approximate row counts. It flags missing relations and
partitioned/view/foreign cases instead of treating them as zero. It exports no
prediction records. Run it on the deployed database to measure source storage;
only converting an actual export will establish compressed browser-package size.

Next required external input remains the bounded version-matched pilot export
described above. The converter/client calculation cannot be completed or verified
for new current-model sites from map imagery or aggregate legacy outputs alone.

## Follow-up: parallel public-data search

See [the three-agent search audit](cciss-data-search.md) for stronger official
report evidence that public spatial products expose only representative members,
the upstream BC_HexGrid/model repository checks, and a newly identified
100.46 MB historical 2019 research archive. None supplied the current matching
prediction arrays and site grid.
