# Comparing horizontal alternatives using connected access and material costs

The full-cost comparison ranks a finite set of checked **new connector** geometries.
Different existing-road tie-ins can change both the access work and the distance to
material sources. Gravel prices, actual network haul, bridge/access allowances and
rehabilitation therefore can change which horizontal geometry wins. The existing
terrain-route and corridor searches retain their separate candidate-generation
objectives; the full-cost stage compares their resulting geometry and quantities.

`fullCostPlanning.ts` owns the persisted `RoadProject.totalCostPlanning` inputs.
`fullCostComparison.ts` evaluates alternatives without DOM, network requests or map
elevations. `roadNetwork.ts` supplies actual connected paths, while
`connectorChecks.ts` checks the final fitted new-road geometry. A priced comparison
is a record of entered planning assumptions, not a construction approval.

## In the workspace

Open **Design → Compare complete route costs**. In **Setup**, choose the assessment date,
reviewed outlet, vehicle and operating restrictions, haul quotes and final connector criteria.
Use **Review network roads and evidence** to enter each reused section's restrictions,
rehabilitation and structure allowances, and dated condition evidence. In **Sources**, enter
physical entrances, confirmed supply/disposal applicability, capacities and component prices.
Changing a source entrance requires reviewing its confirmations again; switching between bank
waste and compacted aggregate clears quantities and prices that use a different volume basis.

**Calculate route comparison** checks entered alternatives sharing the active road's start and
generates a bounded set of additional terrain connectors. **Results** shows the combined ledger,
actual haul paths and named blockers for every candidate. **Preview** opens that exact fitted
connector in the plan, profile and sections. **Use** adds a separate checked road and saves its
complete access cost, leaving the entered alternatives available for comparison.

The header and saved-cost card identify an adopted **Complete access cost** separately from
the base engineering estimate. Changing geometry, terrain, settings, source quotes, network
restrictions or evidence marks the comparison stale and requires recalculation. Project JSON
retains the full review record; **Export comparison evidence** also saves unsuccessful
candidates and their blockers. The [offline training example](full-cost-training-scenario.md)
demonstrates the gravel-haul and rehabilitation tradeoffs without live data services.

## Inputs that must be explicit

Choose a planning date and a physical network outlet/gateway. The same date controls
the network's dated condition assessment. Select the season, vehicle class, loaded
weight, restrictions and road evidence needed by the network policy. Road access,
bridge capacity and current condition are separate inputs; an old road line or
recent satellite image cannot supply all of them.

Each material source needs a reviewed physical entrance, access and material/acceptance
review, supported uses, capacity and prices. A pit polygon centre is never substituted
for an entrance. `null` prices remain unknown; an explicitly entered `0` is allowed.
An optional source entrance road ID and outlet road ID disambiguate overlapping
roads or grade-separated crossings; the graph must not choose an unrelated road
level merely because it is closest in plan.
Compacted aggregate capacity may be shared between surfacing and external fill. A
waste destination uses bank m³ and must have its own capacity and source record.
Unbounded capacity is an explicit planning scenario, not a measured reserve.

For every transported m³, the material quote is:

`acquisition or disposal + processing + loading + placement`.

Loading and handling remain when acquisition is free. Source preparation is charged
once per selected source. The loaded network rate and empty-return rate are separate
CAD per payload-equivalent m³·km. Enter an explicit zero return rate when the loaded
quote already includes that operating cost; the return route must still exist.

## Actual paths and quantities

The new connector must meet the existing network at one of its endpoints. The
comparison requires a permitted directed path from that tie-in to the outlet and
another path back. Every used source/destination likewise needs both loaded and
empty directed paths. Direction, access, season, vehicle/load restrictions, closures
and unknown costs come from the reviewed graph policy. The empty route can be longer
than the loaded route. A nearby disconnected pit cannot supply material through a
straight-line shortcut.
Both directions use the selected vehicle restriction policy conservatively; a
lighter empty-truck weight or different empty-vehicle grade envelope is not inferred.

The graph is built once with **all** candidate, source and outlet attachments. This
keeps physical split-edge rehabilitation IDs stable. Rehabilitation along a reused
physical edge, road access, structure allowances and fixed setup items are charged
once across the selected outlet, loaded and return paths. They are not charged once
for each trip or each source. An attachment tolerance covers registration uncertainty;
it does not certify a missing off-road driveway or construct a connector.

Quantities come from `analyzeFullCostConnector`. It retains entered templates,
materials, stripping, culverts and internal cut-to-fill assumptions, and recalculates
internal transfers with external haul sites removed. Surfacing uses the engine's
same width/depth integration. External fill is interval fill minus allocated internal
cut-to-fill; bank waste is interval cut minus bank material used internally. Parcel
sums are checked against the engine totals. Missing terrain/daylight, stale geometry
or mismatched quantities cannot produce a priced winner.

Source deliveries add the actual new-road chainage from the network endpoint to each
demand parcel. Loaded and empty costs include both the existing network and the new
connector. The new-road formation must also satisfy the loaded grade limits in the
actual material direction: inbound aggregate can travel opposite outbound timber.
The comparison uses the final checker's signed formation-grade extrema for this
additional gate.

## What enters the ledger

The comparison retains new excavation, stripping, clearing, new structures,
mobilization, internally supplied fill placement and internal cut-to-fill haul.
It replaces the engine's legacy surfacing, external borrow/disposal, external haul,
site preparation and externally supplied fill placement with the explicitly priced
sources and network paths. External fill placement is not charged both through the
base fill rate and the source quote. Contingency is applied once to the combined
subtotal. Historical whole-project or appraisal allowances should not be entered
again as source or road setup costs if they already cover the same work.

Capacity allocation first verifies that the eligible sources can jointly satisfy
all required material uses. A maximum-flow capacity check reserves shared supply
for uses that other sources cannot support. The bounded allocator then compares
delivered source batches, including marginal loaded/return routes and unpaid setup.
Each selected source share is distributed over that material use's station parcels.
The outlet access path is selected first; each loaded path is followed by its
empty-return search using the costs already paid. Those sequential choices are
part of the stated heuristic, rather than a joint minimum over every activated
road and round-trip circuit.
This is a reproducible heuristic; it is not a global solution for pit activation,
every possible haul circuit, scheduling or every possible horizontal road.

Only alternatives with passed final checks, complete quantities, connected permitted
paths, sufficient reviewed capacity and every required price receive `status:
feasible` and a numeric total. `infeasible` and `unpriced` rows retain their reasons
and cannot win. There is no base-price or Euclidean fallback for missing supply.
The winner is the lowest complete entered total among the compared alternatives.
The access-to-outlet paths price construction/reuse access work; lifetime timber
freight, production scheduling and fleet queuing are not inferred from this ledger.

### Clearing beyond the daylight prism

The engine already prices its computed daylight-prism clearing. A positive final-check
`clearingExtraM` adds `2 × allowance × fitted connector length` square metres to that base,
at the same entered clearing rate. This extra cost appears in **new construction**, once,
before the single contingency calculation. The rate is recovered from the unrounded engine
clearing cost divided by its clearing area; an unresolved rate leaves the candidate unpriced.

The extra allowance uses the same conservative longitudinal station-strip convention as the
footprint screen. It does not subtract self-overlap on tight curves or overlap at junctions;
it is not a GIS union-area calculation, timber valuation, grubbing or disposal model. The
comparison evidence records the area, rate and this convention. Base engine clearing is not
added twice, and surfacing/material demand is unchanged by the clearing-only allowance.

## Limits and verification

| Limit                                                            | Enforcing code                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| 8 horizontal alternatives per comparison                         | `fullCostComparison.ts`, `MAX_FULL_COST_CANDIDATES`    |
| 30 supply/disposal records                                       | `fullCostPlanning.ts`, `MAX_FULL_COST_SOURCES`         |
| 10,000 network path searches per comparison                      | `fullCostComparison.ts`, `MAX_FULL_COST_PATH_SEARCHES` |
| 300 material batches per alternative                             | `fullCostComparison.ts`, `MAX_FULL_COST_ALLOCATIONS`   |
| Source capacity 0–10¹² m³; source notes at most 2,000 characters | `fullCostPlanning.ts`, `parseTotalCostPlanning`        |
| Road graph, attachment, state and transition limits              | `roadNetwork.ts`; see the connected-network guide      |

The actual-graph regression suite demonstrates that truck haul prices and
rehabilitation allowances change the chosen horizontal geometry. It checks closed,
overweight, seasonal and disconnected supply routes; a free but disconnected pit;
separate directed empty-return routes; finite and shared capacity; bank waste;
retained handling at zero acquisition; quantity conservation; once-only road/source
costs; external fill placement replacement; and one application of contingency.
