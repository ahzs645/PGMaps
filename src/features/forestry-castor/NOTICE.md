# Forestry Castor browser adaptation

Derived from forestryCastor and growingStockCastor, Copyright 2023 Province of
British Columbia, licensed under Apache-2.0. The accompanying public data directory
contains the full Apache-2.0 licence. Source revisions and exact R files are retained
under `scripts/forestry-castor/reference`.

- forestryCastor: `e2a580eb1fcc634780bb3599da7265a1e871484f`
- growingStockCastor: `8ea945a91b4ec71d0ddd28714641b6dcae229c5c`
- dataCastor example: `884ce9d726942b3d2eae7b88120bd1b7ad863a19`

PGMaps changes the execution environment to a local TypeScript worker and adds
explicit input validation, normalized hectare accounting, bounded workloads,
structured predicates, full event histories, completed partial-cut and salvage
accounting, a seeded fixed-plan yield sensitivity, Float64 raster exports and
browser reports. These are documented adaptations and extensions. They do not
establish complete numerical equivalence with an R/SpaDES model or reproduce
the absent gamma calibration, external Java cellular automaton, PostgreSQL
preparation, or companion disturbance/road/fire/caribou modules.

See `docs/forestry-castor.md` for the implemented contract and
`docs/forestry-castor-source-audit.md` for the complete source-to-web mapping.
