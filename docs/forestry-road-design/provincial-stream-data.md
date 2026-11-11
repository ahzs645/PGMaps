# Provincial stream evidence and reports

In **Terrain → Streams**, **Load BC streams & evidence** queries the active road with a
500 m margin. It loads three provincial sources as one operation. All three must finish
and pass their completeness checks before the project changes. A failed, cancelled,
oversized or changing query leaves the existing project intact.

| Source                                                                                                                        | What appears                                               | What it establishes                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Freshwater Atlas stream network](https://catalogue.data.gov.bc.ca/dataset/92344413-8035-4c08-b996-65a9b3f62fca)              | Stream reaches in the existing stream list and plan        | Published flow-network arcs, including observed, inferred and constructed arcs. These are not surveyed banks, measured channel widths or riparian classes. |
| [Known BC fish observations and distributions](https://catalogue.data.gov.bc.ca/dataset/aca81811-4b08-4382-9af7-204e0b9d2448) | Violet points with species, observation date and waterbody | A source observation at its published location. A nearby point is not automatically assigned to a reach. An empty result cannot establish fish absence.    |
| [Community watersheds — current](https://catalogue.data.gov.bc.ca/dataset/bc57faf7-23e4-43fe-918a-e999936dbafa)               | Amber polygon outlines with designation metadata           | Published designated boundaries. An empty query is not automatically converted to an outside-watershed assessment.                                         |

The source registry is `BC_STREAM_SOURCES` in `provincialStreamData.ts`. It names the
specific ArcGIS services and fields; it does not depend on a map's layer order. The loader
asks for a complete bounding-box ID inventory, fetches explicit bounded pages of those IDs,
verifies each returned page, then repeats the inventory. A duplicate, missing or additional
record fails the operation. This detects inventory changes and truncated pages; it is not
a transaction across the provincial services and cannot detect an attribute edit that
leaves the ID inventory unchanged.

## Evidence stays separate from decisions

Imported FWA reaches start **Unassessed**. `STREAM_ORDER` is a network attribute, not an
S1–S6 class. The loader never writes fish absence, channel width, a reviewed class, a
crossing structure, or an engineering approval. Use the stream assessment to record those
decisions and their evidence explicitly.

Each FWA part retains the source service `OBJECTID`, retrieval time, query bounds, flow
arc type, blue-line key, watershed code, stream order, source and feature code when supplied.
The service does not expose a permanent linear-feature key in this layer. Its `OBJECTID`
is therefore treated as service-scoped provenance, not a promised permanent identifier.
The source-record link lets a reviewer inspect the current published record.

A refresh replaces matching source geometry and metadata while retaining the user's name,
assessment and crossing settings. A changed reach makes a recorded assessment stale through
its geometry fingerprint. Earlier reaches remain in the project when the query area changes
or a source record disappears; this preserves the user's work and is not a synchronized
deletion of provincial records. Their older retrieval dates remain visible. Fish and watershed
context, and the query summary, describe the latest completed query only. The panel warns when
the active road extends outside that saved query.

## Portable outputs

**Save project JSON** retains all source metadata, fish points and watershed polygons as
optional fields in `pgmaps-road-project-v1`. Older projects remain valid. The loader also
checks the complete merged project against its existing 500-context-feature and 50,000-vertex
limits; a valid source query can still be too large for a project that already has many features.

**Data & design** provides:

- **Stream register CSV**: one row per retained reach, with source, suggested and recorded
  classes in separate columns, review status, widths and evidence, source provenance, and
  crossings by road and chainage. Formula-leading user text is escaped for spreadsheet use.
  Save & export greys it out until the project has a stream.
- **Fish & watershed GeoJSON**: the latest query's fish points and designation polygons,
  including observation dates, catalogue URLs, retrieval time and bounds. FWA reaches travel
  with the ordinary project GeoJSON, including their source metadata.
- **Report HTML**: a stream register, active-road crossing stations, assessment evidence,
  outstanding work, source counts and query coverage. The report distinguishes nominal
  regulatory slope-distance widths from preliminary horizontal map screening areas.

Exported source metadata records what was loaded; it does not certify that the province's
inventory or the project's stream context is complete. No mapped crossing and no returned
fish record are both compatible with an actual watercourse needing field assessment.

## Limits and budgets

| Limit                                                                             | Enforced by                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 500 m margin around the active road                                               | `streamQueryBounds`, `provincialStreamData.ts`                                                                      |
| 0.12° maximum longitude and latitude span; larger queries fail without clipping   | `MAX_STREAM_QUERY_SPAN`, `provincialStreamData.ts`                                                                  |
| 450 FWA source records and 450 retained line parts per query                      | `MAX_PROVINCIAL_STREAM_FEATURES`, `provincialStreamData.ts` / `normalizeProvincialContext`                          |
| 1,000 fish observations                                                           | `MAX_PROVINCIAL_FISH`, `provincialStreamData.ts`                                                                    |
| 40 watershed source records                                                       | `MAX_PROVINCIAL_WATERSHEDS`, `provincialStreamData.ts`                                                              |
| 50,000 FWA vertices; 10,000 vertices per line; 50,000 watershed vertices in total | `MAX_PROVINCIAL_VERTICES` and `normalizeProvincialContext`, `bcStreamData.ts`; `polygon`, `provincialStreamData.ts` |
| 150 IDs per page                                                                  | `STREAM_QUERY_PAGE_SIZE`, `bcStreamData.ts`                                                                         |
| 8 MiB cumulative response bytes per source, including its ID inventories          | `MAX_STREAM_RESPONSE_BYTES`, `bcStreamData.ts`                                                                      |
| 30 seconds for the complete three-source load                                     | `STREAM_QUERY_TIMEOUT_MS`, `bcStreamData.ts`                                                                        |
| Stream lists over 50 visible rows use the shared virtual list                     | `StreamsPanel.tsx` / `VirtualResultList`                                                                            |

These are browser workload limits. They do not change source coordinates or simplify source
geometry. Use a shorter active road or import a reviewed local dataset when the service
response exceeds a limit.

## Checks

`provincialStreamData.test.ts` exercises paging, repeated inventories, malformed and truncated
responses, the service's successful empty `objectIds: null` response, cancellation, source
failure, saved-project round trips, identity conflicts and stale assessments on refresh.
`streamReports.test.ts` checks class separation, provenance, escaping and road/station records.

`tests/e2e/forestry-road-provincial-streams.spec.ts` loads stubbed services through the actual
page, checks rendered MapLibre source data, downloads a project and report, exercises atomic
failure, and checks phone-width controls. It is included by the existing manually dispatched
**Verify forestry road design** workflow. The source check recorded in
[`provincial-query-check.json`](../research/stream-planning/provincial-query-check.json)
is a live HTTP query, not browser acceptance evidence.
