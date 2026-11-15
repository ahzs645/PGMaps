# Material requirements, economic haul and construction constraints

The road workspace can solve an economic material prescription for a fixed designed road.
Open **Engineering → Haul → Haul & cost settings**. Select **Economic material flow**, enter
borrow/disposal sites and their prices/capacities, and add material requirements, construction
direction ranges or permitted sidecast. These policies enable economic allocation automatically.
They are included in the editable project and its undo history. Existing projects without these
inputs retain the original nearest-source scenario until economic mode is selected.

## Material requirements

In **Engineering → Ground**, each material has an optional entered **quality** from 0 to 100.
An omitted quality is unknown; it is not class zero. The number is a project-specific ordered
suitability class, not an inferred soil classification or a published engineering standard.

A fill requirement names a station range and a demand layer:

- **Subgrade fill** applies to the embankment volume outside separately specified components.
- **Default surfacing** applies to the legacy surface course.
- A custom template course or keyed-fill component uses its persistent layer/component ID.

An **exact** requirement accepts only its named material. A **replaceable** requirement accepts
the named material or a material meeting the entered minimum quality (or the named material's
known quality). An explicit minimum also applies to an exact match. Unknown quality cannot satisfy
a minimum. Stripping cannot be specified as fill or used as borrow. Overlapping requirements on
the same layer are rejected. Stations at policy boundaries join the analytical event schedule.

Borrow sites can name their supplied material. An unnamed site remains usable for an unrestricted
generic fill demand but cannot satisfy an exact/quality requirement. Waste sites can name one
accepted material or accept all. Site capacity is shared by every compatible movement, including
subgrade and surface courses. The project does not establish quarry quality, permission, reserves
or waste acceptance merely because a material or capacity was entered.

## Volume and price basis

Excavated supplies are bank cubic metres. Only the reusable fraction can become fill, at the
material's compacted-per-bank factor. Borrow and constructed layer demands are compacted cubic
metres. Waste and sidecast are bank cubic metres. The allocation equations carry the conversion
factor at the supply-to-demand connection; a bank disposal capacity is never multiplied by a
fill factor or combined with a compacted pit capacity.

Custom key-fill demands are a subset of subgrade fill, so they replace that part of the ordinary
subgrade demand. Surface-course demands are additional to subgrade fill. Their station areas use
the same start/midpoint/end Simpson integration as the engine's surface total, including width and
depth changes. Site-preparation stripping is added to bank disposal exactly once; prepared-ground
excavation is classified separately against the original-ground depth horizons.

Material-allocated surface courses price material acquisition and transport through the haul
prescription. Their **placement uses the entered fill-placement rate**. The old delivered
surfacing rate/source scenario applies only to remaining generic surfacing, preventing duplicate
acquisition and haul charges. The cost dialog shows a separate **Material courses · placement**
row. Change the fill-placement rate if this shared placement assumption is inappropriate.
The scalar mass chart subtracts material-allocated surface-course demand; it remains an aggregate
potential balance, not evidence that material-quality or direction constraints are satisfied.

## Economic solution

`materialAllocation.ts` formulates a mixed-integer linear program and solves it with the pinned
`yalps` dependency. For each supported interval/material it accounts for all excavated bank
volume through compatible cut-to-fill, permitted sidecast or disposal. Every demand must receive
its compacted volume. Finite/unbounded site capacities, access distance, the entered haul curve,
loading/handling rates, procurement/disposal rates and fixed site openings enter the same model.
A site-opening binary charges the fixed cost once when any volume uses that site.

An **optimal** result minimizes those entered supply/movement/disposal/opening costs inside the
finite parcel model. Excavation and placement are fixed by the already designed road, so those
constant costs are outside this allocation objective. This does not optimize the road geometry,
construction dates, equipment fleets or the connected-road path network jointly. It is not a
claim of numerical equivalence with proprietary OptiHaul.

An **infeasible** result adopts no material prescription and no movement cost. The summary names
the unresolved demand/disposal and says the model is infeasible. Zero haul on that result does
not mean that construction is free. Missing compatible capacity is not replaced by a fictitious
pit at the default rate.

A timeout, pivot limit, numerical cycle, model budget failure or failed conservation check gives a
**not solved** result (`allocateOrReport` in `engineering.ts`, status `unsolved`): no partial
solver incumbent is adopted and no movement, borrow, waste or haul cost is included. The road, its
sections and its quantities do not depend on the allocation, so they stay on screen; the estimate
tile reads **Material plan not solved**, the allocation warning names the limit that was reached,
and the cost review flags it. It is different from infeasible: the entered rules may well be
satisfiable, but this model could not be calculated.

**A plan that was not adopted is not a quantity.** For an infeasible or not-solved result
(`materialPlanMissing`, `engineeringTypes.ts`) the summary's borrow, waste and unallocated volumes
are zero because nothing was allocated, and no reader states them as results:

- the cost breakdown lists no borrow, waste or haul row, so its rows add up to its total;
- no quantity is called unpriced or unallocated (`costReadiness.ts`);
- Review reads **not assessed** for a plan that was not solved ("The material plan was not solved,
  so borrow and waste have no source or site yet"), and **outside a limit** for an infeasible one.
  Neither states a borrow or waste volume. The balance of usable cut against fill is still shown:
  that is a property of the road, not of the allocation;
- the mass-haul diagram draws the balance only, with no line after sites;
- the engineering summary's haul tiles and the report's haul paragraph say the plan was not
  calculated instead of printing zeros.

The solver result is independently checked against every supply, demand and capacity equation,
its opening binaries, and the reconstructed movement cost before it reaches the workspace.

For a proven continuous linear haul tariff with zero loading, `sparseMaterialAllocation.ts`
uses adjacent chain arcs instead of every source/demand pair. Reusable bank material has a fill
chain priced at its compacted conversion; bank disposal has a separate waste chain. The chains
retain material classes, station direction rules and shared physical site capacities/opening
decisions, and run the whole road: an arc over road with unknown earthwork costs its length. Solved chain flows are decomposed into the actual source-to-
destination movements and checked against the same objective. This is an exact change of model
representation for that tariff. Piecewise/discontinuous tariffs, loading charges and the external-
deferral pass use the general dense formulation. No tariff is approximated to make it fit.

## Construction direction and sidecast

**Forward** means increasing chainage; **backward** means decreasing chainage. A movement must
satisfy every range it crosses. A **blocked** range prevents transfer across it, while same-station
handling crosses no range. These constraints are independent of one-way restrictions on the
existing-road network.

A terrain or daylight gap is not a barrier. The interval's own earthwork is unknown and left out of
the model, and material moves past it at its full chainage distance, because the road is continuous
where the data is not. Where a stretch of road really cannot be driven, enter a **blocked** range.

Sidecast is available only for material originating inside an explicitly permitted range. Its
capacity is bank m³ per road metre, enforced separately within each analytical interval and shared
by all accepted materials. The range can accept all material IDs or a selected subset. Overlapping
sidecast ranges are rejected so the same physical disposal area is not counted twice. Sidecast
incurs its disposal unit rate; it incurs no road haul/loading charge. Setting its rate to zero is
an explicit entered scenario. The geometric model does not assess sidecast stability or permits.

## Complete route-cost comparison

The connected-network comparison retains layer/material/quality demands rather than reducing all
fill to one interchangeable aggregate. A source has separately reviewed **material classes** and
optional quality. Changing those entries clears its material confirmation. Capacity feasibility
reserves scarce compatible supply for demands that other sources cannot satisfy. A general
`qualityConfirmed` checkbox alone cannot establish an exact material ID or numeric quality.

The initial internal-use pass explicitly defers external supply/disposal. Its unresolved parcels
are marked `externalUnresolved` and have no procurement/transport cost. It maximizes known
internal use before minimizing known internal cost; it is not represented as a complete economic
prescription. The later comparison prices real reviewed sources and loaded/return network paths.
External transport along the connector must respect construction-direction ranges too.

The full-cost ledger does not buy internally used surface material again and does not subtract
that material from embankment fill. It retains internally placed course cost and permitted sidecast
disposal once. Network source/path selection retains the documented bounded delivered-batch
heuristic; the exact fixed-road material solver does not turn that network heuristic into a global
joint optimum over every route, pit and construction sequence.

## What-if balance line

**What-if balance line**, under the mass-haul diagram, puts a horizontal balance line on the
curve. It is a reading of the diagram only: the design, the solved allocation and the reported haul
never change, and the panel says so. Drag the line, focus it and use the up and down arrows (Shift
or Page Up/Down for ten steps, Home and End for the curve's lowest and highest value), or type its
level. **Reset to 0** returns it to zero and **Close what-if** (or Escape on the line) removes it.

Where the line cuts the curve, the road between two cuts balances: above the line cut comes first
and moves up-station, below it moves down-station. For each loop the panel lists its stations and
length, the volume that balances inside it (its height above or below the line), the mean haul
distance, and the overhaul past the road's free-haul distance. Totals give the balanced length, the
volume moved in m³ and m³·m, and the overhaul. A line off zero at a road end leaves material that
cannot balance inside the road: the panel says how much comes in or leaves at each end.

The method is the classical mass-haul (Brückner) one, written in `balanceLine.ts`: a thin layer of
the curve at height h is a chord of width w(h); its volume dh moves w(h). A loop's haul is ∫ w dh,
the area between curve and line, and its overhaul is ∫ (w − F) dh over the chords wider than the
free-haul distance F. A chord that reaches a road end before it closes does not balance. The curve
is the one drawn: known earthwork carried across lengths whose sections are incomplete, at full
distance, in the diagram's compacted m³. Without a free-haul distance there is no overhaul.

The what-if is not the allocation. The solver prices every movement and respects material classes,
direction and blocked ranges, sites and sidecast; a balance line does none of that. Use it to see
where the curve balances at a chosen level, not to replace the reported haul.

## RoadEng and Softree Optimal haul files

Save & export writes the haul four ways Softree's tools read (`softreeExports.ts` over
`softreeHaulCsv.ts`), for the road on screen:

- **RoadEng mass haul** (`.csv`): the mass-haul curve's balance items as RoadEng's Mass Haul export
  (free haul, over haul, borrow and waste, with their stations, centroids and over-haul m³·m),
  found from the curve balanced on zero by the same layer method as the what-if balance line. It
  describes the curve, not the solved allocation.
- **RoadEng optimal haul** (`.csv`): the solved allocation as RoadEng's Optimal Haul export (cost,
  volume, pit and movement summaries, movement and pit details, the detailed movement summary). It
  needs haul allocation on and a solved plan; otherwise the export says which is missing. What the
  file has no column for (waste-disposal and sidecast charges, surfacing, clearing, structures,
  mobilization, contingency) is named, with its amount, in the download notice.
- **Softree Optimal areas** (`.csv`): cut and fill areas by material at each station at the
  design's own level, in the RoadEng export's grid, as the Areas file Softree Optimal reads.
- **Softree Optimal inputs** (`.zip`): the materials (each ground type by its code, and unclassified
  excavation `UC` at the project's cut rate), the borrow and waste sites as pits, and the haul cost
  model, one CSV each.

Volumes are compacted (fill-equivalent) m³, as the mass-haul diagram draws them. None of the files
states its units: a project opened from a RoadEng design in feet writes feet and cubic yards
(`softreeUnits`), every other project metres. All four are refused while a road input is invalid.

### Compare with RoadEng

**Compare with RoadEng…** (Review → Design checks; `compareRoadEng`) reads a RoadEng Mass Haul
export, a RoadEng Optimal Haul export or a Softree Optimal Areas file and sets it beside the same
file made from the active road's results (`SoftreeCompareDialog.tsx` over `softreeCompare.ts`, which
calls `compareMassHaul`, `compareOptimalHaul` and `compareOptimalAreas`). The file stays in the
dialog: reading it never writes to the project, and **Download comparison CSV** saves the
comparison, not a project export.

- **Which file.** Told by content, never by name: a `Cut Vol` header row is a Mass Haul export, an
  Optimal Haul section title (`Cost summary`, `Volume summary`…) an Optimal Haul export, and a
  `version` / `no. station` header ending at `data start:` an Areas file. Anything else is refused
  and the message says what was looked for.
- **Units.** The files state none. **Units in the file** starts at the project's (`softreeUnits`)
  and can be changed; every value is compared and shown in metric.
- **Stations.** **File's first station** starts at the station a RoadEng design's file began at
  (`roadEngSource.startStation`, scaled by its `stationScale`) and at 0 for any other road. The files
  Save & export writes start at 0, so set it to 0 to compare those with a road read from RoadEng.
- **The road's side** is written in the chosen units and read back, so both sides carry the files'
  precision: a road's own export, loaded back, shows no difference at all.
- **What is shown.** Totals side by side (Mass Haul: each type's volume and over-haul; Optimal
  Haul: the cost total and each volume column over all materials; Areas: cut and fill volume by
  average end area between neighbouring stations both sides hold), with the difference and its
  percentage of the file's value. Then every item or station row, those that differ first and the
  largest relative difference first; *Differences only* hides the rest. A row's station button
  moves the workspace's station there, which the plan, profile and section follow. Last, what only
  the file has and what only the road has: mass-haul items no item of the same type overlaps,
  materials or pits on one side only, Areas stations with no record within 0.01 m.
- **Tolerance.** Two values agree within the larger of the files' rounding (0.05 m³, 0.01 m,
  0.005 m², 1 m³·m, $0.05) and **Agree within** of the larger value (0.1 % unless changed). A value
  only one side has never agrees. The dialog prints the tolerance it used.
- **Refusals.** The command is off while the road has no calculated results. An Optimal Haul
  export needs haul allocation on and a solved plan, and the message says so ("This is a RoadEng
  Optimal Haul export, and the road's side cannot be made: Turn on haul allocation first.").

No RoadEng-written Mass Haul, Optimal Haul or Areas file is among Softree's sample projects, so the
comparison is checked against the road's own exports with values changed by hand
(`softreeCompare.test.ts`, `tests/e2e/forestry-road-softree-compare.spec.ts`).

## Limits and verification

| Limit                                                                                                         | Enforcing constant / behavior                                                                 |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 200 fill requirements                                                                                         | `MAX_FILL_REQUIREMENTS`, `allocationPolicy.ts`                                                |
| 100 direction and 100 sidecast ranges                                                                         | `MAX_HAUL_DIRECTION_RANGES`, `MAX_SIDECAST_RANGES`                                            |
| 20,000 material-flow variables                                                                                | `MAX_ALLOCATION_VARIABLES`, `materialAllocation.ts`; the tableau memory budget can bind first |
| 1,200 constraints; 3,000,000 conservative tableau cells                                                       | `MAX_ALLOCATION_CONSTRAINTS`, `MAX_ALLOCATION_TABLEAU_CELLS`                                  |
| 12 positive-price site openings                                                                               | `MAX_ALLOCATION_OPENINGS`                                                                     |
| 2,048 branch iterations; 3-second integer-search timeout                                                      | `MAX_ALLOCATION_BRANCHES`, solver options                                                     |
| Simplex pivots per phase: 4 per tableau row, at least 256 and at most 10,000                                  | `allocationPivotLimit`, `ALLOCATION_PIVOTS_PER_ROW`, `MAX_ALLOCATION_PIVOTS`                  |
| What-if balance line: 400 layers per loop plus one break at every vertex height; within the curve's own range | `BALANCE_LINE_LAYERS`, `balanceLevelRange`, `balanceLine.ts`                                  |
| Mass Haul export: 400 layers per loop, as the balance line                                                    | `MASS_HAUL_LAYERS`, `massHaulItems`                                                           |
| Softree CSV read: 100 MB / 2,000,000 rows; Areas file 500 code pairs a record                                 | `MAX_SOFTREE_CSV_BYTES`, `MAX_SOFTREE_CSV_ROWS`, `MAX_OPTIMAL_AREA_PAIRS`                     |
| Optimal material descriptions: 50 characters                                                                  | `OPTIMAL_DESCRIPTION_CHARS`                                                                   |
| Compare with RoadEng: 50 MB file; 400 rows drawn (the comparison CSV holds every row); agree within 0–50 %    | `MAX_COMPARE_FILE_BYTES`, `MAX_COMPARE_ROWS_SHOWN`, `MAX_COMPARE_RELATIVE_PERCENT`            |
| Compare with RoadEng: rounding tolerance and Areas station match                                              | `COMPARE_ABSOLUTE_TOLERANCE`, `COMPARE_STATION_TOLERANCE_M` (0.01 m)                          |

The sparse formulation has the same 20,000-variable / 1,200-constraint / 3,000,000-cell ceilings,
enforced by `MAX_SPARSE_ALLOCATION_*` in `sparseMaterialAllocation.ts`.

The pivot limit grows with the model. These flows finish in about one pivot per tableau row
(two rows per equality constraint), so four per row leaves room; an earlier limit divided a fixed
500 million tableau updates by the tableau size and so allowed fewer pivots the larger the model
was. A 930 m road with three materials that could substitute for one another by quality needed
about 1,300 pivots and was allowed 268, which was reported as a numerical cycle.
`qualitySubstitution.test.ts` holds that case, a three-interval quality case worked by hand
($1,228) and a road-sized case checked against a closed-form optimum.

A stepped haul quote still needs the dense model, which has one variable per compatible
cut-interval/fill-interval pair. With a free-haul distance above zero and any distance rate, a
road of about 90 intervals whose cut can be placed as fill exceeds the tableau limit and reads
**Material plan not solved**. A quote with the free-haul distance at 0 m and one distance rate is
linear and uses the sparse model. See [known issues](known-issues.md).

Economic work grows with the number of source/demand interval pairs. A long road at a fine station
interval may exceed the browser budget even when its ordinary quantities calculate. Increase
station spacing only after a quantity convergence check, reduce redundant material definitions
and candidate sites, or split a design at a defensible construction boundary. The app does not
silently truncate its economic model or label the old heuristic an optimum.

`materialAllocation.test.ts` checks independently worked and exhaustively enumerated transport
optima, shared fixed pit openings, scarce quality capacity, unknown material, bank/compacted
conservation, course/component demand, finite disposal, direction rules, haul across road with no
parcel and local sidecast.
`fullCostComparison.test.ts` additionally checks exact named courses, external quality reservation,
direction-blocked deliveries and internal rock used in a surface course without double buying.
`qualitySubstitution.test.ts` checks substitution by quality against a hand-worked optimum, a
road-sized model and the not-solved result.
`sparseMaterialAllocation.test.ts` compares sparse results to independent dense solutions and
exhaustive small assignment oracles, including mixed conversion factors and fixed site openings.
The all-scenario source check uses an explicitly continuous entered haul quote; it does not change
a discontinuous user quote or the analytical station interval to obtain an economic result.
