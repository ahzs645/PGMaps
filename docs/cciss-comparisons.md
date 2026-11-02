# CCISS comparisons

Open `/dev/forestry/cciss-suitability`. Two comparison workflows answer different
questions: how saved analyses differ, and how a current browser assessment's
fields compare with an original Shiny export.

## Compare sites, models, scenarios and settings

1. Open legacy analysis, current data analysis, or an imported species report.
2. Choose the first location and settings, then save it for comparison. An
   optional name helps distinguish cases. Saving freezes its inputs and outputs.
3. Change the location, model, scenario, site condition or supported weights and
   save another result.
4. Open comparisons and select results A and B. Search by species/period/metric,
   filter changed or unmatched rows, or select one measure.

The page retains up to 12 saved results while it is open. Results can be renamed
or removed. A reload releases this local collection. Export comparison JSON to
retain both snapshots; reimporting that file lets you choose either result to add
back. Imports are validated and derived rows are recalculated, rather than
trusting comparison claims in the file. Multi-site exported report JSON presents
an explicit result selector and does not silently fill the collection.

Probability rows include side-by-side bars on a fixed 0–100% scale. Changes are
**B minus A** in percentage points. A shift from 25% to 75% is +50 percentage
points. Suitability classes show category transitions, without treating class
steps as ecological distance. Regional persistence/expansion remain grid-cell
ratios; they are not converted into site probabilities or hectares.

Every snapshot records its scope, settings, source, version and limitations.
Missing values remain unknown. A category absent from a distribution becomes
zero only when an explicitly complete probability group establishes that zero
within the same scope. Different workflow families, methods, units, class scales
or period meanings retain side-by-side values with an incompatibility reason.

Legacy rating code 5 compares as unsuitable (class 4), and its raw code is kept
as a separate source-code metric. The original app maps every rating above 3.5
to non-suitable (`spatial_app/app.R` lines 716–724), and ccissr folds classes 4
and 5 into X. The real Victoria lookup contains code 5. Any other code outside
1–5 remains an unclassified source category with unknown ordinal rating.

The current source uses observed period token `1991` inconsistently: its report
display calls it 2001–2020 observed while the parameter UI calls it 1991–2020.
Snapshots preserve that original token with unknown calendar bounds and explain
the conflict. Numeric comparisons requiring its calendar coverage are withheld.
Each aggregate records its contributing periods, so future maturation summaries
can still compare without depending on the ambiguous observed interval.
An original summary from a truncated report remains visible, but the displayed
vote periods alone do not establish all of that summary's contributing periods.
Its aggregate delta is withheld until the required coverage is explicit.

JSON preserves exact numeric results and both snapshots. CSV and printable HTML
include aligned rows, both units/scales, changes, missingness and source context.
These are exploratory comparisons, not certificates of Shiny parity.

## Compare a current assessment with Shiny

Import a current-data bundle, choose its site/settings, and select **Compare with
Shiny**. Import the original Shiny CSV or ZIP and choose its reference site and
site series. The check compares:

- Class 1/2/3/X vote proportions and novelty for each exact original period.
- Baseline class.
- Browser establishment/maturation classes and the original Shiny summary fields.
- Browser improving/declining proportions and the original exported percentages.

It aligns exact site, series, species, period, measure and class keys. No period
crosswalk or nearest-site substitution is performed. Shiny's custom `SiteRef`
can differ from its numeric database site ID. Such labels stay unmatched until
the user explicitly confirms their relationship. The report retains both IDs
and labels the mapping as an assertion; the site series still must match exactly.
Changing the assessment/reference scope clears the previous alias confirmation.

Reference summaries are not recalculated. Novelty-scaled display votes are not
renormalized to make them match. Class comparisons are exact; the default
probability tolerance is `1e-8` (fractions), equivalent to `0.000001` percentage
points. The UI allows an explicitly chosen rounding tolerance up to 1 percentage
point. Original values and the chosen tolerance remain in exported differences.

Reports distinguish paired fields, fields within tolerance, differences and
missing values. Paired fields include differences: their count is not a match
count. Maximum absolute differences are separated by measure/unit. Versions and
settings may be unverified even if all paired numbers agree. Every comparison
therefore retains `scientificParityVerified: false`.

The same check runs offline without a browser or service:

```sh
python vendor/bcdatamapper/datascrapers/bc/cciss/compare-pilot-reference.py \
  --browser /path/to/cciss-current-analysis.json \
  --reference /path/to/cciss_export.csv \
  --reference-metadata /path/to/reference-metadata.json \
  --output /path/to/field-differences.json
```

The [data-side guide](../vendor/bcdatamapper/datascrapers/bc/cciss/reference-comparison.md)
documents aliases, checksums, metadata and exit statuses. Exit 0 means agreement
of the selected fields with no missing evidence; it does not establish scientific
parity. No live database is contacted.

## Real published-data consistency check

In **Open species report**, load the published Williams Lake example and select
**Reference checks**. The historical source includes both its vote proportions
and a published per-period `NewSuit` class. Complete, unscaled votes can therefore
be checked against that original class using the source's score/rounding rule.

For the packaged, checksum-pinned example:

| Evidence                         |  Rows |
| -------------------------------- | ----: |
| Original rows                    | 1,879 |
| Complete rows compared           | 1,580 |
| Matching published classes       | 1,580 |
| Different published classes      |     0 |
| Rounded/incomplete rows excluded |   299 |

Native historical period IDs are preserved. The excluded rows are not normalized
or repaired. Filters expose differences/exclusions and CSV/JSON exports retain
their reasons. Current wide exports can use a different score convention; this
historical class rule does not reinterpret those fields.

This is an internal consistency check on real published output, not a regenerated
climate prediction, site-series overlap, current summary or independent Shiny run.
Synthetic fixtures separately exercise weighted BGC/overlap/species calculations
and yield agreement on 70 independently hand-calculated reference fields. They
are labelled synthetic and do not validate ecological predictions.

## Controlled examples from the real legacy package

Regenerate the client overview, full printable/JSON comparisons, and checksum/
cell-extraction receipts from the checked-out application and scraper snapshot:

```sh
npx tsx scripts/cciss/build-comparison-examples.ts
# Optional: --output /path/to/review-folder
```

Outputs go to ignored `tmp/cciss-comparison-examples` by default. Open
`client-review.html` to review the controlled cases below. The extraction check
uses the manifest's grid and a direct GeoTIFF read in addition to the application
sampler; it shares the same decoder and does not independently validate ecology.

The prepared data also support a location comparison and a model comparison
without changing several inputs at once. At Prince George, holding C4 and
SSP2-4.5 fixed:

| Species / modelled period   | ACCESS-ESM1-5 / r1i1p1f1 | EC-Earth3 / r4i1p1f1 |
| --------------------------- | ------------------------ | -------------------- |
| Lodgepole pine, 2041–2060   | Low                      | Moderate             |
| Western redcedar, 2041–2060 | High                     | Moderate             |
| Lodgepole pine, 2061–2080   | Moderate                 | Moderate             |
| Douglas-fir, 2061–2080      | High                     | High                 |
| Western redcedar, 2061–2080 | Moderate                 | Moderate             |

Holding ACCESS/run, C4 and SSP2-4.5 fixed while changing the point to Victoria,
the 2061–2080 Douglas-fir rating remains High, while lodgepole pine and western
redcedar have no lookup rating. Missing ratings are not unsuitable. These are
provisional legacy outputs on the original grid; they are not current Shiny
recommendations. The two model members agreeing in one period does not establish
agreement across other models, periods or scenarios.

## What remains for full parity

Authentic current site equivalence still needs version-matched prediction/grid/
ecological inputs and expected Shiny results for the same coordinates and
parameters. The new comparison tools make differences reviewable once that
bundle is supplied. CFRG/stocking flags, full native PDF/RDS reporting, original
BEC Futures map/chart presentation and the other gaps listed in the
[browser workflow guide](cciss-current-analysis.md) remain separate work.
