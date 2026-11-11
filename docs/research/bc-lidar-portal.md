# BC LiDAR portal (LidarBC): data sources, sizes, CORS

Research date: 2026-11-09 (server dates 2026-11-10 UTC). All findings come from live requests made that day. `/dev/lidar/coverage/` (`src/pages/dev-lidar/lidarbc/`) is built on it.

## TL;DR

- The portal page `https://lidar.gov.bc.ca/pages/download-discovery` is an **ArcGIS Hub** page (item `8e86cebe64774d508bf05fc73a089f15`). It holds a single iframe that loads an **ArcGIS Web AppBuilder** app, `33ecd51f1e504929a4ff8378719816ce`. That app shows web map `c2967cee749b4bdbac5e7c62935ca167`. It has no custom download widget: the download links are attribute URLs in popups and the attribute table.
- All coverage comes from **one ArcGIS Online hosted FeatureServer**, `LiDAR_BC_S3_Public`, which has 7 polygon layers: the data extent and the DEM, DSM and point-cloud tile indexes at 1:2,500, 1:10,000 and 1:20,000. Its CORS is open (`Access-Control-Allow-Origin: *`), so **a browser can query it live**.
- The files themselves are on the **NRS object store** (`https://nrs.objectstore.gov.bc.ca/gdwuts/...`, Dell ECS "ViPR", S3 API). Range requests work and return 206, but the store sends **no CORS headers** and answers an OPTIONS preflight with **403**. **A browser on another origin cannot read file bytes, sizes or bucket listings.** Use the files only as plain download links (`<a href>`).
- The tile index has **no file-size field**. You can get sizes from the bucket, which allows anonymous ListObjectsV2, but only server-side. That means a snapshot.
- **The files are not cloud-optimized.** The LAZ files are plain LAS 1.4 / PDRF 6 LAZ with no COPC VLR, and range from 0.26 to 2.8 GB per 1:2,500 tile. The GeoTIFFs are 32-bit float, LZW, **stripped with one row per strip**, with no overviews, no tiling and no COG ghost header, and the 1:2,500 files keep their IFD at the end of the file. Streaming either format in the browser is out, even if CORS were open.
- **Data errors in the index:** older DSMs (2,774 rows at 1:2,500 for 2016/2018 and all 170 rows at 1:10,000 for 2017) point at `*_dsm.tif`, but the object is actually `*_dsm.laz`. Those links return 404.

## How the portal is built

| Step                 | URL                                                                                                                                                                                                | Notes                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Hub site             | `https://lidar.gov.bc.ca/` (also `lidarbc-bcgov03.hub.arcgis.com`), site item `8f3811fa747444e59e36882ec7fc91fc` on `bcgov03.maps.arcgis.com`                                                      | Site JSON is inlined as `window.__SITE` (URL-encoded) in the HTML                                  |
| Page                 | item `8e86cebe64774d508bf05fc73a089f15` "LidarBC - Download and Discovery": `https://bcgov03.maps.arcgis.com/sharing/rest/content/items/8e86cebe64774d508bf05fc73a089f15/data?f=json`              | A markdown card plus an iframe card                                                                |
| App                  | `https://governmentofbc.maps.arcgis.com/apps/webappviewer/index.html?id=33ecd51f1e504929a4ff8378719816ce`, config at `.../sharing/rest/content/items/33ecd51f1e504929a4ff8378719816ce/data?f=json` | WAB 2.28 with only stock widgets (Search, AttributeTable, LayerList, Legend, Select, Print, About) |
| Web map              | `https://governmentofbc.maps.arcgis.com/sharing/rest/content/items/c2967cee749b4bdbac5e7c62935ca167/data?f=json`                                                                                   | Operational layers are listed below                                                                |
| Feature service item | `5f6a1f31212a4cb2826743d2e52ef02a` (`serviceItemId` of the layers)                                                                                                                                 | The catalogue record "lidarbc-open-lidar-data-portal" links to it                                  |

Web map operational layers and the scale at which each first draws (`minScale`):

| Title in app                | Layer URL                                         | minScale |
| --------------------------- | ------------------------------------------------- | -------- |
| Provincial Data Extent      | `LiDAR_BC_S3_Public/FeatureServer/0`              | always   |
| DSM Index – 1:2,500         | `.../1`                                           | 1:152k   |
| DSM Index – 1:10,000        | `.../2`                                           | 1:432k   |
| DSM Index – 1:20,000        | `.../3`                                           | 1:1.64M  |
| Point Cloud Index – 1:2,500 | `.../4`                                           | 1:168k   |
| DEM Index – 1:2,500         | `.../5`                                           | 1:224k   |
| DEM Index – 1:20,000        | `.../6`                                           | 1:1.46M  |
| 1:250,000 Grid (NTS)        | `LiDARBC_Map_Base/FeatureServer/0`                | always   |
| 1:20,000 Grid (BCGS)        | `LiDARBC_Map_Base/FeatureServer/1` (7,073 sheets) | always   |

Base URL: `https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/`. The LiDARBC_Map_Base service also has layer 2, BC Regional Districts, which the web map does not use.

## Endpoint table

| Endpoint                                                                                                                                                   | Purpose                                                           | Format                                       | CRS                                                                                           | Count         | CORS for `https://pgmaps.ahmadjalil.com` and `http://localhost:5173`                                                     | Range                                    | Browser-loadable?                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| `.../LiDAR_BC_S3_Public/FeatureServer/{0..6}/query`                                                                                                        | Coverage and tile indexes                                         | JSON, GeoJSON, PBF (`f=json\|geojson\|pbf`)  | Stored in BC Albers (custom WKT ≈ EPSG:3005); `outSR=4326` or `3857` reprojects on the server | see below     | `ACAO: *`, `Allow-Headers: Content-Type, Authorization, X-Esri-Authorization`; OPTIONS returns 200 with the same headers | n/a                                      | **Yes**, live                                            |
| `.../LiDARBC_Map_Base/FeatureServer/{0,1,2}/query`                                                                                                         | NTS 250k, BCGS 20k and Regional District grids                    | same                                         | Web Mercator (3857)                                                                           | L1 = 7,073    | `ACAO: *`                                                                                                                | n/a                                      | **Yes**                                                  |
| `https://{bcgov03,governmentofbc}.maps.arcgis.com/sharing/rest/content/items/<id>/data?f=json`                                                             | Hub page, app and web map JSON                                    | JSON                                         | –                                                                                             | –             | Echoes the Origin (`ACAO: https://pgmaps.ahmadjalil.com`, credentials true)                                              | n/a                                      | Yes, but not needed at runtime                           |
| `https://nrs.objectstore.gov.bc.ca/gdwuts/<NNN>/<NNNx>/<YYYY>/{pointcloud,dem,dsm,chm,orthophoto}/<file>`                                                  | The data files (LAZ, GeoTIFF)                                     | LAZ 1.4, GeoTIFF                             | UTM 8–11 NAD83(CSRS) + CGVD2013 (some older ones BC Albers)                                   | ≈ 360k+ files | **No ACAO** on GET, HEAD or Range responses; OPTIONS preflight **403 Forbidden**                                         | **Yes, 206** with `Content-Range` (curl) | **No** for fetch/XHR, so plain `<a href>` downloads only |
| `https://nrs.objectstore.gov.bc.ca/gdwuts?list-type=2&prefix=...`                                                                                          | Anonymous S3 ListObjectsV2 (keys, sizes, LastModified, ETag)      | S3 XML, 1000 keys/page, `continuation-token` | –                                                                                             | –             | **No ACAO**                                                                                                              | –                                        | **No**, server-side only                                 |
| `https://nrs.objectstore.gov.bc.ca/gdwuts/metadata/accuracy_rpts/<yr>/<contract>_summary.pdf`                                                              | Accuracy reports (`s3RptUrl`)                                     | PDF (~220 KB)                                | –                                                                                             | –             | No ACAO                                                                                                                  | –                                        | Link only                                                |
| `https://nrs.objectstore.gov.bc.ca/gdwuts/index/*.shp/.dbf/.kml`                                                                                           | Bulk index files: shapefiles and coverage KML                     | Shapefile, KML (139–298 MB each)             | Albers                                                                                        | –             | No ACAO                                                                                                                  | –                                        | No; a scraper could use them                             |
| `https://nrs.objectstore.gov.bc.ca/gdwuts/metadata/laszy_report.csv` (43.8 MB, last modified 2024-07-09) and `metadata/laszy_json/<laz>.json` (~5 KB each) | Per-LAZ header report: point count, bbox, CRS, classes, GPS times | CSV, JSON                                    | –                                                                                             | –             | No ACAO                                                                                                                  | –                                        | No; a scraper could use them                             |

CORS test commands, abridged: `curl -D - -H 'Origin: https://pgmaps.ahmadjalil.com' <url>`, `curl -X OPTIONS -H 'Origin: …' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: range' <url>`, and `-H 'Range: bytes=0-1023'`. Note that even a "simple" Range request, which needs no preflight under the current Fetch spec, still fails in the browser, because the response carries no `Access-Control-Allow-Origin`. The object store also exposes no headers (`Content-Range`, `Content-Length`). A bucket CORS read (`GET /gdwuts?cors`) returns 403 AccessDenied.

## Attribute schemas and example records

### Layer 0 – `LiDARProject_Data_Extent` (13 features)

Fields: `OBJECTID, YEAR_, Shape__Area, Shape__Length`. This is **one dissolved (multi)polygon per acquisition year**, 2011 to 2026. There is no project or contract attribute. Areas are in m² (Albers): 2024 is 164,463 km², 2019 is 92,891 km², 2025 is 50,019 km², and the rest are each under 33,000 km². The years overlap, so you cannot sum the areas to get coverage. The whole layer as GeoJSON with `outSR=4326&geometryPrecision=4&maxAllowableOffset=0.005` is **209 KB, or 28.5 KB gzipped**.

**Project or acquisition boundaries do not exist as a separate layer.** "Project" is the `oper_name`/`contract` attribute on each tile. A project boundary would have to be made by dissolving tiles by `oper_name` (28 values) or `contract`.

### Layers 1/2/3 (DSM), 5/6 (DEM) – raster tile indexes

Fields: `OBJECTID, filename, maptile, path, grid_scale, year, projection, spacing, contract, oper_name, op_number, s3Url, s3Hyperlink, Shape__Area, Shape__Length`

```json
{
  "filename": "bc_092b051_1_3_1_xli1m_utm10_20230930_20230930.tif",
  "maptile": "092b051_1_3_1",
  "path": "\\092\\092b\\2023\\dem\\bc_092b051_1_3_1_xli1m_utm10_20230930_20230930.tif",
  "grid_scale": "1:2500",
  "year": 2023,
  "projection": "utm10",
  "spacing": "1 metre",
  "contract": "OP24BMRS001",
  "oper_name": "LidarBC Program",
  "op_number": " ",
  "s3Url": "https://nrs.objectstore.gov.bc.ca/gdwuts/092/092b/2023/dem/bc_092b051_1_3_1_xli1m_utm10_20230930_20230930.tif",
  "Shape__Area": 2564813.6
}
```

### Layer 4 – Point Cloud Index (1:2,500)

Fields: `OBJECTID, path, filename, maptile, year, density (pts/m²), projection, contract, oper_name, op_number, start_time, end_time, total_point, vert_datum, point_form, version, global_enc, classes, x_min, x_max, y_min, y_max, s3Url, s3Hyperlink, s3RptUrl, s3RptHyperlink, acc_rpt, info_file, Shape__Area, Shape__Length`. Most header fields (`total_point`, `start_time`, `version`, bbox) are **null** in the rows sampled. The field descriptions on the layer are good: `maptile` is "BCGS Tile Name" and `density` is "points per square metre".

```json
{
  "filename": "bc_092b051_1_3_1_xyes_8_utm10_20230930_20230930.laz",
  "maptile": "092b051_1_3_1",
  "year": 2023,
  "density": 8,
  "projection": "utm10",
  "contract": "OP24BMRS001",
  "oper_name": "LidarBC Program",
  "vert_datum": "Canadian Geodetic Vertical Datum of 2013",
  "classes": "[1,2,7,12]",
  "s3Url": "https://nrs.objectstore.gov.bc.ca/gdwuts/092/092b/2023/pointcloud/bc_092b051_1_3_1_xyes_8_utm10_20230930_20230930.laz",
  "s3RptUrl": "https://nrs.objectstore.gov.bc.ca/gdwuts/metadata/accuracy_rpts/2024/op24bmrs001_summary.pdf"
}
```

Raw samples saved next to this report:

- `sample_pointcloud_index_2rows.geojson` (layer 4, 2 features, EPSG:4326)
- `sample_dem2500_index_2rows.geojson` (layer 5, 2 features)
- `sample_objectstore_list_093g_2024_dem.xml` (ListObjectsV2 page, 4 keys, showing `Size`)

### File naming and BCGS grid

`bc_<maptile>_<x{yes|li|no}>_<density or 1m spacing>_<utmNN|bcalb>_<start>_<end>[_dsm].<laz|tif>`. Keys follow the pattern `gdwuts/<NTS 1:1M block>/<NTS 1:250k letter>/<year>/<product>/`.

Each grid level is a fixed lat/lon cell, checked against the polygon areas returned:

| Level                     | Cell size                                   | Typical area |
| ------------------------- | ------------------------------------------- | ------------ |
| BCGS 1:20,000 (`092b041`) | 0.1° lat × 0.2° lon                         | ~164 km²     |
| 1:10,000 (`082f006_1`)    | ¼ of a 1:20,000 sheet                       | ~41 km²      |
| 1:2,500 (`092b051_1_3_1`) | 1/64 of a 1:20,000 sheet (0.0125° × 0.025°) | ~2.56 km²    |

Every row in layers 1, 4 and 5 is a 1:2,500 tile (none has `Shape__Area` above 5 km² or below 1.5 km²), so **tile polygons can be derived from `maptile` alone.** That lets a snapshot drop geometry.

## Counts per product and grid level (FeatureServer, 2026-11-09)

| Layer | Product / grid                 | Rows        | Distinct `maptile`                   | Years                                                              | Projections                                                         |
| ----- | ------------------------------ | ----------- | ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 0     | Data extent (by year)          | 13          | –                                    | 2011–2026                                                          | –                                                                   |
| 4     | **Point cloud (LAZ), 1:2,500** | **164,027** | 143,503 (≈20.5k repeat acquisitions) | 2015–2026 (2024: 74,724; 2025: 22,242; 2019: 18,596; 2023: 12,153) | utm10 129,317; utm11 27,062; utm09/utm9 6,859; bcalb 425; utm08 364 |
| 5     | **DEM 1:2,500** (GeoTIFF)      | 96,959      | 96,218                               | 2016, 2017, 2023–2026                                              | spacing 1 m: 95,300; 2 m: 1,659                                     |
| 6     | **DEM 1:20,000** (GeoTIFF)     | 2,008       | 1,598                                | 2011, 2015–2024                                                    | 1 m                                                                 |
| 1     | **DSM 1:2,500**                | 97,453      | 95,942                               | 2016, 2018, 2023–2026                                              | –                                                                   |
| 2     | DSM 1:10,000                   | 170         | –                                    | 2017 (NDMP Kootenay)                                               | utm11                                                               |
| 3     | DSM 1:20,000                   | 919         | –                                    | 2011, 2015–2024                                                    | –                                                                   |

The DEM/DSM 1:20,000 layers carry the older acquisitions (2015–2022) that have no 1:2,500 rasters. The 1:2,500 layers carry the LidarBC Program blocks from 2023 onward.

Point density classes (pts/m², point-cloud rows): 8 → 149,139; 6 → 7,851; 12 → 3,977; 7 → 1,792; 4, 17, 19, 20, 21, 22 → under 400 each.

`oper_name`, with point-cloud rows (28 projects): LidarBC Program 109,120 · Kootenay (Purchased LiDAR) 7,851 · NDMP VI 2019 7,505 · NDMP Floodplains 2019 6,104 · VRI 100 Mile House 2019 4,009 · Kootenay FAIB 2022 3,874 · BCTS TPG-TKA 3,104 · BCTS TSK/TSN 2,923 · BCTS TPL/TKA 2,008 · NDMP Fraser 2016 2,008 · NDMP Kootenay 2017 1,976 · NDMP Kootenay-Columbia 2018 1,967 · NDMP 2021 1,358 · BCTS Chinook\Kamloops 2017 1,336 · BCTS Skeena Babine 2018 1,121 · Caribou (Purchased LiDAR) 1,024 · BCTS Douglas Channel\Haida Gwaii 2017 985 · BCTS Chinook-Kamloops-Skeena 978 · BCTS Chinook 2016 900 · BCTS Chinook\Kamloops 2018 889 · BCTS Nadina 2016 758 · NDMP Okanagan 2017 628 · NDMP VI 2018 571 · Lytton BC 125 · Tulsequah, Surf Inlet, Mt Copeland 329 · EMBC Lower Mainland Flood 283 · Great Bear Rainforest 229 · EMBC Skuppah 64.

### Pagination and limits

- `maxRecordCount` is 1000 per layer (2000 standard, 4000 for tile queries). Pagination uses `resultOffset` and `resultRecordCount` with `orderByFields=OBJECTID`.
- The service supports `returnCountOnly`, `returnDistinctValues` plus a count, `outStatistics` with `groupByFieldsForStatistics` (server-side counts by year, project or density), `quantizationParameters`, `maxAllowableOffset` and `f=pbf`. Capabilities are `Query,Extract`.
- Measured payloads:

| Query                                                 | Size                         |
| ----------------------------------------------------- | ---------------------------- |
| 1000 point-cloud tiles, min fields, `f=pbf` quantized | 15.5 KB                      |
| 1000 point-cloud tiles, GeoJSON min fields            | 28 KB gzipped                |
| 1000 point-cloud tiles, all fields                    | 1.58 MB raw / 140 KB gzipped |
| Whole 1:20,000 DEM layer (2,008 features) as GeoJSON  | ~0.45 MB gzipped             |

The whole point-cloud index, live and with geometry, is about 165 requests and 2.5–5 MB gzipped. That is acceptable for a scraper but too heavy for page load, so query by viewport instead.

- `cacheMaxAge` is 30 s, and `lastEditDate` is 2026-09-15, so the service updates a few times a year. The bucket's `index/*.kml` and shapefiles carry the same 2026-09-15 timestamp.

### Sizes

The index has **no size field**. Measured from the bucket listing for NTS sheet **093G (Prince George)**, 19,254 keys across 20 ListObjectsV2 pages:

| Year       | Product                                                | Files     | Total          | Median       | Max      |
| ---------- | ------------------------------------------------------ | --------- | -------------- | ------------ | -------- |
| 2019       | pointcloud LAZ                                         | 1,261     | 332 GB         | 261 MB       | 891 MB   |
| 2019       | DEM (1:20k sheets)                                     | 38        | 23.0 GB        | 604 MB       | 619 MB   |
| 2024       | pointcloud LAZ                                         | 4,998     | **3,506 GB**   | 574 MB       | 2,831 MB |
| 2024       | DEM 1:2,500                                            | 4,998     | 32.1 GB        | 6.5 MB       | 7.8 MB   |
| 2024       | DSM 1:2,500                                            | 4,998     | 33.7 GB        | 6.8 MB       | 7.9 MB   |
| 2025       | pointcloud LAZ                                         | 636       | 492 GB         | 693 MB       | 2,542 MB |
| 2025       | DEM / DSM 1:2,500                                      | 636 each  | 4.1 / 4.4 GB   | 6.6 / 6.9 MB | –        |
| 2019, 2021 | orthophoto TIF (bucket only, not in the FeatureServer) | 214 / 808 | 10.3 / 34.4 GB | 50–60 MB     | –        |

The 093G file counts match the FeatureServer exactly: 4,998 / 636 / 4 / 1,261 point-cloud rows, and 38 DEM 1:20,000 rows.

**Rough provincial estimate** (index counts × 093G medians; a full listing gives exact totals):

- LAZ: ~164k files × ~0.5–0.6 GB ≈ **80–100 TB**
- DEM 1:2,500: ~97k × 6.6 MB ≈ 0.65 TB
- DSM 1:2,500: ≈ 0.65 TB
- DEM 1:20,000: ~2k × 0.3–0.6 GB ≈ 0.6–1.2 TB

Sample header from LAZ `bc_092b051_1_3_1_…laz`: 982,601,829 bytes, **161,695,775 points**, Riegl VQ-1560 II, RiPROCESS.

**Ways to get exact sizes (server-side only):**

1. **Recommended:** ListObjectsV2 per prefix `NNN/NNNx/YYYY/{pointcloud,dem,dsm}/`. Take the `(NNN/NNNx, year)` pairs from the `s3Url`s or `path`s in the FeatureServer. That is a few hundred prefixes and roughly 400–600 pages of ≤1000 keys, each page ~300 KB of XML (~150 MB transferred in total), and finishes in about 10–15 minutes at 1 request/s.
2. HEAD per file: ~360k requests. Too many.
3. Do not list the bucket root recursively. It holds non-public working folders as well as the products; keep the scraper to the product prefixes the index names.

## COPC / COG findings

- **LAZ is not COPC.** The header is LAS **1.4**, point format byte `0x86`, which is PDRF **6** with the compression bit set, record length 30. `offset_to_points` is 1859. There are 3 VLRs in this order: `LASF_Projection/2112` (WKT COMPD_CS NAD83(CSRS) / UTM 10N + CGVD2013(CGG2013)), then `province_bc/1` (contract id), then `laszip encoded/22204`. A COPC file's first VLR must be `copc/1`, so this file is not COPC. Each 1:2,500 tile is 0.26–2.8 GB. The browser cannot stream it, and it is not practical to download whole.
- **GeoTIFFs are not COG.**
  - 1:2,500 DEM (7.9 MB): 1893×1442 float32, LZW, predictor 1, `RowsPerStrip=1` (stripped, no tiles). The IFD is at byte 7,934,432, near the end of the file. There is one IFD and no overviews, and no `GDAL_STRUCTURAL_METADATA` ghost. CRS is "NAD83(CSRS) / UTM zone 10N + CGVD2013(CGG2013) height", nodata −32767, 1 m pixels.
  - 1:20,000 DEM (279 MB): 15079×11507 float32, LZW, one row per strip, no overviews, no ghost.
  - CHM (canopy height model, 1:20,000, 10.7 MB): same layout.
- So even with CORS, geotiff.js would have to read the end-of-file IFD and then fetch thousands of row strips, and there are no overviews for zoomed-out views.

## Other things found

- **Canopy height model** (`.../<year>/chm/*_chm.tif`) and **orthophotos** (`.../orthophoto/*.tif`) exist in the bucket but are **not in the FeatureServer**. `index/lidar_chm_index_121024.shp` (~400 KB, 2025-07) indexes the CHM, and `index/update_2023-06-28/lidar_orthophoto_index_2023-06-28.shp` indexes the orthophotos.
- `albers10k2m/` holds an unlisted 2 m Albers-grid product on 10 km tiles: dem, hillshade (hil), TRI, 10 m contours (c10, `.7z`), and extents. Each DEM tile is ~100 MB uncompressed with `.ovr` sidecars. It is undocumented, so do not build on it without checking with GeoBC.
- `index/` also holds bulk exports, about a week behind the FeatureServer:
  - `lidar_pointcloud_index_112020.shp/.dbf` (32 MB + 498 MB)
  - `lidar_dem_index_112720.*` and `lidar_dsm_index_110719.*`
  - `laz_coverage.kml` (298 MB) and the other coverage KMLs
- `metadata/laszy_report.csv` (43.8 MB, 2024-07) has one row per LAZ, with point count, bbox, CRS, classes and GPS time range. It is older than the 2024–2026 acquisitions.

## BC Data Catalogue / openmaps alternatives

- CKAN finds `lidar` and `lidarbc-open-lidar-data-portal` (both are application records pointing back to the AGOL portal and to item `5f6a1f31212a4cb2826743d2e52ef02a`). Neither carries a BCGW object or a WMS/WFS resource.
- The `openmaps.gov.bc.ca/geo/pub` WFS GetCapabilities (1.3 MB) contains no LiDAR layer: zero matches for "lidar". The elevation-related names it does list are spot heights and RESULTS slope/aspect. The GetCapabilities request with our Origin returned no `Access-Control-Allow-Origin` header.
- **The AGOL FeatureServer is the only machine-readable index, and it is already browser-friendly.**

## robots.txt

- `lidar.gov.bc.ca/robots.txt`: `User-agent: * / Crawl-delay: 60 / Disallow: /sites/ /admin/ /sessions/ /groups/ /people/ /workspace/`. `/pages/` is allowed. This research fetched one page from the host.
- `governmentofbc.maps.arcgis.com/robots.txt`: no disallows.
- `services6.arcgis.com/robots.txt`: returns 403 "Invalid URL", so no robots file is published.
- `nrs.objectstore.gov.bc.ca/robots.txt`: 404 NoSuchBucket, so no robots file.
- `catalogue.data.gov.bc.ca/robots.txt`: **disallows `/api/`**, with crawl-delay 10. This research made 4 CKAN API calls before reading that. A scraper must not use the CKAN API, and nothing here needs it.

## Recommendation for a PGMaps "LiDAR coverage" page

**Fetch live in the browser** (AGOL FeatureServer, `ACAO: *`; resolve nothing through `withBase` because this is an external host):

1. **Provincial coverage by year:** layer 0 with `outSR=4326&geometryPrecision=4&maxAllowableOffset=0.005` (28 KB gzipped). You could also snapshot it for offline use, but it is not required.
2. **Tiles in view:** query layers 4, 5, 1 (1:2,500) and 6, 3 (1:20,000) by viewport envelope (`geometry=<bbox>&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson` or `f=pbf`). Gate them by zoom the way the portal does: 1:2,500 layers below ~1:200k, 1:20,000 layers below ~1:1.5M. Per-view counts and summaries can come from `outStatistics`.
3. **Download links:** use `s3Url` as plain `<a href>` links, which work across origins. Rewrite `_dsm.tif` to `_dsm.laz` for the DSM rows from 2016–2018 (layer 1 years 2016/2018, all of layer 2), or flag them as broken.

**Needs a snapshot** (bcdatamapper scraper, per AGENTS.md; output synced into `public/data/...` or served from bcdatamapper's Pages):

- **File sizes**, because the index has none and the browser cannot HEAD or list the object store, plus the extra products the index does not list (CHM, orthophoto).
- What the scraper fetches:
  - (a) The FeatureServer layers 1–6 attributes, without geometry (`returnGeometry=false`, 1000-row pages, about 360 requests). Geometry is derivable from `maptile`.
  - (b) ListObjectsV2 for each `NNN/NNNx/YYYY/{pointcloud,dem,dsm,chm}/` prefix found in (a), about 500 pages.
  - (c) Optionally layer 0 geometry.
  - Throttle to about 1 request/s. A run takes 15–20 minutes and transfers ~200 MB.
- Snapshot shape and size:
  - **Per-tile table** (`maptile, product, year, project, density, bytes, url-key`) for ~360k rows: ~20–25 MB raw and ~3–5 MB gzipped. Shard it by NTS 1:250k sheet (about 90 shards of ≤300 KB gzipped) to match the per-place loading pattern used elsewhere.
  - **Overview roll-up** per BCGS 1:20,000 sheet (≤7,073 rows: products, years, tile counts, total bytes per product): ≈ 0.3–0.6 MB raw, about 100 KB gzipped. Good for a provincial choropleth of "what's here and how big".
  - A **summary JSON** with totals by product, year and project: a few KB.
- Refresh cadence: the index changed about quarterly in 2026 (last edit 2026-09-15). A monthly scrape that compares `lastEditDate` and the listing ETags is enough.

**Not feasible client-side:** streaming or previewing any LAZ or GeoTIFF from the object store (no CORS, not COPC/COG). In-app point-cloud or DEM previews need conversion and rehosting, the same way `vendor/pgmaps-lidar-data` already does for its EPT tiles. Converting a single 1:2,500 LAZ means downloading 0.5–2.8 GB.

**A downloaded tile does load (added 10 November 2026).** The LAZ files use LASzip's layered chunked compression (`compressor` 3, 50,000 points a chunk) with a chunk table at the end of the file. `src/lib/lidar/lazChunkTable.ts` decodes that table, and Import & data reads a local tile one chunk at a time with laz-perf's `ChunkDecoder`, in a few workers, so memory never holds the whole file. One pass keeps either an even overview of the tile (about 2 million points) or every point inside the map view (up to 3 million, thinned evenly above that). Measured: the 245 MB, 44.5-million-point 2024 Prince George tile (`bc_093g097_1_1_2_xyes_8_utm10_20240713`) reads into an overview in about 5 s in Chrome. The bc_092b051 tile above is 983 MB and 161.7 million points; its chunk table is the unit-test fixture `tests/fixtures/lidarbc-chunk-table.bin`. Converting the whole file to COPC in the browser is still out: unpacked, a tile is 3–5 GB, past WebAssembly's 4 GB limit, which is why GeoLibre's in-browser `lidar_convert` (Whitebox WASM) fails on files this size.

## Helper scripts used

These are in `/private/tmp/claude-501/-Users-ahmadjalil-github-PGMaps/1855de75-ed3c-400d-8b01-2674179873f6/scratchpad/scripts/`:

- `lashdr.py`: parses a LAS header and VLRs from a Range-fetched prefix
- `tiffhdr.py`: walks TIFF IFDs and checks for the COG ghost header
- `list_prefix.py`: paginated ListObjectsV2 with size roll-up by year, product and extension
