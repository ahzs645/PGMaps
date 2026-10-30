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
pit at the default rate. A timeout, numerical cycle, model budget failure or failed conservation
check produces an explicit calculation error; a partial solver incumbent is not adopted.

The solver result is independently checked against every supply, demand and capacity equation,
its opening binaries, and the reconstructed movement cost before it reaches the workspace.

For a proven continuous linear haul tariff with zero loading, `sparseMaterialAllocation.ts`
uses adjacent chain arcs instead of every source/demand pair. Reusable bank material has a fill
chain priced at its compacted conversion; bank disposal has a separate waste chain. The chains
retain material classes, station direction rules, disconnected coverage runs and shared physical
site capacities/opening decisions. Solved chain flows are decomposed into the actual source-to-
destination movements and checked against the same objective. This is an exact change of model
representation for that tariff. Piecewise/discontinuous tariffs, loading charges and the external-
deferral pass use the general dense formulation. No tariff is approximated to make it fit.

## Construction direction and sidecast

**Forward** means increasing chainage; **backward** means decreasing chainage. A movement must
satisfy every range it crosses. A **blocked** range prevents transfer across it, while same-station
handling crosses no range. These constraints are independent of one-way restrictions on the
existing-road network. No material moves across a terrain/daylight gap.

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

## Limits and verification

| Limit | Enforcing constant / behavior |
| --- | --- |
| 200 fill requirements | `MAX_FILL_REQUIREMENTS`, `allocationPolicy.ts` |
| 100 direction and 100 sidecast ranges | `MAX_HAUL_DIRECTION_RANGES`, `MAX_SIDECAST_RANGES` |
| 20,000 material-flow variables | `MAX_ALLOCATION_VARIABLES`, `materialAllocation.ts`; the tableau memory budget can bind first |
| 1,200 constraints; 3,000,000 conservative tableau cells | `MAX_ALLOCATION_CONSTRAINTS`, `MAX_ALLOCATION_TABLEAU_CELLS` |
| 12 positive-price site openings | `MAX_ALLOCATION_OPENINGS` |
| 2,048 branch iterations; 3-second integer-search timeout | `MAX_ALLOCATION_BRANCHES`, solver options |
| At most 8,192 simplex pivots, reduced for larger tableaux | `MAX_ALLOCATION_TABLEAU_UPDATES`, approximately 500 million tableau updates |

The sparse formulation has the same 20,000-variable / 1,200-constraint / 3,000,000-cell ceilings,
enforced by `MAX_SPARSE_ALLOCATION_*` in `sparseMaterialAllocation.ts`.

Economic work grows with the number of source/demand interval pairs. A long road at a fine station
interval may exceed the browser budget even when its ordinary quantities calculate. Increase
station spacing only after a quantity convergence check, reduce redundant material definitions
and candidate sites, or split a design at a defensible construction boundary. The app does not
silently truncate its economic model or label the old heuristic an optimum.

`materialAllocation.test.ts` checks independently worked and exhaustively enumerated transport
optima, shared fixed pit openings, scarce quality capacity, unknown material, bank/compacted
conservation, course/component demand, finite disposal, direction/gap rules and local sidecast.
`fullCostComparison.test.ts` additionally checks exact named courses, external quality reservation,
direction-blocked deliveries and internal rock used in a surface course without double buying.
`sparseMaterialAllocation.test.ts` compares sparse results to independent dense solutions and
exhaustive small assignment oracles, including mixed conversion factors and fixed site openings.
The all-scenario source check uses an explicitly continuous entered haul quote; it does not change
a discontinuous user quote or the analytical station interval to obtain an economic result.
