# RoadEng review: implementation and next validation packages

This change implements the first two packages from the supplied 6 November 2026 review:
reference conventions and explicit drainage policies with saved sensitivity comparisons.
The base reviewed here is PGMaps `97475a3`. The earlier source review compared `9542261`;
the implementation below extends the current designer rather than recreating features
already documented in the October and November audits.

## What this change delivers

| Package                            | Implementation                                                                                                                                                  | Evidence and compatibility                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Material-factor conventions        | A shared converter, optional source/value/convention provenance, and an explicit material editor action                                                         | Canonical `compactionFactor` remains compacted fill per reusable bank volume; older materials keep their existing meaning. See [reference cases](material-factor-reference-cases.md). |
| Explicit drainage assumptions      | Full fill, preservation, and whole-basin depth-limited routing; maximum-area or lowest-elevation outlet snapping; optional working-grid resolution              | Omitted policy fields keep the previous defaults. Ponding is assessed independently of whether pits are filled for routing. Actual selected outlet and actual cell size are retained. |
| Repeatable sensitivity comparisons | Named historical snapshots, a selected baseline, catchment and per-culvert area deltas, changed-input/outlet/coverage notices, project persistence, JSON export | No full raster copies. Different roads or requested outlets do not receive misleading area deltas. Source fingerprints detect changed samples/extent even when display names match.   |

The source is the user-supplied review of the RoadEng 11 tutorial, document version
20 February 2025. Its source manual is linked in the [workspace contract](../forestry-road-design.md#reference-to-feature-mapping).
The review cites pp. 227–228 and 242–243 for factor examples, and pp. 59–62 and 69 for
drainage settings. This implementation does not claim a new inspection of the proprietary
application or a matched run of the tutorial data.

### Try it

1. Open `/dev/forestry/road-design?example=training` for the synthetic offline terrain.
2. In the engineering material definitions, use the optional factor-convention input.
   Enter a bank-per-compacted factor of `1.1` and verify that the canonical compacted-per-bank
   value becomes `1 / 1.1`, with the original value and source retained. Reusable fraction
   remains independent.
3. In **Detail → Drainage**, select an outlet and a buffer. Run drainage, expand
   **Compare drainage runs**, and save a labelled baseline.
4. Change one of depression treatment, snap policy, working resolution, buffer or surface.
   The old evidence becomes stale. Rerun and save the second result.
5. Compare actual grid resolution, contributing area, selected outlet and coverage flags.
   Expand the crossing evidence for per-culvert existing/design areas. Export the comparison
   or save and reopen the project JSON.

The complete policy definitions, bounds and caveats are in the [drainage guide](drainage.md).
The synthetic example demonstrates workflow and arithmetic; it is not field evidence.

## How the implementation is divided

The material conversion lives beside the engineering types and project validation. It does
not change the allocator's physical convention. All entry paths should use that same
conversion function, including any future RoadEng import. The original input is a provenance
record, not an additional multiplier in the earthwork calculation.

`drainagePolicies.ts` contains shared policy types and runtime validation. `hydrology.ts`
conditions surfaces and computes flow. `drainageCatchments.ts` resolves the chosen outlet
deterministically. `drainageRun.ts` applies the settings to both existing and designed terrain,
enforces sampling bounds, and retains the achieved grid. These remain pure calculations.

`drainageEvidence.ts` validates and fingerprints settings, requested/selected outlets and
portable records. New optional fields preserve older project files and their omitted default
semantics. A separate calculation version keeps legacy hashes intact while requiring a rerun
before older ponding evidence can be used as current; legacy records remain historical evidence.
`drainageSensitivity.ts` creates numeric snapshots and computes descriptive
comparisons; `DrainageSensitivityPanel.tsx` presents them using the shared form, section,
table and readout controls. `DevForestryRoads.tsx` connects these actions to the existing
project state, current-result checks and exports.

### Reference checks

- Reciprocal factors are checked against conservation equations and independently calculated
  inputs. The supplied review's printed cut/fill areas imply **2.36 m² deficit** and
  **0.82 m² surplus**, not the conflicting appendix answers. These are area equivalents.
- Small synthetic drainage grids distinguish a shallow depression from a deep one, outlet
  score ties, missing terrain and a zero depth limit. They do not use RoadEng output as an oracle.
- A separate minimax-path reference checks spill depth, downstream conservation and cycle-free
  routing on deterministic small grids. A near-threshold basin demonstrates why physical ponding
  requires its own calculation version even when default routing is unchanged.
- Persistence tests retain source, policy, actual outlet and numeric comparisons through JSON;
  changing any routing input invalidates current evidence.
- Browser acceptance exercises the real controls, stale-result behaviour, comparison exports
  and a fresh project import at desktop and phone widths. The repository's existing
  `forestry-roads.yml` remains a manual-only workflow, as required by `AGENTS.md`.

The PR records the commands actually run and their results. A test being present in this list
does not itself mean it has passed.

## Package 3: engineering distance basis and geometric quantities

This is a separate migration. `engine.ts` currently accumulates fitted lengths in a local
distance/bearing frame, while
`designExports.ts` adjusts projected LandXML elements to their written endpoint geometry.
Changing only the exported total length would leave stations, curves, profiles and sections
inconsistent with each other.

Start with an explicit distance-basis record: legacy local model chainage (using a spherical
distance/bearing frame), or a selected projected engineering CRS with units and the
transformation definition. Preserve existing projects under
the legacy basis. Provide a deterministic station transformation for handoff before offering
an opt-in project migration. It must map event positions, not just rescale the whole road by
one length ratio. Use the same mapping for horizontal-element boundaries, PVIs, vertical-curve
lengths, section stations, template/material/strata/preparation ranges, culverts, haul sites,
turnout tapers, direction and sidecast ranges, crossing annotations and vertical alternatives.
Nonlinear station remapping also changes grades and vertical-curve parameterization; relabeling
PVI stations alone does not preserve the physical vertical profile.

Add independent references before altering production quantities. For a circular road with
centreline radius R and angle θ, a constant area A whose centroid is at signed radial offset y has
volume A(R + y)θ; centreline end-area multiplication gives ARθ. An asymmetric section therefore
needs its first moment about the centreline, not only denser longitudinal sampling. A more
general reference integrates `A(s) + κ(s) M(s)` along the centreline, with sign conventions
defined against PGMaps' left-negative offsets. This relationship assumes a non-folding sweep;
it does not fix self-intersecting road prisms.

For a quarter circle of radius 20 m and depth 2 m over outer offsets 0–4 m, A = 8 m² and
M = 16 m³. The exact volume is 88π m³. The matching inner strip is 72π m³; centreline
area multiplication gives 80π m³ for both. A symmetric section has zero first moment.

Use `sectionGeometry.ts`, `designSurface.ts`, `engine.ts` and `engineering.ts` to compare those analytical cases
against a converged 3D prism/raster reference. Detect nonadjacent footprint overlap before
attempting union volumes: summing overlapping legs double-counts physical ground. Preserve
separate cut and fill, preparation and layer quantities, explicit no-data holes and discontinuities
at template transitions. A nonpositive sweep Jacobian or overlapping corridor must produce an
incomplete result or require a separate 3D calculation; more centreline samples do not repair it.
Set tolerances from the reference's discretization/convergence, not from how close the current
result happens to be.

Acceptance must include export/reimport in the intended receiving software and compare physical
positions of curve events, PVIs, sections and crossings. Receiving-software evidence is still
missing; passing a local XML parser is insufficient.

## Package 4: complete vehicle manoeuvres and field evidence

`sweptPath.ts` already groups curve influence zones and reports wheel fit and body/load
overhang. Keep that result, but introduce separate outcomes for wheel-to-formation fit,
body/load-to-obstacle clearance, overhead clearance, grade feasibility and reversing feasibility.
Use separate `pass`, `fail`, `not-assessed` and `incomplete` states. An unexamined outcome must
not imply a successful overall fit.

Extend the input model with sourced vehicle dimensions and uncertainty, loaded direction,
obstacle geometry/elevation, dated observations and the chosen criterion's edition/section.
Use `roadCriteria.ts` for the existing criterion/widening mechanism and connect actual batter
surfaces and adjacent road legs through `designSurface.ts`. The manoeuvre must be evaluated
continuously over approaches, both curves, their connection, intervening straights/tapers and
departures. Shared trajectory poses and world-space obstacle checks prevent an adjacent road
leg from being mistaken for the intended formation. A pass of each isolated bend does not
establish whole-switchback clearance. Travelling down-station is not the same as reverse gear;
gear segments and initial articulation need explicit inputs.

Independent acceptance cases should include a body/load that strikes an obstacle while all
wheels remain on the formation, an adjacent-leg conflict, a height-clearance failure, insufficient
terrain/obstacle coverage, and a grade/direction failure. Forward-only kinematics must not claim
that a reversing manoeuvre is feasible. Actual fleet dimensions, obstacle surveys and the
project-selected criterion are required to turn these cases into a site assessment. Also test a
narrow straight road: absence of curve checks cannot establish formation fit. A settled forward
turn with front-axle radius 25 m and wheelbase 10 m has rear-axle radius √525 m and offtracking
about 2.08712 m; retain that independent kinematic reference alongside collision cases.

## Package 5: operational haul accounting

Extend `costRateTools.ts`, `engineering.ts`, and the existing full-cost/connected-network
models with a physical ledger. Keep material suitability and the allocator's bank/compacted
conventions; derive transport quantities from their selected movements.

The first delivery should post-cost those selected movements. The allocator currently receives
a distance-only cost callback; a later optimization delivery must introduce contextual movement
costs and guard sparse-solver eligibility before claiming an optimum that depends on material,
direction, grade, truck or partial trips.

For a reusable bank movement B, compacted/bank factor c and loose/bank factor s:

- compacted placement = Bc;
- loose truck volume = Bs;
- mass = Bρb, or an equivalent explicitly stated density basis;
- bank volume per trip = min(truck loose box / s, mass payload / ρb);
- trips = the physical dispatch convention applied to B / bank volume per trip, including
  the policy for partial loads and combining compatible movements;
- cycle time = loading + queue + loaded travel + unloading + empty return;
- transport cost follows charged truck hours, with fixed costs and included-rate components
  shown separately to prevent double counting.

Round dispatch trips after grouping compatible loads, not independently for every station parcel.
Keep continuous planning quantities separate from integer dispatch quantities. As an independent
reference, 80 reusable bank m³ with c = 0.9, s = 1.25 and bank density 2 t/m³ gives 72 m³
placed, 100 m³ loose and 160 t. A 12 m³ box with an 18 t payload carries 9 bank m³ per full
load. Nine trips at 30 minutes per cycle and $180/hour cost $810.

Density, moisture basis, swell, payload and productive-hour assumptions need explicit sources.
Grade-dependent speeds require direction-specific route segments and supported speed curves;
fleet output is also bounded by loading and unloading capacity. Do not treat an average hourly
rate as a physical productivity model.

Acceptance should demonstrate that changing swell, density or payload changes trips/haul cost
while geometric excavation remains fixed. Include payload-limited and volume-limited trucks,
different loaded/empty paths, a closed or overloaded bridge, a partial last load, incompatible
material and a binding loader capacity. Historical costs remain historical quotes; the feature
must not manufacture current market prices.

## Evidence still needed for a matched RoadEng comparison

The supplied review identifies the missing V11 tutorial datasets and matching exported results.
Request an ordinary data archive or open-format exports containing terrain, CRS/vertical datum,
alignment/profile, templates, section coordinates, quantity/material tables and all relevant
calculation settings. Retain the original source bytes, version and checksums with a case manifest.

Separate independently verified reference cases from application-to-application comparisons and
from unverified examples. The tutorial's workflow is useful now; a numerical equivalence claim
requires that missing matched-input evidence and receiving-software checks.
