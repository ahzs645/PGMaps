# Cost estimating: the idea, the structure and how to extend it

Written **14 November 2026**, after the cost-library audit of the same day. This
guide explains why the road designer's cost tools are shaped the way they are,
how the parts fit together, and how to add a province, a rate, a budget item or
a scenario driver without breaking the rules that hold them together. What each
part does, its limits and its constants are in
[BC cost evidence](bc-cost-evidence.md), the contract; this is the map.

## The idea

A road estimate has three different kinds of uncertainty, and the tool keeps
them apart instead of folding them into one number:

1. **Quantities**: cut, fill, haul, structures. The engine measures them from
   the terrain and the design. Gaps stay unknown, never zero.
2. **Prices**: what each unit of work costs here, now. A price is only as good
   as its evidence: who quoted it, where, when, measured on what, and what it
   includes. The tool never invents, converts, escalates or averages a price;
   the estimator adopts one and says why.
3. **Scope**: everything a budget needs beyond the measured work, such as
   survey, design, environmental monitoring, overhead, taxes and future
   maintenance. Leaving an item out is acceptable when it is a stated decision;
   the tool never lets an omission read as costing nothing.

On top of these sit two questions the estimate must answer honestly: **how
sure** (low and high cases on stated bounds, not invented probabilities) and
**where** (the same work costs differently in Omineca, Alberta or Montana, and
the evidence nearest the project should be read first).

## The structure

```
 Place ─────────────► Pack ───────────────► Evidence catalogue ◄── Own records
 (country,           (currency, taxes,     (packages + additions,  (browser only,
  province/state,     regions + boundary,   each record placed,     exportable)
  region)             budget items, tools)  never adjusted)
     │                    │                        │
     │ orders and labels  │ supplies               │ read beside the estimate
     ▼                    ▼                        ▼
 Project cost location ──► Adoption form ◄──── Saved build-ups
 (suggested from road,     (target, basis,      (calculator inputs
  set only by the user)     includes, overlaps,  kept in the project)
                            reason)
                               │ writes one rate + its frozen source
                               ▼
     Rates ──► Engine ──► Construction estimate (estimatedCost)
                               │                      │
                               │ never changed by ▼   │ copies only
                               ▼                      ▼
                         Project budget          Low and high cases
                         (schedule items,        (stated multipliers,
                          lifecycle costs)        full re-analysis)
```

The parts and their files (all in `src/pages/dev-forestry-roads/`):

| Layer                       | What it holds                                                                                      | Files                                                                           | Stored in                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| Place                       | ISO country, ISO 3166-2 province/state, scheme-qualified region, town                              | `costPlaces/places.ts`                                                          | Records, project, preferences                    |
| Pack                        | One jurisdiction's currency, taxes, region scheme and boundary file, budget items, reference tools | `costPlaces/packs.ts`                                                           | Code                                             |
| Location suggestion         | The region holding most of the road's points                                                       | `costPlaces/locate.ts`, `CostLocation.tsx`                                      | Nothing until Use                                |
| Evidence catalogue          | Supplier prices, awards, estimates, tender averages, worked estimates, pending sources             | `costEvidence/costEvidence.ts`, `loadCostEvidence.ts`, `*.generated.json`       | Generated from `scripts/forestry/cost-evidence/` |
| Own records and preferences | Home place, evidence types read first, the person's own quotes and finished jobs                   | `costPlaces/costPreferences.ts`, `useCostPreferences.ts`, `UserCostRecords.tsx` | Browser storage, export file                     |
| Adoption targets            | Every rate a record can set, with its basis and the work it prices                                 | `costEvidence/adoptionTargets.ts`                                               | Code                                             |
| Adoption                    | The rate, the record as read, basis, included work, overlaps, reason                               | `costEvidence/rateAdoption.ts`, `RateAdoption.tsx`                              | `project.rateEvidence`                           |
| Build-ups                   | Calculator inputs and their formulas                                                               | `costEvidence/rateBuildUps.ts`, `CostRateToolsPanel.tsx`                        | `project.rateBuildUps`                           |
| Project budget              | Scope items in five states, lifecycle horizon and discount rate                                    | `costSchedule.ts`, `projectBudget.ts`, `ProjectBudgetPanel.tsx`                 | `project.costSchedule`                           |
| Low and high cases          | Driver multipliers                                                                                 | `costScenarios.ts`, `CostScenariosPanel.tsx`                                    | `project.costScenarios` (bounds only)            |
| Report                      | Location, rate sources with terms, build-ups, bounds, budget                                       | `costReportHtml.ts`                                                             | Printed                                          |

Every file in the left half of the diagram is free of DOM and network access
(fetch and storage are passed in or live in the `use…` hooks), so each rule is
pinned by a unit test that runs in Node.

## The rules that hold it together

Each rule here exists because the structure breaks without it. They are repeated
in `AGENTS.md`; change them there and in the contract together.

- **A place orders, never adjusts.** Nearness sorts and labels records. It is
  not a weight, a regional multiplier or a filter that hides anything. A
  location factor would be a new kind of evidence with its own source, not a
  property of the place.
- **One way in.** A record or a build-up reaches the estimate only through the
  adoption form, as one named undo step that writes the rate and its frozen
  source together. A new rate is a new adoption target, never a second form.
- **The source is frozen.** The observation is stored as it was read, with all
  its terms. A later catalogue never rewrites it; an edited rate, a removed
  target and a changed build-up each say so instead of hiding the mismatch.
- **Bundled prices are reconciled, not trusted.** A price that includes work
  another line already prices is flagged, and the estimator says how it was
  accounted for. BC's standard specifications pay excavation and borrow as
  bundles, so this check is needed, not optional.
- **The budget sits beside the estimate.** Route searches and the profile
  optimizer compare roads on `estimatedCost`; project-wide items would only
  shift every road equally or skew them by length. Not assessed is never zero,
  and future work stays out of the construction-period total.
- **Cases are copies.** Low and high are full analyses of copied inputs on the
  estimator's stated bounds. Nothing is applied, no results are stored, and no
  case is called a probability or a P50/P80.
- **Evidence is reproducible.** Every catalogue record is built from inputs in
  the repository, verified by checksum, and `cost-evidence:check` fails on any
  difference. Nothing is edited by hand in generated JSON.

## How to extend it

### Add a province, state or country

1. In `costPlaces/packs.ts`, add the subdivision's name to `SUBDIVISIONS` if it
   is missing, and the country to `COUNTRIES` (with its currency) if it is new.
2. Add a `CostPack` to `COST_PACKS`: `id` and `subdivision` (`CA-AB`), `name`,
   `taxes`, and `reviewed`. Omit `currency` to take the country's.
3. If it has regions, add a `regionScheme`: a scheme id that no other pack uses
   (`ab-fma`), each region as `scheme:id` with its `boundaryName`, and a
   `boundary` path under `public/data` with the property that names a region.
   The boundary file must reach `public/data` through the data sync like any
   other boundary, and is read through `withBase`. Without a boundary the pack
   still works; the location is chosen by hand.
4. Add jurisdiction-specific `scheduleItems` (taxes, mandatory assessments) and,
   only if there is an official appraisal or comparison method, a tool id in
   `PackTool` with its component in the references dialog.
5. Add its evidence (below) with `subdivision` and `regionId` set.
6. Extend `costPlaces.test.ts`: the pack's regions, its currency, and, when the
   boundary is synced, a known town in each of a few regions (as the BC test
   does for Prince George, Williams Lake, Terrace and Fort St. John).

Nothing in the engine, the adoption form or the budget changes.

### Add evidence

- **A new reviewed source:** create
  `scripts/forestry/cost-evidence/additions/<date>-<topic>.json` with records in
  the catalogue's shape (`additions/2026-11-14-review.json` is the template):
  place codes, amounts in the source's own currency and unit, price year, every
  term the source states, cautions, the URL and an exact locator, and the date
  read. Add a whole estimate under `estimates` with its lines and printed
  totals. A source you could not read in full goes under `pending` with no
  amount. Run `npm run cost-evidence:build`.
- **A new research package:** keep its folder (with its own
  `checksums-sha256.json`) under `scripts/forestry/cost-evidence/packages/`,
  map its fields in `build-catalogue.mjs`, and run the build. Record counts in
  `costEvidence.test.ts` and the e2e evidence counts change on purpose.
- **The person's own jobs** need no code: **My records** holds them in the
  browser, and Export shares them as a file.

### Make another rate adoptable

Add one entry in `costEvidence/adoptionTargets.ts`: a key (project rates keep
bare names; a road's rates are `<roadId>/…`; budget items `schedule:<id>`), the
label, unit, measurement basis, what it prices (`prices`), its limit, how it
reads its current value, and its write path in `writeTarget`. Extend
`ROAD_KEY`/`isTargetKey` so stored files with the key are accepted, and
`pricedElsewhere` if other lines can price the same work. Give the cost dialog's
row the same `rateKey` so it shows its source. The form, the rate sources list
and the report need no change.

### Add a budget item or a scenario driver

- A generic item is one entry in `GENERIC_SCHEDULE_ITEMS` (`costSchedule.ts`);
  a jurisdiction's goes in its pack. Items in the `future` group are costed over
  the lifecycle horizon and are not adoptable as one-off rates.
- A driver is one entry in `SCENARIO_DRIVERS` (`costScenarios.ts`) and one
  `case` in `scenarioCase` that scales a copy of the inputs it names, plus its
  line in `idleDrivers`. Prefer drivers that change an input the engine already
  uses; a driver that needs a template or geometry change (surfacing thickness)
  belongs with the template tools.

## Where it goes next

In rough order of value, with what each needs before it can start:

| Next step                               | Why                                                                                                                                                             | Needs                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packs for Alberta and Yukon             | Alberta already has 11 tender-average records; Ice Lake (Whitehorse) is pending                                                                                 | A region scheme and boundary for each, if regions matter there; reading the Ice Lake tables in full                                                                                    |
| Actual-cost records from finished jobs  | The largest gap: BC forestry costs tied to quantities, haul and site                                                                                            | Jobs entered under **My records** (shaped after the Interior Logging Cost Report's road schedule); a decision on whether shared jobs ever go into the catalogue, and with what consent |
| Reusable work items                     | An item such as "excavate and reuse", "drill and blast" or "place 75 mm crush" built from crew, equipment, material and production, as estimating software does | A work-item type in `rateBuildUps.ts` that combines the existing calculators                                                                                                           |
| Official BC workbooks as comparisons    | The July 2026 Interior ECE workbooks for road reactivation, tabular bridges and portable platforms                                                              | Reading the workbooks into reference tools beside the appraisal comparisons, labelled as appraisal scope                                                                               |
| Timber supply area and BEC intersection | Proposes the appraisal road group and zone from the map                                                                                                         | A candidate the reviewer confirms, never an automatic input                                                                                                                            |
| Escalation                              | Prices from different years compared on one basis                                                                                                               | A published index with its own source, applied only by the estimator's choice and shown beside the original; never automatic                                                           |
| Calibration                             | Checking estimates against finished jobs                                                                                                                        | Enough comparable actual-cost records; until then, cases stay stated bounds                                                                                                            |

Not planned, on purpose: averaging records across sources, converting
currencies, a regional multiplier tied to the place, and probabilistic
contingency without calibration data. Each would make the estimate look surer
than its evidence.
