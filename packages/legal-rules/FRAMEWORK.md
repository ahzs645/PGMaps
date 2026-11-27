# PGMaps legal pack framework

A pack describes one version of an instrument. The workbench can apply several instruments to the same case and assessment date. Each finding retains its own scope, provision, evidence and actions. The runtime and command-line interface operate solely on the pack and facts contracts. Browser persistence and the forestry GIS adapter live in PGMaps.

## Run the forestry example

Open **Dev library → Legal rules workbench** at `/dev/legal-rules`. The FPPR and Prince George packs are selected initially. The initial legal assessment date is the latest date covered by both starter releases. Import `examples/forestry-block-facts.json` and `examples/forestry-landscape-facts.json` in turn using **Open facts or assessment**. Both files describe the same fictional case.

The reported 63 ha of net area to be reforested triggers review against the 60 ha Omineca threshold in FPPR §64(1)(b). The regional pack independently reports a patch class moving away from its target. The D.5(b) question stays open until a reviewer determines that the landscape objective cannot be achieved. Recording that determination exposes the rationale submission action. D.5(a) has its own trigger, approval and implementation actions.

Expand a finding to see its citation and the inputs used. **Export reproducible assessment** saves the date, release snapshots, supplied facts, sources, comparison traces and findings. Reopening it verifies the included releases and recalculates findings. Browser tabs can select one version of each instrument per run. Installed releases persist in IndexedDB. Download a case before reloading to preserve entered facts. **New assessment** clears case evidence.

## Add an instrument

1. Download the pack schema and the fictional water monitoring example from the workbench, or use the files in `schemas/` and `examples/`. Give the new pack a stable ID and version. Cite each primary source, its snapshot date and the provisions used. Set the inclusive date window supported by this interpretation. Record territory, plan, activity or tenure as explicit facts in rule scope whenever applicability depends on them.
2. Declare the facts the instrument needs. Available types are number, boolean, text and enumerated choice. Numeric facts can have units and inclusive bounds. Named parameters allow multiple rules to use the same threshold. A parameter and its fact must have matching units. Examples include hectares and percent.
3. Add rules containing a title, source ID, provision, optional scope, trigger, finding and actions. Each expression is an outer array of alternatives. Within an alternative all comparisons must hold. Supported operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte` and `in`. Supply a literal value, a list for membership, or a named parameter. For example, `[[{"fact":"reading","op":"gt","value":{"parameter":"limit"}}]]` checks one reading against the pack's threshold. Actions can require review, submission, approval, implementation or monitoring. A related-pack reference describes the relationship for the reader and preserves independent evaluation.
   A rule may list the exceptions the law makes to it (`exceptions`): each with an ID, a label, its own source ID and provision, a kind, optional conditions in the same expression form (`when`) and the evidence it needs. A `by-law` exception holds once its facts do; a `decision` exception holds only once someone has decided, and names who (`decidedBy`). Facts used only in an exception's conditions are asked only when a reviewer claims it.
4. Install the JSON through **Install JSON packs**. The form and results are generated from the declarations. The installer checks schema shape, unique IDs, citations, date order, references, value types, units and operator compatibility. Multi-file installs are atomic. Reinstalling identical content is idempotent. Changing any content requires a new version.
5. Add test cases for missing information, excluded scope, the exact threshold, both sides of it, dates outside coverage and interactions with other instruments. To try a different industry immediately, install `water-monitoring.json` and open `water-facts.json`. The example's 15 NTU reading triggers follow-up sampling against its fictional 12 NTU threshold.

The forestry releases in `packs/` are assembled from instrument headers in `instruments/`, citations in `sources/bc/`, and rule lists in `rules/bc/fppr/` and `rules/bc/prince-george/biodiversity.json`. Run `node scripts/legal-rules/build-packs.mjs` from the repository root after editing a source file. Add `--check` to verify the outputs. The CiviX catalogue keeps the authority, consolidation and review metadata for each citation. FRPA is the parent statute, with its own source entry. Interpretation and review determine which provisions become executable rules.

A pack may declare `spatialBindings` entries with a fact ID, operation ID and output ID. For example, a numeric hectare fact can bind to `mapped-riparian-overlap-v1` and `overlap-ha`. The installer checks types and units. Bound facts follow the selected geometry and interval in the planner. See the versioned operation descriptions in `spatial/`. The earlier Prince George 1.0.0 release remains available for replay. Version 1.1.0 adds the binding to the patch trend.

To ship another pack in PGMaps, add its JSON file to `packages/legal-rules/packs/`. Vite discovers the files at build time. The forestry starting selection and case date live in `forestry-profile.json`. A library can hold multiple releases of one instrument. The profile and each case pin the particular releases they use.

## Evidence and extensions

Every fact set identifies the target pack and exact version. Fields are local to that release, so two instruments can both use an identifier such as `applicable` without sharing a decision. Fact imports update the supplied IDs and preserve other case facts for the same release. An explicit `null` replaces earlier evidence with an unknown value. The input source and optional per-fact evidence are recorded. A complete assessment import restores the saved case.

A fact set may also carry `claims`: for one raised rule at most, the exception the reviewer relies on, with a rationale, evidence rows (label, reference, date) and, for a decision, who decided, when and its reference. A claim is the reviewer's record, never a fact. The evaluator leaves the rule raised and reports the exception beside it with its standing: *relied on*, *to answer* (its conditions wait on an answer), *not supported* (the answers contradict them), *pending a decision* or *decided*. Assessments carry `engineVersion` 1.1.0 from this change; 1.0.0 assessments still import.

The evaluator distinguishes excluded scope, uncovered dates, missing evidence, an untriggered condition and a triggered review. An unknown operand propagates unless another known operand resolves the conjunction or disjunction. An untriggered screen addresses only the cited rule. A reported action describes the next review step and carries no approval authority.

For a spatial, temporal or scientific calculation, add an adapter that outputs `pgmaps-legal-facts/v1` with a method reference, measured inputs or source record, unit and interval as appropriate. A producer may also include this object under `legalFacts` in its own evidence export. Existing operators and actions require only a new JSON pack. A new mathematical model or operator requires implementation and verification in code. Domain-specific algorithms remain outside the evaluator.

The forest patch tool supplies the change in class-to-target distance across two periods. It sends an unknown measurement where an interval or complete distribution is missing. The adapter supplies no legal applicability or infeasibility determination. The workbench can also read older patch exports by recalculating the supported 2005 method from their project inputs. For technical details see [the patch method](../../docs/forestry-patch-scenarios.md).

## Run without the browser

From the PGMaps repository root after installing its npm dependencies:

```sh
npx tsx scripts/legal-rules/run-packs.ts --date 2026-11-17 \
  --pack packages/legal-rules/packs/bc-fppr.json \
  --pack packages/legal-rules/packs/bc-pgtsa-biodiversity.json \
  --facts packages/legal-rules/examples/forestry-block-facts.json \
  --facts packages/legal-rules/examples/forestry-landscape-facts.json
npx tsx scripts/legal-rules/run-packs.ts --schema
npx vitest run packages/legal-rules/tests/evaluate.test.ts
```

The runtime contract is `src/contract.ts`, the pure evaluator is `engine/evaluate.ts`, and the browser registry is `../../src/pages/legal-workbench/registry.ts`. The CLI prints the reproducible assessment to standard output and reports malformed input with a nonzero exit code.

## Law text, quotes and coverage

A rule's provision opens its text wherever the rule is shown. Statutes and regulations are imported whole from CiviX XML by `scripts/legal-rules/import_bclaws.py` into `catalogue/generated/`; orders are transcribed into `catalogue/orders/`, with quotes of at most 124 characters and the page of the signed PDF. Every shipped rule has the words it rests on in `catalogue/rule-quotes.json`; add a rule, then run `npx tsx scripts/legal-rules/rule-quotes.ts` for a starting quote and correct it by hand where the cited paragraph's opening words are not the reason. `src/lib/legal/ruleQuotes.test.ts` checks every quote against the stored text and every citation against the sections that exist. A new order needs its catalogue entry, its transcription and its source file before its rules, and its own provision ids (`Strategy 1.02`, `Objective 2(b)`) are the ones a rule cites.

## Starter release coverage

**B.C. FPPR.** Section 64 covers the two regional size thresholds and routes exceptions for review. Section 65 flags the need for an adjacency review. Section 66 screens reported block and annual retention percentages, with their distinct denominators and fibre-recovery exclusion. Other provisions, the full §65 stocking calculations and exception adjudication require further packs or interpretation. The cited consolidation lists a January 1, 2026 last amendment and is current through November 17, 2026. [BC Laws consolidation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004)

**Prince George TSA.** The pack covers Objective C review and the two D.5 pathways. Its source is the signed instrument, with footprint-, date-, tenure- and plan-specific applicability entered by a reviewer. Section E can remove areas from scope. The packaged Table 7 targets and 2005 methodology remain in the GIS module's versioned order record. [Signed order and implementation policy](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/land-water-use/crown-land/land-use-plans-and-objectives/omineca-region/princegeorge-biodiversity-order/princegeorge_tsa_fpc_20oct2004.pdf)

BC pack content is derived from Province of British Columbia material. The packs are unofficial interpretations, produced independently of the Province. [King’s Printer Licence](https://www.bclaws.gov.bc.ca/standards/Licence.html)

## Standalone workbench

After `npm run toolkit:build`, generate the same workbench as a self-contained HTML file with `node scripts/legal-rules/build-workbench.mjs PGMaps-Legal-Rules-Workbench.html`. For browsers that restrict storage for local files, serve the HTML from localhost to persist installed releases across visits.
