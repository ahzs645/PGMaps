# Forestry visual quality: integrity, road camera and PDF export

Implementation contract for `/dev/forestry/visual-quality`.

This is a **scenario-screening tool**. The numerical model is not a calibrated photographic assessment, field observation, completed VIA, or determination of legal VQO achievement. This contract supersedes the older forestry document where the descriptions disagree.

## One run, one active assessment landform

`ForestryScene.activeLandformId` selects the assessment unit. One sole landform may be inferred for legacy scenes; multiple landforms require an explicit choice. Other landforms remain in the scene but do not contribute to the selected denominator. Adopting or drawing a landform selects its actual new target ID. Removing the selected landform clears its selection.

A VLI sensitivity unit is a **candidate boundary**, not automatically the landform required for each viewpoint. The supplied May 2022 Visual Impact Assessment Handbook, pp.16–19, distinguishes them. Separate landforms or VQO sub-units must be assessed separately; batch multi-landform analysis is not implemented.

`sceneInput.ts` is the sole worker-input builder. A canonical input record and a separate scene fingerprint bind geometry, settings, year, active unit, objectives and report labels to the run. The fingerprint is an equality check, not a cryptographic signature. The PDF adds a SHA-256 of the saved numerical inputs for identification, not authentication.

Changing an assessed input hides old results, disables the road preview and assessed exports, and requires another run. A slow worker result from an older scene cannot be presented as the current scene. Office report metadata may be edited without re-running geometry; it is explicitly recorded as supplied metadata.

## Shared-area accounting

The active landform has one ground-sampling ledger. Existing openings, proposed polygons and outside-opening roads are evaluated at its same sample positions and weights. This clips contributions to the landform and avoids adding independent, overlapping polygon grids.

At a ledger point, existing alteration is the maximum contributing existing weight. A full-clearcut proposal contributes the remaining fraction, `1 - existing`. Roads count on FS1252 line b only outside current opening footprints. Duplicate proposed or existing features do not double the cumulative total.

Fractional existing-opening weights are **area/recovery assumptions**; they do not locate actual leave patches. Using the maximum overlapping weight is a declared union convention for such unresolved fractions, not proof of their actual spatial overlap. Supplying geometrically explicit boundaries is preferable.

A 40%-weighted opening under a new full-clearcut proposal therefore contributes 40% existing plus 60% proposed at that shared location. An opening outside the landform cannot subtract area inside it. The per-block visible hectares are descriptive and must not be added to reconstruct cumulative alteration.

The green base combines available treed inventory with supplied forest-alteration footprints, including forest roads. The operator must exclude natural non-forest ground and review the assumed pre-alteration land base. This is not a complete implementation of the Handbook's private-land, natural non-green and permanent non-forestry disturbance rules. An explicit whole-landform-green scenario assumption is available and travels into the PDF. No complete inventory means no verified denominator by default.

## Perspective geometry, resolution and uncertainty

The ground-to-surface conversion is `surfaceArea = horizontalArea / normal.z`. Apparent area then uses positive front-facing incidence over distance squared. Back-facing facets do not gain apparent area through an absolute-value operation. Normals use the DEM sampling interval, not the coarsened polygon grid spacing.

The result remains a solid-angle integration approximation. It does not implement exact photographic pixel masking, calibrated camera HFOV/focal length, analytic visibility of entire facets, or terrain-mesh/photograph validation. Grid spacing is not the native DEM accuracy.

The headline station maximizes the available **cumulative perspective ratio**. `largestVisibleAreaStationIndex` separately identifies the most visible proposed hectares. Neither automatically establishes public significance. The user chooses viewpoints for export.

The actual sightline count is capped at 250,000. Grids are coarsened to meet the cap; grids cannot substitute bounding-box-centre samples outside their polygons. A thin alteration missed by the shared ledger is flagged where its own sample grid detects intersection. This diagnostic is not an exhaustive geometric intersection test: convergence checks and explicit polygon clipping remain useful future validation work.

Largest ground-cell percentage is reported as a resolution diagnostic, **not an error bound or confidence interval**. Two decimal places in diagnostic data do not confer corresponding accuracy.

## Data completeness is not a yes/no visibility result

Sightline outcomes distinguish visible, occluded, unknown and out-of-range. Stored visibility matrices use 0 for not visible, 1 for visible and 2 for unknown. Known terrain obstruction can establish occlusion even when another profile sample is missing; otherwise missing required elevations remain unknown.

The elevation mosaic no longer averages remaining corners across a missing bilinear interpolation cell. Reverse road search refuses a result with missing DEM tiles. Forward results carry source and uncertainty warnings rather than silently turning missing data into clear sightlines.

VRI query truncation and geographic clipping are retained. Failed harvest lookup preserves prior scene features and records unavailable evidence instead of replacing them with an empty inventory. A complete response to a bounded query is not proof that every disturbance in the real landscape is represented. Explicit scenario completeness confirmation covers the supplied scenario only.

Numerical PDF entries are withheld when the active unit, green base, existing-disturbance evidence or required terrain/surface result is incomplete. Nonzero target offsets also withhold them because those rays are not to the cut surface. Ocular/final decisions are never inferred from a numerical-readiness flag.

## Green-up, partial cutting and timber-supply context

Green-up height remains area-weighted over the 1998 Table 6 slope classes. It is not a lookup on mean slope. Recovery uses a supplied percentage where present; otherwise the editable age assumption applies. Neither is an automatic field observation.

`PERCENT_CLEARCUT` is not volume removed. Required green-up height is not actual residual-tree height. The exporter does **not** populate partial-cut equivalency from either proxy. Partial-cut fields remain blank pending actual supporting inputs. The FS1252 grid and the 2022 Handbook Table 6 are not silently replaced by the older merchantable-volume study's class table.

Planimetric thresholds are resolved in one place for the badge, explanatory text, lower bound and Markdown report. Explicit custom values take precedence, then VAC-specific 1998 Table 4 values. Missing VAC is labelled as a medium/mid-range planning assumption, not a verified site requirement. Custom values equal to legacy defaults cannot be distinguished from untouched defaults by the old schema; use an explicit threshold-origin field in a future schema if that distinction is needed.

The supplied December 2003 bulletin describes alternative timber-supply plan-to-perspective modelling. It is not applied a second time to directly modelled perspective ratios. The supplied 1998 Robson Valley study is not used to infer merchantable volume or harvest entitlement from visibility.

## Road view lifecycle

`driveMath.ts` follows every original road vertex. `driveController.ts` owns the camera and restores its earlier centre, elevation, zoom, bearing, pitch limit, clamping and enabled gesture states. React is a thin gesture/control adapter.

The camera and trees sample the same fixed preview DEM mosaic (`useDriveTerrain.ts`) and add the stated eye height. The complete road and assessment extent are prefetched with a 1 km margin, at zoom 14 or a coarser zoom needed to stay within 128 tiles (~32 MB). Missing elevations hold playback and omit trees; they never become sea level. This matters because `queryTerrainElevation()` can return **zero**, rather than null, for unloaded ground. Changing rendered terrain LOD must not move the eye or tree bases.

The eye remains on the original road vertices. A distance window across the bend supplies heading and grade, with time-based angular damping during playback. The camera uses `calculateCameraOptionsFromTo` with a **40 m target**, explicit target altitude and `roll: 0`. The rotation-only helper's kilometre-distant horizon target makes MapLibre's near clipping plane cut off the road and nearby trees, even when the eye altitude is correct. Non-finite camera results are rejected before `jumpTo`; there is no use of private camera internals.

Paused and unchanged poses do not repeatedly reposition the camera. Drag/arrow controls adjust yaw and tilt. R resets look; Escape returns to the map; Space toggles playback. Hidden tabs pause. Playback reports the actual moving eye to the forest patch while visibility colours use the nearest precomputed assessment station. The latter is labelled as a sampled result, not recalculated continuously.

Before/after harvest is a **visual comparison only**. Both controls pause at the same camera pose. Before fills proposed blocks with the illustrative forest; after removes their trees and draws exposed ground. Existing-forest context and the road clearing remain consistent in both phases. Forest placement uses the route's fixed anchor latitude so rebuilding at a different drive position cannot move retained stems. Numerical inputs/results are unchanged, and the on-screen text says so. Analysis colours are opt-in while driving; they are not evidence that a block is visible through the rendered trees. The roadside demonstration is explicitly hypothetical geometry on real terrain, with no verified harvest or landform claim. Its scripted approach/opening/exit cues apply only to that preset.

Terrain exaggeration is fixed to 1x for the preview. Existing 3D trees retain the MapLibre custom layer; no deck.gl camera or third-party tree assets are introduced. Preview opens facing along the road with illustrative trees enabled. `forestPatches.ts` anchors tiles to fixed geographic coordinates for the entire preview, including across latitude bands. Patches generate progressively with a 5 ms per-frame soft budget; retained tiles keep their stems and elevations, and GPU bands only re-upload when their tile membership changes. Foreground trees use three fixed crossed silhouette planes per stem (two in Faster/Billboards) and remain fully present from the eye through 550 m. There is no extra close mesh or representation swap: additive branches previously changed the outline and introduced dotted fades at 60–100 m. Slow-frame detection advises pausing or choosing Faster; it does not change trees during playback. A 200 m tile-loading guard surrounds each visible band, beyond the 75 m membership-update distance. Middle and distant instances represent canopy groups. Coverage follows the scene extent, capped at 20 km; nothing grows outside the loaded DEM. These groups are **not** a stem inventory or a vegetation-transmission model.

`treeLayer.ts` translates the map's projection matrix to a local origin in double precision before sending float offsets to the GPU, avoiding eye-level coordinate jitter. Detail bands reject out-of-range geometry and render nearby geometry first. All GPU buffers are released on removal. A coloured, illustrative road strip and a temporary base-ground tint improve the drive view; the tint is restored on exit, and mapped water/land-cover layers keep their own styling. Recovered and fractionally cleared existing polygons are not silently rendered as full clearings. The illustrative road-clear width changes only the picture, not numerical screening. Stand placement remains illustrative, and a roadside buffer is not an actual clearance survey.

Existing forest is loaded automatically for the fixed route/target footprint plus a 3 km margin (`useForestHistory.ts`), never from the horizon camera centre. The live sources are consolidated cutblocks (layer 4), RESULTS planting (20), and RESULTS forest-cover inventory (27). Each query is capped at 1,000 raw records, generalised to approximately a few metres, with a 20-second timeout and at most four five-minute cache entries. Oversized extents are clamped and marked partial. Aborted/replaced requests cannot apply to a different route. Failed sources retain the other successful sources and expose a retry; counts describe records, not geographic completeness. This is local live context, not a shipped dataset or an offline snapshot.

`regrowth.ts` resolves overlapping records newest-first, with recorded height winning ties over planting, then harvest. With **Project older heights to visual year** enabled (the preview default), a dated height is advanced by the same explicit annual-growth assumption and labelled **height projection**, with the original height and reference year retained. Disable it to show recorded heights without ageing them. An undated height cannot be projected. The cap never reduces a recorded height already taller than the regional assumption; new harvest/planting records still take precedence over old surveys. A newer harvest or planting record supersedes an older height inside its own polygon. Planting rows are deduplicated per treatment unit (species from the largest reported row), and a treatment date is never applied to an entire opening merely because IDs match. Unknown dates/heights/clearcut shares remain unknown. Future events are excluded for the visual year.

Where a height is absent, the renderer can assume 0.3 m at planting/regeneration plus **0.35 m/year**, capped at the regional stand height; both the annual gain and the default **two-year regeneration delay after harvest** are visible, adjustable scenario assumptions. During the delay a fully cleared opening stays bare. This linear illustration is **not** TIPSY, VDYP, a site-index growth curve, a planting-survival model, or a field observation. Partial-cut percentage controls an illustrative mixture of young and mature stems, not a validated spatial retention pattern. Supplied existing-harvest polygons receive the same visual age treatment; permanent site disturbance and the road remain clear. Proposed before/after harvest still wins over every existing-forest record.

Automatic history loading and these growth settings never edit scene targets, confirmation flags, numerical screening or assessment results. To count recorded harvest areas in an assessment, use the existing explicit inventory-adoption workflow. Saved viewpoints preserve the forest-loading/projection toggles and growth assumptions; live records are queried again when reopened. The provenance controls list height bases and reference dates. Device performance and the visual growth assumptions still require field validation.

A 110-degree pitch ceiling permits uphill views above the horizon; high-pitch MapLibre rendering remains experimental. Actual desktop/mobile/GPU and loaded-terrain verification is required before calling this preview reliable. No HFOV/photo calibration is included. A calibrated rendering path is still needed for photographic VIA equivalence.

## FS1252 PDF contract

The supplied `fs1252-vqee (1).pdf` is a non-fillable four-page **FS1252 2008/04 monitoring form**. The normalized copy is bundled at `public/forms/fs1252-2008-04.pdf`. Its exact SHA-256 and PDF object structure are pinned in `pdf/templateManifest.ts`.

`pdf/fs1252.ts` appends ordinary vector/text PDF content and an incremental cross-reference section to this **one verified template**. It is not a general PDF parser or a mechanism for filling arbitrary PDFs. Wrong template bytes fail before writing. It uses browser-native APIs and adds no runtime dependency. HTTPS/localhost secure-context Web Crypto is required by the browser export.

The generated PDF contains one stamped first page per selected station (maximum 30), the original three reference pages once, scenario provenance/assumptions, viewpoint calculations, and a basic vector geometry diagram. It also embeds `pgmaps-scenario.json` containing numerical inputs, source-status flags, selected viewpoint results, target labels, supplied office metadata and review inputs. That record does not contain the DEM tiles or a full timestamped VRI snapshot; completely offline reproduction still requires the same external data or an explicit saved elevation source.

Automatically populated values include the selected landform/VAC/scenario objective, known office metadata, modelled station coordinates/elevation/bearing/distance, and supported a/b/c/X/numerical-class values. Scenario objective is explicitly labelled; no establishment date or field visit is invented. Model bearing/distance use the landform bounding-box centre and require review for irregular landforms.

Optional reviewer inputs include exactly the **five design observations printed on this historical FS1252**, plus roads and retention. Only a complete set produces `Y` and `X*(1 + 0.14*Y)`. Retention already netted from geometry receives no second discount.

Photography, field date, actual partial-cut measurements, ocular assessment, final EE rating, override and signature remain unfilled. The May 2022 Handbook summary is a different form with six design components; it is not silently substituted. The original reference-page definitions are historical, not a current legal opinion.

Output is a **stamped PDF**, not newly created editable AcroForm fields. Unknown fields can be completed with a normal PDF annotation tool. Form text supports Latin characters; unsupported metadata fails explicitly, rather than corrupting the PDF. The embedded JSON preserves source text. Longer office descriptions are shortened in tight form cells but retained in the appendix/record.

The diagram is not a topographic map. No basemap screenshot, reference photograph, true visual simulation image or visual-force analysis is automatically attached. A complete VIA package still requires those relevant materials and professional review.

## Validation scope

The main sidebar provides a road/cutblock preview workflow and keeps the assessment controls in a collapsed advanced section. Automatic preview preparation calls the same analysis worker without setting any confirmation flags. Saved comparison files retain scene inputs and camera poses, not terrain/inventory snapshots or cached assessment results. Candidate viewpoints rank apparent visible **ground** area; foreground vegetation may still hide the opening. The PNG export is explicitly captioned as illustrative and is separate from the assessed PDF export. Slow-frame detection never changes tree geometry during playback.

For the current driving-preview checks, repeatable Tabor Mountain scenario, and live-versus-fixture coverage, see [Forestry driving preview validation](./forestry-driving-validation.md).

The implementation bundle includes deterministic tests of the new computation/controller/PDF modules, strict pure-module checking with labelled dependency interfaces, and synthetic populated-PDF examples rendered with two PDF engines. Local terrain/VRI dependencies in that test harness are fixtures, not a live-data audit. Existing full-repository tests, production builds and real MapLibre browser checks must be run in a full checkout. The bundle also supplies Vitest regressions using actual repository dependencies and a Playwright acceptance spec for that next verification step.


## Appendix 5 landform review and downloaded visual inventory

The main workflow defaults to finding visual sensitivity units near the whole supplied road polyline, including between vertices. Users may switch to the chosen proposed block’s bounding-box centre; that mode also serves single viewpoints. Candidates are ranked by distance to actual polygon edges, include unrated units and holes/multipart geometry, and are limited to 25 km. Road-to-boundary distances use exact segment intersections/closest approaches in local planar metres, with bounding-box pruning. Corridors exceeding 1.5° extent or 5,000 vertices must be split for this browser search; they are not silently reduced to their starting point. This is proximity ranking, not a visibility result. A containing search point is not proof that a polygon covers the whole proposal or is the correct visual landform. `Show boundary` previews it; `Use candidate` explicitly adopts/selects it. Re-adoption selects the existing target. No candidate changes the denominator until adoption. A distant candidate does not establish inventory coverage for the site.

VLI is now a full-resolution static snapshot owned by bcdatamapper, copied to `public/data/forest/visual-inventory`. The small index locates spatial shards; at most four fetch concurrently and eight shard promises are cached. Failed downloads can retry; stale suggestion requests cannot apply to a new anchor. Counts are validated before use, and partial shards are errors, not an empty inventory. The page exposes the snapshot date/manifest and a nearby GeoJSON download. The source's gaps, missing ratings, overlaps and seven invalid geometries remain. Harvest/RESULTS and VRI queries remain live; downloading VLI alone does not make terrain or the whole assessment offline. No Cloudflare Worker or R2 service is required for VLI.

`landformDesign.ts` adds separately labelled design-screening aids to the existing run, following the topics in the [May 2022 Handbook, Appendix 5 pp.55–56](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/visual-resource-mgmt/visual_impact_assessment_handbook.pdf#page=61). It does not calculate official design ratings or alter VQO thresholds, denominators, or FS1252 reviewer inputs. Proposed blocks continue to assume full harvest within their supplied boundary. Historical opening weights and visual regrowth keep their recorded inputs and explicit assumptions. No harvest-area, operability or timber-volume optimization is implied.

Local terrain cues compare four opposite pairs of neighbours 150 m away. Both neighbours at least 3 m lower indicate a convex/ridge cue, both higher a hollow cue, and competing axes a saddle. Missing elevations stay unknown. This is a scale-dependent engineering heuristic, not a geomorphon implementation, traced ridge network, or completed visual-force analysis. At most 2,048 landform positions and 4,096 proposed-block positions receive context sampling. The top third of sampled landform elevation is labelled upper elevation; it is not an official slope-position classification. Counts are sample counts, not area percentages.

Silhouette proximity reuses existing visible samples: 2° bearing bins, adjacent-bin maximum, and 0.5° vertical separation from the selected landform's sampled upper outline. It is not a background/canopy horizon calculation and cannot establish an actual skyline break. The panel and Markdown report state this; background terrain, canopy, resolution and field views require review. Exposed-view buttons pause at a sampled road station and face the relevant cutblock. Viewpoint counts are not exposure duration. Terrain clues and design outputs disappear with stale results.

Synthetic tests cover planar slope, ridge, hollow, saddle, missing context, and one road looking at a facing-slope block, crest-crossing block and hidden far-side block. Snapshot tests cover nearby-only shard selection, cache reuse, missing coverage, incomplete-shard retry and cancellation. Browser tests cover automatic suggestions, explicit adoption, download contents, repeated adoption, missing coverage, and the existing drive/export flows.


### Foreground continuity, speed and PDF access

The previous close-detail transition removed the billboard canopy before replacing its shape with thinner branch geometry. The shared stipple threshold could also leave gaps in both representations. Keeping the canopy while adding branches was insufficient: the second mesh still appeared on approach. The foreground now uses the same fixed crossed silhouettes throughout, with no additive close branch mesh. Their bearings depend on each stem and do not rotate with the camera. Distant canopy groups still use distance bands and are illustrative. Explicit changes to forest height, harvest phase or rendering mode intentionally redraw the scenario.

Preview speed presets span 5–120 km/h. Back/forward 10 m controls pause and seek, and the UI estimates remaining time at the selected speed. These are simulation speeds; posted limits are not loaded. Controller motion uses real elapsed time through frame intervals up to 500 ms, so a 5 fps device travels the selected distance rather than half speed. Longer stalls and recovery from missing terrain hold position instead of catching up with a jump. Hidden tabs pause as before.

The main sidebar includes `Fill / export FS1252 PDF`, which opens and scrolls to the existing assessment form. It retains the original template, readiness rules and distinction between calculated fields and supplied reviewer inputs. Browser verification fills an office-information field through this interface and confirms that text is present in the downloaded PDF.
