# Nechako browser-local workbench and project packages

The local workbench stores explicit user saves in the browser and produces portable backups, actual GIS datasets, and a native SMASH point-note project. It does not require an application backend or a source-portal login. Source services are still needed when fetching a catalogue, downloading features, or displaying remote WMS/tile imagery.

Open it from **Local workbench** in the portal, or directly at:

- `/dev/nechako/portal?panel=local-workbench`
- `/dev/nechako?view=local-workbench`

This is a separate browser-workbench archive contract. It is not a registered PGMaps `map-explorer-v1` or `story-map-v1` project package. [Browser-local ingestion](browser-local-ingestion.md) documents the GIS, GPAP, attachment, monitoring, and submission panels that share this cache.

## What the views do

| View        | Working local behaviour                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects    | Save a named map, open it later, update it, and reopen up to 20 earlier saves. Loaded vector features, styles, camera, source order, and remote layer references are retained.                                                                                        |
| Saved items | Search and filter every saved record kind; inspect provenance; download complete JSON or the untouched original file; open a saved project; edit a schema copy; remove a reviewed item. Lists paginate instead of silently truncating.                                |
| Backups     | Download the whole cache, optionally with the current map. Review another backup, verify its files, inspect matching IDs, and explicitly choose whether matching local records may be replaced. GIS and SMASH downloads add native files to the same complete backup. |
| Schemas     | Create and edit browser-local field definitions. Local definitions validate field IDs, field types, and geometry type. Native form metadata remains preserved when editing a source copy.                                                                             |
| Storage     | See saved payload sizes and the browser's storage estimate, request persistent storage, download a backup, or clear all workbench records after entering `CLEAR`.                                                                                                     |

Saved items survive page reloads and source logout on the same origin and browser profile. They do not automatically synchronize to another device. Browser settings, private browsing, storage eviction, or a different hostname can make a different or empty cache visible. A downloaded backup remains the portable copy. Granting persistent storage reduces browser eviction risk; it does not replace a backup.

Private source content is labelled through `source.access`. Explicitly saving a source-authenticated workspace retains a private device copy. Opening that saved project sets `sessionBound: false`, so the source disconnect handler does not remove the user's intentionally retained local work. The source access label stays on the saved record. Imports and restores explain this persistence before the action.

The cache integrations do not copy connection passwords, session cookies, or gateway capabilities. Provenance metadata accepts a restricted set of fields and refuses credential-bearing source URLs. Original files and domain fields remain unchanged: a legitimate form field named `password` is not silently removed. Anyone with a downloaded backup can read its contents; the archive is not encrypted.

## Storage API and record contract

Implementation: `src/maps/nechako/data/localWorkbench.ts` and `useLocalWorkbench.ts`.

Dexie opens IndexedDB database `pgmaps.nechako.local-workbench.v1`, version 1, with a `records` table indexed by `id`, `kind`, `updatedAt`, and `[kind+updatedAt]`.

```ts
type LocalWorkbenchRecord<T = unknown> = {
  id: string
  kind: LocalWorkbenchKind
  name: string
  createdAt: string
  updatedAt: string
  data: T
  blob?: Blob
  filename?: string
  mime?: string
  source?: {
    url?: string
    portal?: string
    recordId?: string
    importedAt?: string
    access?: 'public' | 'private' | 'unknown'
    notes?: string
  }
  bytes: number
}
```

Built-in kinds are `layer`, `style`, `schema`, `submission`, `attachment`, `monitoring`, `geopaparazzi`, and `project`. Kinds are extensible lowercase identifiers; `style-defaults`, saved queries, and later kinds receive the same storage and backup treatment. The whole-cache exporter does not filter out unrecognized kinds.

`data` is finite JSON. Blobs belong in `blob`, so original SQLite projects, photographs, CSV files, SLD files, or other binary files do not need lossy JSON conversion. The `bytes` value counts UTF-8 JSON data plus original binary bytes; browser storage estimates also include metadata and implementation overhead.

| API                                                          | Contract                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listLocalWorkbench(kind?)`                                  | Reads all records, or one kind, in most-recently-updated order.                                                                                                                                                    |
| `getLocalWorkbench(id)`                                      | Reads one unchanged local ID.                                                                                                                                                                                      |
| `saveLocalWorkbench(input)`                                  | Creates or updates one item. A missing ID allocates a local UUID. An existing item's kind cannot change. Omitting `blob` retains an existing original; `blob: null` explicitly removes it.                         |
| `importLocalWorkbench(records, { overwrite? })`              | Validates every item before an atomic transaction. Duplicate incoming IDs fail. Existing IDs fail unless overwrite is explicitly selected. No partial import remains after validation, conflict, or quota failure. |
| `deleteLocalWorkbench(id)` / `clearLocalWorkbench(kind?)`    | Deletes one record or all records of a kind; no kind means the whole workbench. They do not change source portal records.                                                                                          |
| `subscribeLocalWorkbench(listener)`                          | Committed-change notification, including other tabs, using Dexie live queries.                                                                                                                                     |
| `useLocalWorkbenchRecords(kind?)`                            | React records/loading/error/reload adapter with stale asynchronous result and unmount protection.                                                                                                                  |
| `localWorkbenchStorage()` / `persistLocalWorkbenchStorage()` | Browser storage estimate and explicit persistent-storage request.                                                                                                                                                  |

Local IDs are never trimmed or rewritten. Source record IDs remain verbatim strings. JSON values such as numeric zero, `false`, empty strings, and `null` retain their types. Storage failures expose distinct `invalid`, `conflict`, `quota`, `unavailable`, and `storage` error codes with actionable UI text. A failed transaction leaves the last committed copy intact.

There is no automatic background save of private source responses. Features enter this cache through explicit save, cache, or restore actions. Removing an attachment does not silently rewrite its referring draft; the UI warns about dependent records, and backup completeness reporting exposes unresolved relationships.

### Data payloads shared by the panels

| Kind             | Payload and preservation rules                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`        | `nechako-local-project-v1`, containing a validated `nechako-workspace-v1` workspace and bounded save history.                                                                                                                             |
| `layer`          | `nechako-local-layer-v1`, retaining native source IDs, descriptor/original metadata, normalized GeoJSON when available, and `materialization.status` of `complete`, `partial`, or `descriptor`. A descriptor is not a downloaded dataset. |
| `style`          | `nechako-local-style-v1`, with a typed `nechako-vector-style-v1` specification when supported, original SLD text, diagnostics, and optionally the untouched SLD Blob.                                                                     |
| `style-defaults` | `nechako-style-defaults-v1`, mapping geometry or native schema IDs to saved style record IDs. It is backed up even though it has no separate GIS file.                                                                                    |
| `schema`         | A validated local `nechako-local-schema-v1` or preserved native form definition. Saving edits changes this local record only.                                                                                                             |
| `submission`     | `nechako-local-submission-v1` draft values, original form/source IDs, mapping, issues, geometry, and attachment references. Native submissions are not allocated or published by this store.                                              |
| `attachment`     | Original Blob plus description, tags, hashes, and local relationships.                                                                                                                                                                    |
| `monitoring`     | Original rows, column mappings, validation, and derived observations or an extracted source-monitor payload. Invalid and duplicate rows remain available for review.                                                                      |
| `geopaparazzi`   | Untouched original SQLite GPAP Blob plus parsed review metadata. Original notes, media, forms, tracks, and relationships remain available in the source file.                                                                             |

## Portable backup format

Implementation: `src/maps/nechako/data/localWorkbenchBundle.ts`.

`createLocalWorkbenchBundle` produces `nechako-local-bundle-v1`. `readLocalWorkbenchBundle` is a read-only review operation; it does not write the database, change the map, or contact a source service. The UI calls the atomic import only after the review action.

| Archive entry                       | Contents                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`                     | Schema/version, record identities, paths, bytes, SHA-256 hashes, provenance, remote dependencies, relationship summary, actual GIS outputs, optional native SMASH summary, and completeness warnings. |
| `records/*.json`                    | Every full local record except its separate Blob. This includes drafts, monitoring rows, style defaults, queries, and unknown future kinds.                                                           |
| `originals/*`                       | Original files, unchanged, with their record-to-file mapping in the manifest. Filenames in the archive are safe generated paths; original filenames remain in record metadata.                        |
| `workspace.json`, `projects/*.json` | Current map when selected and materialized saved-map copies. Full project history also remains in the corresponding record JSON.                                                                      |
| `layers/*.geojson`                  | Actual available vector features in longitude/latitude. Descriptor-only layers produce no pretend geographic data.                                                                                    |
| `styles/*`                          | Typed style JSON and preserved original SLD. GIS package generation adds geometry-specific SLD sidecars.                                                                                              |
| `gis/*`                             | Optional actual GIS datasets produced in the browser.                                                                                                                                                 |
| `smash/*`                           | Optional native SMASH point-note database, companion GIS maps, form definitions, provenance, and opening instructions.                                                                                |
| `README.txt`                        | Opening/restoration instructions and completeness limits.                                                                                                                                             |

Every declared file except the manifest itself has a byte count and SHA-256 hash. These verify file consistency with the manifest; they do not authenticate the author or grant access to the original source. Source permissions, dataset completeness, and continued service availability cannot be inferred from a valid checksum.

The importer preflights the ZIP central directory, rejects unsafe or duplicate paths, split/ZIP64/encrypted archives, excessive entry counts, and oversized declarations. `readBoundedLocalZip` then checks actual expanded bytes while streaming and CRC32 for each file. An entry that understates its expanded size is stopped before its full output is accumulated. SHA-256 verification, manifest mapping, and record validation complete before any persistent write. Undeclared files and mismatching record identities are rejected.

Limits are 128 MiB compressed, 128 MiB per file, 256 MiB total expanded, 10,000 ZIP entries, a 2 MiB manifest, and 4,000 local records. Large original files can still be downloaded separately from Saved items. Source-layer GeoJSON ZIP imports use tighter limits through the same bounded reader.

WMS layers, remote tile URLs, and unresolved descriptors are recorded with `pixelsCached: false`. The archive does not contain cached imagery for them. Partial materializations are labelled as saved subsets; a source catalogue entry, current map extent, or success envelope is not evidence that all source features were downloaded. Original GPAP media and staged attachment relationships remain in the backup; unresolved local relationship targets are reported.

## Actual GIS project exports

`createGisExport` in `data/conversion.ts` runs the existing GDAL WebAssembly stack in the browser. The local workbench can convert the current map's vectors or all materialized saved layers/projects. The complete local cache remains in either export, independent of this GIS conversion scope.

| Output     | Result and limits                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeoPackage | Actual SQLite `.gpkg` vector datasets. Original GeoJSON and typed style metadata accompany them.                                                                                                                                                        |
| Shapefile  | Actual `.shp`, `.shx`, `.dbf`, projection and other companion files. Driver restrictions on attribute names/types remain explicit. The backup GeoJSON preserves richer source properties. For SMASH, companion files are unpacked into its maps folder. |
| KML        | Actual `.kml` for general GIS export. The SMASH package button requires another documented map format.                                                                                                                                                  |
| GPX        | Actual points/lines; polygons and unsupported geometries are rejected with a format-selection message. No observation timestamps are invented.                                                                                                          |
| GeoJSON    | Actual feature data with stable IDs/properties and normalized longitude/latitude geometry.                                                                                                                                                              |

SLD generation supplies sidecars only for actual geometry types allowed by the style's explicit geometry scope. A point-only style remains point-only in a mixed layer; other geometries remain in the GIS data and the manifest identifies their lack of a generated symbolizer. Allowed mixed geometries receive separate, labelled sidecars. If a valid local style cannot be represented safely in SLD, such as a field name requiring an unsupported XML property reference, the sidecar is omitted with a diagnostic while the GIS package still completes. Typed style JSON and original SLD remain in the backup. Single and comparison rules use SLD 1.0; gradients use SE interpolation. Shapefile field shortening may require corresponding filter adjustments in the receiving GIS. Automatic external style adoption is not promised.

This implementation loads static JavaScript/WebAssembly application assets; it sends no geometry to an application conversion endpoint. It does not add a service worker or installable offline app. Opening the site or loading conversion code for the first time may still need network access to the app's static assets. WMS imagery and other remote services remain separate dependencies.

## Native SMASH / Geopaparazzi export

Implementation: `src/maps/nechako/data/smashProjectExport.ts`.

The SMASH button creates a real SQLite `.gpap` database under `smash/projects/`, plus map assets under `smash/maps/`, editable provenance form definitions under `smash/forms/`, and `smash/OPEN-IN-SMASH.txt`. The outer ZIP is a delivery archive; extract it and use SMASH's project and map file pickers. The package does not modify device application settings or automatically install a layer list.

The database tables and fields follow the pinned official [SMASH project database implementation](https://github.com/geopaparazzi/smash/blob/bf104ae4e27ae50302155557798d22c7b8cc0281/lib/eu/hydrologis/smash/project/project_database.dart) and [SMASH shared project models](https://github.com/geopaparazzi/smashlibs/tree/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/projectdb). The form definition follows the official [form model](https://github.com/geopaparazzi/smashlibs/blob/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/forms/forms.dart). Format references are also included in the generated provenance file.

| Source content                                     | Native output                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Point                                              | One new native note and marker extension.                                                                                                                                                                                                                                                                                                              |
| MultiPoint                                         | One native note per position, with original feature ID and point index retained.                                                                                                                                                                                                                                                                       |
| Line, polygon, geometry collection, or no geometry | Retained in the companion GIS data; not converted into fabricated GPS tracks.                                                                                                                                                                                                                                                                          |
| Original feature ID and attributes                 | Stored in the native form as typed JSON plus original layer ID and feature/point indices; also retained in companion GeoJSON/GIS assets and the ID map.                                                                                                                                                                                                |
| Elevation                                          | Third GeoJSON coordinate when supplied. Missing elevation uses native `altim = -1`, matching the official [SMASH form creation fallback](https://github.com/geopaparazzi/smash/blob/bf104ae4e27ae50302155557798d22c7b8cc0281/lib/eu/hydrologis/smash/forms/form_smash_utils.dart); each missing value is explicitly labelled as unknown, not measured. |
| Timestamp                                          | Native note creation time is the export time. Original observation timestamps remain unchanged in the source attribute JSON.                                                                                                                                                                                                                           |
| Native note ID                                     | Newly allocated integer for this new database, with a separate mapping to the unchanged source layer/feature IDs.                                                                                                                                                                                                                                      |
| Map camera                                         | A native bookmark for center and zoom.                                                                                                                                                                                                                                                                                                                 |
| Existing GPAP file                                 | Untouched original in the backup, including its native notes, images, tracks, forms, and relationships.                                                                                                                                                                                                                                                |
| Staged attachment                                  | Original bytes and local relationships remain in the backup. It is not silently attached to a newly generated native note.                                                                                                                                                                                                                             |

The writer creates the standard note, marker-extension, track, track-properties, bookmark, image, image-data, and metadata tables. Empty track/image tables are intentional for newly generated point-note projects. It checks SQLite integrity and foreign-key consistency before export. A maximum of 25,000 generated point notes bounds this synchronous browser operation; larger datasets remain usable through the GIS export.

SMASH's official manual documents its [supported map formats](https://smash-smart-mobile-app-for-surveyors-happyness.readthedocs.io/en/latest/map_types.html), [storage folders](https://smash-smart-mobile-app-for-surveyors-happyness.readthedocs.io/en/latest/folder_structure.html), and [layer styling](https://smash-smart-mobile-app-for-surveyors-happyness.readthedocs.io/en/latest/layers_style.html). GeoPackage, Shapefile, GPX, and GeoJSON companion outputs follow those documented map formats. SLD sidecars are supplied, but automatic GeoPackage sidecar adoption and gradient rendering in SMASH have not been verified. These limits appear in the archive, rather than silently claiming identical rendering.

The native schema is verified against official source and through actual SQLite/GPAP reader roundtrips. Launching the generated project inside the mobile SMASH application has not been performed in this environment. The generated native point-note copy is distinct from the unchanged source GPAP originals.

## Verification

Focused unit coverage is in:

- `localWorkbench.test.ts`: IndexedDB durability across database connections, Blob retention/removal, atomic linked imports, conflicts, quota rollback, mutation notifications, source provenance validation, and typed/falsy JSON values.
- `localWorkbenchProjects.test.ts`: private saved-map independence from source sessions, history, unchanged native IDs, and local/native schema validation.
- `localWorkbenchBundle.test.ts`: full record/Blob roundtrip, all kinds, checksums, CRC, unsafe and undeclared paths, malformed expanded-size declarations, missing originals, and relationship completeness.
- `smashProjectExport.test.ts`: real SQL.js SQLite output, official table joins, integrity/foreign-key checks, reader roundtrip, point/multipoint/source-ID mapping, unknown elevations, retained original timestamps, and polygon-only companion behaviour.

`tests/e2e/nechako-local-workbench.spec.ts` uses clearly labelled synthetic records and no application backend. It exercises desktop and phone saves, reload, schema creation, full ZIP download, conflict review, clearing, restoring, Blob equality, rejection of a tampered file, and actual browser-generated GeoPackage and native GPAP database contents. The separate local-ingestion and local-style browser suites cover eight-format GDAL roundtrips, GPAP originals/media/drafts, monitoring, attachments, typed rendering, and default-style application.

No private source account was used to produce these regression fixtures. No source-portal mutation or new hosted backend is part of this workflow.
