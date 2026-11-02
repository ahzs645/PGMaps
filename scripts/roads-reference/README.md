# Native R differential checks for the browser road planner

This harness executes the **original installed R package**, then compares its
outputs with PGMaps' actual TypeScript exports. It complements the fast
source-derived unit fixtures with an independent runtime comparison.

The reference is `LandSciTech/roads` version **1.2.2**, commit
[`08c462de51076b550473cb709da633314c32cd87`](https://github.com/LandSciTech/roads/tree/08c462de51076b550473cb709da633314c32cd87).
`generate-reference.R` refuses an installation whose recorded GitHub SHA or
package version differs. Installing the same numbered CRAN release is insufficient
because it does not establish the reviewed source revision.

## What gates acceptance

The native reference calls `roads::simpleCostFn` and `roads::gradePenaltyFn` on
25 shared cases in `cases.json`: ordinary weights, diagonals, missing values,
zero-road quirks, negative barriers, symmetry, grade-limit boundaries, explicit
over-limit weights and custom parameters. Non-finite results are encoded by
kind; missing values cannot silently become zeros.

It opens `roads::CLUSexample` through `roads::prepExData`, executes actual
`roads::projectRoads` for **LCP, MST and snap**, and extracts the projected road
cells with the same `sf`/`terra` method as the upstream
[`test-projectRoads_CLUSexample.R`](https://github.com/LandSciTech/roads/blob/08c462de51076b550473cb709da633314c32cd87/tests/testthat/test-projectRoads_CLUSexample.R).
The comparator checks both the fixture inputs and the result cell sets. Formula
values use relative/absolute tolerance `1e-12 × max(1, |R|, |TypeScript|)`; cell
sets and missing states must match exactly. A missing case, wrong revision,
missing native session evidence or mismatch exits non-zero.

**Informational diagnostics** also execute one-shot ILCP and a two-period ILCP
continuation in R, comparing them with the TypeScript simulation. Their full
results and mismatch flags remain in `comparison.json`. They are not acceptance
gates: a staged native `sf` network selects continuous vector nearest points,
while the browser uses raster centres, and these may differ at geometric ties.
This distinction is explicit rather than silently treating any mismatch as
universal compatibility or incompatibility.

These checks do not cover every R object representation, polygon sampler,
`terra` raster boundary convention, large dataset or documented browser repair.
They do not validate construction costs, road safety or actual surveyed geometry.
See [the compatibility inventory](../../docs/forestry-road-design/roads-package-compatibility.md).

## Run locally

Use a working native R installation and the system libraries required by `sf`
and `terra` (including GDAL, GEOS, PROJ and UDUNITS). From the PGMaps root:

```sh
Rscript -e 'install.packages("pak", repos="https://cloud.r-project.org")'
Rscript -e 'pak::pkg_install(c("jsonlite", "github::LandSciTech/roads@08c462de51076b550473cb709da633314c32cd87"), dependencies="hard")'
git submodule update --init --depth 1 packages/geo-toolkit vendor/json-url
npm ci --ignore-scripts
Rscript scripts/roads-reference/generate-reference.R
node --import tsx scripts/roads-reference/compare-reference.ts
```

The default output directory is ignored by Git:

- `output/native-r.json`: actual R results, pinned package revision, R/package
  versions, spatial library versions and generation time.
- `output/r-session.txt`: complete `sessionInfo()` for troubleshooting.
- `output/comparison.json`: every assertion, TypeScript result and staged diagnostic.

Both scripts accept explicit input/output paths:

```sh
Rscript scripts/roads-reference/generate-reference.R scripts/roads-reference/cases.json /tmp/roads-native-r.json
node --import tsx scripts/roads-reference/compare-reference.ts /tmp/roads-native-r.json /tmp/roads-comparison.json
```

To validate only the shared case manifest and source pin without installing R:

```sh
node --import tsx scripts/roads-reference/compare-reference.ts --check-config
```

That command expressly **does not** generate native reference evidence or pass
the differential comparison.

## Continuous integration

`.github/workflows/roads-reference.yml` runs on relevant pull requests, pushes
to `main` and manual dispatch. It installs R 4.5, the pinned `roads` source and
its required dependencies with `r-lib/actions`, runs both scripts and preserves
the output directory as `roads-native-r-reference`. The R action revision is
pinned; the installed package/spatial dependency versions are recorded in each
reference rather than falsely described as a frozen dependency environment.

Only the two local npm dependency submodules are checked out. No application
build, public data download, deployment or write access is required. First runs
can take time to install the native spatial stack; subsequent runs can reuse the
R package cache.

## Recorded native execution — 2 November 2026

[Run 41410220228](https://github.com/ahzs645/PGMaps/actions/runs/41410220228)
successfully executed this harness against implementation
[`ce6b80e59b3c03b8596ead7cc42ca9ba8e585b83`](https://github.com/ahzs645/PGMaps/commit/ce6b80e59b3c03b8596ead7cc42ca9ba8e585b83),
using **R 4.5.3**, **roads 1.2.2** at the pinned source revision,
**terra 1.9-50** and **sf 1.1-3**.

The native package executed all **25 scalar cases** and the CLUS **LCP, MST
and snap** runs. The TypeScript comparison passed **all 40 acceptance gates**
with no failures. All three informational diagnostics matched as well:
one-shot ILCP, first-period ILCP and second-period ILCP.

The [reference evidence artifact, 13124878746](https://github.com/ahzs645/PGMaps/actions/runs/41410220228/artifacts/13124878746),
contains the actual native R output, comparison report and R session information.
This establishes runtime agreement for these cases at that implementation
revision. It does not establish universal geometry, sampling or R-object parity,
nor construction or engineering validity for real road networks.
