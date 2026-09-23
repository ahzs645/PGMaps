# Ignored vendor data: boundary reuse and storage review

Checked 22 September 2026 against this checkout and authenticated listings of the
`maps` and `pgmaps-private-data` R2 buckets. This review covers the ignored files
previously classified as **documented local-only**. It does not reclassify
generated copies in `public/data` as app-owned source data.

The [file inventory](data-inventory/vendor-local-only-sha256-2026-09-22.csv)
records path, size and SHA-256 for all **1,192 ignored files (1,811,182,041
bytes)**. The [R2 backup manifest](data-inventory/vendor-local-only-r2-backup-2026-09-22.json)
records the archive parts and restore checksums.
The ParcelMap ZIP and remediation source gzip hashes agree with their tracked
source manifests. At the initial scan no byte-identical R2 match was confirmed
and neither bucket had a dedicated dataset prefix for these four groups.
The files are now preserved in a **private backup archive**, not as published
or app-accessible datasets.

| Ignored source group | Files / size | What exists | Existing boundary use | Durable payload |
| --- | ---: | --- | --- | --- |
| EDI captures and products | 1,109 / 560.6 MiB | Wave 2–8 workbook-derived and Wave 2–9 dashboard aggregate results, raw regional captures, current boundary downloads and immutable normalized releases | Publisher regions are normalized. Dashboard results join only to the matching captured wave geometry. Historical workbook results remain tables because the boundary edition has not been proven equivalent. | Local cache and private R2 backup |
| EDI boundary cache | 16 / 78.1 MiB | HELP and legacy MCFD polygons, source responses, workbook and audit references | 81 boundary snapshot references share 36 exact geometry assets. Four current health snapshots match existing BCMoH geometry. Official school-district geometry is already tracked in the submodule. HELP and MCFD editions remain separate. | Local cache and private R2 backup |
| ParcelMap source and research | 60 / 1,067.2 MiB | 303.2 MiB original ZIP, 514.9 MiB extracted geodatabase, 196.3 MiB candidate GeoPackage, exclusion masks and audit evidence | A tracked 145-row regional-district × owner summary groups parcels using ParcelMap's `REGIONAL_DISTRICT` attribute. It does not spatially join or clip parcels to PGMaps' shared regional boundaries. | Local source and private R2 backup |
| Environmental remediation | 7 / 21.3 MiB | 27,984 source points and a compressed development-map product | No administrative-boundary rollup. Map clusters group nearby points visually and are not regional counts. | Local source and private R2 backup |

## EDI boundary and aggregate status

The current EDI release references **55 compressed blobs (67.13 MiB)**. Its
227.12 MiB of raw dashboard captures, 107.00 MiB of current official boundary
downloads, and 78.10 MiB of older boundary/workbook cache are separate
reproducibility inputs. The release records 67 wave-specific publisher
boundaries with `dashboard_only` joins and 14 `reference_only` boundary
snapshots. Exact coordinate reuse reduces 81 snapshots to 36 geometry assets;
it does **not** make historical values safe to place on a newer boundary.

Existing health authority, health service delivery area, local health area and
community health service area reference geometry is reused where coordinates
and IDs match. School districts already have a tracked official output. HELP
neighbourhoods have a parent school district, and the legacy MCFD
LSA → SDA → Region hierarchy is preserved. The available current MCFD
organizational structure lacks verified matching vector geometry. No new
cross-vintage allocation is justified by the existing data.

The UBC workbook and dashboard-derived geometry have no documented
redistribution permission. MCFD services and the remediation source are
marked Access Only. Their existing source manifests keep the payloads out of
Git and production assets. ParcelMap's base archive is open licensed, but
some masks used in the research screen have separate access conditions.

## What should be retained

1. **EDI:** Preserve the raw capture, source workbook, boundary inputs, current
   release manifest and all referenced blobs together. The current release
   alone is useful for viewing but does not preserve the full source trail.
   Earlier immutable releases should be retained if historical review matters.
2. **ParcelMap:** Preserve the original ZIP at its recorded SHA-256. The
   extracted geodatabase can be rebuilt from it. Preserve the candidate
   GeoPackage and source masks only if the exact research result must be
   reproduced; tracked regional summaries and audit reports do not contain
   those geometries.
3. **Remediation:** Preserve the 2.0 MiB compressed source alongside its
   tracked manifest. The local map product can be rebuilt from that source.

The remote backup uses 19 checksum-named archive parts under
`pgmaps-private-data/local-only-vendor/2026-09-22/`, totalling **1,812,510,720
archive bytes**. Seven parts contain the 1,125 EDI files, eleven contain the 60
ParcelMap files, and one contains the seven remediation files. The bucket has
no custom domain and its public `r2.dev` URL is disabled. The manifest and
per-file SHA-256 inventory are copied beside the parts in R2. Every tar member
was checked against its source SHA-256; every uploaded part was checked against
R2's reported size and single-part MD5 ETag. Restore by downloading the parts
in manifest order, concatenating them, checking `archiveSha256`, and extracting
the tar into a controlled location. Check the extracted files against the
per-file inventory before use.

These objects remain private and outside production routes while source
permissions are resolved. The open ParcelMap ZIP could be separately published
later with its required attribution. Do not add
scraper-owned payloads or duplicate synced files under PGMaps `public/data`.

The EDI scraper code itself is currently untracked in `vendor/bcdatamapper`;
preserving data without that code would leave the capture hard to reproduce.
Per the repository instructions, any scraper code or manifest changes should
be committed and pushed in the submodule before updating the PGMaps pointer.

**Status of this review:** the checksum inventory, backup manifest, and this
audit were written to PGMaps; source payloads were backed up privately in R2.
No source payload was committed to Git or published to the app.

## Personal test-site releases (23 September 2026)

The private archive above remains unchanged. Two derived products were also
published to the existing public `maps` R2 bucket for PGMaps' test site:

| Product | Public path | Browser use |
| --- | --- | --- |
| Remediation map snapshot | `https://data.map.ahmad.sh/bc/environmental-remediation/v1/` | `/misc?tab=remediation` fetches the manifest and 1.36 MB compressed point map. |
| ParcelMap initial candidate screen | `https://data.map.ahmad.sh/bc/parcelmap/v1/` | `/misc?tab=parcelmap` fetches the manifest and ranges from a 103 MB PMTiles archive. |

The remediation source remains labelled Access Only, as does a national-park
mask used in the ParcelMap screen. The app labels the results as research
snapshots and does not present remediation points as contamination extents or
candidate parcels as verified available land. The original archives, masks,
GeoPackage and audit files remain in the private backup.
