# BC Data Catalogue and ArcGIS Live Usage

PGMaps may use public BC Data Catalogue records and BC-published ArcGIS REST services, but live upstream services should be treated as source systems, not as unlimited production infrastructure.

## Licence Position

Many BC government datasets are published under the Open Government Licence - British Columbia. When a dataset record specifies that licence, it generally permits copying, modifying, publishing, adapting, distributing, and commercial use, provided PGMaps follows the licence terms.

Before adding a dataset, confirm the licence on the specific BC Data Catalogue or ArcGIS Hub record. The Open Government Licence - BC only applies to records that explicitly specify it.

Required handling:

- Preserve source attribution in dataset metadata, map layer panels, exports, or related documentation.
- Use a specific attribution statement when the provider supplies one.
- If no specific attribution is practical, use: `Contains information licensed under the Open Government Licence - British Columbia.`
- Do not imply Province of British Columbia endorsement, official status, or certification of PGMaps.
- Check for third-party, personal-information, emergency-management, or source-specific restrictions before reuse.

Primary references:

- Open Government Licence - British Columbia: https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc
- API Terms of Use for Information provided under the OGL-BC: https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/api-terms-of-use-for-ogl-information

## API and Service Limits

BC API terms allow the information provider to impose or adjust API limits without notice to maintain service stability and protect other applications using the same infrastructure. APIs are provided as-is and as-available.

ArcGIS REST services also expose per-layer operational limits. Common limits include:

- `maxRecordCount`, often 1000 or 2000 features per query.
- Pagination requirements through `resultOffset` and `resultRecordCount`.
- Cache windows such as `cacheMaxAge`.
- Schema, URL, field, geometry, and availability changes controlled by the upstream provider.
- Possible throttling, transient failures, partial responses, or changed CORS behaviour.

Do not assume a FeatureServer or MapServer layer can support direct, high-volume browser traffic from all PGMaps users.

## PGMaps Policy

Use live ArcGIS or BC API calls only for small or frequently changing data where freshness is more important than full control.

Good live candidates:

- Current station readings.
- Advisory or alert points.
- Small search or lookup endpoints.
- Small layers where bounded queries can be made by viewport, time range, or ID.

Prefer scheduled sync, cached snapshots, or PMTiles/GeoJSON assets for:

- Large polygon layers.
- Historical archives.
- Scoring or index inputs.
- Layers needed for deterministic reports.
- Layers with expensive full-table queries.
- Anything central to the app experience where upstream outage would break the page.

The preferred production pattern is:

1. Pull from the source service in scraper tooling under `vendor/bcdatamapper`.
2. Normalize, simplify, validate, and record source metadata.
3. Publish optimized app data under `public/data` or hosted PMTiles.
4. Refresh on a documented cadence.
5. Keep live queries only for data that genuinely needs live freshness.

## Implementation Checklist

Before adding a live BC Data Catalogue or ArcGIS layer:

- Confirm the dataset licence and attribution requirement.
- Check the ArcGIS layer metadata endpoint with `?f=json`.
- Record `maxRecordCount`, pagination support, geometry type, fields, and update/cache metadata where useful.
- Use bounded queries when possible: viewport geometry, date filters, selected fields, and `returnGeometry=false` where geometry is not needed.
- Page large results instead of requesting an entire layer in one call.
- Use abortable fetches in React views.
- Show a clear non-blocking error state when upstream data is unavailable.
- Avoid using `cache: 'no-store'` unless live freshness is required.
- Add a local fallback or synced copy for core user-facing flows.
- Document the source URL and licence in `src/lib/dataCatalog.ts`.

## Current Repo Examples

Existing live patterns:

- `src/maps/pgdata/flood.tsx` queries BC River Forecast Centre ArcGIS services for current and forecast station context.
- `src/maps/pgdata/hooks/useCrimeData.ts` pages through the City of Prince George crime FeatureServer.

Existing cached/synced patterns:

- `vendor/bcdatamapper/datascrapers/*` contains source-specific sync scripts.
- `public/data/*` contains normalized app data used by the frontend.
- Large or derived datasets, such as drought, flood text archives, heat/shade, walkability, CANUE, and census outputs, are better served as normalized local assets or PMTiles rather than direct browser queries.
