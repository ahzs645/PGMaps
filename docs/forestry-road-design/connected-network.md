# Connected road access and haul

`roadNetwork.ts` is the pure connected-network model used by the full-cost road
comparison. It accepts reviewed road linework, access/vehicle/cost inputs, a dated
planning policy and named source, tie-in and outlet attachments. It does not read
the map renderer, issue network requests, or invent a connection because a road
lies near the proposed alignment.

## Geometry and junctions

Each source line retains its own vertices and directed segments. A shared known
grade-separation level permits endpoint connections within the entered snap
tolerance. Different known levels never connect. Unknown levels remain
disconnected unless the user explicitly allows unverified endpoint connections.
That assumption is retained in the path warnings.

Two lines crossing inside their segments do **not** form a junction automatically,
including crossings where both lines have a vertex. Interior connections require
the same declared junction ID and location on each road. Conflicting levels or
junction locations beyond tolerance reject the graph rather than quietly making
a different topology. A single-road declaration connects nothing else.

Attachments project onto actual line segments, not only stored vertices. An
attachment farther than its explicit tolerance is unavailable. No straight-line
haul is substituted. Attachments equally near different unjoined road sections are rejected unless
the physical road section is explicitly identified; an ambiguous bridge/ground
crossing cannot silently select the first record in an array.
Small accepted endpoint/attachment gaps remain visible in
`junctionGapM` and `attachmentDistanceM`, contribute to travel distance, and are
labelled assumptions. They are not measured reused-road length or a surveyed
new-road design. Source linework and declared topology still require field review.

All attachments used by one candidate comparison should be included in the same
graph build. This splits shared road portions at consistent locations so their
rehabilitation cost IDs can be deduplicated across source, access and return paths.
Graph IDs and tie-breaking are deterministic for the same input.

## Access, vehicle and condition policy

Existing roads must be individually enabled for reuse. Closed road access,
closed structures, entered closed condition and unresolved reviewed closure
evidence always exclude a road. A condition observation that ages out does not
silently reopen its unresolved closure.

The strict policy requires a consistent current positive condition assessment on
its `asOf` date. It uses each road's entered observation applicability windows;
missing, stale, conflicting or unreviewed evidence does not fall back to a manual
"serviceable" value. An explicit policy may instead use entered condition
assumptions. Unknown condition/access/restrictions require their own explicit
allowance switches and remain warnings.

Season and vehicle-class lists are exact planning categories. `['*']` explicitly
allows every value, `[]` permits none, and null means unknown. Vehicle and minimum
bridge-load limits use tonnes. A checked absence of structures is distinct from
unknown structure information. A condition classification or image never supplies
a bridge load rating. Entered structure restrictions apply conservatively to the
whole source road feature; split the feature when only one portion is restricted.

A present bridge also needs a separate `bridgeRating` record: source/report
reference, reviewer, documented rated tonnes, rating date, explicit valid-through
date and applicable vehicle-class tags. Under the strict restriction policy,
missing, unreviewed, future, expired or inapplicable rating evidence cannot establish
capacity on the planning date. An unknown expiry is unknown; the model invents no
inspection interval or unlimited validity. General road-condition observations,
including recent imagery, do not substitute for this record.

The editor binds a new record to the entered limit. Changing that limit or the
rating reference, dates or vehicle applicability clears the recorded review.
Both known entered and documented limits remain enforced, so an older 20 t report
cannot silently justify a later 100 t field edit. Explicitly allowing unknown
restrictions can include a missing/stale/unreviewed rating as a visible assumption;
it never overrides a known closure, overload or vehicle-class mismatch. The
reviewer is a user-entered assertion, not authenticated professional credentials.

One-way directions follow stored line coordinates. Known maximum uphill and
downhill grades in that forward direction are compared against the vehicle's
entered limits. Reverse traversal swaps uphill and downhill. Unknown grades are
blocked when a grade limit is requested unless unknown restrictions are explicitly
allowed. These are entered road/vehicle screening facts, not a terrain-derived
equipment or braking model. Outbound and return haul must each be searched as
directed paths; one is not silently reversed to obtain the other.

## Costs and path search

The model reports actual travelled metres, cost-weighted metres, reused metres,
snap gaps, attachment distances, path geometry and the actual road/edge IDs.
The haul factor scales travel metres for the entered haul rate; it is an explicit
cost assumption and is not inferred from road age, speed or condition.

Rehabilitation is charged on actual used portions. Access, structure and fixed
road allowances apply once per source road feature when any part is used. They
are feature-wide allowances, not geometrically located bridge upgrade estimates.
Split a feature when an allowance should apply only to a particular part.

Each cost has a stable item ID. Passing previously paid item IDs makes subsequent
source/access/return path costs marginal. The comparison can union those IDs to
charge a shared rehabilitation portion or road allowance once. Transport costs
still apply on every actual trip. Null costs stay unpriced; 0 is an explicit
entered zero. The graph never treats a missing cost as a known free repair.

The total-cost search is a bounded Dijkstra search that retains the set of paid
feature allowances in its state. Thus splitting a road at a source entrance does
not charge its setup again at every split edge. A weighted-distance screen can
return an explicitly incomplete path with null totals when unpriced costs are
allowed. Such a path cannot establish a lowest complete cost. Equal-cost choices
prefer shorter weighted distance, then stable IDs.

This model does not establish that public source linework is a complete physical
network, that a tenure is constructed, or that access permission exists. The
[BC road evidence guide](existing-roads.md) describes those source limitations.

## Limits and budgets

| Budget | Enforcing constant in `roadNetwork.ts` |
| --- | --- |
| 500 input roads; 20,000 source vertices | `MAX_NETWORK_ROADS`, `MAX_NETWORK_VERTICES` |
| 50,000 graph nodes; 75,000 edges | `MAX_NETWORK_NODES`, `MAX_NETWORK_EDGES` |
| 2,000,000 topology/attachment operations | `MAX_NETWORK_OPERATIONS` |
| 50,000 settled path states; 200,000 queued states | `MAX_NETWORK_PATH_STATES` (queued limit ×4) |
| 1,000,000 path transitions | `MAX_NETWORK_PATH_TRANSITIONS` |
| 1,000,000 accumulated paid-allowance state entries | `MAX_NETWORK_PAID_GROUP_ENTRIES` |
| 1,000 named attachments; 100 declared junctions per road | `buildRoadNetwork`, `parseRoadNetworkEvidence` |
| Snap and attachment tolerances between 0 and 50 m | `parseRoadNetworkPolicy`, `buildRoadNetwork` |
| Bridge rating reference ≤2,000 characters; reviewer ≤200; at most 50 vehicle tags | `parseBridgeLoadRatingEvidence`, `roadNetwork.ts` |
| Rated and entered bridge limits 0–1,000 t; explicit valid YYYY-MM-DD dates | `parseBridgeLoadRatingEvidence`, `parseRoadNetworkEvidence`, `roadNetwork.ts` |

Budget exhaustion rejects the operation. No truncated graph or unchecked partial
path is returned. Crop or split a large project and reduce redundant source data
before rerunning it.
