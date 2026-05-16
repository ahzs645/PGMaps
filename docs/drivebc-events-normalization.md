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

The annual CSV files are bridgeable, but the source schema changes by era:

| Years | Source shape | Bridge quality |
| --- | --- | --- |
| 2006-2012 | 15 columns: `id`, `cause`, `district`, `state`, `severity`, `localupdatetime`, `advisorymessage`, `trafficpattern`, coordinates, `route`, `type` | Good for map/filter use, weaker for lifecycle because there is no explicit archived status or created timestamp |
| 2013-2017 | 26 columns: old fields plus `createdtime`, `starttime`, `endtime`, `geometry`, `direction`, `from`, `to`, `ivradvisorymessage` | Good; can populate most normalized temporal and road fields |
| 2018-2024 | 27 columns: Open511-style fields including `IVR_MESSAGE`, `EVENT_TYPE`, `EVENT_SUBTYPE`, `ROAD_*` | Strong; direct mapping |
| 2025 | 26 columns: Open511-style fields without `IVR_MESSAGE` | Strong; direct mapping |

### Old-to-normalized field crosswalk

| Normalized field | 2006-2012 | 2013-2017 | 2018-2025 |
| --- | --- | --- | --- |
| `id` | `id` prefixed as `drivebc.ca/{id}` if needed | `id` prefixed as `drivebc.ca/{id}` if needed | `ID` |
| `status` | derive from `state`: `Future` -> `future`, `Ongoing`/`TermRespOngo` -> `active_like` | derive from `state`; use `endtime` presence for ended events | lower-case `STATUS` |
| `eventType` | map from old `type` | map from old `type` | lower-case `EVENT_TYPE` |
| `eventSubtype` | map from `cause` | map from `cause` | lower-case `EVENT_SUBTYPE` |
| `eventGroup` | map from old `type` | map from old `type` | map from `EVENT_TYPE` |
| `conditionCode` | map from `cause` | map from `cause` | map from `EVENT_SUBTYPE` |
| `severity` | `Normal` -> `minor`, `Major` -> `major` | `Normal` -> `minor`, `Major` -> `major` | lower-case `SEVERITY` |
| `startedAt` | unavailable; use `localupdatetime` as best event time | `starttime` if present, else `createdtime`, else `localupdatetime` | `START_DATETIME` |
| `endedAt` | unavailable | `endtime` | `END_DATETIME` |
| `createdAt` | unavailable | `createdtime` | `CREATED` |
| `updatedAt` | `localupdatetime` | `localupdatetime` | `UPDATED` |
| `areaName` | `district` | `district` | `AREA_NAME` |
| `roadName` | `route` | `route` or `popular_route` | `ROAD_NAME` |
| `fromDescription` | parse from `advisorymessage` only if needed | `from` | `ROAD_FROM_DESCRIPTION` |
| `toDescription` | parse from `advisorymessage` only if needed | `to` | `ROAD_TO_DESCRIPTION` |
| `direction` | `isbidirectional=1` -> `both`, else unknown | `direction` normalized, or `isbidirectional=1` -> `both` | `ROAD_DIRECTION` |
| `roadState` | `trafficpattern` | `trafficpattern` | `ROAD_STATE` |
| `description` | `advisorymessage` | `advisorymessage` | `DESCRIPTION` |
| `ivrMessage` | unavailable | `ivradvisorymessage` | `IVR_MESSAGE` when present |
| coordinates | `head_latitude`, `head_longitude`, `tail_latitude`, `tail_longitude` | same, or optional `geometry` validation | `HEAD_*`, `TAIL_*` |

### Old `type` to modern group bridge

| Old `type` | Normalized `eventGroup` | Approx. modern `EVENT_TYPE` |
| --- | --- | --- |
| `Road Condition` | `road_condition` | `ROAD_CONDITION` |
| `Incident` | `incident` | `INCIDENT` |
| `Current Planned` | `construction` | `CONSTRUCTION` |
| `Future Planned` | `construction` | `CONSTRUCTION` |

`Current Planned` and `Future Planned` include maintenance, construction, special events, ferry work, and other planned disruptions. For old years, use `cause` to refine these into `road_maintenance`, `road_construction`, `planned_event`, etc.

### Old `cause` to condition bridge

The old `cause` field is the bridge to modern `EVENT_SUBTYPE`. It is more human-readable than modern codes, but has a stable enough vocabulary for deterministic mapping.

Recommended mapping examples:

| Old `cause` pattern | Normalized `conditionCode` | Approx. modern subtype |
| --- | --- | --- |
| `Slippery Sections`, `Black Ice`, `Rain on Compact Snow` | `partly_icy` | `PARTLY_ICY` |
| `Compact Snow`, `Compact Snow Sanded`, `Compact Snow with Plowing & Sanding` | `snow_packed` | `SNOW_PACKED` |
| `Compact Snow with Slippery Sections` | `partly_icy` | `PARTLY_ICY` |
| `Compact Snow with Slushy Sections`, `Slushy Sections`, `Slushy with Slippery Sections` | `partly_snow_packed` | `PARTLY_SNOW_PACKED` |
| `Compact Ice` | `ice_covered` | `ICE_COVERED` |
| `Limited Visibility with Fog`, `Fog Patches`, `Limited Visibility with Smoke`, `Limited Visibility with Blowing Snow`, `Limited Visibility with Heavy Snowfall` | `poor_visibility` | `POOR_VISIBILITY` |
| `Strong Cross Winds` | `strong_winds` | `STRONG_WINDS` |
| `Heavy Rain`, `Heavy Snowfall`, `Snowing with Slippery Sections`, `Freezing Rain`, `Drifting Snow` | `weather_hazard` | `HAZARD` or weather-specific family |
| `Water Ponding`, `Water Pooling`, `Flooding`, `Wash Out` | `surface_water` | `SURFACE_WATER_HAZARD` |
| `Avalanche Control`, `High Avalanche Hazard` | `avalanche_hazard` | `AVALANCHE_HAZARD` |
| `Falling Rock`, `Falling Ice`, `Frost Heaves`, `Muddy Sections`, `Debris on Road`, `Tree on Road`, `Hydro Lines Down`, `Livestock on Road`, `Wildlife on Road` | `hazard` | `HAZARD` or `OBSTRUCTION` depending on display needs |
| `Collision`, `Vehicle Incident`, `Vehicle Recovery`, `Vehicle Stall`, `Police Incident`, `Vehicle Fire` | `incident` | `HAZARD` or `FIRE` |
| `Forest Fire` | `fire` | `FIRE` |
| `Maintenance`, `Bridge Maintenance`, `Electrical Maintenance`, `Winter Highway Maintenance`, `Sweeping`, `Mowing`, `Ditching`, `Brushing`, `Paving`, `Rock Scaling` | `road_maintenance` | `ROAD_MAINTENANCE` |
| `Construction` | `road_construction` | `ROAD_CONSTRUCTION` |
| `Special Event` | `planned_event` | `PLANNED_EVENT` |
| `Ferry Out of Service`, `Ferry Service Interruption` | `ferry_disruption` | `HAZARD` or custom code |

Keep the original `cause` as `sourceCause` because some older values do not map cleanly to modern Open511 subtypes.

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
