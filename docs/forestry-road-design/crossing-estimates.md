# Stream crossing records and estimates

**Engineering → Stream crossing estimates** records the physical intersections between each road and
the loaded stream lines. These are planning records, not hydraulic or fish-passage approvals. Select a
bridge, open-bottom structure, embedded culvert, closed-bottom culvert or ford; no option is selected
automatically from stream class, fish evidence or a sizing table.

## Identity and review

A record belongs to one road, source stream ID, intersection coordinate (rounded to 8 decimal places)
and occurrence along the road. Repeated vertex intersections within 1 cm of chainage collapse. A road
that passes the same location again retains a separate occurrence. Road name and display changes keep
the record. Horizontal geometry, vertical design, section geometry or source stream geometry/assessment changes
require an explicit geometry review. A crossing that moves receives a new record; earlier evidence and
quotes remain in the project and outside the current estimate. The app never copies an old quote to a
nearby new physical crossing.

## Prices and shared work

Every line has a description, quantity, unit, entered unit rate, source/quote reference, optional source
URL and price date. Empty quantities and rates remain unknown. Explicit zero is accepted; it still
needs a source and date. Source references are user supplied and are not independently verified. There
are no installed-price defaults and no automatic use of the DFO table or provincial appraisal rates.

Project shared items, such as survey, design, environmental work and mobilization, enter **once per
road alternative estimate**, regardless of the number of stream crossings. An alternative is an
alternative estimate, not another project charge. Do not duplicate an amount already included in the
engineering mobilization or another line. Combined multi-road project procurement is not modelled.

The road engine adds priced current-record items and shared items to the structures ledger before the
road's existing contingency. The same ledger feeds the workspace, previews, alternative comparisons
and complete-access costing. Missing quantities, rates, provenance, structure selections or geometry
reviews keep the estimate incomplete; known subtotals cannot qualify as complete construction prices.

An existing engineering stream culvert at the same feature and station must be explicitly selected as
the installed allowance to replace. The detailed estimate then replaces its calculated installed cost,
while its geometry and drainage calculations remain. Unresolved or moved links are flagged and retain
the old allowance without adding the competing itemized amount. Other culverts retain their existing
prices. Route-search cost groups remain separate screening allowances, not verified installed prices.

## Persistence and reporting

Version-1 projects preserve `alignment.crossingRecords` and `project.sharedCrossingCosts`; older
projects load without inventing records or prices. The printable report includes structure choices,
review notes, itemized costs and source/date evidence, shared-once accounting, replacement amounts and
outstanding work. Complete-cost signatures change when shared prices or crossing evidence changes.

| Limit                                                       | Value            | Enforcement                |
| ----------------------------------------------------------- | ---------------- | -------------------------- |
| Saved crossing records per road (including earlier records) | 2,000            | `parseCrossingRecords`     |
| Items per crossing / project shared list                    | 100              | `parseCrossingCostItems`   |
| Quantity or unit rate                                       | 0–1 billion      | `parseCrossingCostItems`   |
| Crossing identity coordinate precision                      | 8 decimal places | `locationKey`              |
| Duplicate intersection chainage tolerance                   | 0.01 m           | `reconcileCrossingRecords` |
| Explicit legacy culvert station tolerance                   | 1 m              | `estimateCrossings`        |

These bounds protect project size and computation; they do not state surveying accuracy.
