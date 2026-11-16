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

A road read from a RoadEng design brings RoadEng's subgrade fill material by range (Fill Types,
`*2` or a ground type code) as exact subgrade requirements, each marked _RoadEng fill type_ with
its ground type code. Editing them changes the design's ranges when the road is exported as a
RoadEng project (`roadEngFillMaterials.ts`; see `exports-and-project-files.md`); substitution by
quality and requirements on other layers stay here, as RoadEng's range row holds only the
subgrade fill's material.

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

`materialAllocation.ts` formulates a mixed-integer linear program. It is solved as a network flow
where the model is one (below, nearly always), else with the pinned `yalps` dependency. For each supported interval/material it accounts for all excavated bank
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
pit at the default rate, except by RoadEng's pit of last resort when the haul's **Pit of last
resort at the road's start** is on (below).

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

### Network flow (every road the network can hold)

`networkMaterialAllocation.ts` solves the same model as a minimum-cost network flow
(`minCostFlow.ts`, the primal network simplex with Cunningham's anti-cycling rule), and
`solveMaterialAllocation` tries it first. It holds the same supplies, demands, sites, material and
quality rules, construction directions, capacities, sidecast limits and prices, and minimizes the
same cost, so its optimum is the tableau model's (`networkMaterialAllocation.test.ts` checks 40
random roads with every rule against `solveDenseMaterialAllocation`):

- **Units.** Cut flows in compacted m³ (bank × its material's factor), its unsuitable part too, so a
  cut-to-fill movement needs no conversion inside the network; a unit going to waste is
  1/factor bank m³, and its haul, disposal cost and use of a site's bank capacity are scaled by that.
- **Pricing.** Every cut/fill pair is a possible movement, millions on a long road. The first
  network holds each source's `NETWORK_ALLOCATION_NEAREST` nearest compatible fills either side;
  after each solve every pair not in it is priced against the node potentials (the dual prices),
  the `NETWORK_ALLOCATION_ADD_PER_SOURCE` most cost-lowering per source are added, and the solve
  continues from the same tree. When no pair lowers the cost the plan is optimal for the full model:
  the potentials prove it. Any haul quote works, stepped or not.
- **Site openings** with a fixed cost are decided by branch and bound over the tableau model's own
  relaxation (fixed cost spread over capacity), at most `MAX_NETWORK_ALLOCATION_BRANCHES` branches.
- **Ties.** Where plans cost the same (zero rates), a tie-break far below a cent keeps material on
  the road and moves it least, and is taken out of every reported cost.
- **Checks.** Each source's bank cut and each fill's compacted volume conserved, no capacity
  exceeded, and the movements' cost equal to the solved cost, as for the tableau models.

Two models go to the tableau solvers instead, which say why when they are over their limits: a
capacity shared by materials of different swell factors that can actually fill up (a waste site or
sidecast stretch: one bank m³ is a different number of flow units for each material, which a
network cannot hold; `networkAllocationApplies` names the site), and the internal-use pass for
network pricing (`deferExternalSupply`). On LongRoad (27.7 km, 3,000 stations, 1,706 sources and
2,568 fills, six pits) the plan takes about a second: 7 pricing rounds, 223,045 movements priced
in, out of 4.4 million possible pairs.

For a proven continuous linear haul tariff with zero loading, `sparseMaterialAllocation.ts`
uses adjacent chain arcs instead of every source/demand pair. Reusable bank material has a fill
chain priced at its compacted conversion; bank disposal has a separate waste chain. The chains
retain material classes, station direction rules and shared physical site capacities/opening
decisions, and run the whole road: an arc over road with unknown earthwork costs its length. Solved chain flows are decomposed into the actual source-to-
destination movements and checked against the same objective. This is an exact change of model
representation for that tariff. Piecewise/discontinuous tariffs, loading charges and the external-
deferral pass use the general dense formulation. No tariff is approximated to make it fit.

## RoadEng's costing: optimal haul, pit of last resort and fill by material

A road read from a RoadEng design is costed as RoadEng costs it (`roadEngHaul.ts`,
`ROADENG_READ_HAUL`):

- **Economic plan by default.** RoadEng's costing is an optimal haul: "before reporting the haul
  cost, Softree Optimal solves an optimization problem to determine the lowest cost haul
  specification that balances material" (Optimal manual, chapter 3). The economic plan is the same
  calculation, and on the costed samples it comes nearer RoadEng's haul than nearest-site
  allocation wherever material moves far: LongRoad's haul is 1.59 M against RoadEng's 0.78 M, where
  nearest-site gave 3.98 M; the cul-de-sac 190 k against 216 k (nearest 203 k). On short roads that
  barely move material the two are close (bluff road: both 2,952 against 3,063). Switching a road
  to nearest-site allocation travels in `[PGMaps] Costs`.
- **Pit of last resort** (`HaulSettings.lastResort`, `lastResortPits.ts`). RoadEng accounts for all
  of every material: what no pit, cut or sidecast can take goes to an overflow pit and what none
  can give comes from an underflow pit, both at the start of the alignment, used only when every
  other way is exhausted, underflow priced from the ground type table (manual, chapter 3,
  "Overflow and Underflow"). Here they are a waste site with no disposal cost and one borrow site
  per earthwork material at its excavation rate per compacted m³, at chainage 0 and unlimited,
  added for each calculation and never stored; the network plan gives them a priority penalty of
  `LAST_RESORT_PRIORITY` times the largest per-m³ cost so it uses them only where nothing else
  serves, and takes it out of every cost. The tableau solvers, when they run, price them at their
  rates alone. Nearest-site allocation tries them after every other site. The haul's _Pit of last
  resort at the road's start_ box switches it; a road not read from RoadEng starts with it off.
  Without it the cul-de-sac (no waste pit), Hart Rd and Location 18 were infeasible.
- **Fill by material** (`fillPlacement.ts`, `GroundMaterial.fillRate`). RoadEng's embankment cost is
  per ground type, and RoadEng reports fill as the bank volume of the material placed (Softree,
  "Expansion and compaction": fill volume times the fill expansion factor). Each material's fill
  placement rate is per bank m³ of it; fill made of it is priced at the rate ÷ its compaction
  factor per compacted m³, a cut-to-fill movement by the bank volume moved and a borrow by its
  compacted volume. Fill no movement accounts for is priced by its interval's required material,
  else at the project's fill rate, which also prices every road whose materials have no rate of
  their own. The covered estimate lists one fill row per material.
- **Stored results.** The five costs are haul, cut, fill, pit opening and attributes; RoadEng's cut
  includes borrow and underflow excavation, so the comparison sets the road's cut plus borrow beside
  it (`roadEngStoredResults.ts` says what each sample shows).

The eleven costed designs (`roadEngCostedSamples.test.ts`, run with `ROADENG_SAMPLES` and
`ROADENG_SAMPLE_PACK`), RoadEng's stored costs against this workspace's with the economic plan, the
pit of last resort and fill by material, in the design's currency, on 15 November 2026 with every
other change of that day:

| Design                              | RoadEng cut / fill / haul | PGMaps cut + borrow / fill / haul | Notes                                                 |
| ----------------------------------- | ------------------------- | --------------------------------- | ----------------------------------------------------- |
| LongRoad                            | 7.55 M / 2.12 M / 0.78 M  | 7.22 M + 1.61 M / 1.99 M / 1.59 M | 44,843 m³ of SR borrow from pits 7 km off the road    |
| Cul-de-sac                          | 1.35 M / 184 k / 216 k    | 1.27 M / 179 k / 190 k            | 61,540 bank m³ to overflow at the road's start        |
| Align stage 4                       | 340 k / 100 k / 16.2 k    | 248 k + 14 k / 102 k / 12.9 k     | underflow GR and HP; nearest-site haul 17.3 k         |
| Align stage 7                       | 476 k / 117 k / 18.9 k    | 386 k + 199 k / 102 k / 48.6 k    | CS fill read as exact: 12,707 m³ from underflow       |
| Align stage 8 (and 8a)              | 416 k / 97.0 k / 13.7 k   | 386 k + 145 k / 83.4 k / 43.4 k   | CS and RR fill read as exact: 9,232 m³ from underflow |
| Bluff road (×2)                     | 52.3 k / 1.8 k / 3.1 k    | 50.2 k / 1.7 k / 3.0 k            |                                                       |
| Hart Rd (and optimal, optimal haul) | 384 k / 56.4 k / 34.6 k   | 423 k + 2 k / 48.4 k / 41.5 k     | GR and SR fill exact                                  |
| Hart Rd curves                      | 336 k / 58.2 k / 15.0 k   | 391 k / 50.1 k / 32.0 k           |                                                       |
| Location 18 (×3)                    | 140 k / 36.6 k / 6.6 k    | 136 k + 35 k / 47.2 k / 56.1 k    | CO fill read as exact: all from underflow             |

Cut and fill volumes differ with the section, which other changes of the same day settle. Where
haul and borrow run far over RoadEng's (stages 7 and 8, Location 18), the fill type is read as an
exact material, so fill no cut of that type can give comes from underflow at the road's start;
RoadEng lets any material of the same or higher quality fill it (Optimal manual, chapter 3, Quality
Factor), which the fill-range import does not yet apply. On the fill, RoadEng's per-bank basis fits
the cul-de-sac (its overburden shrinks: 179 k against 184 k, where a per-compacted rate gives 143 k);
Hart Rd and LongRoad come nearer RoadEng with a per-compacted rate (58.0 k and 2.07 M), but their
sections already differ by 10 to 17 % in cut, so they do not decide it; Softree's documentation of
fill expansion is the basis taken.

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

- **Results stored in the design.** For a road read from a RoadEng design the dialog opens on
  **Results stored in the design**, with nothing to export from RoadEng: the active vertical
  alignment's last costing (else its last optimization), read from the design's `.dsn`
  (`roadEngStoredResults.ts`, `compareRoadEngDesignResults`). Its haul, cut, fill and pit opening
  costs are set beside the road's in the same columns, from the road's Optimal Haul cost summary
  when haul allocation is solved (cut includes borrow bought from sites, as RoadEng's does) and from
  its earthwork costs otherwise, with no haul; RoadEng's attribute costs, where not zero, have no
  counterpart and never agree. Its first and last stations costed are set beside the road's ends and
  agree within 0.5 m (`STORED_RANGE_TOLERANCE_M`); a costing that covers less of the road is said,
  and so are stretches the road's quantities leave out for missing terrain. Other vertical
  alignments' solutions are listed under _Only in the design_. Costs stay in each side's currency.
  RoadEng greys a solution out once its design changes, and neither side knows of the other's edits,
  so the notes give the date RoadEng solved it. **A RoadEng or Softree file** switches to the files
  below.

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
  largest relative difference first; _Differences only_ hides the rest. A row's station button
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
(`softreeCompare.test.ts`, `tests/e2e/forestry-road-softree-compare.spec.ts`). Three samples store a
solved costing (LongRoad, the cul-de-sac's first alignment, Align stage 1; `roadEngStoredResults.test.ts`);
the dialog's stored results are checked on a design the page writes with a costing added by hand
(`tests/e2e/forestry-road-roadeng-stored-results.spec.ts`). The sample pack adds eight more costed
designs (`roadEngCostedSamples.test.ts`, above), and a generated RoadEng project checks the economic
plan, the pit of last resort and fill by material on the page
(`tests/e2e/forestry-road-roadeng-optimal-haul.spec.ts`).

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
| Network plan: 200,000 nodes; 3,000,000 movement arcs; 60,000,000 pairs priced a round; 60 rounds              | `MAX_NETWORK_ALLOCATION_NODES`, `_ARCS`, `_PAIRS`, `_ROUNDS`, `networkMaterialAllocation.ts`  |
| Network plan: 12 nearest fills each side to start; 48 pairs added per source a round                          | `NETWORK_ALLOCATION_NEAREST`, `NETWORK_ALLOCATION_ADD_PER_SOURCE`                             |
| Network plan: 12 priced site openings, 256 branches                                                           | `MAX_NETWORK_ALLOCATION_OPENINGS`, `MAX_NETWORK_ALLOCATION_BRANCHES`                          |
| Pit of last resort: priority penalty 100 × the largest per-m³ cost                                            | `LAST_RESORT_PRIORITY`                                                                        |
| What-if balance line: 400 layers per loop plus one break at every vertex height; within the curve's own range | `BALANCE_LINE_LAYERS`, `balanceLevelRange`, `balanceLine.ts`                                  |
| Mass Haul export: 400 layers per loop, as the balance line                                                    | `MASS_HAUL_LAYERS`, `massHaulItems`                                                           |
| Softree CSV read: 100 MB / 2,000,000 rows; Areas file 500 code pairs a record                                 | `MAX_SOFTREE_CSV_BYTES`, `MAX_SOFTREE_CSV_ROWS`, `MAX_OPTIMAL_AREA_PAIRS`                     |
| Optimal material descriptions: 50 characters                                                                  | `OPTIMAL_DESCRIPTION_CHARS`                                                                   |
| Compare with RoadEng: 50 MB file; 400 rows drawn (the comparison CSV holds every row); agree within 0–50 %    | `MAX_COMPARE_FILE_BYTES`, `MAX_COMPARE_ROWS_SHOWN`, `MAX_COMPARE_RELATIVE_PERCENT`            |
| Compare with RoadEng: rounding tolerance and Areas station match                                              | `COMPARE_ABSOLUTE_TOLERANCE`, `COMPARE_STATION_TOLERANCE_M` (0.01 m)                          |
| Compare with RoadEng: a stored costing's first and last stations agree with the road's ends (0.5 m)           | `STORED_RANGE_TOLERANCE_M`                                                                    |

The sparse formulation has the same 20,000-variable / 1,200-constraint / 3,000,000-cell ceilings,
enforced by `MAX_SPARSE_ALLOCATION_*` in `sparseMaterialAllocation.ts`.

The pivot limit grows with the model. These flows finish in about one pivot per tableau row
(two rows per equality constraint), so four per row leaves room; an earlier limit divided a fixed
500 million tableau updates by the tableau size and so allowed fewer pivots the larger the model
was. A 930 m road with three materials that could substitute for one another by quality needed
about 1,300 pivots and was allowed 268, which was reported as a numerical cycle.
`qualitySubstitution.test.ts` holds that case, a three-interval quality case worked by hand
($1,228) and a road-sized case checked against a closed-form optimum.

The tableau models' limits now bind only on what the network flow leaves to them (a shared
capacity of mixed swell, the internal-use pass). There a stepped haul quote needs the dense model,
which has one variable per compatible cut-interval/fill-interval pair, and a road of about 90
intervals exceeds the tableau limit and reads **Material plan not solved**; the message says why the
network could not take it. See [known issues](known-issues.md).

Economic work grows with the number of source/demand interval pairs. A very long road at a fine
station interval may still pass the network's limits. Increase
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
`minCostFlow.test.ts` checks the network simplex against worked transport problems and 60 random
networks solved as linear programs; `networkMaterialAllocation.test.ts` checks the network plan
against the dense tableau on 40 random roads with every rule, a 3,000-station road past every
tableau limit, the refusal of a mixed-swell shared capacity, the tie-break and the pit of last
resort; `fillPlacement.test.ts` the fill priced by material.
`sparseMaterialAllocation.test.ts` compares sparse results to independent dense solutions and
exhaustive small assignment oracles, including mixed conversion factors and fixed site openings.
The all-scenario source check uses an explicitly continuous entered haul quote; it does not change
a discontinuous user quote or the analytical station interval to obtain an economic result.
