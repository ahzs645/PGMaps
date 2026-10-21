# Local source layers, queries and monitoring

These workflows run in the PGMaps browser application. Actual cached features and observation rows live in the device-local IndexedDB workbench. They need no new application backend. The static application and its WebAssembly assets must be loaded; reading remote catalogues, protected records, WFS or WMS still depends on the source service and its access policy.

## Entry points

- Portal: `/dev/nechako/portal?panel=source-layers`, `?panel=monitoring`, `?panel=local-workbench`.
- Data workbench: `/dev/nechako?view=source-layers`, `?view=monitoring`, `?view=local-workbench`.
- Map Tools also opens Source layers and Local workbench while keeping the existing map/camera mounted.

## Source pickers and materialization

The source catalogues use the exact public client contracts:

| Picker            | Endpoint                                      | Retained identifiers                                                |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Schemas           | `rest/portal/getSchemas_TBD.php`              | `id` → source/schema ID; geometry type and original metadata        |
| Submission layers | `rest/portal/getSubmissionLayersAddLayer.php` | `layer_id`, `schema_id`, `form_submission_id`, original names/title |
| Shared layers     | `rest/portal/getLinkedLayers.php`             | `layer_id`, layer name, original metadata                           |

**Load public catalogue** performs a credential-free CORS read. **Use selected portal connection** uses the existing connection, which can be direct or gateway-backed. The optional gateways allow only these exact parameterless reads; they do not accept SQL, source writes or arbitrary target URLs. **Import catalogue JSON** accepts a native envelope or its row array, including an authorized export obtained elsewhere.

Source IDs must be positive native integers within the supported source ID range. Denied/failed envelopes are displayed as failures, including contradictory `success:true, status:'failure'` responses. They are not empty catalogues. Lists are searched locally and displayed in pages of 25, up to 20,000 entries.

**Cache catalogue references** saves only new descriptors. Refreshing a catalogue never overwrites geometry already cached under the same source ID. A descriptor cannot be added as a feature layer until it has actual geometry.

Materialization has three paths:

1. **Attach exported GeoJSON** accepts a GeoJSON/JSON file or an archive containing one GeoJSON file. It attaches the file to the selected native source descriptor, retaining both the original metadata and the original file. Multi-layer GIS archives go through Import files, where layers can be inspected individually.
2. **Try public source export** asks the original `downloadFile.php` endpoint for `type=GeoJSON`, using its native schema/submission descriptor. Shared layers first resolve their actual source descriptor through `getLayerFromShared.php`. No source export error is replaced with invented geometry or automatic credential fallback.
3. **Download WFS features** reads a public WFS 2.0 feature type into actual local features, with page and total verification described below.

The cached contract is `nechako-local-layer-v1`. It records source kind/IDs, original metadata, normalized GeoJSON, materialization basis, feature count, advertised count when supplied, verification state, date and notes. Original feature IDs/properties are retained. Integer JSON values outside JavaScript's exact integer range are preserved as decimal strings on file/WFS parsing.

### Coverage labels

| State               | Meaning                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue reference | The entry is known, but no geometry has been copied.                                                                                        |
| Materialized file   | Every feature in the supplied file is cached. Without an independent advertised total this does not establish source-database completeness. |
| Count-verified WFS  | All advertised features were read, counts stayed stable, boundary pages matched on re-read and the terminal page was empty.                 |
| Partial WFS         | The selected feature cap was reached before the source total. The saved record retains both counts.                                         |

Importing an authorized file is an explicit local copy. Source access labels remain in provenance. Local saves intentionally survive a later source disconnect. Unsaved connection-scoped responses still clear when the connection changes.

## Complete WFS reads

The service must provide HTTPS, browser CORS access, WFS 2.0 JSON, `startIndex`/`count` support and a numeric `numberMatched` or `totalFeatures`. The request uses CRS84 longitude/latitude order. Credential-bearing service URLs are rejected before saving or fetching.

Each request asks for 500 features. The downloader verifies the advertised total, `numberReturned` when present, exact page size until the final page, non-repeated pages and duplicate feature IDs where IDs are present. Before reporting complete coverage it re-reads the first and last pages, then requests the terminal offset and requires zero features.

Limits are explicit: at most 100,000 materialized features, 16 MiB per response, 128 MiB across the download and its verification requests. A smaller user limit produces a labelled partial record. Cancellation prevents the in-flight result from being saved or added; previous successful saves are retained. These limits protect the browser and can be revisited with evidence from larger representative datasets.

These checks are not a transaction on a changing source database. The source supplies no atomic snapshot token; middle pages could change between requests even when boundary pages remain stable. The provenance therefore records `atomicSnapshot:false`. Missing feature IDs prevent a claim that unique identities were fully verified.

The request semantics follow the [OGC WFS 2.0 standard](https://docs.ogc.org/is/09-025r2/09-025r2.html). The implementation does not silently switch to WFS 1.x paging or treat an unknown total as complete coverage.

## Queries over cached layers

Choose any materialized vector already in the map. The builder supports:

- Typed equals/not-equals for text, numbers and booleans; null/missing and has-value tests.
- Numeric less/less-or-equal/greater/greater-or-equal and inclusive ranges.
- Case-sensitive literal contains/starts-with text tests.
- Nested AND/OR groups with explicit group negation.

Numeric `4`, text `"4"`, boolean `false`, numeric zero and missing values remain distinct. Ordered comparisons use finite numbers. Text matching is literal, not regular expressions or SQL. Groups are bounded to 100 nodes and ten levels on import; the interactive builder offers four nested group levels.

Preview shows the number of matching cached features. Add a result as a new map layer, save it as a separate local layer, or export/import the versioned query JSON. The parent data is unchanged. The result retains original feature IDs, coordinates/properties, parent provenance and the query. A query only filters the cached scope; it cannot expand a partial parent into a complete source dataset.

Layer styles are retained on derived map layers. Schema/geometry defaults from the [local style library](local-styles.md) apply when adding an unstyled imported/cached layer. A style-storage error does not discard the layer; it is added with a visible warning.

## Complete monitoring extraction

Open an actual submission/schema/station relationship or a verified layer/schema record, then load its preview page. **Fetch all observation pages** uses the exact source `getMonitorData.php` scope; schema, layer, submission and record IDs are never substituted for one another.

The downloader:

1. Reads page zero with a fixed size of 500, retaining its actual field names and advertised `recordCount`.
2. Requests every remaining page sequentially, requiring stable totals/columns and exact page sizes. It rejects repeated whole pages.
3. Optionally validates an explicitly selected unique-ID column, preserving the type of each ID and rejecting missing/duplicate values. No column is guessed to be unique.
4. Re-reads the first and last pages and compares their full original content.
5. Requests an additional terminal page and requires it to be empty. A native `{noData:true}` terminal response is accepted without inventing its total.
6. Marks the result complete only when its count matches the advertised scope and all required checks passed.

The default maximum is 100,000 rows; users can choose 1–1,000,000 rows. The default retained-row JSON budget is 64 MiB. A row cap produces a partial result with original and downloaded counts. A malformed, changed, oversized or cancelled response produces an error, not a silently truncated complete file. No automatic retry can hide a changed page.

The versioned `nechako-monitor-extract-v1` JSON includes original rows and fields, scope parameters, dates, page counts, byte measurement, complete/partial status and verification evidence. CSV is spreadsheet-safe; charting uses the original values directly so CSV escaping does not change measurements or timezone offsets. Zero, null and boolean false are not merged.

**Save extract locally** saves the rows and manifest together. **Reopen saved observations** restores the typed source values or the original monitoring CSV and its mapping from IndexedDB. CSV mappings are revalidated when opened. Date/timezone interpretation, rejected rows, duplicate station/timestamps, charts and statistics use the existing monitoring rules. Source counts are observation counts for the selected association, not counts of submissions or all portal data.

Count and boundary verification cannot certify a changing source as an atomic snapshot. The manifest explicitly records this limitation; no midpoint consistency or global database count is inferred.

## Current live source observations

Anonymous probes on October 21, 2026 returned 13 schema entries and 72 shared-layer entries. The submission-layer catalogue returned an explicit access denial. A source export probe returned a server temporary-directory/configuration error. A subsequent monitoring request for the historical layer 386 / record 1 returned `success:true, status:'failure', error:'Website not registered'` despite HTTP 200 and a public CORS header. These failures do not establish that protected or authenticated source requests fail in the same way.

The [dated read-only probe evidence](evidence/2026-10-21-local-data-probes.json) records request scopes, response sizes and hashes. It contains no credentials, session cookies or private records.

Accordingly, the current complete-extraction acceptance is based on source-shaped fixtures and actual browser cache/export behavior. A successful live full monitoring download and protected source geometry export still require permitted source access. The supplied sign-in was already rejected during the initial audit; this follow-up did not retry it, change source configuration or create source records.

## Verification and storage

Focused tests cover catalogue denial, ID/provenance preservation, exact file contents, typed queries, page/count/column drift, repeated pages/IDs, changed boundaries, terminal rows, empty datasets, partial limits, cancellation and cache reopening. Browser cases exercise source selection, file materialization, query results and reload at 1440px and 390px; counted WFS and a complete 1,001-row monitoring fixture exercise the real frontend controls and IndexedDB.

Use [Local workbench](local-workbench.md) for storage inspection, original-file downloads and integrity-checked portable backups. Browser storage is origin/device-specific and may be cleared or evicted; a persistence request is not a substitute for an exported backup. Remote WMS/XYZ entries in project manifests remain references unless their underlying features or media were separately materialized. Nothing here republishes cached private records to the source or shares them with other accounts automatically.
