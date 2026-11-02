# Forestry Castor independent reference checks

These fixtures check the numerical and selection logic independently of the
TypeScript implementation. They do **not** establish equivalence to a complete
R/SpaDES run or to a provincial forestry analysis.

Run from the PGMaps root:

```sh
python scripts/forestry-castor/reference/generate.py --check
```

To regenerate after reviewing a source change, omit `--check` and inspect the
fixture diff. The generator verifies exact SHA-256 checksums of both reference R
files and the original public SQLite sample before evaluating SQL. It requires
only Python's standard library; it makes no network requests.

## Sources

| Source | Pinned revision | Local reference |
| --- | --- | --- |
| [forestryCastor](https://github.com/bcgov/forestryCastor) | `e2a580eb1fcc634780bb3599da7265a1e871484f` | `upstream-forestryCastor.R` |
| [growingStockCastor](https://github.com/bcgov/growingStockCastor) | `8ea945a91b4ec71d0ddd28714641b6dcae229c5c` | `upstream-growingStockCastor.R` |
| [dataCastor](https://github.com/bcgov/dataCastor) | `884ce9d726942b3d2eae7b88120bd1b7ad863a19` | `public/data/forestry-castor/simple_castordb.sqlite` |

The two R files preserve the exact upstream Git blob contents, including their
licence headers. Apache-2.0 licence and attribution accompany the public sample.

## What is checked

- Ten constraint cases exercise scalar `ge`/`le`, distance, multiple conditions,
  denominators, equivalent clearcut area, zero retention, and reuse of an existing
  reservation. Each records the resolved upstream SQL, selected pixel IDs,
  reservation count, actual percentage, and upstream source lines.
- SQLite half-up rounding is recorded separately from R's half-to-even rounding
  for the first growth increment. A five-year period advances two years on the
  first growth event in upstream `growingStockCastor`.
- Fourteen growth ages use the SQL string extracted directly from the pinned R
  file and the sample's actual yield curve. Cases include fractional ages, exact
  knots, the last knot, and ages beyond the curve/model range.
- Eight harvest targets exercise cumulative-prefix selection. Selection stops
  when cumulative volume exceeds the target; it does not skip an oversized
  earlier candidate to admit smaller later candidates.

## Boundaries of the evidence

Python SQLite executes the same SQL expressions and ordering templates. The
generator does not load R, SpaDES, `data.table`, `terra`, PostgreSQL, a Java VM,
or any TS engine result. The constraint templates have their R-generated field
names resolved to fixed fixture columns. The queue calculation translates R's
`cumsum` expression to SQLite's cumulative `SUM` window; it does not recreate the
candidate-query construction.

The expected SQL results preserve upstream quirks so that a browser correction
can be tested and labelled explicitly. For example, an initial pixel with NULL
volume at the final 250-year yield knot remains NULL in upstream SQL because
there is no upper 260-year knot. The browser's held endpoint is an intentional
correction. These cases must not be silently changed to agree with the port.

No operational inventory, calibrated yield-error model, full dependency chain,
or reference SpaDES simulation is bundled with `forestryCastor`. End-to-end
provincial equivalence requires those additional inputs and an R reference run.
