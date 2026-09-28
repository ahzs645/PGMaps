# CCISS client-side analysis: conversion and required data

## Available implementation

Open `/dev/forestry/cciss-suitability`, select a point, then **Open legacy analysis**.
The browser loads a 36 KB compressed lookup table, the selected regional summary,
and two numeric GeoTIFFs on demand. It retains these resources during the page
session. No Shiny server, report import, R installation or credentials are needed.

Implemented in TypeScript:

- Point lookup: EPSG:4326 coordinates → raster cell → BGC label → selected B2/C4/D6
  site series → species rating. Select one of six actual model runs, SSP245, and
  five 20-year periods from 2001–2020 through 2081–2100. Show the 1961–1990 baseline.
- Regional persistence: `home / historical total`.
- Regional expansion: `(future total - home) / historical total`.
- Regional model runs are kept separate. No made-up ensemble or weighting.
- Missing ratings stay unknown; code 4 is explicitly unsuitable. Missing/zero
  denominators produce no ratio. Counts are grid cells, never labelled hectares.
- Download a JSON report with location, model/run, period, scenario and results.

This is an adaptation of **Development/OLD/spatial_app**, not a port of the current
site-series calculator. The modal's point estimate and named-region summary have
separate geographic scopes. Neither uses reconstructed WebP classes.

## Source discrepancy found during validation

The bundled `levels.bgc.csv` disagrees with its rasters. At Victoria, raster code 46
would incorrectly display BWBSwk3 using that file. The labelled BC summary says
CDFmm has exactly the 741 cells belonging to code 46.

The converter compares every present code's count signature across all **37 BC
BGC rasters**, including reference/observed/ensemble/member grids, against the
matching explicitly labelled rows in `PredSum.bgc.csv`. Each of the **324 present
codes** matches exactly one column; **315** differ from the bundled codebook.
The converter fails on any ambiguous/unmatched code, and records the method and
source checksums. Only the 32 reference/observed/individual-model rasters are
published for the point lookup: dominant ensemble BGC is not mean species rating.

This reconciliation is internally consistent evidence, not an authoritative
replacement codebook. Point results are labelled **provisional**. Obtain the
original version-matched codebook and ecological tables before treating them as
validated planning advice. No arbitrary index offset is applied.

Regional ratio calculations use the CSV's explicit species labels and are
independent of this raster-code repair. The old app's display-only exclusions for
rare species are not applied: the UI exposes all species columns.

## Rebuild and data ownership

Run from PGMaps with a Python environment containing numpy and rasterio:

```sh
python vendor/bcdatamapper/datascrapers/bc/cciss/prepare-legacy-analysis.py \
  --source /path/to/CCISS_ShinyApp-main
npm run data:sync-from-bcdatamapper
```

The 12.9 MB package belongs in
`vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis`. It includes:

- 32 unchanged numeric BC BGC GeoTIFFs, about 8.96 MB total (0.025° cells).
- 10 gzip JSON regional files, about 3.72 MB total. These also preserve climate,
  BGC, zone and fractional-suitability tables for subsequent views; those additional
  views are not yet implemented.
- Reference lookups, provenance/checksums, source R and its Apache licence.

The original 489 MB archive stays in Downloads. This converter packages the
subset needed for the first analysis; it does not copy the 4,961 TIFFs wholesale.
Source CSVs remain in the original download, with relative paths and checksums
recorded in the manifest. Gzip outputs are deterministic.

`public/data/cciss` is a generated app copy. Do not commit it. No R2 upload is part
of this change. The same versioned package can subsequently be served from R2;
the app currently reads its existing local/static data route.

## Exact inputs for the CURRENT Shiny calculator

The downloaded app's `app/server/generate.R:163–199` specifies the calculation
contract below. Table names containing 14 and the displayed application/model
version must not be assumed to mean the same release: obtain a consistent export.

| Input | Needed contents and role | Current availability |
|---|---|---|
| `cciss_future14_array` | Per-site future BGC predictions for individual GCM / SSP / run / period members, including array ordering and null semantics. Needed for arbitrary model weights. | Not in our converted package. |
| `cciss_current14` | Observed/historical predictions keyed to the same sites and periods. | Not obtained. Legacy baseline raster is a different product. |
| `cciss_novelty14_array` | Novelty values aligned to those predictions; needed if novelty filtering is enabled. | Not obtained. |
| `bgc_attribution14`, `bgc14` | Site attribution and exact numeric BGC-code labels. | Need current matching export. |
| `gcm`, `scenario`, `futureperiod`, `run` | Member identifiers, period boundaries and array-index ordering. | Need dimensions matching the arrays. |
| `bc_elevation`, `bec_info`, `hex_grid`, `bcb_hres`, `bc_forest_regions` | Point-to-site ID/BGC/elevation/forest-region lookup and site-series context. | Need matching spatial extracts or an equivalent prepared point lookup. |
| `E1`, `E1_Phase` | Site-series edatopic overlap, including phases. | Public ccissr reference source exists; deployed revision must be pinned. Not included in this legacy package. |
| `S1`, `R1`, `F1` | Species suitability, decision rules and feasibility flags, with out-of-range handling. | Need tables from that same pinned ccissr version. Legacy SuitLookup is not a substitute. |
| Stocking / silvics tables | `stocking_standards`, `stocking_info`, `stocking_height`, tolerance/resistance/regeneration/maturity references. | Need matching package exports for the complete report. |
| Parameters + validation cases | Exact ccissr revision; GCM/SSP weights, establishment/maturation period weights, novelty cutoff, out-of-range option; authentic results for a few contrasting sites. | Application logic available; full version-matched validation bundle not obtained. |

The desired normalized browser export has: site ID and point lookup; historical
and future member predictions keyed by site/GCM/SSP/run/period; optional novelty;
small shared ecological tables; version/checksum metadata. Split large prediction
arrays geographically so a point calculation downloads only its shard. Keep
array members, not only aggregate suitability, to support user-adjustable weights.

Then port `edatopicOverlap` and `ccissOutput`, including their helper semantics,
into a Web Worker and compare every output field against authentic Shiny cases.
A CSV Shiny report is a validation/result-display input, not the prediction dataset.
RDS contains more report state but needs conversion to browser-readable structures.

## Verification and limits

Unit checks cover original-TIFF sampling against rasterio values, corrected code
indexing, CSV rating lookups, absent versus unsuitable, real-data regional formulas,
shuffled row joins, and zero baselines. Browser checks load the real local package,
change conditions/region and download a report. Basemap and external image tiles
are stubbed in the browser test; analysis data are not.

Validation passed: six unit tests, one real-data browser flow, TypeScript and focused ESLint checks. All 46 output files were byte-identical on a second conversion.

R was not installed in the test environment. These are source-formula and original
numeric-input comparisons, not a claim that the current Shiny engine was executed
or that its final site-specific report has been reproduced.


## Follow-up: public current reference inputs acquired

See [the acquisition results](cciss-current-inputs.md). The 27 public reference
tables are now archived and converted. A schema mismatch prevents treating them
as deployed-version matches; the exact site grid and prediction arrays still
require a matching export. A bounded SQL export and structural validator are ready.

## Shiny-style report and browser summary stage

Open **Open species report**, or use `?analysis=report` on the dev page.
This is a separate result-file workflow, independent of the map point.

| Source function | Browser status |
|---|---|
| Species probabilities by period | Displays imported `1`, `2`, `3`, `X` proportions; preserves missing values and original period IDs. Novelty columns are shown separately. |
| Establishment/maturation summaries | Recalculated from complete current-period exported votes with adjustable period weights. |
| Stable/improving and declining/unsuitable | Reproduces the source's unweighted mean across the four future periods; changing period weights does not change these percentages. |
| Original Shiny summary | Preserved separately when the CSV contains `EstabFeas`, `ccissFeas`, `Improve`, `Decline`. Browser weights do not overwrite it. |
| Silvics | Tolerance, resistance, regeneration and maturing references from the public package, joined by exact tree code. |
| Report download | Printable HTML with source, site/series, votes, original summaries, browser summaries and weights. Not the source PDF template. |
| New-site BGC prediction and edatopic overlap | Still unavailable: matching per-member predictions, site grid and ecological versions are required. |
| GCM/SSP reweighting, novelty recalculation, stocking recommendations | Not implemented by this result-import workflow. Aggregate exported votes are insufficient for recomputing these. |

### Real example and import

**Load published example** uses the unchanged Williams Lake raw table from
`bcgov/ccissr` commit `a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce`.
The compressed download is 14,063 bytes. It contains historical identifiers
1975/2000/2025/2055/2085; these are deliberately not mapped onto modern periods.
Consequently this example displays its actual votes but no modern summary.

A current Shiny `cciss_export.csv` is the useful import: generate results in
Shiny, export CSV, unzip and choose that file. Processing stays in the browser.
RDS and ZIP are not parsed. CSVs are limited to 5 MB / 50,000 rows. Invalid
proportions, duplicate keys and malformed fields produce an error; the last valid
report is retained.

The calculator ports the summary formulas in `ccissr/R/feasibility.R` and
`src/ccissdev.cpp` (Apache-2.0), not the prediction or site-series overlap stages.
It uses scores 1/2/3/5, the establishment residual adjustment, R ties-to-even
rounding, and the app's default period weights (0.25/0.25/0.5 and
0.1/0.3/0.3/0.3). It normalizes each weight group as the Shiny UI does.
Required periods are 1961, 1991, 2021, 2041, 2061, 2081.
Incomplete, rounded-to-an-incomplete-total, all-zero, or novelty-scaled votes
withhold browser summaries. In `generate.R` novelty scales display votes after
source summary calculation; treating those scaled votes as ordinary probabilities
would give wrong results. Original exported summaries remain viewable.

### Rebuild and verification

```sh
python3 vendor/bcdatamapper/datascrapers/bc/cciss/prepare-report-example.py
# Add --download to acquire the checksum-pinned CSV from its public source.
npm run data:sync-from-bcdatamapper
npx vitest run src/pages/cciss/shinyReport.test.ts
```

The converter and example belong to `bcdatamapper`; `public/data/cciss` remains
generated. No upload or deployment is part of this change.

Six unit tests cover the real source CSV, independently hand-calculated test
vectors, ties-to-even, weight normalization, baseline-unsuitable direction cuts,
novelty, missing values and corrupt/duplicate inputs. The browser test
`tests/e2e/cciss-shiny-report.spec.ts` loads the real package, checks species and
silvics views, downloads HTML, then imports an explicitly synthetic current-format
fixture to test reweighting and error handling. External basemap/image tiles are
stubbed; the actual analysis/reference files are served locally.

TypeScript and focused ESLint checks pass. This is source-formula verification;
R/Shiny was not executed, and a complete current Shiny real-site parity test still
requires an authentic version-matched input/output bundle.
