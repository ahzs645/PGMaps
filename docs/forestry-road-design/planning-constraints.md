# Forester constraints and route comparisons

Research checked 28 October 2026. The controls are planning inputs; their initial numbers are
placeholders. They do not apply one universal legal road standard to every BC site.

## Source findings

The current [BC Engineering Manual](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf)
(May 25, 2026, §§3.5.1–3.5.2, printed pp124–132) treats grade, speed, vehicle, road width,
curvature, drainage, terrain, maintenance and access as related decisions. Table 3-5 gives
suggested geometry for average conditions, with favourable/adverse haul directions,
sustained/short pitches and switchbacks. Its notes require site-specific maximum grades;
tight curves and crossing approaches can need further restrictions. The design review also
considers soils, visual quality, water, fish, wildlife, cultural heritage, private land and
other interests. The app therefore exposes assumptions rather than labelling its defaults
“BC compliant.”

[FPPR §§47–50, 55–57](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004)
distinguishes riparian classes and widths, restricts road construction and gravel removal
within riparian management areas with stated exceptions, and addresses crossings, fish
passage and habitat. A setback from an unclassified mapped stream centreline is not a
riparian assessment. Import assessed riparian/wetland/other protected areas as exclusion
polygons; set their treatment from the actual project requirements. The crossing switch
controls the search, not authorization to build a crossing.

The older [Forest Road Engineering Guidebook](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/forest_road_engineering_guidebook.pdf)
identifies steep side slopes and unstable terrain as reconnaissance concerns. A DEM gradient
cannot identify subsurface materials or prove stability; the optional terrain-slope screen
is only a numerical route filter.

## How the controls work

Open **Design → Search tools**. Route assumptions are stored as optional `routeSearch` in the
project and survive save/reopen; older projects get neutral defaults.

| Input                          | Applied behavior                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum grade                  | Absolute sampled longitudinal **ground** grade, checked again at ≤1 m steps. It is not the designed formation grade.                                                                          |
| Minimum radius                 | Used by curve checks, the sketched-corridor optimizer and generated roads: a terrain-cost, FSR or block-access road gets this radius at each corner, reduced where tangents are short.        |
| Terrain slope limit            | Optional 2D gradient from east/west and north/south terrain pairs. The sample distance is editable. Missing neighbour coverage blocks a candidate.                                            |
| Exclusion clearance            | Exact centreline distance from blocked polygon/line boundaries, in addition to polygon interiors. Cost zones remain passable. Include a suitable prism/clearing allowance yourself.           |
| Allow priced stream crossings  | On: mapped line intersections incur Crossing $. Off: intersections and the entered stream-clearance corridor are blocked. Assessed riparian exclusion polygons remain blocked in either mode. |
| Search margin                  | Automatic bounded area or an explicit margin. A wider margin also coarsens the fixed-size search grid.                                                                                        |
| Start/end heading              | First/last leg within ±45° of the entered direction.                                                                                                                                          |
| Prefer reviewed existing roads | Discounts sampled metres near individually eligible road lines. Closed/unreviewed records are ineligible by default. User-entered unknown condition requires explicit reuse opt-in.           |
| Retained road cost             | Fraction of base road cost remaining near eligible lines; include rehabilitation in the assumption.                                                                                           |
| Road proximity                 | Distance used for the cost preference. It does not snap endpoints, infer a junction, validate access, or turn the line into a surveyed road network.                                          |

Enable **Live route preview** to recompute one temporary result after a short pause while
editing, including keyboard arrow changes. The preview does not add saved roads; use
**Suggest terrain-cost alternative** to retain a result. Failure leaves no unverified route.

Route search costs are a separate screening model from engineering quantities. Use matching
profiles, templates, material/haul assumptions and cost inputs to compare retained alternatives.
A nearby zero-price borrow source still has availability, capacity, access, loading, haul and
material-suitability assumptions; see the engineering cost guide.

## Numerical bounds and unresolved design work

`routing.ts` validates clearance 0–500 m, terrain slope 1–300% (or off), slope sample distance
1–100 m, explicit search margin 20–1,000 m, retained existing-road cost 5–100%, and road
proximity 1–50 m. These are computational input bounds, not recommended design criteria.
Existing node, sample and geometry budgets still apply; gradient checks consume four more
terrain reads per sampled location. Finite coverage and every hard constraint remain required
when a road receives a reuse discount.

**Grades by haul direction** (`haulGrades`, optional) sets which way loaded trucks travel along
the searched route and up to three limits: loaded uphill (adverse), loaded downhill (favourable)
and empty uphill. The empty truck climbs back up what the loaded one came down, so that direction
is held to the stricter of the loaded-downhill and empty-uphill limits. `directionalGradeLimit` in
`routing.ts` applies them to each signed sample; they only tighten the maximum grade, never relax
it. Direction runs from the route's start to its end: the road start for a terrain-cost search. **Access from FSR** searches from the junction to the end, so
it sets loaded travel from the end back to the junction (`end-to-start`) whatever the saved
direction (`compareAccessRoutes` in `accessReview.ts`). Edge costs are cached per directed arc for this reason.
Limits accept `MIN_HAUL_GRADE_PERCENT`–`MAX_HAUL_GRADE_PERCENT` (0.5–60%); both are computation
bounds, not recommended grades.

The search does not enforce short-pitch lengths,
switchback exceptions, speed/sight distance, vehicle swept paths, footprint-wide stability,
stream crossing design or regulatory approvals. Enter conservative screening assumptions,
inspect the final geometry and use the independent profile/curve/drainage checks. A failed
bounded search does not prove that a professionally designed road is impossible.

## Generated roads are pulled taut

The search moves between grid cells in 45° steps, so its raw path turns at almost every cell. Before
a route is returned, `routing.ts` pulls it taut: from each kept vertex it extends a straight leg along
the path while the leg passes the same ≤1 m checks (grade by direction, coverage, terrain slope,
clearances, streams, headings) and costs no more than `TAUT_COST_TOLERANCE` (1%) above the grid
legs it replaces, so a deliberate detour round a crossing or cost zone stays. Legs stop at
`MAX_TAUT_LEG_M` (600 m). If those extra checks reach a search budget, the verified grid path is
returned unchanged. The host then gives each corner the minimum radius with the same fitting as
**Fit sharp corners**; fitted arcs cut inside corners, so review the fitted road's profile and
footprint before relying on it.

## Access from FSR

**Design → Access from FSR** (`AccessReviewPanel.tsx`, `accessReview.ts`) works back from where a
new road has to reach to the roads it could leave. It replaced the separate block-access and
FSR-connector tools.

**End** is a planned block, a point picked on the plan, or **This road** (the active road's **Road
start** or **Road end**, default end), which makes the new road an FSR connector. **Start from** is
the 1–4 nearest active FSR sections, or one road you choose from **FSR to connect to** (after **Find
nearby FSRs**) or by clicking an active road on the plan. On real terrain the host first loads active
BC FSRs around the end. FSR targets need `roadClass: 'fsr'`; generic tenure or permit roads do not
become FSR targets merely because they appear in the same catalogue, though a road you click can be
any active road. Discovery widens through 2, 5 and 10 km radii to find three sections and reports
the radius it searched; an imported FSR network is used as loaded instead. A block lands on its edge
closest to each start (`blockLandings`). Each junction is the exact nearest point on the mapped
segment.

For each start a terrain-cost search from the junction to the end is the corridor, and the route
goals are compared along it (`compareAccessRoutes`). Variants are grouped by start with length,
maximum design grade, the steepest sampled ground climb loaded (end → junction) and empty, and price;
★ marks each goal's overall leader. A chosen road's failure is reported, never replaced by another
road, and a road closed or retired after it was chosen blocks the run. Neither mode searches every
possible junction along every BC road: a farther junction, another point on the same road, or a
wider network search may give a different outcome.

**Add as road** creates a separate alignment from junction to end. From **This road** it is a
connector instead, reversed to run from the road's endpoint to the exact junction, with an
`fsrConnection` record of its destination and source scope; it does not replace either endpoint of
the original road. **Search on regional terrain (screening)** requests coarse regional terrain across
the end and every start; adding a road from such a run opens a separate project and keeps the source
project unchanged. Regional terrain supports broad access screening, not detailed earthwork
quantities. Otherwise the run uses the current terrain exactly, and missing coverage is an error:
load terrain spanning the whole connector and try again.

| Limit                             | Value                 | Enforced in                               | When exceeded             |
| --------------------------------- | --------------------- | ----------------------------------------- | ------------------------- |
| Starts tried per review           | 4                     | `accessReview.ts` `MAX_ACCESS_STARTS`     | Nearest four only         |
| Nearby choices listed             | 10                    | `accessReview.ts` `nearestFsrConnections` | Nearest ten only          |
| Road picked on the plan           | within 250 m          | `accessReview.ts` `pickActiveRoad`        | No road; pick closer      |
| Edge samples per block            | 400, at ≥10 m spacing | `blockAccess.ts` `MAX_EDGE_SAMPLES`       | Spacing widens            |
| End already within 2 m of a start | —                     | `compareAccessRoutes`                     | That start reports why    |
| No start yields a passing route   | —                     | `AccessReviewPanel`                       | Error listing each reason |

The proposal does not prove that a mapped FSR is driveable, that access is authorized, or that the
junction, profile and curves are suitable. A landing on the nearest block edge is a starting
proposal, not a chosen landing site. Individual road reuse eligibility still controls cost discounts
separately from proposing a connection to that road. `blockAccess.ts` keeps the older single-search
block proposal (`suggestBlockAccess`, at most `MAX_BLOCK_ACCESS_OPTIONS` = 4 sections), which
real-data scenarios still use.

## Real-data scenarios

Real-data scenarios load their mapped roads and blocks first, each source with its own timeout and
one retry (`SCENARIO_CONTEXT_RETRIES`), then place a draft corridor whose orientation screen keeps it
off mapped roads. `scenarioRoads` replaces that corridor with up to two connected options, so no
scenario opens on a road that joins nothing to nothing:

| Area holds                | Each option runs                                                    |
| ------------------------- | ------------------------------------------------------------------- |
| Mapped roads and a block  | From the nearest active mapped road to the block nearest the drafts |
| A block but no roads      | From either end of the draft corridor to that block                 |
| Mapped roads but no block | From the two nearest mapped roads to the corridor's far end         |
| Neither                   | The draft corridor stays                                            |

An option is dropped when it crosses another mapped road (it should start from that road), when four
consecutive legs are shorter than the minimum radius, or when it has more than four points per
100 m: both are the grid climbing ground steeper than the grade limit. A block within 30 m of a mapped
road gets no new road. The plan view's fit includes any block a road ends within 25 m of.

## Interface scope

The shared grade/radius fields accept the project ranges in both Design and Review. Corridor
search requires grade 1–30% and radius 5–1,000 m; its button explains and disables values outside
that range. The corridor optimizer does not consume the terrain-cost stream, slope, clearance or
reuse settings. Its panel states that distinction beside the action.

Design includes direct **Review existing roads** and **Gravel & aggregate costs** actions. The
first opens and scrolls to the road evidence panel; the second opens the aggregate settings.
Selected road records have distinct IDs and a locate/highlight action. Engineering and Review
show whether an enabled aggregate source overrides the base surfacing rate.

Final connector adoption also requires the [fitted geometry, directional formation grades and full-prism checks](final-connector-checks.md). Search scores and centreline checks alone do not pass that gate.
