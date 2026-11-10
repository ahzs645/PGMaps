# Haul destinations and junction turns

**Review → Haul** says where a road's wood goes: pick a destination, and the panel gives the haul
distance and cycle time from the road's junction, and the turn a loaded truck makes there. **Access
from FSR** can place each new road's junction along its host so that turn is mild. The Review list
judges the turn in the row **Junction turns loaded trucks toward the destination**.

The rule comes from a field person's practice: a new road should meet its host so a loaded log
truck turns out toward the mill through a mild turn, and a spur should bend back toward the
direction of travel. The haul destination decides which way that is, so it has to be chosen. Cycle
time matters because it drives appraisal and stumpage.

The code is `haulDestination.ts` (network, routing, cycle time), `junctionOrientation.ts` (turns,
candidate junctions, search heading), `haulReview.ts` (project inputs, the per-road review) and
`HaulPanel.tsx`. All but the panel are free of DOM and network access.

## Before you rely on it

- **Load the roads the haul uses.** The route runs only over roads in the project: mapped roads
  (FSRs, road permits, other imported roads) and this project's own roads. Past them the haul is
  a straight line times a detour factor and is labelled estimated. If the loaded roads around a
  block form a pocket with no way out of the loaded area, the panel says the haul was assumed to
  leave by the dead end nearest the destination, which may be a spur. Load the roads out to a
  highway, or import them as mapped roads, before you trust the direction.
- **Replace the speeds.** Every speed and terminal time starts as a placeholder (see
  [Built-in assumptions](#built-in-assumptions)). They are not sourced, and cycle time is only as
  good as they are. A blank speed leaves that class's time unknown; it is never counted as zero.
- **A destination is a town centre.** The presets are BC Interior town centres, not mills.
  The last kilometres into a town are part of the straight-line estimate. Use **Custom point** for
  a mill gate, reload or sort yard.
- **The junction must touch a road.** A road end is a junction only if it lies within 15 m of a
  loaded road or another road in the project. A road with no such end is not assessed.
- **The turn is measured on the centreline.** It reads the last 50 m of the analysed road and the
  first 30 m of the haul beyond the junction. Junction flare, radius, sight distance and
  intersection layout are not designed.
- **The search enforces a heading, not a junction design.** Orienting a junction holds the first
  terrain-cost route's arrival within the route search's ±45° window. The route goals compared
  after it (corridor optimizer, Find the best route) keep the moved junction but not its heading,
  so read each row's loaded turn.

## How it works

### The haul network

`buildHaulNetwork` makes a graph of every open mapped road in the project (closed roads and roads
whose lifecycle is not ACTIVE are left out) and every other road of the project. Each vertex is a
node. A road end that lies within 25 m of another road's line is joined to it there, because
mapped roads often stop short of the road they join. Lines that only cross are not joined: a
crossing in mapped linework does not establish a junction (the same rule as
[the connected-network model](connected-network.md)). A closed loop's two ends are one node.

Roads are classed by their source record: Forest Service Road, road permit road, other mapped road,
or new road (this project's roads). Beyond the loaded roads there is one more class, estimated.

### Where a haul leaves the loaded roads

`haulField` runs one multi-source search from the ways out toward every node, by round-trip
minutes at the entered speeds. A haul may leave the loaded roads at:

- a dead end within 500 m of the loaded roads' outer extent, where a loaded road runs out of the
  data; or
- any point within 2 km of the destination.

From there it is the straight line to the destination times the detour factor, at the estimated
class's speeds. A dead end inside the loaded area is taken for a spur and is not a way out, so a
spur pointing at the destination cannot pull the route the wrong way. The exception is a group of
joined roads with no way out at all (patchy loaded data, often roads clipped around blocks): there
every dead end of a mapped road may be the way out, the search takes the fastest, and the route
says it was assumed.

### Cycle time

`haulRouteFrom` joins the junction to the nearest loaded road within its tolerance, leaves it in
whichever direction gives the faster round trip, and lists legs by road class, with the new road
itself (from the road's far end to the junction) as the first leg. For each leg:

```text
loaded minutes = length km / loaded km/h × 60
empty minutes  = length km / empty km/h × 60
cycle          = Σ loaded + Σ empty + loading + unloading + delay
```

A leg with no entered speed has no time, so the totals that include it are unknown. The route is
ranked meanwhile at the slowest entered speed, so a missing speed changes which way is fastest
only as a slow road would.

### The junction turn

The loaded turn is the angle between the heading a truck arrives on (the new road's last 50 m into
the junction) and the heading it leaves on (the first 30 m of the haul): 0° drives straight on,
90° is a right-angle tee, 180° is a full hairpin. **Largest turn** (default 90°) is the limit;
**Preferred turn** (default 45°) is what a placed junction aims for.

When a road's two ends both meet loaded roads, the junction judged is the one with the faster
haul, and the row says so. Loaded travel on the road runs toward that end; the panel shows that
direction and offers to set it as the loaded direction in **Design standards**, which the
adverse/favourable grade checks read. That setting is shared by every road in the project, so
it is never set automatically.

### Placing a junction

With **Orient junctions toward …** on in **Access from FSR** (and in the `suggestBlockAccess` and
`suggestFsrConnections` options), `junctionCandidates` samples the host every 20 m within
**Window** (default 300 m) either side of its nearest point to the landing. Each point is scored
by the straight approach from the landing plus 3 m per degree its straight approach would turn
above the preferred turn, and 9 m per degree above the largest turn. Up to three candidates,
at least 40 m apart along the host, are tried best first; each is a full route search whose
arrival is held within ±45° of a heading shifted to the side the road comes from, so the window
spans turns from (largest − 90°) to the largest. The first that the search can reach wins. If
none can, the nearest point is used without a heading and the row says **nearest point**.

Block access ranks an option within the turn limit ahead of one that is not, whatever its search
score. A spur joining another road of the project is judged the same way, so a branch is judged
toward its parent road.

## Limits and budgets

| Limit                                | Value                               | Enforced in                                                               | What happens when exceeded                                             |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Roads in one haul network            | 50,000                              | `haulDestination.ts`, `MAX_HAUL_ROADS`                                    | The haul is not traced; the row is not assessed and names the limit    |
| Road vertices in one haul network    | 1,000,000                           | `haulDestination.ts`, `MAX_HAUL_VERTICES`                                 | As above                                                               |
| Road-end join distance               | 25 m                                | `haulDestination.ts`, `HAUL_SNAP_TOLERANCE_M`                             | Ends further apart stay unjoined                                       |
| Junction to loaded road (haul start) | 30 m                                | `haulDestination.ts`, `HAUL_ATTACH_TOLERANCE_M`                           | The haul from that point is unknown                                    |
| Road end counted as a junction       | 15 m                                | `haulReview.ts`, `JUNCTION_CONTACT_M`                                     | The road is not assessed                                               |
| Dead end counted as a way out        | Within 500 m of the extent          | `haulDestination.ts`, `HAUL_EXIT_EDGE_M`                                  | Treated as a spur unless its group has no other way out                |
| Destination reach                    | 2 km                                | `haulDestination.ts`, `HAUL_DESTINATION_REACH_M`                          | Loaded roads further away leave by an exit and the estimate            |
| Departure heading window             | 30 m                                | `haulDestination.ts`, `HAUL_DEPARTURE_WINDOW_M`                           | —                                                                      |
| Arrival heading window               | 50 m                                | `junctionOrientation.ts`, `JUNCTION_ARRIVAL_WINDOW_M`                     | A road shorter than 1 m has no arrival and is not assessed             |
| Speeds                               | 1–120 km/h or blank                 | `haulDestination.ts`, `HAUL_LIMITS.speedKmh`; `haulReview.ts` parser      | The project file is refused                                            |
| Loading, unloading, delay            | 0–600 min each                      | `HAUL_LIMITS.terminalMin`                                                 | As above                                                               |
| Detour factor                        | 1–3 (default 1.4)                   | `HAUL_LIMITS.offNetworkFactor`, `DEFAULT_OFF_NETWORK_FACTOR`              | As above                                                               |
| Largest turn                         | 45–90° (default 90°)                | `junctionOrientation.ts`, `JUNCTION_RULE_LIMITS`, `DEFAULT_JUNCTION_RULE` | As above. 90° is the widest the ±45° search window can hold            |
| Preferred turn                       | 0° to the largest (45°)             | `JUNCTION_RULE_LIMITS`, `parseJunctionRule`                               | As above                                                               |
| Junction window along the host       | 0–1,000 m (default 300 m)           | `JUNCTION_RULE_LIMITS`                                                    | As above                                                               |
| Candidate spacing / tries            | 20 m / 3, at least 40 m apart       | `JUNCTION_STEP_M`, `MAX_JUNCTION_TRIES`, `MIN_JUNCTION_SEPARATION_M`      | Each try is a full route search; then the nearest point is used        |
| Turn charge when placing             | 3 m per degree (×3 above the limit) | `JUNCTION_TURN_PENALTY_M_PER_DEG`                                         | —                                                                      |
| Search heading window                | ±45°                                | `routing.ts`, `headingOk`; mirrored as `ROUTE_HEADING_WINDOW_DEG`         | The route search finds no route at that junction and the next is tried |

A network of 635,000 nodes (a regional road atlas) builds in about 0.6 s and searches in about
0.2 s on a laptop; the project's loaded roads are usually far smaller.

## Built-in assumptions

| Road class                          | Loaded km/h | Empty km/h |
| ----------------------------------- | ----------- | ---------- |
| New road (this project)             | 15          | 20         |
| Forest Service Road                 | 40          | 50         |
| Road permit road                    | 35          | 45         |
| Other mapped road                   | 30          | 40         |
| Beyond the loaded roads (estimated) | 55          | 65         |

- **Speeds are user-entered placeholders.** They are not taken from an appraisal manual or a
  study. They keep the order a field person expects (a new spur slowest, an FSR fastest, loaded
  slower than empty) and are near the speeds the TFL 30 layout study assumed (FTEN 40, resource
  road 45, highway 80, new spur 15 km/h, one speed both ways). Enter the operation's own.
- **Loading 30 min, unloading 20 min, delay 0** are placeholders.
- **Detour factor 1.4** is the middle of the 1.3–1.6 ratio of network to straight-line distance
  measured for the TFL 30 layout to Prince George.
- **One speed per class.** Grade, curvature, surface, season and traffic do not change it, and
  the adverse-grade checks do not feed it.
- **The route is the fastest round trip,** not the legal or contracted haul route, and does not
  check access rights, load limits, bridges or seasonal closures. For those, use the
  [connected-network model](connected-network.md).
- **A destination preset is a town centre.** Coordinates are approximate town centres, rounded to
  about 100 m.

## Failure modes

- **Patchy loaded roads.** When the loaded roads have no way out, the direction comes from the
  dead end nearest the destination. On the TFL 30 layout with only the roads around the blocks
  loaded, 17 of 21 junctions were judged this way. The panel's note says so; load more roads.
- **A long mapped road reaching far out of the area** stretches the extent, so dead ends of other
  roads that are really exits may sit inside it. The fallback above covers only groups with no
  way out at all; a group with one distant exit uses it.
- **A missing road between two loaded roads** (one not in any loaded dataset, e.g. a road traced
  from imagery) breaks the group. Draw or import it as a mapped road.
- **Duplicated linework** (an FTEN section drawn on top of the same road from another dataset)
  makes parallel edges. The route takes either; distances are unaffected but the class it reads
  may be the other dataset's.
- **A junction on a road end** (a new road joining where a mapped road stops) gives a departure
  bearing along that road only if the road continues; at a true dead end that is also a way out,
  the departure is unknown and the row is not assessed.
- **Speeds left blank** make cycle time unknown, as intended. The panel names the class.

## Checked against the TFL 30 layout

The module was checked locally against a hand-drawn operational layout (22 roads, 19 blocks) that a
separate study had measured against a 35,000-feature road atlas and a time-weighted network route
to Prince George. The layout data is not in this repository; only aggregate figures are reported.

| Network loaded                                   | Junctions assessed | Same direction as the study | Mild/not mild agrees | Turn within 10° | One-way distance ÷ study's |
| ------------------------------------------------ | ------------------ | --------------------------- | -------------------- | --------------- | -------------------------- |
| Regional road atlas plus tenure roads            | 21 of 21           | 20                          | 20                   | 9 (median 12°)  | 0.99–1.05 (median 1.02)    |
| Only the roads around the blocks (as in the app) | 21 of 22           | 16                          | 16                   | 15 (median 6°)  | 0.99–1.28 (median 1.02)    |

With only local roads, 17 junctions relied on the assumed-exit fallback and about 61 km of each
haul was the estimate. The study found that the straight-line bearing to the destination disagrees
with the network route at 5 of 19 junctions, so the local-only result is no better than a bearing
guess; load the haul roads.

Junction placement was checked by putting a landing 150 m along each drawn road from its junction
on a mapped host (18 roads) and comparing the junction chosen with the drawn one:

| Junction                                 | Median distance to the drawn junction | Median loaded turn of a straight approach | Over 90° |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------- | -------- |
| Nearest point on the host (the old rule) | 87 m                                  | 88°                                       | 5        |
| Best placed candidate                    | 67 m                                  | 47°                                       | 1        |

The placed candidate was closer to the drawn junction for 10 of the 18. The drawn roads' own turns
had a median acute angle of 45° to the host, and 15 of 21 were under 90° toward the haul.
