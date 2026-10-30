# Shared component audit

Source review: 2026-10-30.

Implementation status: completed in the working tree. See
[shared component implementation](shared-component-implementation.md) for the
actual APIs, preserved behavior and validation record. The findings below retain
the original audit rationale; descriptions of duplicated code refer to the
pre-refactor source.

The best next extractions are **form fields**, **wait-map marker clustering**, and
**walkability factor controls**. Much of the remaining work is adopting components
that already exist, rather than growing another component library.

## Scope and method

- Inventoried all 42 non-redirect route component families in
  [`src/App.tsx`](../src/App.tsx), including their variants, the three PG Data
  tabs, 15 MISC tabs, nine LiDAR tool entries, and project presentation modes.
- Scanned all 489 non-test TSX files in `PGMaps/src`, plus supporting hooks and
  utilities, for repeated functions, markup patterns, imports, and identical
  multi-line blocks. Inspected the implementations behind the recommendations
  below. This is a source audit, not a browser-based visual or accessibility audit.
- Compared findings with [`shared-ui.md`](shared-ui.md),
  [`toolkit-extraction.md`](toolkit-extraction.md), and the standalone
  `geo-toolkit/API.md`. PG Maps compatibility exports are intentionally shared
  implementations; they are not duplicate components.
- The other workspace repositories are `geo-toolkit` (the component package),
  `json-url` (serialization/sharing utilities), and `bcdatamapper` / `healthdata`
  (data preparation). They are not additional product UI apps. Their datasets
  and generated outputs should retain their existing ownership.

## Highest-value extractions

### 1. Form fields — broadest reuse

**Evidence:** separate `Field` helpers in
[`DevDesign`](../src/pages/DevDesign.tsx),
[`DevWaterTemperature`](../src/pages/DevWaterTemperature.tsx),
[`forestry Sidebar`](../src/pages/dev-forestry/Sidebar.tsx), and
[`road Controls`](../src/pages/dev-forestry-roads/Controls.tsx).
Separate `NumberField` implementations also exist in the last two and
[`AVAST SettingsPanel`](../src/pages/dev-avast/SettingsPanel.tsx).

Across the scanned TSX files, 94 files contain native select markup, 31 contain
numeric inputs, 33 contain range inputs, and 59 contain checkboxes. These counts
identify review candidates; a native input alone is not a duplication defect.

**Extract:** a small `FormField` wrapper for label, description, unit, error and
optional hint; a native `SelectField`; and a numeric field with explicit required
and nullable contracts. Reuse `ToggleRow`, `Slider`, and the toolkit's
`ScrubNumberField` where their interactions fit.

**Why it matters:** the current numeric fields disagree on blank input, partial
typing, clamping, and commit timing. Road controls retain a draft and commit on
blur/Enter; forestry's required field converts immediately with `Number(...)`;
AVAST's field maps blank/invalid input to `null`. Share mechanics while making
those policies explicit. Do not silently convert an unset measurement to zero.

**Ownership:** generic controls in `geo-toolkit`; PG-specific help text and
`InfoTip` integration in the app adapter. Keep native select behavior available;
replacing every select with the existing Radix `AppSelect` is unnecessary.

**First consumers:** road design, forestry visual quality, AVAST, then LiDAR and
Nechako forms. The existing draft-aware road controls are a useful starting point.

### 2. Screen-space marker clustering — clearest algorithm copy

**Evidence:** `WaitMarkers` in
[`DevWait`](../src/pages/DevWait.tsx) and `SpecialistFacilityMarkers` in
[`DevWaitSpecialist`](../src/pages/DevWaitSpecialist.tsx) repeat:

- `moveend` / `zoomend` / `resize` subscriptions and version state;
- projection into screen pixels and a 140 px offscreen margin;
- priority sorting, 54 px cluster radius, and incremental centroids;
- singleton fallback before the map is available.

**Extract:** pure `clusterScreenPoints<T>` plus a small map hook accepting
`getId`, `getCoordinates`, priority, radius, and viewport padding. Retain the
original items in each cluster and allow each app to render its own markers.

**Keep local:** ER status, specialist wait bands, marker priority, cluster-size
styling, and the different expansion behaviors. ER zooms into a cluster;
specialists reveal individual facilities. The existing `MapClusterLayer` uses
map-source clustering and is not a drop-in replacement for this DOM-marker logic.

**Ownership:** generic calculation/map integration in `geo-toolkit`, with
health-specific marker renderers in PG Maps. Preserve ordering and centroid
behavior during the first migration.

### 3. Walkability factor controls — clearest UI copy

**Evidence:** the factor-weight section in
[`pgdata/walkability.tsx`](../src/maps/pgdata/walkability.tsx) and
[`ScoreBuilderWalkabilitySurfacePanel`](../src/maps/scorebuilder/components/ScoreBuilderWalkabilitySurfacePanel.tsx)
render the same factor reference/name, group/method, off/value badge, and
0–2 slider with a 0.25 step. Both use the same factor catalog and dropped-factor
rules.

**Extract:** `WalkabilityFactorWeightRow` and `WalkabilityFactorControls`, receiving
options, weights, visible factors, and change callbacks. Share the option rows
as well; compose each page's collapse/reset/direct-control UI around them.

**Ownership:** an app-level walkability feature directory, shared by MISC and
Index Lab. The 44-factor report catalog and its rules are domain-specific and
should not become defaults in the generic toolkit. A generic weight-row visual
may use existing toolkit controls underneath.

## Adopt existing shared components

| Priority | Repetition and evidence | Recommendation |
| --- | --- | --- |
| High | MSP builds facility buttons and renders `filteredFacilities.slice(0, 80)` in [`DevHealthMsp`](../src/pages/DevHealthMsp.tsx). Climate vulnerability and early learning also build their own searchable area lists. | Adopt `ResultRow`, `ListHeader`, `ListState`, and `VirtualResultList`, with `SearchInput`. MSP currently makes only the first 80 matching facilities available in its sidebar while its count covers all matches; virtualization would make the full list reachable. Use the existing food-map / PG transit list composition as a reference. |
| High | Ordinary static JSON loads in [`DevWait`](../src/pages/DevWait.tsx), [`DevWaitSpecialist`](../src/pages/DevWaitSpecialist.tsx), and `useLocalJson` in [`DevEarlyLearning`](../src/pages/DevEarlyLearning.tsx) repeat fetch/loading/error/abort state. | Adopt [`useFetchData`](../src/hooks/useFetchData.ts) with small source-specific transforms and error presentation. It already supports deduplication, retries, optional data and fallback URLs; `pgdata/shared.ts` already delegates its manifest loader to it. Preserve local-development gating and request-key behavior. Keep portal sessions, streaming, workers and live polling in their specialized loaders. |
| Medium | Climate vulnerability draws its legend container, swatches and break labels by hand in [`DevClimateVulnerability`](../src/pages/DevClimateVulnerability.tsx). Other apps use the shared legend family. | Reuse `MapLegendPanel` / `MapSteppedLegend` or toolkit `ScaleLegend`. Adapt the existing scale and exact break conventions into the legend; do not change classification or the comparison population as a presentation cleanup. |
| Medium | Native checkbox rows and custom toggle helpers recur in Design Lab, LiDAR, Nechako, network controls and engineering sidebars. | Use `ToggleRow` for layer on/off actions and `FilterChipGroup` / `SegmentedControl` for their respective selection patterns. Keep native checkboxes for actual form values, acknowledgments and table editing; a button toggle is not universally equivalent. |
| Low | [`PortalChecks.JsonResults`](../src/maps/nechako/PortalChecks.tsx) and [`PortalMonitoringImport`](../src/maps/nechako/PortalMonitoringImport.tsx) each implement previous/next paging controls. | Adopt [`PaginationControls`](../src/components/ui/pagination-controls.tsx) and, where appropriate, `usePagination`. Retain JSON-preview and monitoring-table bodies locally. |

The existing sidebar, dialog, mobile feature-card, chart, timeline and workspace
families already cover much of the app. Their repeated use is successful reuse.
There is little value in adding a new universal sidebar or generic map-app shell.

## Further shared behavior

### Clipboard feedback and fallback — high value, small extraction

`DevFlatten`, `DevTransit`, `DevOutdoors`, `DevDesign`, AVAST, Index Lab and
`DatasetInfo` each manage some combination of copying, success state, timeout and
fallback. There is already a small
[`useCopyText`](../src/pages/dev-acknowledgement/hooks/useCopyText.ts) hook, but its
fallback message is specific to acknowledgment drafts.

Promote a generic `useClipboardText` / `CopyButton` with idle, pending, copied
and failed states, timeout cleanup, and a caller-supplied fallback. Keep URL
construction, compression, validation and the text being copied with the caller.
In Outdoors, encoding and clipboard writes share one catch block, so clipboard
denial currently produces the “plan is too large” message. Separate those failure
paths when adopting the hook. AVAST's TSV copy and `DatasetInfo`'s fallback must
retain their specialized behavior.

### Map viewport subscriptions and fitting — medium value

Repeated bounds/zoom subscriptions appear in
[`DevBoundaries.TrackMapBounds`](../src/pages/DevBoundaries.tsx),
[`dev-data/MapBehaviors`](../src/pages/dev-data/MapBehaviors.tsx),
[`AirQualityMap`](../src/maps/airquality/components/AirQualityMap.tsx), and the wait
maps. Fit/focus components recur in early learning, climate vulnerability,
fallout, water temperature and acknowledgment previews.

Consider a narrowly scoped `useMapViewport` / observer component. Reuse the
toolkit's existing `pointBounds`, `fitMapToPoints`, and geometry-bounds helpers
before adding another bounds calculator. Keep fitting trigger, padding, max
zoom, animation and minimum span explicit: fitting all stations and focusing a
selected polygon need different policies. Do not route per-frame rendering,
terrain cameras or canvas drawing through React viewport state.

### Nechako workspace/session orchestration — medium value, domain-local

[`DevNechako`](../src/pages/DevNechako.tsx) and
[`DevNechakoPortal`](../src/pages/DevNechakoPortal.tsx) duplicate the workspace
state plus the session-change callback that clears session-bound data while
retaining the camera and emitting the same warning. Both already reuse the
portal's presentation components and `usePortalSession`.

Extract a local `usePortalWorkspace` around that shared lifecycle. Share further
workspace actions only when their behavior matches. Keep each page's routing,
initialization and layout distinct. This belongs under `maps/nechako`, not in the
generic toolkit.

### LiDAR WebGL lifecycle — real duplication, lower priority

[`buildingMesh.ts`](../src/pages/dev-lidar/buildingMesh.ts) and
[`treePointLayer.ts`](../src/pages/dev-lidar/treePointLayer.ts) duplicate shader
compilation/linking, interleaved vertex-buffer setup, matrix upload and resource
cleanup. A local renderer helper could accept shader sources, vertex data and
draw mode. Preserve their separate geometry/color builders, point-size logic and
triangle/point rendering. This is rendering infrastructure rather than a React
component; it needs browser/WebGL validation if extracted.

## App coverage and likely consumers

This inventory records where the findings apply, rather than asserting that
every app needs a refactor.

| App or family | Assessment |
| --- | --- |
| Home, Labs, Dev Library, Forestry landing | Navigation/catalog pages. `DevCard` is already shared; retain each catalog's own entries. Lower priority than interactive controls. |
| Food Map | Strong existing sidebar/list/dialog composition; use as an adoption reference. Inspection history and roulette remain local. |
| Air Quality | Shared map, legends and responsive details already present. Viewport observation is a potential small extraction. |
| Explorer | Shared workspace and feature components already present. Keep report and source orchestration local. |
| PG Data: Crime, Parks & Trails, Transit | Existing shared list/legend/timeline primitives. Transit is a good full-list reference. Keep crime and transit calculations separate. |
| MISC: Heat & Shade, CANUE, Census, Network, EV, ICBC, WARS, Litter, Walkability, Water, Flood, Drought, BCER, Remediation, ParcelMap | Existing shared manifest hook, map primitives and many responsive cards. Walkability controls are the strongest new extraction. Extend adoption per tab without unifying all dataset controllers. |
| Index Lab, Density Lab, Correlation Lab | Already one route component/pipeline with separate lab state. Generic Index Lab is package-owned. Share the walkability control presentation; retain distinct calculations and host catalogs. |
| BC Assessment | Existing sidebar, timeline, legend, detail-card and sparkline components. Keep assessment history and aggregation local. |
| Projects and project details | Workspace, explorer, scene-story and editorial renderers already have explicit sharing boundaries. Preserve them; no second project framework is needed. |
| LiDAR: canopy, trees, forestry, species, buildings, transects, compare, volume, inventory | Already shares a controller, sidebar and map building blocks. Forms and the mesh/point WebGL lifecycle have remaining duplication. Preserve tool-specific analyses and review state. |
| Nechako showcase/research interface and portal interface | Shared portal components are established. Extract duplicated workspace/session lifecycle and adopt form/paging controls. |
| Colour Palettes | Already uses sidebar, search and virtual results. Range fields can adopt common controls; keep palette semantics local. |
| Boundaries | Already uses shared study-area pickers and pagination. Candidate for field and viewport-observer reuse; source loading and topology policies remain local. |
| BCER raw/optimized comparison | Existing shared map, statistics and dev header. Comparison metrics and topology checks are specific to this tool. |
| Climate Vulnerability | Strong candidate for form, searchable-result and legend adoption. Retain its PCA/reproducibility and FSA join policies. |
| Early Learning | Candidate for form, result-list and static-loader adoption. Preserve release gating, crosswalk evidence and suppression semantics. |
| Design Lab | Local `Field` and `ToggleRow` helpers overlap shared controls. Map-editor components and shared basemap-style builder are already reusable. |
| Loading Screen | Already a consumer of the shared map loader. Keep it a preview/configuration page. |
| Data Table | Reference implementation for layer lists, feature schemas, import and responsive details; preserve reuse. |
| Interaction Lab | Specialized interaction prototype with its own sheet reducer and gesture suppression. Do not merge into production sheet behavior without matching its interaction contract. |
| Sewage Sites | Shared map/sidebar/popup/statistics already used. Keep proportional-circle meaning and source-specific legend content local. |
| ER Wait and Specialist Wait | Extract the duplicated screen-space clustering; adopt common static loading. Retain distinct statuses, marker content and expansion behaviors. |
| MSP Payments | Highest-priority result-list migration because of its first-80 sidebar cap. Keep fiscal-year payment calculations local. |
| Fallout | Shared sidebar, popup, controls and statistics already used. Consider common map-fit behavior only; retain historical data semantics. |
| Forestry Road Design | Start form extraction here, preserving draft/nullable behavior. Resizable panes, readouts and engineering tables are already shared. Keep terrain, routing and costing engines separate. |
| Forestry Visual Quality | Adopt form controls. Keep five-step VIA state, camera and analysis contracts local. |
| CCISS Suitability | Existing categorical raster and shared controls. Candidate for remaining native-field consistency; reports and raster sampling stay local. |
| AVAST Volume | Adopt common nullable numeric fields and clipboard mechanics. Preserve workbook/geodatabase and volume rules. |
| Acknowledgment | Existing reusable feature components and local copy hook. Promote only generic clipboard behavior; retain evidence and wording rules. |
| Network Coverage | Shared layer toggles and map primitives already exist. Provider-specific raster/vector transport remains local. |
| Viewshed and Local DEM Tools | Common form/range controls can help. Shared terrain-viewshed feature already exists; preserve distinct sources and analyses. |
| Transit Travel Times | Existing list/search primitives. Share copy feedback and common controls; routing, geocoder and travel-time logic remain local. |
| Flatten: PG and San Francisco | Already one component parameterized by city. Share copy feedback and common fields; local street-index search is distinct from live BC address lookup. |
| Outdoors Planner | Adopt clipboard feedback and common fields. Preserve plan serialization, import validation and drawing lifecycle. |
| Water Temperature | Chart primitives are already package-owned. Form and map-fit helpers are candidates; retain calendar, coverage and station-selection rules. |
| AQMap: default, main, ring | Already one route family. Keep shared controls and layers; forms and viewport mechanics can reuse smaller primitives. Do not merge its transport/rendering into the other air-quality app solely because the domain overlaps. |

## Suggested implementation order and verification

1. Extract the walkability factor rows and wait-map clustering in separate,
   focused changes. Both have two clear consumers and bounded contracts.
2. Establish common form-field contracts using road design, visual quality and
   AVAST as consumers. Verify partial input, empty/null, bounds, step, keyboard
   editing, hint naming and touch sizes before migrating more forms.
3. Replace MSP's capped list with a complete virtualized list; then migrate
   climate/early-learning result lists and the hand-built climate legend.
4. Promote clipboard feedback and adopt existing JSON loaders. Check clipboard
   failure separately from serialization, and check abort/retry/URL changes.
5. Extract the Nechako lifecycle and viewport observer only within their proven
   overlap. Leave the WebGL helper for a dedicated rendering change.

For cluster extraction, verify membership/order, filtering, viewport changes,
coincident coordinates and each map's expansion behavior. For walkability,
verify both consumers show the same factor values and preserve dropped-factor
rules. For list changes, verify matches beyond the former cap can be selected
and map selection still follows them.

Generic toolkit changes follow the existing standalone-package checks and
submodule workflow in `toolkit-extraction.md`; domain-local changes remain in
PG Maps. The original audit was a source review. Its recommended extractions and
adoptions, including the LiDAR helper, are now implemented; the
[implementation record](shared-component-implementation.md) documents the final
scope, compatibility policies and validation results.
