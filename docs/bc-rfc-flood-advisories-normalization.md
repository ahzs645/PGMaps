# BC RFC Flood Advisories Normalization Notes

Source pipeline: `npm run flood:sync`

Primary script: `scripts/sync-bc-rfc-flood-advisories.mjs`

Outputs:

- `public/data/flood/advisories.json`
- `public/data/flood/manifest.json`
- `public/data/flood/discovery.json`
- `public/data/flood/raw/*`
- `public/data/flood/text/*`

## Source Discovery

The BC River Forecast Centre does not expose a complete public archive index for `/warnings/advisories/`; directory listing is blocked. The sync process therefore uses multiple reproducible discovery methods:

1. Current warning index: `https://bcrfc.env.gov.bc.ca/warnings/index.htm`
2. Maintained seed file: `scripts/flood-advisory-seeds.txt`
3. Legacy numbered probes: `flood_N.htm`, `flood_NNN.htm`
4. Legacy year-number probes: `flood_YYYY_NNN.htm`
5. Internet Archive CDX patterns for old BC RFC advisory URLs

When a Wayback-discovered URL no longer exists on the live BC RFC host, the script downloads the archived capture and records `downloadedFrom`.

## Current Coverage

As of the latest generated manifest:

- 736 parsed source documents before dedupe
- 707 deduped advisory records
- 29 duplicate source documents merged
- Date range: 2010-10-19 to 2026-05-15
- 16 records retained without parsed `issuedYear`

Year counts:

| Year | Advisories |
| --- | ---: |
| 2010 | 2 |
| 2011 | 13 |
| 2012 | 6 |
| 2013 | 20 |
| 2014 | 1 |
| 2016 | 8 |
| 2017 | 72 |
| 2018 | 38 |
| 2019 | 10 |
| 2020 | 71 |
| 2021 | 143 |
| 2022 | 117 |
| 2023 | 69 |
| 2024 | 43 |
| 2025 | 52 |
| 2026 | 26 |
| Unknown | 16 |

Level counts are not mutually exclusive because one bulletin can include several advisory levels:

| Level | Bulletins |
| --- | ---: |
| High Streamflow Advisory | 586 |
| Flood Watch | 300 |
| Flood Warning | 136 |
| Unknown | 23 |

## Consistency By Era

The normalized output is consistent enough for timeline filtering and advisory-level filtering, but the source documents are not uniform across the full archive.

| Era | Records | Source shape | Consistency |
| --- | ---: | --- | --- |
| Legacy/archive | 138 | Mixed PDF and older HTML, often from Wayback | Partial. Most have text, levels, and boundary matches; date/status extraction is weaker. |
| HTML template | 119 | 2018-2020 BC RFC HTML template | Strong. Dates, levels, statuses, and text parse consistently. |
| PDF/template | 450 | Mostly 2021-2026 PDFs plus a few HTML pages | Strongest. Dates, levels, statuses, and text parse consistently. |

Stable app fields:

- `id`
- `url`
- `sourceMethods`
- `title`
- `issuedAt`
- `issuedAtLocal`
- `issuedYear`
- `levels`
- `statuses`
- `namedAreas`
- `matchedBoundaries`
- `rawPath`
- `textPath`
- `downloadedFrom`
- `duplicateUrls`

Variable fields:

- title wording and whether a ministry header is included
- date wording and punctuation
- PDF versus HTML format
- broad region names versus river-specific names
- whether station IDs, flow rates, or return periods appear in the narrative

## Recommended App Bridge

Use `docs/bc-rfc-flood-advisories-strict-bridge.json` for implementation. The bridge is intentionally source-preserving:

- Do not overwrite source `levels` or `statuses`.
- Treat `matchedBoundaries` as inferred matches, not official advisory polygons.
- Keep `sourceMethods` and `downloadedFrom` visible for audit/debug views.
- Use `issuedAt` for timeline ordering when present.
- Keep records with null `issuedAt` in an "undated archive" bucket instead of dropping them.

## Boundary Matching

Historical BC RFC advisories do not provide polygons. The pipeline matches names in the title/body against local boundary datasets:

- drought basins: `public/data/drought/basins.geojson`
- FWA watershed groups: `public/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson`
- FWA assessment watersheds: `public/data/boundaries/BCFWA/assessment_watersheds.geojson`
- FWA major watersheds: `public/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson`

Boundary matches are useful for map overlays and regional filtering, but they are approximate. A matched watershed means the name appears in the bulletin text; it does not mean BC RFC issued an official polygon for that exact extent.

## Timeline Rules

Recommended timeline fields:

- `timelineDate`: `issuedAt`
- `timelineYear`: `issuedYear`
- `timelinePrecision`: `instant` when `issuedAt` exists, otherwise `undated`
- `timelineBucket`: year/month/day derived from `issuedAt`
- `undatedArchive`: true when `issuedAt` is null

Recommended filtering:

- Advisory level: source `levels`
- Status: source `statuses`
- Region/watershed: inferred `matchedBoundaries`
- Source era: derive from `issuedYear` and source format

## Known Gaps

- There are no records currently discovered for 2015.
- 16 records are retained without parsed year/date.
- Some pre-2018 records are only available through Wayback captures.
- Wayback CDX is intermittent; repeated runs can vary if the archive service rate-limits or returns temporary errors.
- Current source discovery is broad but still not proof of full historical completeness because BC RFC does not publish a complete archive inventory.

## Refresh Guidance

Run:

```bash
npm run flood:sync
```

If new advisories are discovered manually or through search, add them to:

```text
scripts/flood-advisory-seeds.txt
```

Then rerun `npm run flood:sync`. The script dedupes advisories by issued timestamp and normalized title while preserving duplicate source URLs in `duplicateUrls`.
