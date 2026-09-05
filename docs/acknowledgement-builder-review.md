# Acknowledgement builder review

Reviewed September 5, 2026 at `/dev/acknowledgement`.

The builder has a useful foundation: curated relationships, source comparisons, pronunciation references, organization presets, and editable wording. Its main usability problem is that drafting, geographic exploration, and database comparison share the same flow. Make the draft the center of the experience and disclose research tools as needed.

## Generator semantics corrected

The subsequent logic review found that the initial reliability fixes still allowed incorrect territorial statements. The current composer now:

- Treats omitted selection as the documented default and an explicit empty selection as nobody. A relationship with no selected Nations contributes no wording; deselected Nations cannot reappear through another relationship.
- Represents UVic’s continuing land relationships separately from its campus territorial relationship, following the [current UVic Culture and Protocol acknowledgment](https://www.uvic.ca/ovpi/ways-of-knowing/culture-and-protocol/index.php), checked September 5, 2026. W̱SÁNEĆ-only selection produces continuing-relationship wording without reintroducing Songhees or Esquimalt.
- Separates people affiliations into their own sentences. A Peoples affiliation does not imply a territorial hierarchy. Duplicate source records do not duplicate generated territorial phrases.
- Requires an explicit purpose: one event venue, work/operations at the selected locations, or participants joining from different locations. One venue uses only that venue; multiple-location drafts retain a labeled paragraph for each place, including its own treaty status and “on or near” qualification. Presentation modes do not change those facts.
- Generates location claims only from reviewed place relationships. Boundary context, reserve/community proximity, educational map overlap, example templates, and unknown verification statuses cannot gain evidentiary strength through selection. Unsupported or mixed supported/unsupported selections retain the research context and explain why automatic drafting is unavailable; users can still author and copy their own sourced wording.
- Keeps organization name-list drafts to respectful recognition. The official statement/excerpt remains separately visible for the source’s actual territorial formulation. Regional scope does not infer where a person lives, works, or gathers. Distance and Nation count no longer silently replace specific selections with regional wording.
- Matches whole tokens in the confirmed geocoder result, with a broad geographic consistency guard. Raw search input cannot override the returned address, a civic-number substring cannot match another number, and wrong-city coordinates cannot select a distant campus. Missing guards and tied place scores fail closed. Guards are address-matching checks, not campus or territory polygons.
- Retains every overlapping contextual boundary relationship instead of stopping at the first polygon hit. A Nisg̱a’a treaty polygon does not establish that a point is on particular village lands.
- Saves purpose and stable venue identity, preserves authored text when purpose/venue changes, and scopes saved source references to the chosen venue or contributing locations. The current registry contains 12 named places plus 4 boundary-context records and 24 Nation/Peoples records; it is not comprehensive geographic coverage.

The registry is scraper-owned: corrections live in `vendor/bcdatamapper/datascrapers/manual/output/acknowledgement/relationship-graph.json`. Run `npm run data:sync-from-bcdatamapper` to regenerate the public copy. Match-region centers reuse the existing organization library coordinates; WWNI uses the BC Address Geocoder’s Gitwinksihlkw locality center, checked September 5, 2026. The tests cover same-street/different-city, partial civic numbers, and contradictory coordinates as well as composition semantics.

Validation after the semantic changes: 83 relevant unit tests and all 11 browser regressions passed, including UVic deselection, per-venue selection, remote-participant wording, and saved purpose/venue recovery. TypeScript, focused ESLint, the data-sync command, and the production Vite build passed. Mobile viewport checks cover 320–1440px; real iOS/Android keyboard behavior remains unverified. The data correction is committed as `61e4090` on the pushed submodule branch `codex/acknowledgement-relationship-semantics`; the parent workspace points to that commit.

Deselecting a Nation now leaves its row available in the additional-candidates list and retains keyboard focus, allowing immediate undo.

## Implementation completed

The review below describes the original implementation. The following changes were implemented in this workspace after the review:

- Replaced the tabbed research screen with Location → Review Nations → Your wording, including mobile Next/Back navigation, a draft-first editor, 16px form text, visible focus states, larger hit areas, and a reading view.
- Removed the ambiguous header copy action. The organization preview copies its own draft and transfers its generator options when used in the builder. Copy failures offer manual text selection.
- Kept authored text and its source/context snapshot separate from generated suggestions. Changing selections, locations, or wording controls does not overwrite it. Replacement is explicit. Device storage recovers authored text, the last generated draft, confirmed locations, selections, and generator/source settings. Clearing saved work is explicit.
- Added geocoder confirmation, approximate-match guidance, stale-response cancellation, and errors that explain that existing confirmed locations are retained. Additional addresses can be added through search.
- Unified per-location evidence and selection for single and combined drafts. Language and treaty overlap names do not become Nation candidates. Only strong documented relationships are preselected; unknown verification metadata requires review. Partial results and unavailable saved selections block automatic combined wording rather than silently reducing its scope.
- Made maps optional and placement explicit: arm Add/Move, propose a pin, then confirm. Marker focus does not move a point or change the draft. Native marker buttons avoid nested interactive controls.
- Added selected-first Nation review, visible pronunciation resources and source links, snapshot dates where available, optional source details, separate FPCC language context, and clearer organization comparison labels. Optional language failures do not block Nation review.
- Made organization browsing a mobile list/detail flow. Optional datasets and maps load on demand, and adding a location reuses already completed reviews instead of rerunning them all.
- Removed the superseded header, preview/editor wrapper, and single-location lookup hook.

Validation: TypeScript checking, focused ESLint, and a production Vite build passed. The 62 relevant unit tests and 9 browser regressions passed. Regression coverage includes organization copy/handoff, manual and generated draft recovery, failed/stale geocodes, incomplete multi-location review, optional language failures, copy fallback, and confirmed map placement. Layout checks covered widths 320, 375, 390, 430, 768, and 1440px; the editor began at approximately y=243 on a 390 × 844 viewport, compared with y=882 before the change.

The real sample flow requested only the 31,169-byte relationship graph as source data, compared with the original approximately 9.95 MB of uncompressed geographic datasets. This comparison concerns source data, not the whole application bundle. One local production run at 390 × 844 with 4× CPU throttling (and configured network emulation) reached the initial form in about 4.0 seconds and the draft about 92ms after address confirmation, with no long tasks observed during that lookup. These are single-run emulation measurements, not production service guarantees. A worker was not introduced without evidence that the revised default lookup blocks interaction.

Remaining verification: real iPhone Safari and Android Chrome behavior, especially the on-screen keyboard, device clipboard permissions, and screen-reader interaction. Browser emulation does not establish physical-device results. Source facts and organization statements were not independently reverified as part of these UI changes.

## Evidence and limits

- Inspected the page, composer, lookup pipeline, wording engine, candidate controls, and organization preview.
- Exercised the local app in headless Chrome with mobile viewport/touch emulation. At 390 × 844, the acknowledgment heading started around y=1003 and the wording textarea around y=882. Neither was in the initial viewport of its tab.
- Checked the main map panel for horizontal overflow at widths 320, 375, 390, 768, and 1440; none was observed in the states checked. This does not cover every expanded panel or organization.
- Measured controls: candidate selection 24 × 24px; map markers 28 × 28px; voice buttons 30px high; remove-point control 32 × 32px; preview Copy button 16px high.
- Ran the existing selection-state, organization-name resolver, and relationship-engine suites: 50 tests passed across 3 files.
- This is a product/code review, not a validation of every Nation relationship or organization statement. Physical-device Safari, virtual-keyboard behavior, screen readers, and throttled mobile performance still need testing. Application code was not changed.

## Fix first: output and draft integrity

### 1. The header can copy a different organization's draft

Browser reproduction: open Organizations, search for BC Ferries, select it, then use the header's **Copy wording** button. The visible generated statement is for BC Ferries; the clipboard handler receives the main builder's UNBC statement. The organization card's local Copy uses its own statement.

Cause: `DevAcknowledgement.tsx:273` copies parent state, while `OrganizationPreview.tsx` owns separate generator state.

Fix: scope copy actions to the visible draft. Prefer a copy button attached to each draft and remove the ambiguous global action. If a persistent action is retained, use an explicit active-draft model. Preserve organization preview options when choosing to use that draft in the builder.

### 2. Selecting a location destroys manual edits

Browser reproduction: enter custom text in Wording, return to Map & Nations, select the map marker, and return to Wording. The manual text has been replaced by generated wording.

`DevAcknowledgement.tsx:238` clears the override whenever `onActivePoint` fires, including selection. Drafts also live only in component state and have no reload recovery.

Fix: keep authored text separate from generated suggestions. A context change should show that a new suggestion is available, with explicit Replace and Keep actions. Merely focusing the current point should not mutate the draft. Save a recoverable local draft. Also check marker event propagation: the exercised marker click changed the point coordinates, and the map's click handler relocates points.

### 3. Failed searches leave old wording usable

Browser reproduction: after a successful location lookup, force the next geocoder request to return HTTP 500. The error appears, but the old location, candidates, and acknowledgment remain, with Copy available.

`useAcknowledgementLookups.ts` clears `geocodeResult` on failure without clearing or explicitly marking the previous source results. The composer retains its points when `addressPoint` becomes null.

Fix: distinguish typed address, confirmed location, and draft context. Retaining the last valid result is reasonable if it remains clearly labeled with that location. Show “Search failed; showing results for [previous location]” and prevent ambiguity about what will be copied. Expose low-precision geocoder matches before treating them as confirmed locations.

### 4. Multiple locations use a different evidence policy

Code finding: single-location selection defaults only to a strong curated relationship. Free-form multiple-location wording instead unions Native Land overlap names from `spatial.ts:201`, bypassing candidate selections and enabled-source controls. The resolver can fall back to language/treaty matches if territory matches are absent. If any point is unresolved, `MultiPointComposer.tsx:369` returns null context and the page falls back to single-location wording.

Fix: use one reviewed per-location resolution model for both modes. Keep territory, language, treaty, and proximity evidence distinct. Require an explicit selection before promoting educational overlaps into the draft. Show “2 of 3 locations resolved” and a partial-result state; do not silently switch the scope of the output. Let optional language lookup failures remain separate from Nation-resolution failures.

## Recommended mobile experience

Use three short stages: **Location → Review Nations → Your wording**. Keep desktop side-by-side comparison where it helps, using the same state and evidence model.

1. **Location:** compact heading, one address search, and a clear confirmed-location summary. Offer a labeled sample instead of opening as UNBC by default. Make the map expandable or full-screen. Put multiple locations and organization presets behind explicit entry points. Allow adding a second address through search; currently Add point relies on a map click.
2. **Review Nations:** show selected Nations first with a concise reason and source link. Put pronunciation beside the name. Place additional overlaps and source/match settings behind expandable details. Use precise evidence labels such as “Documented in [source]” and “Map overlap—review needed.”
3. **Your wording:** show the editable draft before optional controls. Keep voice, occasion, and length concise; move advanced context choices below the editor. Attach Copy to this draft and offer a readable presentation view. Preserve work when moving between stages.

Add a persistent mobile Next/Back action where appropriate, with bottom safe-area padding and keyboard-aware positioning. Move rather than duplicate the active draft's copy action. Use a single primary scroll surface; organization search results should open a detail view with Back instead of leaving the preview below a nested scrolling list.

### Touch and accessibility

- Target at least 44 × 44px for primary interactive hit areas, including map markers and Nation selection. Existing 24px selection controls meet the nominal WCAG 2.2 minimum size; larger targets are a usability improvement, not evidence that every existing control fails WCAG. See [W3C minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [WCAG 2.2 enhanced target size](https://www.w3.org/TR/WCAG22/#target-size-enhanced).
- Use 16px input/editor text on mobile and verify focus behavior on iOS. Keep body text comfortably readable; many current controls and data rows use 12px text.
- Add selected-state semantics to voice, wording mode, scope, and context controls, using radio groups or `aria-pressed` as appropriate. Restore visible input focus treatment where `outline-none` removes it.
- Announce copy success/failure and lookup progress. Clipboard failures currently produce no actionable message; provide select-text/manual-copy recovery.
- Use an explicit map placement/edit mode with a confirmation action on touch devices. An ordinary map tap currently changes the active location.

## Content and performance improvements

Use “Draft acknowledgment” and clearly distinguish generated text from official source wording. Link the source supporting each selected Nation directly from the review and draft views, including review dates where available. Replace database comparison labels such as “extra (noise)” with “Additional map matches”; those comparisons establish disagreement with an organization's statement, not whether a people or relationship is invalid. Add an optional personal-context or concrete-commitment prompt near the editor. Native Land describes its map as a starting point for learning and relationships; the builder should support that process ([Native Land Digital guide](https://native-land.ca/resources/teachers-guide?lang=en)).

The default lookup path loads approximately 9.95 MB of uncompressed GeoJSON across eight territory, language, treaty, reserve, community, and FPCC files. This is file size, not measured compressed transfer or mobile latency. Source toggles currently filter results rather than prevent these requests. Prioritize the curated location result, defer optional evidence, and measure cold-load performance on a slower device. Consider a spatial index or worker if profiling shows polygon scans block interaction. Keep scraper-owned optimization work in the submodule and regenerate public copies through the existing sync process.

## Suggested implementation order

1. Fix copy ownership, protect manual drafts, and clarify loading/error/context states.
2. Unify single- and multiple-location evidence selection and expose partial results.
3. Implement the mobile stages, draft-first editor, larger touch targets, and address-based multi-location entry.
4. Improve provenance language, pronunciation visibility, local recovery, and measured loading performance.

Acceptance checks should cover the actual BC Ferries copy regression, retaining edited text when focusing a point, failed searches, unresolved multi-location lookups, and a complete address-to-copy flow at 320–430px widths. Test on real iOS Safari and Android Chrome with the keyboard open before calling the mobile work complete.
