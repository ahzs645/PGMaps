# Shared postal geography and CANUE aggregation

## Canonical boundary layer

The Boundaries page exposes **Postal boundaries → BC postal region (V) → Postal prefix (2 characters, derived) → FSA (3 characters, 2021)**. It uses the same `loadStudyAreaRegions('postal', 'fsa')` loader available to other maps; do not copy its geometry into individual thematic datasets.

- Dataset identity: `statcan-cfsa-2021-bc`.
- Join key: `CFSAUID` / `boundaryCode`, e.g. `V2L`; include census year when storing cross-vintage records.
- Scraper: `vendor/bcdatamapper/datascrapers/bc/boundaries/sync-statcan-fsa.mjs`.
- Maintained snapshot: `vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_fsa_2021.geojson.gz`.
- Generated app URL: `/data/boundaries/StatCan/bc_fsa_2021.geojson.gz`.
- `npm run boundaries:fsa` downloads/caches the official archive, rebuilds the snapshot and syncs generated public data. Add `--refresh` to the vendor command to re-fetch the versioned archive.
- Parent level: `loadStudyAreaRegions('postal', 'postalRegion')` reads an automatically dissolved parent at `/data/boundaries/StatCan/bc_postal_region_2021.geojson.gz`. It exactly equals the union of all 191 child display polygons. The Up/Down buttons step through region, two-character prefix, and FSA. The prefix level (`postalPrefix2`) groups FSAs by their first two characters, producing 10 areas (V0–V9), each exactly equal to its child FSA union. These are PGMaps-defined groups and may have disconnected parts. No four-, five-, or six-character boundary polygons are available: grouping observation rows by a longer prefix does not supply geometry or tell us how to split an FSA.
- Compatibility: older `census:fsa` share links migrate to `postal:fsa`, including selected IDs and focus.
- Search index: `npm run boundaries:search-index`.
- 191 BC polygons; V7X/V7Y are absent from this release. Never fabricate boundaries for those codes.

[Official archive](https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lfsa000b21a_e.zip) · [Reference guide](https://www150.statcan.gc.ca/n1/pub/92-179-g/92-179-g2021001-eng.htm)

The public file is a display derivative of census-reported three-character FSAs, not current six-character Canada Post delivery areas. The full BC geometry remains in the scraper's ignored source cache. Source ZIP is NAD83 / Statistics Canada Lambert; full BC GeoJSON is WGS84. Display simplification processes all 191 polygons together in BC Albers (EPSG:3005), using pinned Mapshaper 0.6.113, shared-topology cleaning, Douglas–Peucker at 25 metres, shape preservation, then WGS84 with eight decimal places.

Validation: 191 valid geometries; all 18,145 feature pairs checked; zero polygon-area overlaps; 445 adjacent feature pairs share exact segments (24,292 shared segments). Largest absolute relative area change is 1.6232% at V6C. Use source geometry for spatial assignment/area analysis, not the display derivative. Original land area remains in `sourceLandAreaKm2`; the generic boundary UI reports displayed geometry area. Six-decimal rounding introduced invalid geometry, so eight decimals are intentional.

## Reuse values as well as geometry

Store raw postal-code observations once per source release and year. Derive geometry-free summary tables and let maps join them onto the canonical boundaries. A release should record input checksum, indicator, observation year, boundary version and aggregation method. Do not overwrite a centroid-based product with a postal-prefix product under the same identity.

`vendor/bcdatamapper/datascrapers/canue/build-postal-fsa-table.py` reads a CSV, or an explicitly selected CSV inside a ZIP, and writes an FSA table referencing this shared boundary dataset. Example (replace the CSV member with its actual archive name):

```sh
python3 vendor/bcdatamapper/datascrapers/canue/build-postal-fsa-table.py \
  --input /path/to/source.zip --member exact/path/to/values.csv \
  --postal-column postalcode12 --value-column pm25dal12_01 \
  --year 2012 --dataset pm25dal_a --output /private/local-output/pm25-2012-fsa.json
```

This method normalizes six-character codes, groups by their first three characters, deduplicates identical postal rows, rejects conflicting duplicates, excludes missing values and CANUE -9999/-1111 sentinels, and records means, counts, minima and maxima. It retains prefixes without matching geometry. Tests cover these cases. The output contains no postal points or copied polygons.

The resulting mean weights each valid postal code equally. It is **not population weighted**, and does not recreate the MHCCA paper's preparation automatically. Census FSA geometry and postal prefixes may differ. For aggregation to LHA, CSD, etc., the existing `build-canue-v2-postal-boundary-aggregates.py` uses postal representative points and point-in-polygon membership. Retain method-specific membership once per coordinate and boundary vintage, then reuse it across indicators. Do not average area means without their denominators; medians and rates need their own appropriate aggregation rules.

The new table builder has fixture tests, but a full CANUE source run is currently unverified: the available Drive ZIPs are `dataless` placeholders and did not become readable during this task. No new FSA air-quality option has been advertised in CANUE's selector until actual aggregate tables exist. Existing maps have not been bulk-migrated. The shared FSA geometry itself is operational in Boundaries.

## Measured sizes (decimal MB/GB, 22 September 2026)

| Item | Size | Status |
|---|---:|---|
| National 2021 FSA source ZIP | 162.04 MB | Downloaded and parsed |
| BC full-resolution geometry only | 124.30 MB | Local source cache |
| BC display GeoJSON | 8.53 MB | Derived, 191 features |
| BC compressed FSA display payload | 2.73 MB | Shared app snapshot |
| BC two-character prefix groups | 2.49 MB compressed | 10 derived groups, V0–V9 |
| BC postal-region parent | 2.25 MB compressed | Automatically dissolved from the same FSA snapshot |
| PM2.5 2012 CANUE BC ZIP | 10.43 MB | Drive metadata; contents currently unavailable |
| Ozone 2015 CANUE BC ZIP | 10.62 MB | Drive metadata; contents currently unavailable |
| CANUE “2026 pull” collection, 388 ZIPs | 16.31 GB | Directory metadata total, not hydrated disk usage |
| PCCF six-character crosswalk | Unknown | No local file found in the research Data tree; no download obtained |

The CANUE ZIPs are not PCCF. PCCF supplies links and representative coordinates, not a set of six-character polygons to dissolve. A postal code can have multiple crosswalk records, so naive joins can double-count. Official census FSA polygons cannot be recovered exactly from postal points alone. [PCCF catalogue](https://www150.statcan.gc.ca/n1/en/catalogue/92-154-X) · [PCCF reference guide](https://www150.statcan.gc.ca/n1/pub/92-154-g/92-154-g2017001-eng.htm).

The new FSA layer and builder have not been uploaded to R2. Restricted raw CANUE/PCCF data should retain their existing access conditions; this task does not publish them.
