# Gravel and aggregate source scenarios

For horizontal geometry selection using actual connected loaded and empty-return
paths, rehabilitation, bridge/access work, finite aggregate supply and waste
destinations, use the separate [full-cost alternatives workflow](full-cost-alternatives.md).
The original single-source controls below remain a simpler entered-distance scenario.

Engineering → **Aggregate source** (also under Haul → **Haul & cost settings**) includes a surfacing aggregate source,
separate from borrow fill. The source is an entered price and capacity scenario.
It can be disabled without deleting its assumptions. Project JSON preserves the
source, rates, quantity, notes and enabled state; the report records its pricing basis. Engineering and Review show the active source, supplied quantity and base-rate remainder, so editing a base rate cannot be mistaken for changing an enabled source price.

The delivered surfacing rate, in CAD per compacted m³, is:

`acquisition + processing + loading + one-way haul km × haul $/m³·km + placement`.

Setting acquisition to zero leaves every other term intact. The source supplies
the smaller of covered surfacing quantity and entered compacted capacity. The
remaining quantity uses the project's base surfacing rate. Zero capacity supplies
nothing; null capacity is an explicitly unbounded scenario. These costs enter the
normal engineering total and the vertical profile optimizer's **total-cost**
candidate scoring. Horizontal route and corridor search have separate objectives;
they do not compute aggregate delivery routes or optimize pit choice.

The entered distance is one-way loaded haul. Enter a rate that covers the intended
truck cycle, including empty return if applicable; the model does not double the
distance or infer a road network connection. Material grading, compaction, usable
yield, rights of access, crushing equipment and production capacity need evidence
from the planner. Rates start as unpriced placeholders.

## Finding BC candidate records

**Find nearby BC pit candidates** queries the province's Forest Tenure Special Use
Permit Polygon for `SPECIAL_USE_DESCRIPTION` equal to `Gravel Pit, Rock Quarry` or
`Quarrying`, within the road's bounding box plus a 10 km buffer on each side.
The [BC mining datasets guide](https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/mineral-titles/data-gis/dataset-descriptions-download)
identifies this as one of several sources for finding pits and quarries. This is
not a complete inventory: special-access-road polygons, Crown tenures, permitted
mine areas, transportation pits and private inventories can contain other sites.

The primary browser endpoint is the province's ArcGIS `bcgwpub/MapServer/615`.
The equivalent DataBC WFS is a fallback. The lookup retains file ID, permit use,
lifecycle and file status. It shows the polygon's bounding-box centre only as a
location reference; it is not a pit entrance, stockpile or measured haul distance.
Selecting **Use as source reference** copies the record and uncertainty into the
source notes. It does not enable a source, set a free price, assume usable capacity,
or invent access. Selecting a new reference switches the source off until the
planner enters new delivery assumptions and confirms capacity. Previous prices, haul inputs and capacity are cleared to unpriced defaults, with available quantity set to zero. The source remains disabled until explicitly enabled. If network access fails, a filtered BC special-use permit GeoJSON
export can be imported through the same geometry and record checks.

An active tenure is not proof of an operating or available pit. Retired records
remain visible for review. [BC aggregate permit guidance](https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/permitting/mine-exploration/sand-gravel-permits)
describes the permit application process; a map record is not permission to extract
or remove aggregate. The [catalogue metadata](https://catalogue.data.gov.bc.ca/dataset/forest-tenure-special-use-permit-polygon)
remains the reference for the source's meaning and currency.

## Borrow fill and waste sites

Each borrow or waste site has an **Include … in allocations** switch, source
notes, a procurement/disposal rate, finite or unbounded capacity, entered access
distance and a fixed preparation cost. Disabled sites incur no allocation or
setup cost. A zero borrow price still leaves haul, loading and setup costs.

Older projects retain nearest-source allocation. **Lowest delivered batch cost**
compares site rate + applicable haul/loading per m³ + unused setup cost divided
by the available batch, with distance and ID tie-breaks. The model still works
in chainage order, uses reusable cut first, and allocates only within each fully
supported run. It is a reproducible heuristic, not a globally optimal haul plan.
Unallocated demand retains its default procurement/disposal price and unknown
haul remains excluded, as in the existing engine.

## Limits and checks

| Limit                                                                     | Enforcing code                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 100 candidate records; transfer-limited results rejected                  | `gravelCandidates.ts`, `MAX_GRAVEL_CANDIDATES`, `loadGravelCandidates`             |
| 50 km query width and height including buffers                            | `gravelCandidates.ts`, `gravelBounds`                                              |
| 4 MB response/export, 50,000 candidate vertices                           | `gravelCandidates.ts`, loaders and parser                                          |
| 20-second timeout per remote attempt                                      | `gravelCandidates.ts`, `loadGravelCandidates`                                      |
| Compacted capacity at most 10¹² m³; one-way aggregate distance 0–1,000 km | `engineeringProject.ts`, `parseEngineering`; `templates.ts`, `validateEngineering` |
| Existing site access distance at most 100 km                              | `engineeringProject.ts`, `parseEngineering`; `templates.ts`, `validateEngineering` |

Tests check finite-source fallback, source disabling, zero acquisition with nonzero
handling and haul, delivered-cost borrow selection, project parsing, malformed and
truncated data, and escaped report source notes. Browser verification must check
the real service separately from unit fixtures: a successful server-side request
alone does not establish browser cross-origin access.
