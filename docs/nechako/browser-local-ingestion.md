# Browser-local GIS, field projects and submission drafts

Open **Import files** at `/dev/nechako/portal?panel=files` or `/dev/nechako?view=files`. These workflows parse selected files and explicitly save records to the [local workbench](local-workbench.md). They use the browser's GDAL/SQLite WebAssembly assets and IndexedDB. No application conversion server or source-portal account is required. Loading the static application and WebAssembly for the first time still needs those assets; this does not add an offline installation or service worker.

## Working imports and exports

| Workflow               | Behaviour and preserved source                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GIS files              | Import GeoJSON, Shapefile plus sidecars or ZIP, GML, GPX, KML/KMZ, SQLite, SpatiaLite, FlatGeobuf and GeoPackage. Each vector layer is reviewed separately and converted to WGS84. Cache every returned layer together with unchanged original file Blobs; add chosen layers to the map.                                                 |
| GIS attribute matching | Match source properties to an imported/native form or cached local schema, inspect required/type issues and repeated identifiers, select rows, save a mapping preset, and cache mapped local drafts. Each draft retains the original row, original feature/ID/geometry where present, field IDs, mapping and complete source definition. |
| CSV drafts             | Review CSV columns, use a local form made from those columns or an explicit source/cached schema, then save selected valid mapped rows. The original CSV is linked as an attachment. Selection never merges duplicate rows automatically.                                                                                                |
| Geopaparazzi / SMASH   | Parse the actual SQLite `.gpap` file, review forms/notes, original media, GPS logs, track points and explicit relationships. Choose notes to create local drafts, inspect conflicts, and save the original database, parsed map layers, media and selected drafts atomically.                                                            |
| Attachments            | Stage original bytes with a SHA-256 hash, original name, description, tags and optional local draft relationship. Reopen/edit metadata, preview supported media, download original bytes, or remove a local attachment. Removing it does not silently rewrite referencing drafts.                                                        |
| Monitoring CSV         | Map date/time, timezone, station, primary/secondary values and units. Cache every original row and the CSV, alongside valid observations, exact mapping, duplicate counts and row errors. Rows with issues require explicit acknowledgement; they remain in the saved source. Reopen and chart saved observations in Monitoring.         |
| Saved local drafts     | Reopen CSV/GIS/GPAP drafts, or create a blank draft from a cached schema. Edit typed values, title, WGS84 geometry, attachment links and local Draft/Reviewed/Archived status. Keep the original source and up to 20 prior saved revisions. Download the edited record, add its geometry to the map, or remove the local draft.          |

Blank schema drafts start with null values and no geometry; defaults in the source definition are retained for inspection rather than silently supplied as observations. The local editor distinguishes text, numbers, booleans, null and structured JSON. Missing values are not replaced with zero. Source permission checks, server validation and publication remain separate from these local review statuses.

`createGisExport` returns actual GIS bytes for GeoPackage, Shapefile, KML, KMZ, GPX, SQLite, SpatiaLite, GML and GeoJSON. `exportGis` downloads the same result. Shapefile and GML exports are ZIP archives containing geometry/attribute/schema sidecars and `original.geojson`. KML/GPX have narrower attribute types; their warnings recommend keeping the original GeoJSON. GPX rejects polygons and other unsupported geometry, and does not invent observation timestamps.

Where a feature has an ID, native conversion adds collision-free `pgm_id` / `pgm_idtyp` attributes, or suffixed names when those columns already exist. These retain the original ID text and type even if a destination driver assigns its own feature ID. GeoJSON export retains the original feature structure directly. Integer JSON literals outside JavaScript's exact range and native 64-bit integer columns are kept as decimal strings. Coordinate reprojection and destination driver type restrictions still apply; the unchanged source files and companion GeoJSON preserve evidence for later comparison.

All GDAL calls borrow the existing exclusive queue in `src/pages/dev-avast/gdal.ts`. Its worker has one shared input mount, so imports/exports cannot bypass that queue without invalidating another operation's inputs.

## GPAP schema and relationship contract

The parser follows the pinned official [Geopaparazzi table definitions](https://github.com/geopaparazzi/geopaparazzi/blob/d84a48fd31e4fa12f43d320ec7d48df7a6d52a37/geopaparazzi_library/src/main/java/eu/geopaparazzi/library/database/TableDescriptions.java), [SMASH shared project models](https://github.com/geopaparazzi/smashlibs/tree/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/projectdb), and [SMASH form model](https://github.com/geopaparazzi/smashlibs/blob/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/forms/forms.dart). These URLs are also stored in the parsed review metadata.

| Native content                                | Imported representation                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notes`, `notesext`                           | Native IDs, coordinates, altitude, timestamps, text, descriptions, dirty state, raw form JSON and extension metadata. Invalid/missing coordinates remain null geometry with an issue.                                                                                                     |
| Form sections/items                           | Original form JSON and widget metadata plus scoped field paths. Repeated labels or keys remain distinct. Supported image/sketch references become explicit media relationships; unknown widget semantics are retained without pretending to interpret them.                               |
| `images`, `imagedata`                         | Native image/note/data IDs, complete original image bytes and available thumbnails. Missing/orphan/ambiguous links become issues; duplicate image-data IDs are not resolved by choosing an arbitrary first record.                                                                        |
| `gpslogs`, `gpslogsdata`, `gpslogsproperties` | Native log and parent IDs, raw and filtered positions, timestamps and display properties. Invalid positions break a rendered line instead of bridging the gap. Orphan points remain in review data. Explicit track relationships are used; proximity does not invent note-to-track links. |
| Other tables                                  | Name/schema inventory and complete original database retained. Unknown application tables are not presented as parsed functional support.                                                                                                                                                 |

SQLite reads run with query-only/trusted-schema restrictions. Recognized virtual tables are rejected. SQL integers use the runtime's exact bigint reads before safe conversion to numbers or decimal strings. Numeric zero and false survive form, media and relationship parsing.

The package's SHA-256 identity prevents an exact original from being imported twice accidentally. Across changed files, note conflict review uses source device ID, project creation timestamp and native note ID when those exist. A filename fallback is explicitly labelled unverified. Matching records are reported as duplicates or conflicts, never merged automatically. Acknowledged changed versions receive separate local records. All source media and parsed map layers are retained even when only some note drafts are selected.

Downloading the original GPAP returns its unchanged bytes. Generating a **new native SMASH project** is a separate [workbench export](local-workbench.md#native-smash--geopaparazzi-export): its new note IDs and export-time metadata must not be confused with the original GPAP records. Mobile SMASH launch acceptance has not been performed here.

## Bounds and persistence

- GIS: 50 MiB combined input, 100 MiB expanded input, 5,000 archive entries, and 100,000 features per normalized layer. Unknown CRS requires an explicit source CRS. GPAP files use the dedicated importer.
- Archives: shared bounded ZIP reader rejects unsafe/duplicate paths, unsupported archive structures, oversized declarations, actual expansion beyond declared bounds, and CRC mismatches before conversion. GIS uses tighter limits than whole-workbench backups.
- XML: standalone and archived GML, KML, GPX and XSD containing DOCTYPE/entity declarations are rejected before GDAL, including their wide-character representations.
- GPAP: 50 MiB file, 100,000 rows per recognized table, and 5,000 form fields per note. Over-limit reads fail; they are not saved as a complete partial import.
- Monitoring CSV: 20 MiB and 50,000 rows. Mapped draft review is bounded to 10,000 source rows and 200 target form/schema fields.
- Attachments: 100 MiB per file. Storage/quota failures are surfaced by the atomic cache API and do not leave a partially linked import.

These limits bound browser work; they do not certify source-database completeness. Cached GIS materialization is complete for the selected file and uses `countVerified:false` unless independently verified elsewhere. Saves remain in the same browser/origin after source logout. Export a workbench backup for portability; cache deletion, browser eviction or a different device can remove or hide local state.

The shared record contracts are `nechako-local-layer-v1`, `nechako-local-submission-v1`, `nechako-local-attachment-v1` and `nechako-local-monitoring-v1`. Originals stay in Blob fields; relationships use local record IDs and preserve native IDs separately. `match-preset` records retain explicit source-column-to-field-ID mappings. No credentials or live gateway session state are needed by these import APIs.

## Verification

The synthetic SQLite fixture at `tests/fixtures/nechako/local-field-project.gpap` includes zero IDs/coordinates, an integer beyond JavaScript's exact range, false form values, duplicate form keys, original image bytes, missing media, parent tracks and invalid/orphan points. It contains no private portal data.

- `geopaparazzi.test.ts` exercises real SQLite reads, original bytes, IDs, raw/scoped forms, media/track relationships, conflicts and cached draft preservation.
- `localIngestion.test.ts` covers original attachment identity, atomic duplicate handling, canonical cached layers, complete monitoring source retention, collision-free typed feature IDs, XML declaration rejection and export validation.
- `localDrafts.test.ts` covers typed editing, exact IDs, retained source forms/history, geometry/rule validation and blank drafts from saved schemas.
- `nechako-local-ingestion.spec.ts` runs actual browser GDAL export/readback for all eight non-GeoJSON formats with application API writes blocked, then tests desktop/390px GPAP, attachment, CSV mapping, monitoring, reload and draft editing.
- The existing `nechako-workflows.spec.ts` GDAL regression now uses browser-produced GeoPackage bytes and no native `ogr2ogr` executable or application backend.

This verifies local file processing and persistence. It does not claim that the rejected source login now works, that source publishing has been enabled, or that every third-party GPAP widget/schema variant has been accepted.
