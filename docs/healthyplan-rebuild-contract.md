# HealthyPlan.City Rebuild Data Contract

Research started: 2026-05-06

## Purpose

This note captures what PGMaps needs to recreate a HealthyPlan.City-style equity map: supported data file shapes, variable/color configuration, equations, source data requirements, and remaining gaps.

HealthyPlan.City is not a weighted composite index. It is a city-relative decile overlay: higher vulnerable-population deciles intersecting with lower beneficial built-environment deciles.

## File Types PGMaps Can Support

### Directly Usable in the Frontend

| Type | Use | Notes |
| --- | --- | --- |
| `GeoJSON` / `FeatureCollection` | Dissemination blocks, neighbourhoods, municipal boundaries, source features | Already fits MapLibre and Turf workflows. Best direct interchange format for boundaries. |
| `JSON` | Metric catalog, color ramps, variable stops, source manifest | Preferred for app configuration. |
| Static API-style `JSON` arrays | Scatter points, summary rows, city bounds | Matches current PGMaps fetch patterns. |

### Good for Ingestion Scripts, Not Direct App Use

| Type | Use | Required handling |
| --- | --- | --- |
| `CSV` | Census profiles, derived DB tables, final HealthyPlan-like data table | Parse in a Node/Python sync script and emit normalized JSON/GeoJSON. |
| `GeoPackage` / `GPKG` | Statistics Canada, municipal, or OSM-derived geospatial layers | Convert to GeoJSON or vector tiles before frontend use. |
| `Shapefile` | StatCan geography, municipal boundaries | Convert to GeoJSON or vector tiles before frontend use. |
| `GeoTIFF` / raster | Landsat temperature, tree canopy, flood index | Summarize to dissemination blocks before app use; the app should consume block-level values, not raw rasters. |
| `GTFS` zip | Transit stops/routes/schedules | Extract stops and optionally network/service metrics into JSON/GeoJSON. |
| OSM extracts (`.pbf`) | Amenities, parks, roads, walking network, noise features | Process offline with tags and buffers/network analysis; emit derived block metrics. |

### Optional Later

| Type | Use | Notes |
| --- | --- | --- |
| Vector tiles (`.pbf` tiles, MBTiles, PMTiles) | High-volume dissemination-block maps | HealthyPlan uses a vector-tile style. PGMaps can display vector tiles through MapLibre, but the repo does not yet include a tile generation pipeline. |

## Recommended Static Data Layout

```text
public/data/healthyplan/
  manifest.json
  variables.json
  colour-ramps.json
  city-bounds.json
  blocks.geojson
  neighbourhoods.geojson
  derived-block-metrics.json
  summaries/
    city-equity-summary.json
    neighbourhood-equity-summary.json
```

For larger national-scale data, replace `blocks.geojson` with vector tiles and keep the same properties.

## Minimum Block Properties

Each dissemination block feature needs stable identifiers, geography membership, population, raw variables, and ranks:

```json
{
  "dbuid": "string",
  "cmapuid": 758,
  "city": "Vancouver",
  "city_group": 5,
  "subzone": "optional neighbourhood name",
  "population": 123,
  "vismin_p": 0.42,
  "tcc_v": 18.3,
  "sd_city_vismin_r": 8,
  "nbe_city_tcc_r": 4
}
```

Naming mirrors the HealthyPlan frontend:

- Demographic percentage: `{demographic}_p`
- Built-environment value: `{environment}_v`
- Demographic city rank: `sd_city_{demographic}_r`
- Built-environment city rank: `nbe_city_{environment}_r`

## Equations

### Demographic Downscaling

HealthyPlan obtains vulnerable-population percentages at dissemination-area level and assigns the same percentage to every dissemination block inside that DA.

```text
demo_pct[db, d] = demo_pct[da(db), d]
demo_count[db, d] = demo_pct[db, d] * db_population[db]
```

Use proportions from `0..1` internally. Convert to percentages only for display.

### Built-Environment Aggregation

Built-environment indicators are summarized to dissemination blocks before scoring:

```text
env_value[db, e] = aggregate(source_feature_or_raster_values intersecting db)
```

Examples:

- Raster indicators: average raster cells within a DB.
- Amenity indicators: count amenities within a radius or walking-network distance from buildings/DB centroid.
- Flood indicator: average flood susceptibility across buildings within/near a DB.
- Greenspace provision: greenspace area per person within walking access.

### Direction Adjustment

The rank stored as `nbe_city_{environment}_r` should mean `1 = least beneficial`, `10 = most beneficial`.

For beneficial indicators:

```text
benefit_value = raw_value
```

For harmful indicators such as temperature, NO2, noise, and flood susceptibility:

```text
benefit_value = -raw_value
```

This keeps the rank interpretation consistent.

### City Decile Ranks

For each city and variable:

```text
demo_rank[db,d] = decile_rank(demo_pct[db,d] within populated DBs in city)
env_rank[db,e] = decile_rank(benefit_value[db,e] within populated DBs in city)
```

Rank interpretation:

```text
1 = lowest 10% of values
10 = highest 10% of values
```

The paper does not specify tie-breaking. Recommended implementation: use quantile thresholds and assign equal values consistently to the same rank, then document that tied deciles may not contain exactly 10% of blocks.

### Equity Priority

```text
equity_priority[db,d,e] =
  demo_rank[db,d] > 5 AND env_rank[db,e] < 6
```

### Equity Color Score

The HealthyPlan frontend colors priority areas by rank difference:

```text
priority_score[db,d,e] = demo_rank[db,d] - env_rank[db,e]
```

Because priority blocks require `demo_rank > 5` and `env_rank < 6`, valid priority scores are `1..9`.

Non-priority blocks should render transparent in the equity-priority overlay.

### Equity By The Numbers

City-level percentage of a vulnerable population living in less-beneficial environments:

```text
affected_count[c,d,e] =
  sum(demo_count[db,d] for db in city c where env_rank[db,e] < 6)

total_demo_count[c,d] =
  sum(demo_count[db,d] for db in city c)

affected_pct[c,d,e] =
  affected_count[c,d,e] / total_demo_count[c,d]
```

Neighbourhood equity-priority share:

```text
neighbourhood_priority_count[z,d,e] =
  sum(demo_count[db,d] for db in neighbourhood z where demo_rank[db,d] > 5 and env_rank[db,e] < 6)

city_priority_count[c,d,e] =
  sum(demo_count[db,d] for db in city c where demo_rank[db,d] > 5 and env_rank[db,e] < 6)

neighbourhood_priority_share[z,d,e] =
  neighbourhood_priority_count[z,d,e] / city_priority_count[c,d,e]
```

## Color Configuration

### Equity Priority Ramp

Use this 9-step ramp for `priority_score = 1..9`:

```json
{
  "id": "default",
  "stops": [
    "#ffecbf",
    "#fce4ae",
    "#fada9b",
    "#f7d18b",
    "#f5ca7a",
    "#d4967a",
    "#b36666",
    "#913959",
    "#73004d"
  ]
}
```

### Raw Variable Ramp Schema

```json
{
  "variable_id": "tcc",
  "label": "Tree canopy cover",
  "field": "tcc_v",
  "colour_ramp_id": "tcc",
  "stops": [0, 0.8, 4, 8, 11, 16, 21, 26, 33, 44],
  "format": "percent",
  "direction": "higherIsBetter"
}
```

Map rendering should use linear interpolation:

```text
color = interpolate(raw_value, stops, colourRamp.stops)
```

### Confirmed HealthyPlan Variable Stops

| Variable | Stops |
| --- | --- |
| `tcc` | `0, 0.8, 4, 8, 11, 16, 21, 26, 33, 44` |
| `lstmax` | `1, 23, 25, 26, 27, 28, 29, 30, 31, 33, 43` |
| `annno2` | `0, 3.87, 4.75, 5.41, 6.05, 6.69, 7.31, 7.9, 8.53, 9.37` |
| `fsi` | `0, 5, 8, 12, 18, 24, 31, 40, 53, 74, 100` |
| `gp` | `0, 0.5, 3.7, 7.1, 10.9, 15.8, 22.5, 32.7, 52.2, 107` |
| `transit` | `0, 2, 3.8, 5.2, 6.5, 7.6, 7.3, 11.2, 14.3, 39` |
| `educult` | `0, 0.000001, 0.1, 0.67, 1, 1.4, 2, 2.6, 3.3, 5` |
| `retserv` | `0, 0.1, 0.6, 2, 4.4, 8, 13.16, 21.8, 38.3, 79.7` |
| `hlthfd` | `0, 0.36, 0.84, 0.99, 1, 1.9, 2.4, 3.8, 7, 42` |
| `naturalspace` | `0, 0.000001, 2, 4.75, 8.14, 12.9, 19, 27.97, 41.75, 66.87` |
| `parks` | `0, 3.25, 6.25, 9, 12, 15.2, 19, 23.9, 30.8, 43.5` |
| `recsport` | `0, 3, 6, 8.58, 11, 13.66, 16.5, 20, 25, 33.5` |
| `noise` | `0, 0.14, 2.25, 4, 5.33, 6.4, 7.5, 9.05, 11.5, 17` |
| `vismin` | `0, 0.1, 0.22, 0.35, 0.5, 0.66, 0.82` |
| `alone` | `0, 0.07, 0.14, 0.22, 0.3, 0.39, 0.5` |
| `licoatall` | `0, 0.04, 0.08, 0.13, 0.19, 0.26, 0.36` |
| `u15` | `0, 0.08, 0.12, 0.15, 0.18, 0.21, 0.26` |
| `a64` | `0, 0.1, 0.15, 0.21, 0.27, 0.38, 0.55` |
| `fg` | `0, 0.09, 0.18, 0.27, 0.38, 0.49, 0.62` |
| `i1121` | `0, 0.02, 0.06, 0.09, 0.14, 0.2, 0.29` |

## Source Data Needed

### Core Geography

- 2021 Census dissemination blocks with geometry and population.
- 2021 dissemination areas with geometry or DB-to-DA relationship.
- Census subdivisions for target municipalities.
- Population centre mask or equivalent density filter for `>= 400 people/km2`.
- Optional neighbourhood/subzone boundaries from municipal open-data portals.

### Demographics

2021 Census DA-level counts/percentages for:

- Low-income individuals.
- Children.
- Older adults.
- Visible minority individuals.
- Individuals living alone.
- Newly arrived immigrants.
- First-generation immigrants.
- Low-income children.
- Low-income older adults.
- Low-income visible minority individuals.
- Low-income individuals living alone.
- Low-income newly arrived immigrants.
- Low-income first-generation immigrants.

### Built Environment

- Landsat 8 land-surface temperature for May-September 2019-2021, summarized to DB.
- Tree canopy cover, ideally the same Google/Meta/WRI products used by HealthyPlan.
- NRCan Flood Susceptibility Index.
- Building footprints from Microsoft Bing Maps and/or Statistics Canada Open Database of Buildings.
- Statistics Canada Open Database of Infrastructure transit stops or GTFS-derived stops.
- Statistics Canada Open Database of Educational Facilities v2.1.
- OSM extract from approximately November 2022 for retail/services, healthy food, parks, natural spaces, recreation, noise features, and walking network.
- Statistics Canada Geographic Attribute File for dissemination-block population used in greenspace provision.
- Hystad et al. 2016 NO2 estimates or an agreed replacement exposure surface.

## What We Are Missing

### For Exact HealthyPlan Reproduction

- The final HealthyPlan block-level CSV with all source, rank, and equity columns.
- Their exact decile tie-handling rule.
- The complete list of 15 municipalities where Meta/WRI tree canopy replaced Google tree canopy.
- The exact OSM tag filters used for each amenity class.
- The exact walking-network implementation and whether access was calculated from all buildings, DB centroids, or both for each variable.
- The exact building-footprint fallback logic between Bing and Statistics Canada ODB.
- The exact Google Earth Engine scripts for Landsat LST, tree canopy aggregation, and flood aggregation.
- The Hystad NO2 grid/point file used and its aggregation method to DB.
- The exact municipal neighbourhood boundary source file for each city with zones.

### For PGMaps Implementation

- A `healthyplan` ingestion script that converts source CSV/GIS/raster summaries into `derived-block-metrics.json` or vector tiles.
- A typed `HealthyPlanVariableConfig` and `HealthyPlanColourRamp` module.
- A decile-rank helper with documented tie behavior.
- A MapLibre layer that can render either:
  - equity priority from precomputed rank fields, or
  - equity priority from raw values and computed client/server ranks.
- Summary calculators for city and neighbourhood panels.
- Tests for rank assignment, priority-score calculation, and color mapping.

## Implementation Recommendation

Start with a derived table instead of raw-source processing:

```text
dbuid, cmapuid, city, subzone, population,
{demographic}_p..., {demographic}_count...,
{environment}_v...,
sd_city_{demographic}_r...,
nbe_city_{environment}_r...
```

That lets PGMaps reproduce the visible map, scatter plot, and summaries without immediately rebuilding every upstream spatial-processing pipeline. Once the UI and equations are stable, add source-specific sync scripts for Census, OSM, GTFS, rasters, and municipal boundaries.

