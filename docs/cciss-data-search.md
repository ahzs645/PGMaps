# CCISS input search: parallel audit, 2026-09-27

Three agents searched official datasets/reports, repositories/upstream generation
projects, and public app/tile downloads. The parent additionally searched research
DOI records and the original research archive. These were read-only searches; no
external messages, database connections, credentials from source, or bulk data
downloads were used. No application calculation changed during this audit.

## Main finding: full members are retained but the public maps use a subset

The official [Biogeoclimatic Projections technical report](https://bcgov-ffec.ca/cciss-docs/downloads/TR_BGC_Projections.pdf#page=12)
(printed page 8, PDF page 12) describes 122 simulations from 13 models, with 1–3
runs and four scenarios. It says individual members are retained for downstream
CCISS analyses. A balanced set of 60 produces the map vote winners; public access
to all 122 is described as infeasible, with five representative simulations
provided instead. This is stronger evidence for why public map downloads do not
supply a member-complete calculator dataset. It does not establish the exact
contents/version of the currently deployed `cciss_future14_array`.

The [catalogue API](https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=biogeoclimatic-projections)
continues to link the data resource to the app with `size: null`. The 3,253,035-byte
resource is a PDF, not the prediction dataset. No full input storage size or
prediction-site count was found. Training-sample counts and exported raster
resolution must not be substituted for deployed prediction-site count.

## Repository leads

- [bcgov/CCISS](https://github.com/bcgov/CCISS): upstream workflow leads to the
  grid, model-building and portfolio-alignment repositories.
- [bcgov/BC_HexGrid](https://github.com/bcgov/BC_HexGrid): generation workflow,
  not the exported model grid. The investigated main tree has eight files;
  `.gitignore` excludes `BigDat/`, `BGC_models/`, `outputs/` and `maps/`.
  The workflow references a local `BC_HexPoints400m.gpkg`, not a public grid file.
- [bcgov/Build_WNA_BGC_model](https://github.com/bcgov/Build_WNA_BGC_model):
  excludes `inputs/`, `outputs/`, `hexpolys/`, `BGC_models/`. No grid/model release
  found in either upstream repository.
- [bcgov/CCISS_ShinyApp](https://github.com/bcgov/CCISS_ShinyApp) and
  [bcgov/ccissr](https://github.com/bcgov/ccissr): searched branches/history and
  assets did not yield current arrays. The public deployment script uses an
  unpinned ccissr development branch. Earliest S1.rda revisions checked also have
  the newer lowercase schema; no evidence resolves the deployed-table mismatch.

## Additional downloadable historical archive

[Zenodo 3550035](https://zenodo.org/records/3550035), DOI
`10.5281/zenodo.3550035`, is **whmacken/2019_CCISS v1.1**. Its
[public API](https://zenodo.org/api/records/3550035) reports one ZIP:

- `whmacken/2019_CCISS-v1.1.zip`: **100,461,120 bytes (100.46 MB)** compressed.
- The [GitHub v1.1 tree](https://api.github.com/repos/whmacken/2019_CCISS/git/trees/v1.1?recursive=1)
  is not truncated and lists 40 files.
- It includes `inputs/BGCv11_AB_USA_16VAR_SubZone_RFmodel.Rdata` (44,865,180 bytes),
  `inputs/BC2kmGrid.csv` (10,239,331 bytes), other regional grids,
  `Edatopic_v11_7.csv`, `TreeSpp_ESuit_v11_18.csv`, stocking tables and R scripts.

This is a potential starting point for reproducing the **older research workflow**.
It is not a verified complete runnable environment, a current site-grid export, or
a compatible replacement for the current Shiny model. The ZIP was not downloaded;
file sizes and contents were checked via Zenodo metadata and the GitHub tag tree.

A different DOI lead, Zenodo 15519303, was ruled out: its CCISS acronym refers to
unrelated butterfly research funding, not BC forest species selection.

## Public map downloads and version differences

[Official spatial instructions](https://bcgov-ffec.ca/cciss-docs/Instructions.html#export-data-from-cciss-spatial)
describe 200 m province/district/FLP GeoTIFF exports of the active map layer.
Those remain useful numeric spatial products, but do not establish access to all
model members. The source Shiny handler reads `cciss_download` and writes INT2S
rasters. [Tile metadata](https://tileserver.thebeczone.ca/data/NewFeas_1961_1990_ref_C4_Pl.json)
provides WebP tile URLs, zooms 5–12; its TIFF description is a server filesystem
path, not an exposed numeric download URL. Some live app/root requests returned
403, so fresh generated raster download sizes were not measured in this audit.

Current published instructions describe different establishment periods/default
weights from the downloaded code used in our summary-stage port. Treat those as
distinct versions until authentic input/output cases verify their alignment.
The existing UI correctly labels its weights as coming from the downloaded source.

## Actionable next step

The strongest route for current-model parity remains a version-matched export
from the data owner: first a few real sites, then spatially partitioned provincial
data. The official [feedback page](https://bcgov-ffec.ca/cciss-docs/Feedback.html)
provides contact and GitHub issue routes. A concrete request and read-only pilot
export are already described in [current-inputs](cciss-current-inputs.md).
Nothing has been sent to the owner.

Public downloads allow the smaller representative-member or historical workflows;
those must retain their own model/version labels. Full current calculation and
its compressed deployment size remain unverified without the missing export.
