# PGMaps external road-cost references

Reviewed 2026-11-12, America/Vancouver. **53 catalogue records: 50 cost observations and 3 funding-context records**, from 13 primary numerical sources. Five further references document methods. Eight worked examples/budgets include overlapping projects.

Start with `Road_Costs_Beyond_BC.md` and `catalogue-preview.md`. The normalized dataset is `catalogue-records.json`; follow each `source_id` into `source-register.json` for scope, tax, price basis, qualifications and original source links. `original_observation` preserves the extracted facts and any explicitly derived SI equivalents.

`worked-estimates.json` exposes arithmetic; `estimating-methods.json` explains methods and proposed uses. `catalogue-schema.json` is a research schema, not an app import contract. `pgmaps-review.json` identifies inspected repository files. `corrections.json` documents the Masset regional-tag correction also applied to the earlier BC package.

Currency, date, work scope and volume state stay explicit. Null means unknown. Source verification does not imply local applicability. No exchange-rate, inflation or regional transfer factor has been applied. Sources marked as grants/funding models cannot calibrate construction prices. All records have automatic application and default-rate flags set to false.

The signed USFS estimates and official Canadian tables were checked against their source data. Validation preserves rounding and source inconsistencies. It does not turn estimates into accepted bids or final invoices. The ZIP does not redistribute full publications. Source links and inspected-download hashes support provenance.

The app and repository have not been modified. The package is ready for a reviewed catalogue mapping and adoption workflow.
