# Existing roads, condition and reuse

The **Existing roads & reuse** panel loads Forest Tenure Road Section Lines from
the [BC Data Catalogue](https://catalogue.data.gov.bc.ca/dataset/243c94a1-f275-41dc-bc37-91d8a2b26e10),
or imports WGS84 GeoJSON linework supplied by a user. The catalogue query covers
the current map extent when supplied by the workspace, otherwise the road
alignments plus about 1 km on each side. It retrieves complete section geometry,
which can extend beyond the query box. It does not claim every road is represented.

## Facts and assumptions

The loader keeps the source object ID, source URL, retrieval timestamp, lifecycle
and file-status codes, tenure award date and tenure retirement date. It does not
convert these into construction dates or condition estimates. A known construction
year may be entered separately. Unknown years remain blank.

Each road has an editable planning condition (unknown, serviceable, rehabilitation,
closed), condition evidence (unreviewed, assumed, field verified by the user), and
an explicit reuse checkbox. Catalogue and imported roads start with unknown
condition, unreviewed evidence and reuse disabled. A closed road cannot be enabled.
Project JSON and context GeoJSON exports preserve the evidence and assumptions.

When route reuse is enabled in route settings, only individually enabled road
lines are eligible for the route cost preference. The preference compares entered
cost scenarios near road centrelines; it does not prove connectivity, road width,
bridge capacity, access rights, retained gravel quality or rehabilitation costs.
Terrain, grade and exclusions continue to apply. Review and survey precede any
decision to build or use an existing road.

## Why age and condition are not inferred from the catalogue

The Province's [Integrated Roads documentation (2025)](https://catalogue.data.gov.bc.ca/dataset/a489bc6a-f676-4503-8cd7-dcf0bdf2ae99/resource/4b2aa2a5-8cfd-4410-a0af-d7f257b4131c/download/integrated-roads-description-for-bcdc-current-2025.pdf)
explains that a tenure award can precede construction by years and a permitted
road might never have been built. A retired tenure does not establish physical
deactivation. Capture dates describe source imagery, not construction age, and
condition attributes are inconsistent. It also identifies missing and duplicated
road linework. Consequently a guessed road age from these dates would be misleading.

The [Digital Road Atlas](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/roads)
offers a broader public road inventory, including resource roads. It is a useful
additional cross-check or user-import source; this panel's live loader uses the
specific tenure service so its metadata has an explicit interpretation.
The [Resource Roads Spatial Data Update](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/roads/resource-roads)
describes known coverage and currency problems in provincial road databases.

A future state estimate should attach dated field observations, inspections,
imagery interpretation and structure inventories to a road. Any deterioration
model needs local calibration and uncertainty bounds; these data alone do not
support that model.

## Province-wide Forest Service Road discovery

The source covers BC, while browser geometry requests remain local. **Load BC
FSRs in this area** filters the authoritative source by `FILE_TYPE_CODE='B40'`
(Forest Service Road) and active lifecycle. Generic permit roads (`B01`) are
classified separately. A name containing "FSR" or a numeric file identifier is
never used as proof of FSR identity. The official [Forest Tenure service](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/196)
publishes the file-type fields, while the [FTA map's road legend](https://delivery.maps.gov.bc.ca/arcgis/rest/services/fta/15000/MapServer/2)
also distinguishes Forest Service Road from Road Permit and SUP Road categories.

**Find a route** can load nearby FSRs automatically and compare connections from
the active road's start or end point. `loadNearestBcFsrs` queries active FSR sections
within 2 km, then 5 km, then 10 km. Automatic connection stops at the first radius
with a mapped candidate; **Find nearby FSRs** expands until at least three choices
are available or the 10 km limit is reached.
These are actual radius queries, not an entire provincial download. The exact
closest point along each line segment is used as a connection target in a local
metric plane, with great-circle straight-line distance reported. The nearest
stored vertex is not substituted. Multipart sections are deduplicated by their
source object ID. Closed roads and retired tenure records are excluded from
automatic connection candidates. Unknown condition remains unknown; the source
does not prove that an active tenure is constructed, serviceable or legally
available for this use.

The route comparison tests up to three closest mapped sections against current
terrain, grade, slope, stream and exclusion constraints. It preserves the original
alignment and creates an alternative only after the user chooses it. The
straight-line nearest FSR may require a much longer feasible route. The bounded
search can return no connection if terrain coverage or hard constraints block it;
this does not establish that no access exists elsewhere in BC. A first-radius
candidate can also be infeasible even though a more distant candidate exists.

**FSR to connect to** lists up to ten nearest loaded sections by name and
straight-line distance from the chosen road endpoint. Choosing a named section
highlights that road and its proposed junction in blue. **Locate selected FSR**
fits the plan to it and closes the phone controls so the map is visible.
**Connect to selected FSR** searches only that destination; a failure never
substitutes a different road. Closed, retired or removed targets are unavailable.
Automatic nearest-feasible and lowest-screening-cost selection remain available.

Generated alignments retain an optional `fsrConnection` record in project JSON:
the destination section/name/junction, origin, choice mode, source scope, and
straight-line distance, generated length and search cost at creation. The Design
panel shows this historical record on reopening. Editing either endpoint produces
a junction-review notice; the saved record does not certify later edits.

An optional **Use regional terrain across connection (screening)** choice loads
coarse terrain spanning the current alignments and candidate junctions. A successful
result opens a separate regional project and retains the original terrain project
in the library. This makes a connector outside a small LiDAR tile reviewable without
replacing its site terrain. Regional terrain remains reconnaissance data.

When a user-provided FSR network is identified in the project, connection planning
uses that loaded network and names that scope in the result. Otherwise the BC
source query radius is reported. Neither mode claims a province-wide globally
optimal road connection.

GeoJSON road imports preserve portable FSR evidence. A raw BC export with
`FILE_TYPE_CODE='B40'` is classified as a user-provided FSR record, keeping reuse
disabled. Users can identify their other uploaded FSR linework explicitly with
the network-class field; that identification is distinct from a live BC record.

## Limits and budgets

| Limit                                                                                           | Enforcing code                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Query width and height at most 0.3°                                                             | `MAX_ROAD_QUERY_SPAN`, `existingRoads.ts`                                       |
| FSR-only area queries at most 0.5°; nearest radius at most 10 km with 3 expanding requests      | `MAX_FSR_QUERY_SPAN`, `existingRoads.ts`; `FSR_SEARCH_RADII_M`, `fsrNetwork.ts` |
| Up to 10 listed FSR choices; automatic routes compare at most 3, a named choice runs one search | `MAX_FSR_CHOICES`, `MAX_FSR_CONNECTION_CANDIDATES`, `fsrConnections.ts`         |
| At most 500 road/context features; at most 50,000 context vertices per project                  | `MAX_EXISTING_ROADS`, `existingRoads.ts`; `MAX_CONTEXT_VERTICES`, `project.ts`  |
| At most 10 MB live response or user road import                                                 | `MAX_ROAD_RESPONSE_BYTES`, `existingRoads.ts` and `ExistingRoadsPanel.tsx`      |
| Truncation is an error; no partial network is accepted                                          | `parseBcExistingRoads`, `existingRoads.ts`                                      |

Zoom in or split linework when a budget is exceeded. Existing project context is
validated together with new roads before replacing state. Reloading the same BC
record retains the user's review evidence. GeoJSON imports receive new project IDs.
