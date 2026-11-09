# Reconstructing cutblock access and crossing history

**Terrain → Access history** connects a selected cutblock entrance to an explicitly
identified network outlet through roads and structures that are compatible with a
chosen historical date. It keeps the evidence, assumptions, rejected candidates,
source identifiers and review decisions with the road project.

This is an implemented project workflow, with an offline worked example and bounded
ministry-source adapters. It is not a completed province-wide road-purpose database.
The last section describes the additional data infrastructure and validation needed
to build that database without changing the meaning of these project records.

## Try the complete example

![Synthetic block access at two dates](../../examples/forestry/access-history/access-history-comparison.png)

The comparison uses the actual saved coordinates and engine results. It is a
data diagram; rendered browser acceptance is still a separate check.

1. Start the app and open `/dev/forestry/road-design?example=training`.
2. Open **Projects → Browse example scenarios** and load
   **Training · reconstruct block access and bridges**.
3. Open **Terrain → Access history**. On a phone, first open **Show road controls**.
4. Inspect the saved **2010-06-30** route for block A. Select block B to see its
   different spur and culvert. Both routes use the same mainline and bridge.
5. Set **Historical date** to **2022-08-01**, then **Trace historical access**.
   The bridge's closure and conflicting reports exclude that crossing. The route
   uses the bypass constructed in 2016. Expand **Structure evidence and conflicts**.
6. Select the saved 2010 route again. Its date and evidence remain 2010 even while
   the next trace date is 2022. The map and legend identify the selected saved date.
7. Expand **Review this association**, choose **Documented use**, select the
   synthetic haul-ledger source, enter a reviewer and a specific reference, and
   save the assertion. This demonstrates the review mechanism using invented evidence.
8. Export the history bundle or Markdown report, or use **Save → Save project JSON**.
   Reopen the project and inspect the retained route, review, identifiers and sources.

The example contains two cutblocks, eight road features, a bridge, a culvert,
explicit entrances and outlet, and five invented source records. All road reuse
switches remain off. The reference alignment is a design draft, not an as-built road.
No provincial feature extract is embedded in the example.

| Input change | Expected result | What it demonstrates |
| --- | --- | --- |
| Trace at 2010-06-30 | Both blocks can connect through the shared bridge | A road network can serve multiple blocks |
| Inspect the bypass at that date | Excluded: constructed in 2016 | Today's network cannot be backdated automatically |
| Trace at 2022-08-01 | The bridge crossing is blocked; the later bypass is available | Time changes the usable historical topology |
| Inspect bridge reports in 2022 | Both 60 t and 0 t reports, plus the closure, remain visible | A newer inventory row does not erase a contradictory notice |
| Enable unknown historical timing | An undated track can become an explicitly qualified candidate | Missing dates remain assumptions |
| Inspect the grade-separated road | Its line crossing does not create a junction | Intersection on a map is insufficient for connectivity |
| Change a road's section ID, geometry, asset or evidence | Saved assertions become stale | A review is tied to the inputs it actually used |
| Change only the next trace date | Existing assertions keep their own date | A historical record is not overwritten by a new query |

The implementation lives in `trainingAccessHistoryScenario.ts`; its integration
tests verify these outcomes. The [portable example files](../../examples/forestry/access-history/)
can be regenerated with `npm run example:access-history`.

## What a connection means

The planner keeps five relationship types. They are explicit categories, not a
percentage confidence score.

| Relationship | Meaning |
| --- | --- |
| Nearby only | A relationship is recorded for investigation; it does not assert use |
| Inferred access | A bounded network trace found a date-compatible or explicitly qualified candidate |
| Documented plan | A reviewer cites a record describing planned access |
| Documented use | A reviewer cites a record supporting actual use of this route |
| Rejected association | The candidate is retained with the reason for rejecting it |

Neither proximity nor a shared tenure/client identifier proves that a road was
constructed for a particular block. An existing mainline may have preceded that
block by decades. A route used for harvest may include old roads, a new spur,
temporary crossings and a shared bridge. Preserve those distinctions when
explaining an operational decision.

The trace does not automatically promote an inference to documented use. A review
requires a source, reviewer, review date and reference/reasoning. Stale, missing or
contradictory inputs prevent a positive review until retraced or reconciled.
Rejected assertions remain inspectable. Review is a recorded human assertion;
the software does not authenticate the document or certify its interpretation.

## Using real BC records

Start with a bounded study area. Load mapped cutblocks with the existing
**Cutblocks & harvest history** tool, draw a block, or import a project bundle.
For a block that carries an opening ID, expand **Ministry records & structure files**
and use **Check block identity**. That performs an exact opening-ID query against
RESULTS openings and FTEN cutblock polygons. It retains unmatched records and
checks reported business keys for disagreements.

An identity check can corroborate the opening, licence, cutting permit and block
identity. It does not produce a road-to-block foreign key. The individual source
snapshots preserve typed identity attributes, source URL, record ID and retrieval
time. Content changes create distinct source snapshots; fetching unchanged content
again does not manufacture new physical evidence.

Use **Load open road segments** to load bounded FTEN Road Segment Lines around
the selected block and saved access locations, falling back to the project
alignments when those are unavailable. This preserves forest file, road section, station limits,
timber mark and client identifiers. Leading zeroes remain significant strings.
Segment IDs are namespaced separately from the existing road-section loader.
Changed geometry or authoritative identifiers are not silently merged over a
reviewed road.

Roads arrive with unknown condition and reuse disabled. Administrative status,
award/retirement dates and a timber mark are not construction dates or proof of
the destination served. Enter physical road events from suitable dated records
or imagery in the evidence ledger. Where only a date range is known, retain the
range. A later observation of a road does not establish when it was first built.

For bridges and major culverts, import a WGS84 point GeoJSON extract you are
entitled to use. The Ministry structures adapter preserves the source row,
physical structure and crossing site separately. A unique exact forest-file and
road-section match must also be spatially plausible. Ambiguous, distant and
unmatched records remain unresolved. A PSCIS import preserves fish-passage
observations; a fish barrier status is never converted into a truck closure.

Add a source for each relevant survey, construction record, aerial-image
observation, closure notice or haul plan. Use **Entrances and outlets** to locate
the actual block access point and the network destination. An entrance must be
in or at the selected block within the declared attachment tolerance. A block
centroid is not used as a substitute. Choose a historical date, review connection
assumptions, trace, and inspect the exclusions before recording a conclusion.

### Source access and reuse

The registry in `accessHistorySources.ts` distinguishes public access from reuse
rights. The following were checked against the official catalogue in November
2026. Recheck terms before adding a bulk publishing pipeline.

| Dataset | Role in this change | Access path |
| --- | --- | --- |
| [RESULTS openings](https://catalogue.data.gov.bc.ca/dataset/53a17fec-e9ad-4ac0-95e6-f5106a97e677) | Typed opening and disturbance identity | Bounded live query; OGL-BC |
| [FTEN cutblock polygons](https://catalogue.data.gov.bc.ca/dataset/dfb8b498-fa4b-4286-b3ec-58db88aca1cf) | Cross-check opening, licence, permit and block keys | Bounded live query; OGL-BC |
| [FTEN road segment lines](https://catalogue.data.gov.bc.ca/dataset/9e5bfa62-2339-445e-bf67-81657180c682) | Road business keys and mapped segment geometry | Bounded live query; OGL-BC |
| [Consolidated cutblocks](https://catalogue.data.gov.bc.ca/dataset/b1b647a6-f271-42e0-9cd0-89ec24bce9f7) | Wider harvest history; already used by the cutblock tool | Reference in this registry; Access Only |
| [Ministry bridges and major culverts](https://catalogue.data.gov.bc.ca/dataset/df943320-9e31-421c-8ada-d4df80518684) | Asset and crossing identity, reported ratings | Local user import; Access Only |
| [PSCIS assessments](https://catalogue.data.gov.bc.ca/dataset/7ecfafa6-5e18-48cd-8d9b-eae5b5ea2881) | Fish-passage observations at crossing sites | Local user import; Access Only |
| [BCTS Block Access Roads](https://catalogue.data.gov.bc.ca/dataset/7c166ce7-a3ff-40ee-b7e2-98b3059aba37) | Potential additional evidence if lawfully available | Restricted reference only; not queried |

See the province's [data licence guidance](https://bcgov.github.io/data-publication/pages/dps_licences.html).
No Access Only or restricted source is automatically queried by the new adapters.
The existing cutblock/road-section loaders have their own existing behavior;
adding this module does not expand their redistribution rights.

## Data model and reproducibility

`RoadProject.accessHistory` is optional, preserving compatibility with existing
`pgmaps-road-project-v1` files. Its value has schema `historical-access-v1`.

| Collection | What is retained |
| --- | --- |
| `sources` | Dataset and record ID, URL, retrieval/publication times, synthetic flag, description, optional typed block identity |
| `events` | Road ID, physical event kind, earliest/latest event dates, observation date, source IDs and geometry fingerprint |
| `structures` | Asset type and coordinate, distinct site/structure/row IDs, road binding and tolerance, construction/removal ranges, independent restriction reports |
| `anchors` | Explicit block entrances and network outlets, coordinates, road binding, block binding and evidence |
| `paths` | Relationship, selected block/anchors, frozen settings/date, ordered directed segments, geometry, roads/assets, assumptions, sources and review |
| `settings` | Date and explicit assumptions for the next trace, geometric tolerances and variant cap |

Paths contain ordered physical road segments plus any junction or attachment
connectors. Serialized length and geometry must agree; disconnected or forged
current paths are rejected by the parser. Stale historical geometry remains
available for inspection with a stale status. A fingerprint covers relevant
source snapshots, block/road geometry, business keys, events, structures,
anchors and trace settings. It is a change detector, not a cryptographic signature.

Construction, observation, publication and retrieval dates have different
meanings. The engine evaluates physical event intervals, not source timestamps.
It filters future construction and definite closures/removals, handles explicit
reactivation evidence, and requires an opt-in for unknown timing. Each saved
trace evaluates one explicit date; multiple dates require separate saved runs.
It does not claim continuous availability throughout an entire harvest interval.

`buildHistoricalRoadTopology` shares the existing network's strict junction
geometry but uses a distinct graph type. It does not set `reuseAllowed`, invent
serviceable condition, mark roads proposed, or disable the operational checks.
Current-use haul, grade, capacity, rehabilitation and permission checks remain
in the operational graph. Historical candidates return mapped length and
evidence, not a certified haul route or a historical construction price.

Alternatives are bounded: a shortest geometric candidate is followed by
one-edge-exclusion searches. This is not exhaustive k-shortest enumeration, a
global optimum or a calibrated model of historical decision-making. The result
reports candidate/search limits and unresolved connections. Unknown level
endpoint snaps require a separate explicit assumption; crossing lines do not
automatically join.

Crossings are evaluated where a traced segment actually passes the asset. An
asset elsewhere on a long road does not block the entire road. Records for a
replacement structure remain distinct from its predecessor. Multiple reports
about one physical structure are checked together; a compatible inventory row
does not cancel a closure row. Source namespaces prevent coincident numeric
RRI and PSCIS identifiers from becoming an accidental replacement group.

`historicalSharedUsage` reports unioned physical road length, distinct physical
structures and distinct crossing sites. Opposite travel directions and graph
splits are reconciled against source-segment extents. Rejected assertions are
excluded. These are overlap measures, not allocated construction costs; cost is
unknown. Alternative candidate routes must not be added together as a build estimate.

### Map, exports and editing

The selected saved route is dashed and labelled by its relationship and date.
Stale/unknown results use amber; contradictory/conflicting evidence uses red.
Structure markers retain site, structure and source-row identifiers in their
inspection cards. The map uses the shared toolkit layers and the same assessment
functions as the sidebar and report.

A history bundle has schema `pgmaps-access-history-bundle-v1` and contains
`context` plus `accessHistory`. Imports are bounded and validated before applying.
Conflicting existing feature IDs are rejected atomically. Newly imported roads
have reuse disabled, and unrelated project data is retained. The UI previews a
bundle before applying it and offers an undo for that import. The ledger editor
uses explicit apply, rejects a stale draft and lets the user download it before
reconciling concurrent changes. Sources and existing reviews are not silently
overwritten by a ministry refresh.

The Markdown report includes assertions, assumptions, review references, road
events, structures, report conflicts and sources. The ordinary project export
preserves all of this with the rest of the design. A bundle or report may contain
user-imported evidence: its source rights still apply to subsequent sharing.

## Limits and budgets

| Limit | Enforcing location |
| --- | --- |
| 500 total project context features | `parseProject` in `project.ts` |
| 500 network roads / 20,000 source vertices | `MAX_NETWORK_ROADS`, `MAX_NETWORK_VERTICES` in `roadNetwork.ts` |
| 50,000 network nodes / 75,000 edges / 2,000,000 topology operations | Corresponding `MAX_NETWORK_*` constants in `roadNetwork.ts` |
| 100 saved historical paths | `MAX_HISTORY_PATHS` in `accessHistory.ts` |
| 500 sources / 1,000 road events / 500 structures / 100 anchors | `MAX_HISTORY_SOURCES`, `MAX_HISTORY_EVENTS`, `MAX_HISTORY_STRUCTURES`, `MAX_HISTORY_ANCHORS` |
| 50,000 aggregate path/segment coordinates | `MAX_HISTORY_PATH_VERTICES` |
| 24 entrance/outlet pairs and 48 path searches per trace | Pair guard in `traceHistoricalAccess`; `MAX_HISTORY_PATH_SEARCHES` |
| 1–8 displayed candidate variants, default 3 | `parseHistoricalTraceSettings` |
| 10 MiB history bundle or ledger import | `MAX_HISTORY_IMPORT_BYTES` |
| 100 identity records per dataset / 1 MiB response / 20 s request timeout | `MAX_BLOCK_IDENTITY_RECORDS`, `MAX_IDENTITY_RESPONSE_BYTES`, `ACCESS_SOURCE_TIMEOUT_MS` |
| FTEN road query: 0.3° maximum span, 500 roads, 10 MiB response | Existing-road query/import constants reused by `accessHistorySources.ts` |
| 5 MiB / 500 imported structure points | `MAX_STRUCTURE_IMPORT_BYTES`, `MAX_IMPORTED_STRUCTURES` |

Limits reject incomplete imports or report bounded search results; they do not
silently pretend a partial area is a complete provincial network. CORS, service
availability, transfer limits and missing records remain visible load failures.

## What the wider BC system still needs

### 1. A maintained data catalogue and immutable snapshots

Keep provincial acquisition code in `vendor/bcdatamapper`, following the repo's
existing ownership contract. The browser should consume scoped, versioned
results. A scheduled worker needs source descriptors, checked access/reuse terms,
schema versions, checksums, retrieval times, paging/retry logic, geographic
coverage, successful-empty versus failed-query distinctions and retained source
versions. Restricted/private evidence needs controlled storage and separate
distribution rules. Do not put all source extracts into PGMaps' static assets.

Store source entities and versions separately: opening, cutting authority,
block, road section, road segment, crossing site, physical structure and report.
Keep aliases and many-to-many joins, with conflict records. A structure may be
replaced at a site; a section may be split; one opening can appear in multiple
datasets. Object IDs, site IDs, physical asset IDs and business keys serve
different purposes. This PR establishes their project representation; the
province-wide entity resolution and versioned database are additional services.

### 2. Historical geometry and observed construction evidence

A current road layer alone cannot reconstruct a past network. Acquire earlier
road inventories, dated orthophotos/satellite observations, permitted engineering
records, as-built plans and closure/deactivation records. Use image acquisition
dates to bound first/last visibility. Store uncertainty intervals and review
their geometry; do not label first observation as construction.

Broaden the source catalogue with integrated/digital road networks, road-use
permits, FOM/BCTS sale and operating-plan documents, Ministry of Transportation
bridge/culvert data and other operators where appropriate. Each source needs its
own identity adapter, extent/version check, licence assessment and tests before
it can become an automatic ingest. PSCIS and RRI are complementary evidence,
not interchangeable structure inventories.

### 3. Spatial indexing and scalable reconstruction

Use a spatial database for regional queries, stable source-segment topology and
temporal versions. Materialize explicit junctions and grade separation, rather
than repeatedly snapping a province-wide network in the browser. Background
jobs can generate candidate block entrances, test temporal paths, record
unresolved evidence and export bounded project bundles. The pure trace API and
portable records here are the interface for that handoff. Increasing the browser's
500-feature budget is not a substitute for this service.

### 4. Validation against actual operational records

Build a reviewed reference set stratified by district, period, tenure type,
terrain and road/crossing type. Use dated plans or operator records to label
actual access, distinguish planned versus built versus used, and retain multiple
valid routes. Measure candidate recall, false associations, temporal violations,
asset-attachment errors, unresolved proportions and review effort. Hold out
districts/years when evaluating generalization. Include negative and incomplete
cases, not only examples with a clean match.

Only after that evaluation should inferred associations receive calibrated
confidence estimates. The current explicit evidence categories are intentionally
not presented as probabilities. Public identity joins and the synthetic example
are not evidence of real route-selection accuracy.

### 5. Learning why routes were selected

Historical use and historical purpose are separate questions. To compare the
actual road with alternatives, reconstruct information available at the time:
existing access, dated terrain/imagery, harvest boundaries and landings, crossing
options, known slope/geotechnical limits, fish/riparian constraints, seasonal
requirements, tenure permissions, available aggregates, haul destination,
vehicle requirements and period-appropriate costs.

Generate feasible alternatives using the existing terrain, constraint, network
and cost tools, then compare measured length, grade, earthworks, crossings,
rehabilitation, shared infrastructure and haul. Preserve objectives separately.
Fit or calibrate preferences only on well-supported records and test sensitivity
to unknown costs/constraints. An observed road may reflect future blocks,
contract timing or constraints absent from public data; the shortest mapped
route is not a sufficient explanation of the original decision.

### 6. Multi-user review and operational handoff

The current workspace is a portable local project, not a multi-user evidence
service. Production review needs access control, append-only review history,
document references, reconciliation of concurrent edits and an audit trail.
Current engineering/permission/condition review remains a separate gate before
using a reconstructed corridor in a present-day design. Loading a historical
assertion must never become an implicit operational road approval.

## Developer entry points

- `accessHistoryTypes.ts`, `accessHistory.ts`: contracts, parser, chronology,
  topology tracing, assessment, review and shared-usage calculations.
- `roadNetwork.ts`: separate operational and historical topology entry points.
- `accessHistorySources.ts`: registry, open identity/segment queries and local
  RRI/PSCIS import adapters.
- `AccessHistoryPanel.tsx`, `AccessHistorySourcesPanel.tsx`: review, authoring,
  source loading and import/export workflow.
- `AccessHistoryIO.ts`: portable bundle and Markdown report.
- `accessHistoryMap.ts`, `AccessHistoryLayers.tsx`: shared map/legend presentation.
- `trainingAccessHistoryScenario.ts`: deterministic worked example.
- `tests/e2e/forestry-access-history.spec.ts`: desktop and 320 px phone acceptance
  workflow. Run locally; no feature-specific automatic workflow was added.

After initializing the existing toolkit and json-url submodules, run
`npm ci` and `npm run ci:prepare`. The focused unit suites and acceptance tests
are listed in the PR validation record. Use an already-running Vite server and
`PGMAPS_E2E_BASE_URL` to run the browser suite without fetching unrelated datasets.
`npm run check:access-history` typechecks the complete road-page dependency graph,
new modules, example generator and browser spec in a bounded entrypoint project;
it supplements the existing full-repository `npx tsc -b` check.
