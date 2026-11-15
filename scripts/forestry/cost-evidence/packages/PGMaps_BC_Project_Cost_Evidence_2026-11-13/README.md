# PGMaps — BC consultant, contract and project-cost evidence

Reviewed **2026-11-13**. Public-source research supplement to the earlier supplier/appraisal data package.

## Contents

| File | Contents |
|---|---|
| `contract-awards.json` | 14 disclosed initial contract maxima, with contract IDs, dates, contractors, scope and sources |
| `crossing-project-costs.json` | 14 bridge, culvert and deactivation cost records, including two itemized examples |
| `consultant-estimates-and-unit-rates.json` | 5 consultant estimates and 26 selected unit-rate observations |
| `context-quality-issues-and-follow-up.json` | Annual accounts, funding context, unresolved totals and 7 unverified discovery leads |
| `source-register.json` | Primary sources and page/profile locators |
| `validation-summary.json` | Record counts, arithmetic checks and preserved discrepancies |
| `BC_Project_Cost_Findings.md` | Findings, comparison guidance and proposed PGMaps use |

## Interpretation

All figures remain in their original cost basis. An estimate, an initial maximum at award, an amended maximum, a reported completed-project cost, an approximate construction cost, and an annual accounting expense are distinct observations. CAD is explicit in government disclosures; for some project profiles it follows the Canadian source/project context.

No inflation adjustment, regional average, road-kilometre price, or automatic change to an estimate has been made. A missing amount, quantity, tax basis or region assignment stays unknown. Price years are separate from report/publication and review dates.

The data is a research package for a reviewed catalogue update. It is not an existing PGMaps import schema or a change to the app. Compare work with matching specifications and cost boundaries. A source URL and locator accompany every core record or its linked source record.

## Key field rules

- `cost_status` / `cost_kind`: use as the visible price-status badge.
- `candidate_natural_resource_region`: provisional location-based filter; not an appraisal road group.
- `unit_rate: null`: no defensible unit rate was disclosed or derived.
- `estimate_date`, `cost_year`, and `cost_year_basis`: retain together. BGC's 2022 report uses mixed earlier BC/Alberta prices.
- `source_locator`: one-based PDF page, printed page or numbered project profile, as stated.
- `quality_flags`, `comparison_status`, `basis`: display before treating a figure as comparable.
- `use: context_only`: keep available for source review, excluded from any default unit-rate suggestion.
- `published_totals`: as printed; source rounding and known errors remain visible.
- `automatically_apply_to_estimate: false`: evidence browsing should preserve the current project estimate.

Do not use restored fish-habitat kilometres as constructed road length. Do not merge Freeman Creek's single-bridge report with the wider two-bridge Freeman Creek and Meadow profile. Do not merge the 2020 and 2021 Canyon Creek contracts without confirming their locations and scopes.
