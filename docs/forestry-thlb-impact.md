# THLB impact

`/dev/forestry/thlb-impact` measures known weighted THLB hectares inside proposed
WHAs or other assessment polygons. The Forestry landing page and dev library link
to it. Local files remain in the browser; no uploaded source data is published.

## Public proxy data is available

The pasted THLB procedure describes an unpublished raster. A newer public catalogue
entry was created on July 30, 2026 and modified September 17, 2026:

- [Provincial Proxy THLB](https://catalogue.data.gov.bc.ca/dataset/63756eb9-9e7c-497e-9498-3dee3e080616).
- [Vector File Geodatabase ZIP](https://coms.api.gov.bc.ca/api/v1/object/28d59553-b76c-4c02-86c7-f1c7efe65b26).
- [Creation methodology](https://coms.api.gov.bc.ca/api/v1/object/6bdb45d9-dd81-4711-95ae-8e9760fde7bc).

Verified November 2, 2026 UTC: the data endpoint answered an unauthenticated range
GET with HTTP 206, ZIP bytes, total size 292,691,560 bytes, and root folder
`provincial_pthlb.gdb`. The catalogue describes vector polygons derived from a
100 m × 100 m raster (1 hectare cells). Its factor is **`pthlb_fact`**:
0 and null contribute nothing; 1 contributes 100%; intermediate values are fractions.
This public product is not established to be identical to the historical raster
described in the pasted procedure.

The catalogue marks the licence **Access Only**. The application links to the
source and supports local import; it does not redistribute the provincial archive.
The source explicitly limits the proxy to strategic analysis and forest-estate
modelling, excluding operational use. Preserve that distinction in the interface
and every exported workbook.

The [official TSR compilation](https://catalogue.data.gov.bc.ca/dataset/8a87abbd-7623-426a-94c4-12e9dfea7cb0)
remains separate. Its [download directory](https://www.for.gov.bc.ca/ftp/HTS/external/!publish/DataCatalogue_FAIB_Data/THLB/)
now includes a seamless `prov_THLB_tsas.gdb.zip`, TSA downloads and some TFL downloads.
The catalogue warns that most area-based tenures are absent. Available TFL data can
be imported as official data; do not assume blanket TFL completeness.

## Workflow and assumptions

1. Download the relevant official THLB and/or public proxy archive. Import assessment
   polygons and source polygons as zipped File Geodatabases, `.gdb` folders,
   shapefiles (all parts together), GeoPackages, GeoJSON, KML or FlatGeobuf.
2. Choose layers and fields. Assessment IDs must be non-empty and unique; dissolve
   repeated IDs into multipart geometries before import. Factors must be 0–1,
   not percentages. `thlb_area_ha` is not used as an intersect-piece area.
3. Optionally import VRI rank-1 age polygons, a complete old-growth deferral mask
   for the study area, and a non-overlapping TSA/TFL boundary layer.
4. Review the maturity threshold (default **80 years is an assumption**, not a
   provincial standard). No automatic age projection is performed. Review the
   reference year and refresh source data as appropriate.
5. Run; review the map, missing coverage, source split and exported pieces.

The public proxy is already vectorized, so the current importer accepts its vector
geodatabase directly. **Raw proxy GeoTIFFs are not supported.** There is no need to
multiply factors by 1000 and truncate them for this vector workflow.

## Calculation contract

- GDAL reprojects vector inputs to **EPSG:3005** and reads only source features
  near assessment polygons via `ogr2ogr -spat … -spat_srs EPSG:3005`. Adjacent boxes
  are clustered. Coordinates are read at millimetre precision through the existing
  GDAL adapter. There is no province-wide GeoJSON fetch or automatic 279 MB fetch.
- `analysis.ts` is independent of the DOM and network. Polygon overlays run in
  `thlb.worker.ts`; Cancel terminates that worker and invalidates in-flight reads.
  GDAL reads share the AVAST queue and mount lifecycle.
- Every contributing piece is **area in square metres / 10,000 × factor**.
  Areas are planimetric. Analysis geometry is not simplified. No positive-area
  sliver is intentionally discarded, and rounding occurs only in presentation.
- Official data takes precedence over proxy data, including official zero factors
  and missing factors. Proxy fills only ground outside the official footprint.
  Within a source, earlier input features win overlaps, and overlaps produce a
  review note. Geometry errors fail the run instead of silently discarding pieces.
- Missing official factors remain unknown, are excluded from known THLB, and retain
  a separate area ledger. Null proxy factors mean zero, following its catalogue.
  Uncovered ground remains unknown; it is not inferred from VRI, forest cover,
  merchantability or a province-wide average.
- Maturity splits at `age >= threshold`; missing or negative ages stay unknown.
  VRI overlaps use earlier-feature precedence with a note. Missing VRI coverage
  remains unclassified.
- Deferrals form a binary union mask. Overlapping deferrals count once. A supplied
  mask with no nearby polygons reports zero overlap; no supplied mask reports
  "not assessed". Completeness of the imported mask is a user assumption. Deferrals
  are distinct from OGMAs and do not automatically establish legal restrictions.
- Separate administrative boundaries split the pieces. Their gaps are unclassified;
  overlapping boundaries use earlier-feature precedence with a note. Without that
  layer, an optional source administrative-name field is retained.
- Per-assessment rows can share ground. **Combined totals are computed over the
  union of all assessment geometries**, never by summing overlapping rows.
- Affected THLB is the default result. A user may explicitly apply a uniform 0–100%
  reduction scenario to known THLB. This does not calculate AAC, timber volume,
  economic impact or the specific effects of conditional harvest prescriptions.
- Piece area plus uncovered area must reconcile to assessment area within
  `max(1e-6 ha, gross area × 1e-8)`, otherwise the run fails.

## Results and exports

The map draws source coverage from the **union ledger** and separately outlines
assessment areas. Its fill indicates coverage, not a binary harvestability claim;
zero-factor official polygons still have official coverage. Missing official
factors appear amber. Click an assessment or its table row to inspect and frame it.

The Excel workbook includes per-assessment summaries, the union summary, stratified
age × deferral × administration × source breakdowns for both ledgers, intersect
pieces, and method/QA/source notes. GeoJSON contains individual assessment pieces
in WGS84. The zipped File Geodatabase contains assessment summaries as attributes,
individual pieces and union pieces in BC Albers, plus summary and method/QA tables.
GeoJSON also carries method/QA as a foreign collection member. Exports are disabled after inputs
or assumptions change until a new run completes.

The synthetic example has two overlapping WHAs covering a union of 5 ha. Official
THLB contributes 1.5 ha and proxy contributes 1 ha; known union THLB is 2.5 ha and
1 ha lacks source coverage. Individual rows sum to 3 ha of THLB because they
overlap. Synthetic outputs are labelled in filenames, attributes and workbook QA.

## Verification

- `npx vitest run src/pages/dev-thlb`: partial intersections, holes and slivers,
  official-zero precedence, missing factors, source overlaps, age/deferral/admin
  stratification, overlapping WHAs, empty masks, missing coverage, input validation,
  workbook values and export provenance.
- `tests/e2e/forestry-thlb-impact.spec.ts`: synthetic worker run, real GDAL file
  import, Excel/GeoJSON/geodatabase downloads and stale-result export protection.
- Compare real study results with an independently completed ArcGIS analysis before
  relying on the tool for planning decisions. No such reference was supplied here.
