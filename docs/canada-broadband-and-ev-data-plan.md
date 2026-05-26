# Canada Broadband and EV Charging Data Plan

This note documents the current source strategy for two national datasets that fit the MISC/network side of PGMaps:

- Canadian broadband/fibre availability.
- Canadian EV charging stations.

## Broadband / Fibre Reality

There does not appear to be a public Canada-wide dataset of actual carrier fibre cable routes or line geometry. Bell, Rogers, TELUS, and other carrier route-level fibre assets are generally not published as open national shapefiles.

The usable public federal data is availability-oriented:

- **ISED National Broadband Data, NBD Roads**: broadband availability projected onto roughly 250 m road segments. Despite the name, this is useful as a line-based broadband availability layer, not as a road-routing source.
- **ISED National Broadband Data, NBD Map**: smaller summary map layer, less granular than NBD Roads.
- **ISED National Broadband Data, NBD PHH Speeds**: pseudo-household speed availability table.
- **CRTC Form 267 / Form 256 references**: CRTC collects provider-submitted transport/backbone and broadband capability information, including transport endpoints and backbone maps, but the detailed physical fibre route data is not a normal open public download.

Practical interpretation: use NBD Roads as the best public proxy for "speed available along a line." Label it as broadband availability, not physical fibre ownership or exact cable placement.

## Known Broadband Download Sizes

Approximate official catalogue sizes for the ISED National Broadband Data resources:

| Resource | Format | Approx size |
|---|---:|---:|
| NBD Roads | TAB ZIP | 1.15 GB |
| NBD Roads | GPKG ZIP | 3.0 GB |
| NBD PHH Speeds | CSV ZIP | 180 MB |
| NBD Map | TAB ZIP | 19 MB |
| NBD Map | SHP ZIP | 20 MB |
| NBD Map | CSV ZIP | 2.2 MB |
| NBD Map | KMZ ZIP | 50.5 MB |

## Reducing NBD Roads Size

Do not ship NBD Roads geometry directly if the app already has a usable road geometry layer. The better production shape is to use NBD Roads once during preprocessing, spatially join it onto the app road network, and keep only a compact attribute overlay.

Target logical schema:

```text
roads
  id
  geometry

broadband_availability
  road_id
  technology
  max_download_mbps
  max_upload_mbps
  availability_class
  source
  source_updated_at
```

Minimal compact overlay fields:

```text
road_id
speed_down
speed_up
tech_code
availability_code
source_date
```

One-time processing flow:

1. Load NBD Roads.
2. Load the PGMaps/base road network.
3. Match NBD road segments to existing road IDs using a stable shared ID if available.
4. If no shared ID exists, spatially match by overlap/nearest segment with conservative tolerances.
5. Write an attribute-only overlay keyed by PGMaps road ID.
6. Discard NBD geometry from the production app artifact.

## Expected Size Reduction

General estimate if NBD Roads can be reduced to a road-ID keyed attribute overlay:

| Storage approach | Likely size |
|---|---:|
| Original NBD Roads GPKG ZIP | ~3.0 GB |
| Original NBD Roads TAB ZIP | ~1.15 GB |
| Attribute-only CSV, no geometry | ~150-600 MB raw |
| Attribute-only CSV.gz | ~25-120 MB |
| Attribute-only Parquet/ZSTD | ~20-90 MB |
| Deduplicated road ID plus compact coded fields | ~10-60 MB |
| PMTiles/vector tiles with geometry retained | ~200 MB-1 GB, depending zoom/detail |

Practical target:

| Case | Compressed target |
|---|---:|
| Good case | 20-50 MB |
| Normal case | 50-120 MB |
| Messy/many-row case | 120-300 MB |

This is roughly a 30x to 150x reduction from the 3.0 GB GPKG ZIP path when geometry duplication is removed.

The main uncertainty is row multiplicity. One compact row per matched road segment should compress very well. Multiple rows per segment by provider, technology, or speed tier will increase size, but repeated categorical fields should still gzip or Parquet-compress well.

## EV Charging Dataset

The EV charging data is small enough to ship directly as a compact point dataset.

Current source:

- NLR / Alternative Fuel Stations API.
- Canada filter: `fuel_type=ELEC`, `country=CA`, `status=E`.

Current generated counts and sizes:

| EV export | Rows | Raw CSV | gzip -9 |
|---|---:|---:|---:|
| Station-level Canada EV CSV | 15,462 stations | 5,442,701 bytes | 899,831 bytes |
| Charging-unit Canada EV CSV | 42,578 rows | 16,648,969 bytes | 1,110,861 bytes |
| Compact station GeoJSON | 15,462 points | 5,050,164 bytes | 576,022 bytes |

The port/unit-level export is the better source when connector counts or per-unit detail matters. The compact station GeoJSON is the better map-rendering artifact.

## Current PGMaps Implementation

EV charging is implemented in:

- `vendor/bcdatamapper/datascrapers/ev-charging/sync-ev-charging.mjs`
- `public/data/ev-charging/manifest.json`
- `public/data/ev-charging/stations.geojson`
- `src/maps/pgdata/MiscDataSection.tsx`
- `src/lib/dataCatalog.ts`

Run:

```bash
npm run ev-charging:sync
```

The MISC EV tab renders clustered points by default, with an optional heatmap and study-area filtering.

## Recommended Next Step For Broadband

Prototype the NBD Roads reduction pipeline before committing to any map UI:

1. Download NBD Roads in the smaller usable format first.
2. Inspect columns and stable IDs.
3. Test whether any IDs align with the selected base-road dataset.
4. If not, run a small-area spatial join around Prince George.
5. Measure raw CSV, CSV.gz, and Parquet/ZSTD outputs.
6. Only then decide whether the app needs road styling, PMTiles, or a pure query/index layer.
