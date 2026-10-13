# Check research data, projects and attachments

## Bundled dev showcase

Open `/dev/nechako` (or `/dev/nechako?view=showcase`) to test the committed public snapshot. Research browsing, the research map/timeline, WMS catalogue/capability inspection and the format registry use repository files by default. Research and catalogue controls also allow the live source. The existing `/projects/nechako-watershed-research-portal` project still reads its original live source.

`public/data/nechako-showcase/` is **app-owned showcase data**, preserved by the data-sync script's clean mode. The October 11 capture contained 42 data files / **1,257,503 bytes**. Adding nine proven anonymous saved-project definitions and their index on October 12 brings the current bundle to **52 files / 7,513,926 bytes**, excluding the manifest. It includes 1,408 research records, 51 location IDs, 12 decades, 32 WMS services with 135 named layers/groups, eight public Zotero HTML attachment links, the spatial format registry, access-check evidence and derived location/workspace files. Each file has a source URL, byte count and SHA-256 in `manifest.json`.

“Load research locations on map” adds 46 non-aggregate source reference points and preserves other map layers. It does not invent study footprints or map the 365 records without location tags. Repeated loading replaces that showcase layer rather than duplicating it. The separate bundled research explorer uses the existing native filters, ranked locations, popups, regional-record dialog and animated timeline; its optional scraper-owned watershed boundary is outside this snapshot. The native `/dev/nechako/portal` page additionally reuses EchoScreen’s generated local BC Freshwater Atlas Nechako polygon (8886), including its existing 50-metre simplification; the boundary is not duplicated in the showcase bundle.

WMS imagery/identify, basemap tiles and linked articles still require their original services. Nine public saved-map definitions are included; private projects, full source GIS databases and external PDF/video bodies are not. Attachment storage remains unknown. The showcase is public evidence and test data, not a copy of the entire portal.

## Public maps and browser collections added October 12

The original portal anonymously returned project IDs **4, 6, 9, 10, 12, 14, 15, 21 and 27**. Their nine decoded JSON responses total **6,253,465 bytes** (approximately **5.964 MiB**); the derived catalogue is **2,958 bytes**. The source method/parameters, anonymous state, exact bytes and hashes are retained in the manifest. The administrator's separate project grid contained **19** records. Neither the nine public maps nor their size should be described as the complete portal.

These definitions retain cameras, layer references, descriptions, embedded raster description images and links. The community reader searches the catalogue, displays safe source text/images/links, downloads original JSON and loads supported map data through the existing workspace converter. Conversion warnings disclose unsupported sources, temporary service references and unimplemented SLD symbolizers. Each of the nine maps skips two HTTP XYZ basemaps (**18 total**). **130 of 131 WMS references** now convert structurally: 19 native references use the verified original MapServer prefix plus their supplied mapfile and mapfileName, and existing safe HTTPS portal SLDs pass through to WMS. One external WMS lacks a layer name. Koh_Wetlands_Teacher_Resources retains **9 of 9 WMS references**. Native bottom-to-top source order survives JSON export/import and renders across tile/WMS/vector types; ordering within split vector geometries is not a full reproduction of native symbolizers. The reader shows retained/total layers and individual omissions before loading. Complete originals remain downloadable; actual imagery/identify, unresolved GIS sources and linked files still depend on their original services and access rules.

### Native MapServer verification, October 12, 2026

The [original page](https://nechakowatershed-portal.ca/) build **6268M** declares
`Global.addGlobal("MapServerUrl", "/cgi-bin/mapserv?map=")` in its inline client
configuration. [MapPanel.js](https://nechakowatershed-portal.ca/definitions/MapPanel.js?v=6268M)
uses the supplied native mapfileName as `LAYERS`;
[Project.js](https://nechakowatershed-portal.ca/definitions/map/Project.js?v=6268M)
combines the prefix with the saved mapfile and passes an existing portal SLD to
WMS. The converter follows those observed contracts rather than guessing service
URLs, file paths or layer names, and never silently upgrades external HTTP URLs.

A fresh anonymous load of public project **10**, Koh_Wetlands_Teacher_Resources,
in the original interface on **October 12, 2026** produced **109 HTTP 200
`image/png` MapServer responses across its eight native teacher layers**. These
requests included the existing HTTPS SLD references where supplied, with
`VERSION=1.3.0` and `CRS=EPSG:3857`; the response header was
`Access-Control-Allow-Origin: *`. This checks those eight layers' native tile
delivery and SLD-reference pipeline, not every project service, all observations,
or complete SLD symbolizer parity. No new form, project, style or default-SLD
generation was submitted during this check.

The initial October 12 converter retained **111/131 WMS references**, including
**1/9** in the teacher project, before the native configuration was verified.
That earlier subset is historical evidence, superseded by the current
**130/131** and **9/9** structural counts. The original snapshot bytes/hashes
remain unchanged. Native mapfiles and SLD files are temporary references and may
expire. Refreshing a DirectDb reference uses the permission-checked
[shared-layer client contract](https://nechakowatershed-portal.ca/definitions/portal/LinkableManager.js?v=6268M),
`admin/getLayerSharedLayersManager.php` with `layerId`; generation of a replacement
default SLD is not treated as a read or called automatically. Original services,
access rules and backend storage remain authoritative.

The native `nechako-learning-module` package is a **16,765-byte** app-owned adaptation outside the showcase manifest: seven chapters, five place cases and 25 discussion prompts. It links the original module. It is not an additional original portal submission or a full reproduction of every source resource.

The preview's Data size view keeps measured snapshot bytes, observed entity counts and imported collection bytes separate. Collection JSON stays in page memory across modal changes; originals and chosen record types round trip through browser collection export/import. Exact UTF-8 JSON bytes are measured locally. Linked-file sizes are counted only when explicitly labeled in bytes, deduplicated by URL, and marked unverified; missing/conflicting declarations remain unknown. Nothing is uploaded to the portal. Protected exports must not be committed under `public/data`.

Collection review limits are 20 MiB per import, 50 MiB of original JSON per session, 100 files, 10,000 records, 64 nesting levels and 200,000 values. A combined export above the 20 MiB import boundary requires downloading its individual original JSON files. ZIP bundles and HTML imports are not implemented.

## Refreshing source evidence

Refresh the snapshot explicitly (requires public source access; no login or writes):

```sh
python3 scripts/nechako-server/snapshot_showcase.py
python3 scripts/nechako-server/check_showcase.py
```

The capture stages and validates all responses before replacing the prior snapshot. It refuses to replace a directory without the showcase manifest. Review changed counts, timestamps and source metadata before committing. The offline checker verifies file hashes/lengths, catalogue counts, research/location relationships and the workspace geometry against its source coordinates. The browser checks block external portal/research data requests at desktop and phone widths while exercising the actual bundled files.

Refresh preserves the separately captured nine reviewed anonymous project files
and their source date; it does not recapture those maps or make their October 12
capture current. Review public-project access and refresh those definitions
explicitly before changing their evidence date or claiming current source state.

## Live read-only audit

Run from the PGMaps repository. Python 3's standard library is sufficient:

```sh
python3 scripts/nechako-server/audit_data.py --head-links --output /tmp/nechako-data-audit
```

The script writes `report.json` and `attachments.csv`. It measures the four public nwsviz JSON responses, checks the portal's saved-project list, and pages through the linked public Zotero group's attachment metadata. HTTP 200 responses with a portal failure/error are recorded as failures. A page/request bound, denied access or malformed response is reported rather than treated as a complete empty catalogue.

`--head-links` optionally checks HTTPS GET links using HEAD only. It does not download PDFs, audio, video, images or archives. HTML/JSON landing-page lengths and compressed transfer lengths are excluded from file-size totals. HTTP links, unsupported HEAD requests and native portal POST downloads remain unmeasured. The CSV lists each reference's type, download method, available byte size and probe result. Sizes are deduplicated by exact URL; this is an observed subtotal, not total portal storage. Unknown sizes remain unknown, including when no accessible files are found.

For **known portal submission IDs**, repeat `--submission-id`:

```sh
python3 scripts/nechako-server/audit_data.py --submission-id 123 --submission-id 456 --output /tmp/nechako-data-audit
```

These numbers are examples, not verified portal IDs. Use IDs supplied by the portal's search or an authorized export. The script never enumerates IDs and never assumes nwsviz record numbers are portal submission numbers. It uses anonymous reads; protected attachment metadata requires an export obtained through your authorized portal account.

To inspect exported attachment metadata, use `--attachment-manifest /path/to/export.json` (repeatable). Accepts the native attachment array or `{ "attributes": [...] }`. Native fields include `name`, `metadata` and `download`; `download` resolves under the portal's `rest/` directory and requires a POST in the original client, so it is not probed as GET. Generic manifests may use `title`, `url`, `content_type`, and explicitly labeled `size_bytes`. Undocumented `size`/`metadata` units are not added to totals. Do not commit private exports or generated reports to the repository.

Other options: `--skip-zotero`, `--zotero-group ID`, `--max-pages 20` (100 attachment items per page), `--max-probes 100`, and `--timeout 30` (seconds per request). Zotero long backoff or errors stop that inventory; rerun later. The result is a point-in-time audit, not an atomic snapshot while an external catalogue is changing.

## Verified October 11, 2026

- Public nwsviz: **1,408 research records**, 51 location IDs, four JSON files totaling **802,513 bytes**. The research rows have no file URL, DOI, Zotero key or attachment-size field.
- Linked public Zotero group 5510344: **767 top-level items** and **8 attachment entries**, all `linked_url` references with `text/html` content type. No downloadable file enclosure is advertised for these eight entries. This library is a separate live catalogue; a complete mapping to the 1,408-record generated dataset is not established.
- Portal saved-project listing: **“Website not registered”**, even with HTTP 200. No full project count or portal attachment storage total is established.

These results do not establish that PDFs/videos are absent from the full portal, private library or external publishers. They establish what these public endpoints expose. Counting the portal's actual documents/media requires an accessible attachment catalogue, known submission IDs or an authorized export; measuring total storage requires reliable byte sizes or a server-side storage inventory. The script does not authenticate, write portal data, repair registration, or test browser CORS. Existing browser CORS evidence and the deployment steps are in [the server runbook](server-runbook.md).

Offline validation:

```sh
python3 scripts/nechako-server/test_audit_data.py
```

## Live monitoring scope — October 12 proof of concept

The association-safe local gateway verified submission **1477**, form **39**, spatial layer **386** (Upper_Nechako), and its source `schema_rec_seq_id` **1** with `monitor_status` **ENABLED**. `getMonitorData.php` in Layer mode returned 500 rows of **25,933**, page 1 of 52, with 16 named columns. That response was **197,276 decoded bytes**, including its JSON envelope; neither row counts nor this page size establish total storage. The earlier **77,799** native-table observation is a different audit scope. Even schema 13/record 1 with the tested single-layer flag returned 25,933; no multiplication or portal-wide total is inferred.

Source dates are DD/MM/YYYY daily values. Choosing that explicit format and UTC in the PGMaps chart review accepted all 500 loaded rows, with zero rejected rows and zero duplicate station/timestamp keys. Source values and strings remain intact; daily chart placement at midnight is a display convention selected by the user. These checks do not validate meteorological field meanings or the quality/completeness of the full source collection. Live source changes were not exercised by the new implementation.
