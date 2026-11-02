# PEMlidr browser method audit

Reviewed [`bcgov/PEMlidr`](https://github.com/bcgov/PEMlidr) at
[`946738c4212466d8e99274f45723c6e09eb508a6`](https://github.com/bcgov/PEMlidr/tree/946738c4212466d8e99274f45723c6e09eb508a6)
(main branch commit, 24 April 2024). The repository orchestrates LiDARBC data
selection and Windows LAStools commands through R. It is a workflow reference,
not a browser library or a pinned implementation of LAStools statistics.

No LICENSE file is present at this revision, and GitHub's repository metadata
reports no license. The PGMaps extension is an independently written calculation;
PEMlidr source code and LAStools binaries are not copied into the application.
This is separate from SCRIP-LiDAR-Road-Restoration's Apache 2.0 attribution.

## What the source actually requests

| Stage                | Source settings                                                                                                                                                                           | Output and browser implication                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AOI / tile selection | `sf::st_intersection(index, aoi)` after transforming the AOI to the index CRS; index joins download URLs and a projection lookup.                                                         | Useful future AOI discovery workflow. Selecting a tile is not clipping its point cloud to the AOI. See [query function](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/functions/01_query_lidarbc.R).                                                                                                                                                                                                           |
| Preprocessing        | Actual `lastile` flags use **1,000 m** tiles and **30 m** buffers flagged as withheld; drop absolute Z below 0 and class 7; reclassify 17 and 5 to 1.                                     | The comment says 500 m, but the executable argument is 1,000 m. Buffered returns need ownership rules to prevent double counting. See [retile template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/01_retile_index.bat).                                                                                                                                                          |
| Normalize            | `lasheight -replace_z -remain_buffered`.                                                                                                                                                  | Height above ground is required before the following metrics. Ground interpolation and LAStools version are not pinned. See [normalization template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/02_normalize_index.bat).                                                                                                                                                          |
| DEM                  | `blast2dem -keep_class 2 -step 1 -nbits 32 -kill 200 -use_tile_bb`; per-tile BIL files.                                                                                                   | Native 1 m ground surface. This is not equivalent to the browser's ground-cell means with limited gap filling. See [DEM template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/03_surface_models_DEM.bat).                                                                                                                                                                          |
| CHM                  | Normalized cloud; drop class 7 and Z above 100 or below 0; `lascanopy -step 1 -p 99 -use_tile_bb`.                                                                                        | **99th percentile at 1 m** above the implicit LAStools height cutoff (documented default 1.37 m), not maximum, mean height, first-return mean or SCRIP's canopy product. See [CHM template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/05_surface_models_CHM.bat).                                                                                                                |
| Structural metrics   | Normalized cloud; `-drop_class 2 7 -drop_z_above 100 -height_cutoff 2 -step 5`; request `p10`, `p25`, `p50`, `p75`, `p90`, `p99`, `all`, `abv`, `avg`, `qav`, `std`, `cov`, `kur`, `ske`. | Native **5 m** structural products. The input is not restricted to first returns or vegetation classes; the `cov` statistic itself uses first returns. See [metric template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/07_metrics.bat) and [output names](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/metric_names.txt). |

DEM and CHM setup functions default to `res = c(1, 5, 10, 20)`; structural
metrics default to `c(5, 10, 20)`. The README-sized prose in `pipeline.Rmd`
mentions only 5, 10 and 20 m. DEM/CHM merging uses `lasgrid -highest`; structural
merging does not specify a statistic-specific weighted aggregation rule.
The templates also supply `-epsg 3005`; this flag alone does not establish that
input coordinates were transformed into BC Albers.

In particular, taking the **highest of the native 1 m p99 cells** is a different
operation from computing p99 over all returns in a new 5, 10 or 20 m cell.
Neither operation can be reconstructed from a cell mean or maximum. See the
[CHM merge template](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/LAStools_batch_files/base/06_surface_models_CHM_merge.bat)
and [CHM setup defaults](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/functions/05b_setup_CHM_file.R).

## Statistical conventions that need an explicit browser definition

The repository delegates statistics to an unpinned LAStools installation.
The official
[`lascanopy` README](https://github.com/LAStools/LAStools/blob/2f82336350bbbaa40030b9b35ec7265ebb391db8/bin/lascanopy_README.md)
(documentation revision 14 July 2026) resolves the main population meanings:

- Height percentiles and `avg`, `qav`, `std`, `ske` and `kur` operate on points
  **above the height cutoff**. `abv` counts this subset; `all` counts points
  including those below the cutoff, after input filters.
- `cov` means **canopy cover**, calculated as first returns above the cover
  cutoff divided by all first returns, expressed as a percentage. It does not
  mean coefficient of variation. The cover cutoff defaults to the height cutoff
  when `cover_cutoff` is omitted, as in PEMlidr.
- `dns`, which PEMlidr's template does not request, uses all returns in both
  numerator and denominator. SCRIP's all-return cover is consequently distinct
  from PEMlidr's `cov`, even before accounting for the 0.5 m versus 2 m cutoff.

Those current docs are not a pinned implementation of PEMlidr's 2024 executable.
Neither repository nor README specifies percentile interpolation, an executable
test for handling exactly at the cutoff, sample versus population standard
deviation, bias corrections for skewness or kurtosis, or whether kurtosis is
excess kurtosis. Exact historical parity remains unverified.

The bounded browser addition is therefore an **independent 5 m streaming
moments/counts calculation** with explicitly declared conventions: exclude
withheld/noise returns and class 2, cap normalized height at 100 m, and use a
strict **height > 2 m** subset for moments. Report mean, quadratic mean
`sqrt(sum(h²) / n)`, **sample** standard deviation with denominator `n − 1`,
eligible/above-cutoff counts and first-return cover. A supplementary coefficient
of variation is explicitly labelled separately from PEMlidr's canopy cover.
Rejecting noise class 18 is an extra browser quality filter beyond PEMlidr's
explicit class-7 exclusion. Keep these products distinct from SCRIP's mean of
normalized first returns. Mark unsupported or zero-denominator moments missing
rather than inventing zeros. The map and exported manifest describe the browser
conventions actually implemented.

Exact percentile parity is outside this implementation. Exact percentiles need
order statistics, and a bounded histogram or quantile sketch would be an
approximation with declared error/resolution. A maximum must never be labelled
p99. Ground-model differences also prevent a claim of exact PEMlidr parity,
even when the subsequent arithmetic is identical.

## Source defects and boundaries to preserve

- [`download_lidarbc`](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/functions/02_download_lidarbc.R#L40)
  has its `download.file` call commented out. Its CRS repair assigns
  `st_crs(las) = ...`; that changes metadata and does not transform coordinates.
  The browser must validate actual declared CRS and reject incompatible inputs.
- [`projection_codes.csv`](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/projection_codes.csv)
  uses compound EPSG codes 6651–6654 for UTM zones 8–11. Preserve horizontal and
  vertical references separately; do not treat a compound CRS code as a new
  coordinate system or overwrite valid source metadata from a filename.
- `pipeline.Rmd` calls `setup_retile_file`, while
  [`03_setup_retile_file.R`](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/functions/03_setup_retile_file.R)
  defines `setup_preprocess_file`. The repository has no automated numerical
  regression suite or pinned LAStools version establishing end-to-end fidelity.
- [`kmz_to_gpkg`](https://github.com/bcgov/PEMlidr/blob/946738c4212466d8e99274f45723c6e09eb508a6/functions/00_kmz_to_gpkg.R)
  reads/writes a KMZ-derived layer but does not perform the EPSG:3005 transform
  claimed in the pipeline prose.
- `functions/zarchive` contains a separate lidR approach, including pit-free
  CHM and optional PMF ground classification. It is archived code, not the
  method executed by the current LAStools templates; do not combine the two
  into one purported PEMlidr method.

LiDARBC index discovery, multi-gigabyte regional downloads, arbitrary CRS/datum
repair, buffered retiling and LAStools execution remain separate workflows.
Local browser metrics do not require ArcGIS, Windows batch execution, a new
server or silently substituted source data.
