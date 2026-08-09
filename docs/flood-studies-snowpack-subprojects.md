# Flood Studies and BC Snowpack sub-project architecture

This document describes how PGMaps should expose the Flood Study Library and BC
Snowpack as parent projects with feature-backed sub-project routes. Source
acquisition, licensing, and local archive operations are documented in
`vendor/bcdatamapper/docs/flood-studies-and-snow-survey.md`.

Status: data contracts are ready; frontend routes and workspaces are not yet wired.

## Product hierarchy

| Parent project | Sub-project unit | Count | Child contents |
| --- | --- | ---: | --- |
| Flood Study Library | One flood study | 166 | Study-index geometry, metadata, FCL class, report/document routes, later report-derived evidence |
| BC Snowpack | One Snow Survey Administrative Basin | 23 | Basin geometry, station network, current observations, historical series, cameras and source links |

Manual and automated snow stations remain records inside a basin sub-project.
They should not create 542 independent project cards. Likewise, individual EcoCat
attachments remain `documents[]` within one flood-study sub-project.

Only the two parent projects should appear in the main project catalog. Child
records should be resolved from an index on demand.

## Why not generate one project package per child?

PGMaps currently has a flat project model:

- `src/lib/projectPackages.ts` defines `ProjectPackage` without parent/child fields.
- `public/data/projects/index.json` is a flat filename list.
- `loadStaticProjectPackages()` fetches every listed package eagerly.
- `src/pages/DevProjects.tsx` selects one project from the `project` query parameter.
- `map-explorer-v1` currently accepts only the `research-records-v1` adapter.

Adding 189 nearly identical package files would clutter the catalog, duplicate
configuration, and eagerly fetch metadata that is only needed after a parent is
opened. A feature-backed child index keeps shared layers and workspace behavior in
the parent while child records contribute identity, bounds, counts, filters, and
documents.

## Route convention

Use stable path routes rather than query-string child selection.

### BC Snowpack

Canonical route:

```text
/bcsnowpack/:basinSlug
```

Canonical basin slugs use lowercase kebab-case:

```text
/bcsnowpack/upper-columbia
/bcsnowpack/vancouver-island
/bcsnowpack/south-thompson
```

Compact forms remain accepted aliases and redirect to canonical URLs:

```text
/bcsnowpack/uppercolumbia -> /bcsnowpack/upper-columbia
/bcsnowpack/vancouverisland -> /bcsnowpack/vancouver-island
```

The canonical form is preferred because it is more readable in navigation,
analytics, logs, copied links, and search results. Aliases preserve the concise
form proposed during planning.

### Flood Study Library

Recommended route:

```text
/bcfloodstudies/:studySlug
```

Flood titles can collide and can change when the source corrects metadata. Build
the canonical slug from a readable title stem plus the stable project ID:

```text
/bcfloodstudies/columbia-river-at-golden-p000311
```

The route resolver should use the project ID suffix as the authoritative lookup
key. Older title stems can redirect when a source title changes.

## Snow basin routes

The generated authority is:

```text
vendor/bcdatamapper/datascrapers/bc/snow-survey/output/basin-project-index.json
```

| Basin | Canonical route | Compact alias | State |
| --- | --- | --- | --- |
| Boundary | `/bcsnowpack/boundary` | — | Current manual observations |
| Central Coast | `/bcsnowpack/central-coast` | `/bcsnowpack/centralcoast` | Current manual observations |
| East Kootenay | `/bcsnowpack/east-kootenay` | `/bcsnowpack/eastkootenay` | Current manual observations |
| Haida Gwaii | `/bcsnowpack/haida-gwaii` | `/bcsnowpack/haidagwaii` | Coverage gap |
| Liard | `/bcsnowpack/liard` | — | Current manual observations |
| Lower Fraser | `/bcsnowpack/lower-fraser` | `/bcsnowpack/lowerfraser` | Current manual observations |
| Middle Fraser | `/bcsnowpack/middle-fraser` | `/bcsnowpack/middlefraser` | Current manual observations |
| Nechako | `/bcsnowpack/nechako` | — | Current manual observations |
| North Thompson | `/bcsnowpack/north-thompson` | `/bcsnowpack/norththompson` | Current manual observations |
| Northwest | `/bcsnowpack/northwest` | — | Current manual observations |
| Okanagan | `/bcsnowpack/okanagan` | — | Current manual observations |
| Peace | `/bcsnowpack/peace` | — | Current manual observations |
| Similkameen | `/bcsnowpack/similkameen` | — | Current manual observations |
| Skagit | `/bcsnowpack/skagit` | — | Current manual observations |
| Skeena-Nass | `/bcsnowpack/skeena-nass` | `/bcsnowpack/skeenanass` | Current manual observations |
| South Coast | `/bcsnowpack/south-coast` | `/bcsnowpack/southcoast` | Current manual observations |
| South Thompson | `/bcsnowpack/south-thompson` | `/bcsnowpack/souththompson` | Current manual observations |
| Stikine | `/bcsnowpack/stikine` | — | Historical or automated only |
| Upper Columbia | `/bcsnowpack/upper-columbia` | `/bcsnowpack/uppercolumbia` | Current manual observations |
| Upper Fraser East | `/bcsnowpack/upper-fraser-east` | `/bcsnowpack/upperfrasereast` | Current manual observations |
| Upper Fraser West | `/bcsnowpack/upper-fraser-west` | `/bcsnowpack/upperfraserwest` | Current manual observations |
| Vancouver Island | `/bcsnowpack/vancouver-island` | `/bcsnowpack/vancouverisland` | Current manual observations |
| West Kootenay | `/bcsnowpack/west-kootenay` | `/bcsnowpack/westkootenay` | Current manual observations |

## Proposed package contract

Add an optional child collection to `ProjectPackage` rather than adding every
child to `public/data/projects/index.json`:

```ts
interface ProjectSubprojectCollectionDef {
  schema: 'feature-subprojects-v1'
  index: string
  idProperty: string
  slugProperty: string
  titleProperty: string
  routeBase: string
  aliasesProperty?: string
}

interface ProjectPackage {
  // Existing fields...
  subprojects?: ProjectSubprojectCollectionDef
}
```

BC Snowpack would declare:

```json
{
  "subprojects": {
    "schema": "feature-subprojects-v1",
    "index": "/data/snow-survey/basin-project-index.json",
    "idProperty": "basin_id",
    "slugProperty": "slug",
    "titleProperty": "title",
    "routeBase": "/bcsnowpack",
    "aliasesProperty": "route_aliases"
  }
}
```

The Flood Study Library can use the same schema with a permission-safe runtime
index or a separately authorized deploy artifact.

## BC Snowpack child workspace

When `/bcsnowpack/:basinSlug` opens:

1. Resolve the slug or alias against `basin-project-index.json`.
2. Redirect aliases to the canonical path with `replace` navigation.
3. Fit the map to `bounds_wgs84`.
4. Highlight the selected snow basin without hiding neighbouring context.
5. Filter `stations.geojson` by `basin_id`.
6. Join current and archived manual observations through `location_id`/`Number`.
7. Show active/inactive, manual/automated, elevation, operator, camera, and data
   links as station filters and details.
8. Render current depth, SWE, density, survey date, and historical series.
9. Do not display percent normal until a bulletin source or documented baseline
   calculation exists.
10. Offer FWA boundaries only as an optional context layer; never relabel the
    snow basin as a watershed.

Special child states:

- Haida Gwaii should show a monitoring-gap explanation because it currently has
  no stations or observations.
- Stikine should emphasize historical manual data and active automated stations;
  it currently has no current-season manual observations.
- The two Yellowhead stations should appear in an explicit Unassigned view, not
  be forced into a basin.

## Flood-study child workspace

Each flood-study child should include:

- stable `Project_ID` and source object ID;
- source-defined study-index/coverage geometry;
- title, date, proponent, consultant, and FCL classification;
- proponent-hosted route and provincial archive status;
- `documents[]` with label, media type, bytes, source URL, and access status;
- later report-derived fields with document and page evidence;
- optional intersections with regional districts, municipalities, FWA watershed
  groups, and major watersheds.

For the 84 EcoCat-backed study records, the first resource action should be the
official EcoCat collection page. All 84 have floodplain-map resources and PDFs;
68 have files in the source-defined `Report Documents` section. Resource rows can
then be grouped into reports, digital maps, data files, and plotfiles using the
[cache-only EcoCat display and resource audit](../vendor/bcdatamapper/docs/ecocat-display-resource-audit.md).
The 84 records map
to 83 unique EcoCat collections because `P000322` and `P000371` share report ID
`1842`; fetching and storage should be deduplicated without merging the projects.

Do not inline-embed or deploy mirrored documents under the current Access Only
terms. Outbound links to the official collection preserve source context and are
the appropriate first release. The archive contains no ready-to-map Shapefile,
GeoJSON, GeoPackage, KML, or GeoTIFF layer. Legacy HEC cross sections may support
future charts, but sampled coordinate files use assumed local coordinates and
must not be mapped without study-specific georeferencing.

Useful report-derived fields include flood mechanism, return periods, climate
scenario, sea-level-rise allowance, FCL values, vertical datum, CRS, DEM/LiDAR
source, model/software, calibration events, dike/breach assumptions, and mapped
depth/velocity/elevation products.

The project must state that the index geometry is not flood extent. Because the
source is Access Only, production should stream the official FeatureServer and
link users to source documents unless written redistribution permission is obtained.

## Data deployment

Snow Survey is suitable for generated PGMaps deployment:

```text
vendor/bcdatamapper/datascrapers/bc/boundaries/output/BCSnowSurvey/
  -> generated public/data/boundaries/BCSnowSurvey/
vendor/bcdatamapper/datascrapers/bc/snow-survey/output/
  -> generated public/data/snow-survey/
```

The boundary folder is already covered by the general boundary mapping and the
Snow Survey project output has its own mapping in
`scripts/sync-bcdatamapper-data.mjs`. Keep the generated `public/data` copies
untracked, consistent with the repository's scraper-owned data policy.

Flood Studies is not suitable for that copy path under the current Access Only
terms. The local 14.56 GiB EcoCat mirror is an analysis cache only.

## Frontend implementation sequence

1. Add `ProjectSubprojectCollectionDef` normalization and tests.
2. Add `/bcsnowpack/:basinSlug` and `/bcfloodstudies/:studySlug` routes.
3. Add canonical-slug and alias resolution with redirect tests.
4. Load basin polygons from generated
   `public/data/boundaries/BCSnowSurvey/snow_survey_admin_basins.geojson` and
   Snow Survey project data from generated `public/data/snow-survey/`.
5. Implement a reusable feature-subproject loader.
6. Build the BC Snowpack basin workspace first because its deploy data is OGL-BC.
7. Add current/manual history charts and station details.
8. Add the Flood Study Library using official runtime geometry and document links.
9. Keep EcoCat/local report analysis outside the browser deploy until permission.
10. Add direct-load, refresh, unknown-slug, mobile, and accessibility tests.

## Required route behavior

- Direct navigation to a canonical child route must work after a static-host refresh.
- Unknown slugs must render a useful not-found state with a link to the parent.
- Compact aliases must replace-navigate to canonical routes.
- Browser back must return to the parent project without losing parent filters.
- Child links must be shareable without depending on prior in-app navigation.
- Route parsing must not infer a basin from display text; it must resolve against
  the generated index.
