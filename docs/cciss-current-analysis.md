# CCISS browser analysis

The CCISS page is `/dev/forestry/cciss-suitability`. It has four related
analysis workflows. Their inputs and scientific coverage must remain distinct.

| Workflow              | Inputs                                                                                        | Available calculations                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy analysis       | Prepared numeric rasters, reference lookup and regional summaries                             | Point species comparison, individual model/scenario/run comparisons, BGC/site-series changes and named-region persistence/expansion. Results retain the provisional legacy codebook warning.             |
| Species report        | Shiny CSV, or a ZIP containing one or more CSVs                                               | Original vote proportions and summaries; current-period summary reweighting where complete votes support it; silvics; printable HTML and full-import JSON/CSV exports.                                   |
| Current data analysis | Local pilot JSON, optionally packaged with matching ecological tables                         | Weighted BGC probabilities; exact point-to-imported-site lookup; with compatible tables and an explicit version assertion, site-series overlap, species votes and period summaries.                      |
| Comparisons           | Saved result snapshots or exported analysis JSON; original Shiny CSV/ZIP for reference checks | Frozen A/B sites/settings, aligned differences and plots, original-reference field checks, and a bounded historical published-class consistency check. See [the comparison guide](cciss-comparisons.md). |

All local imports remain in the browser. Closing an analysis dialog releases its
imported workflow state; saved comparison snapshots remain until the page closes
or reloads. Exported comparison JSON can restore those snapshots. Imports are not
uploaded or embedded in shared links.

## Current-data handoff

`vendor/bcdatamapper/datascrapers/bc/cciss/export-current-pilot.sql` prepares an
owner-run, read-only export for 1–25 sites. It has **not** been executed against
the CCISS database here. The owner must confirm the actual schema and execute
it through their authorized connection. Do not reuse credentials found in source.

The raw `cciss-current-pilot-v1` export preserves:

- Requested site IDs and geometries in WGS84.
- Ordered GCM/scenario/period/run dimensions and exact BGC codebook.
- Future and novelty arrays, observed predictions and baseline attribution.
- Export checks and original array ordinals.

The browser validates these relationships rather than guessing array order,
mapping unknown code labels, or choosing a nearest site. Shared polygon edges
can match multiple sites and require an explicit site selection. The pilot covers
only its imported geometries, not every point in BC.

For species calculations, package an explicit provenance JSON and an ecological
attachment with the source-compatible `E1`, `E1_Phase` and `S1` schemas:

```sh
python vendor/bcdatamapper/datascrapers/bc/cciss/pack-current-pilot.py \
  --pilot /path/to/pilot.json \
  --provenance /path/to/provenance.json \
  --ecology /path/to/ecology.json \
  --output /path/to/current-analysis.json
```

The packer is deterministic and contacts no database. Its README documents
required provenance and ecological fields. It deliberately rejects the public
development package's different lowercase/split-species schema rather than
silently renaming it. Reference tables already converted in `current-reference`
are useful resources, but are not established deployed-version substitutes.

Import the resulting file through **Open current data analysis**. Choose a site
and site series, then select models/scenarios or set their relative weights.
Advanced options include novelty cutoff, out-of-range inclusion and current
establishment/maturation period weights. Available controls come from the bundle.
Outputs include BGC probabilities, overlap and species tables, capability status,
provenance, and printable HTML/JSON assessments. Missing inputs withhold their
dependent outputs; they are not filled from the visible map.

The source-stage port follows the pinned public `ccissr` calculations with
current Shiny sequencing. Main-unit overlap feeds suitability; phase overlaps
are displayed separately. Novelty scales displayed votes after the conditional
species summaries are calculated. Supplier-asserted version compatibility is
recorded separately from independent validation, which remains false.

## Generalizable options

- `layers.ts` defines the published map catalogue and validates URL selections.
- `mapSources.ts` defines prepared products, exact selection matches, source
  availability and evidence types. New numeric products use registry entries.
  Image tracing is always labelled inferred display evidence.
- `workspace.ts` restores map selections and the active workflow. Inspection
  point coordinates are separate from camera coordinates, so panning cannot
  silently change a shared assessment's location.
- Legacy conditions, species, scenarios, models, runs, periods and regions come
  from its manifest/reference tables. New dataset codes do not need UI branches.
- Report summary policies explicitly identify their source periods and defaults.
  Historic identifiers are retained; unsupported periods do not acquire invented
  modern summaries. ZIP files with ambiguous result CSVs require a choice.

Local GeoTIFFs expose raw cell values with their filename. They do not inherit
the selected published map's legend. Incompatible prepared overlays are disabled,
and the selected file can be cleared to return to prepared data.

Numeric vectors use a nearest-cell-centre overview pyramid from the original
numeric GeoTIFF, separate from image traces. Distant views load reduced display
geometry; full original cells appear at zoom 8 and above. Overview picks remain
labelled generalized and the independently sampled GeoTIFF cell stays exact.

## Verification and remaining external inputs

### Source findings preserved in the implementation

- Published image tiles, numeric downloads and legacy rasters are different
  products. A matching map colour does not prove a matching numeric/model input.
- The legacy raster codebook disagrees with its bundled summaries. Reconciled
  labels remain provisional, and undocumented rating code 5 remains unclassified.
- Current species voting uses Shiny's `NoPhase` overlap. Phase display has a
  different join and preserves row multiplicities; using it for species votes
  changes results incorrectly. Novelty display scaling follows summary calculation.
- The observed source token `1991` has conflicting calendar labels in the app.
  Exact IDs are retained and calendar-dependent comparisons require explicit
  period coverage. Visible vote columns alone do not establish summary coverage.
- Original Shiny summaries and browser-reweighted summaries remain separate.
  Agreement of exported fields, or a supplier's version assertion, does not
  independently establish the model inputs or full deployed-Shiny equivalence.
- Production's service worker can answer before a browser-test route intercept.
  The synthetic manifest test blocks service workers explicitly; real-data
  production flows continue to exercise the ordinary static application.

The [comparison guide](cciss-comparisons.md) documents the actual controlled
examples, the real historical consistency counts, and reproducible report export.

Meaningful checks cover real legacy raster/table results, generalized scenarios
and site conditions, authentic historical report CSVs, ZIP selection/decompression,
shared links and local rasters. Clearly synthetic current-data fixtures check
hand-calculated weighting/overlap/summary rules, source ordering, novelty, unknown
values, point coverage, import recovery and exports. Synthetic examples are not
ecological validation sites.

An independent source review also checks current Shiny's choice of no-phase
overlap for species calculations. Source-stage tests do not establish agreement
with the deployed tool. The following remain external requirements:

1. Authentic, version-matched predictions, site grid and ecological data.
2. Expected Shiny outputs and all parameter values for contrasting real sites.
3. Confirmation of deployed table/rule versions and any transformation steps.

Full current province-wide coverage, CFRG/stocking recommendations, configurable
ruleset/flag parity, BGC aggregation, full Shiny PDF/RDS export and species outlook
pages are outside this implementation. A future province-wide export should be
served in spatial shards; the current 25 MB import limit is for bounded pilots.

Static route entry generation now includes CCISS and the other forestry pages.
This fixes direct-link HTTP status after the next normal deployment; local work
does not change the hosted site.
