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
it. Direction runs from the route's start to its end: the road start for a terrain-cost search,
the endpoint for an FSR connection, and the block landing for block access, where loaded travel
is always from the landing to the FSR. Edge costs are cached per directed arc for this reason.
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

## Propose a connection to a Forest Service Road

**Design → Search tools → Connect to a Forest Service Road** starts at the chosen **Road start**
or **Road end** (default end). The host loads a bounded nearby BC FSR network, then
`fsrConnections.ts` evaluates exact nearest points on its mapped segments. Generic tenure or
permit roads do not become FSR targets merely because they appear in the same catalogue.

**Nearest feasible** tries the three nearest loaded road targets in increasing straight-line
distance and stops at the first route that passes. **Lowest screening cost** tries all three
and selects the cheapest successful route under the terrain-cost model. Neither mode searches
every possible junction along every BC road. A farther junction, another point on the same
road, or a wider network search may give a different outcome. The loaded source and search
radius must accompany the result.

**Find nearby FSRs** discovers choices before generating any alignment. The **FSR to connect to**
picker lists up to ten nearest mapped sections with straight-line distances. Choosing a specific
FSR highlights its road and junction in blue. **Connect to selected FSR** searches that one
destination and reports failure rather than switching to another FSR. **Locate selected FSR**
fits the plan and closes the phone controls. A generated connector saves its destination and
source scope with the alignment so reopening retains the review record.

By default the connection uses the current terrain exactly; missing coverage remains an error.
Enable **Use regional terrain across connection (screening)** to request coarse regional
terrain covering the roads, FSR targets and search area. This is an explicit source change:
the host opens a separate project after preserving the original library project. The checkbox
starts off. Regional terrain supports broad access screening, not detailed earthwork quantities.

Each attempt uses the current grade, terrain slope, coverage, clearance, stream and heading
inputs. It returns the exact mapped segment point as the proposed end coordinate. A new,
separate alignment holds the connector; it does not replace either endpoint of the original
road. The proposal does not prove that a mapped FSR is driveable, that access is authorized,
or that the junction/profile/curves are suitable. Individual road reuse eligibility still
controls cost discounts separately from proposing a connection to that road.

`MAX_FSR_CONNECTION_CANDIDATES` is 3; each search returns one candidate and retains the normal
route-search budgets. An endpoint already within 2 m of a mapped FSR needs junction inspection
rather than a near-zero-length generated road. Missing terrain, closed/unidentified targets
or constraints with no covered solution produce an explicit failure. Load terrain spanning
the entire connector before trying again; regional terrain remains a coarse planning source.

The picker limit is `MAX_FSR_CHOICES` (10) in `fsrConnections.ts`. A manual choice runs one search;
automatic comparison still runs at most three. Discovery expands to seek three choices, bounded
by the same 2/5/10 km radii and source transfer limits.

## Access a harvest block

**Design → Search tools → Access a harvest block** picks a harvest polygon (drawn with **Draw
block**, or loaded as mapped cutblocks) and proposes roads to the nearest FSR sections.
`blockAccess.ts` samples the block edge at no less than 10 m spacing and at most 400 points, keeps
the edge point closest to each FSR section as that section's landing, and runs one terrain-cost
search from each landing to its FSR footpoint. On real terrain the host first loads active BC FSRs
near the block centre, as **Find nearby FSRs** does. Options are ranked by search score and drawn
on the plan in their list colours; each reports its length, search cost and the steepest loaded
and empty uphill ground grades sampled every metre on the ground the search used. **Add as road**
creates a separate alignment from the chosen option.

| Limit                              | Value                 | Enforced in                                 | When exceeded             |
| ---------------------------------- | --------------------- | ------------------------------------------- | ------------------------- |
| FSR sections tried per block       | 4                     | `blockAccess.ts` `MAX_BLOCK_ACCESS_OPTIONS` | Nearest four only         |
| Edge samples per block             | 400, at ≥10 m spacing | `blockAccess.ts` `MAX_EDGE_SAMPLES`         | Spacing widens            |
| Block already within 2 m of an FSR | —                     | `suggestBlockAccess`                        | That section is skipped   |
| No section yields a passing route  | —                     | `suggestBlockAccess`                        | Error listing each reason |

A landing on the nearest edge is a starting proposal, not a chosen landing site: move the road's
first point to the real landing and re-run the checks. The search score is not a complete access
cost, and an option does not establish the junction, the FSR's condition or access rights.

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
