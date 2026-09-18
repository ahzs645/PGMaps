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

The camera samples rendered terrain at its moving position and adds the stated eye height. Unavailable terrain holds playback; it does not substitute sea level. Every helper call supplies `roll: 0`; non-finite camera results are rejected before `jumpTo`.

Paused and unchanged poses do not repeatedly reposition the camera. Drag/arrow controls adjust yaw and tilt. R resets look; Escape returns to the map; Space pauses. Hidden tabs pause. Playback reports the actual moving eye to the forest patch while visibility colours use the nearest precomputed assessment station. The latter is labelled as a sampled result, not recalculated continuously.

Terrain exaggeration is fixed to 1x for the preview. Existing 3D trees retain the MapLibre custom layer; no deck.gl camera or third-party tree assets are introduced. Recovered and fractionally cleared existing polygons are not silently rendered as full clearings. The illustrative road-clear width changes only the picture, not numerical screening. Stand placement remains illustrative, and a roadside buffer is not an actual clearance survey.

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

The implementation bundle includes deterministic tests of the new computation/controller/PDF modules, strict pure-module checking with labelled dependency interfaces, and synthetic populated-PDF examples rendered with two PDF engines. Local terrain/VRI dependencies in that test harness are fixtures, not a live-data audit. Existing full-repository tests, production builds and real MapLibre browser checks must be run in a full checkout. The bundle also supplies Vitest regressions using actual repository dependencies and a Playwright acceptance spec for that next verification step.
