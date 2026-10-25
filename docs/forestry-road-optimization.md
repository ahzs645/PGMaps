# Sketch-guided road corridor optimization

The Design sidebar's **Optimize sketched corridor** command uses the active road's endpoints and intermediate control points as a guide. Choose a half-width and Shortest, Balanced or Contour-friendly preference. Review the separate candidate before selecting **Use candidate as new road**. Cancel and Discard do not change the project. Download optimization report preserves inputs, source identity/checksum where available, screening limits, the sampled candidate, fitted control geometry and comparison metrics.

This is horizontal reconnaissance optimization, not a construction design or a commercial global-optimality claim. A contour-friendly route can still climb; its cost penalizes total elevation travel, not just the difference between the endpoints. Excess rise/fall is ascent + descent - absolute endpoint elevation difference. Lower values generally mean less redundant terrain climbing, not automatically better drainage.

## Geometry and connection to existing views

`corridorOptimizer.ts` searches bounded position/heading states using straight and constant-radius arc primitives separated by real tangent lengths. The exact endpoint connector is subject to the same checks as every other edge. Immutable predecessor records prevent a later state update from silently changing a previously checked path.

The result contains both sampled centreline coordinates and true tangent-intersection controls with radii. `corridorCandidate.ts` verifies the candidate with the existing road engine: fitted curve count/radii, length, and station-to-coordinate registration. The candidate uses the ordinary alignment schema, so map, profile, sections, 3D, schedules, saving and exports all share that geometry. Dense centreline samples are not misinterpreted as sharp road PIs.

The original road is preserved. Its station-bound vertical controls, culverts, material/template assignments and widenings are not transplanted to a different chainage. The new horizontal alternative starts with the original base template and no designed vertical profile. Design that profile and inspect earthworks in the connected workspace.

## Screening rules

- Exact endpoints; sketches contain 2–100 distinct consecutive points, endpoint separation 10 m–5 km and total guide length at most 15 km, with every guide point within a 7 km planning area of the start. The guide is a buffered corridor, not a list of mandatory waypoints.
- The road-wide grade limit must be 1–30 % and the minimum radius 5–1,000 m; outside those ranges the optimizer refuses to run (`corridorOptimizer.ts`).
- Sampled ground grade is a hard limit at intervals no greater than 1 m, including the endpoint connector. There is no hidden multiplier. Optional core API fields support separate uphill/downhill limits. Ground grade is not formation grade and finite sampling is not proof about the entire continuous surface.
- Missing elevations are rejected. The native terrain sampler remains the source; rendered terrain LOD, contours and interpolated missing values do not substitute for it.
- Supplied exclusion polygons, holes and line barriers are checked geometrically, including boundary and collinear contacts and thin features between samples. Optional exclusion clearance is an explicit planning input, not a statutory buffer. The UI defaults to centreline exclusion only; the full constructed footprint requires section review.
- Supplied stream features carry a relative penalty and a review warning. Reported contacts count distinct features touched, not permitted or hydraulically assessed crossings.
- Search is bounded by state, sample and geometry-operation budgets. Geometry work includes guide/corridor checks even without exclusion layers; reaching that budget calls for a narrower corridor, a shorter/simpler guide or cropped constraints. It can return a clearly labelled budget-limited, verified candidate. Failure means no candidate was established under this search, not that no buildable road exists.

The cost balances horizontal length, squared sampled grade, total absolute elevation movement, curvature, guide deviation and stream contacts. Weights differ between preferences; costs are relative and must not be displayed as dollars. Position/heading discretization and bounded search mean no global-optimality guarantee. No cut/fill costs, material geology, slope stability, watercourse sizing, sight distance or traffic suitability are inferred by this horizontal search.

## Sources and design judgement

BC Ministry of Forests, _Engineering Manual_, May 25, 2026, Tables 2-1 and 3-5 and section 3.5.2.3:
https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf

The manual's suggested alignment controls depend on width, speed, operating direction, conditions and professional judgement; they are not one universal grade limit. The May 2026 table gives 10% sustained favourable / 7% sustained adverse at 50 km/h, not the older 8% / 6% pair quoted in the initial discussion. It also discusses deliberate rolling grades and grade breaks for drainage. The optimizer does not force a monotonic formation grade, or encode these suggestions as legal approval.

FAO, _Forest roads: planning and construction_ (planning considerations):
https://www.fao.org/4/t0099e/T0099e02.htm

Use terrain, unstable areas, drainage, crossings, environmental constraints and field reconnaissance together. A low-cost route on a bare-earth DEM alone is not a complete road-location decision.

## Reproducible verification

`corridorOptimizer.test.ts` covers determinism, exact endpoints, fitted geometry in the actual engine, corridor containment, thin exclusions, boundary/collinear contacts, clearance, no-data, endpoint cliffs, strict grade limits, stream contacts, independent profile metrics, a synthetic mound tradeoff, input/budget checks, cancellation and rejected malformed geometry.

`forestry-road-optimization.spec.ts` exercises the real application: review/report, explicit adoption, shared map/profile/section station, actual MapLibre layers, undo/redo, reopen, discard, cancellation and phone containment. Screenshots are captured as CI artifacts rather than generated mockups.

The live suite is separately enabled with:

```sh
PGMAPS_ROAD_NATIVE=1 npx vitest run src/pages/dev-forestry-roads/corridorNative.test.ts
```

It fetches the actual SHA-verified 1 m BC 093G086 DTM, tests three fixed subareas with three preferences each, and writes every success and failure to `road-optimizer-results/native-trials.json` and candidate geometries to `native-routes.geojson`. Endpoints are placed 40 m either side of fixed tile-fraction centres, oriented across a 10 m local terrain gradient. These are **three subareas of one tile**, not independent regional or field validation, and no real exclusion/watercourse layers are supplied in those trials. The fixture explicitly states these limitations. Verification status belongs to the associated CI run, not the existence of these test files.
