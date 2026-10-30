# Connected access, complete cost and dated evidence workflow review

This review used the offline **Training · connected access, gravel and condition**
scenario in Chromium at 1512 × 982 and 390 × 844. Its terrain, road network, material
sources and inspection records are explicitly synthetic teaching inputs. These
browser checks test the integrated workflow without depending on live BC services.

## Observed behaviour

- At zero loaded haul, the checked 100 m connector A costs about CAD 708 and wins
  over the 400 m connector B at about CAD 2,806. Entering CAD 40/m³·km while the
  field remains focused invalidates the previous result. Recalculation gives A
  about CAD 13,121 and B about CAD 6,681, so the different horizontal geometry wins.
  B's preview shows that same complete-cost quote and 400 m profile while the
  original road remains active. Adoption preserves the priced horizontal controls
  and vertical formation rather than regenerating a different road.
- Closing the A-arm bridge blocks A while B remains feasible, even though the
  entered overall condition remains serviceable. Closing B-arm access as well
  leaves no adoptable candidate. Nearby linework does not create a shortcut.
- Moving the assessment date to 2028 expires the synthetic inspection evidence
  and removes network eligibility. The manually entered serviceable condition
  and assumed basis stay unchanged. Restoring the assessment date restores
  eligibility without inventing a new inspection or field-verification claim.
- An exclusion outside the centreline but intersecting the fill toe blocks the
  connector. Directional loaded-grade failures also disable adoption despite
  priced, connected access.
- Adoption saves a separate complete-access ledger with outward and return path
  IDs. Project JSON reopening preserves all planning inputs and the record. A
  later source quote change marks the saved total stale.
- On a phone, Setup, Sources and Results fit without horizontal page or dialog
  overflow and stay visible after calculation. The Calculate footer stays in the viewport. Editing a source entrance
  clears both confirmations and prevents adoption until the source is reviewed
  again. Preview closes the controls, exposes the exact candidate and allows
  return to the comparison and adoption.

## Interface corrections verified

The audit found duplicate sibling keys on the road network and condition editors;
switching roads had retained several stale network forms. The editors now have
distinct keys. Candidate preview previously left the phone sidebar over its return
button; preview now closes those controls. Results now begin at the top after
calculation, and failed candidates are labelled **Not feasible** rather than
**Unpriced**. Loaded and return paths are displayed separately.

## Portable saved evidence

The HTML report and GeoJSON keep the base engineering estimate separate from the
saved complete-access total. They include assessment date and current/stale status,
component costs, material allocations, loaded/return path IDs and adoption-time
road/source evidence. Later edits do not rewrite that snapshot. User-entered
evidence is escaped in HTML. Project JSON retains the exact canonical signature;
the cost-model version participates in currentness, so legacy or unfamiliar
versions can be read but require recalculation.
Parser regressions also reject array-valued enum inputs such as `kind: ["avoid"]`;
string coercion can no longer let a context constraint bypass downstream kind checks.

## Verification scope

The four desktop browser flows and the focused phone flow passed. The snapshot,
project and report/GeoJSON tests passed 21 checks; TypeScript and lint passed for
the implementation reviewed here. The browser regressions are in
`tests/e2e/forestry-road-full-cost.spec.ts`; export/snapshot checks are in
`fullCostExports.test.ts` and `fullCostRecord.test.ts`.

Screenshots from the review are `/tmp/full-cost-results.png`,
`/tmp/full-cost-preview.png` and `/tmp/full-cost-phone-results.png`.
These are local verification artifacts, not deployed screenshots. The comparison
ranks a bounded set of checked alternatives with entered assumptions; it does not
establish a global optimum, real road condition, supply rights or professional
construction approval. Live BC source checks from the earlier road/terrain audit
are separate from this offline workflow verification.
