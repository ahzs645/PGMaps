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

Open **Design → Find a route**. Route assumptions are stored as optional `routeSearch` in the
project and survive save/reopen; older projects get neutral defaults.

| Input                          | Applied behavior                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum grade                  | Absolute sampled longitudinal **ground** grade, checked again at ≤1 m steps. It is not the designed formation grade.                                                                          |
| Minimum radius                 | Used by curve checks and the sketched-corridor optimizer. Raw terrain-cost grid suggestions retain sharp corners until curves are fitted.                                                     |
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

The search does not enforce direction-specific loaded-haul grades, short-pitch lengths,
switchback exceptions, speed/sight distance, vehicle swept paths, footprint-wide stability,
stream crossing design or regulatory approvals. Enter conservative screening assumptions,
inspect the final geometry and use the independent profile/curve/drainage checks. A failed
bounded search does not prove that a professionally designed road is impossible.

## Propose a connection to a Forest Service Road

**Design → Find a route → Connect to a Forest Service Road** starts at the chosen **Road start**
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
