# Native R/SpaDES comparison

This suite executes the unchanged, SHA-256-pinned Province of British Columbia
`forestryCastor` and `growingStockCastor` modules with **R 4.5.0 and SpaDES.core
2.1.8**, then compares their recorded output with the production TypeScript
engine. It supplements, rather than replaces, the independent SQL checks in
[`../reference`](../reference/README.md).

## Evidence and result

The 13 shared synthetic cases each run three five-year periods. A read-only
SpaDES observer records the initial condition and the states before and after
every harvest event. Growth runs at queue priority 1, the before observer at 2,
harvest at 3, growing-stock reporting at 90 and the after observer at 99. The first
native growth increment is two years, as specified by R's rounding rule.

The current comparison checks **4,492 values or ordered ID arrays**. **4,010
match within 1e-9**; **482 differ for the six explicitly reviewed causes below**.
These are comparison counts, not counts of unique input cells or independent
measurements. No production engine behavior is changed by this validation PR.

| Case | Comparisons | Explicit differences |
| --- | ---: | ---: |
| Growth without harvest | 395 | 0 |
| Live harvest | 395 | 15 |
| Cover `ge` | 398 | 30 |
| Cover `le` | 398 | 20 |
| Temporal no-harvest zone | 395 | 40 |
| Distance `ge` | 398 | 30 |
| Multiple-condition cover | 398 | 30 |
| Explicit denominator | 398 | 15 |
| Salvage harvest | 395 | 42 |
| Low-volume candidate cap | 395 | 129 |
| Final yield endpoint | 66 | 28 |
| Maximum age | 66 | 21 |
| Prescribed schedule with no-harvest constraint | 395 | 82 |

The compared fields include cell age, volume, height, ECA, reservation state,
cumulative constrained periods, harvest year and volume, transitioned yield ID,
salvage volume, crown closure, basal area and QMD; selected pixels/landings;
period harvest area/volume; initial and before/after growing stock; and native
before-harvest constraint percentages where the source emits them.

### Deliberate browser differences

`expected-differences.json` lists **every exact path and both values**, with a
source-linked explanation. The test fails on any added, removed or changed
numerical difference. It never excludes a whole field or case from comparison.

- **210 immediate stand-attribute resets:** native clearcut updates age, live
  volume and salvage volume, leaving height, ECA, crown closure, basal area and
  QMD at their pre-harvest values until subsequent growth. The browser updates
  them immediately. This accounts for 180 differences in live/constraint cases
  and 30 in salvage.
- **12 salvage raster values:** the native raster writes live `vol_h` even when
  the actual harvest is dead timber. Its dead-harvest report uses salvage
  volume. The browser raster records actual dead harvested volume.
- **129 candidate-cap consequences:** the native `LIMIT trunc(target/50)`
  excludes all candidates in this low-volume case. The browser considers the
  complete eligible queue, harvesting cells 1–2, 3–4 and 5–6 across the periods.
- **28 endpoint consequences:** with no upper interpolation knot, native SQL
  retains prior/input stand values. The browser holds the final supplied knot.
- **21 maximum-age consequences:** native age 349 advances to 351, then stays
  outside the interpolation range. The browser clamps at 350 and updates yield.
- **82 prescribed-schedule safety consequences:** the native schedule path
  bypasses constraints; the browser enforces the active no-harvest zone.

The source audit previously called the scheduled raster's `$vol`/`vol_h` names
mismatched. In this executed fixture, R's partial matching resolves `$vol` to
`vol_h`; the native raster correctly records 204 m³. This suite does **not**
show a scheduled-volume raster failure. It does show the constraint bypass.

## Reproduce

From the PGMaps root, with R 4.5.0 and normal R spatial build dependencies:

```sh
Rscript scripts/forestry-castor/native-reference/install.R
Rscript scripts/forestry-castor/native-reference/run.R . /tmp/castor-native-output.json
CASTOR_NATIVE_OUTPUT=/tmp/castor-native-output.json npx vitest run src/features/forestry-castor/nativeReference.test.ts
node --import tsx scripts/forestry-castor/native-reference/compare.ts /tmp/castor-native-output.json
```

`install.R` pins the directly used numerical packages and scheduler stack to the
versions recorded in `native-output.json`. Transitive R packages and OS libraries
are not a complete lockfile. Replay validates every recorded direct version and
reports numerical drift instead of treating a changed dependency as equivalence.
The manual **Verify forestry Castor workbench** workflow installs this environment
and checks fresh native evidence. It remains `workflow_dispatch` only.

Without R, ordinary unit tests compare the committed native artifact with the
current browser engine. The artifact records hashes for both unchanged source
modules, the harness and exact input JSON. Tests also reject stale hashes,
changed package versions, missing cases/periods, reordered pixels, incomplete
rasters and nonfinite values. `comparison.json` is a regenerable local report,
not a new golden oracle. Do not regenerate the explicit-difference ledger without
reviewing the source cause and numerical changes.

## Scope and limits

These are small, prepared, synthetic cases, with contiguous pixel IDs and
one-hectare cells. The harness creates an in-memory SQLite database and aligned
raster; it does not reproduce PostgreSQL preparation, operational inventories,
block generation, adjacency, disturbance updates, road generation, partial-cut
calibration, the absent Java optimizer or yield-uncertainty calibration. It does
not establish regional/provincial equivalence or validate every browser extension.
The native source remains unchanged, including metadata and licence headers.

The zero/positive raster values here do not test unknown/NULL stand attributes.
The existing SQL and import suites cover additional missing-value behavior.
Interactive browser acceptance remains a separate suite and is not implied by
these numerical checks.
