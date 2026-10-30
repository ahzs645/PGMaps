# Final connector checks

`checkConnector` in `connectorChecks.ts` checks the **assembled fitted alignment**, its
independent formation profile, and the supplied terrain/context. Search-grid acceptance is
not sufficient: fitting a curve can move the road into a previously avoided area, and a
clear centreline can still leave cut/fill batters or clearing inside an exclusion.

The return value separates `failures` from `unknowns`. Only `status: 'pass'` and
`adoptable: true` allow adoption. A known violation is a failure. Missing evidence,
incomplete ground/structures, an unresolved conservative clearance envelope or a work
budget limit is unknown. Unknown results cannot be adopted as feasible candidates.
The caller must invalidate a result when geometry, terrain, context or criteria change.

## Preliminary FSR screens and final adoption

The ordinary **Find FSR connection** / **Connect to selected FSR** action saves a preliminary
terrain-cost alignment. It keeps the original road and records the mapped junction/source
scope. That action does not fit all required curves, create an independent formation or run
the full connected-access/material-cost model. A saved FSR screening record is not a passed
final-connector assessment. The FSR panel links directly to **Review final checks & complete
costs** so the next step is explicit.

The complete comparison checks the exact assembled candidate, rejects failed or unknown
checks before ranking feasible prices, and checks the geometry again before **Use**. Changes
to the project or terrain stale the comparison and disable adoption. Its portable complete
access cost record is distinct from the original FSR screening record and base engineering
estimate. Previewing a candidate is not adopting it.

## Criteria and final geometry

`connectorCheckOptions.ts` holds the portable criteria and validates their types/ranges.
Loaded travel is explicitly `start-to-end` or `end-to-start`. An uphill formation grade
in the loaded direction is compared with the adverse limit; downhill is compared with the
favourable limit. Both limits and direction begin unknown. They are not inferred from an
absolute ground-grade threshold. The independent formation still uses the ordinary
vertical-curve and station-range checks; missing PVIs do not become a designed profile.
The returned fixed start-to-end uphill/downhill extrema also let material-haul evaluation check loaded inbound aggregate or fill separately from outbound timber or waste. Optional maximum cut depth and fill height compare ground with the formation, ditch and
batter elevations across the whole represented section.

The [BC Engineering Manual](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf)
(May 25, 2026, §3.5.2 and Table 3-5) distinguishes favourable/adverse grades and connects
geometry to site conditions and operation. This checker applies the planner's explicit
criteria. It does not infer a universal BC maximum grade, a loaded vehicle, a safe
switchback or an authorized crossing.

The actual compiled circular radii are compared with the entered minimum. Sharp PIs,
rejected/overlapping curves, silently substituted spirals, coincident controls, invalid
vertical curves and disconnected compiled pieces block adoption. Optional expected start
and end coordinates must meet within 0.05 m; compiled-piece joins must meet within 1 mm and their tangent directions within 0.05°. Formation controls beyond the fitted road end
must be rebuilt rather than silently carried from an old alignment.

## Entire prism and clearing footprint

The checker uses the same engine cross-section calculation as quantities. It samples at
no more than 1 m along the fitted road, adding horizontal, vertical, template, structure,
widening and review-window breakpoints. Every station must have finite ground/formation,
complete daylight and known ground beneath every designed section point. An unresolved
batter beyond the configured section reach is a failure; missing terrain is unknown.
`createRoadStationSampler` compiles once and does not alter the existing 3,000-station
quantity-analysis budget.

Consecutive left/right daylight edges, including formation width and an entered additional
clearing allowance, form continuous conservative polygon strips. JSTS tests the **whole
strip** against exclusions and stream setbacks, so a narrow constraint between stations is
not missed by checking station points alone. Polygon holes retain their actual meaning.
Cost zones with `routeCostPerM` remain passable; they are not hard exclusions. The complete
cost comparison also prices the additional clearing strips at the entered clearing rate;
see [clearing beyond daylight](full-cost-alternatives.md#clearing-beyond-the-daylight-prism).

Offsets between samples include a bounded curvature envelope and a local metric-scale
allowance. If only that envelope reaches a constraint, the result is unknown rather than
an invented clearance. The local frame matches the road engine. This is the complete
piecewise section model, not proof that unsampled terrain or survey features cannot change
the footprint. Finer topography, materials and stability still require checked site data.
Native terrain resolution is supplied separately from portable criteria; unknown resolution
or terrain coarser than 2 m cannot pass this site-level gate. A 1–2 m source does not itself
establish survey accuracy.

## Stream crossings are bounded review inputs

With crossings forbidden, the whole prism/clearing footprint must clear every stream by
the entered setback. Allowing crossings does not waive setbacks along an entire stream.
`approvedCrossings` contains explicit `{featureId, structureId, startM, endM}` windows.
Inside a valid window, the referenced mapped stream must match an entered culvert whose
station, inverts, terrain coverage, barrel span and cover are complete and meet their
entered criteria. A known flat or uphill inlet-to-outlet gravity culvert blocks adoption;
a reviewed window cannot waive its missing positive fall. Non-gravity exceptions are not
modelled. Outside that window the stream setback remains in effect. Missing
windows/structures are unknown; deficient known cover/span is a failure.

A reviewed window is an explicit planning declaration. Culvert geometry alone does not
calculate flood conveyance, fish passage, foundation adequacy or legal approval. Bridges
and unmodelled crossing types remain unresolved rather than being given a fabricated
culvert. Refer to the [planning constraints](planning-constraints.md) and
[drainage guide](drainage.md) for those distinctions.

## Limits and regression checks

| Check/budget                                                        | Enforcing code                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Native source resolution ≤2 m (otherwise unknown)                   | `MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M`                                                                   |
| Endpoint position ≤0.05 m; compiled joins ≤1 mm; tangent gap ≤0.05° | `CONNECTOR_ENDPOINT_TOLERANCE_M`, `CONNECTOR_POSITION_GAP_TOLERANCE_M`, `MAX_CONNECTOR_HEADING_GAP_DEGREES` |
| Dense longitudinal interval ≤1 m                                    | `MAX_CONNECTOR_SECTION_SPACING_M`                                                                           |
| At most 16,000 dense sections/events                                | `MAX_CONNECTOR_CHECK_STATIONS`                                                                              |
| At most 4,000,000 terrain reads including quantity analysis         | `MAX_CONNECTOR_TERRAIN_SAMPLES`                                                                             |
| At most 5,000,000 tested strip/constraint vertex operations         | `MAX_CONNECTOR_GEOMETRY_OPERATIONS`                                                                         |
| 50,000 constraint vertices; 500 context features                    | `connectorChecks.ts`, ordinary engine validation                                                            |
| 100 reviewed crossing windows; stations 0–100 km                    | `parseConnectorCheckOptions`                                                                                |
| Clearing/setback inputs 0–500 m; cut/fill limits 0–1,000 m          | `parseConnectorCheckOptions` (computation bounds, not design recommendations)                               |

Exhaustion returns unknown, never a truncated success. Tests cover a sharp grid corner,
a fitted radius below minimum, uphill/downhill reversal using formation on flat ground,
a narrow exclusion between stations inside a daylight/clearing footprint, polygon holes,
a fitted arc entering an area the original grid legs avoided, no-data, missing criteria,
coarse terrain, complete/incomplete culvert review windows, and endpoint registration.
