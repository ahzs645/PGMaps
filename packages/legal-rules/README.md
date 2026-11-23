# PGMaps legal rules & Prince George forestry objectives (draft)

This package is a **source-backed, versioned advisory screening prototype**, not a determination
that any harvesting is permitted or lawful. It does not modify the live cutblock planner.
Design date: 2026-11-22. Before production, have an experienced BC forestry/legal reviewer
validate applicability, amendments, exemptions, mapped orders, and all GIS facts.

## Framework decision

* **Canonical**: PGMaps legal-rule JSON Schema + explicit source/evidence/temporal metadata.
* **Run in browser**: json-rules-engine for straightforward Boolean/numeric conditions.
* **Use for visual authoring/review**: GoRules ZEN/JDM decision-table graphs (open-source
  engine; integration in a future UI). Never copy legal interpretation solely from a
  decision-table cell: source metadata lives in canonical JSON.
* **Borrow from OpenFisca**: historical parameter timelines, period-sensitive results,
  separate numeric parameters and formulas. Do NOT ship the Python OpenFisca runtime in
  PGMaps. Source-as-of checks are not effective-from dates.
* **GIS**: use PGMaps' existing Turf/JSTS, spatial indexing, BCGW/RESULTS/VRI adapters;
  compute verified facts (NAR, retained area, adjacency, forest age) **before** invoking
  any rule engine. Rule engines should never run arbitrary code from downloaded orders.

## Scope / what is actually complete

| Source | Whole document indexed? | Provisions interpreted? | Executable? |
| --- | --- | --- | --- |
| FRPA (SBC 2002 c 69) | CiviX XML importer provided; full snapshot **not yet downloaded** | Priority references only | No |
| FPPR (BC Reg 14/2004) | CiviX XML importer provided; full snapshot **not yet downloaded** | §64 size screen drafted; 65/66 and others queued | §64 screening only, no legal clearance |
| Government Actions Regulation (582/2004) | CiviX importer provided; full snapshot **not yet downloaded** | Priority references only | No |
| Prince George TSA Biodiversity Order, 20 Oct 2004 | A–E order provisions identified | Tables 3, 6, 7 transcribed; D alternatives summarized | Numeric landscape screen only |
| 2005 Implementation Policy | Identified | Key buffering guidance stored | Not implemented; **not legally binding** |

The CiviX API supports full statute/regulation XML and the King's Printer Licence permits
reuse subject to required attribution, accuracy, currency, and non-endorsement notices.
Always obtain fresh official XML and preserve a content hash. For multi-document legal
texts, do not accept a suspiciously small section count as "complete"; inspect CiviX's
document-specific `_multi` retrieval options. Local forestry orders and their replacements
do NOT come automatically from the BC Laws consolidated regulation index.

## Layout

* `catalogue/sources.json`: canonical sources, URLs, consolidation-as-of markers
* `catalogue/priority-provisions.json`: selected review priorities (not exhaustive)
* `catalogue/generated/*.sections.json`: generated whole-document section index, if run
* `rules/bc/*.json`: reviewed or draft rule definitions
* `rules/bc/prince-george/*.json`: published order tables, scope and alternatives
* `schemas/*.json`: document contracts; add Ajv validation at import/promotion time
* `parameters/bc/*.json`: as-of observations and eventual legal timelines
* `adapters/json-rules-engine/*.json`: native JSON condition/event example
* `adapters/zen/*.jdm.json`: actual GoRules graph format (input, decision table, output)
* `adapters/openfisca/*.yaml`: timeline template, intentionally unpopulated pending historical research
* `src/screen.mjs`: independent, deterministic guard/evaluation logic (not an authorization engine)
* `tests/`: case-based tests; separate optional real-engine adapter test

## Get **every section heading** from BC Laws

Run from the PGMaps repository root using Python 3.10+:

```sh
python3 scripts/legal-rules/import_bclaws.py --source bc.frpa
python3 scripts/legal-rules/import_bclaws.py --source bc.fppr
python3 scripts/legal-rules/import_bclaws.py --source bc.gar
python3 -m unittest discover -s scripts/legal-rules -p 'test_*.py'
node --test packages/legal-rules/tests/screen.test.mjs
```

The importer uses official CiviX XML, not HTML scraping, and emits **every section**
(with its section number, title, hierarchy and normalized-text SHA256). This supports
change detection and provision-by-provision extraction queues. It does **not**
automatically turn legislative language into executable obligations.

For offline testing, pass `--xml /path/to/snapshot.xml --min-sections 1`; never
describe a tiny fixture as an indexed complete statute.

For real GoRules + json-rules-engine execution, use an isolated local install:

```sh
cd packages/legal-rules
npm install
npm run test:engines
```

No GitHub Actions workflow is added. The engine-parity test needs actual npm modules and
is not represented as passing until run locally.

## Legal-screen semantics and evidence

The only active-style size screen tests FPPR §64(1) for a non-minor-tenure agreement
holder **in the Omineca Forest Region**, using **net area to be reforested**, not a
gross cutblock polygon. 60 ha is a screening threshold only. The regulation gives
three materially different pathways in §64(2)–(4); recording a claimed exception
produces `exception_review_required`, not approval. `not_applicable` means THIS
screen is out of scope, not that forestry operations are permitted.

Use a five-state, fail-closed API: `indeterminate`, `not_applicable`,
`within_threshold_only`, `review_required`, `exception_review_required`.
Never output a generic green "compliant" badge. A historic assessment date must
have its own verified legislative consolidation and order snapshot. The present
pilot deliberately accepts only `legalAsOf=2026-11-17`.

The order's Table 3 old-forest percentage is measured over the relevant Crown
Forest Land Base, and Table 6 interior percentage applies to the *required old
forest*, not the whole landscape. Table 7 is an objective to **demonstrate a trend**
in young-forest patch distribution by NDU sub-unit and historic forest district.
It is not a new maximum cutblock-size table. The included patch-distance metric is
only an advisory comparison, not the legal definition of meeting the objective.
Table 7 prints under 50, 51–100, 101–1,000, and over 1,000 ha; treatment of exact
boundary values must be validated before classification.

The order says it ceases to apply in areas superseded by a new old-forest order.
Before any site assessment, spatially resolve and date-check the currently
applicable orders, protected area data, FSP/FOP approvals, tenure, First Nations
requirements and other provincial/federal legislation. The 2005 guidance contains
multi-stage patch buffering, but the exact pipeline is not implemented here.

## Next steps before production

1. Run CiviX importer for every statute/regulation; review retrieval counts,
   document IDs, historical point-in-time amendments, and current applicability.
2. Inventory all Prince George-specific legal orders and their geometry, including
   non-public/sensitive wildlife features; do not copy restricted layers.
3. Legally review FPPR §§64–66 and all parts of the 2004 order; add fixtures for
   exceptions, null fields, spatial false positives and site-specific supersession.
4. Add signed rule releases, evidence provenance and test fixture replays.
5. Wire screens to the forestry route-card/planner via opt-in **review** panels;
   keep existing source/uncertainty handling and avoid claiming legal certification.

## Sources and attribution

* [FRPA](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02069_01)
* [FPPR](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004)
* [Government Actions Regulation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/582_2004)
* [Prince George TSA 2004 order with 2005 policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf)
* [CiviX document API](https://www.bclaws.gov.bc.ca/civix/template/complete/api/API_document.html)
* [King's Printer Licence – British Columbia](https://www.bclaws.gov.bc.ca/standards/Licence.html)
* [GoRules ZEN JDM](https://github.com/gorules/zen/blob/master/test-data/table.json)
* [json-rules-engine](https://github.com/CacheControl/json-rules-engine)
* [OpenFisca effective-dated parameters](https://openfisca.org/doc/coding-the-legislation/legislation_parameters.html)

These materials contain information that has been derived from information originally made
available by the Province of British Columbia at: http://www.bclaws.gov.bc.ca and this
information is being used in accordance with the King's Printer Licence – British Columbia
available at: https://www.bclaws.gov.bc.ca/standards/Licence.html. They have not, however,
been produced in affiliation with, or with the endorsement of, the Province of British
Columbia and THESE MATERIALS ARE NOT AN OFFICIAL VERSION.
