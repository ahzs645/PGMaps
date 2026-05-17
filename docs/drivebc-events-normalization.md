# DriveBC Events Normalization Notes

Source file inspected: `/Users/ahmadjalil/Downloads/drivebc_events_hist_2025.csv`

## Refresh Sources

The historical source is the BC Data Catalogue dataset `historical-drivebc-events`:

- Catalogue page: `https://catalogue.data.gov.bc.ca/dataset/historical-drivebc-events`
- CKAN package API: `https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=cdf6ab31-fa03-479a-b6e0-f9a0c71edf91`
- Current package name: `historical-drivebc-events`
- Current package id: `cdf6ab31-fa03-479a-b6e0-f9a0c71edf91`
- Licence: Open Government Licence - British Columbia
- Refresh cadence: annually for historical CSV resources

The current/live source is DriveBC's Open511 API:

- API docs: `https://api.open511.gov.bc.ca/help`
- Events endpoint: `https://api.open511.gov.bc.ca/events`
- JSON example: `https://api.open511.gov.bc.ca/events?format=json&limit=500`
- Useful filters: `status`, `severity`, `event_type`, `event_subtype`, `created`, `updated`, `road_name`, `area_id`, `bbox`, `in_effect_on`
- API page documents a maximum request limit of 500 and pagination with `limit` and `offset`.

The historical catalogue currently exposes annual files from 2006 onward. As of inspection on 2026-05-16, the latest historical CSV resource is:

- `DriveBC_events_hist_2025`
- URL: `https://catalogue.data.gov.bc.ca/dataset/cdf6ab31-fa03-479a-b6e0-f9a0c71edf91/resource/e402a618-8368-4f2d-a376-88cfddbe0d2a/download/drivebc_events_hist_2025.csv`
- Size: 110,488,505 bytes
- Last modified: 2026-02-20T23:14:43.246545
- Temporal extent: 2025-01-01 to 2025-12-31

Recommended refresh strategy:

1. Use the CKAN package API to discover available annual resources instead of hard-coding resource ids.
2. Download only CSV resources by default; ignore older KMZ duplicates unless needed for pre-2008 geometry validation.
3. Cache source CSVs outside `public/`, for example `data-sources/drivebc/`.
4. Build normalized web outputs into `public/data/drivebc/`.
5. Optionally merge latest active Open511 API events into a separate `events_live` layer so the historical layer is annual and stable while current conditions remain fresh.

## Fit for PGMaps

The file is usable for mapping after preprocessing. It has 191,412 rows and every row has `HEAD_LATITUDE`, `HEAD_LONGITUDE`, `TAIL_LATITUDE`, and `TAIL_LONGITUDE`. The raw CSV should not be shipped directly to the browser because it is about 110 MB and contains non-UTF-8 bytes. A build step should read it with tolerant decoding, normalize fields, filter or aggregate, and write UTF-8 GeoJSON/JSON outputs under `public/data/drivebc/`.

Geometry should be derived as:

- `LineString` when head and tail coordinates differ.
- `Point` when head and tail coordinates are identical.
- Optional heatmap points from segment midpoint or head coordinate for high-level density views.

The head/tail coordinates are event extents, not road-network geometry. Long highway events will render as straight segments unless later snapped to a road network.

## Recommended Normalized Fields

Keep the raw DriveBC fields for traceability, but expose these normalized fields to the app:

- `id`: source `ID`
- `status`: lower-case source status, currently `active` or `archived`
- `eventType`: lower-case source `EVENT_TYPE`
- `eventSubtype`: lower-case source `EVENT_SUBTYPE`, or `unknown`
- `eventGroup`: site-facing group for filtering and styling
- `conditionCode`: site-facing condition/hazard code
- `severity`: lower-case source severity, currently `minor` or `major`
- `severityRank`: numeric rank, `1` for minor and `2` for major
- `startedAt`: ISO timestamp from `START_DATETIME`
- `endedAt`: ISO timestamp from `END_DATETIME`, nullable
- `updatedAt`: ISO timestamp from `UPDATED`
- `areaName`: source `AREA_NAME`
- `roadName`: source `ROAD_NAME`
- `direction`: normalized direction, `none`, `both`, `n`, `s`, `e`, or `w`
- `headline`: source `HEADLINE`
- `description`: source `DESCRIPTION`
- `geometryKind`: `point` or `segment`
- `segmentKm`: head-to-tail haversine distance in kilometres

## Historical Schema Bridge

Use the strict machine-readable bridge in `docs/drivebc-events-strict-bridge.json` for implementation. A full field/value inventory generated from the downloaded source files is in `data-sources/drivebc/historical/schema-inventory.json`.

The bridge should be strict: do not map legacy values to modern Open511 codes unless the source already contains that modern code. Use source-preserving fields plus explicit compatibility fields instead.

The annual CSV files are structurally bridgeable, but the source schema changes by era:

| Years | Source shape | Bridge quality |
| --- | --- | --- |
| 2006-2012 | 15 columns: `id`, `cause`, `district`, `state`, `severity`, `localupdatetime`, `advisorymessage`, `trafficpattern`, coordinates, `route`, `type` | Structurally bridgeable. No exact Open511 `STATUS`, `EVENT_TYPE`, or `EVENT_SUBTYPE`. |
| 2013-2017 | 26 columns: old fields plus `createdtime`, `starttime`, `endtime`, `geometry`, `direction`, `from`, `to`, `ivradvisorymessage` | Structurally bridgeable with better time/road fields. No exact Open511 `STATUS`, `EVENT_TYPE`, or `EVENT_SUBTYPE`. |
| 2018-2024 | 27 columns: Open511-style fields including `IVR_MESSAGE`, `EVENT_TYPE`, `EVENT_SUBTYPE`, `ROAD_*` | Direct Open511-style bridge after header cleanup. |
| 2025 | 26 columns: Open511-style fields without `IVR_MESSAGE` | Direct Open511-style bridge after header cleanup. |

### Old-to-normalized field crosswalk

| Strict normalized field | 2006-2012 | 2013-2017 | 2018-2025 |
| --- | --- | --- | --- |
| `sourceId` | `id` | `id` | `ID` |
| `displayId` | `drivebc.ca/{id}` | `drivebc.ca/{id}` | `ID` |
| `sourceSchema` | `legacy_15` | `legacy_26` | `open511_27` or `open511_26` |
| `sourceSeverity` | `severity` | `severity` | `SEVERITY` |
| `sourceAreaName` | `district` | `district` | `AREA_NAME` |
| `sourceRoadName` | `route` | `route` | `ROAD_NAME` |
| `sourceDescription` | `advisorymessage` | `advisorymessage` | `DESCRIPTION` |
| `sourceUpdatedAt` | `localupdatetime` | `localupdatetime` | `UPDATED` |
| `sourceGeometry` | head/tail coordinate fields | head/tail coordinate fields and optional `geometry` source field | head/tail coordinate fields |
| `legacyCause` | `cause` | `cause` | null |
| `legacyType` | `type` | `type` | null |
| `legacyState` | `state` | `state` | null |
| `legacyTrafficPattern` | `trafficpattern` | `trafficpattern` | null |
| `legacyCreatedTime` | null | `createdtime` | null |
| `legacyStartTime` | null | `starttime` | null |
| `legacyEndTime` | null | `endtime` | null |
| `status` | null | null | `STATUS` |
| `eventType` | null | null | `EVENT_TYPE` |
| `eventSubtype` | null | null | `EVENT_SUBTYPE` |
| `createdAt` | null | null | `CREATED` |
| `startedAt` | null | null | `START_DATETIME` |
| `endedAt` | null | null | `END_DATETIME` |

### Exact compatibility normalizations

These are value cleanups, not semantic remaps to a different source vocabulary.

| Source field | Source value | Compatibility value |
| --- | --- | --- |
| legacy `type` | `Road Condition` | `road_condition` |
| legacy `type` | `Incident` | `incident` |
| legacy `type` | `Current Planned` | `current_planned` |
| legacy `type` | `Future Planned` | `future_planned` |
| legacy `state` | `Ongoing` | `ongoing` |
| legacy `state` | `Future` | `future` |
| legacy `state` | `TermRespOngo` | `term_resp_ongo` |
| legacy `severity` | `Normal` | `normal` |
| legacy `severity` | `Major` | `major` |
| Open511 `SEVERITY` | `MINOR` | `minor` |
| Open511 `SEVERITY` | `MAJOR` | `major` |
| Open511 `EVENT_TYPE` | `ROAD_CONDITION` | `road_condition` |
| Open511 `EVENT_TYPE` | `INCIDENT` | `incident` |
| Open511 `EVENT_TYPE` | `CONSTRUCTION` | `construction` |
| Open511 `EVENT_TYPE` | `WEATHER_CONDITION` | `weather_condition` |
| Open511 `EVENT_TYPE` | `SPECIAL_EVENT` | `special_event` |

Do not combine `normal` and `minor` into one source value. If the UI needs a single display scale, add a clearly named field such as `displaySeverityTier` and document that it is a UI classification, not source equivalence.

### Values that are not bridgeable without approximation

These must stay in separate fields unless a later source document defines an official equivalence:

- Legacy `cause` is not equivalent to Open511 `EVENT_SUBTYPE`.
- Legacy `type` values `Current Planned` and `Future Planned` are not equivalent to Open511 `CONSTRUCTION`; they can include construction, maintenance, ferry work, special events, and other planned disruptions.
- Legacy `state` is not equivalent to Open511 `STATUS`; it describes state at record time, not the archived lifecycle.
- Legacy `severity=Normal` is not equivalent to Open511 `SEVERITY=MINOR`; it is only a separate source severity value.

The importer can still expose UI filters such as "winter", "construction/maintenance", or "incident-like", but those must be named as `displayCategory` or `uiCategory` and generated from a separate, documented UI taxonomy. They should not overwrite source fields or be called `EVENT_SUBTYPE`.

### Legacy value inventory

Across 2006-2017, there are 87 distinct legacy `cause` values, 4 legacy `type` values, 12 `trafficpattern` values, 3 `state` values, and 2 `severity` values. The full value counts are available in `data-sources/drivebc/historical/schema-inventory.json`.

## Event Group Mapping

Use `EVENT_TYPE` as the first-level grouping:

| Raw `EVENT_TYPE` | Normalized `eventGroup` | Suggested label |
| --- | --- | --- |
| `ROAD_CONDITION` | `road_condition` | Road condition |
| `WEATHER_CONDITION` | `weather` | Weather |
| `CONSTRUCTION` | `construction` | Construction |
| `INCIDENT` | `incident` | Incident |
| `SPECIAL_EVENT` | `special_event` | Special event |

## Condition Code Mapping

Use `EVENT_SUBTYPE` for second-level filtering. The codes observed in this file map cleanly:

| Raw `EVENT_SUBTYPE` | Normalized `conditionCode` | Suggested label |
| --- | --- | --- |
| `PARTLY_ICY` | `partly_icy` | Slippery / partly icy |
| `PARTLY_SNOW_PACKED` | `partly_snow_packed` | Partly snow packed |
| `SNOW_PACKED` | `snow_packed` | Snow packed |
| `ICE_COVERED` | `ice_covered` | Ice covered |
| `SURFACE_WATER_HAZARD` | `surface_water` | Surface water |
| `POOR_VISIBILITY` | `poor_visibility` | Poor visibility |
| `STRONG_WINDS` | `strong_winds` | Strong winds |
| `HEAVY_DOWNPOUR` | `heavy_downpour` | Heavy downpour |
| `AVALANCHE_HAZARD` | `avalanche_hazard` | Avalanche hazard |
| `FIRE` | `fire` | Fire |
| `SPILL` | `spill` | Spill |
| `OBSTRUCTION` | `obstruction` | Obstruction |
| `SIGNAL_LIGHT_FAILURE` | `signal_failure` | Signal failure |
| `ROAD_MAINTENANCE` | `road_maintenance` | Road maintenance |
| `ROAD_CONSTRUCTION` | `road_construction` | Road construction |
| `PLANNED_EVENT` | `planned_event` | Planned event |
| `ALMOST_IMPASSABLE` | `almost_impassable` | Almost impassable |
| `HAZARD` | `hazard` | Hazard |
| blank | `unknown` | Unknown |

For styling, derive a broader `hazardFamily`:

- `winter`: `partly_icy`, `partly_snow_packed`, `snow_packed`, `ice_covered`
- `weather_visibility`: `poor_visibility`, `strong_winds`, `heavy_downpour`
- `water_slide_avalanche`: `surface_water`, `avalanche_hazard`
- `incident`: `hazard`, `fire`, `spill`, `obstruction`, `signal_failure`, `almost_impassable`
- `works`: `road_maintenance`, `road_construction`
- `planned`: `planned_event`
- `unknown`: `unknown`

## Dataset Stats

Province-wide:

- Rows: 191,412
- Rows with head coordinates: 191,412
- Rows with tail coordinates: 191,412
- Status: 145,707 active, 45,705 archived
- Severity: 172,412 minor, 19,000 major
- Rows with `END_DATETIME`: 29,675
- Segment length: median 32.22 km, mean 43.50 km, p90 97.47 km

Province-wide by event type:

| Event type | Rows |
| --- | ---: |
| `ROAD_CONDITION` | 103,091 |
| `INCIDENT` | 33,592 |
| `CONSTRUCTION` | 27,561 |
| `WEATHER_CONDITION` | 26,501 |
| `SPECIAL_EVENT` | 667 |

Province-wide top subtype combinations:

| Event/subtype | Rows |
| --- | ---: |
| `ROAD_CONDITION` / `PARTLY_ICY` | 78,279 |
| `INCIDENT` / `HAZARD` | 31,256 |
| `CONSTRUCTION` / `ROAD_MAINTENANCE` | 24,143 |
| `WEATHER_CONDITION` / `POOR_VISIBILITY` | 17,065 |
| `ROAD_CONDITION` / `PARTLY_SNOW_PACKED` | 8,653 |
| `ROAD_CONDITION` / `SNOW_PACKED` | 6,894 |
| `WEATHER_CONDITION` / `HAZARD` | 4,180 |
| `ROAD_CONDITION` / `SURFACE_WATER_HAZARD` | 3,696 |
| `WEATHER_CONDITION` / `PARTLY_ICY` | 2,840 |
| `ROAD_CONDITION` / `POOR_VISIBILITY` | 2,694 |

Rough Prince George bbox `[-124.2, 53.3, -122.0, 54.5]`:

- Rows: 4,609
- Status: 3,314 active, 1,295 archived
- Severity: 4,486 minor, 123 major
- Area names: 3,518 Fort George District, 1,091 Cariboo District

Rough Prince George bbox by event type:

| Event type | Rows |
| --- | ---: |
| `ROAD_CONDITION` | 3,014 |
| `CONSTRUCTION` | 780 |
| `WEATHER_CONDITION` | 557 |
| `INCIDENT` | 241 |
| `SPECIAL_EVENT` | 17 |

Rough Prince George bbox top roads:

| Road | Rows |
| --- | ---: |
| Highway 97 | 2,446 |
| Highway 16 | 1,553 |
| Highway 27 | 571 |
| Other Roads | 29 |
| Blackwater Rd | 10 |

Rough Prince George bbox top subtype combinations:

| Event/subtype | Rows |
| --- | ---: |
| `ROAD_CONDITION` / `PARTLY_ICY` | 2,833 |
| `CONSTRUCTION` / `ROAD_MAINTENANCE` | 698 |
| `WEATHER_CONDITION` / `POOR_VISIBILITY` | 304 |
| `INCIDENT` / `HAZARD` | 216 |
| `WEATHER_CONDITION` / `HAZARD` | 140 |
| `WEATHER_CONDITION` / `PARTLY_ICY` | 103 |
| `ROAD_CONDITION` / `SNOW_PACKED` | 66 |
| `ROAD_CONDITION` / `PARTLY_SNOW_PACKED` | 61 |
| `CONSTRUCTION` / `ROAD_CONSTRUCTION` | 54 |
| `CONSTRUCTION` / `HAZARD` | 28 |

## Importer Notes

The importer should:

1. Read with `encoding='latin-1'` or another tolerant mode, then write UTF-8 outputs.
2. Preserve source fields in CSV output, but compact GeoJSON properties for the web.
3. Generate at least `manifest.json`, `events_pg.geojson`, and `events_pg_summary.json`.
4. Consider separate outputs for `events_fort_george.geojson`, `events_north_central.geojson`, or annual/monthly aggregates if province-wide display is needed.
5. Avoid loading all 191k raw features into the default map view. Use PG-filtered files, vector tiles, or pre-aggregated summaries.

## Storage Format Recommendation

Best default for PGMaps:

- Use PMTiles for spatial rendering when showing province-wide or multi-year data.
- Use tiny JSON summaries for filters, counts, charts, and legends.
- Use a compact JSON detail/index file only for the current filtered study area or selected year.

Size tests from the 2025 file:

| Output | Scope | Size |
| --- | --- | ---: |
| Raw CSV | BC 2025 | 110.5 MB |
| Raw CSV gzipped | BC 2025 | 18.8 MB |
| Compact normalized JSON gzipped | BC 2025 | 3.2 MB |
| Normalized GeoJSONSeq | BC 2025 | 48 MB |
| PMTiles from normalized GeoJSONSeq | BC 2025 | 13 MB |
| Compact normalized JSON gzipped | rough PG bbox 2025 | 39.8 KB without headline, 45.7 KB with headline |
| Normalized GeoJSON gzipped | rough PG bbox 2025 | 54.1 KB |
| PMTiles | rough PG bbox 2025 | 1.2 MB |

Interpretation:

- For a PG-only layer, gzipped compact JSON or gzipped GeoJSON is smaller than PMTiles and is simple to render.
- For all-BC rendering, PMTiles is preferable because the browser fetches only visible tiles instead of downloading a full 3.2 MB gzipped all-record array up front. The PMTiles output is larger in total bytes, but it is viewport-scaled and uses the app's existing PMTiles pattern.
- For multi-year historical data, avoid a single giant client JSON bundle. Either create annual PMTiles files or one combined PMTiles file with `year` properties and overzoom/drop settings.

Suggested generated files:

- `public/data/drivebc/manifest.json`
- `public/data/drivebc/events_pg_YYYY.compact.json.gz` for PG-focused interactions
- `public/data/drivebc/events_bc_YYYY.pmtiles` for province-wide map rendering
- `public/data/drivebc/summary_YYYY.json` for event counts by year, month, road, area, event group, condition code, severity, and status
- `public/data/drivebc/latest_open511.geojson` or `latest_open511.compact.json` for live active events

Compact JSON row shape used in testing:

```json
{
  "f": ["id", "x1", "y1", "x2", "y2", "g", "c", "v", "s", "d", "r", "a"],
  "r": [
    ["DBCRCON-207935", -122.60347, 54.19776, -123.03315, 54.99183, "r", "partly_icy", "m", "a", "2025-01-02", "Highway 97", "Fort George District"]
  ]
}
```

Use short codes only in the transport file, then expand them client-side from the manifest:

- `g`: event group, such as `r` road condition, `w` weather, `c` construction, `i` incident, `s` special event
- `v`: severity, `m` minor or `M` major if case sensitivity is acceptable; otherwise use `1` and `2`
- `s`: status, `a` active or `x` archived

Keep longer text (`description`, full `headline`) out of the main tile/compact transport unless needed for popups. Store details in a lookup file keyed by `id`, or include `headline` only for PG filtered bundles where the gzipped cost is small.
