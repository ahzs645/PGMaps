# Forestry driving preview validation

## Roadside cutblock comparison

Use **Try sample drive** from the main setup panel. Terrain and candidate viewpoints are prepared automatically; playback becomes available when the camera ground and forest are ready. This explicitly hypothetical 11.5 ha opening sits to the right of a 1.2 km illustrative route on real Tabor-area terrain. The landform boundary is also illustrative; no real harvest proposal or verified field condition is implied.

- The preview starts at **200 m**. Play or choose **Replay approach**: the opening begins at about **350 m**, runs alongside the road until **850 m**, then roadside trees close the forward view again.
- Choose **View opening** to pause at **600 m**, facing into the cutblock. **Before harvest** fills the proposal with the illustrative stand; **After harvest** removes only the proposal's trees and shows exposed ground and the remaining forest edge. Both buttons pause playback, preserving the eye position and viewing direction.
- The ordinary **20 m road clearance** is retained. No global widening or elevated camera is needed for this demonstration. Return to **Look along road** to continue driving, or drag to inspect the opening's edges.
- The before/after controls also work with other loaded or drawn proposals. Existing openings remain as supplied; the generated forest outside proposals retains the same geographic seed across comparisons.
- **Analysis overlay** is off initially so the forest change is readable. Turning it on reveals assessment geometry. Analysis percentages always describe the assessed proposal at the nearest calculated station; switching the picture does not recompute a before-harvest assessment or measure visible screen pixels.

Live Chromium inspection confirmed the opening appearing on the right during forward travel, the broad opening versus screened forest at the same 600 m viewpoint, and roadside timber closing the view after 850 m. The comparison regression also checks actual camera equality, changed near-tree counts, unchanged analysis output, and replay controls. A pure placement regression verifies that every retained stem outside the proposal has identical attributes before and after.

## Everyday preview workflow

1. Choose **Try sample drive**, or **Start with my site** and draw/import a road and cutblocks. GeoJSON and zipped shapefiles are accepted. A multi-line road import uses the longest line and says so; prepare a single continuous route when that choice is unsuitable.
2. Select **Preview drive**. Progress and cancellation are available during preparation; failed preparation exposes **Retry preview**. This does not confirm any assessment assumptions.
3. Use **Play/Pause**, driving speed, the route slider, and **Before harvest / After harvest**. Drag or use arrow keys to look around. **Hide options** collapses comparison controls while leaving route position and playback reachable. The principal controls stay in the map; on a phone, setup expands, drawing/drive collapse the sheet, and finishing/exiting restores setup.
4. Open **Viewpoints, save & display** to choose up to three separated candidate viewpoints. They rank apparent visible ground area from the existing analysis, not tree-screened image pixels. A ground sightline can still be screened by timber.
5. **Save viewpoint** preserves route position, target or forward direction, look offset, tree height, road clearance, and harvest phase. Up to 12 views are retained for the current scenario. The previous saved preview remains reopenable when switching sites, until another preview is saved. **Download preview** and **Open saved preview** move the geometry and views between browsers. Live terrain and inventory are reloaded; this is not an offline snapshot.
6. **Download image** exports the map frame with route position, harvest phase, an illustrative-use caption, and attribution. Save paired before/after frames at the same viewpoint for a visual comparison.
7. **Display quality** offers default, detailed, or faster trees. Default monitors frame times and suggests pausing or choosing Faster after sustained slow playback; it never swaps geometry mid-drive. Detailed uses three fixed silhouette planes per foreground stem; Faster uses two. The analysis is unchanged.

Assessment inputs, worksheets, and provenance remain under **Advanced assessment & settings**. **Data & assumptions** in the drive explains the rendered scene. The simple preview does not promote an illustrative run into a validated assessment.

## Dynamic existing forest

Open any road preview, then **Viewpoints, save & display → Existing forest and regrowth** (the checkbox is **Load existing forest for this route**). Three DataBC lookups run automatically before the illustrated forest is ready. The panel separates recorded heights, projected heights, planting estimates and harvest-age estimates, lists missing/partial sources, and provides retry. **Height sources and dates** shows reference years and heights. Change **Assumed height growth** or **Regeneration delay** to explore the uncertainty, then save a viewpoint to retain those assumptions.

The initial estimate is 0.3 m plus 0.35 m/year, with a two-year lag when only harvest age is known and a cap at the regional stand height. This is an editable illustration, not a calibrated growth model; a harvest record does not prove planting. Older dated heights are projected with the stated annual-growth assumption, retaining their original height/date in the provenance list. Turn off **Project older heights to visual year** to use the recorded values unchanged. An undated height stays unprojected. The detail contract describes overlap priority, missing data, partial harvests and query limits.

Live service checks in the Tabor area returned harvest years/clearcut shares, planting-completion timestamps/species, and RESULTS heights/reference years. Unit tests check actual generated tree heights, newer-harvest precedence, planting footprints, partial retention, no trees during the lag, unknown/future records, projection of old seedling records with preserved source values, deduplication, source caps/failure, and saved assumptions. Browser acceptance checks cover automatic loading, partial service failure/retry, changed estimates, nonzero rendered trees, and unchanged assessment inputs.

Primary source schemas: [harvested areas](https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/4), [RESULTS planting](https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/20), [RESULTS forest cover](https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/27).

## Repeatable Tabor Mountain scenario

1. Open `/dev/forestry/visual-quality` with the default Tabor Mountain sample (9.51 km road).
2. Review the scenario assumptions and run visibility.
3. Select **Look from the road**. Leave eye height at **1.6 m**, **Look along the road**, and **Stable silhouettes** enabled.
4. Play, pause, and scrub along the road. Nearby silhouettes should keep the same representation as you approach and pass them; the eye should follow the terrain, and turns should blend without moving the eye off the supplied road line.
5. At about **3 km**, play through **4.44 km**, then pause and look around. Roadside trees should retain their positions as forest tiles change.
6. Compare **Stable silhouettes** with **Billboards**, change the cleared road width, and select **Face Block A — west face**. A target can still be obscured by foreground terrain or trees; facing it does not guarantee visibility.
7. Return to the map. Normal camera controls should return and the preview forest should be removed. On a phone-sized viewport, playback controls must remain above the collapsed sidebar sheet.

## Verification completed

- TypeScript project checking and a production Vite build passed.
- Forestry Vitest suite: **354 tests across 23 files passed**, including preview-file round trips, invalid saved poses/polygons, viewpoint ranking, sustained-frame performance adaptation, terrain readiness, camera placement, angle wraparound, stable forest patches, missing elevations, clearing exclusion, procedural mesh validity, and the roadside comparison.
- Forestry Playwright coverage: **22 tests passed** across the visual-quality and integrity/export specs. Two legacy text locators were made specific to their intended panel after the simple workflow introduced matching labels. New coverage includes simple preview startup, saving/restoring exact viewpoints, PNG/JSON downloads, reopening files, cancellation, failed-data retry, and phone setup/drawing/playback. The comparison also passed a separate **live-terrain run**, checking unchanged camera and analysis output through both harvest phases. Desktop and phone-sized layouts are covered.
- Browser assertions inspect actual terrain and custom-layer state, including nonzero near-tree instances, coverage beyond 10 km, shader error status, billboard fallback, and layer cleanup. These controlled acceptance tests use a flat DEM and stubbed inventory; they do not validate live datasets.
- An additional local browser run used real Tabor Mountain terrain, driving from approximately 3 km to 4.44 km. At 3 km, the shared DEM reported 678.989 m and MapLibre reported 678.992 m. No WebGL errors were observed in that run. Short-range camera targeting preserved nearby geometry that the previous horizon-distance target clipped.

Commands (with a local production preview running and Playwright Chromium installed):

```sh
npx tsc -b --pretty false
npx vitest run src/pages/dev-forestry
npx vite build --outDir /tmp/pgmaps-drive-build
npx vite preview --outDir /tmp/pgmaps-drive-build --host 127.0.0.1 --port 42174 --strictPort
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42174 npx playwright test tests/e2e/forestry-visual-quality.spec.ts tests/e2e/forestry-integrity-export.spec.ts --workers=1
```

To repeat just the comparison against real terrain and inventory, set `PGMAPS_FORESTRY_LIVE=1` and use `--grep "compares a roadside"` with the visual-quality spec. This opt-in run depends on live services; ordinary acceptance runs use controlled fixtures. It saves `cutblock-before.png` and `cutblock-after.png`.

For a nondefault installed browser binary, set `PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH`. The tree acceptance test saves `forest-hybrid.png` in its Playwright output directory.

## Scope and references

The preview remains illustrative: the road surface is a buffered route, tree positions are generated, and distant cards represent canopy groups. Species and heights use surveyed stands where available, with a regional fallback elsewhere. The DEM does not resolve a surveyed road surface; photographic matching and field validation are separate work. Browser validation here covers local Chromium and an emulated phone viewport, not physical mobile-device GPU performance.

The implementation uses MapLibre's public camera helpers and its own projection matrix for the custom forest layer. It introduces no third-party vegetation assets or runtime dependencies. Useful references for future refinement:

- [MapLibre first-person camera example](https://maplibre.org/maplibre-gl-js/docs/examples/walk-around-a-map-in-first-person/): camera placement using a nearby target.
- [MapLibre models on terrain](https://maplibre.org/maplibre-gl-js/docs/examples/adding-3d-models-using-threejs-on-terrain/): terrain-aware custom rendering.
- [EZ-Tree](https://github.com/dgreenheck/ez-tree): procedural tree-generation reference.
- [InstancedMesh2](https://github.com/agargaro/instanced-mesh): reference for instancing, culling, and level-of-detail techniques.
