# Original R reference cases

This directory preserves exact source files from
`bcgov/forestDroughtTool@e02ddcbf8203e65bada1a36655887e1d0c8fe2f5` (Apache-2.0,
Copyright 2019 Province of British Columbia). `upstream/manifest.json` records
all source hashes. The R kernel is not edited to match the TypeScript port.

1. `node verify-upstream.mjs [reference-directory]`
2. `node create-inputs.mjs [cases-directory]`
3. `Rscript generate-reference.R REFERENCE_DIRECTORY CASES_DIRECTORY OUTPUT_DIRECTORY`
4. `node compare-reference.mjs COMPILED_MODEL_INDEX.js CASES_DIRECTORY OUTPUT_DIRECTORY`

For an uncompiled TypeScript model, use `node --import tsx` in step 4. The R
process requires `dplyr` and `tidyr`. The comparator has only Node standard
library dependencies when pointed at compiled JavaScript.

`create-inputs.mjs` regenerates the ignored `cases/` directory of deterministic
synthetic climate CSVs; these are not observed weather or projections. The cases cover seasonal variation, frozen weather,
prolonged drought, heavy rain, a negative lateral-flow parameter, three
latitude tables and leap days. `generated/` is runtime output and should be
uploaded as a CI artifact rather than confused with reviewed source data.
`comparison-report.json` reports the exact case counts and maximum error.

See `docs/forest-drought-model.md` in PGMaps, or the fork's browser documentation,
for the input, summary, classification and year-selection policies that differ
from the original wrappers. A successful direct-kernel comparison does not
claim complete `asmr()`/forDRAT workflow equivalence.
