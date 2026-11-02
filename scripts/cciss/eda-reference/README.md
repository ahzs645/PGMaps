# CCISS edatopic-overlap reference

`src/pages/cciss/edaReference.test.ts` checks the browser's edatopic overlap against
ccissr's own `edatopicOverlap` (`eda_overlap.R`, Apache-2.0, Province of British
Columbia), pinned at bcgov/ccissr `a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce`, the
commit the browser port cites. The comparison uses `onlyRegular = TRUE`, the NoPhase
overlap that drives CCISS species votes.

- `generate-cases.mjs` writes 120 deterministic cases: a current BGC `A`, regular and
  special E1 series, ordinary and special phases, and a 2041 prediction split into
  eighths across four BGCs (including `A` itself).
- `run-reference.R` runs the pinned `eda_overlap.R` on every case and writes
  `reference.json` (`SSprob` per current series, predicted BGC and predicted series).
- The test assigns a unique species to every site series, so each species' first-class
  2041 vote equals the probability of that predicted series, including the BGC
  denominator, and compares every value to R within 1e-9.

Regenerate (Ubuntu: `apt-get install r-base-core r-cran-data.table r-cran-jsonlite`):

```bash
node scripts/cciss/eda-reference/generate-cases.mjs | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), separators=(',', ':')))" > scripts/cciss/eda-reference/cases.json
Rscript scripts/cciss/eda-reference/run-reference.R scripts/cciss/eda-reference/cases.json scripts/cciss/eda-reference/reference.json
```

The committed reference was produced with R 4.3.3 and data.table 1.14.10.
