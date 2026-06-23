# AQ Map Forecast Zones: Static Snapshot Gap

Documented: 2026-06-21

## Summary

The AQ map's Forecast Zones overlay (`/dev/aqmap`, including `/dev/aqmap/main`) now
renders from a committed, slimmed snapshot of the ECCC public standard forecast
zone boundaries instead of fetching ~4.6 MB live from `api.weather.gc.ca` on every
visit. This fixed a slow first paint (~2.1 s, no upstream cache headers), but it
introduces a **staleness gap**: the snapshot is refreshed manually and is not wired
into any automated build or scheduled job.

## Current Behaviour

- Snapshot file: `public/data/aqmap/forecast-zones.geojson` (committed; ~2.2 MB raw,
  ~0.5 MB gzip; 419 zones).
- Generator: `scripts/build-aqmap-forecast-zones.mjs`, run via
  `npm run aqmap:forecast-zones`. It fetches the live ECCC OGC API collection, keeps
  only the four properties the app reads (`NAME`, `NOM`, `CLC`, `FEATURE_ID`), and
  rounds coordinates to 4 decimals (~11 m).
- Runtime: `loadForecastZoneData()` in `src/maps/aqmap/AqMapSection.tsx` loads the
  same-origin snapshot first and falls back to the live API
  (`FORECAST_ZONES_VECTOR_URL`) only if the snapshot is missing.
- `prebuild` runs `npm run aqmap:forecast-zones -- --if-missing`, so normal builds
  verify that a local snapshot exists. They do not automatically refresh an existing
  snapshot.

## The Gap

- **Staleness / no refresh cadence.** Forecast zone boundaries are static
  administrative geography that changes rarely, so a stale snapshot is low-risk but
  not zero-risk. There is no automated check that the committed file still matches
  upstream, and no scheduled regeneration.
- **Silent fallback.** If the snapshot is ever deleted from the deploy, the app
  silently reverts to the slow live API. That is correct for resilience but hides the
  regression (the original performance problem) with no signal.
- **Pattern is only partly generalized.** Other AQ map overlays use a mix of live
  government endpoints and committed snapshots:
  - Active Fires — direct browser fetch of the CWFIF WFS
    (`geoserver.cwfif.nrcan.gc.ca`), built by `getActiveFiresVectorUrl()`. This is
    *intentionally* live (fires change hourly), but it has no caching layer and no
    fallback if the WFS is down or removes CORS.
  - Fire Perimeters — direct WFS/WMS fetches to `cwfis.cfs.nrcan.gc.ca`.
  - Fire Danger — raster mode uses live WMS from the CWFIS polygon source; deck.gl
    mode uses committed vector tiles built from the matching CWFIS WFS source.
  - Modelled PM2.5 — raster mode uses committed WMS PNG snapshot tiles; deck.gl and
    vector modes use the paired native RAQDPS GRIB2-derived vector snapshot.

## Source Notes (for any future refresh)

- These boundaries are ECCC's own authoritative geography; there is no meaningfully
  independent third-party source.
- `api.weather.gc.ca/collections/public-standard-forecast-zones` (current source)
  only exposes the "Hybrid" depiction as vector.
- `geo.weather.gc.ca/geomet` WFS serves the same data on the GeoMet CDN, but with
  awkward `properties.NAME`-prefixed keys (would need remapping).
- ECCC publishes a lower-resolution "coarse" depiction, but only as a raster (WMS) —
  there is no separate low-res vector collection to download.

## Options to Address

1. **Scheduled regeneration.** Add `aqmap:forecast-zones` to a periodic CI job (e.g.
   monthly) that re-runs the generator and opens a PR if the output changed. Lowest
   maintenance for a rarely-changing dataset.
2. **Build-time refresh.** Wire the generator into `prebuild` so every deploy ships a
   fresh snapshot. Simpler, but adds a slow, network-dependent gov fetch to every
   build and can break builds when upstream is down.
3. **Staleness signal.** Stamp the snapshot with a generated-at date and log/warn when
   the live fallback path is taken, so a missing or old snapshot is visible.
4. **Generalize the snapshot pattern** to the remaining static-ish overlays if their
   load time or upstream reliability becomes a problem. See
   `docs/aqmap-eccc-snapshots.md` for the fire danger and PM2.5 snapshot contracts.

## Related Files

- `scripts/build-aqmap-forecast-zones.mjs`
- `public/data/aqmap/forecast-zones.geojson`
- `src/maps/aqmap/AqMapSection.tsx` (`loadForecastZoneData`)
- `src/maps/aqmap/lib/aqMapConstants.ts` (`FORECAST_ZONES_LOCAL_URL`,
  `FORECAST_ZONES_VECTOR_URL`, `getActiveFiresVectorUrl`)
