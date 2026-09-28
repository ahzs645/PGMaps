# BC economic dependencies project

## Decision

Implementable now as a regional-district `story-map-v1` project. The initial
package is `public/data/projects/bc-economic-dependencies.json`, available at
`/dev/projects/bc-economic-dependencies`. It reuses existing geometry, attribute
joins, category fills, highlights, selection details, legends and navigation.
No renderer changes are needed for this first version.

Each scene recolours one persistent layer through `layerOverrides.category`.
During review, switching separate layer identities that share one source exposed
an existing `MapFillLayer` lifecycle issue: changing `layerOrder` recreates the
source, while the unchanged data effect does not repopulate it. The single-layer
configuration avoids that path and uses the renderer's documented style-override
contract. A broader explorer should keep its metric changes on the same layer.

The seven scenes cover 2020 forestry income dependency, Fraser-Fort George,
economic diversity, forest vulnerability, 2021 resident employment location
quotients, the 2015 dependency baseline and the 2015–2020 percentage-point change.
All 29 regional districts/statistical equivalents can be selected on the map.
This is a historical model interpretation, not an economic forecast.

## What was verified

- Downloaded the official 2025 LAEP toolkit and all 12 CSV resources from the
  [BC Data Catalogue](https://catalogue.data.gov.bc.ca/dataset/local-area-economic-profiles-dataset).
- Compared seven published output tables against the workbook's cached values,
  using row keys rather than file order. All 402,990 inspected nonblank cells
  agree at the CSVs' displayed precision. This is publication consistency, not
  independent validation of the economic model.
- The five imported indicator tables each have 399 unique geography/name/year
  keys: 103 EDAs, 29 RDs and BC for 2010, 2015 and 2020.
- The 29 RD joins match existing census-division IDs exactly, with explicit
  aliases for historical/source names. Geometry is reused without alteration.
- Missing, suppressed and unreported values retain separate statuses; they
  never become numeric zero. Each record retains both reference and census year.
- Deterministic rebuilds and source checksums are tested. The suspect cleaned
  input files do not feed the displayed indicators.

Audit code and source archives live in
`vendor/bcdatamapper/datascrapers/bc/laep/`. The optional read-only workbook audit
requires `openpyxl`; acquisition, normalization and tests use Python's standard
library. See that directory's README for commands and interpretation details.

## Sources and remaining issues

| Issue | Evidence | Consequence |
| --- | --- | --- |
| Cleaned census input duplication | All 425 numeric row arrays match between the published 2010 and 2015 cleaned-input CSVs, despite differing period and NAICS labels. | Archive them for audit; use published outputs. Rebuilding the model requires resolution against original census IVT files. |
| Local-area boundary conflict | The 2020 concordance assigns “Moricetown 1”, population 253, to Cassiar Corridor as `5949830`. Statistics Canada identifies Moricetown as `5949817`. Cassiar's concordance sum is 1,889 versus the published 1,636. The toolkit repeats the inconsistency. | Do not fix by name substitution, silently omit a member, or infer a reassignment. Defer full EDA geometry until reconciled. |
| Local-area spelling drift | The concordance uses “Fort St. James - Staurt”, while indicators use “Stuart”. | Use explicit aliases and stable area numbers; never positional joins. |
| NEDD local supply shares | No equivalent same-named output table exists in the newer release. Demand Sources measures related concepts but is not demonstrated to be equivalent. | Defer this metric; do not relabel demand percentages. |
| Old versus new release | NEDD cites a 2023 toolkit; this project uses the 2025 publication. | Do not mix historical values or thresholds from the old dashboard into the new series. |

Original [custom census IVTs](https://catalogue.data.gov.bc.ca/dataset/084f7cab-0f47-40a7-86bf-3e112856cad6)
are available for 2011, 2016 and 2021. The technical report explains that income
uses the preceding tax year, while employment and LQs refer to the census year.
The model estimates employment by residence rather than workplace. Monetary
comparisons require inflation context. FVI is normalized within comparison groups
and periods; it is not a probability, and RD/EDA values must not share a ranking.

Useful supporting sources:

- [Technical report](https://www2.gov.bc.ca/assets/gov/data/bc-stats/laep-products/local_area_economic_profiles_2025.pdf), pp. 51, 60–69.
- [Excel toolkit](https://www2.gov.bc.ca/assets/gov/data/bc-stats/laep-products/local_area_economic_profiles_2025_toolkit.xlsx).
- [Statistics Canada 2021 CSD concordance](https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/ipp-ppa/about-apropos/tab-band-bande.cfm?LANG=E).
- [Open Government Licence–BC](https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc).

The official 2025 data catalogue specifies OGL–BC. NEDD's non-commercial
permission for its older toolkit does not govern this independent import. Keep
BC Stats and Statistics Canada attribution visible; do not copy CityViz assets.

## Broad explorer implementation

### What is actually blocked, and what would resolve it

Neither issue prevents a regional-district explorer using the published outputs.
The duplicated cleaned inputs block independently rebuilding the model; they do
not block displaying the published historical indicator series. The geography
issue blocks claiming a complete, verified local-area polygon map. Local-area
tables and charts can still use the published area labels without inventing
boundaries.

For the boundary conflict, obtain a corrected, release-specific EDA-to-census-
subdivision concordance or an authoritative explanation from BC Stats. It must
identify the intended EDA and CSD ID for the Moricetown row, explain the 253-person
difference in Cassiar, and state whether the published indicator totals need any
revision. A valid StatCan ID alone does not establish LAEP area membership.
Then validate all member IDs against the correct census vintage, check for
duplicate assignments and unexplained gaps, reconcile published totals allowing
for documented census rounding/suppression, and dissolve the verified members
into polygons. Keep any official correction as a versioned source artifact.

For the duplicated inputs, obtain corrected 2010/2015 cleaned CSVs and their
transformation notes, or reconstruct those inputs from the original 2011/2016
custom census IVTs using the documented geography, industry and suppression
rules. Compare keyed values and published totals, then reproduce the model before
calling it independently validated. If BC Stats confirms an export-only error,
record that evidence and whether published outputs are affected.

The catalogue API checked on 27 September 2026 lists Jeff Dean
(`Jeff.Dean@gov.bc.ca`) as data manager. A focused query would ask:

> In the 2025 LAEP release, which EDA and CSD ID should the Moricetown 1 row
> belong to, and why does Cassiar's member population total 1,889 while its
> published population is 1,636? Can you supply a corrected area concordance?
> The 2010 and 2015 cleaned census CSVs also have identical numeric arrays
> across 425 rows. Can you provide the corrected inputs/transformation notes
> and confirm whether either issue affects the published output indicators?

This is a draft query only; no message has been sent. No account credentials or
additional user files are required to continue the published-output explorer.

A full NEDD-style project is feasible, but the existing `map-explorer-v1` adapter
only handles research records and point locations. It cannot yet express the
required numeric polygon explorer just by adding project JSON.

The next implementation should add a reusable `area-indicators-v1` adapter and
feature contracts, not a special NEDD route or another workspace type:

1. **Data contract:** stable geography IDs, reference/census year, industry ID,
   metric ID, unit, numeric value, suppression flag and source release. Preserve
   NAICS/sector concordances and the separate RD/EDA/province universes. Include
   the BC benchmark without rendering it as another overlapping polygon.
2. **Reusable controls:** metric, industry, geography and year selectors in their
   own `features/` files. Use shared sidebar, select, alert and statistic blocks.
3. **Map:** one joined polygon source with metric-dependent fill and an explicit
   legend. Fixed comparable scales across periods, visible missing-data treatment,
   and selected-place state shared with the ranked list.
4. **Comparison:** a sortable area list and selected-area profile showing the BC
   benchmark, sector mix and three-period series. Clearly distinguish percent
   from percentage-point changes and show nominal-dollar context.
5. **Downloads/provenance:** export the filtered table with units, geography,
   period and suppression flags, and retain direct links to official inputs.
6. **Later impact tools:** EIR controls must explicitly select local/total impact,
   indirect/induced effects and social-safety-net assumptions. Avoid summing
   multipliers across regions or presenting hypothetical estimates as forecasts.

Parser types/defaults, feature docs, skill references, parser tests and a real
project package must change together when those capabilities are added. Validate
every selector, legend, map join, comparison and download on desktop and phone.

## Ownership and deployment

The scraper submodule owns scripts, compressed sources and deployable outputs.
PGMaps owns the project package and source-to-public sync mapping. Generated
`public/data/bc/laep/` is ignored. Commit/push the scraper change before updating
the parent gitlink; recursive submodule checkout is required for deployment.

Local preview does not publish the project. The first version deliberately uses
RD geometry, while all 103 local-area indicator series remain available in the
scraper output for subsequent reviewed development.

## Validation

The repository-ready package audit and generated index check pass. Six Python
data tests and 43 relevant Vitest tests pass, as do TypeScript compilation and
the production Vite build (with existing bundle-size warnings). Browser review
covered all seven scenes in both directions on desktop and a 390 × 844 phone
viewport, selected-district details, thematic legends and the expanded mobile
narrative sheet. The reviewed browser session reported no console errors or
warnings. This is local validation; the project has not been deployed.

The package now uses `workspace.map.basemap: "auto"`, so the map follows the
application's light/dark theme rather than forcing the light basemap. The same
indicator thresholds and category colours apply in both themes.
